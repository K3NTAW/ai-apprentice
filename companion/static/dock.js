// Side dock renderer. Text is only ever set via textContent; the avatar only via companionAvatar.setAvatarSrc.
"use strict";
const api = window.companionDock;
const $ = (id) => document.getElementById(id);
const str = (v) => (typeof v === "string" ? v : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
const show = (el, on) => el.classList.toggle("hidden", !on);
const KINDS = ["step", "shortcut", "guardrail"];

$("collapse").addEventListener("click", () => api.collapse(true));
$("tab").addEventListener("click", () => api.collapse(false));
for (const btn of document.querySelectorAll("[data-action]")) {
  btn.addEventListener("click", () => api.action(btn.dataset.action));
}

api.onState((v) => {
  if (!v || typeof v !== "object") return;
  $("dock").classList.toggle("collapsed", v.collapsed === true);
  $("collapse").textContent = v.side === "left" ? "‹" : "›";
  window.companionAvatar.setAvatarSrc($("avatar"), v.avatar);
  window.companionAvatar.setAvatarSrc($("tab-avatar"), v.avatar);
  $("name").textContent = str(v.name);
  $("role").textContent = str(v.role);
  $("say").textContent = str(v.say);
  show($("say"), str(v.say) !== "");
  show($("offrec"), v.offRecord === true);
  show($("paused"), v.paused === true);
  $("asked").textContent = num(v.asked);
  $("guardrails").textContent = num(v.guardrails);
  const items = [];
  for (const line of Array.isArray(v.feed) ? v.feed : []) {
    const li = document.createElement("li");
    li.className = KINDS.includes(line.kind) ? line.kind : "step";
    const icon = document.createElement("span");
    icon.className = "icon-kind";
    icon.textContent = str(line.icon);
    const text = document.createElement("span");
    text.textContent = str(line.text);
    li.append(icon, text);
    items.push(li);
  }
  $("feed").replaceChildren(...items);
});
