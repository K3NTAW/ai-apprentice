// Side dock surface and the agent avatar (C1-C3): opacity, CSP, the real renderer's sizes, header, tab and teach buddy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVATAR_STATES, MAX_AVATAR_TOTAL_BYTES, MAX_AVATAR_URL_BYTES, validateAvatarSet } from "./avatarUrl.mjs";
import { routeBridgeMessage, type BridgeHandlers } from "./bridge.mjs";
import { dockLabels, dockViewModel, initialDock, type DockSession } from "./dock.mjs";
import { parseClientMessage } from "./protocol.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const statics = path.join(here, "..", "static");
const read = (f: string) => fs.readFileSync(path.join(statics, f), "utf8");

type Renderer = {
  renderAvatarSet(a: object): Record<string, string>;
  AVATAR_SHAPES: readonly string[];
  AVATAR_FACES: readonly string[];
};
/** The web app's avatar renderer (src/lib/avatar/render.ts, no imports), imported as is. */
const renderer = () => import(pathToFileURL(path.join(here, "..", "..", "src", "lib", "avatar", "render.ts")).href) as Promise<Renderer>;

/** Every shape x face: the set with the largest single state (and the largest total). */
async function largestSets() {
  const r = await renderer();
  let byState = { size: 0, set: {} as Record<string, string> };
  let byTotal = { size: 0, set: {} as Record<string, string> };
  for (const shape of r.AVATAR_SHAPES)
    for (const face of r.AVATAR_FACES) {
      const set = r.renderAvatarSet({ shape, face, color: "#F4A261", accent: "#2A9D8F" });
      const sizes = Object.values(set).map((v) => v.length);
      const max = Math.max(...sizes);
      const total = sizes.reduce((a, b) => a + b, 0);
      if (max > byState.size) byState = { size: max, set };
      if (total > byTotal.size) byTotal = { size: total, set };
    }
  return { byState, byTotal };
}

afterEach(() => vi.restoreAllMocks());

