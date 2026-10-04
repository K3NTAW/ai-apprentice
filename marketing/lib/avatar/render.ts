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

const n = (v: number) => (Math.round(v * 100) / 100).toString();

// All geometry below is in the canvas units of Avatar.dc.html: a 100x100 box, ink #0A0A0C.
const INK = "#0A0A0C";
const CORAL = "#FF8A65";

type Body = { l: number; t: number; w: number; h: number; rot: number; fx: number; fy: number; fs: number; bl: number; bt: number };
const BODIES: Record<AvatarShape, Body> = {
  blob: { l: 12, t: 15, w: 76, h: 72, rot: 0, fx: 0, fy: 2, fs: 1, bl: 64, bt: 9 },
  round: { l: 12, t: 12, w: 76, h: 76, rot: 0, fx: 0, fy: 2, fs: 1, bl: 66, bt: 8 },
  square: { l: 13, t: 13, w: 74, h: 74, rot: 0, fx: 0, fy: 2, fs: 1, bl: 68, bt: 7 },
  pill: { l: 21, t: 9, w: 58, h: 82, rot: 0, fx: 0, fy: 0, fs: 0.88, bl: 58, bt: 4 },
  bean: { l: 8, t: 19, w: 84, h: 64, rot: -6, fx: 0, fy: 3, fs: 1, bl: 66, bt: 13 },
  star: { l: 6, t: 6, w: 88, h: 88, rot: 0, fx: 0, fy: 8, fs: 0.76, bl: 44, bt: -3 },
};
// CSS border-radius per corner (TL, TR, BR, BL) as fractions of width / height.
const RADII: Partial<Record<AvatarShape, [number[], number[]]>> = {
  blob: [[0.58, 0.42, 0.54, 0.46], [0.52, 0.56, 0.44, 0.48]],
  bean: [[0.48, 0.52, 0.44, 0.56], [0.62, 0.58, 0.42, 0.38]],
};
const STAR = [50, 2, 63, 27, 97.6, 36.5, 72, 60, 79.4, 92.5, 50, 80, 20.6, 92.5, 28, 60, 2.4, 36.5, 37, 27];

// A CSS rounded box as a path; radii are scaled down like the browser does when they overlap.
function roundedRect(l: number, t: number, w: number, h: number, rx: number[], ry: number[]): string {
  const f = Math.min(1, w / (rx[0] + rx[1]), w / (rx[3] + rx[2]), h / (ry[0] + ry[3]), h / (ry[1] + ry[2]));
  const [x0, x1, x2, x3] = rx.map((v) => v * f);
  const [y0, y1, y2, y3] = ry.map((v) => v * f);
  return (
    `M${n(l + x0)} ${n(t)}H${n(l + w - x1)}A${n(x1)} ${n(y1)} 0 0 1 ${n(l + w)} ${n(t + y1)}` +
    `V${n(t + h - y2)}A${n(x2)} ${n(y2)} 0 0 1 ${n(l + w - x2)} ${n(t + h)}` +
    `H${n(l + x3)}A${n(x3)} ${n(y3)} 0 0 1 ${n(l)} ${n(t + h - y3)}` +
    `V${n(t + y0)}A${n(x0)} ${n(y0)} 0 0 1 ${n(l + x0)} ${n(t)}Z`
  );
}

function bodyPath(shape: AvatarShape): string {
  const b = BODIES[shape];
  if (shape === "star") {
    const pts: string[] = [];
    for (let i = 0; i < STAR.length; i += 2) pts.push(`${n(b.l + (STAR[i] / 100) * b.w)} ${n(b.t + (STAR[i + 1] / 100) * b.h)}`);
    return `M${pts.join("L")}Z`;
  }
  const r = RADII[shape];
  if (r) return roundedRect(b.l, b.t, b.w, b.h, r[0].map((v) => v * b.w), r[1].map((v) => v * b.h));
  const k = shape === "round" ? b.w / 2 : shape === "square" ? 0.28 * b.w : 29;
  return roundedRect(b.l, b.t, b.w, b.h, [k, k, k, k], [k, k, k, k]);
}

