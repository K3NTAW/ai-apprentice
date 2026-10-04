// Capture <-> companion transport (one-app D2). Framework free so tests can drive it with a fake transport.
// Activity, app and chord events reach the controller only while a session runs (ctrl() is null otherwise);
// the controller drops them while off the record and keeps chords only in its own linker.
import type { CompanionPermissions, CompanionStatus, ShortcutAction } from "@/lib/companion/client";
import type { CompanionTransport } from "@/lib/companion/transport";
import type { CaptureCompanion, CaptureController } from "./controller";

export type CaptureCompanionTarget = Pick<
  CaptureController,
  "onCompanionActivity" | "onCompanionApp" | "onCompanionChord" | "onCompanionDisconnected"
>;

/** Subscribes Capture to the transport; returns one unsubscribe for all. */
export function bindCaptureTransport(
  t: CompanionTransport,
  h: {
    ctrl(): CaptureCompanionTarget | null;
    onStatus(s: CompanionStatus, perms: CompanionPermissions | null): void;
    onShortcut(a: ShortcutAction): void;
  },
): () => void {
  const offs = [
    t.on("status", (s, perms) => {
      h.onStatus(s, perms);
      if (s !== "paired") h.ctrl()?.onCompanionDisconnected();
    }),
    t.on("activity", (a) => h.ctrl()?.onCompanionActivity(a)),
    t.on("app", (a) => h.ctrl()?.onCompanionApp(a)),
    t.on("shortcut", (a) => h.onShortcut(a)),
    t.on("chord", (c) => h.ctrl()?.onCompanionChord(c)),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** The controller's companion sink. Reads the transport on every call: it may be re-created while a session runs. */
export function captureCompanionSink(t: () => CompanionTransport | null): CaptureCompanion {
  return {
    buddyState: (s) => t()?.buddyState(s) ?? false,
    buddySay: (text, ttl) => t()?.buddySay(text, ttl) ?? false,
    buddyPoint: (p) => t()?.buddyPoint(p) ?? false,
    buddyClear: (id) => t()?.buddyClear(id) ?? false,
    sessionState: (st) => t()?.sessionState(st) ?? false,
    dockShow: (side) => t()?.dockShow(side) ?? false,
    dockHide: () => t()?.dockHide() ?? false,
    dockLearned: (kind, text) => t()?.dockLearned(kind, text) ?? false,
    dockNow: (text, app) => t()?.dockNow(text, app) ?? false,
    dockAck: (text) => t()?.dockAck(text) ?? false,
  };
}
