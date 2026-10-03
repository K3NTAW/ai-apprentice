// vision, decide, workmap and voice/signed-url answer 429 when consumeUsage denies,
// before any model, ElevenLabs or store call.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ storeCalls: [] as string[], usage: [] as string[] }));

vi.mock("@/lib/auth/context", () => ({
  requireContext: async () => ({
    mode: "supabase",
    userId: "u1",
    email: null,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    workspaceName: "W",
    role: "owner",
    supabase: {
      from: (t: string) => {
        state.storeCalls.push(`from:${t}`);
        throw new Error("no store in this test");
      },
    },
    memberships: [],
  }),
}));
vi.mock("@/lib/usage", () => ({
  consumeUsage: async (_ctx: unknown, kind: string) => {
    state.usage.push(kind);
    return Response.json({ error: "daily_limit", kind }, { status: 429 });
  },
}));
vi.mock("@/lib/store", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/store")>();
  const store = new Proxy(
    {},
    {
      get: (_t, prop) => () => {
        state.storeCalls.push(String(prop));
        throw new Error("no store in this test");
      },
    },
  );
  return { ...orig, getStore: () => store };
});
const describeFrame = vi.hoisted(() => vi.fn());
vi.mock("@/lib/perception/vision", () => ({ describeFrame }));
const decideMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/decide", () => ({ decideMany }));
const synthesizeWorkMap = vi.hoisted(() => vi.fn());
const scoreWorkMap = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workmap")>()),
  synthesizeWorkMap,
  scoreWorkMap,
}));

import { POST as decidePost } from "./decide/route";
import { POST as visionPost } from "./vision/route";
import { GET as voiceGet } from "./voice/signed-url/route";
import { POST as workmapPost } from "./workmap/route";

const post = (body: unknown) => new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify(body) });

const fetchMock = vi.fn(async () => Response.json({ signed_url: "wss://example.test" }));

beforeEach(() => {
  state.storeCalls = [];
  state.usage = [];
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.stubEnv("ELEVENLABS_API_KEY", "test");
  vi.stubEnv("ELEVENLABS_AGENT_ID_INTERVIEWER", "agent");
});

const CASES: { name: string; kind: string; call: () => Promise<Response> }[] = [
  { name: "vision", kind: "vision", call: () => visionPost(post({ session_id: "s1", t: 1, frame: "aGVsbG8=" })) },
  { name: "decide", kind: "decide", call: () => decidePost(post({ question: "event_class", state: {} })) },
  { name: "workmap", kind: "workmap", call: () => workmapPost(post({ session_id: "s1" })) },
  {
    name: "voice/signed-url",
    kind: "voice",
    call: () => voiceGet(new Request("http://localhost/api/voice/signed-url?role=interviewer")),
  },
];

describe("daily usage cap on the paid routes", () => {
  it.each(CASES)("$name answers 429 daily_limit without calling the model, ElevenLabs or the store", async ({ kind, call }) => {
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit", kind });
    expect(state.usage).toEqual([kind]);
    expect(describeFrame).not.toHaveBeenCalled();
    expect(decideMany).not.toHaveBeenCalled();
    expect(synthesizeWorkMap).not.toHaveBeenCalled();
    expect(scoreWorkMap).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.storeCalls).toEqual([]);
  });
});
