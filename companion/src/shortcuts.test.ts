import { describe, expect, it } from "vitest";
import { ActivityAggregator, toInputKind } from "./activity.mjs";
import {
  allowedWhilePaused,
  buddyEnabled,
  createKeyUpListener,
  defaultBindings,
  displayAccelerator,
  MAX_HOLD_MS,
  normalizeAccelerator,
  parseSettings,
  releaseKeycode,
  SettingsStore,
  TalkHold,
} from "./shortcuts.mjs";

const KEYS = { Space: 57, A: 30, O: 24, "1": 2, F5: 63 };

function memoryIO(initial: string | null = null) {
  const io = { text: initial, read: () => io.text, write: (t: string) => void (io.text = t) };
  return io;
}

describe("bindings", () => {
  it("defaults to Option on macOS and Alt on Windows", () => {
    expect(defaultBindings("darwin")).toEqual({
      talk: "Option+Space",
      off_record_toggle: "Option+Shift+O",
      end_task: "Option+Shift+E",
      pause_toggle: "Option+Shift+P",
      panel_toggle: "Option+Shift+A",
    });
    expect(defaultBindings("win32")).toEqual({
      talk: "Alt+Space",
      off_record_toggle: "Alt+Shift+O",
      end_task: "Alt+Shift+E",
      pause_toggle: "Alt+Shift+P",
      panel_toggle: "Alt+Shift+A",
    });
    expect(displayAccelerator("Alt+Space", "darwin")).toBe("Option+Space");
    expect(displayAccelerator("Option+Space", "win32")).toBe("Alt+Space");
  });

  it("normalises accelerators and rejects bad ones", () => {
    expect(normalizeAccelerator("shift+alt+k", "darwin")).toBe("Option+Shift+K");
    expect(normalizeAccelerator("Ctrl+Alt+space", "win32")).toBe("Control+Alt+Space");
    expect(normalizeAccelerator("Cmd+F5", "darwin")).toBe("Command+F5");
    for (const bad of ["K", "Space", "Alt+", "Alt+Enter", "Hyper+K", "Cmd+K", "", 5, "Alt+Shift+K+L"]) {
      expect(normalizeAccelerator(bad, "win32"), String(bad)).toBeNull();
    }
  });

  it("persists configurable bindings and rejects clashes", () => {
    const io = memoryIO();
    const store = new SettingsStore(io, "darwin");
    expect(store.setBinding("talk", "Control+Option+Space")).toEqual({ ok: true });
    expect(store.setBinding("end_task", "Option+Shift+O")).toMatchObject({ ok: false });
    expect(store.setBinding("end_task", "nonsense")).toMatchObject({ ok: false });
    store.setBuddyEnabled(false);
    const reloaded = new SettingsStore(io, "darwin");
    expect(reloaded.get().bindings.talk).toBe("Control+Option+Space");
    expect(reloaded.get().bindings.end_task).toBe("Option+Shift+E");
    expect(reloaded.get().buddyEnabled).toBe(false);
    reloaded.resetBindings();
    expect(new SettingsStore(io, "darwin").get().bindings).toEqual(defaultBindings("darwin"));
  });

  it("falls back to defaults for broken, invalid or clashing settings", () => {
    expect(parseSettings("{nope", "win32")).toEqual({ bindings: defaultBindings("win32"), buddyEnabled: true });
    expect(parseSettings('{"bindings":{"talk":"K"}}', "win32").bindings.talk).toBe("Alt+Space");
    expect(parseSettings('{"bindings":{"talk":"Alt+Shift+O"}}', "win32").bindings).toEqual(defaultBindings("win32"));
    const throwing = new SettingsStore({ read: () => { throw new Error("EACCES"); }, write: () => {} }, "darwin");
    expect(throwing.get().bindings).toEqual(defaultBindings("darwin"));
  });

  it("only talk is blocked while paused; COMPANION_BUDDY=0 forces halo-only", () => {
    expect(allowedWhilePaused("pause_toggle")).toBe(true);
    expect(allowedWhilePaused("end_task")).toBe(true);
    expect(allowedWhilePaused("talk")).toBe(false);
    expect(buddyEnabled("0", true)).toBe(false);
    expect(buddyEnabled("off", true)).toBe(false);
    expect(buddyEnabled(undefined, true)).toBe(true);
    expect(buddyEnabled("1", false)).toBe(false);
  });
});

