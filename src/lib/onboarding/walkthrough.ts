// 'How training works' cards. Illustrations follow docs/design/canvas/Dock.dc.html, OffRecord.dc.html and
// Buddy.dc.html. The chords are the desktop app's default bindings (companion/src/shortcuts.mts defaultBindings,
// macOS); walkthrough.test.ts fails when they drift.
export const DEFAULT_CHORDS = { off_record_toggle: "Option+Shift+O", end_task: "Option+Shift+E" } as const;

const GLYPHS: Record<string, string> = { Option: "⌥", Shift: "⇧", Cmd: "⌘", Ctrl: "⌃", Space: "Space" };
/** 'Option+Shift+O' -> '⌥⇧O'. */
export const chordGlyphs = (binding: string) => binding.split("+").map((p) => GLYPHS[p] ?? p).join("");

export type WalkthroughArt = "dock" | "quiet" | "offrecord" | "end" | "buddy";
export type WalkthroughCard = { art: WalkthroughArt; title: string; body: string };

export const WALKTHROUGH: WalkthroughCard[] = [
  { art: "dock", title: "The agent docks at the side and listens", body: "Start a training and the agent sits at the edge of your screen while you do the task as usual." },
  { art: "quiet", title: "It stays quiet while you type", body: "No interruptions mid-sentence. It asks its questions at natural pauses, and you answer by voice or text." },
  {
    art: "offrecord",
    title: "Off the record whenever you need",
    body: `Press ${chordGlyphs(DEFAULT_CHORDS.off_record_toggle)} or the Off the record button. Nothing is captured until you turn it back on.`,
  },
  {
    art: "end",
    title: "End with a short debrief",
    body: `Press ${chordGlyphs(DEFAULT_CHORDS.end_task)} when the task is done. The agent plays back what it learned and you confirm or correct it.`,
  },
  { art: "buddy", title: "Then it teaches with the cursor buddy", body: "Learners get the agent next to their cursor. It points at the next step and explains why." },
];
