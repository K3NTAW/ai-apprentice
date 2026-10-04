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

export type PanelMaterial = "vibrancy" | "mica" | "acrylic" | "solid";
export type Surface = "panel" | "dock" | "overlay";

/** Windows 11 22H2: the first build where Electron's backgroundMaterial (mica, acrylic) works. */
export const WIN_MATERIAL_BUILD = 22621;
/** Solid fallback, the canvas glass colour (rgba(251,251,251,.88) on the canvas backdrop) as an opaque window colour. */
export const SOLID_BACKGROUND = "#FBFBFB";

function windowsBuild(systemVersion: string): number {
  const build = Number(String(systemVersion).split(".")[2]);
  return Number.isFinite(build) ? build : 0;
}

/**
 * Native window material per surface. The panel is an opaque frameless window: vibrancy on macOS, Mica on Windows 11 22H2+
 * (build 22621), else solid. The dock and the overlay are transparent windows whose glass and radius are drawn by CSS
 * (a native material fills the whole window rect and would square the dock's 24 px corners and frost the whole overlay),
 * so they stay solid on macOS and older Windows; on Windows 22H2+ the dock gets acrylic, the transient-surface material,
 * behind its CSS glass, with the window bounds equal to the glass rect.
 */
export function surfaceMaterial(surface: Surface, platform: Platform | string, systemVersion: string): PanelMaterial {
  if (surface === "overlay") return "solid";
  const winNative = platform === "win32" && windowsBuild(systemVersion) >= WIN_MATERIAL_BUILD;
  if (surface === "dock") return winNative ? "acrylic" : "solid";
  if (platform === "darwin") return "vibrancy";
  return winNative ? "mica" : "solid";
}

/** The panel's material (kept for callers and tests). */
export function panelMaterial(platform: Platform | string, systemVersion: string): PanelMaterial {
  return surfaceMaterial("panel", platform, systemVersion);
}

/** BrowserWindow options for a material; any window creation error falls back to materialOptions("solid"). */
export function materialOptions(material: PanelMaterial): { vibrancy?: "under-window"; visualEffectState?: "active"; backgroundMaterial?: "mica" | "acrylic"; backgroundColor: string } {
  if (material === "vibrancy") return { vibrancy: "under-window", visualEffectState: "active", backgroundColor: "#00000000" };
  if (material === "mica" || material === "acrylic") return { backgroundMaterial: material, backgroundColor: "#00000000" };
  return { backgroundColor: SOLID_BACKGROUND };
}
