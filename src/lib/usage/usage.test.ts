import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/lib/auth/context";
import { consumeUsage, DEFAULT_CAPS } from ".";

const WS = "11111111-1111-4111-8111-111111111111";
const ENV = ["USAGE_CAP_VISION", "USAGE_CAP_DECIDE", "USAGE_CAP_WORKMAP", "USAGE_CAP_VOICE"];

function ctxWith(rpc: ReturnType<typeof vi.fn> | null, mode: "local" | "supabase" = "supabase"): RequestContext {
  return {
    mode,
    userId: "u1",
    email: null,
    workspaceId: mode === "local" ? "local" : WS,
    workspaceName: "W",
    role: "owner",
    supabase: rpc ? ({ rpc } as unknown as RequestContext["supabase"]) : null,
    memberships: [],
  };
}

beforeEach(() => {
  for (const k of ENV) vi.stubEnv(k, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("consumeUsage", () => {
  it("local mode allows without a DB call", async () => {
    expect(await consumeUsage(ctxWith(null, "local"), "vision")).toEqual({ allowed: true });
  });

  it("local mode with a client still makes no DB call", async () => {
    const rpc = vi.fn();
    expect(await consumeUsage(ctxWith(rpc, "local"), "decide")).toEqual({ allowed: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(Object.entries(DEFAULT_CAPS))("supabase mode sends the default %s cap when the env is unset", async (kind, cap) => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const r = await consumeUsage(ctxWith(rpc), kind as keyof typeof DEFAULT_CAPS);
    expect(r).toEqual({ allowed: true });
    expect(rpc).toHaveBeenCalledWith("consume_usage", { ws: WS, k: kind, cap });
  });

  it("uses the env cap when set", async () => {
    vi.stubEnv("USAGE_CAP_WORKMAP", "7");
    vi.stubEnv("USAGE_CAP_VOICE", "0");
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await consumeUsage(ctxWith(rpc), "workmap");
    await consumeUsage(ctxWith(rpc), "voice");
    expect(rpc).toHaveBeenNthCalledWith(1, "consume_usage", { ws: WS, k: "workmap", cap: 7 });
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_usage", { ws: WS, k: "voice", cap: 0 });
  });

  it("ignores a non-numeric env cap", async () => {
    vi.stubEnv("USAGE_CAP_DECIDE", "lots");
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await consumeUsage(ctxWith(rpc), "decide");
    expect(rpc).toHaveBeenCalledWith("consume_usage", { ws: WS, k: "decide", cap: 2000 });
  });

  it("answers 429 {error:'daily_limit', kind} when the RPC returns false", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const r = await consumeUsage(ctxWith(rpc), "vision");
    expect(r).toBeInstanceOf(Response);
    const res = r as Response;
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit", kind: "vision" });
  });

  it("answers 503 when the RPC fails, never allowing unmetered calls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const r = (await consumeUsage(ctxWith(rpc), "decide")) as Response;
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "usage_unavailable" });
  });
});
