// API tests for /api/workspace/*. The boundaries (env mode, the Supabase server client,
// next/headers) are mocked, so getRequestContext, requireContext and requireRole all run for real.
// A vi.mock of src/lib/auth/context replacing only getRequestContext would not take effect:
// requireContext calls it through the module-local binding.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  user: null as { id: string; email: string } | null,
  memberships: [] as { workspace_id: string; role: string; created_at: string; workspaces: { name: string } }[],
  cookie: undefined as string | undefined,
  results: {} as Record<string, Result>,
  queries: [] as { table: string; calls: Call[] }[],
}));

function fakeQuery(table: string) {
  const entry = { table, calls: [] as Call[] };
  state.queries.push(entry);
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          // The membership read (select with user_id filter) gets the membership rows; everything else gets the per-table result.
          const isMembershipRead =
            table === "workspace_members" && entry.calls.some(([m, a]) => m === "eq" && a[0] === "user_id") && entry.calls.some(([m]) => m === "select") && !entry.calls.some(([m]) => m === "delete");
          const r: Result = isMembershipRead ? { data: state.memberships, error: null } : (state.results[table] ?? { data: [], error: null });
          return (res: (v: Result) => unknown) => Promise.resolve(r).then(res);
        }
        return (...args: unknown[]) => {
          entry.calls.push([String(prop), args]);
          return q;
        };
      },
    },
  );
  return q;
}

vi.mock("@/lib/supabase/env", () => ({ appMode: () => state.mode }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      getSession: () => {
        throw new Error("getSession must not be called");
      },
    },
    from: (table: string) => fakeQuery(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "ws" && state.cookie ? { value: state.cookie } : undefined) }),
}));

import { POST as setActive } from "./active/route";
import { DELETE as revokeInvite, POST as createInvite } from "./invites/route";
import { DELETE as removeMember } from "./members/route";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const WS_X = "33333333-3333-4333-8333-333333333333";
const INVITE = "44444444-4444-4444-8444-444444444444";

const membership = (id: string, role: string, name = id.slice(0, 4)) => ({
  workspace_id: id,
  role,
  created_at: "2026-10-03T00:00:00Z",
  workspaces: { name },
});

function asRole(role: "owner" | "expert" | "learner") {
  state.memberships = [membership(WS_A, role), membership(WS_B, "learner")];
}

const jsonReq = (method: string, body: unknown, raw?: string) =>
  new Request("http://app.test/api/workspace/x", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });

async function read(res: Response) {
  return { status: res.status, body: await res.json() };
}

const mutation = (table: string) => state.queries.find((q) => q.table === table && q.calls.some(([m]) => m === "insert" || m === "delete"));

beforeEach(() => {
  state.mode = "supabase";
  state.user = { id: USER, email: "owner@example.com" };
  state.cookie = undefined;
  state.results = {};
  state.queries = [];
  asRole("owner");
});

const handlers: [string, () => Promise<Response>][] = [
  ["invites POST", () => createInvite(jsonReq("POST", { email: "a@example.com", role: "learner" }))],
  ["invites DELETE", () => revokeInvite(jsonReq("DELETE", { id: INVITE }))],
  ["members DELETE", () => removeMember(jsonReq("DELETE", { userId: OTHER }))],
  ["active POST", () => setActive(jsonReq("POST", { workspaceId: WS_B }))],
];

describe("every handler", () => {
  for (const [name, run] of handlers) {
    it(`${name}: local mode -> 400 local_mode`, async () => {
      state.mode = "local";
      expect(await read(await run())).toEqual({ status: 400, body: { error: "local_mode" } });
    });
    it(`${name}: signed out -> 401`, async () => {
      state.user = null;
      expect(await read(await run())).toEqual({ status: 401, body: { error: "unauthorized" } });
    });
    it(`${name}: misconfigured -> 503`, async () => {
      state.mode = "misconfigured";
      expect(await read(await run())).toEqual({ status: 503, body: { error: "supabase_not_configured" } });
    });
    it(`${name}: invalid JSON -> 400 invalid_input`, async () => {
      const res = await (name === "invites POST"
        ? createInvite(jsonReq("POST", null, "{"))
        : name === "invites DELETE"
          ? revokeInvite(jsonReq("DELETE", null, "{"))
          : name === "members DELETE"
            ? removeMember(jsonReq("DELETE", null, "{"))
            : setActive(jsonReq("POST", null, "{")));
      expect(await read(res)).toEqual({ status: 400, body: { error: "invalid_input" } });
    });
  }
});

