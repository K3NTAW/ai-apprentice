import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { factoryCalls: 0 };
  const sdk = { init: vi.fn() };
  return { state, sdk };
});

vi.mock("@sentry/nextjs", () => {
  h.state.factoryCalls += 1;
  return h.sdk;
});

const DSN = "https://k@o0.ingest.de.sentry.io/0";

function env(dsn: string) {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "");
}

beforeEach(() => {
  vi.resetModules();
  h.state.factoryCalls = 0;
  h.sdk.init.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrumentation-client", () => {
  it("imports nothing when NEXT_PUBLIC_SENTRY_DSN is empty", async () => {
    env("");
    await import("./instrumentation-client");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state.factoryCalls).toBe(0);
    expect(h.sdk.init).not.toHaveBeenCalled();
  });

  it("calls init once with the fixed options when NEXT_PUBLIC_SENTRY_DSN is set", async () => {
    env(DSN);
    await import("./instrumentation-client");
    await vi.waitFor(() => expect(h.sdk.init).toHaveBeenCalledTimes(1));
    const opts = h.sdk.init.mock.calls[0][0];
    expect(opts).toMatchObject({
      dsn: DSN,
      tracesSampleRate: 0,
      sendClientReports: false,
      environment: "development",
      release: undefined,
    });
    // 11.4.0 has no sendDefaultPii option: dataCollection.userInfo is its replacement.
    expect(opts.sendDefaultPii).not.toBe(true);
    expect(opts.dataCollection.userInfo).toBe(false);
    expect(opts.beforeSend).toBeTypeOf("function");
    expect(opts.beforeSendTransaction()).toBeNull();
    const kept = opts.integrations([{ name: "GlobalHandlers" }, { name: "BrowserSession" }, { name: "BrowserTracing" }]);
    expect(kept.map((i: { name: string }) => i.name)).toEqual(["GlobalHandlers"]);
  });

  it("uses the Vercel env and commit when set", async () => {
    env(DSN);
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "abc123");
    await import("./instrumentation-client");
    await vi.waitFor(() => expect(h.sdk.init).toHaveBeenCalledTimes(1));
    expect(h.sdk.init.mock.calls[0][0]).toMatchObject({ environment: "production", release: "abc123" });
  });
});

describe("browser source guard", () => {
  const files = ["./lib/observability/sentryClient.ts", "./instrumentation-client.ts"];
  for (const f of files) {
    const text = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
    it(`${f} does not import the Node-only logger`, () => {
      expect(text).not.toContain("lib/log");
    });
    it(`${f} reads the DSN as a literal expression`, () => {
      expect(text).toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
    });
  }
});
