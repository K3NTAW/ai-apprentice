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

// Narrow local views of an envelope item: header carries the type, payload is the event JSON.
type ItemHeader = { type: string };
type EventPayload = { sdk?: { settings?: { infer_ip?: unknown } } & Record<string, unknown>; tags?: Record<string, unknown> } & Record<
  string,
  unknown
>;
type Item = [ItemHeader, EventPayload];

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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    initServer({ transport });
    const consoleText = [...warn.mock.calls, ...error.mock.calls].map((args) => args.map(String).join(" ")).join("\n");
    warn.mockRestore();
    error.mockRestore();
    expect(consoleText.includes("beforeSendTransaction")).toBe(false);
    expect(consoleText.toLowerCase().includes("deprecated")).toBe(false);

    Sentry.withScope((scope) => {
      scope.setUser({ id: "user-id-77", email: "user-mail@example.org" });
      scope.setExtra("extraKey", "extra-value-42");
      scope.setTag("secret", "tag-secret-value");
      Sentry.addBreadcrumb({ message: "crumb for crumb.person@example.net" });
      Sentry.captureException(new Error("mail jane.doe@example.com"));
    });
    await Sentry.flush(2000);

    expect(recorded.length).toBeGreaterThan(0);
    const items = recorded.flatMap((env) => env[1] as unknown as Item[]);
    const types = items.map(([header]) => header.type);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === "event")).toBe(true);

    for (const [, event] of items) {
      for (const key of Object.keys(event)) expect([...ALLOWED_KEYS, "sdk"]).toContain(key);
      for (const key of Object.keys(event.sdk ?? {})) expect(SDK_KEYS).toContain(key);
      const inferIp = event.sdk?.settings?.infer_ip;
      if (inferIp !== undefined) expect(inferIp).toBe("never");
      const tagKeys = Object.keys(event.tags ?? {});
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
