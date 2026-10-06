import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeforeSend } from "./beforeSend";

const redactState = vi.hoisted(() => ({ throws: false }));
vi.mock("@/lib/redact", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/redact")>();
  return {
    ...real,
    redactText: (...args: Parameters<typeof real.redactText>) => {
      if (redactState.throws) throw new Error("boom");
      return real.redactText(...args);
    },
  };
});

const EMAIL = "jane.doe@example.com"; // 20 characters
const EMAIL_PARTS = ["jane", ".doe", "@", "exam", "mple", ".com"];

function fullEvent() {
  return {
    event_id: "abc123",
    timestamp: 1700000000,
    level: "error",
    platform: "node",
    environment: "production",
    release: "1.2.3",
    message: `failed for ${EMAIL}`,
    exception: {
      values: [
        {
          type: "TypeError",
          value: `cannot read ${EMAIL}`,
          mechanism: { type: "onerror", handled: false, data: { secret: "x" }, synthetic: true },
          stacktrace: {
            frames: [
              {
                filename: "app:///src/lib/x.ts",
                function: "doThing",
                lineno: 10,
                colno: 5,
                in_app: true,
                vars: { password: "hunter2" },
                context_line: "const secret = 1",
                abs_path: "/home/u/x.ts",
              },
            ],
          },
        },
      ],
    },
    tags: { route: `/api/users/${EMAIL}`, runtime: "nodejs", workspace: "acme" },
    request: {
      method: "POST",
      url: "https://app.example.org/api/x?token=abc#frag",
      cookies: { session: "s" },
      headers: { authorization: "Bearer t" },
      data: { body: "secret" },
      query_string: "token=abc",
    },
    user: { id: "u1", email: EMAIL },
    breadcrumbs: [{ message: "clicked" }],
    extra: { foo: "bar" },
    contexts: { os: { name: "mac" } },
    transaction: "/api/x",
    modules: { react: "19" },
    sdk: { name: "sdk.javascript" },
    server_name: "host-1",
    surprise: "unknown",
  };
}

describe("makeBeforeSend", () => {
  beforeEach(() => {
    redactState.throws = false;
  });

  it("drops every non-allowlisted field", () => {
    const out = makeBeforeSend(() => {})(fullEvent()) as Record<string, unknown>;
    const req = out.request as Record<string, unknown>;
    const tags = out.tags as Record<string, unknown>;
    expect(req).not.toHaveProperty("cookies");
    expect(req).not.toHaveProperty("data");
    expect(req).not.toHaveProperty("headers");
    expect(req).not.toHaveProperty("url");
    expect(req).not.toHaveProperty("query_string");
    expect(out).not.toHaveProperty("user");
    expect(out).not.toHaveProperty("breadcrumbs");
    expect(out).not.toHaveProperty("extra");
    expect(out).not.toHaveProperty("contexts");
    const frame = (out.exception as { values: { stacktrace: { frames: Record<string, unknown>[] } }[] }).values[0]
      .stacktrace.frames[0];
    expect(frame).not.toHaveProperty("vars");
    expect(out).not.toHaveProperty("transaction");
    expect(out).not.toHaveProperty("modules");
    expect(out).not.toHaveProperty("sdk");
    expect(out).not.toHaveProperty("server_name");
    expect(tags).not.toHaveProperty("workspace");
    expect(out).not.toHaveProperty("surprise");
    expect(req).toEqual({ method: "POST" });
    expect(JSON.stringify(out)).not.toContain("token=abc");
    expect(JSON.stringify(out)).not.toContain("frag");
  });

  it("keeps scalar fields only when they are strings or numbers", () => {
    const out = makeBeforeSend(() => {})({ ...fullEvent(), release: { v: 1 } })!;
    expect(out).toMatchObject({
      event_id: "abc123",
      timestamp: 1700000000,
      level: "error",
      platform: "node",
      environment: "production",
    });
    expect(out).not.toHaveProperty("release");
  });

  it("redacts the address in message, exception value and route tag", () => {
    const out = makeBeforeSend(() => {})(fullEvent())!;
    expect(out.message).toBeDefined();
    expect(out.message).not.toContain(EMAIL);
    expect(out.exception!.values[0].value).not.toContain(EMAIL);
    expect(out.tags!.route).not.toContain(EMAIL);
    expect(JSON.stringify(out)).not.toContain(EMAIL);
    expect(out.tags!.runtime).toBe("nodejs");
  });

  it("redacts a tag value before cutting it", () => {
    const route = "a".repeat(194) + " " + EMAIL + " " + "b".repeat(84);
    expect(route).toHaveLength(300);
    expect(route.slice(195, 215)).toBe(EMAIL);
    const out = makeBeforeSend(() => {})({ tags: { route } })!;
    expect(out.tags!.route!.length).toBeLessThanOrEqual(200);
    for (const part of EMAIL_PARTS) expect(out.tags!.route).not.toContain(part);
  });

  it("cuts a long message to 2000 characters", () => {
    const out = makeBeforeSend(() => {})({ message: "x".repeat(5000) })!;
    expect(out.message!.length).toBeLessThanOrEqual(2000);
  });

  it("reduces mechanism to type and handled and frames to the allowlist", () => {
    const ex = makeBeforeSend(() => {})(fullEvent())!.exception!.values[0];
    expect(ex.mechanism).toEqual({ type: "onerror", handled: false });
    expect(ex.stacktrace!.frames[0]).toEqual({
      filename: "app:///src/lib/x.ts",
      function: "doThing",
      lineno: 10,
      colno: 5,
      in_app: true,
    });
  });

  it("caps exceptions at 10 and keeps the last 100 frames", () => {
    const frames = Array.from({ length: 150 }, (_, i) => ({ lineno: i }));
    const values = Array.from({ length: 15 }, () => ({ type: "E", stacktrace: { frames } }));
    const out = makeBeforeSend(() => {})({ exception: { values } })!;
    expect(out.exception!.values).toHaveLength(10);
    const kept = out.exception!.values[0].stacktrace!.frames;
    expect(kept).toHaveLength(100);
    expect(kept[0].lineno).toBe(50);
    expect(kept[99].lineno).toBe(149);
  });

  it("returns null and calls onFailure once with no arguments when redaction throws", () => {
    redactState.throws = true;
    const onFailure = vi.fn();
    const event = fullEvent();
    const before = structuredClone(event);
    expect(makeBeforeSend(onFailure)(event)).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith();
    expect(event).toEqual(before);
  });

  it("does not mutate the input event", () => {
    const event = fullEvent();
    const before = structuredClone(event);
    makeBeforeSend(() => {})(event);
    expect(event).toEqual(before);
  });
});

describe("beforeSend.ts guard", () => {
  it("imports neither the log module nor the SDK", () => {
    const src = readFileSync(fileURLToPath(new URL("./beforeSend.ts", import.meta.url)), "utf8");
    expect(src).not.toContain("lib/log");
    expect(src).not.toContain("@" + "sentry");
  });
});
