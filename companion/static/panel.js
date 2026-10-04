// Panel renderer. Text is only ever set via textContent; main.mts validates every action.
"use strict";
const api = window.companionPanel;
const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === "string" ? v : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
const show = (el, on) => el.classList.toggle("hidden", !on);

document.documentElement.dataset.material = new URLSearchParams(location.search).get("material") || "solid";
$("hide").addEventListener("click", () => api.hide());
$("new-code").addEventListener("click", () => api.newCode());
$("control-room").addEventListener("click", () => api.openControlRoom());
$("reset").addEventListener("click", () => api.resetBindings());
$("buddy").addEventListener("change", (e) => api.setBuddy(e.target.checked));
for (const btn of document.querySelectorAll("[data-action]")) {
  btn.addEventListener("click", () => api.action(btn.dataset.action));
}

let recording = null;

/** Turn a keydown into an Electron accelerator; null until a non-modifier key is pressed. */
function accelerator(e) {
  const mods = [];
  if (e.metaKey) mods.push("Command");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push(navigator.platform.startsWith("Mac") ? "Option" : "Alt");
  if (e.shiftKey) mods.push("Shift");
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === "Space") key = "Space";
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  return key && mods.length ? [...mods, key].join("+") : null;
}

window.addEventListener("keydown", (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === "Escape") {
    recording = null;
    api.recording(false);
    return;
  }
  const acc = accelerator(e);
  if (!acc) return;
  const action = recording;
  recording = null;
  api.setBinding(action, acc);
  api.recording(false);
});

api.onState((v) => {
  if (!v || typeof v !== "object") return;
  const pairing = v.pairing || {};
  $("state").textContent = str(pairing.stateText);
  $("state").className = pairing.paired ? "xs mu state paired" : "xs mu state";
  $("code").textContent = str(pairing.code);
  show($("pairing"), v.firstRun === true);
  show($("session"), v.firstRun !== true);

  const s = v.session || {};
  $("mode").textContent = str(s.modeLabel);
  $("title").textContent = str(s.title);
  $("expert").textContent = str(s.expert);
  $("question").textContent = str(s.lastQuestion);
  $("answer").textContent = str(s.lastAnswer);
  $("asked").textContent = num(s.asked);
  $("guardrails").textContent = num(s.guardrails);
  show($("offrec"), s.offRecord === true);
  show($("paused"), v.paused === true);
  for (const btn of document.querySelectorAll("[data-action]")) btn.disabled = v.actionsEnabled !== true;
  $("control-room").disabled = v.canOpenControlRoom !== true;

  show($("permissions"), v.showPermissions === true);
  $("missing").replaceChildren();
  for (const m of Array.isArray(pairing.missing) ? pairing.missing : []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn bw";
    btn.textContent = str(m.button);
    btn.title = `Missing: ${str(m.label)}`;
    btn.addEventListener("click", () => api.openSettings(m.key));
    $("missing").appendChild(btn);
  }

  $("talk-hint").textContent = str(v.talkHint);
  $("shortcuts").replaceChildren();
  for (const sc of Array.isArray(v.shortcuts) ? v.shortcuts : []) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = str(sc.label);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kc keys";
    btn.textContent = recording === sc.action ? "Press keys… (Esc cancels)" : str(sc.display);
    btn.addEventListener("click", () => {
      recording = sc.action;
      api.recording(true);
      btn.textContent = "Press keys… (Esc cancels)";
    });
    row.append(label, btn);
    if (sc.error) {
      const err = document.createElement("div");
      err.className = "error";
      err.textContent = str(sc.error);
      row.appendChild(err);
    }
    $("shortcuts").appendChild(row);
  }
  $("buddy").checked = v.buddyEnabled === true;
  $("buddy").disabled = v.buddyForcedOff === true;
  show($("buddy-forced"), v.buddyForcedOff === true);
});
