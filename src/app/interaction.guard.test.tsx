// Interaction guard (T-0166). Renders every page in local mode with fixture data and records the props of every
// button, [role=button] and link through a wrapped JSX runtime, so handlers stay visible even under SSR (no jsdom).
// An element passes with an href, an onClick, type=submit, or disabled with a stated reason (title or data-reason).
// Limits: only the initial render is seen (menus and dialogs that open on click are covered by the behaviour tests),
// and links inside node_modules components (next/link) are seen as the Link element with its href prop.
import { readFileSync, writeFileSync } from "node:fs";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { audit, auditKey, classify, collapseShell, type Seen } from "@/lib/audit/interactions";
import { ALLOWLIST } from "@/lib/audit/allowlist";

const rec = vi.hoisted(() => ({ route: "", seen: new Map<string, unknown>() }));

vi.mock("react/jsx-dev-runtime", async (orig) => {
  const real = await orig<typeof import("react/jsx-dev-runtime")>();
  const { record } = await import("@/lib/audit/interactions");
  return {
    ...real,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      record(rec, type, props);
      return (real.jsxDEV as (...a: unknown[]) => unknown)(type, props, ...rest);
    },
  };
});
vi.mock("react/jsx-runtime", async (orig) => {
  const real = await orig<typeof import("react/jsx-runtime")>();
  const { record } = await import("@/lib/audit/interactions");
  const wrap = (fn: (...a: unknown[]) => unknown) => (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
    record(rec, type, props);
    return fn(type, props, ...rest);
  };
  return { ...real, jsx: wrap(real.jsx as never), jsxs: wrap(real.jsxs as never) };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useParams: () => ({ id: "preview" }),
  usePathname: () => "/agents",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
  headers: async () => new Headers(),
}));

import { ROUTES, SHELL_ROUTES } from "./__audit/routes";

const DOC = "docs/checks/interaction-audit.md";

async function renderAll(): Promise<Seen[]> {
  const out: Seen[] = [];
  for (const r of ROUTES) {
    rec.route = r.route;
    rec.seen = new Map();
    try {
      const { prelude } = await prerender(await r.render(), { onError: () => {} });
      await new Response(prelude).text();
    } catch (e) {
      // Local mode redirects some routes (login -> app) and the empty local store 404s real ids; their components are
      // covered by the preview routes with fixture data.
      if (!/NEXT_REDIRECT|NEXT_NOT_FOUND/.test(String(e))) throw new Error(`${r.route}: ${String(e)}`);
    }
    for (const s of rec.seen.values()) out.push(s as Seen);
  }
  return collapseShell(out, SHELL_ROUTES);
}

describe("interaction guard", () => {
  it("no rendered control lacks an action unless disabled with a reason (or allowlisted)", async () => {
    const seen = await renderAll();
    expect(seen.length).toBeGreaterThan(50);
    if (process.env.AUDIT_WRITE) writeFileSync(process.env.AUDIT_WRITE, JSON.stringify(seen.map((s) => ({ ...s, status: classify(s) })), null, 1));
    const allowed = new Set(ALLOWLIST.map((a) => a.key));
    const dead = seen.filter((s) => classify(s) === "dead" && !allowed.has(auditKey(s))).map(auditKey);
    expect(dead).toEqual([]);
    // Allowlist entries must still exist and still be dead, else they go.
    const deadNow = new Set(seen.filter((s) => classify(s) === "dead").map(auditKey));
    expect(ALLOWLIST.filter((a) => !deadNow.has(a.key)).map((a) => a.key)).toEqual([]);
    for (const a of ALLOWLIST) expect(a.reason.length).toBeGreaterThan(10);
  });

  it("audit doc lists exactly the rendered elements, and its remaining list matches the allowlist", async () => {
    const seen = await renderAll();
    const doc = readFileSync(DOC, "utf8");
    const { rows, remaining } = audit(doc);
    expect([...rows].sort()).toEqual([...new Set(seen.map(auditKey))].sort());
    expect([...remaining].sort()).toEqual(ALLOWLIST.map((a) => a.key).sort());
  });
});