// The visible part of a box that only has a bottom (or top) border and rounded corners on that side:
// the canvas draws smiles, calm eyes and closed arcs this way.
function band(l: number, t: number, w: number, h: number, bw: number, radius: number, top = false): string {
  const r = radius * Math.min(1, w / (2 * radius), h / radius);
  const ri = r - bw;
  const y0 = top ? t + r : t + h - r;
  const yb = top ? t : t + h;
  const yi = top ? t + bw : t + h - bw;
  const so = top ? 1 : 0;
  const si = top ? 0 : 1;
  const inner =
    ri > 0
      ? `A${n(r)} ${n(ri)} 0 0 ${si} ${n(l + w - r)} ${n(yi)}H${n(l + r)}A${n(r)} ${n(ri)} 0 0 ${si} ${n(l)} ${n(y0)}`
      : `L${n(l + w - r)} ${n(yi)}H${n(l + r)}`;
  return `<path d="M${n(l)} ${n(y0)}A${n(r)} ${n(r)} 0 0 ${so} ${n(l + r)} ${n(yb)}H${n(l + w - r)}A${n(r)} ${n(r)} 0 0 ${so} ${n(l + w)} ${n(y0)}${inner}Z" fill="${INK}"/>`;
}

// A CSS box with border-radius: 50% rotated about its centre: the tilted oval eye.
function oval(l: number, t: number, w: number, h: number, rot: number, fill = INK): string {
  const cx = l + w / 2;
  const cy = t + h / 2;
  return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${fill}"${rot ? ` transform="rotate(${rot} ${n(cx)} ${n(cy)})"` : ""}/>`;
}

function bar(l: number, t: number, w: number, h: number, r: number, rot = 0, fill = INK): string {
  const rot2 = rot ? ` transform="rotate(${rot} ${n(l + w / 2)} ${n(t + h / 2)})"` : "";
  return `<rect x="${n(l)}" y="${n(t)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(r, w / 2, h / 2))}" fill="${fill}"${rot2}/>`;
}

// Wraps content in a group that animates around (cx, cy) via SMIL.
function around(cx: number, cy: number, anim: string, inner: string): string {
  return `<g transform="translate(${n(cx)} ${n(cy)})"><g>${anim}<g transform="translate(${n(-cx)} ${n(-cy)})">${inner}</g></g></g>`;
}

type EyeKind = "dots" | "bars" | "curious" | "calm" | "wink" | "robot" | "happy" | "closed";
type MouthKind = "smile" | "calm" | "flat" | "o" | "open" | "big" | "robot";
const EYE_BY: Record<AvatarFace, EyeKind> = { smile: "dots", focus: "bars", curious: "curious", calm: "calm", wink: "wink", robot: "robot" };
const MOUTH_BY: Record<AvatarFace, MouthKind> = { smile: "smile", focus: "flat", curious: "o", calm: "calm", wink: "smile", robot: "robot" };

// Same face/mood table as the canvas renderVals().
function faceKinds(face: AvatarFace, st: AvatarState): { eye: EyeKind; mouth: MouthKind } {
  let eye = EYE_BY[face];
  let mouth = MOUTH_BY[face];
  if (st === "happy") {
    if (face !== "robot") eye = "happy";
    mouth = face === "robot" ? "robot" : "big";
  }
  if (st === "paused") {
    if (face !== "robot") eye = "closed";
    mouth = "flat";
  }
  if (st === "talking") mouth = "open";
  if (st === "asking") mouth = "o";
  if (st === "stop" || st === "thinking") mouth = face === "robot" ? "robot" : "flat";
  return { eye, mouth };
}

const BLINK = `<animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 0.12;1 1" keyTimes="0;0.93;0.96;1" dur="4.5s" repeatCount="indefinite"/>`;

