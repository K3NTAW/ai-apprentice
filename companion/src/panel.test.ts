import { describe, expect, it } from "vitest";
import { checkAppUrl } from "./appUrl.mjs";
import { parseAllowlist } from "./origin.mjs";
import { isPanelAction, panelMaterial, panelViewModel, type PanelInput } from "./panel.mjs";
import { parseClientMessage, SESSION_LIMITS, type SessionStateMessage } from "./protocol.mjs";
import { defaultBindings } from "./shortcuts.mjs";

const allowlist = parseAllowlist(undefined);
const session: SessionStateMessage = {
  type: "session.state",
  mode: "teach",
  title: "Invoice approval",
  expert: "Anna",
  asked: 3,
  guardrails: 1,
  last_question: "Why this cost centre?",
  last_answer: "Because of the project code.",
  off_record: true,
  app_url: "https://ai-apprentice.vercel.app/w/1/teach",
};

function input(over: Partial<PanelInput> = {}): PanelInput {
  return {
    code: "123456",
    paired: true,
    permissions: { input: true, screen: false, accessibility: true },
    serverError: null,
    platform: "darwin",
    paused: false,
    session,
    allowlist,
    bindings: defaultBindings("darwin"),
    registrationErrors: {},
    talkMode: "hold",
    buddyEnabled: true,
    buddyForcedOff: false,
    ...over,
  };
}

describe("panel view model", () => {
  it("shows the session from session.state", () => {
    const v = panelViewModel(input());
    expect(v.firstRun).toBe(false);
    expect(v.session).toEqual({
      modeLabel: "Teach",
      title: "Invoice approval",
      expert: "Anna",
      lastQuestion: "Why this cost centre?",
      lastAnswer: "Because of the project code.",
      asked: 3,
      guardrails: 1,
      offRecord: true,
    });
    expect(v.actionsEnabled).toBe(true);
    expect(v.canOpenControlRoom).toBe(true);
    expect(v.shortcuts.find((s) => s.action === "talk")).toMatchObject({ display: "Option+Space", error: null });
  });

  it("first run shows the pairing code; no session data while unpaired", () => {
    const v = panelViewModel(input({ paired: false }));
    expect(v.firstRun).toBe(true);
    expect(v.pairing.code).toBe("123 456");
    expect(v.session.modeLabel).toBe("No session");
    expect(v.actionsEnabled).toBe(false);
    expect(v.canOpenControlRoom).toBe(false);
  });

  it("permissions only on macOS; registration errors and toggle mode are surfaced", () => {
    expect(panelViewModel(input()).showPermissions).toBe(true);
    const win = panelViewModel(input({ platform: "win32", bindings: defaultBindings("win32"), talkMode: "toggle", registrationErrors: { talk: "in use" } }));
    expect(win.showPermissions).toBe(false);
    expect(win.pairing.missing).toEqual([]);
    expect(win.shortcuts.find((s) => s.action === "talk")).toMatchObject({ display: "Alt+Space", error: "in use" });
    expect(win.talkHint).toMatch(/press once/);
    expect(isPanelAction("end_task")).toBe(true);
    expect(isPanelAction("talk_start")).toBe(false);
  });

  it("picks the window material per platform", () => {
    expect(panelMaterial("darwin", "15.0")).toBe("vibrancy");
    expect(panelMaterial("win32", "10.0.22631")).toBe("mica");
    expect(panelMaterial("win32", "10.0.19045")).toBe("solid");
    expect(panelMaterial("linux", "6.1")).toBe("solid");
  });
});

describe("app_url allowlist check", () => {
  it("opens allowed https origins and localhost http, normalised", () => {
    expect(checkAppUrl("https://ai-apprentice.vercel.app/w/1", allowlist)).toEqual({ ok: true, href: "https://ai-apprentice.vercel.app/w/1" });
    expect(checkAppUrl("HTTPS://AI-APPRENTICE.vercel.app:443/x", allowlist)).toEqual({ ok: true, href: "https://ai-apprentice.vercel.app/x" });
    expect(checkAppUrl("http://localhost:3000/capture", allowlist).ok).toBe(true);
  });

  it("rejects javascript:, file:, userinfo, plain http, lookalike hosts and junk", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://user:pw@ai-apprentice.vercel.app/",
      "https://ai-apprentice.vercel.app@evil.com/",
      "http://ai-apprentice.vercel.app/",
      "https://ai-apprentice.vercel.app.evil.com/",
      "https://xn--i-apprentice-xyz.vercel.app/",
      "https://аi-apprentice.vercel.app/",
      "https://evil.com/?https://ai-apprentice.vercel.app",
      "http://localhost:3001/",
      "data:text/html,hi",
      "not a url",
      "",
      undefined,
      "https://ai-apprentice.vercel.app/" + "a".repeat(3000),
    ]) {
      expect(checkAppUrl(bad, allowlist).ok, String(bad)).toBe(false);
    }
  });
});