describe("dock surface (C1)", () => {
  const alphaOf = (css: string, selector: string) => {
    const rule = css.slice(css.indexOf(selector)).split("}")[0];
    const m = rule.match(/background:\s*rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
    return { alpha: m ? Number(m[1]) : 0, rule };
  };

  it("the dock reads as a solid light surface: >= .92 alpha, canvas border and shadow", () => {
    const { alpha, rule } = alphaOf(read("dock.css"), ".dock .glass {");
    expect(alpha).toBeGreaterThanOrEqual(0.92);
    expect(rule).toMatch(/border:\s*1px solid var\(--ln\)/);
    expect(rule).toMatch(/box-shadow:[^;]*rgba\(0,0,0,\.22\)/);
  });

  it("the floating panel is >= .92 alpha with and without a material", () => {
    const css = read("panel.css");
    expect(css.match(/\.sheet[^{]*\{[^}]*background:/g)?.length).toBeGreaterThanOrEqual(2);
    for (const m of css.matchAll(/\.sheet[^{]*\{[^}]*background:\s*rgba\([^)]*,\s*([\d.]+)\)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(0.92);
  });

  it("the dock CSP allows img-src data: only", () => {
    const csp = read("dock.html").match(/Content-Security-Policy" content="([^"]+)"/)![1];
    const img = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src"));
    expect(img).toBe("img-src data:");
    expect(csp).toMatch(/default-src 'none'/);
  });
});

describe("avatar sizes from the real renderer (C2)", () => {
  it("the largest state and the largest set pass the validator and session.state parsing, with margin", async () => {
    const { byState, byTotal } = await largestSets();
    expect(byState.size).toBeLessThan(MAX_AVATAR_URL_BYTES / 4);
    expect(byTotal.size).toBeLessThan(MAX_AVATAR_TOTAL_BYTES / 4);
    for (const set of [byState.set, byTotal.set]) {
      expect(Object.keys(set).sort()).toEqual([...AVATAR_STATES].sort());
      expect(validateAvatarSet(set).ok).toBe(true);
      const parsed = parseClientMessage(JSON.stringify({ type: "session.state", mode: "capture", agent: { id: "0b5c-1", name: "Pip", role: "", avatar: set } }));
      expect(parsed.ok && parsed.msg.type === "session.state" && parsed.msg.agent?.avatar.listening).toBe(set.listening);
    }
  });

  it("a dropped avatar logs a warning instead of failing silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h: BridgeHandlers = { log: vi.fn(), onBuddy: vi.fn(), onSession: vi.fn(), onDock: vi.fn() };
    const bad = { type: "session.state", mode: "capture", agent: { id: "a1", name: "Pip", role: "", avatar: { idle: "data:image/png;base64,AAAA" } } };
    expect(routeBridgeMessage(bad, h)).toBe(true);
    expect(h.onSession).toHaveBeenCalledWith(expect.not.objectContaining({ agent: expect.anything() }));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/avatar dropped \(session_avatar_idle\)/));
  });
});

/** Just enough DOM for avatarSrc.js + dock.js. */
function loadDock() {
  const els = new Map<string, Record<string, unknown>>();
  const el = () => {
    const attrs = new Map<string, string>();
    const classes = new Set<string>();
    const e: Record<string, unknown> = {
      dataset: {} as Record<string, string>,
      textContent: "",
      className: "",
      classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      removeAttribute: (k: string) => attrs.delete(k),
      addEventListener: () => {},
      replaceChildren: () => {},
      append: () => {},
    };
    Object.defineProperty(e, "src", { get: () => attrs.get("src") ?? "", set: (v: string) => attrs.set("src", v) });
    return e;
  };
  let onState: (v: unknown) => void = () => {};
  const window: Record<string, unknown> = { companionDock: { onState: (fn: typeof onState) => (onState = fn), collapse: () => {}, action: () => {} } };
  const document = {
    getElementById: (id: string) => els.get(id) ?? (els.set(id, el()), els.get(id)),
    querySelectorAll: () => [],
    createElement: el,
  };
  const ctx = vm.createContext({ window, document, setInterval: () => 0, Date });
  vm.runInContext(read("avatarSrc.js"), ctx);
  vm.runInContext(read("dock.js"), ctx);
  return { push: (v: unknown) => onState(v), byId: (id: string) => document.getElementById(id)! };
}

describe("avatar in the dock header, the collapsed tab and the teach buddy (C2)", () => {
  it("renders the largest real state in the header and the tab, with the animated state", async () => {
    const { byState } = await largestSets();
    const agent = { id: "a1", name: "Pip", role: "Learning from Sabine", avatar: byState.set };
    const session: DockSession = { mode: "capture", title: "Quote", asked: 1, guardrails: 0, off_record: false, agent };
    const dock = loadDock();
    for (const [mode, frame] of [
      ["listening", "listening"],
      ["speaking", "asking"],
    ] as const) {
      for (const collapsed of [false, true]) {
        const view = dockViewModel({ state: { ...initialDock(collapsed) }, session, mode, target: null, say: null, paused: false, startedAt: 1 });
        expect(view.avatar).toBe(byState.set[frame]);
        dock.push(view);
        expect(dock.byId("avatar").src).toBe(byState.set[frame]);
        expect(dock.byId("tab-avatar").src).toBe(byState.set[frame]);
        expect((dock.byId("avatar").dataset as Record<string, string>).state).toBe(frame);
        expect((dock.byId("tab-avatar").dataset as Record<string, string>).state).toBe(frame);
      }
    }
    const css = read("dock.css");
    expect(css).toMatch(/\.avatar\[data-state="listening"\][^{]*\{ animation:/);
    expect(css).toMatch(/\.avatar\[data-state="asking"\][^{]*\{ animation:/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.avatar, \.avatar-sm \{ animation: none/);
  });

  it("teach: the buddy overlay gets the agent's avatar frame", async () => {
    const { byState } = await largestSets();
    const main = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    expect(main).toMatch(/const agent = dockOn && session\?\.mode === "teach" \? session\.agent : undefined;/);
    expect(main).toMatch(/avatarFor\(agent\.avatar, avatarState\(view\.mode/);
    const overlay = read("overlay.js");
    expect(overlay).toContain("setAvatarSrc");
    // The same validator the overlay uses accepts the real frame.
    const ctx = vm.createContext({ window: {} as Record<string, { isAvatarUrl(v: string): boolean }> });
    vm.runInContext(read("avatarSrc.js"), ctx);
    expect((ctx.window as Record<string, { isAvatarUrl(v: string): boolean }>).companionAvatar.isAvatarUrl(byState.set.listening)).toBe(true);
  });
});

describe("dock header and question card (C3)", () => {
  it("state line reads 'listening · quiet while you type', 'thinking', 'asking'", () => {
    const l = (buddy: "listening" | "thinking" | "speaking") => dockLabels({ mode: "capture", buddy, offRecord: false, paused: false }).stateLabel;
    expect([l("listening"), l("thinking"), l("speaking")]).toEqual(["listening · quiet while you type", "thinking", "asking"]);
  });

  it("timer pill, collapse button and the 'answer out loud, or hold ⌃⌥' keycaps", () => {
    const html = read("dock.html");
    expect(html).toMatch(/id="rec-pill"[^]*id="timer"/);
    expect(html).toContain('id="collapse"');
    expect(html).toContain('answer out loud, or hold <kbd class="kc">⌃</kbd><kbd class="kc">⌥</kbd>');
    const dock = loadDock();
    dock.push({ avatar: null, startedAt: Date.now() - 125_000 });
    expect(dock.byId("timer").textContent).toBe("02:05");
    const session: DockSession = { mode: "capture", title: "Q", asked: 0, guardrails: 0, off_record: false };
    expect(dockViewModel({ state: initialDock(), session, mode: "idle", target: null, say: null, paused: false, startedAt: 5 }).startedAt).toBe(5);
    expect(dockViewModel({ state: initialDock(), session: { ...session, mode: null }, mode: "idle", target: null, say: null, paused: false, startedAt: 5 }).startedAt).toBeNull();
  });
});
