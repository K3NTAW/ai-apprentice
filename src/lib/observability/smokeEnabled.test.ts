import { describe, expect, it } from "vitest";
import { smokeEnabled } from "./smokeEnabled";

const DSN = "https://k@o0.ingest.de.sentry.io/0";

describe("smokeEnabled", () => {
  it("is false for SENTRY_SMOKE alone", () => {
    expect(smokeEnabled({ SENTRY_SMOKE: "1" })).toBe(false);
  });
  it("is false for SENTRY_DSN alone", () => {
    expect(smokeEnabled({ SENTRY_DSN: DSN })).toBe(false);
  });
  it("is false for an empty SENTRY_DSN with SENTRY_SMOKE=1", () => {
    expect(smokeEnabled({ SENTRY_SMOKE: "1", SENTRY_DSN: "" })).toBe(false);
  });
  it("is true for both", () => {
    expect(smokeEnabled({ SENTRY_SMOKE: "1", SENTRY_DSN: DSN })).toBe(true);
  });
});
