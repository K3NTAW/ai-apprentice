// Exact-origin allowlist and Host check. Electron-free. No wildcards anywhere.

/** Allowed only when the app is unpackaged (dev runs). */
export const DEV_ORIGIN = "http://localhost:3000";

export type OriginRule = { scheme: "http" | "https"; host: string; port: string; source: string };
export type Allowlist = { rules: OriginRule[]; errors: string[] };

/**
 * Compile one exact origin. Format: scheme://host[:port]. No wildcards: any '*' is invalid.
 * Returns null when invalid.
 */
export function compileRule(entry: string): OriginRule | null {
  const trimmed = entry.trim();
  if (trimmed.includes("*")) return null;
  const m = /^(https?):\/\/([^/:?#\s]+)(?::(\d{1,5}))?\/?$/i.exec(trimmed);
  if (!m) return null;
  const scheme = m[1].toLowerCase() as "http" | "https";
  const host = m[2].toLowerCase();
  const port = m[3] ?? "";
  const labels = host.split(".");
  if (labels.some((l) => !/^[a-z0-9-]+$/.test(l))) return null;
  return { scheme, host, port, source: trimmed };
}

/**
 * Exact extra origins from COMPANION_ALLOWED_ORIGINS (comma separated). Unset or empty adds nothing.
 * An entry with '*' is rejected with an error line; so is any other invalid entry.
 */
export function parseAllowlist(env: string | undefined): Allowlist {
  const entries = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rules: OriginRule[] = [];
  const errors: string[] = [];
  for (const e of entries) {
    if (e.includes("*")) {
      errors.push(`wildcard origin rejected (exact origins only): ${e}`);
      continue;
    }
    const r = compileRule(e);
    if (r) rules.push(r);
    else errors.push(`invalid origin rule ignored: ${e}`);
  }
  return { rules, errors };
}

/**
 * The single exact-origin list every trust decision uses (bridge, permissions, display media, navigation,
 * app_url, WebSocket Origin): the APP_URL origin, http://localhost:3000 only when unpackaged, and the exact
 * origins from COMPANION_ALLOWED_ORIGINS. No APP_URL yet: no APP_URL origin (the setup screen is local).
 */
export function buildAllowlist(opts: { appOrigin: string | null; isPackaged: boolean; env: string | undefined }): Allowlist {
  const rules: OriginRule[] = [];
  const errors: string[] = [];
  const add = (entry: string) => {
    const r = compileRule(entry);
    if (r) rules.push(r);
    else errors.push(`invalid origin rule ignored: ${entry}`);
  };
  if (opts.appOrigin !== null) add(opts.appOrigin);
  if (!opts.isPackaged) add(DEV_ORIGIN);
  const extra = parseAllowlist(opts.env);
  rules.push(...extra.rules);
  errors.push(...extra.errors);
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
    return r.scheme === scheme && rulePort === norm && r.host === host;
  });
}

/** DNS-rebinding guard: the Host header must be loopback on our port. */
export function isHostAllowed(host: string | undefined, port: number): boolean {
  if (typeof host !== "string") return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}
