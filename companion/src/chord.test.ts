import { describe, expect, it } from "vitest";
import { chordsEnabled, classifyChord, createChordListener, type ChordGates, type KeyEvent } from "./chord.mjs";
import { chordMessage } from "./protocol.mjs";
import { defaultBindings } from "./shortcuts.mjs";

function gates(over: Partial<ChordGates> = {}): ChordGates {
  return {
    enabled: true,
    paired: true,
    paused: false,
    offRecord: false,
    buddyPaused: false,
    secureInput: () => false,
    platform: "darwin",
    ownBindings: Object.values(defaultBindings("darwin")),
    ...over,
  };
}

const k = (key: string, mods: string = ""): KeyEvent => ({
  key,
  meta: mods.includes("m"),
  ctrl: mods.includes("c"),
  alt: mods.includes("a"),
  shift: mods.includes("s"),
});

describe("chord classifier table", () => {
  const table: [string, KeyEvent, ChordGates, string | null][] = [
    ["Cmd+Shift+T", k("T", "ms"), gates(), "Cmd+Shift+T"],
    ["Ctrl+C", k("C", "c"), gates({ platform: "win32" }), "Ctrl+C"],
    ["Alt+F4", k("F4", "a"), gates({ platform: "win32" }), "Alt+F4"],
    ["Option+F4 on macOS", k("F4", "a"), gates(), "Option+F4"],
    ["F5", k("F5"), gates(), "F5"],
    ["Cmd+Enter", k("Enter", "m"), gates(), "Cmd+Enter"],
    ["Ctrl+Tab", k("Tab", "c"), gates({ platform: "win32" }), "Ctrl+Tab"],
    ["Shift+A", k("A", "s"), gates(), null],
    ["a", k("A"), gates(), null],
    ["1", k("1"), gates(), null],
    ["Enter", k("Enter"), gates(), null],
    ["Shift+Enter", k("Enter", "s"), gates(), null],
    ["Escape", k("Escape"), gates(), null],
    ["Space", k("Space"), gates(), null],
    ["Comma", k("Comma"), gates(), null],
    ["Option+G types @ on macOS", k("G", "a"), gates(), null],
    ["AltGr+2 types @ on Windows", k("2", "ca"), gates({ platform: "win32" }), null],
    ["Win+L is not a protocol modifier", k("L", "m"), gates({ platform: "win32" }), null],
    ["modifier alone", k("Meta", "m"), gates(), null],
  ];
  for (const [name, ev, g, want] of table) {
    it(name, () => expect(classifyChord(ev, g)).toBe(want));
  }
});

describe("chord gates", () => {
  const ev = k("T", "ms");
  it("emits nothing while paused, off the record, buddy paused, unpaired or switched off", () => {
    for (const over of [{ paused: true }, { offRecord: true }, { buddyPaused: true }, { paired: false }, { enabled: false }]) {
      expect(classifyChord(ev, gates(over))).toBeNull();
    }
    expect(classifyChord(ev, gates())).toBe("Cmd+Shift+T");
  });

  it("emits nothing during secure input, and a throwing check counts as secure", () => {
    expect(classifyChord(ev, gates({ secureInput: () => true }))).toBeNull();
    expect(classifyChord(k("F5"), gates({ secureInput: () => true }))).toBeNull();
    expect(
      classifyChord(
        ev,
        gates({
          secureInput: () => {
            throw new Error("unavailable");
          },
        }),
      ),
    ).toBeNull();
    expect(classifyChord(ev, gates({ secureInput: () => false }))).toBe("Cmd+Shift+T");
  });

  it("without a secure input check only Cmd/Ctrl/Alt chords are emitted", () => {
    expect(classifyChord(k("F5"), gates({ secureInput: null }))).toBeNull();
    expect(classifyChord(k("F5", "c"), gates({ secureInput: null }))).toBe("Ctrl+F5");
    expect(classifyChord(ev, gates({ secureInput: null }))).toBe("Cmd+Shift+T");
  });

  it("never emits the companion's own bindings", () => {
    expect(classifyChord(k("O", "as"), gates())).toBeNull();
    expect(classifyChord(k("Space", "a"), gates())).toBeNull();
    expect(classifyChord(k("A", "as"), gates())).toBeNull();
    const win = gates({ platform: "win32", ownBindings: Object.values(defaultBindings("win32")) });
    expect(classifyChord(k("O", "as"), win)).toBeNull();
    expect(classifyChord(k("E", "as"), win)).toBeNull();
    expect(classifyChord(k("X", "as"), win)).toBe("Alt+Shift+X");
  });
});

describe("chord listener", () => {
  const table = { T: 20, A: 30, Meta: 3675, Shift: 42, F5: 63 };
  it("maps keycode and modifier flags to a chord and keeps nothing", () => {
    const out: string[] = [];
    const listen = createChordListener(table, () => gates(), (c) => out.push(c));
    listen({ keycode: 20, metaKey: true, shiftKey: true, ctrlKey: false, altKey: false, keychar: "t" });
    listen({ keycode: 30, shiftKey: true });
    listen({ keycode: 30 });
    listen({ keycode: 9999, metaKey: true });
    listen(null);
    listen({ keycode: 63 });
    expect(out).toEqual(["Cmd+Shift+T", "F5"]);
  });

  it("builds the protocol v3 chord message", () => {
    expect(chordMessage(5, "Cmd+Shift+T", "Microsoft Outlook")).toEqual({ type: "chord", t: 5, chord: "Cmd+Shift+T", app: "Microsoft Outlook" });
  });

  it("parses COMPANION_CHORDS", () => {
    expect(chordsEnabled(undefined)).toBe(true);
    expect(chordsEnabled("0")).toBe(false);
    expect(chordsEnabled("off")).toBe(false);
    expect(chordsEnabled("1")).toBe(true);
  });
});
