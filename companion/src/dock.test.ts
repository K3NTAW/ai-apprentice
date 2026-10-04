import { describe, expect, it } from "vitest";
import {
  avatarState,
  dockBounds,
  dockEnabled,
  dockViewModel,
  FEED_MAX,
  initialDock,
  parseDockPrefs,
  reduceDock,
  serializeDockPrefs,
  sessionKey,
  surfaces,
  type DockSession,
} from "./dock.mjs";
import { parseClientMessage } from "./protocol.mjs";

const url = (s: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${s}</title></svg>`).toString("base64")}`;
const agent = { id: "0b5c", name: "Senior Sales Person", role: "Learning from Sabine", avatar: { idle: url("idle"), talking: url("talking"), stop: url("stop") } };
const capture: DockSession = { mode: "capture", title: "Quote", asked: 2, guardrails: 1, off_record: false, agent };

describe("dock feed", () => {
  it("keeps the last 8 lines and drops duplicates", () => {
    let s = initialDock();
    for (let i = 0; i < 12; i++) s = reduceDock(s, { type: "learned", kind: "step", text: `line ${i}` });
    expect(s.feed).toHaveLength(FEED_MAX);
    expect(s.feed[0].text).toBe("line 4");
    expect(s.feed[7].text).toBe("line 11");
    expect(reduceDock(s, { type: "learned", kind: "step", text: "line 11" })).toBe(s);
    expect(reduceDock(s, { type: "learned", kind: "shortcut", text: "line 11" }).feed).toHaveLength(FEED_MAX);
  });

  it("resets on a new session and on unpair, not on the same session", () => {
    let s = reduceDock(initialDock(), { type: "session", key: sessionKey(capture) });
    s = reduceDock(s, { type: "learned", kind: "guardrail", text: "Never discount above 15%" });
    s = reduceDock(s, { type: "hide" });
    expect(reduceDock(s, { type: "session", key: sessionKey({ ...capture, asked: 5 }) })).toBe(s);
    const next = reduceDock(s, { type: "session", key: sessionKey({ ...capture, title: "Other" }) });
    expect(next.feed).toEqual([]);
    expect(next.page).toBe("auto");
    const unpaired = reduceDock(s, { type: "reset" });
    expect(unpaired.feed).toEqual([]);
    expect(unpaired.sessionKey).toBeNull();
  });
});

describe("mode switch", () => {
  const base = { dockEnabled: true, paired: true, page: "auto" as const };
  it("capture shows the dock and hides the buddy", () => {
    expect(surfaces({ ...base, mode: "capture" })).toEqual({ dock: true, buddy: false });
    expect(surfaces({ ...base, mode: "capture", page: "hide" })).toEqual({ dock: false, buddy: false });
  });

  it("teach hides the dock and shows the buddy, even after dock.show", () => {
    expect(surfaces({ ...base, mode: "teach" })).toEqual({ dock: false, buddy: true });
    expect(surfaces({ ...base, mode: "teach", page: "show" })).toEqual({ dock: false, buddy: true });
  });

  it("no session shows the dock only on dock.show; unpaired or COMPANION_DOCK=0 never", () => {
    expect(surfaces({ ...base, mode: null })).toEqual({ dock: false, buddy: true });
    expect(surfaces({ ...base, mode: null, page: "show" })).toEqual({ dock: true, buddy: false });
    expect(surfaces({ ...base, paired: false, mode: "capture" }).dock).toBe(false);
    expect(surfaces({ ...base, dockEnabled: false, mode: "capture" })).toEqual({ dock: false, buddy: true });
    expect(dockEnabled("0")).toBe(false);
    expect(dockEnabled(undefined)).toBe(true);
  });

  it("maps buddy states to avatar states; a stop point shows 'stop'", () => {
    expect(avatarState("idle", null)).toBe("idle");
    expect(avatarState("listening", null)).toBe("listening");
    expect(avatarState("thinking", null)).toBe("thinking");
    expect(avatarState("speaking", null)).toBe("talking");
    expect(avatarState("paused", null)).toBe("paused");
    expect(avatarState("speaking", "stop")).toBe("stop");
    expect(avatarState("idle", "glance")).toBe("idle");
  });
});

describe("dock view and placement", () => {
  it("builds the view with avatar frame, say, icons and counters", () => {
    let s = reduceDock(initialDock(), { type: "learned", kind: "shortcut", text: "Cmd+Shift+T reopens the tab" });
    s = reduceDock(s, { type: "learned", kind: "guardrail", text: "Check the credit limit" });
    const v = dockViewModel({ state: s, session: capture, mode: "speaking", target: null, say: "Why this price?", paused: false });
    expect(v).toMatchObject({ avatar: agent.avatar.talking, name: agent.name, role: agent.role, say: "Why this price?", asked: 2, guardrails: 1, collapsed: false });
    expect(v.feed.map((l) => l.icon)).toEqual(["⌘", "⚠"]);
    // Missing frames fall back to idle; no agent means no avatar.
    expect(dockViewModel({ state: s, session: capture, mode: "thinking", target: null, say: null, paused: false }).avatar).toBe(agent.avatar.idle);
    expect(dockViewModel({ state: s, session: { ...capture, agent: undefined }, mode: "idle", target: null, say: null, paused: false }).avatar).toBeNull();
  });

  it("collapses to the 56 px avatar tab at the docked edge and persists it", () => {
    const wa = { x: 0, y: 25, width: 1440, height: 875 };
    // Presentational (T-0136, canvas Dock.dc.html): 340 px wide, 12 px margin; tab 56 x 196 flush with the edge.
    expect(dockBounds(wa, "right", false)).toEqual({ x: 1440 - 340 - 12, y: 25 + Math.round((875 - 525) / 2), width: 340, height: 525 });
    const tab = dockBounds(wa, "right", true);
    expect(tab.width).toBe(56);
    expect(tab.height).toBe(196);
    expect(tab.x).toBe(1440 - 56);
    expect(dockBounds(wa, "left", true).x).toBe(0);
    expect(dockBounds({ x: 0, y: 0, width: 800, height: 150 }, "right", true).height).toBe(150);
    let s = reduceDock(initialDock(), { type: "collapse", collapsed: true });
    expect(dockViewModel({ state: s, session: capture, mode: "idle", target: null, say: null, paused: false }).collapsed).toBe(true);
    expect(parseDockPrefs(serializeDockPrefs({ collapsed: true }))).toEqual({ collapsed: true });
    expect(parseDockPrefs("{broken")).toEqual({ collapsed: false });
    s = reduceDock(s, { type: "show", side: "left" });
    expect(s.side).toBe("left");
  });
});

describe("protocol v3 dock and agent messages", () => {
  it("parses dock.show, dock.hide and dock.learned with limits", () => {
    expect(parseClientMessage('{"type":"dock.show"}')).toEqual({ ok: true, msg: { type: "dock.show", side: "right" } });
    expect(parseClientMessage('{"type":"dock.show","side":"left"}')).toEqual({ ok: true, msg: { type: "dock.show", side: "left" } });
    expect(parseClientMessage('{"type":"dock.show","side":"top"}').ok).toBe(false);
    expect(parseClientMessage('{"type":"dock.hide"}')).toEqual({ ok: true, msg: { type: "dock.hide" } });
    expect(parseClientMessage('{"type":"dock.learned","kind":"step","text":"Open the CRM"}')).toEqual({ ok: true, msg: { type: "dock.learned", kind: "step", text: "Open the CRM" } });
    expect(parseClientMessage(JSON.stringify({ type: "dock.learned", kind: "step", text: "x".repeat(141) })).ok).toBe(false);
    expect(parseClientMessage('{"type":"dock.learned","kind":"note","text":"x"}').ok).toBe(false);
    expect(parseClientMessage('{"type":"dock.learned","kind":"step","text":"  "}').ok).toBe(false);
  });

  it("keeps session.state when the agent is bad and accepts large avatars only in session.state", () => {
    const good = parseClientMessage(JSON.stringify({ type: "session.state", mode: "capture", title: "Quote", agent }));
    expect(good.ok && good.msg.type === "session.state" && good.msg.agent).toEqual(agent);
    const badAvatar = parseClientMessage(JSON.stringify({ type: "session.state", mode: "capture", agent: { ...agent, avatar: { idle: "javascript:x" } } }));
    expect(badAvatar).toMatchObject({ ok: true, warning: "session_avatar_idle" });
    expect(badAvatar.ok && "agent" in badAvatar.msg).toBe(false);
    const longName = parseClientMessage(JSON.stringify({ type: "session.state", mode: "teach", agent: { ...agent, name: "é".repeat(61) } }));
    expect(longName).toMatchObject({ ok: true, warning: "session_agent_name", msg: { mode: "teach" } });
    expect(parseClientMessage(JSON.stringify({ type: "session.state", agent: { ...agent, name: "é".repeat(60) } })).ok).toBe(true);
    const big = `data:image/svg+xml;base64,${"A".repeat(90_000)}`;
    const large = parseClientMessage(JSON.stringify({ type: "session.state", mode: "capture", agent: { ...agent, avatar: { idle: big, talking: big } } }));
    expect(large.ok && large.msg.type === "session.state" && large.msg.agent?.avatar.talking).toBe(big);
    expect(parseClientMessage(JSON.stringify({ type: "buddy.say", text: "hi", pad: "x".repeat(20_000) }))).toEqual({ ok: false, reason: "too_large" });
    expect(parseClientMessage(`{"type":"session.state","type":"buddy.say","text":"hi","pad":"${"x".repeat(20_000)}"}`)).toEqual({ ok: false, reason: "too_large" });
  });
});
