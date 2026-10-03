// Clay avatar renderer per the AVATAR CONTRACT: a self-contained SVG string per (avatar, state, size).
// No scripts, no external refs, no foreignObject; animations are SMIL only. Same input -> same output.

export const AVATAR_SHAPES = ["blob", "round", "square", "pill", "bean", "star"] as const;
export const AVATAR_FACES = ["smile", "focus", "curious", "calm", "wink", "robot"] as const;
export const AVATAR_STATES = ["idle", "listening", "thinking", "talking", "asking", "stop", "happy", "paused"] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarFace = (typeof AVATAR_FACES)[number];
export type AvatarState = (typeof AVATAR_STATES)[number];
export type Avatar = { shape: AvatarShape; face: AvatarFace; color: string; accent: string };

export const AVATAR_PALETTE = [
  "#F4A261", "#E76F51", "#E9C46A", "#2A9D8F", "#264653", "#8AB17D",
  "#7FB7BE", "#5E60CE", "#C77DFF", "#FF8FAB", "#B5838D", "#A3A3A3",
] as const;

export const DEFAULT_AVATAR: Avatar = { shape: "blob", face: "smile", color: "#F4A261", accent: "#2A9D8F" };
export const MAX_DATA_URL_BYTES = 100 * 1024;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

// Coerces untrusted input into a valid avatar; unknown values fall back to the defaults.
export function normalizeAvatar(input: unknown): Avatar {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const shape = AVATAR_SHAPES.includes(o.shape as AvatarShape) ? (o.shape as AvatarShape) : DEFAULT_AVATAR.shape;
  const face = AVATAR_FACES.includes(o.face as AvatarFace) ? (o.face as AvatarFace) : DEFAULT_AVATAR.face;
  const color = isHexColor(o.color) ? o.color.toUpperCase() : DEFAULT_AVATAR.color;
  const accent = isHexColor(o.accent) ? o.accent.toUpperCase() : DEFAULT_AVATAR.accent;
  return { shape, face, color, accent };
}

export function randomAvatar(rand: () => number = Math.random): Avatar {
  const pick = <T,>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  const color = pick(AVATAR_PALETTE);
  const accent = pick(AVATAR_PALETTE.filter((c) => c !== color));
  return { shape: pick(AVATAR_SHAPES), face: pick(AVATAR_FACES), color, accent };
}

function mix(hex: string, target: string, t: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(target.slice(1), 16);
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const n = (v: number) => (Math.round(v * 10) / 10).toString();

// Body outlines in a 200x200 box; the face sits around (100, 105).
function bodyShape(shape: AvatarShape, attrs: string): string {
  switch (shape) {
    case "round":
      return `<circle cx="100" cy="108" r="64" ${attrs}/>`;
    case "square":
      return `<rect x="38" y="46" width="124" height="124" rx="34" ${attrs}/>`;
    case "pill":
      return `<rect x="52" y="34" width="96" height="144" rx="48" ${attrs}/>`;
    case "bean":
      return `<path d="M64 60 C88 30 150 36 160 82 C168 120 150 170 104 172 C62 174 34 148 44 116 C50 98 46 82 64 60 Z" ${attrs}/>`;
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 76 : 46;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(`${n(100 + r * Math.cos(a))} ${n(112 + r * Math.sin(a))}`);
      }
      return `<path d="M${pts.join(" L")} Z" stroke-linejoin="round" stroke-width="18" ${attrs}/>`;
    }
    case "blob":
    default:
      return `<path d="M100 42 C140 40 168 70 166 108 C164 146 140 172 100 172 C58 172 34 148 36 110 C38 72 60 44 100 42 Z" ${attrs}/>`;
  }
}

const INK = "#1F2937";

function eyesFor(face: AvatarFace, state: AvatarState, accent: string): string {
  const closedArc = (x: number, up: boolean) =>
    `<path d="M${x - 8} 102 Q${x} ${up ? 92 : 110} ${x + 8} 102" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  if (state === "happy") return closedArc(82, true) + closedArc(118, true);
  if (state === "paused") return `<path d="M74 103 H90 M110 103 H126" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  const lookY = state === "thinking" ? -5 : 0;
  const lookX = state === "thinking" ? 3 : 0;
  const round = (x: number, r = 7) =>
    `<circle cx="${x + lookX}" cy="${102 + lookY}" r="${r}" fill="${INK}"/><circle cx="${x + lookX + 2.5}" cy="${99 + lookY}" r="2" fill="#FFFFFF"/>`;
  switch (face) {
    case "focus":
      return `<ellipse cx="${82 + lookX}" cy="${103 + lookY}" rx="8" ry="4.5" fill="${INK}"/><ellipse cx="${118 + lookX}" cy="${103 + lookY}" rx="8" ry="4.5" fill="${INK}"/>`;
    case "curious":
      return round(82, 6) + round(118, 8);
    case "calm":
      return state === "thinking" || state === "listening" ? round(82, 6) + round(118, 6) : closedArc(82, false) + closedArc(118, false);
    case "wink":
      return round(82) + closedArc(118, true);
    case "robot":
      return `<rect x="${72 + lookX}" y="${94 + lookY}" width="20" height="16" rx="3" fill="${INK}"/><rect x="${108 + lookX}" y="${94 + lookY}" width="20" height="16" rx="3" fill="${INK}"/><rect x="${77 + lookX}" y="${99 + lookY}" width="10" height="6" rx="1.5" fill="${accent}"/><rect x="${113 + lookX}" y="${99 + lookY}" width="10" height="6" rx="1.5" fill="${accent}"/>`;
    case "smile":
    default:
      return round(82) + round(118);
  }
}

