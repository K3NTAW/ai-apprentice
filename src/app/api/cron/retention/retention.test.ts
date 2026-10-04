// /api/cron/retention: bearer CRON_SECRET or nothing. Signed-in users without the bearer get 401 too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ run: vi.fn(async () => ({ agents: 1, deleted: 2, more: false })), ctx: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireContext: h.ctx }));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => "local" }));
vi.mock("@/lib/agents/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/agents/admin")>()), runRetention: h.run, fileDataPort: () => ({}) }));

import { GET } from "./route";

const SECRET = "c".repeat(32);
const call = (auth?: string) => GET(new Request("http://localhost/api/cron/retention", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  h.run.mockClear();
  h.ctx.mockReset();
  h.ctx.mockResolvedValue({ userId: "u", role: "owner" });
});
afterEach(() => vi.unstubAllEnvs());

describe("cron retention route", () => {
  it("rejects requests without the CRON_SECRET bearer, even from a signed-in owner", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const auth of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(h.run).not.toHaveBeenCalled();
  });
  it("signed out without a bearer answers the requireContext response", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.ctx.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await call()).status).toBe(401);
  });
  it("fails closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });
  it("runs retention with the right bearer", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: 1, deleted: 2, more: false });
    expect(h.ctx).not.toHaveBeenCalled();
  });
});
