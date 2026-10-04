// Side dock (protocol v3): pure state, mode rules, view model and bounds. Electron-free.
//
// Rules:
// - The dock lives on the PRIMARY display's work area, docked to the right (default) or left edge,
//   300 px wide and 60% of the work area height, vertically centred; collapsed it is a 56 px avatar tab.
// - Visible only while paired, dock enabled (COMPANION_DOCK), mode is not 'teach', and either
//   mode is 'capture' and the page did not send dock.hide, or the page sent dock.show.
//   dock.show / dock.hide are page overrides that last until the next session (session key change).
// - Cursor buddy: hidden while the dock is visible or the mode is 'capture'; otherwise as in v2.
//   With COMPANION_DOCK=0 everything is v2 (no dock, orb buddy).
// - Feed: the last FEED_MAX 'What I learned' lines; a line equal (kind and text) to one already in
//   the feed is dropped. Reset on a new session (agent id, mode or title change) and on unpair.
// - Collapse state persists in dock.json in userData.
import { avatarFor, type AvatarSet, type AvatarState } from "./avatarUrl.mjs";
import type { BuddyMode, PointStyle } from "./buddy.mjs";

export const DOCK_SIDES = ["right", "left"] as const;
export type DockSide = (typeof DOCK_SIDES)[number];
export const LEARNED_KINDS = ["step", "shortcut", "guardrail"] as const;
export type LearnedKind = (typeof LEARNED_KINDS)[number];
export const MAX_LEARNED_TEXT = 140;
export const FEED_MAX = 8;
// Sizes from Dock.dc.html: 340 px wide, 12 px off the edge, 24 px radius drawn by CSS inside a transparent window
// (the window bounds equal the glass rect, so no native corner shows). The collapsed tab is 56 x 196, flush with the edge.
export const DOCK_WIDTH = 340;
export const DOCK_TAB_WIDTH = 56;
export const DOCK_TAB_HEIGHT = 196;
export const DOCK_HEIGHT_RATIO = 0.6;
export const DOCK_MARGIN = 12;
export const DOCK_RADIUS = 24;
export const KIND_ICONS: Record<LearnedKind, string> = { step: "→", shortcut: "⌘", guardrail: "⚠" };

export type LearnedLine = { kind: LearnedKind; text: string };
export type DockState = {
  side: DockSide;
  page: "auto" | "show" | "hide";
  collapsed: boolean;
  feed: LearnedLine[];
  sessionKey: string | null;
};

export type DockAction =
  | { type: "show"; side: DockSide }
  | { type: "hide" }
  | { type: "learned"; kind: LearnedKind; text: string }
  | { type: "collapse"; collapsed: boolean }
  | { type: "session"; key: string | null }
  | { type: "reset" };

export type DockAgent = { id: string; name: string; role: string; avatar: AvatarSet };
export type DockSession = {
  mode: "capture" | "teach" | null;
  title: string;
  asked: number;
  guardrails: number;
  off_record: boolean;
  agent?: DockAgent;
};

export const initialDock = (collapsed = false): DockState => ({ side: "right", page: "auto", collapsed, feed: [], sessionKey: null });

/** Identity of a session for feed resets: null while there is no session. */
export function sessionKey(s: DockSession | null): string | null {
  if (!s || s.mode === null) return null;
  return JSON.stringify([s.agent?.id ?? "", s.mode, s.title]);
}

export function reduceDock(s: DockState, a: DockAction): DockState {
  switch (a.type) {
    case "show":
      return { ...s, page: "show", side: a.side };
    case "hide":
      return { ...s, page: "hide" };
    case "learned": {
      if (s.feed.some((l) => l.kind === a.kind && l.text === a.text)) return s;
      return { ...s, feed: [...s.feed, { kind: a.kind, text: a.text }].slice(-FEED_MAX) };
    }
    case "collapse":
      return s.collapsed === a.collapsed ? s : { ...s, collapsed: a.collapsed };
    case "session":
      if (a.key === s.sessionKey) return s;
      if (a.key === null) return { ...s, sessionKey: null };
      return { ...s, sessionKey: a.key, feed: [], page: "auto" };
    case "reset":
      return { ...s, feed: [], page: "auto", sessionKey: null };
  }
}

/** Which surface shows: the side dock, the cursor buddy, both off or (v2) buddy only. */
export function surfaces(o: { dockEnabled: boolean; paired: boolean; mode: DockSession["mode"]; page: DockState["page"] }): { dock: boolean; buddy: boolean } {
  if (!o.dockEnabled) return { dock: false, buddy: true };
  const dock = o.paired && o.mode !== "teach" && (o.page === "show" || (o.page === "auto" && o.mode === "capture"));
  return { dock, buddy: !dock && o.mode !== "capture" };
}

/** buddy.state to avatar state; a 'stop' point shows the 'stop' frame (also while it flies). */
export function avatarState(mode: BuddyMode, target: PointStyle | null): AvatarState {
  if (target === "stop") return "stop";
  return mode === "speaking" ? "talking" : mode;
}

