"use client";

// Clicky-style pointer (docs/BUILD_SPEC.md D2, Teach only): a ring and a label bubble over a data-erp-field element.
// Fixed overlay, recomputed on resize and scroll, never takes pointer events.
import { useEffect, useState } from "react";

export type HaloProps = { field: string | null; label?: string };

type Box = { field: string; top: number; left: number; width: number; height: number };

export default function Halo({ field, label }: HaloProps) {
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!field) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-erp-field="${CSS.escape(field)}"]`);
        if (!el) return setBox(null);
        const r = el.getBoundingClientRect();
        setBox({ field, top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    // The ERP re-renders under us (banner appears, layout shifts), so also poll lightly.
    const poll = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(poll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [field]);

  if (!field || !box || box.field !== field) return null;
  const pad = 6;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      <div
        className="absolute animate-pulse rounded-md border-[3px] border-rose-500 shadow-[0_0_0_6px_rgba(244,63,94,0.25)] transition-all duration-300"
        style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
      />
      {label && (
        <div
          className="absolute max-w-xs rounded-lg bg-rose-600 px-2 py-1 text-xs font-medium text-white shadow-lg transition-all duration-300"
          style={{ top: Math.max(4, box.top - pad - 30), left: box.left - pad }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
