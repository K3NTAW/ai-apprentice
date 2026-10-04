// Side dock renderer. Text is only ever set via textContent; the avatar only via companionAvatar.setAvatarSrc.
"use strict";
const api = window.companionDock;
const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === "string" ? v : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
const show = (el, on) => el.classList.toggle("hidden", !on);
const KINDS = ["step", "shortcut", "guardrail"];

// Timer pill: mm:ss since the session started (set by main), ticking locally.
let startedAt = null;
const pad = (n) => String(n).padStart(2, "0");
function tick() {
  const el = $("timer");
  if (startedAt === null) {
    el.textContent = "";
    show(el, false);
    return;
  }
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  el.textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  show(el, true);
}
setInterval(tick, 1000);

$("collapse").addEventListener("click", () => api.collapse(true));
$("tab").addEventListener("click", () => api.collapse(false));
for (const btn of document.querySelectorAll("[data-action]")) {
  btn.addEventListener("click", () => api.action(btn.dataset.action));
}

api.onState((v) => {
  if (!v || typeof v !== "object") return;
  const off = v.offRecord === true;
  const dock = $("dock");
  dock.classList.toggle("collapsed", v.collapsed === true);
  dock.classList.toggle("left", v.side === "left");
  dock.classList.toggle("off", off);
  dock.classList.toggle("paused", v.paused === true);
  $("chev").setAttribute("d", v.side === "left" ? "M15 6l-6 6 6 6" : "m9 6 6 6-6 6");
  window.companionAvatar.setAvatarSrc($("avatar"), v.avatar);
  window.companionAvatar.setAvatarSrc($("tab-avatar"), v.avatar);
  // listening and asking animate (dock.css; none with reduced motion).
  const frame = str(v.avatarState);
  $("avatar").dataset.state = frame;
  $("tab-avatar").dataset.state = frame;
  startedAt = typeof v.startedAt === "number" && Number.isFinite(v.startedAt) ? v.startedAt : null;
  tick();
  $("header").textContent = str(v.header);
  $("name").textContent = str(v.name);
  $("role").textContent = str(v.role);
  $("state-label").textContent = str(v.stateLabel);
  $("rec-label").textContent = str(v.recLabel);
  $("say-text").textContent = str(v.say);
  show($("say"), str(v.say) !== "" && !off);
  show($("offrec"), off);
  $("asked").textContent = num(v.asked);
  $("guardrails").textContent = num(v.guardrails);
  $("tab-asked").textContent = num(v.asked);
  show($("tab-asked"), typeof v.asked === "number" && v.asked > 0);
  // Off the record: the canvas swaps the primary button to "Back on the record" (same off_record_toggle action).
  $("off-label").textContent = off ? "Back on the record" : "Off the record";
  show($("off-dot"), off);
  $("off-btn").className = off ? "btn bk grow" : "btn bw grow";
  $("end-btn").className = off ? "btn bw" : "btn bk";
  const items = [];
  for (const line of Array.isArray(v.feed) ? v.feed : []) {
    const kind = KINDS.includes(line.kind) ? line.kind : "step";
    const li = document.createElement("li");
    li.className = `it ${kind}`;
    const icon = document.createElement("span");
    icon.className = "ib";
    icon.textContent = str(line.icon);
    const body = document.createElement("span");
    body.className = "body";
    const label = document.createElement("span");
    label.className = "xs kind";
    label.textContent = kind;
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = str(line.text);
    body.append(label, text);
    li.append(icon, body);
    items.push(li);
  }
  $("feed").replaceChildren(...items);
});
