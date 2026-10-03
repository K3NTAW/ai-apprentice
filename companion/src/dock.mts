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
export const DOCK_WIDTH = 300;
export const DOCK_TAB_WIDTH = 56;
export const DOCK_HEIGHT_RATIO = 0.6;
export const DOCK_MARGIN = 8;
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
};

export function dockViewModel(i: { state: DockState; session: DockSession | null; mode: BuddyMode; target: PointStyle | null; say: string | null; paused: boolean }): DockView {
  const agent = i.session?.agent;
  return {
    side: i.state.side,
    collapsed: i.state.collapsed,
    avatar: avatarFor(agent?.avatar, avatarState(i.paused ? "paused" : i.mode, i.target)),
    name: agent?.name ?? "AI Apprentice",
    role: agent?.role ?? "",
    say: i.say,
    feed: i.state.feed.map((l) => ({ icon: KIND_ICONS[l.kind], kind: l.kind, text: l.text })),
    asked: i.session?.asked ?? 0,
    guardrails: i.session?.guardrails ?? 0,
    offRecord: i.session?.off_record ?? false,
    paused: i.paused,
  };
}

export type Bounds = { x: number; y: number; width: number; height: number };

export function dockBounds(workArea: Bounds, side: DockSide, collapsed: boolean): Bounds {
  const width = collapsed ? DOCK_TAB_WIDTH : DOCK_WIDTH;
  const height = collapsed ? DOCK_TAB_WIDTH + 2 * DOCK_MARGIN : Math.round(workArea.height * DOCK_HEIGHT_RATIO);
  const y = workArea.y + Math.round((workArea.height - height) / 2);
  const x = side === "right" ? workArea.x + workArea.width - width - DOCK_MARGIN : workArea.x + DOCK_MARGIN;
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
