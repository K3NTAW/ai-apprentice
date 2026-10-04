// Supabase query counts per page loader over the fake client, for N = 1, 5 and 50 sessions.
// docs/checks/performance.md quotes these numbers; the last test keeps the doc and the measurements in step.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/lib/auth/context";
import { loadAgentsInput } from "@/lib/dashboard/agents";
import { loadDashboardInput } from "@/lib/dashboard/load";
import { entry, event, qaPair } from "./contract";
import { FakeSupabase } from "./fakeSupabase";
import { createSupabaseStore } from "./supabase";

vi.mock("@/lib/supabase/env", () => ({ appMode: () => "supabase" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const UID = "00000000-0000-4000-8000-000000000001";
const SIZES = [1, 5, 50] as const;

/** Queries before the change (recorded against the old code) and after it, per N in SIZES. */
const BEFORE = { listSessions: [4, 16, 151], dashboard: [11, 43, 403], agents: [12, 44, 404] };
const AFTER = { listSessions: [1, 1, 1], dashboard: [2, 2, 2], agents: [3, 3, 3] };
const EXPECTED = AFTER;

function thenable(value: unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
        return () => q;
      },
    },
  );
  return q;
}

/** n sessions with 1..3 events, 1..2 transcript lines and 0..1 Q&A each; every query is logged by table. */
async function fixture(n: number) {
  const workspaceId = randomUUID();
  const fake = new FakeSupabase({ uid: UID, workspaces: [workspaceId] });
  const inner = fake.client as { from: (t: string) => unknown; storage: unknown };
  const log: string[] = [];
  const members = { data: [{ user_id: UID, role: "owner" }], error: null };
  const client = {
    from: (t: string) => {
      log.push(t);
      return t === "workspace_members" ? thenable(members) : inner.from(t);
    },
    storage: inner.storage,
  } as unknown as SupabaseClient;
  const store = createSupabaseStore(client, { workspaceId, userId: UID });
  const expected = new Map<string, { events: number; transcript: number; qa: number }>();
  for (let i = 0; i < n; i++) {
    const s = await store.createSession({ kind: i % 2 ? "teach" : "capture" });
    const c = { events: (i % 3) + 1, transcript: (i % 2) + 1, qa: i % 2 };
    await store.appendEvents(s.id, Array.from({ length: c.events }, (_, k) => event(k + 1)));
    await store.appendTranscript(s.id, Array.from({ length: c.transcript }, (_, k) => entry(k + 1, `line ${k}`)));
    if (c.qa) await store.upsertQA(s.id, qaPair("qa_1", 1));
    expected.set(s.id, c);
  }
  const ctx: RequestContext = {
    mode: "supabase",
    userId: UID,
    email: null,
    workspaceId,
    workspaceName: "w",
    role: "owner",
    supabase: client,
    memberships: [],
  };
  log.length = 0;
  return { store, log, ctx, expected };
}

describe("query counts", () => {
  it.each(SIZES.map((n, i) => [n, i] as const))("listSessions with %i sessions: bounded, same counts", async (n, i) => {
    const { store, log, expected } = await fixture(n);
    const list = await store.listSessions();
    expect(log).toHaveLength(EXPECTED.listSessions[i]);
    expect(list).toHaveLength(n);
    for (const s of list) expect(s.counts).toEqual(expected.get(s.id));
  });

  it.each(SIZES.map((n, i) => [n, i] as const))("dashboard and agents loaders with %i sessions", async (n, i) => {
    const { log, ctx } = await fixture(n);
    const dash = await loadDashboardInput(ctx);
    expect(dash.sessions).toHaveLength(n);
    expect(log).toHaveLength(EXPECTED.dashboard[i]);
    log.length = 0;
    const agents = await loadAgentsInput(ctx);
    expect(agents.sessions).toHaveLength(n);
    expect(log).toHaveLength(EXPECTED.agents[i]);
  });

  it("docs/checks/performance.md quotes the measured numbers", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/checks/performance.md"), "utf8");
    for (const key of Object.keys(BEFORE) as (keyof typeof BEFORE)[])
      expect(doc).toContain(`| ${key} | ${BEFORE[key].join(" / ")} | ${AFTER[key].join(" / ")} |`);
  });
});
