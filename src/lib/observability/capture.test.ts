// captureHandled500 (T-0322): off without SENTRY_DSN (no SDK load), one captureMessage + flush(2000) with it, never rejects.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = {
  captureMessage: vi.fn(),
  flush: vi.fn(async (_ms?: number) => true),
};

async function load(factory: () => unknown = () => sdk) {
  vi.resetModules();
  const spy = vi.fn(factory);
  vi.doMock("@sentry/nextjs", spy);
  const { captureHandled500 } = await import("./capture");
  return { captureHandled500, factory: spy };
}

beforeEach(() => {
  sdk.captureMessage.mockReset();
  sdk.flush.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.doUnmock("@sentry/nextjs");
  vi.unstubAllEnvs();
});

describe("captureHandled500", () => {
  it("DSN unset: resolves without loading the SDK", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { captureHandled500, factory } = await load();
    await expect(captureHandled500({ route: "/api/x", requestId: "r1" })).resolves.toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    expect(sdk.captureMessage).not.toHaveBeenCalled();
  });

  it("DSN set: one captureMessage with level error and the route tag, then flush(2000)", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.de.sentry.io/1");
    const { captureHandled500 } = await load();
    await captureHandled500({ route: "/api/x", requestId: "r1" });
    expect(sdk.captureMessage).toHaveBeenCalledTimes(1);
    expect(sdk.captureMessage).toHaveBeenCalledWith("handled 500", { level: "error", tags: { route: "/api/x" } });
    expect(sdk.flush).toHaveBeenCalledWith(2000);
    expect(sdk.captureMessage.mock.invocationCallOrder[0]).toBeLessThan(sdk.flush.mock.invocationCallOrder[0]);
  });

  it("never rejects: import failure, captureMessage throw, flush rejection, flush timeout", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.de.sentry.io/1");
    const failingImport = await load(() => {
      throw new Error("no sdk");
    });
    await expect(failingImport.captureHandled500({ route: "/a", requestId: "r" })).resolves.toBeUndefined();

    const { captureHandled500 } = await load();
    sdk.captureMessage.mockImplementationOnce(() => {
      throw new Error("sdk");
    });
    await expect(captureHandled500({ route: "/a", requestId: "r" })).resolves.toBeUndefined();
    sdk.flush.mockRejectedValueOnce(new Error("flush"));
    await expect(captureHandled500({ route: "/a", requestId: "r" })).resolves.toBeUndefined();
    sdk.flush.mockResolvedValueOnce(false);
    await expect(captureHandled500({ route: "/a", requestId: "r" })).resolves.toBeUndefined();
  });

  it("has no top-level @sentry import", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/observability/capture.ts", "src/lib/log/index.ts"])
      expect(readFileSync(f, "utf8")).not.toMatch(/^\s*import\s[^(]*["']@sentry\//m);
  });
});