function browsFor(face: AvatarFace, state: AvatarState): string {
  const line = (d: string) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
  if (state === "stop") return line("M72 86 L92 91") + line("M128 86 L108 91");
  if (state === "listening" || state === "asking") return line("M72 84 Q82 78 92 84") + line("M108 84 Q118 78 128 84");
  if (face === "focus") return line("M72 90 L92 90") + line("M108 90 L128 90");
  if (face === "curious") return line("M74 89 Q82 86 90 89") + line("M108 84 Q118 76 128 82");
  return "";
}

function mouthFor(face: AvatarFace, state: AvatarState): string {
  const stroke = `fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"`;
  if (state === "talking") {
    return `<ellipse cx="100" cy="128" rx="10" ry="3" fill="${INK}"><animate attributeName="ry" values="2;8;3;7;2" dur="0.6s" repeatCount="indefinite"/></ellipse>`;
  }
  if (state === "happy") return `<path d="M84 122 Q100 142 116 122 Z" fill="${INK}"/>`;
  if (state === "stop") return `<path d="M88 130 H112" ${stroke}/>`;
  if (state === "paused") return `<path d="M93 129 Q100 132 107 129" ${stroke}/>`;
  if (state === "asking" || state === "listening") return `<ellipse cx="100" cy="129" rx="5" ry="6" fill="${INK}"/>`;
  switch (face) {
    case "focus":
      return `<path d="M90 129 H110" ${stroke}/>`;
    case "curious":
      return `<circle cx="100" cy="129" r="5" fill="${INK}"/>`;
    case "calm":
      return `<path d="M90 126 Q100 133 110 126" ${stroke}/>`;
    case "robot":
      return `<rect x="84" y="122" width="32" height="12" rx="3" fill="${INK}"/><path d="M92 122 V134 M100 122 V134 M108 122 V134" stroke="#9CA3AF" stroke-width="1.5"/>`;
    case "wink":
    case "smile":
    default:
      return `<path d="M86 123 Q100 138 114 123" ${stroke}/>`;
  }
}

// Wraps content in a group that scales/rotates around (cx, cy) via SMIL.
function around(cx: number, cy: number, anim: string, inner: string): string {
  return `<g transform="translate(${cx} ${cy})"><g>${anim}<g transform="translate(${-cx} ${-cy})">${inner}</g></g></g>`;
}

function extrasFor(state: AvatarState, accent: string): { back: string; front: string } {
  switch (state) {
    case "listening":
      return {
        back: `<circle cx="100" cy="108" r="70" fill="none" stroke="${accent}" stroke-width="3"><animate attributeName="r" values="70;90" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle>`,
        front: "",
      };
    case "thinking": {
      const dots = [0, 120, 240]
        .map((deg) => {
          const a = (deg * Math.PI) / 180;
          return `<circle cx="${n(100 + 18 * Math.cos(a))}" cy="${n(26 + 8 * Math.sin(a))}" r="4.5" fill="${accent}"/>`;
        })
        .join("");
      return { back: "", front: around(100, 26, `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2.4s" repeatCount="indefinite"/>`, dots) };
    }
    case "asking":
      return {
        back: "",
        front: `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.8s" repeatCount="indefinite"/><circle cx="160" cy="40" r="18" fill="#FFFFFF" stroke="${accent}" stroke-width="3"/><path d="M146 52 L140 62 L152 56 Z" fill="#FFFFFF" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/><text x="160" y="48" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="${accent}">?</text></g>`,
      };
    case "stop":
      return {
        back: `<circle cx="100" cy="108" r="84" fill="none" stroke="#EF4444" stroke-width="6"><animate attributeName="opacity" values="1;0.45;1" dur="1s" repeatCount="indefinite"/></circle>`,
        front: `<g transform="translate(158 132)"><rect x="-12" y="-6" width="24" height="26" rx="8" fill="#FFFFFF" stroke="#EF4444" stroke-width="3"/><path d="M-9 -4 V-18 M-3 -6 V-22 M3 -6 V-22 M9 -4 V-17" stroke="#EF4444" stroke-width="5" stroke-linecap="round"/></g>`,
      };
    case "paused":
      return {
        back: "",
        front: `<text x="152" y="52" font-family="sans-serif" font-size="22" font-weight="700" fill="#9CA3AF">z<animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" repeatCount="indefinite"/></text>`,
      };
    default:
      return { back: "", front: "" };
  }
}

