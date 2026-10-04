// Overlay renderer: buddy, caption bubble, halos. Text is only ever set via textContent.
// Rects arrive already mapped to window DIP; the cursor arrives window-local or null (not on this display).
"use strict";
const root = document.getElementById("root");
const buddyEl = document.getElementById("buddy");
const sayEl = document.getElementById("say");
const avatarEl = document.getElementById("avatar");
const pathEl = document.getElementById("path");
const pathLine = document.getElementById("path-line");
const geo = window.companionPath;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const px = (n) => `${Number(n) || 0}px`;
const OFFSET = 18;
const FLY_MS = 400;
const MODES = ["idle", "listening", "thinking", "speaking", "paused"];

let view = { buddy: false, mode: "idle", say: null, target: null, halos: [], avatar: null, offRecord: false };
let half = 9;
let pathShown = false;
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
      bubble.className = "glass caption";
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
  if (!pos || reduced.matches) {
    pos = to;
    flight = null;
    return;
  }
  // Quadratic curve with the control point lifted off the straight line.
  const mx = (pos.x + to.x) / 2;
  const my = (pos.y + to.y) / 2 - Math.min(160, Math.hypot(to.x - pos.x, to.y - pos.y) / 3);
  flight = { from: { ...pos }, ctrl: { x: mx, y: my }, to, start: performance.now() };
  pathShown = false;
}

/** Draw the dotted path once per flight; clear it when the flight ends, the buddy leaves this display, or capture stops. */
function syncPath(visible) {
  const on = geo.showPath({ flying: flight !== null, visible, reducedMotion: reduced.matches, paused: view.mode === "paused", offRecord: view.offRecord === true });
  if (!on) {
    if (pathShown || !pathEl.classList.contains("hidden")) clearPath();
    return;
  }
  if (pathShown) return;
  const pts = geo.flightPoints(flight.from, flight.ctrl, flight.to, geo.MAX_POINTS, { width: window.innerWidth, height: window.innerHeight });
  pathLine.setAttribute("d", geo.pathData(pts));
  pathEl.classList.remove("hidden");
  pathShown = true;
}

function clearPath() {
  pathLine.setAttribute("d", "");
  pathEl.classList.add("hidden");
  pathShown = false;
}

function placeBubble() {
  if (!view.buddy || !view.say || !pos) {
    sayEl.classList.add("hidden");
    return;
  }
  sayEl.classList.remove("hidden");
  const w = sayEl.offsetWidth;
  const h = sayEl.offsetHeight;
  // Under the buddy, left edges aligned (Buddy.dc.html: +2 px, 6 px gap), flipped left/up at the display edge.
  let x = pos.x - half + 2;
  let y = pos.y + half + 6;
  if (x + w > window.innerWidth) x = pos.x + half - w;
  if (y + h > window.innerHeight) y = pos.y - half - 6 - h;
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
    buddyEl.style.transform = `translate(${pos.x - half}px, ${pos.y - half}px)`;
  }
  try {
    syncPath(view.buddy && g !== null);
  } catch {
    clearPath();
  }
  placeBubble();
  requestAnimationFrame(frame);
}

window.companionOverlay.onView((next) => {
  view = next && typeof next === "object" ? next : view;
  // Off the record: no halos and no dotted path, even if a stale view still carries them.
  if (view.offRecord === true) {
    flight = null;
    clearPath();
  }
  drawHalos(view.offRecord === true ? [] : view.halos);
  const mode = MODES.includes(view.mode) ? view.mode : "idle";
  // The avatar (a validated data URL) only ever goes to the img src; null keeps the v2 orb.
  const hasAvatar = window.companionAvatar.setAvatarSrc(avatarEl, view.avatar);
  half = hasAvatar ? 23 : 9;
  buddyEl.className = `buddy ${mode}${hasAvatar ? " has-avatar" : ""}${buddyEl.classList.contains("hidden") ? " hidden" : ""}`;
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
