// Tiny typed emitter so the sandbox ERP can emit DOM events without importing the bus.
import type { ScreenEvent } from "@/lib/types";

export type DomEventPartial = Omit<ScreenEvent, "id" | "t" | "source">;

const target = new EventTarget();
const NAME = "dom-event";

export function emitDomEvent(partial: DomEventPartial): void {
  target.dispatchEvent(new CustomEvent<DomEventPartial>(NAME, { detail: partial }));
}

export function onDomEvent(fn: (partial: DomEventPartial) => void): () => void {
  const listener = (e: Event) => fn((e as CustomEvent<DomEventPartial>).detail);
  target.addEventListener(NAME, listener);
  return () => target.removeEventListener(NAME, listener);
}
