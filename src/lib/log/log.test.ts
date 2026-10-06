// Structured logs (T-0310): one JSON line per call, redaction, request ids, workspace hashing, request lines.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, logRequest, requestIdFrom, withRequestLog, workspaceHash } from ".";

const SALT = "fixture-salt-0123456789";
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  for (const m of ["log", "warn", "error"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
  vi.stubEnv("FORWARDED_USER_SECRET", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const req = (headers: Record<string, string> = {}, method = "POST") =>
  new Request("http://localhost/api/x", { method, headers });

describe("log.*", () => {
  it("writes one JSON line with ts, level, event and the fields", () => {
    log.info("hello", { n: 1, ok: true, nested: { a: [1, "b"] } });
    expect(lines).toHaveLength(1);
    const [l] = parsed();
    expect(l).toMatchObject({ level: "info", event: "hello", n: 1, ok: true, nested: { a: [1, "b"] } });
    expect(new Date(l.ts as string).toISOString()).toBe(l.ts);
    log.warn("w");
    log.error("e");
    expect(parsed().map((x) => x.level)).toEqual(["info", "warn", "error"]);
  });

  it("redacts string fields, nested ones included", () => {
    log.error("x", { error: "contact anna@example.com", deep: { list: ["call +41 79 123 45 67"] } });
    expect(lines[0]).not.toContain("anna@example.com");
    expect(lines[0]).not.toContain("123 45 67");
    const [l] = parsed();
    expect(l.error).toBe("contact <EMAIL_ADDRESS>");
    expect((l.deep as { list: string[] }).list[0]).toContain("<PHONE_NUMBER>");
  });

  it("circular values and Errors do not throw; Errors log name, message and stack redacted", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const err = new TypeError("bad input from bob@example.com");
    expect(() => log.error("boom", { a, err, f: () => 1, big: BigInt(5) })).not.toThrow();
    const [l] = parsed();
    expect(l.a).toEqual({ name: "a", self: "[Circular]" });
    const e = l.err as { name: string; message: string; stack: string };
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("bad input from <EMAIL_ADDRESS>");
    expect(e.stack).toContain("TypeError");
    expect(e.stack).not.toContain("bob@example.com");
    expect(l.big).toBe("5");
    expect("f" in l).toBe(false);
  });

  it("ts, level and event cannot be overridden by fields", () => {
    log.info("real", { ts: "x", level: "error", event: "fake", requestId: "spoof" });
    const [l] = parsed();
    expect(l.level).toBe("info");
    expect(l.event).toBe("real");
    expect(l.ts).not.toBe("x");
    expect(l.requestId).toBeUndefined();
  });
});

describe("request id", () => {
  it("keeps a valid x-request-id", () => {
    expect(requestIdFrom(req({ "x-request-id": "abc_DEF-123" }))).toBe("abc_DEF-123");
  });

  it("replaces an invalid or missing x-request-id with a random id", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const bad of ["has space", "a".repeat(65), 'x";', "<script>"])
      expect(requestIdFrom(req({ "x-request-id": bad }))).toMatch(uuid);
    expect(requestIdFrom(req())).toMatch(uuid);
    expect(requestIdFrom(undefined)).toMatch(uuid);
    expect(requestIdFrom(req())).not.toBe(requestIdFrom(req()));
  });
});

describe("workspace id", () => {
  it("is a truncated sha256 salted with FORWARDED_USER_SECRET, else SUPABASE_SERVICE_ROLE_KEY", () => {
    vi.stubEnv("FORWARDED_USER_SECRET", SALT);
    const expected = createHash("sha256").update(`${SALT}:ws-1`).digest("hex").slice(0, 16);
    expect(workspaceHash("ws-1")).toBe(expected);
    expect(workspaceHash("ws-1")).not.toBe(createHash("sha256").update("ws-1").digest("hex").slice(0, 16));
    vi.stubEnv("FORWARDED_USER_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SALT);
    expect(workspaceHash("ws-1")).toBe(expected);
  });

  it('is the marker "local" when no salt is set', () => {
    expect(workspaceHash("ws-1")).toBe("local");
  });

  it("the salt never appears in a log line", async () => {
    vi.stubEnv("FORWARDED_USER_SECRET", SALT);
    await logRequest({ route: "/api/x", req: req() }, async (setWorkspace) => {
      setWorkspace("ws-1");
      log.info("inner", { workspace: workspaceHash("ws-1") });
      return Response.json({});
    });
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l).not.toContain(SALT);
    expect(parsed()[1].workspace).toBe(workspaceHash("ws-1"));
  });
});

describe("withRequestLog", () => {
  it("logs exactly one request line with route, method, status, ms and requestId", async () => {
    const handler = withRequestLog("/api/x", async () => Response.json({ ok: true }, { status: 201 }));
    const res = await handler(req({ "x-request-id": "rid-1" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(lines).toHaveLength(1);
    const [l] = parsed();
    expect(l).toMatchObject({ level: "info", event: "request", route: "/api/x", method: "POST", status: 201, requestId: "rid-1" });
    expect(typeof l.ms).toBe("number");
    expect("thrown" in l).toBe(false);
  });

  it("log.* inside the handler carries the request id", async () => {
    const handler = withRequestLog("/api/x", async () => {
      log.warn("inside");
      return new Response(null, { status: 204 });
    });
    await handler(req({ "x-request-id": "rid-2" }));
    expect(parsed().map((l) => [l.event, l.requestId])).toEqual([
      ["inside", "rid-2"],
      ["request", "rid-2"],
    ]);
  });

  it("a throwing handler logs status 500 thrown: true and the same error propagates", async () => {
    const err = new Error("kaputt");
    const handler = withRequestLog("/api/x", async () => {
      throw err;
    });
    await expect(handler(req())).rejects.toBe(err);
    expect(lines).toHaveLength(1);
    expect(parsed()[0]).toMatchObject({ level: "error", event: "request", route: "/api/x", status: 500, thrown: true });
  });

  it("passes the extra handler arguments through", async () => {
    const handler = withRequestLog("/api/x/[id]", async (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
      Response.json({ id: (await ctx.params).id }),
    );
    const res = await handler(req({}, "GET"), { params: Promise.resolve({ id: "7" }) });
    expect(await res.json()).toEqual({ id: "7" });
    expect(parsed()[0]).toMatchObject({ method: "GET", status: 200 });
  });
});