describe("POST /api/workspace/invites", () => {
  it("rejects a malformed email and a role outside expert/learner", async () => {
    for (const body of [
      { email: "not-an-email", role: "learner" },
      { email: `${"a".repeat(250)}@example.com`, role: "learner" },
      { email: "a@example.com", role: "owner" },
      { email: "a@example.com" },
    ]) {
      expect(await read(await createInvite(jsonReq("POST", body)))).toEqual({ status: 400, body: { error: "invalid_input" } });
    }
    expect(mutation("workspace_invites")).toBeUndefined();
  });

  it("lower-cases the email and inserts with ctx workspace and user, 201", async () => {
    const row = { id: INVITE, workspace_id: WS_A, email: "new@example.com", role: "expert" };
    state.results.workspace_invites = { data: [row], error: null };
    const res = await createInvite(jsonReq("POST", { email: "  New@Example.COM ", role: "expert", workspace_id: WS_X }));
    expect(await read(res)).toEqual({ status: 201, body: row });
    const q = mutation("workspace_invites")!;
    expect(q.calls).toContainEqual([
      "insert",
      [{ workspace_id: WS_A, email: "new@example.com", role: "expert", invited_by: USER }],
    ]);
    expect(q.calls.some(([m]) => m === "select")).toBe(true);
  });

  it("uses the ws-cookie workspace only when it is a membership", async () => {
    state.memberships = [membership(WS_A, "learner"), membership(WS_B, "owner")];
    state.cookie = WS_B;
    state.results.workspace_invites = { data: [{ id: INVITE }], error: null };
    await createInvite(jsonReq("POST", { email: "a@example.com", role: "learner" }));
    expect(mutation("workspace_invites")!.calls[0][1][0]).toMatchObject({ workspace_id: WS_B });
  });

  it("403 for a non-owner", async () => {
    for (const role of ["expert", "learner"] as const) {
      asRole(role);
      expect(await read(await createInvite(jsonReq("POST", { email: "a@example.com", role: "learner" })))).toEqual({
        status: 403,
        body: { error: "forbidden" },
      });
    }
    expect(mutation("workspace_invites")).toBeUndefined();
  });

  it("409 on postgres 23505", async () => {
    state.results.workspace_invites = { data: null, error: { code: "23505", message: "duplicate key" } };
    expect(await read(await createInvite(jsonReq("POST", { email: "a@example.com", role: "learner" })))).toEqual({
      status: 409,
      body: { error: "invite_exists" },
    });
  });

  it("other errors -> 500 internal without leaking the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.results.workspace_invites = { data: null, error: { code: "XX000", message: "secret detail" } };
    const out = await read(await createInvite(jsonReq("POST", { email: "a@example.com", role: "learner" })));
    expect(out).toEqual({ status: 500, body: { error: "internal" } });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("DELETE /api/workspace/invites", () => {
  it("filters on id, workspace_id = ctx.workspaceId and accepted_at is null", async () => {
    state.results.workspace_invites = { data: [{ id: INVITE }], error: null };
    expect((await revokeInvite(jsonReq("DELETE", { id: INVITE }))).status).toBe(200);
    const q = mutation("workspace_invites")!;
    expect(q.calls).toContainEqual(["eq", ["id", INVITE]]);
    expect(q.calls).toContainEqual(["eq", ["workspace_id", WS_A]]);
    expect(q.calls).toContainEqual(["is", ["accepted_at", null]]);
    expect(q.calls.some(([m]) => m === "select")).toBe(true);
  });

  it("404 when no row comes back", async () => {
    state.results.workspace_invites = { data: [], error: null };
    expect((await revokeInvite(jsonReq("DELETE", { id: INVITE }))).status).toBe(404);
  });

  it("400 for a non-uuid id, 403 for a non-owner", async () => {
    expect((await revokeInvite(jsonReq("DELETE", { id: "nope" }))).status).toBe(400);
    asRole("learner");
    expect((await revokeInvite(jsonReq("DELETE", { id: INVITE }))).status).toBe(403);
  });
});

describe("DELETE /api/workspace/members", () => {
  it("filters on workspace_id = ctx.workspaceId and user_id", async () => {
    state.results.workspace_members = { data: [{ user_id: OTHER }], error: null };
    expect((await removeMember(jsonReq("DELETE", { userId: OTHER }))).status).toBe(200);
    const q = mutation("workspace_members")!;
    expect(q.calls).toContainEqual(["eq", ["workspace_id", WS_A]]);
    expect(q.calls).toContainEqual(["eq", ["user_id", OTHER]]);
  });

  it("404 on zero rows", async () => {
    state.results.workspace_members = { data: [], error: null };
    expect((await removeMember(jsonReq("DELETE", { userId: OTHER }))).status).toBe(404);
  });

  it("409 last_owner on the trigger's 42501", async () => {
    state.results.workspace_members = {
      data: null,
      error: { code: "42501", message: `workspace ${WS_A} would have no owner, transfer ownership first` },
    };
    expect(await read(await removeMember(jsonReq("DELETE", { userId: USER })))).toEqual({
      status: 409,
      body: { error: "last_owner" },
    });
  });

  it("a 42501 without the last-owner message is 500, not last_owner", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.results.workspace_members = { data: null, error: { code: "42501", message: "permission denied for table" } };
    expect((await removeMember(jsonReq("DELETE", { userId: OTHER }))).status).toBe(500);
    spy.mockRestore();
  });

  it("403 for a non-owner", async () => {
    asRole("expert");
    expect((await removeMember(jsonReq("DELETE", { userId: OTHER }))).status).toBe(403);
  });
});

describe("POST /api/workspace/active", () => {
  it("rejects a non-uuid with 400", async () => {
    expect((await setActive(jsonReq("POST", { workspaceId: "local" }))).status).toBe(400);
  });

  it("403 for a workspace the user is not a member of", async () => {
    expect(await read(await setActive(jsonReq("POST", { workspaceId: WS_X })))).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
  });

  it("sets the ws cookie httpOnly, sameSite lax, path / for a membership, any role", async () => {
    asRole("learner");
    const res = await setActive(jsonReq("POST", { workspaceId: WS_B }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`ws=${WS_B}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
  });
});