function bodyAnimation(state: AvatarState): { cx: number; cy: number; anim: string } | null {
  switch (state) {
    case "idle":
      return { cx: 100, cy: 172, anim: `<animateTransform attributeName="transform" type="scale" values="1 1;1.015 1.035;1 1" dur="3.6s" repeatCount="indefinite"/>` };
    case "listening":
      return { cx: 100, cy: 172, anim: `<animateTransform attributeName="transform" type="scale" values="1 1;1.05 1.05;1.04 1.04" keyTimes="0;0.4;1" dur="2s" repeatCount="indefinite"/>` };
    case "asking":
      return { cx: 100, cy: 172, anim: `<animateTransform attributeName="transform" type="rotate" values="0;-9;-9;0" keyTimes="0;0.3;0.8;1" dur="2.4s" repeatCount="indefinite"/>` };
    case "happy":
      return { cx: 100, cy: 172, anim: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -12;0 0;0 0" keyTimes="0;0.3;0.6;1" dur="0.9s" repeatCount="indefinite"/>` };
    case "talking":
      return { cx: 100, cy: 172, anim: `<animateTransform attributeName="transform" type="scale" values="1 1;1.01 1.02;1 1" dur="0.6s" repeatCount="indefinite"/>` };
    default:
      return null;
  }
}

// Short deterministic id prefix so several inline SVGs on one page do not share gradient ids.
function idFor(avatar: Avatar, state: AvatarState): string {
  const s = `${avatar.shape}|${avatar.face}|${avatar.color}|${avatar.accent}|${state}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `av${(h >>> 0).toString(36)}`;
}

export function renderAvatarSvg(input: Avatar, state: AvatarState, size = 128): string {
  const avatar = normalizeAvatar(input);
  const st: AvatarState = AVATAR_STATES.includes(state) ? state : "idle";
  const px = Number.isFinite(size) ? Math.max(16, Math.min(1024, Math.round(size))) : 128;
  const id = idFor(avatar, st);
  const base = avatar.color;
  const light = mix(base, "#FFFFFF", 0.35);
  const dark = mix(base, "#000000", 0.28);

  const defs =
    `<defs>` +
    `<radialGradient id="${id}b" cx="0.4" cy="0.32" r="0.8"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient>` +
    `<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.22"/></linearGradient>` +
    `<filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>` +
    (st === "paused" ? `<filter id="${id}g"><feColorMatrix type="saturate" values="0.1"/></filter>` : "") +
    `</defs>`;

  const body = bodyShape(avatar.shape, `fill="url(#${id}b)" stroke="url(#${id}b)"`);
  const shade = bodyShape(avatar.shape, `fill="url(#${id}s)" stroke="none"`);
  const highlight = `<ellipse cx="86" cy="66" rx="30" ry="14" fill="url(#${id}h)" transform="rotate(-14 86 66)"/>`;
  const cheeks = `<circle cx="68" cy="118" r="7" fill="${avatar.accent}" opacity="0.45"/><circle cx="132" cy="118" r="7" fill="${avatar.accent}" opacity="0.45"/>`;

  let eyes = eyesFor(avatar.face, st, avatar.accent);
  if (st === "idle" || st === "listening") {
    // Occasional blink: eyes squash for a moment every few seconds.
    eyes = around(100, 102, `<animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 0.1;1 1" keyTimes="0;0.92;0.96;1" dur="4.5s" repeatCount="indefinite"/>`, eyes);
  }
  const face = `<g>${browsFor(avatar.face, st)}${eyes}${mouthFor(avatar.face, st)}</g>`;
  let figure = body + shade + highlight + cheeks + face;
  const anim = bodyAnimation(st);
  if (anim) figure = around(anim.cx, anim.cy, anim.anim, figure);

  const extras = extrasFor(st, avatar.accent);
  const shadow = `<ellipse cx="100" cy="182" rx="52" ry="8" fill="#000000" opacity="0.28" filter="url(#${id}f)"/>`;
  const grey = st === "paused" ? ` filter="url(#${id}g)" opacity="0.85"` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 200 200" role="img" aria-label="avatar ${st}">` +
    defs +
    shadow +
    extras.back +
    `<g${grey}>${figure}</g>` +
    extras.front +
    `</svg>`
  );
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// data:image/svg+xml;base64,... for the companion (<img src> only). Throws above 100 KB.
export function toDataUrl(svg: string): string {
  const url = `data:image/svg+xml;base64,${base64Utf8(svg)}`;
  if (url.length > MAX_DATA_URL_BYTES) throw new Error("avatar data URL exceeds 100 KB");
  return url;
}

export function renderAvatarSet(avatar: Avatar, size = 128): Record<AvatarState, string> {
  const out = {} as Record<AvatarState, string>;
  for (const st of AVATAR_STATES) out[st] = toDataUrl(renderAvatarSvg(avatar, st, size));
  return out;
}
