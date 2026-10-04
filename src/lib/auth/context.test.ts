import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  cookie: undefined as string | undefined,
  client: null as unknown,
  headers: {} as Record<string, string>,
  proxyGetUser: 0,
  proxyUser: null as { id: string } | null,
}));

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => state.mode,
  publicSupabaseEnv: () => (state.mode === "supabase" ? { url: "http://localhost:54321", anonKey: "anon-placeholder" } : null),
}));
// The proxy's own client (proxy plus context test below).
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        state.proxyGetUser++;
        return { data: { user: state.proxyUser }, error: null };
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => {
    if (!state.client) throw new Error("supabase_not_configured");
    return state.client;
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "ws" && state.cookie ? { value: state.cookie } : undefined) }),
  headers: async () => new Headers(state.headers),
}));

import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proxy } from "@/proxy";
import { FORWARDED_USER_HEADER, signForwardedUser } from "./forwardedUser";
import {
  buildWorkspaceView,
  emailLookupIds,
  getRequestContext,
  requireContext,
  requireRole,
  type RequestContext,
} from "./context";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Result = { data: unknown; error: unknown };

function fakeQuery(result: Result, calls: [string, unknown[]][]) {
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return q;
        };
      },
    },
  );
  return q;
}

function fakeClient(opts: {
  user?: { id: string; email?: string } | null;
  userError?: unknown;
  getUserThrows?: boolean;
  members?: Result;
  rpc?: Result;
}) {
  const calls: [string, unknown[]][] = [];
  const client = {
    calls,
    auth: {
      getUser: vi.fn(async () => {
        if (opts.getUserThrows) throw new Error("network");
        return { data: { user: opts.user ?? null }, error: opts.userError ?? null };
      }),
      getSession: vi.fn(() => {
        throw new Error("getSession must not be called");
      }),
    },
    from: vi.fn((table: string) => {
      calls.push(["from", [table]]);
      return fakeQuery(opts.members ?? { data: [], error: null }, calls);
    }),
    rpc: vi.fn(async () => opts.rpc ?? { data: [], error: null }),
  };
  return client;
}

const memberRow = (id: string, name: string, role = "owner") => ({
  workspace_id: id,
  role,
  created_at: "2026-10-03T00:00:00Z",
  workspaces: { name },
});

beforeEach(() => {
  state.mode = "supabase";
  state.cookie = undefined;
  state.client = null;
  state.headers = {};
  state.proxyGetUser = 0;
  state.proxyUser = null;
  vi.mocked(createSupabaseServerClient).mockClear();
});

