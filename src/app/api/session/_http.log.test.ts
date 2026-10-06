// withApi request lines (T-0310): one line per call, the requireContext early return included; throws propagate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<typeof import("@/lib/store")>()), getStore: () => ({}) }));
vi.mock("@/lib/auth/context", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/context")>()),
  requireContext: async () => s.ctx,
}));

import { withApi, withMutation } from "./_http";

const SALT = "fixture-salt-0123456789";
let lines: Record<string, unknown>[] = [];
const requestLines = () => lines.filter((l) => l.event === "request");
const req = (method = "GET") => new Request("http://localhost/api/session", { method, headers: { "x-request-id": "rid-9" } });

beforeEach(() => {
  lines = [];
  for (const m of ["log", "warn", "error"] as const)
    vi.spyOn(console, m).mockImplementation((t: unknown) => {
      lines.push(JSON.parse(String(t)));
    });
  vi.stubEnv("FORWARDED_USER_SECRET", SALT);
  s.ctx = { mode: "supabase", userId: "u1", workspaceId: "ws-1", supabase: null, role: "owner" };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("withApi request line", () => {
  it("logs exactly one line with route, method, status, ms, requestId and the hashed workspace", async () => {
    const res = await withApi({ route: "/api/session", req: req() }, async () => Response.json({ ok: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(requestLines()).toHaveLength(1);
    const [l] = requestLines();
    expect(l).toMatchObject({ route: "/api/session", method: "GET", status: 200, requestId: "rid-9" });
    expect(typeof l.ms).toBe("number");
    expect(l.workspace).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(lines)).not.toContain("ws-1");
    expect(JSON.stringify(lines)).not.toContain(SALT);
  });

  it("logs the requireContext early return once, status and body unchanged", async () => {
    s.ctx = Response.json({ error: "unauthorized" }, { status: 401 });
    const fn = vi.fn(async () => Response.json({}));
    const res = await withApi({ route: "/api/session", req: req() }, fn);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fn).not.toHaveBeenCalled();
    expect(requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ status: 401, route: "/api/session" });
    expect("workspace" in requestLines()[0]).toBe(false);
  });

  it("a throwing handler logs status 500 thrown: true and the same error propagates", async () => {
    const err = new Error("unexpected");
    await expect(
      withApi({ route: "/api/session", req: req() }, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ status: 500, thrown: true, level: "error" });
  });

  it("a mapped store error keeps its status and logs one line", async () => {
    const res = await withApi({ route: "/api/session", req: req() }, async () => {
      throw new Error("supabase_not_configured");
    });
    expect(res.status).toBe(503);
    expect(requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ status: 503 });
  });

  it("withMutation logs one line; withApi without a scope still logs one", async () => {
    await withMutation(["sessions"], { route: "/api/session", req: req("POST") }, async () => Response.json({}, { status: 201 }));
    expect(requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ method: "POST", status: 201 });
    await withApi(async () => Response.json({}));
    expect(requestLines()).toHaveLength(2);
  });

  it('the workspace field is "local" without a salt', async () => {
    vi.stubEnv("FORWARDED_USER_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await withApi({ route: "/api/session", req: req() }, async () => Response.json({}));
    expect(requestLines()[0].workspace).toBe("local");
  });
});
