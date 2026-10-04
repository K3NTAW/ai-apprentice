// Pairing window and terminal line: pure view model and formatters. main.mts feeds it live state.
import type { Permissions } from "./protocol.mjs";

export type PermissionKey = "accessibility" | "input" | "screen";

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; button: string }> = {
  accessibility: { label: "Accessibility", button: "Open Accessibility settings" },
  input: { label: "Input Monitoring", button: "Open Input Monitoring settings" },
  screen: { label: "Screen Recording (window titles)", button: "Open Screen Recording settings" },
};

const ORDER: PermissionKey[] = ["accessibility", "input", "screen"];

export function isPermissionKey(v: unknown): v is PermissionKey {
  return typeof v === "string" && (ORDER as string[]).includes(v);
}

/** '123456' -> '123 456'. Anything that is not 6 digits is returned unchanged. */
export function splitCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** The one stdout line printed on launch and whenever the code rotates. */
export function formatPairingLine(code: string): string {
  return `[companion] pairing code: ${splitCode(code)} (enter it in the web app)`;
}

export type PairingViewInput = {
  code: string;
  paired: boolean;
  permissions: Pick<Permissions, PermissionKey>;
  serverError?: string | null;
};

export type PairingView = {
  code: string;
  paired: boolean;
  stateText: string;
  missing: { key: PermissionKey; label: string; button: string }[];
};

/** Permissions not granted yet, in a fixed order, with their settings button labels. */
export function missingPermissions(permissions: Pick<Permissions, PermissionKey>): { key: PermissionKey; label: string; button: string }[] {
  return ORDER.filter((k) => !permissions[k]).map((key) => ({ key, ...PERMISSION_LABELS[key] }));
}

export function pairingViewModel(input: PairingViewInput): PairingView {
  const stateText = input.serverError ? `Error: ${input.serverError}` : input.paired ? "Paired with web app" : "Not paired";
  return {
    code: splitCode(input.code),
    paired: input.paired,
    stateText,
    missing: missingPermissions(input.permissions),
  };
}
