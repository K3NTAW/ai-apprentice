// Handled 500 capture at the outermost request line (T-0322): exactly one capture per returned 500,
// none for throws or other statuses, none without SENTRY_DSN, and the response and line never change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ ctx: null as unknown, storeError: "" }));
vi.mock("@/lib/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/store")>()),
  getStore: () => {
    if (s.storeError) throw new Error(s.storeError);
    return {};
  },
}));
vi.mock("@/lib/auth/context", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/context")>()),
  requireContext: async () => s.ctx,
}));

const DSN = "https://k@o1.ingest.de.sentry.io/1";
const sdk = {
  captureMessage: vi.fn(),
  flush: vi.fn(async (_ms?: number) => true),
};

async function load(factory: () => unknown = () => sdk) {
  vi.resetModules();
  const spy = vi.fn(factory);
  vi.doMock("@sentry/nextjs", spy);
  const logMod = await import(".");
  const { withApi } = await import("@/app/api/session/_http");
  return { ...logMod, withApi, factory: spy };
}

let lines: Record<string, unknown>[] = [];
const requestLines = () => lines.filter((l) => l.event === "request");
const req = () => new Request("http://localhost/api/x", { method: "POST", headers: { "x-request-id": "rid-1" } });
const json = (status: number) => () => Response.json({ status }, { status });

beforeEach(() => {
  lines = [];
  for (const m of ["log", "warn", "error"] as const)
    vi.spyOn(console, m).mockImplementation((t: unknown) => {
      lines.push(JSON.parse(String(t)));
    });
  vi.stubEnv("FORWARDED_USER_SECRET", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("SENTRY_DSN", DSN);
  s.ctx = { mode: "supabase", userId: "u1", workspaceId: "ws-1", supabase: null, role: "owner" };
  s.storeError = "";
  sdk.captureMessage.mockReset();
  sdk.flush.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.doUnmock("@sentry/nextjs");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("handled 500 capture", () => {
  it("withRequestLog returning 500: one captureMessage with the route tag, after the request line", async () => {
    const { withRequestLog } = await load();
    sdk.captureMessage.mockImplementation(() => expect(requestLines()).toHaveLength(1));
    const res = await withRequestLog("/api/x", json(500))(req());
    expect(res.status).toBe(500);
    expect(sdk.captureMessage).toHaveBeenCalledTimes(1);
    expect(sdk.captureMessage).toHaveBeenCalledWith("handled 500", { level: "error", tags: { route: "/api/x" } });
    expect(requestLines()).toMatchObject([{ route: "/api/x", status: 500, requestId: "rid-1" }]);
    expect(requestLines()[0]).not.toHaveProperty("thrown");
  });

  it("nested logRequest or withApi under withRequestLog returning 500: exactly one capture", async () => {
    const { withRequestLog, logRequest, withApi } = await load();
    await withRequestLog("/api/outer", () => logRequest({ route: "/api/inner" }, json(500)))(req());
    expect(sdk.captureMessage).toHaveBeenCalledTimes(1);
    expect(sdk.captureMessage.mock.calls[0][1]).toMatchObject({ tags: { route: "/api/outer" } });

    sdk.captureMessage.mockClear();
    await withRequestLog("/api/outer", () => withApi({ route: "/api/inner" }, async () => json(500)()))(req());
    expect(sdk.captureMessage).toHaveBeenCalledTimes(1);
    expect(requestLines()).toHaveLength(2);
  });

  it("withApi: store_context_required (handled 500) is captured; 400, 404, 409, 502, 503 are not", async () => {
    const { withApi } = await load();
    s.storeError = "store_context_required";
    const res = await withApi({ route: "/api/session", req: req() }, async () => json(200)());
    expect(res.status).toBe(500);
    expect(sdk.captureMessage).toHaveBeenCalledTimes(1);
    expect(sdk.captureMessage.mock.calls[0][1]).toMatchObject({ tags: { route: "/api/session" } });

    sdk.captureMessage.mockClear();
    s.storeError = "supabase_not_configured";
    expect((await withApi({ route: "/api/session" }, async () => json(200)())).status).toBe(503);
    s.storeError = "";
    for (const status of [400, 404, 409, 502, 503])
      expect((await withApi({ route: "/api/session" }, async () => json(status)())).status).toBe(status);
    expect(sdk.captureMessage).not.toHaveBeenCalled();
  });

  it("other statuses and throws make zero captures; a throw propagates with thrown: true", async () => {
    const { withRequestLog } = await load();
    for (const status of [200, 400, 404, 409, 502, 503]) await withRequestLog("/api/x", json(status))(req());
    const boom = new Error("boom");
    await expect(
      withRequestLog("/api/x", () => {
        throw boom;
      })(req()),
    ).rejects.toBe(boom);
    expect(sdk.captureMessage).not.toHaveBeenCalled();
    expect(sdk.flush).not.toHaveBeenCalled();
    expect(requestLines().at(-1)).toMatchObject({ status: 500, thrown: true });
  });

  it("DSN unset: the SDK mock factory is never invoked for a 500", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { withRequestLog, factory } = await load();
    const res = await withRequestLog("/api/x", json(500))(req());
    expect(res.status).toBe(500);
    expect(factory).not.toHaveBeenCalled();
    expect(sdk.captureMessage).not.toHaveBeenCalled();
  });

  it("import rejection, captureMessage throw or flush rejection leave the response and line unchanged", async () => {
    const strip = (l: Record<string, unknown>) => ({ ...l, ts: 0, ms: 0 });
    const run = async (mod: Awaited<ReturnType<typeof load>>) => {
      lines = [];
      const res = await mod.withRequestLog("/api/x", json(500))(req());
      return { status: res.status, body: await res.json(), line: requestLines().map(strip) };
    };
    vi.stubEnv("SENTRY_DSN", "");
    const baseline = await run(await load());

    vi.stubEnv("SENTRY_DSN", DSN);
    expect(
      await run(
        await load(() => {
          throw new Error("no sdk");
        }),
      ),
    ).toEqual(baseline);

    const mod = await load();
    sdk.captureMessage.mockImplementationOnce(() => {
      throw new Error("sdk");
    });
    expect(await run(mod)).toEqual(baseline);
    sdk.flush.mockRejectedValueOnce(new Error("flush"));
    expect(await run(mod)).toEqual(baseline);
    expect(baseline).toMatchObject({ status: 500, body: { status: 500 }, line: [{ status: 500, route: "/api/x" }] });
  });
});
