// Empty capture runs in Supabase mode (T-0242), over the fake client: the purge reads with plain filters and applies
// the shared rule in code (a Work Map without steps is no work), falls back without sessions.process_id, reads
// session_qa for runs with few events; deleteSessions of the data port stays in its workspace; recentSessions marks
// the same runs 'No work recorded'.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { groupRecent } from "@/components/shell/recent";
import { supabaseDataPort } from "@/lib/agents/admin";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { createSupabaseStore } from "@/lib/store/supabase";
import { EMPTY_PURGE_MS, NO_WORK_RECORDED } from "./empty";
import { purgeEmptySessions, supabaseEmptyPurgePort } from "./emptyPurge";

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const UID = "33333333-3333-4333-8333-333333333333";
const T0 = Date.parse("2026-10-01T08:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const NOW = T0 + 120_000 + EMPTY_PURGE_MS;
const wm = (steps: unknown[]) => ({ task: "unspecified task", expert: "S", confirmed_by_expert: true, steps, open_questions: [] });

type Over = { workspace_id?: string; kind?: string; ended?: number | null; workmap?: unknown; process_id?: string | null; events?: number; created_by?: string | null };
function seed(fake: FakeSupabase, id: string, o: Over = {}) {
  fake.tables.sessions.push({
    id,
    workspace_id: o.workspace_id ?? W1,
    kind: o.kind ?? "capture",
    started_at: at(0),
    ended_at: o.ended === null ? null : at(o.ended ?? 120),
    expert: null,
    agent_id: null,
    workmap: o.workmap ?? null,
    process_id: o.process_id ?? null,
    off_record_ranges: [],
    created_by: o.created_by ?? null,
  });
  for (let i = 0; i < (o.events ?? 0); i++) fake.tables.session_events.push({ id: `${id}-e${i}`, session_id: id, payload: {} });
}
const qa = (fake: FakeSupabase, session_id: string, answer?: string) =>
  fake.tables.session_qa.push({ session_id, qa_id: `${session_id}-q`, payload: { id: "q", question: "Why?", ...(answer ? { answer } : {}) } });

function world(missingTables: string[] = []) {
  const fake = new FakeSupabase({ uid: UID, workspaces: [W1, W2], missingTables });
  seed(fake, "blank");
  seed(fake, "nosteps", { workspace_id: W2, workmap: wm([]) });
  seed(fake, "unanswered", { events: 1 });
  qa(fake, "unanswered");
  seed(fake, "answered", { events: 1 });
  qa(fake, "answered", "Because the supplier is new");
  seed(fake, "work", { ended: 10, workmap: wm([{ n: 1 }]) });
  seed(fake, "busy", { events: 3 });
  seed(fake, "teach", { kind: "teach" });
  seed(fake, "fresh", { ended: 600 });
  if (!missingTables.includes("processes")) seed(fake, "linked", { process_id: "p1" });
  return fake;
}
const ids = (fake: FakeSupabase) => fake.tables.sessions.map((s) => s.id as string).sort();

describe("supabaseEmptyPurgePort", () => {
  it("purges the empty runs of every workspace, a Work Map without steps included, across pages", async () => {
    const fake = world();
    const port = supabaseEmptyPurgePort(fake.client as SupabaseClient, { pageSize: 2 });
    expect(await purgeEmptySessions(port, NOW)).toEqual({ purged: 3 });
    expect(ids(fake)).toEqual(["answered", "busy", "fresh", "linked", "teach", "work"]);
    expect(fake.calls.filter((c) => c.table === "session_qa").length).toBeGreaterThan(0);
  });

  it("reads without sessions.process_id while the processes migration is missing", async () => {
    const fake = world(["processes", "process_versions"]);
    const port = supabaseEmptyPurgePort(fake.client as SupabaseClient);
    expect(await purgeEmptySessions(port, NOW)).toEqual({ purged: 3 });
    expect(ids(fake)).toEqual(["answered", "busy", "fresh", "teach", "work"]);
  });

  it("stops at the limit and leaves fresh runs alone", async () => {
    const fake = world();
    const port = supabaseEmptyPurgePort(fake.client as SupabaseClient, { pageSize: 2 });
    expect((await port.candidates(NOW - EMPTY_PURGE_MS, 1)).map((f) => f.id)).toHaveLength(1);
    expect(await purgeEmptySessions(port, T0 + 120_000 + EMPTY_PURGE_MS - 1)).toEqual({ purged: 0 });
  });
});

describe("supabaseDataPort.deleteSessions", () => {
  it("deletes only rows of its own workspace", async () => {
    const fake = world();
    await supabaseDataPort(fake.client as SupabaseClient, W1).deleteSessions(["blank", "nosteps"]);
    expect(ids(fake)).not.toContain("blank");
    expect(ids(fake)).toContain("nosteps");
  });
});

describe("supabase recentSessions: the shared empty rule", () => {
  for (const missing of [[], ["processes", "process_versions"]]) {
    it(`marks a Work Map without steps 'No work recorded'${missing.length ? " (no process_id column)" : ""}`, async () => {
      const fake = world(missing);
      seed(fake, "mine", { workspace_id: W2, created_by: UID });
      const store = createSupabaseStore(fake.client as SupabaseClient, { workspaceId: W2, userId: UID });
      const rows = await store.recentSessions(10);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId.nosteps).toMatchObject({ empty: true, has_workmap: true });
      expect(byId.mine).toMatchObject({ empty: true, created_by: UID });
      const items = groupRecent(rows, new Date(NOW), {}, 10, (s) => s.created_by === UID).flatMap((g) => g.items);
      expect(items.find((i) => i.id === "nosteps")).toMatchObject({ title: NO_WORK_RECORDED });
      expect(items.find((i) => i.id === "nosteps")?.deletable).toBeUndefined();
      expect(items.find((i) => i.id === "mine")).toMatchObject({ title: NO_WORK_RECORDED, deletable: true });
    });
  }

  it("a Work Map with steps or a linked process is not empty", async () => {
    const fake = world();
    seed(fake, "linked2", { workspace_id: W2, process_id: "p2" });
    seed(fake, "work2", { workspace_id: W2, ended: 10, workmap: wm([{ n: 1 }]) });
    const rows = await createSupabaseStore(fake.client as SupabaseClient, { workspaceId: W2, userId: UID }).recentSessions(10);
    expect(rows.filter((r) => r.empty).map((r) => r.id)).toEqual(["nosteps"]);
  });
});
