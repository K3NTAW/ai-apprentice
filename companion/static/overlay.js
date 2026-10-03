// Overlay renderer: buddy, caption bubble, halos. Text is only ever set via textContent.
// Rects arrive already mapped to window DIP; the cursor arrives window-local or null (not on this display).
"use strict";
const root = document.getElementById("root");
const buddyEl = document.getElementById("buddy");
const sayEl = document.getElementById("say");
const px = (n) => `${Number(n) || 0}px`;
const OFFSET = 18;
const FLY_MS = 400;
const MODES = ["idle", "listening", "thinking", "speaking", "paused"];

let view = { buddy: false, mode: "idle", say: null, target: null, halos: [] };
let cursor = null;
let pos = null;
let flight = null;
let targetKey = null;

function drawHalos(halos) {
  root.replaceChildren();
  for (const h of Array.isArray(halos) ? halos : []) {
    const box = document.createElement("div");
    box.className = "halo";
    box.style.left = px(h.rect.x);
    box.style.top = px(h.rect.y);
    box.style.width = px(h.rect.w);
    box.style.height = px(h.rect.h);
    root.appendChild(box);
    if (typeof h.text === "string" && h.text) {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = h.text;
      bubble.style.left = px(h.rect.x);
      const below = h.rect.y + h.rect.h + 10;
      if (below + 80 < window.innerHeight) bubble.style.top = px(below);
      else bubble.style.bottom = px(window.innerHeight - h.rect.y + 10);
      root.appendChild(bubble);
    }
  }
}

/** Where the buddy wants to be: next to the target rect, else next to the cursor, else nowhere. */
function goal() {
  if (view.target) return { x: view.target.rect.x - 10, y: view.target.rect.y - 10 };
  if (cursor) return { x: cursor.x + OFFSET, y: cursor.y + OFFSET };
  return null;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function startFlight(to) {
  if (!pos) {
    pos = to;
    return;
  }
  // Quadratic curve with the control point lifted off the straight line.
  const mx = (pos.x + to.x) / 2;
  const my = (pos.y + to.y) / 2 - Math.min(160, Math.hypot(to.x - pos.x, to.y - pos.y) / 3);
  flight = { from: { ...pos }, ctrl: { x: mx, y: my }, to, start: performance.now() };
}

function placeBubble() {
  if (!view.buddy || !view.say || !pos) {
    sayEl.classList.add("hidden");
    return;
  }
  sayEl.classList.remove("hidden");
  const w = sayEl.offsetWidth;
  const h = sayEl.offsetHeight;
  // Right-below the buddy, flipped left/up at the display edge; the buddy already sits off the hotspot.
  let x = pos.x + 14;
  let y = pos.y + 14;
  if (x + w > window.innerWidth) x = pos.x - 14 - w;
  if (y + h > window.innerHeight) y = pos.y - 14 - h;
  sayEl.style.left = px(Math.max(0, x));
  sayEl.style.top = px(Math.max(0, y));
}

function frame(now) {
  const g = goal();
  if (!view.buddy || !g) {
    buddyEl.classList.add("hidden");
    pos = null;
    flight = null;
  } else {
    buddyEl.classList.remove("hidden");
    if (flight) {
      const t = Math.min(1, (now - flight.start) / FLY_MS);
      const e = ease(t);
      const a = 1 - e;
      pos = {
        x: a * a * flight.from.x + 2 * a * e * flight.ctrl.x + e * e * flight.to.x,
        y: a * a * flight.from.y + 2 * a * e * flight.ctrl.y + e * e * flight.to.y,
      };
      if (t >= 1) flight = null;
    } else if (pos) {
      pos = { x: pos.x + (g.x - pos.x) * 0.3, y: pos.y + (g.y - pos.y) * 0.3 };
    } else {
      pos = g;
    }
    buddyEl.style.transform = `translate(${pos.x - 9}px, ${pos.y - 9}px)`;
  }
  placeBubble();
  requestAnimationFrame(frame);
}

window.companionOverlay.onView((next) => {
  view = next && typeof next === "object" ? next : view;
  drawHalos(view.halos);
  const mode = MODES.includes(view.mode) ? view.mode : "idle";
  buddyEl.className = `buddy ${mode}${buddyEl.classList.contains("hidden") ? " hidden" : ""}`;
  sayEl.textContent = typeof view.say === "string" ? view.say : "";
  const key = view.target ? `${view.target.id}:${view.target.rect.x},${view.target.rect.y}` : null;
  if (key !== targetKey) {
    targetKey = key;
    const g = goal();
    // Fly to a new target, and fly back to the cursor when a glance ends.
    if (g) startFlight(g);
  }
});

window.companionOverlay.onCursor((p) => {
  cursor = p && typeof p.x === "number" && typeof p.y === "number" ? p : null;
});

requestAnimationFrame(frame);
