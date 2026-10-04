"use client";

// Top layer for popovers and dialogs: on the client, children render in a portal on document.body, so no ancestor's
// overflow (the sidebar scrolls) or stacking context (cards) can clip or cover them. The server render and hydration
// keep them inline (same markup, no mismatch) and move them to the portal right after; content mounted later on the
// client (a dialog) goes straight into the portal and mounts once, so autoFocus lands on the element that stays.
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Above every page layer (cards, sticky sidebar, the command palette's z-40). */
export const LAYER_Z = 100;

const noop = () => () => {};

export function Layer({ children }: { children: ReactNode }) {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return client ? createPortal(children, document.body) : <>{children}</>;
}
