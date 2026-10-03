// Overlay renderer. Text is only ever set via textContent. Rects arrive already mapped to window DIP.
"use strict";
const root = document.getElementById("root");
const px = (n) => `${Number(n) || 0}px`;

window.companionOverlay.onHalos((halos) => {
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
});
