// T-0240 (protocol v4): dock.now live line, dock.ack chip, 'noticed something', nothing off the record or paused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ACK_TTL_MS, NOTICED_MS, dockViewModel, initialDock, reduceDock, type DockSession, type DockState } from "./dock.mjs";
import { PROTOCOL_VERSION, isDockMessage, parseClientMessage } from "./protocol.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(here, "..", "static", f), "utf8");
const parse = (m: object) => parseClientMessage(JSON.stringify(m));
const session: DockSession = { mode: "capture", title: "Quote", asked: 0, guardrails: 0, off_record: false };
const view = (state: DockState, over: { session?: DockSession; paused?: boolean; nowMs?: number; mode?: "listening" | "thinking" } = {}) =>
  dockViewModel({ state, session: over.session ?? session, mode: over.mode ?? "listening", target: null, say: null, paused: over.paused ?? false, nowMs: over.nowMs ?? 1000 });

/** Minimal DOM for dock.js; text only via textContent, hidden via the 'hidden' class. */
function loadDock() {
  const els = new Map<string, Record<string, unknown>>();
  const el = () => {
    const classes = new Set<string>();
    return {
      dataset: {},
      textContent: "",
      className: "",
      classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) },
      setAttribute: () => {},
      addEventListener: () => {},
      replaceChildren: () => {},
      append: () => {},
    } as Record<string, unknown>;
  };
  let onState: (v: unknown) => void = () => {};
  const window = { companionDock: { onState: (fn: typeof onState) => (onState = fn), collapse: () => {}, action: () => {} }, companionAvatar: { setAvatarSrc: () => {} } };
  const document = { getElementById: (id: string) => els.get(id) ?? (els.set(id, el()), els.get(id)!), querySelectorAll: () => [], createElement: el };
  vm.runInContext(read("dock.js"), vm.createContext({ window, document, setInterval: () => 0, Date }));
  const hidden = (id: string) => (document.getElementById(id).classList as { contains(c: string): boolean }).contains("hidden");
  return { push: (v: unknown) => onState(v), text: (id: string) => document.getElementById(id).textContent, hidden };
}

describe("protocol v4: dock.now and dock.ack", () => {
  it("bumps the protocol to 4 and validates both messages", () => {
    expect(PROTOCOL_VERSION).toBe(4);
    expect(parse({ type: "dock.now", text: " changed cost center ", app: "Excel" })).toEqual({ ok: true, msg: { type: "dock.now", text: "changed cost center", app: "Excel" } });
    expect(parse({ type: "dock.now", text: "" })).toEqual({ ok: true, msg: { type: "dock.now", text: "" } });
    expect(parse({ type: "dock.now", text: "x".repeat(121) })).toMatchObject({ ok: false, reason: "now_text" });
    expect(parse({ type: "dock.now", text: "a", app: 5 })).toMatchObject({ ok: false, reason: "now_app" });
    expect(parse({ type: "dock.ack", text: "got it" })).toEqual({ ok: true, msg: { type: "dock.ack", text: "got it" } });
    expect(parse({ type: "dock.ack", text: "x".repeat(41) })).toMatchObject({ ok: false });
    expect(parse({ type: "dock.ack", text: " " })).toMatchObject({ ok: false });
    const ok = parse({ type: "dock.ack", text: "got it" });
    expect(ok.ok && isDockMessage(ok.msg)).toBe(true);
  });
});

describe("dock live line and ack chip", () => {
  it("dock.now updates the live line with the app prefix and shows 'noticed something' briefly", () => {
    let s = reduceDock(initialDock(), { type: "now", text: "changed cost center 4711 to 0400", app: "Excel", at: 1000 });
    expect(view(s).now).toBe("Excel · changed cost center 4711 to 0400");
    expect(view(s).stateLabel).toBe("noticed something");
    expect(view(s, { nowMs: 1000 + NOTICED_MS }).stateLabel).toBe("listening · quiet while you type");
    expect(view(s, { mode: "thinking" }).stateLabel).toBe("thinking");
    s = reduceDock(s, { type: "now", text: "forwarded to controller", app: "Outlook", at: 2000 });
    expect(view(s, { nowMs: 2000 }).now).toBe("Outlook · forwarded to controller");
    expect(view(reduceDock(s, { type: "now", text: "", at: 3000 })).now).toBeNull();
  });

  it("dock.ack shows a short chip that expires", () => {
    const s = reduceDock(initialDock(), { type: "ack", text: "got it", at: 1000 });
    expect(view(s, { nowMs: 1500 }).ack).toBe("got it");
    expect(view(s, { nowMs: 1000 + ACK_TTL_MS }).ack).toBeNull();
  });

  it("nothing while off the record or paused; cleared on session end", () => {
    let s = reduceDock(initialDock(), { type: "now", text: "x", at: 1000 });
    s = reduceDock(s, { type: "ack", text: "got it", at: 1000 });
    expect(view(s, { session: { ...session, off_record: true } })).toMatchObject({ now: null, ack: null, stateLabel: "paused · off the record" });
    expect(view(s, { paused: true })).toMatchObject({ now: null, ack: null });
    s = reduceDock(s, { type: "session", key: "k1" });
    s = reduceDock(s, { type: "now", text: "y", at: 1000 });
    expect(reduceDock(s, { type: "session", key: null })).toMatchObject({ now: null, ack: null });
  });

  it("the learned feed keeps narration and answer lines", () => {
    let s = reduceDock(initialDock(), { type: "learned", kind: "step", text: "4711 is closed for capex" });
    s = reduceDock(s, { type: "learned", kind: "step", text: "invoice 4471: budget owner said so" });
    expect(view(s).feed.map((l) => l.text)).toEqual(["4711 is closed for capex", "invoice 4471: budget owner said so"]);
  });

  it("dock.js renders the live line and the chip, and hides both off the record", () => {
    expect(read("dock.html")).toMatch(/id="now"[^]*id="now-text"/);
    expect(read("dock.html")).toContain('id="ack"');
    const dock = loadDock();
    dock.push({ now: "Excel · changed cost center 4711 to 0400", ack: "got it", offRecord: false });
    expect(dock.text("now-text")).toBe("Excel · changed cost center 4711 to 0400");
    expect(dock.hidden("now")).toBe(false);
    expect(dock.text("ack")).toBe("got it");
    expect(dock.hidden("ack")).toBe(false);
    dock.push({ now: "Excel · x", ack: "got it", offRecord: true });
    expect(dock.hidden("now")).toBe(true);
    expect(dock.hidden("ack")).toBe(true);
    dock.push({ now: null, ack: null, offRecord: false });
    expect(dock.hidden("now")).toBe(true);
  });
});
