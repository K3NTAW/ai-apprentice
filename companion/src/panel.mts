// Floating panel: pure view model. main.mts feeds it live state; the renderer only sets textContent.
import { checkAppUrl } from "./appUrl.mjs";
import type { Allowlist } from "./origin.mjs";
import { pairingViewModel, type PairingView, type PairingViewInput } from "./pairingWindow.mjs";
import type { SessionStateMessage } from "./protocol.mjs";
import { displayAccelerator, SHORTCUT_ACTIONS, SHORTCUT_LABELS, type Bindings, type Platform, type ShortcutAction } from "./shortcuts.mjs";

/** Panel buttons; each sends the same action as its shortcut. */
export const PANEL_ACTIONS = ["pause_toggle", "off_record_toggle", "end_task"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];

export function isPanelAction(v: unknown): v is PanelAction {
  return typeof v === "string" && (PANEL_ACTIONS as readonly string[]).includes(v);
}

export type PanelInput = PairingViewInput & {
  platform: Platform;
  paused: boolean;
  session: SessionStateMessage | null;
  allowlist: Allowlist;
  bindings: Bindings;
  /** globalShortcut.register failures, keyed by action. */
  registrationErrors: Partial<Record<ShortcutAction, string>>;
  talkMode: "hold" | "toggle";
  buddyEnabled: boolean;
  /** True when COMPANION_BUDDY forces halo-only (the setting cannot turn the buddy back on). */
  buddyForcedOff: boolean;
};

export type PanelView = {
  pairing: PairingView;
  /** Not paired yet: the panel shows the pairing code view first. */
  firstRun: boolean;
  showPermissions: boolean;
  paused: boolean;
  session: {
    modeLabel: string;
    title: string;
    expert: string;
    lastQuestion: string;
    lastAnswer: string;
    asked: number;
    guardrails: number;
    offRecord: boolean;
  };
  actionsEnabled: boolean;
  canOpenControlRoom: boolean;
  shortcuts: { action: ShortcutAction; label: string; accelerator: string; display: string; error: string | null }[];
  talkHint: string;
  buddyEnabled: boolean;
  buddyForcedOff: boolean;
};

const MODE_LABELS = { capture: "Capture", teach: "Teach" } as const;

export function panelViewModel(input: PanelInput): PanelView {
  const pairing = pairingViewModel(input);
  const darwin = input.platform === "darwin";
  const s = input.paired ? input.session : null;
  return {
    pairing: darwin ? pairing : { ...pairing, missing: [] },
    firstRun: !input.paired,
    showPermissions: darwin && pairing.missing.length > 0,
    paused: input.paused,
    session: {
      modeLabel: s?.mode ? MODE_LABELS[s.mode] : "No session",
      title: s?.title ?? "",
      expert: s?.expert ?? "",
      lastQuestion: s?.last_question ?? "",
      lastAnswer: s?.last_answer ?? "",
      asked: s?.asked ?? 0,
      guardrails: s?.guardrails ?? 0,
      offRecord: s?.off_record ?? false,
    },
    actionsEnabled: input.paired,
    canOpenControlRoom: s !== null && checkAppUrl(s.app_url, input.allowlist).ok,
    shortcuts: SHORTCUT_ACTIONS.map((action) => ({
      action,
      label: SHORTCUT_LABELS[action],
      accelerator: input.bindings[action],
      display: displayAccelerator(input.bindings[action], input.platform),
      error: input.registrationErrors[action] ?? null,
    })),
    talkHint:
      input.talkMode === "hold"
        ? "Hold to talk, release to stop."
        : darwin
          ? "Input Monitoring is off: press once to talk, again to stop."
          : "Key release is not available: press once to talk, again to stop.",
    buddyEnabled: input.buddyEnabled,
    buddyForcedOff: input.buddyForcedOff,
  };
}

export type PanelMaterial = "vibrancy" | "mica" | "solid";

/** Vibrancy on macOS, Mica on Windows 11 22H2+ (build 22621, where Electron's backgroundMaterial works), else solid. */
export function panelMaterial(platform: Platform, systemVersion: string): PanelMaterial {
  if (platform === "darwin") return "vibrancy";
  if (platform === "win32") {
    const build = Number(systemVersion.split(".")[2]);
    return Number.isFinite(build) && build >= 22621 ? "mica" : "solid";
  }
  return "solid";
}