describe("talk hold", () => {
  it("hold detection yields talk_start on press and talk_end on key-up, ignoring key repeat", () => {
    const sent: string[] = [];
    const talk = new TalkHold((a) => sent.push(a), "hold");
    const onKeyUp = createKeyUpListener(() => releaseKeycode("Option+Space", KEYS), () => talk.release());
    talk.press(0);
    talk.press(30);
    onKeyUp({ keycode: KEYS.A });
    expect(sent).toEqual(["talk_start"]);
    onKeyUp({ keycode: KEYS.Space });
    expect(sent).toEqual(["talk_start", "talk_end"]);
    onKeyUp({ keycode: KEYS.Space });
    expect(sent).toEqual(["talk_start", "talk_end"]);
  });

  it("toggle mode (no input hook) starts on one press and ends on the next", () => {
    const sent: string[] = [];
    const talk = new TalkHold((a) => sent.push(a), "toggle");
    talk.press(0);
    talk.release();
    talk.press(100);
    expect(sent).toEqual(["talk_start", "talk_end"]);
  });

  it("safety: cancel (blur, unpair, disconnect, pause, hook stop) and the max hold always send talk_end once", () => {
    const sent: string[] = [];
    const talk = new TalkHold((a) => sent.push(a), "hold");
    talk.press(0);
    talk.cancel();
    talk.cancel();
    expect(sent).toEqual(["talk_start", "talk_end"]);
    talk.press(1_000);
    talk.tick(1_000 + MAX_HOLD_MS - 1);
    expect(talk.isHolding()).toBe(true);
    talk.tick(1_000 + MAX_HOLD_MS);
    expect(sent).toEqual(["talk_start", "talk_end", "talk_start", "talk_end"]);
    talk.press(200_000);
    talk.setMode("toggle");
    expect(sent.at(-1)).toBe("talk_end");
    expect(talk.isHolding()).toBe(false);
  });

  it("maps a binding's key to its uiohook keycode", () => {
    expect(releaseKeycode("Alt+Space", KEYS)).toBe(57);
    expect(releaseKeycode("Alt+Shift+1", KEYS)).toBe(2);
    expect(releaseKeycode("Alt+Shift+Z", KEYS)).toBeNull();
    expect(releaseKeycode("Alt+constructor", KEYS)).toBeNull();
  });
});

describe("keycode boundary", () => {
  it("the activity aggregator never receives keycodes; key-up never reaches it", () => {
    expect(toInputKind("keyup", { keycode: 57 })).toBeNull();
    expect(toInputKind("keydown", { keycode: 57, keychar: 32 })).toBe("key");
    const agg = new ActivityAggregator(0);
    agg.record(toInputKind("keydown", { keycode: 57 })!, 10);
    const msg = agg.flush(500);
    expect(Object.keys(msg).sort()).toEqual(["clicks", "idle_ms", "keys", "pointer", "t", "type", "typing"]);
    expect(JSON.stringify(msg)).not.toContain("57");
  });

  it("the key-up listener forwards nothing but a no-arg release call", () => {
    const calls: unknown[][] = [];
    const listener = createKeyUpListener(() => 57, (...args: unknown[]) => calls.push(args));
    listener({ keycode: 57, rawcode: 49 });
    listener(null);
    listener("x");
    expect(calls).toEqual([[]]);
    expect(createKeyUpListener(() => 57, () => {})({ keycode: 57 })).toBeUndefined();
  });
});