function eyes(kind: EyeKind, st: AvatarState, accent: string, glow: string): string {
  switch (kind) {
    case "dots": {
      const blink = st === "idle" || st === "listening";
      const eye = (l: number, t: number) => (blink ? around(l + 4.5, t + 7, BLINK, oval(l, t, 9, 14, -12)) : oval(l, t, 9, 14, -12));
      return eye(35, 36) + eye(56, 34);
    }
    case "bars":
      return bar(32, 42, 14, 5, 3, -6) + bar(54, 40, 14, 5, 3, -6);
    case "curious":
      return oval(35, 38, 8, 12, -10) + oval(54, 33, 12, 17, -10) + bar(53, 26, 13, 3, 2, -16);
    case "calm":
      return band(32, 40, 14, 8, 3.5, 9) + band(54, 39, 14, 8, 3.5, 9);
    case "wink":
      return oval(35, 36, 9, 14, -12) + band(54, 42, 14, 8, 3.5, 9, true);
    case "robot": {
      const pupil = (l: number) => `<rect x="${l}" y="40" width="5" height="5" rx="1" fill="${accent}" filter="url(#${glow})"/>` + bar(l, 40, 5, 5, 1, 0, accent);
      return bar(32, 36, 14, 13, 4) + bar(54, 36, 14, 13, 4) + pupil(36) + pupil(58);
    }
    case "happy":
      return band(32, 41, 14, 9, 3.5, 9, true) + band(54, 40, 14, 9, 3.5, 9, true);
    case "closed":
      return bar(33, 44, 12, 3.5, 2) + bar(55, 43, 12, 3.5, 2);
  }
}

function mouth(kind: MouthKind): string {
  switch (kind) {
    case "smile":
      return band(43, 54, 15, 7, 3.5, 10);
    case "calm":
      return band(45, 56, 11, 5, 3, 8);
    case "flat":
      return bar(45, 58, 11, 3.5, 2);
    case "o":
      return oval(46, 55, 9, 10, 0);
    case "open":
      return around(50.5, 59.5, `<animateTransform attributeName="transform" type="scale" values="1 0.35;1 1;1 0.35" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="0.45s" repeatCount="indefinite"/>`, oval(44, 54, 13, 11, 0));
    case "big":
      return `<path d="${roundedRect(41, 53, 19, 11, [3, 3, 12, 12], [3, 3, 12, 12])}" fill="${INK}"/>`;
    case "robot":
      return [40, 45, 50, 55, 60].map((x) => `<rect x="${x}" y="57" width="${x === 60 ? 1 : 3}" height="6" fill="${INK}"/>`).join("");
  }
}

const EASE = `calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"`;

// aa-bob: translateY(-3px) rotate(-1.5deg) at 50%, around the box centre.
function bob(dur: string): string {
  return (
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" ${EASE} dur="${dur}" repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="rotate" values="0 50 50;-1.5 50 50;0 50 50" ${EASE} dur="${dur}" additive="sum" repeatCount="indefinite"/>`
  );
}

const pulse = (from: number, dur: string, begin = "0s") =>
  `<animate attributeName="opacity" values="${from};1;${from}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/>`;

// The 24x24 badge with a 1.5px border at the top right (asking, stop, paused).
const badge = (fill: string, inner: string, anim = "") =>
  `<g>${anim}<circle cx="85.5" cy="11.5" r="12.75" fill="${fill}" stroke="${INK}" stroke-width="1.5"/>${inner}</g>`;
const badgeText = (ch: string, fill: string) =>
  `<text x="85.5" y="16.5" text-anchor="middle" font-family="Geist, ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="700" fill="${fill}">${ch}</text>`;