describe("protocol v2 validation", () => {
  const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
  const r = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  it("accepts v2 messages", () => {
    expect(p({ type: "buddy.state", state: "thinking" })).toEqual({ ok: true, msg: { type: "buddy.state", state: "thinking" } });
    expect(p({ type: "buddy.say", text: "Hi", ttl_ms: 2000 })).toEqual({ ok: true, msg: { type: "buddy.say", text: "Hi", ttl_ms: 2000 } });
    expect(p({ type: "buddy.point", id: "a", rect: r, style: "glance", extra: 1 })).toEqual({
      ok: true,
      msg: { type: "buddy.point", id: "a", rect: r, style: "glance" },
    });
    expect(p({ type: "buddy.clear" })).toEqual({ ok: true, msg: { type: "buddy.clear" } });
    expect(p(session)).toEqual({ ok: true, msg: session });
    expect(p({ type: "session.state", mode: null })).toMatchObject({ ok: true, msg: { mode: null, asked: 0, title: "" } });
  });

  it("rejects oversize texts", () => {
    expect(p({ type: "buddy.say", text: "x".repeat(281) })).toEqual({ ok: false, reason: "say_text" });
    expect(p({ type: "buddy.say", text: "x".repeat(280) }).ok).toBe(true);
    expect(p({ type: "buddy.point", id: "a", rect: r, style: "stop", text: "x".repeat(141) })).toEqual({ ok: false, reason: "point_text" });
    for (const key of ["title", "expert", "last_question", "last_answer"] as const) {
      const over = p({ ...session, [key]: "x".repeat(SESSION_LIMITS[key] + 1) });
      expect(over, key).toEqual({ ok: false, reason: `session_${key}` });
    }
  });

  it("rejects out-of-range rects", () => {
    for (const rect of [
      { x: -0.1, y: 0, w: 0.1, h: 0.1 },
      { x: 0, y: 1.2, w: 0.1, h: 0.1 },
      { x: 0.8, y: 0, w: 0.3, h: 0.1 },
      { x: 0, y: 0, w: 0, h: 0.1 },
      { x: 0, y: 0, w: 0.1 },
      { x: "0", y: 0, w: 0.1, h: 0.1 },
    ]) {
      expect(p({ type: "buddy.point", id: "a", rect, style: "stop" }).ok, JSON.stringify(rect)).toBe(false);
    }
    expect(parseClientMessage('{"type":"buddy.point","id":"a","style":"stop","rect":{"x":1e999,"y":0,"w":0.1,"h":0.1}}').ok).toBe(false);
  });

  it("rejects bad enums, counters, ttl and ids", () => {
    for (const bad of [
      { type: "buddy.state", state: "dancing" },
      { type: "buddy.state" },
      { type: "buddy.say", text: "" },
      { type: "buddy.say", text: 5 },
      { type: "buddy.say", text: "hi", ttl_ms: -1 },
      { type: "buddy.say", text: "hi", ttl_ms: "5" },
      { type: "buddy.point", id: "a", rect: r, style: "wave" },
      { type: "buddy.point", id: "", rect: r, style: "stop" },
      { type: "buddy.point", id: "x".repeat(200), rect: r, style: "stop" },
      { type: "buddy.clear", id: 3 },
      { ...session, mode: "sandbox" },
      { ...session, asked: -1 },
      { ...session, asked: 1.5 },
      { ...session, guardrails: 2_000_000 },
      { ...session, off_record: "yes" },
      { ...session, app_url: 7 },
      { type: "shortcut", action: "end_task" },
    ]) {
      expect(p(bad).ok, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });
});
