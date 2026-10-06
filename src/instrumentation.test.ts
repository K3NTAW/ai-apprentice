import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    factoryCalls: 0,
    order: [] as string[],
    tags: {} as Record<string, string>,
    tagsAtCapture: [] as Record<string, string>[],
  };
  const sdk = {
    init: vi.fn(),
    httpIntegration: vi.fn(() => ({ name: "Http" })),
    withScope: vi.fn((cb: (scope: unknown) => unknown) => {
      state.tags = {};
      return cb({ setTag: (k: string, v: string) => (state.tags[k] = v) });
    }),
    captureRequestError: vi.fn(() => {
      state.order.push("capture");
      state.tagsAtCapture.push({ ...state.tags });
    }),
    flush: vi.fn(async () => {
      state.order.push("flush");
      return true;
    }),
  };
  return { state, sdk };
});

vi.mock("@sentry/nextjs", () => {
  h.state.factoryCalls += 1;
  return h.sdk;
});

const request = { path: "/api/x/1", method: "GET", headers: {} };
const context = { routerKind: "App Router", routePath: "/api/x/[id]", routeType: "route" };

function env(dsn: string, runtime: string) {
  vi.stubEnv("SENTRY_DSN", dsn);
  vi.stubEnv("NEXT_RUNTIME", runtime);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.state.factoryCalls = 0;
  h.state.order = [];
  h.state.tags = {};
  h.state.tagsAtCapture = [];
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrumentation guards", () => {
  it("SENTRY_DSN unset: nothing imported", async () => {
    env("", "nodejs");
    const m = await import("./instrumentation");
    await m.register();
    await m.onRequestError(new Error("x"), request, context);
    expect(h.state.factoryCalls).toBe(0);
  });

  it("SENTRY_DSN set on edge: nothing imported", async () => {
    env("https://k@o0.ingest.de.sentry.io/0", "edge");
    const m = await import("./instrumentation");
    await m.register();
    await m.onRequestError(new Error("x"), request, context);
    expect(h.state.factoryCalls).toBe(0);
  });

  it("SENTRY_DSN set on nodejs: register() inits once with the fixed options", async () => {
    env("https://k@o0.ingest.de.sentry.io/0", "nodejs");
    const m = await import("./instrumentation");
    await m.register();
    expect(h.sdk.init).toHaveBeenCalledTimes(1);
    const opts = h.sdk.init.mock.calls[0][0];
    const { DATA_COLLECTION_OFF } = await import("./lib/observability/sentryServer");
    expect(opts).toMatchObject({
      dsn: "https://k@o0.ingest.de.sentry.io/0",
      tracesSampleRate: 0,
      sendClientReports: false,
      environment: "development",
      release: undefined,
    });
    expect(opts.dataCollection).toEqual(DATA_COLLECTION_OFF);
    expect(typeof opts.beforeSend).toBe("function");
    for (const key of ["sendDefaultPii", "enableLogs", "beforeSendTransaction"]) expect(opts).not.toHaveProperty(key);
  });
});

describe("onRequestError on nodejs", () => {
  beforeEach(() => env("https://k@o0.ingest.de.sentry.io/0", "nodejs"));

  it("captures once with route and runtime tags, then flushes 2000", async () => {
    const m = await import("./instrumentation");
    const err = new Error("boom");
    await m.onRequestError(err, request, context);
    expect(h.sdk.captureRequestError).toHaveBeenCalledTimes(1);
    expect(h.sdk.captureRequestError).toHaveBeenCalledWith(err, request, context);
    expect(h.state.tagsAtCapture[0]).toEqual({ route: "/api/x/[id]", runtime: "nodejs" });
    expect(h.sdk.flush).toHaveBeenCalledTimes(1);
    expect(h.sdk.flush).toHaveBeenCalledWith(2000);
    expect(h.state.order).toEqual(["capture", "flush"]);
  });

  it("resolves when captureRequestError throws", async () => {
    h.sdk.captureRequestError.mockImplementationOnce(() => {
      throw new Error("sdk");
    });
    const m = await import("./instrumentation");
    await expect(m.onRequestError(new Error("x"), request, context)).resolves.toBeUndefined();
  });

  it("resolves when flush rejects", async () => {
    h.sdk.flush.mockImplementationOnce(async () => {
      throw new Error("net");
    });
    const m = await import("./instrumentation");
    await expect(m.onRequestError(new Error("x"), request, context)).resolves.toBeUndefined();
  });
});

describe("initServer", () => {
  it("callers cannot override fixed options but can add a transport", async () => {
    env("https://k@o0.ingest.de.sentry.io/0", "nodejs");
    const { initServer, DATA_COLLECTION_OFF } = await import("./lib/observability/sentryServer");
    const x = () => ({ send: async () => ({}), flush: async () => true });
    initServer({ dataCollection: { userInfo: true }, beforeSend: undefined, transport: x });
    const opts = h.sdk.init.mock.calls[0][0];
    expect(opts.dataCollection).toEqual(DATA_COLLECTION_OFF);
    expect(typeof opts.beforeSend).toBe("function");
    expect(opts.transport).toBe(x);
  });

  it("drops ProcessSession and turns Http sessions off", async () => {
    env("https://k@o0.ingest.de.sentry.io/0", "nodejs");
    const { initServer } = await import("./lib/observability/sentryServer");
    initServer();
    const integrations = h.sdk.init.mock.calls[0][0].integrations;
    const out = integrations([{ name: "ProcessSession" }, { name: "Http" }, { name: "Other" }]);
    expect(out.map((i: { name: string }) => i.name)).toEqual(["Http", "Other"]);
    expect(h.sdk.httpIntegration).toHaveBeenCalledWith({ disableIncomingRequestSpans: true, sessions: false });
  });
});