function overlays(st: AvatarState, accent: string, id: string): { back: string; front: string } {
  switch (st) {
    case "listening": {
      const ring = (begin: string) =>
        around(50, 50, `<animateTransform attributeName="transform" type="scale" values="0.88;1.24" dur="2s" begin="${begin}" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.58 1" repeatCount="indefinite"/>`,
          `<circle cx="50" cy="50" r="45" fill="none" stroke="${accent}" stroke-width="2" opacity="0"><animate attributeName="opacity" values="0.8;0" dur="2s" begin="${begin}" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.58 1" repeatCount="indefinite"/></circle>`);
      return { back: ring("0s") + ring("1s"), front: "" };
    }
    case "stop":
      return {
        back:
          `<circle cx="50" cy="50" r="50" fill="none" stroke="${CORAL}" stroke-width="4" opacity="0.45" filter="url(#${id}sg)">${pulse(0.5, "1.6s")}</circle>` +
          `<circle cx="50" cy="50" r="49" fill="none" stroke="${CORAL}" stroke-width="2"/>`,
        front: badge(CORAL, badgeText("!", INK)),
      };
    case "thinking":
      return {
        back: "",
        front:
          `<rect x="64.75" y="0.75" width="35.5" height="18.5" rx="9.25" fill="#FFFFFF" stroke="${INK}" stroke-width="1.5"/>` +
          [75.5, 82.5, 89.5].map((cx, i) => `<circle cx="${cx}" cy="10" r="2" fill="${INK}" opacity="0.25">${pulse(0.25, "1.2s", `${i * 0.2}s`)}</circle>`).join(""),
      };
    case "talking":
      return {
        back: "",
        front:
          `<path d="M91.25 36A5.25 8 0 0 1 91.25 52A2.75 8 0 0 0 91.25 36Z" fill="${accent}" opacity="0.25">${pulse(0.25, "1s")}</path>` +
          `<path d="M96.25 31A6.25 13 0 0 1 96.25 57A3.75 13 0 0 0 96.25 31Z" fill="${accent}" opacity="0.25">${pulse(0.25, "1s", "0.3s")}</path>`,
      };
    case "asking":
      return {
        back: "",
        front: badge(accent, badgeText("?", "#FFFFFF"), `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" ${EASE} dur="1.8s" repeatCount="indefinite"/>`),
      };
    case "happy":
      return {
        back: "",
        front: bar(82, 8, 9, 9, 2, 45, accent) + bar(8, 20, 6, 6, 1, 45, accent),
      };
    case "paused":
      return {
        back: "",
        front: badge("#2A2A2E", bar(81, 7, 3, 9, 1, 0, "#E5E5E5") + bar(87, 7, 3, 9, 1, 0, "#E5E5E5"), pulse(0.6, "2.4s")),
      };
    default:
      return { back: "", front: "" };
  }
}

