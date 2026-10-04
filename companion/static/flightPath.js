// Dotted flight path for the cursor buddy: pure geometry, no DOM. Loaded before overlay.js; tested in src/flightPath.test.ts.
"use strict";
(function (root) {
  const MAX_POINTS = 48;
  const fin = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  /** Points on the quadratic flight curve from -> ctrl -> to, capped at MAX_POINTS and clamped to this display's window. */
  function flightPoints(from, ctrl, to, count, bounds) {
    const n = clamp(Math.floor(fin(count)) || 2, 2, MAX_POINTS);
    const w = Math.max(0, fin(bounds && bounds.width));
    const h = Math.max(0, fin(bounds && bounds.height));
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = 1 - t;
      const x = a * a * fin(from.x) + 2 * a * t * fin(ctrl.x) + t * t * fin(to.x);
      const y = a * a * fin(from.y) + 2 * a * t * fin(ctrl.y) + t * t * fin(to.y);
      out.push({ x: Math.round(clamp(x, 0, w) * 10) / 10, y: Math.round(clamp(y, 0, h) * 10) / 10 });
    }
    return out;
  }

  /** SVG path data ("M x y L x y ..."); empty for fewer than two points. */
  function pathData(points) {
    if (!Array.isArray(points) || points.length < 2) return "";
    return points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  }

  /** The path shows only while a flight is running, the buddy is on this display, motion is allowed and capture is on. */
  function showPath(o) {
    return !!(o && o.flying && o.visible && !o.reducedMotion && !o.paused && !o.offRecord);
  }

  root.companionPath = Object.freeze({ MAX_POINTS, flightPoints, pathData, showPath });
})(typeof window !== "undefined" ? window : globalThis);
