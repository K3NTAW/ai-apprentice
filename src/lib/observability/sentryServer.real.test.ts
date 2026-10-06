// Real SDK, no vi.mock of @sentry/nextjs. In-memory transport: records envelopes, no network call. Never prints an envelope.
import * as Sentry from "@sentry/nextjs";
import type { NodeOptions } from "@sentry/nextjs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { initServer } from "./sentryServer";

const ALLOWED_KEYS = [
  "event_id",
  "timestamp",
  "level",
  "platform",
  "environment",
  "release",
  "message",
  "exception",
  "tags",
  "request",
];
// Added by the SDK in createEventEnvelope, after beforeSend: SDK name, version, integration names, package versions.
const SDK_KEYS = ["name", "version", "integrations", "packages", "settings"];

type TransportFactory = NonNullable<NodeOptions["transport"]>;
type Envelope = Parameters<ReturnType<TransportFactory>["send"]>[0];

const recorded: Envelope[] = [];
const transport: TransportFactory = () => ({
  send: async (envelope) => {
    recorded.push(envelope);
    return { statusCode: 200 };
  },
  flush: async () => true,
});

afterAll(async () => {
  await Sentry.close(2000);
  vi.unstubAllEnvs();
});

describe("initServer with the real SDK", () => {
  it("sends only scrubbed error events", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o0.ingest.de.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    initServer({ transport });

    Sentry.withScope((scope) => {
      scope.setUser({ id: "user-id-77", email: "user-mail@example.org" });
      scope.setExtra("extraKey", "extra-value-42");
      scope.setTag("secret", "tag-secret-value");
      Sentry.addBreadcrumb({ message: "crumb for crumb.person@example.net" });
      Sentry.captureException(new Error("mail jane.doe@example.com"));
    });
    await Sentry.flush(2000);

    expect(recorded.length).toBeGreaterThan(0);
    const items = recorded.flatMap((env) => env[1]);
    const types = items.map(([header]) => (header as { type: string }).type);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === "event")).toBe(true);

    for (const [, payload] of items) {
      const event = payload as Record<string, unknown>;
      for (const key of Object.keys(event)) expect([...ALLOWED_KEYS, "sdk"]).toContain(key);
      for (const key of Object.keys((event.sdk as Record<string, unknown>) ?? {})) expect(SDK_KEYS).toContain(key);
      const tagKeys = Object.keys((event.tags as Record<string, unknown>) ?? {});
      for (const key of tagKeys) expect(["route", "runtime"]).toContain(key);
    }

    const text = JSON.stringify(items);
    for (const needle of [
      "jane.doe@example.com",
      "user-id-77",
      "user-mail@example.org",
      "extra-value-42",
      "crumb.person@example.net",
      "tag-secret-value",
    ]) {
      expect(text.includes(needle), `leaked value #${needle.length}`).toBe(false);
    }
  });
});
