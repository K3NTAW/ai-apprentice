// Interaction audit helpers (T-0166): record controls from JSX props, classify them, parse the audit doc.
import Link from "next/link";

export type Seen = { route: string; tag: string; label: string; action: string };
export type Status = "works" | "app-only" | "disabled" | "dead";

type Rec = { route: string; seen: Map<string, unknown> };
type Props = Record<string, unknown>;

export function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) {
    const p = (node as { props: Props }).props;
    return typeof p["aria-label"] === "string" ? p["aria-label"] : textOf(p.children);
  }
  return "";
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, 60).trim();

function actionOf(tag: string, p: Props): string {
  if (typeof p.href === "string" || (p.href && typeof p.href === "object")) return `href ${typeof p.href === "string" ? p.href.split("?")[0] : "(object)"}`;
  if (typeof p.onClick === "function") return "onClick";
  if (p.type === "submit") return "submit";
  const disabled = p.disabled === true || p["aria-disabled"] === true || p["aria-disabled"] === "true";
  const reason = typeof p["data-reason"] === "string" ? p["data-reason"] : typeof p.title === "string" ? p.title : "";
  if (disabled && reason) return `${p["data-app-only"] ? "app-only" : "disabled"}: ${reason}`;
  if (disabled) return "disabled, no reason";
  return tag === "a" ? "no href" : "none";
}

/** JSX runtime hook: keeps host buttons/links, role=button elements and components given an href. */
export function record(rec: Rec, type: unknown, props: Props | null) {
  if (!props || !rec.route) return;
  const host = typeof type === "string";
  const tag = host ? (type as string) : "Link";
  const isControl = host ? type === "button" || type === "a" || props.role === "button" : type === Link;
  if (!isControl) return;
  const raw = (typeof props["aria-label"] === "string" && props["aria-label"]) || textOf(props.children) || (typeof props.title === "string" ? props.title : "") || "(icon)";
  const label = clean(raw) || "(icon)";
  const s: Seen = { route: rec.route, tag: tag === "Link" ? "a" : props.role === "button" && tag !== "button" ? "role=button" : tag, label, action: actionOf(tag, props) };
  const k = auditKey(s);
  if (!rec.seen.has(k)) rec.seen.set(k, s);
}

export const auditKey = (s: Pick<Seen, "route" | "tag" | "label">) => `${s.route} | ${s.tag} | ${s.label}`;

export function classify(s: Seen): Status {
  if (s.action.startsWith("app-only:")) return "app-only";
  if (s.action.startsWith("disabled:")) return "disabled";
  if (s.action === "none" || s.action === "no href" || s.action === "disabled, no reason") return "dead";
  return "works";
}

/** Table rows are `| route | tag | label | ... |`; the remaining list is `- route | tag | label: reason` under "## Remaining". */
export function audit(doc: string): { rows: Set<string>; remaining: Set<string> } {
  const rows = new Set<string>();
  const remaining = new Set<string>();
  let inRemaining = false;
  for (const line of doc.split("\n")) {
    if (line.startsWith("## ")) inRemaining = line.startsWith("## Remaining");
    if (inRemaining && line.startsWith("- `")) remaining.add(line.slice(3, line.indexOf("`", 3)));
    const m = /^\| (\/[^|]*) \| ([^|]+) \| ([^|]+) \|/.exec(line);
    if (m) rows.add(`${m[1].trim()} | ${m[2].trim()} | ${m[3].trim()}`);
  }
  return { rows, remaining };
}

/** The shell (sidebar, user menu) renders on every app page; list its controls once, under the shell routes. */
export function collapseShell(seen: Seen[], shellRoutes: readonly string[]): Seen[] {
  const sig = (s: Seen) => `${s.tag} | ${s.label} | ${s.action}`;
  const shell = new Set(seen.filter((s) => shellRoutes.includes(s.route)).map(sig));
  return seen.filter((s) => shellRoutes.includes(s.route) || !shell.has(sig(s)));
}