// Short deterministic id prefix so several inline SVGs on one page do not share gradient ids.
function idFor(avatar: Avatar, state: AvatarState): string {
  const s = `${avatar.shape}|${avatar.face}|${avatar.color}|${avatar.accent}|${state}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `av${(h >>> 0).toString(36)}`;
}

const blur = (id: string, sd: number) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

// CSS inset box-shadow: SourceAlpha minus its blurred offset copy, flooded with a colour.
function insetShadow(dx: number, dy: number, sd: number, color: string, opacity: number, out: string): string {
  return (
    `<feOffset in="SourceAlpha" dx="${dx}" dy="${dy}"/><feGaussianBlur stdDeviation="${sd}" result="${out}b"/>` +
    `<feComposite in="SourceAlpha" in2="${out}b" operator="out" result="${out}c"/>` +
    `<feFlood flood-color="${color}" flood-opacity="${opacity}"/><feComposite in2="${out}c" operator="in" result="${out}"/>`
  );
}

export type AvatarRenderOptions = { tile?: boolean };

// tile: the dark rounded stage (radius 18, #232327 -> #0A0A0C) the canvas puts behind avatars in grids.
export function renderAvatarSvg(input: Avatar, state: AvatarState, size = 128, options: AvatarRenderOptions = {}): string {
  const avatar = normalizeAvatar(input);
  const st: AvatarState = AVATAR_STATES.includes(state) ? state : "idle";
  const px = Number.isFinite(size) ? Math.max(16, Math.min(1024, Math.round(size))) : 128;
  const id = idFor(avatar, st) + (options.tile ? "t" : "");
  const tone = avatar.color;
  const accent = avatar.accent;
  const b = BODIES[avatar.shape];
  const { eye, mouth: mouthKind } = faceKinds(avatar.face, st);

  const defs =
    `<defs>` +
    `<radialGradient id="${id}b" cx="0.34" cy="0.3" r="0.75"><stop offset="0" stop-color="${mix(tone, "#FFFFFF", 0.7)}"/><stop offset="0.46" stop-color="${tone}"/><stop offset="1" stop-color="${mix(tone, "#000000", 0.26)}"/></radialGradient>` +
    `<radialGradient id="${id}d" cx="0.35" cy="0.3" r="0.95"><stop offset="0" stop-color="${mix(accent, "#FFFFFF", 0.55)}"/><stop offset="0.65" stop-color="${accent}"/></radialGradient>` +
    `<filter id="${id}i" x="0" y="0" width="1" height="1">${insetShadow(-5, -7, 6, "#000000", 0.18, "s")}${insetShadow(4, 5, 5, "#FFFFFF", 0.55, "h")}<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="s"/><feMergeNode in="h"/></feMerge></filter>` +
    blur(`${id}f`, 1.5) +
    blur(`${id}h`, 1) +
    blur(`${id}c`, 0.3) +
    (eye === "robot" ? blur(`${id}g`, 2.5) : "") +
    (st === "stop" ? blur(`${id}sg`, 5) : "") +
    (st === "paused"
      ? `<filter id="${id}p"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="0.72"/><feFuncG type="linear" slope="0.72"/><feFuncB type="linear" slope="0.72"/></feComponentTransfer></filter>`
      : "") +
    (options.tile ? `<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232327"/><stop offset="1" stop-color="#0A0A0C"/></linearGradient>` : "") +
    `</defs>`;

  const d = bodyPath(avatar.shape);
  const rot = b.rot ? ` transform="rotate(${b.rot} ${n(b.l + b.w / 2)} ${n(b.t + b.h / 2)})"` : "";
  const bead = `<circle cx="${b.bl + 6}" cy="${b.bt + 6}" r="6"`;
  // Dark outline: the canvas uses four 1.6px drop-shadows around bead + body; a 3.2px stroke under the fills
  // leaves the same 1.6px ring outside the union.
  const outline =
    `<g stroke="${INK}" stroke-width="3.2" stroke-linejoin="round" fill="${INK}">${bead}/><path d="${d}"${rot}/></g>` +
    `${bead} fill="url(#${id}d)"/><path d="${d}"${rot} fill="url(#${id}b)" filter="url(#${id}i)"/>`;
  const hl = { l: b.l + b.w * 0.2, t: b.t + b.h * 0.12, w: b.w * 0.22, h: b.h * 0.11 };
  const highlight = `<ellipse cx="${n(hl.l + hl.w / 2)}" cy="${n(hl.t + hl.h / 2)}" rx="${n(hl.w / 2)}" ry="${n(hl.h / 2)}" fill="#FFFFFF" opacity="0.7" filter="url(#${id}h)" transform="rotate(-28 ${n(hl.l + hl.w / 2)} ${n(hl.t + hl.h / 2)})"/>`;
  const cheeks = `<g fill="${accent}" opacity="0.45" filter="url(#${id}c)"><ellipse cx="32" cy="57.5" rx="5" ry="2.5"/><ellipse cx="68" cy="57.5" rx="5" ry="2.5"/></g>`;
  const faceT = b.fs === 1 ? `translate(${b.fx} ${b.fy})` : `translate(${b.fx} ${b.fy}) translate(50 50) scale(${b.fs}) translate(-50 -50)`;
  const face = `<g transform="${faceT}">${cheeks}${eyes(eye, st, accent, `${id}g`)}${mouth(mouthKind)}</g>`;
  const shadow = `<ellipse cx="50" cy="93.5" rx="28" ry="3.5" fill="#000000" opacity="0.35" filter="url(#${id}f)"/>`;

  const anim = st === "idle" || st === "listening" || st === "talking" ? bob("3.4s") : st === "happy" ? bob("1.1s") : "";
  const paused = st === "paused" ? ` filter="url(#${id}p)"` : "";
  const extras = overlays(st, accent, id);
  const figure = `${extras.back}<g${paused}>${anim}${shadow}${outline}${highlight}${face}</g>${extras.front}`;

  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`;
  const tail = ` role="img" aria-label="avatar ${st}">${defs}`;
  if (options.tile)
    return `${head} viewBox="0 0 140 140"${tail}<rect width="140" height="140" rx="18" fill="url(#${id}t)"/><g transform="translate(20 20)">${figure}</g></svg>`;
  // The badges sit at top: -2px on the canvas; shifting the view up 2 units keeps them whole.
  return `${head} viewBox="0 -2 100 100"${tail}${figure}</svg>`;
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
