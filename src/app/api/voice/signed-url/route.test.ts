// GET /api/voice/signed-url issues a voice usage token through insertUsageEvent; metering never blocks voice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WS = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  mode: "supabase" as "supabase" | "local",
  rows: [] as Record<string, unknown>[],
  insert: (async () => ({ error: null })) as () => Promise<{ error: { code?: string; message?: string } | null }>,
  warn: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  requireContext: async () => ({
    mode: h.mode,
    userId: "u1",
    email: null,
    workspaceId: WS,
    workspaceName: "W",
    role: "learner",
    supabase: null,
    memberships: [],
  }),
}));
vi.mock("@/lib/usage", () => ({ consumeUsage: async () => ({ ok: true }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.rows.push(row);
        return { abortSignal: () => h.insert() };
      },
    }),
  }),
}));
vi.mock("@/lib/log", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/log")>();
  return { ...orig, log: { info: vi.fn(), warn: h.warn, error: vi.fn() } };
});

import { GET } from "./route";

const get = () => GET(new Request("http://x/api/voice/signed-url?role=interviewer"));
const usageWarns = () => h.warn.mock.calls.filter((c) => c[0] === "usage.events");

beforeEach(() => {
  h.mode = "supabase";
  h.rows = [];
  h.insert = async () => ({ error: null });
  h.warn.mockReset();
  vi.stubEnv("USAGE_EVENTS", "");
  vi.stubEnv("ELEVENLABS_API_KEY", "k");
  vi.stubEnv("ELEVENLABS_AGENT_ID_INTERVIEWER", "agent");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: "wss://example/signed" })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/voice/signed-url usage token", () => {
  it("inserts a voice row with null seconds and returns its token", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signed_url).toBe("wss://example/signed");
    expect(body.usage_token).toMatch(/^v_[0-9a-f-]{36}$/);
    expect(h.rows).toEqual([
      expect.objectContaining({ kind: "voice", session_id: body.usage_token, voice_seconds: null, workspace_id: WS, user_id: "u1" }),
    ]);
    expect(usageWarns()).toEqual([]);
  });

  it.each([
    ["insert error", async () => ({ error: { code: "XX000", message: "boom" } })],
    ["conflict", async () => ({ error: { code: "23505" } })],
    ["insert throws", async () => Promise.reject(new Error("down"))],
  ])("on %s still returns the signed url, no token and one usage.events warn", async (_name, insert) => {
    h.insert = insert;
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signed_url: "wss://example/signed" });
    expect(usageWarns()).toHaveLength(1);
  });

  it("returns no token with USAGE_EVENTS=0 and in local mode, without an insert", async () => {
    vi.stubEnv("USAGE_EVENTS", "0");
    expect(await (await get()).json()).toEqual({ signed_url: "wss://example/signed" });
    vi.stubEnv("USAGE_EVENTS", "");
    h.mode = "local";
    expect(await (await get()).json()).toEqual({ signed_url: "wss://example/signed" });
    expect(h.rows).toEqual([]);
    expect(usageWarns()).toEqual([]);
  });
});