export type DockView = {
  side: DockSide;
  collapsed: boolean;
  avatar: string | null;
  name: string;
  role: string;
  say: string | null;
  feed: { icon: string; kind: LearnedKind; text: string }[];
  asked: number;
  guardrails: number;
  offRecord: boolean;
  paused: boolean;
  /** Lowercase canvas copy, e.g. "ai apprentice · training". User content (name, role, feed) is never transformed. */
  header: string;
  stateLabel: string;
  recLabel: string;
  /** Frame shown in the header and the tab; dock.js animates 'listening' and 'asking'. */
  avatarState: AvatarState;
  /** Session start (epoch ms) for the timer pill; null outside a session. */
  startedAt: number | null;
};

const MODE_HEADER = { capture: "training", teach: "teaching" } as const;
const STATE_LABELS: Record<BuddyMode, string> = {
  idle: "watching · quiet while you type",
  listening: "listening · quiet while you type",
  thinking: "thinking",
  // In the dock the agent speaks to ask (Dock.dc.html: 'asking').
  speaking: "asking",
  paused: "paused",
};

/** Header, state line and recording pill copy for the dock (Dock.dc.html). */
export function dockLabels(i: { mode: DockSession["mode"]; buddy: BuddyMode; offRecord: boolean; paused: boolean }): { header: string; stateLabel: string; recLabel: string } {
  const header = i.mode ? `ai apprentice · ${MODE_HEADER[i.mode]}` : "ai apprentice";
  if (i.offRecord) return { header, stateLabel: "paused · off the record", recLabel: "off" };
  if (i.paused) return { header, stateLabel: STATE_LABELS.paused, recLabel: "paused" };
  return { header, stateLabel: STATE_LABELS[i.buddy] ?? STATE_LABELS.idle, recLabel: i.mode ? "rec" : "on" };
}

/** Dock frame: like avatarState, but speaking is the 'asking' frame (the dock agent only speaks to ask). */
export function dockAvatarState(mode: BuddyMode, target: PointStyle | null): AvatarState {
  const s = avatarState(mode, target);
  return s === "talking" ? "asking" : s;
}

export function dockViewModel(i: {
  state: DockState;
  session: DockSession | null;
  mode: BuddyMode;
  target: PointStyle | null;
  say: string | null;
  paused: boolean;
  startedAt?: number | null;
}): DockView {
  const agent = i.session?.agent;
  const frame = dockAvatarState(i.paused ? "paused" : i.mode, i.target);
  return {
    side: i.state.side,
    collapsed: i.state.collapsed,
    // An agent without an 'asking' frame shows its 'talking' frame (then idle).
    avatar: frame === "asking" ? (agent?.avatar.asking ?? avatarFor(agent?.avatar, "talking")) : avatarFor(agent?.avatar, frame),
    avatarState: frame,
    startedAt: i.session?.mode ? (i.startedAt ?? null) : null,
    name: agent?.name ?? "AI Apprentice",
    role: agent?.role ?? "",
    say: i.say,
    feed: i.state.feed.map((l) => ({ icon: KIND_ICONS[l.kind], kind: l.kind, text: l.text })),
    asked: i.session?.asked ?? 0,
    guardrails: i.session?.guardrails ?? 0,
    offRecord: i.session?.off_record ?? false,
    paused: i.paused,
    ...dockLabels({ mode: i.session?.mode ?? null, buddy: i.mode, offRecord: i.session?.off_record ?? false, paused: i.paused }),
  };
}

export type Bounds = { x: number; y: number; width: number; height: number };

export function dockBounds(workArea: Bounds, side: DockSide, collapsed: boolean): Bounds {
  const width = collapsed ? DOCK_TAB_WIDTH : DOCK_WIDTH;
  const height = collapsed ? Math.min(DOCK_TAB_HEIGHT, workArea.height) : Math.round(workArea.height * DOCK_HEIGHT_RATIO);
  const margin = collapsed ? 0 : DOCK_MARGIN;
  const y = workArea.y + Math.round((workArea.height - height) / 2);
  const x = side === "right" ? workArea.x + workArea.width - width - margin : workArea.x + margin;
  return { x, y, width, height };
}

/** dock.json: only the collapse state. Broken or missing means expanded. */
export function parseDockPrefs(raw: string | null): { collapsed: boolean } {
  try {
    const d: unknown = raw ? JSON.parse(raw) : null;
    return { collapsed: typeof d === "object" && d !== null && (d as Record<string, unknown>).collapsed === true };
  } catch {
    return { collapsed: false };
  }
}

export const serializeDockPrefs = (p: { collapsed: boolean }): string => JSON.stringify({ collapsed: p.collapsed === true });

/** Rollback switch: COMPANION_DOCK=0|off|false|no means no dock and the v2 orb buddy. */
export function dockEnabled(env: string | undefined): boolean {
  return !(env !== undefined && /^(0|off|false|no)$/i.test(env.trim()));
}
