// Origin allowlist and Host check. Electron-free.

export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://*-k3ntaws-projects.vercel.app",
  "https://ai-apprentice*.vercel.app",
];

export type OriginRule = { scheme: "http" | "https"; hostRe: RegExp; port: string; source: string };
export type Allowlist = { rules: OriginRule[]; errors: string[] };

const LABEL_CHARS = "[a-z0-9-]";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile one allowlist entry. Format: scheme://host[:port]. '*' is allowed only inside the
 * host's first label and matches [a-z0-9-]* (never a dot). Returns null when invalid.
 */
export function compileRule(entry: string): OriginRule | null {
  const m = /^(https?):\/\/([^/:?#\s]+)(?::(\d{1,5}))?\/?$/i.exec(entry.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase() as "http" | "https";
  const host = m[2].toLowerCase();
  const port = m[3] ?? "";
  const labels = host.split(".");
  if (labels.some((l) => l.length === 0)) return null;
  const [first, ...rest] = labels;
  if (rest.some((l) => l.includes("*"))) return null;
  if (!/^[a-z0-9*-]+$/.test(first) || !rest.every((l) => /^[a-z0-9-]+$/.test(l))) return null;
  if (first.replace(/\*/g, "").length === 0) return null; // bare '*' or '**'
  if (first.includes("*") && rest.length < 2) return null; // wildcard needs a registrable parent
  const firstRe = first.split("*").map(escapeRe).join(`${LABEL_CHARS}*`);
  const hostRe = new RegExp(`^${[firstRe, ...rest.map(escapeRe)].join("\\.")}$`);
  return { scheme, hostRe, port, source: entry.trim() };
}

/**
 * Build the allowlist from COMPANION_ALLOWED_ORIGINS. Unset means the defaults.
 * Set but empty, or with no valid entries, means DENY ALL (rules = []).
 */
export function parseAllowlist(env: string | undefined): Allowlist {
  const entries = env === undefined ? DEFAULT_ALLOWED_ORIGINS : env.split(",").map((s) => s.trim()).filter(Boolean);
  const rules: OriginRule[] = [];
  const errors: string[] = [];
  for (const e of entries) {
    const r = compileRule(e);
    if (r) rules.push(r);
    else errors.push(`invalid origin rule ignored: ${e}`);
  }
  if (env !== undefined && rules.length === 0) errors.push("COMPANION_ALLOWED_ORIGINS has no valid entries: all origins denied");
  return { rules, errors };
}

/** True when the Origin header exactly matches a rule (scheme, host, port). Missing or 'null' is rejected. */
export function isOriginAllowed(origin: string | undefined | null, list: Allowlist): boolean {
  if (typeof origin !== "string" || origin === "" || origin === "null") return false;
  const m = /^(https?):\/\/([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(origin);
  if (!m) return false;
  const [, scheme, host, port = ""] = m;
  const defaultPort = scheme === "https" ? "443" : "80";
  const norm = port === defaultPort ? "" : port;
  return list.rules.some((r) => {
    const rulePort = r.port === defaultPort ? "" : r.port;
    return r.scheme === scheme && rulePort === norm && r.hostRe.test(host);
  });
}

/** DNS-rebinding guard: the Host header must be loopback on our port. */
export function isHostAllowed(host: string | undefined, port: number): boolean {
  if (typeof host !== "string") return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}
