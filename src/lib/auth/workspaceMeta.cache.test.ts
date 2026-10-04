// A workspace rename expires the cached name for every member, not only the owner who renamed it.
// next/cache is mocked with a tag-aware memo (an entry is dropped when one of its tags is revalidated), and one fake
// database backs both the other member's cached read (cachedMemberships) and the owner's PATCH /api/workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  memo: new Map<string, { value: unknown; tags: string[] }>(),
  revalidated: [] as string[],
  actor: "",
  workspaces: {} as Record<string, { name: string; city: string | null }>,
  members: [] as { user_id: string; workspace_id: string; role: string }[],
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <T,>(fn: () => Promise<T>, key: string[], opts: { tags: string[] }) =>
    async () => {
      const k = JSON.stringify(key);
      if (!s.memo.has(k)) s.memo.set(k, { value: await fn(), tags: opts.tags });
      return s.memo.get(k)!.value as T;
    },
  revalidateTag: (tag: string) => {
    s.revalidated.push(tag);
    for (const [k, e] of s.memo) if (e.tags.includes(tag)) s.memo.delete(k);
  },
}));

type Call = [string, unknown[]];

/** Query builder over s.workspaces and s.members; resolves on await from the recorded calls. */
function fakeQuery(table: string) {
  const calls: Call[] = [];
  const arg = (m: string) => calls.find(([c]) => c === m)?.[1];
  const resolve = () => {
    if (table === "workspace_members") {
      const user = (arg("eq") as [string, string])[1];
      const rows = s.members
        .filter((m) => m.user_id === user)
        .map((m) => ({ workspace_id: m.workspace_id, role: m.role, created_at: "2026-10-01T00:00:00Z", workspaces: { ...s.workspaces[m.workspace_id] } }));
      return { data: rows, error: null };
    }
    const update = arg("update") as [{ name: string; city?: string | null }] | undefined;
    if (update) {
      const id = (arg("eq") as [string, string])[1];
      s.workspaces[id] = { ...s.workspaces[id], ...update[0] };
      return { data: [{ id, ...s.workspaces[id] }], error: null };
    }
    const ids = (arg("in") as [string, string[]])[1];
    return { data: ids.map((id) => ({ id, ...s.workspaces[id] })), error: null };
  };
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(resolve()).then(ok);
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return q;
        };
      },
    },
  );
  return q;
}

const client = () => ({
  auth: { getUser: async () => ({ data: { user: { id: s.actor, email: null } }, error: null }) },
  from: (t: string) => fakeQuery(t),
  rpc: async () => ({ data: [], error: null }),
});

vi.mock("@/lib/supabase/env", () => ({ appMode: () => "supabase" }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { PATCH } from "@/app/api/workspace/route";
import { cacheTag } from "@/lib/cache/readMostly";
import { cachedMemberships } from "./context";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";

const memberRead = () => cachedMemberships(client() as never, MEMBER, undefined);
const rename = (body: unknown) =>
  PATCH(new Request("http://app.test/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  s.memo.clear();
  s.revalidated = [];
  s.workspaces = { [WS]: { name: "Finance Ops", city: "Zug" }, [OTHER_WS]: { name: "Treasury", city: null } };
  s.members = [
    { user_id: OWNER, workspace_id: WS, role: "owner" },
    { user_id: MEMBER, workspace_id: OTHER_WS, role: "owner" },
    { user_id: MEMBER, workspace_id: WS, role: "learner" },
  ];
});

describe("workspace rename and the members' cached reads", () => {
  it("another member's cached membership/sidebar read shows the new name right after the owner renames", async () => {
    const before = await memberRead();
    expect(before).toMatchObject({ ok: true, memberships: [{ workspaceId: OTHER_WS, name: "Treasury" }, { workspaceId: WS, name: "Finance Ops", city: "Zug" }] });
    // Cached: a change in the database alone is not seen within the cache window.
    s.workspaces[WS] = { name: "Changed elsewhere", city: "Zug" };
    expect(await memberRead()).toEqual(before);
    s.workspaces[WS] = { name: "Finance Ops", city: "Zug" };

    s.actor = OWNER;
    const res = await rename({ name: "Finance Ops Zug", city: "Baar" });
    expect(res.status).toBe(200);
    // The member's own memberships tag was not touched; the workspace meta tag was.
    expect(s.revalidated).not.toContain(cacheTag.memberships(MEMBER));
    expect(s.revalidated).toContain(cacheTag.workspace(WS));

    expect(await memberRead()).toMatchObject({
      ok: true,
      memberships: [{ workspaceId: OTHER_WS, name: "Treasury" }, { workspaceId: WS, name: "Finance Ops Zug", city: "Baar", role: "learner" }],
    });
  });

  it("the meta read is tagged with every workspace in the member's list", async () => {
    await memberRead();
    const meta = [...s.memo.entries()].find(([k]) => k.includes("workspace-meta"))!;
    expect(meta[1].tags).toEqual([cacheTag.workspace(OTHER_WS), cacheTag.workspace(WS)]);
  });
});
