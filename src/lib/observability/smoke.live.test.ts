// Live smoke check: sends one real event. Run with `npm run sentry:smoke` and SENTRY_DSN set.
import { describe, expect, it } from "vitest";
import { smokeEnabled } from "./smokeEnabled";

describe.skipIf(!smokeEnabled(process.env))("sentry smoke (live)", () => {
  it("captures one exception and flushes", async () => {
    const { initServer } = await import("./sentryServer");
    const Sentry = await import("@sentry/nextjs");
    initServer();
    Sentry.captureException(new Error("sentry smoke check"));
    await expect(Sentry.flush(5000)).resolves.toBe(true);
  }, 15000);
});
