// /agents/new hands the expert picker the workspace members (supabase) or the local user (local mode).
// Boundaries mocked: the request context, the admin address lookup, the shell and the client flow (props captured).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpertOption } from "@/components/agents/model";
import type { RequestContext } from "@/lib/auth/context";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXPERT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEARNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => ({
  ctx: null as unknown as RequestContext,
  experts: undefined as ExpertOption[] | undefined,
  table: "",
}));

vi.mock("@/lib/auth/context", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/context")>()),
  getRequestContext: async () => ({ kind: "ok", ctx: state.ctx }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: id === EXPERT ? "sabine.keller@example.com" : "anna@example.com" } } }) } },
  }),
}));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/agents/NewAgentFlow", () => ({
  default: (props: { experts?: ExpertOption[] }) => {
    state.experts = props.experts;
    return <div data-testid="flow" />;
  },
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

import NewAgentPage from "./page";

function membersClient() {
  const rows = [
    { user_id: USER, role: "owner" },
    { user_id: EXPERT, role: "expert" },
    { user_id: LEARNER, role: "learner" },
  ];
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
        return () => q;
      },
    },
  );
  return { from: (table: string) => ((state.table = table), q) };
}

const ctx = (over: Partial<RequestContext>): RequestContext => ({
  mode: "supabase",
  userId: USER,
  email: "owner@example.com",
  workspaceId: "ws-a",
  workspaceName: "A",
  role: "owner",
  supabase: membersClient() as never,
  memberships: [],
  ...over,
});

beforeEach(() => {
  state.experts = undefined;
  state.table = "";
});

describe("/agents/new expert picker data", () => {
  it("passes the workspace members (name, user id, initial), learners left out", async () => {
    state.ctx = ctx({});
    renderToStaticMarkup(await NewAgentPage());
    expect(state.table).toBe("workspace_members");
    expect(state.experts).toEqual([
      { userId: USER, name: "Owner", label: "owner@example.com", initial: "O" },
      { userId: EXPERT, name: "Sabine Keller", label: "sabine.keller@example.com", initial: "SK" },
    ]);
  });

  it("a non-owner sees other members by short id, never their address", async () => {
    state.ctx = ctx({ role: "expert", userId: EXPERT, email: "sabine.keller@example.com" });
    renderToStaticMarkup(await NewAgentPage());
    expect(state.experts?.map((e) => e.label)).toEqual([USER.slice(0, 8), "sabine.keller@example.com"]);
  });

  it("local mode passes the local user", async () => {
    state.ctx = ctx({ mode: "local", userId: "local", email: null, supabase: null });
    renderToStaticMarkup(await NewAgentPage());
    expect(state.experts).toEqual([{ userId: "local", name: "Local user", label: "local", initial: "L" }]);
  });
});
