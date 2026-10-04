// Animation scheduler for the overlay: requestAnimationFrame runs only while step() reports motion.
// No DOM. Loaded before overlay.js; tested in src/scheduler.test.ts.
"use strict";
(function (root) {
  /** step(now) returns true while something still moves; wake() starts the loop again (a new view, point or cursor). */
  function createScheduler(raf, step) {
    let queued = false;
    function frame(now) {
      queued = false;
      if (step(now)) wake();
    }
    function wake() {
      if (queued) return;
      queued = true;
      raf(frame);
    }
    return Object.freeze({ wake, running: () => queued });
  }

  /** Easing toward the goal is done once the buddy is within half a pixel. */
  function settled(pos, goal) {
    return !pos || !goal || (Math.abs(goal.x - pos.x) < 0.5 && Math.abs(goal.y - pos.y) < 0.5);
  }

  root.companionScheduler = Object.freeze({ createScheduler, settled });
})(typeof window !== "undefined" ? window : globalThis);
