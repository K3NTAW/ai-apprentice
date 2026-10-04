// Pairing window renderer. Text is only ever set via textContent.
"use strict";
const codeEl = document.getElementById("code");
const stateEl = document.getElementById("state");
const missingEl = document.getElementById("missing");

document.getElementById("hide").addEventListener("click", () => window.companionPairing.hide());

window.companionPairing.onState((view) => {
  codeEl.textContent = typeof view.code === "string" ? view.code : "";
  stateEl.textContent = typeof view.stateText === "string" ? view.stateText : "";
  stateEl.className = view.paired ? "state paired" : "state";
  missingEl.replaceChildren();
  for (const m of Array.isArray(view.missing) ? view.missing : []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = m.button;
    btn.title = `Missing: ${m.label}`;
    btn.addEventListener("click", () => window.companionPairing.openSettings(m.key));
    missingEl.appendChild(btn);
  }
});