describe("one getUser per page request (proxy plus context)", () => {
  const forward = (res: Response) => {
    const v = res.headers.get(`x-middleware-request-${FORWARDED_USER_HEADER}`);
    state.headers = v ? { [FORWARDED_USER_HEADER]: v } : {};
  };

  it("the page render reuses the proxy-verified user: getUser runs once in total", async () => {
    state.proxyUser = { id: USER };
    const client = fakeClient({ user: { id: USER }, members: { data: [memberRow(WS_A, "A")], error: null } });
    state.client = client;
    forward(await proxy(new NextRequest("http://app.test/agents")));
    const r = await getRequestContext();
    expect(r).toMatchObject({ kind: "ok", ctx: { userId: USER, workspaceId: WS_A } });
    expect(state.proxyGetUser + client.auth.getUser.mock.calls.length).toBe(1);
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("a forged, tampered or expired header is ignored: the context calls getUser itself", async () => {
    const client = fakeClient({ user: { id: USER }, members: { data: [memberRow(WS_A, "A")], error: null } });
    state.client = client;
    const good = signForwardedUser({ id: "someone-else" });
    const [payload] = good.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ id: "attacker", exp: Date.now() + 1e6 })).toString("base64url")}.${good.split(".")[1]}`;
    for (const v of ["attacker", `${payload}.bad`, tampered, signForwardedUser({ id: "old" }, Date.now() - 60_000)]) {
      state.headers = { [FORWARDED_USER_HEADER]: v };
      client.auth.getUser.mockClear();
      const r = await getRequestContext();
      expect(r.kind === "ok" && r.ctx.userId).toBe(USER);
      expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    }
  });

  it("requireContext (route handlers) never trusts the forwarded header", async () => {
    const client = fakeClient({ user: null });
    state.client = client;
    state.headers = { [FORWARDED_USER_HEADER]: signForwardedUser({ id: USER }) };
    const res = await requireContext();
    expect(res instanceof Response && res.status).toBe(401);
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("an /api request costs one getUser: the proxy skips it, requireContext runs it", async () => {
    state.proxyUser = { id: USER };
    const client = fakeClient({ user: { id: USER }, members: { data: [memberRow(WS_A, "A")], error: null } });
    state.client = client;
    forward(await proxy(new NextRequest("http://app.test/api/session")));
    await requireContext();
    expect(state.proxyGetUser + client.auth.getUser.mock.calls.length).toBe(1);
  });
});

describe("getRequestContext", () => {
  it("local mode -> ok with the fixed local context, no Supabase", async () => {
    state.mode = "local";
    const r = await getRequestContext();
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.ctx).toMatchObject({ mode: "local", userId: "local", workspaceId: "local", role: "owner", supabase: null });
    expect(r.ctx.memberships).toHaveLength(1);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("misconfigured mode -> misconfigured", async () => {
    state.mode = "misconfigured";
    expect((await getRequestContext()).kind).toBe("misconfigured");
  });

  it("no user, an auth error or a getUser throw -> signed_out; getSession never called", async () => {
    for (const opts of [{ user: null }, { user: { id: USER }, userError: { message: "bad jwt" } }, { getUserThrows: true }]) {
      const client = fakeClient(opts);
      state.client = client;
      expect((await getRequestContext()).kind).toBe("signed_out");
      expect(client.auth.getSession).not.toHaveBeenCalled();
    }
  });

  it("reads memberships filtered on user_id, ordered by created_at then workspace_id", async () => {
    const client = fakeClient({ user: { id: USER, email: "a@example.com" }, members: { data: [memberRow(WS_A, "A")], error: null } });
    state.client = client;
    const r = await getRequestContext();
    expect(r.kind).toBe("ok");
    expect(client.calls).toContainEqual(["from", ["workspace_members"]]);
    expect(client.calls).toContainEqual(["eq", ["user_id", USER]]);
    const orders = client.calls.filter(([m]) => m === "order").map(([, a]) => a[0]);
    expect(orders).toEqual(["created_at", "workspace_id"]);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it("honours the ws cookie only when it names a membership", async () => {
    const members = { data: [memberRow(WS_A, "A"), memberRow(WS_B, "B", "learner")], error: null };
    state.client = fakeClient({ user: { id: USER }, members });

    state.cookie = WS_B;
    let r = await getRequestContext();
    expect(r.kind === "ok" && r.ctx).toMatchObject({ workspaceId: WS_B, workspaceName: "B", role: "learner" });

    state.cookie = "33333333-3333-4333-8333-333333333333";
    r = await getRequestContext();
    expect(r.kind === "ok" && r.ctx).toMatchObject({ workspaceId: WS_A, role: "owner" });

    state.cookie = undefined;
    r = await getRequestContext();
    expect(r.kind === "ok" && r.ctx.workspaceId).toBe(WS_A);
  });

  it("zero memberships -> bootstrap_workspace once, its rows are used", async () => {
    const client = fakeClient({
      user: { id: USER },
      members: { data: [], error: null },
      rpc: { data: [{ workspace_id: WS_B, name: "Personal", role: "owner" }], error: null },
    });
    state.client = client;
    const r = await getRequestContext();
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("bootstrap_workspace");
    expect(r.kind === "ok" && r.ctx).toMatchObject({ workspaceId: WS_B, workspaceName: "Personal", role: "owner", userId: USER });
  });

  it("a membership read error -> no_workspace without calling the rpc", async () => {
    const client = fakeClient({ user: { id: USER }, members: { data: null, error: { message: "boom" } } });
    state.client = client;
    expect((await getRequestContext()).kind).toBe("no_workspace");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("requireContext", () => {
  async function body(r: unknown) {
    expect(r).toBeInstanceOf(Response);
    const res = r as Response;
    return { status: res.status, json: await res.json() };
  }

  it("signed out -> 401", async () => {
    state.client = fakeClient({ user: null });
    expect(await body(await requireContext())).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("misconfigured -> 503", async () => {
    state.mode = "misconfigured";
    expect(await body(await requireContext())).toEqual({ status: 503, json: { error: "supabase_not_configured" } });
  });

  it("bootstrap still empty -> 403 no_workspace", async () => {
    state.client = fakeClient({ user: { id: USER }, rpc: { data: [], error: null } });
    expect(await body(await requireContext())).toEqual({ status: 403, json: { error: "no_workspace" } });
  });

  it("rpc error -> 403 no_workspace", async () => {
    const client = fakeClient({ user: { id: USER }, rpc: { data: null, error: { message: "x" } } });
    state.client = client;
    expect(await body(await requireContext())).toEqual({ status: 403, json: { error: "no_workspace" } });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("ok -> the context", async () => {
    state.mode = "local";
    const ctx = await requireContext();
    expect(ctx).not.toBeInstanceOf(Response);
    expect((ctx as RequestContext).userId).toBe("local");
  });
});

const baseCtx: RequestContext = {
  mode: "supabase",
  userId: USER,
  email: "me@example.com",
  workspaceId: WS_A,
  workspaceName: "A",
  role: "owner",
  supabase: null,
  memberships: [{ workspaceId: WS_A, name: "A", role: "owner" }],
};

describe("requireRole", () => {
  it("403 for a learner on an owner-only action, null for an owner", async () => {
    const denied = requireRole({ ...baseCtx, role: "learner" }, ["owner"]);
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toEqual({ error: "forbidden" });
    expect(requireRole(baseCtx, ["owner"])).toBeNull();
  });
});

describe("workspace view model", () => {
  const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const members = [
    { user_id: USER, role: "owner" },
    { user_id: OTHER, role: "learner" },
  ];
  const invites = [{ id: WS_B, email: "x@example.com", role: "learner", created_at: "2026-10-03T00:00:00Z" }];
  const emails = new Map([[OTHER, "other@example.com"]]);

  it("owner sees member addresses and pending invites", () => {
    const v = buildWorkspaceView(baseCtx, members, invites, emails);
    expect(v.isOwner).toBe(true);
    expect(v.members).toEqual([
      { userId: USER, label: "me@example.com", role: "owner", isSelf: true },
      { userId: OTHER, label: "other@example.com", role: "learner", isSelf: false },
    ]);
    expect(v.invites).toHaveLength(1);
    expect(v.truncated).toBe(false);
  });

  it("learner sees own address, short ids for others, no invites", () => {
    const v = buildWorkspaceView({ ...baseCtx, role: "learner" }, members, invites, emails);
    expect(v.members[1].label).toBe(OTHER.slice(0, 8));
    expect(v.members[0].label).toBe("me@example.com");
    expect(v.invites).toEqual([]);
  });

  it("failed lookup falls back to the short id", () => {
    const v = buildWorkspaceView(baseCtx, members, [], new Map());
    expect(v.members[1].label).toBe("bbbbbbbb");
  });

  it("caps at 50 and flags truncation; lookups only for owners, never self", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ user_id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, role: "learner" }));
    const v = buildWorkspaceView(baseCtx, many, [], new Map());
    expect(v.members).toHaveLength(50);
    expect(v.truncated).toBe(true);
    expect(emailLookupIds(baseCtx, many)).toHaveLength(50);
    expect(emailLookupIds({ ...baseCtx, role: "expert" }, many)).toEqual([]);
    expect(emailLookupIds(baseCtx, members)).toEqual([OTHER]);
  });
});
