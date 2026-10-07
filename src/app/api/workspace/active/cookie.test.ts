// The ws cookie POST /api/workspace/active sets (T-0353). wsCookieOptions (lib/auth/cookies) reads NODE_ENV on every
// call, not at import; the route is still re-imported after vi.resetModules per environment so nothing cached at
// module load can hide a difference.
import { afterEach, describe, expect, it, vi } from "vitest";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

const rows = [WS_A, WS_B].map((id, i) => ({ workspace_id: id, role: "owner", created_at: `2026-10-0${i + 1}T00:00:00Z`, workspaces: { name: `WS ${i}` } }));

function fakeQuery(result: unknown) {
  const q: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) : () => q) },
  );
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    from: () => fakeQuery({ data: rows, error: null }),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
  headers: async () => new Headers(),
}));

afterEach(() => vi.unstubAllEnvs());

async function post(env: "development" | "production", body: unknown) {
  vi.stubEnv("NODE_ENV", env);
  vi.resetModules();
  const { POST } = await import("./route");
  return POST(new Request("https://app.test/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const wsLines = (res: Response) => res.headers.getSetCookie().filter((l) => l.startsWith("ws="));

for (const env of ["development", "production"] as const) {
  describe(`ws cookie in ${env}`, () => {
    it("200: HttpOnly, SameSite=Lax, Path=/, Max-Age, the requested id; Secure only in production", async () => {
      const res = await post(env, { workspaceId: WS_B });
      expect(res.status).toBe(200);
      const lines = wsLines(res);
      expect(lines).toHaveLength(1);
      const [pair, ...attrs] = lines[0]!.split(/;\s*/);
      expect(decodeURIComponent(pair!.slice("ws=".length))).toBe(WS_B);
      const has = (re: RegExp) => attrs.some((a) => re.test(a));
      expect(has(/^HttpOnly$/i)).toBe(true);
      expect(has(/^SameSite=Lax$/i)).toBe(true);
      expect(has(/^Path=\/$/)).toBe(true);
      expect(has(/^Max-Age=[1-9]\d*$/i)).toBe(true);
      expect(has(/^Secure$/i)).toBe(env === "production");
    });

    it("403 (not a membership) sets no cookie", async () => {
      const res = await post(env, { workspaceId: OTHER });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    });

    for (const [label, body] of [["not a uuid", { workspaceId: "nope" }], ["not JSON", "{"]] as const) {
      it(`400 (${label}) sets no cookie`, async () => {
        const res = await post(env, body);
        expect(res.status).toBe(400);
        expect(res.headers.getSetCookie()).toEqual([]);
      });
    }
  });
}
