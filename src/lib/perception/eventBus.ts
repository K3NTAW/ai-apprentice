// Merged screen event bus (BUILD_SPEC D4: DOM is ground truth). Framework free.
import { newId, type ScreenEvent, type VisionEvent } from "@/lib/types";

export const TWIN_WINDOW_S = 4;
export const DUPLICATE_WINDOW_S = 10;

/** Subscribers get each new event; `replaces` is the id of a vision event it superseded. */
export type BusListener = (event: ScreenEvent, replaces?: string) => void;

type Keyed = Pick<ScreenEvent, "type" | "entity" | "field">;

function sameTwin(a: Keyed, b: Keyed): boolean {
  return a.type === b.type && a.entity.id === b.entity.id && a.field === b.field;
}

export function createEventBus({ now = () => Date.now() / 1000 }: { now?: () => number } = {}) {
  let events: ScreenEvent[] = [];
  const listeners = new Set<BusListener>();
  let paused = false;

  const emit = (ev: ScreenEvent, replaces?: string) => {
    for (const fn of listeners) fn(ev, replaces);
  };

  return {
    publishDom(partial: Omit<ScreenEvent, "id" | "t" | "source">, t: number = now()): ScreenEvent | undefined {
      if (paused) return undefined;
      const ev: ScreenEvent = { ...partial, id: newId("ev"), t, source: "dom" };
      const twins = events.filter(
        (e) => e.source === "vision" && Math.abs(e.t - t) <= TWIN_WINDOW_S && sameTwin(e, ev),
      );
      if (twins.length) events = events.filter((e) => !twins.includes(e));
      events.push(ev);
      emit(ev, twins[0]?.id);
      return ev;
    },

    publishVision(batch: VisionEvent[], t: number = now(), frame_ref?: string): ScreenEvent[] {
      if (paused) return [];
      const out: ScreenEvent[] = [];
      for (const v of batch) {
        const domTwin = events.some(
          (e) => e.source === "dom" && Math.abs(e.t - t) <= TWIN_WINDOW_S && sameTwin(e, v),
        );
        if (domTwin) continue;
        const dup = events.some(
          (e) =>
            e.source === "vision" &&
            t - e.t <= DUPLICATE_WINDOW_S &&
            t >= e.t &&
            sameTwin(e, v) &&
            e.to === v.to,
        );
        if (dup) continue;
        const ev: ScreenEvent = { ...v, id: newId("ev"), t, source: "vision" };
        if (frame_ref) ev.frame_ref = frame_ref;
        events.push(ev);
        out.push(ev);
        emit(ev);
      }
      return out;
    },

    subscribe(fn: BusListener): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    all(): ScreenEvent[] {
      return [...events];
    },

    setPaused(value: boolean) {
      paused = value;
    },

    isPaused(): boolean {
      return paused;
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
