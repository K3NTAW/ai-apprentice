import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { entry, event, qaPair, runStoreContract } from "./contract";
import { FakeSupabase } from "./fakeSupabase";
import { fileStore, getStore } from "./index";
import { createSupabaseStore } from "./supabase";
import { AgentNotFoundError, frameName, InvalidWorkMapError, ProcessesUnavailableError, ProcessExistsError, SessionNotFoundError, TeachUnavailableError } from "./types";
import { backfillProcesses } from "@/lib/processes/server";

const UID = "00000000-0000-4000-8000-000000000001";
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function supabaseFixture(opts: { maxRows?: number; pageSize?: number } = {}) {
  const workspaceId = randomUUID();
  const fake = new FakeSupabase({ uid: UID, workspaces: [workspaceId], maxRows: opts.maxRows });
  const client = fake.client as SupabaseClient;
  const store = createSupabaseStore(client, { workspaceId, userId: UID }, { pageSize: opts.pageSize });
  return { fake, client, store, workspaceId };
}

let dir: string;
const prevDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "apprentice-contract-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dir, { recursive: true, force: true });
});

runStoreContract("file", () => fileStore);
runStoreContract("supabase (fake client)", () => supabaseFixture().store);

describe("supabase store only", () => {
  it("writes a combined patch in one update_process call and never writes processes or process_versions directly", async () => {
    const { fake, store } = supabaseFixture();
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } });
    const wm = { task: "t", expert: "S", confirmed_by_expert: true, steps: [], open_questions: [] };
    const p = await store.createProcess({ agent_id: a.id, title: "T", workmap: wm });
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(["create_process"]);
    const before = fake.calls.length;
    const next = await store.updateProcess(p.id, { workmap: { ...wm, task: "t2" }, title: "T2", archived: true });
    expect(next).toMatchObject({ version: 2, title: "T2", workmap: { task: "t2" } });
    expect(next.archived_at).not.toBeNull();
    // No direct write at all: the Work Map, title and archive land in the one rpc call.
    expect(fake.calls.slice(before).filter((c) => c.op !== "select")).toEqual([]);
    expect(fake.rpcCalls.slice(1).map((c) => [c.fn, c.args.p_expected_version, c.args.p_title, c.args.p_archived])).toEqual([
      ["update_process", 1, "T2", true],
    ]);
    expect(fake.tables.process_versions.filter((v) => v.process_id === p.id)).toHaveLength(2);

    // Title or archive alone: one rpc call without a Work Map, no version row, the version stays.
    await store.updateProcess(p.id, { title: "T3" });
    await store.updateProcess(p.id, { archived: false });
    expect(fake.rpcCalls.slice(2).map((c) => [c.fn, c.args.p_workmap, c.args.p_title ?? null, c.args.p_archived ?? null])).toEqual([
      ["update_process", null, "T3", null],
      ["update_process", null, null, false],
    ]);
    expect(await store.getProcess(p.id)).toMatchObject({ title: "T3", archived_at: null, version: 2 });
    expect(fake.tables.process_versions.filter((v) => v.process_id === p.id)).toHaveLength(2);

    // A stale Work Map edit with a title fails as a whole: the title does not land either.
    await expect(store.updateProcess(p.id, { workmap: wm, expected_version: 1, title: "Lost" })).rejects.toThrow(/no longer at version 1/);
    expect(await store.getProcess(p.id)).toMatchObject({ title: "T3", version: 2 });
  });

  it("has no direct insert path: processes and process_versions inserts answer 42501", async () => {
    const { client, workspaceId } = supabaseFixture();
    const id = randomUUID();
    const wm = { task: "t", expert: "S", confirmed_by_expert: false, steps: [], open_questions: [] };
    const res = await client.from("process_versions").insert({ id, workspace_id: workspaceId, process_id: id, version: 1, workmap: wm, change_kind: "trained", changed_by: UID });
    expect(res.error).toMatchObject({ code: "42501" });
    const res2 = await client.from("processes").insert({ id, workspace_id: workspaceId, agent_id: id, title: "t", workmap: wm, created_by: UID });
    expect(res2.error).toMatchObject({ code: "42501" });
  });

  it("maps a malformed Work Map rejected by the database to InvalidWorkMapError and writes nothing", async () => {
    const { fake, store } = supabaseFixture();
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } });
    const wm = { task: "t", expert: "S", confirmed_by_expert: true, steps: [], open_questions: [] };
    const p = await store.createProcess({ agent_id: a.id, title: "T", workmap: wm });
    const step = { n: 1, title: "s", decision: "d", is_judgment_call: false, screen_moment: { t: 0, entity: "e" }, guardrails: [], scores: { reason_captured: 1, guardrail_captured: 1 }, reason: null };
    for (const bad of [
      { ...wm, steps: "nope" },
      { ...wm, steps: [{ ...step, n: "1" }] },
      { ...wm, steps: [{ ...step, screen_moment: null }] },
      { task: "t", steps: [] },
      { ...wm, open_questions: ["x".repeat(300000)] },
    ]) {
      await expect(store.updateProcess(p.id, { workmap: bad as never })).rejects.toBeInstanceOf(InvalidWorkMapError);
      await expect(store.createProcess({ agent_id: a.id, title: "T", workmap: bad as never })).rejects.toBeInstanceOf(InvalidWorkMapError);
    }
    expect(await store.updateProcess(p.id, { workmap: { ...wm, steps: [step] } })).toMatchObject({ version: 2 });
    expect(fake.tables.processes).toHaveLength(1);
    expect(fake.tables.process_versions).toHaveLength(2);
  });

  it("skips and logs process and version rows whose Work Map fails WorkMapSchema instead of throwing", async () => {
    const { fake, store, workspaceId } = supabaseFixture();
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } });
    const wm = { task: "t", expert: "S", confirmed_by_expert: true, steps: [], open_questions: [] };
    const good = await store.createProcess({ agent_id: a.id, title: "Good", workmap: wm });
    const badId = randomUUID();
    const bad = { task: 1, steps: "x" };
    fake.tables.processes.push({ ...fake.tables.processes[0], id: badId, workmap: bad });
    fake.tables.process_versions.push({ ...fake.tables.process_versions[0], id: randomUUID(), process_id: good.id, version: 2, workmap: bad, workspace_id: workspaceId });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await store.listProcesses()).map((p) => p.id)).toEqual([good.id]);
      expect(await store.getProcess(badId)).toBeNull();
      expect((await store.listProcessVersions(good.id)).map((v) => v.version)).toEqual([1]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(badId));
    } finally {
      log.mockRestore();
    }
  });

  it("backfill: concurrent calls create each process once and keep the session's started_at as created_at", async () => {
    const { fake, store } = supabaseFixture();
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } });
    const wm = { task: "t", expert: "S", confirmed_by_expert: true, steps: [], open_questions: [] };
    const older = await store.createSession({ kind: "capture", agent_id: a.id });
    await store.saveWorkMap(older.id, { ...wm, task: "older" });
    const newer = await store.createSession({ kind: "capture", agent_id: a.id });
    await store.saveWorkMap(newer.id, { ...wm, task: "newer" });
    fake.tables.sessions.find((r) => r.id === older.id)!.started_at = "2026-09-01T08:00:00.000+00:00";
    fake.tables.sessions.find((r) => r.id === newer.id)!.started_at = "2026-09-02T08:00:00.000+00:00";
    const [x, y] = await Promise.all([backfillProcesses(store), backfillProcesses(store)]);
    expect(x.length + y.length).toBe(2);
    expect(fake.tables.processes).toHaveLength(2);
    expect(fake.tables.process_versions).toHaveLength(2);
    const list = await store.listProcesses();
    expect(list.map((p) => [p.title, p.created_at])).toEqual([
      ["newer", "2026-09-02T08:00:00.000Z"],
      ["older", "2026-09-01T08:00:00.000Z"],
    ]);
    expect(await backfillProcesses(store)).toEqual([]);
    // A second process for the same source session is refused.
    await expect(store.createProcess({ agent_id: a.id, title: "again", workmap: wm, source_session_id: older.id })).rejects.toBeInstanceOf(ProcessExistsError);
  });

  it("reads digests without sessions.process_id while the processes migration is missing", async () => {
    const { fake, store } = supabaseFixture();
    await store.createSession({ kind: "capture" });
    fake.missingTables.add("processes");
    const digests = await store.listSessionDigests();
    expect(digests).toHaveLength(1);
    expect(digests[0].process_id).toBeUndefined();
  });

  it("reads digests without sessions.teach and refuses saveTeach while the teach migration is missing", async () => {
    const { fake, store } = supabaseFixture();
    const s = await store.createSession({ kind: "teach" });
    fake.missingTables.add("sessions.teach");
    const digests = await store.listSessionDigests();
    expect(digests).toHaveLength(1);
    expect(digests[0].teach).toBeUndefined();
    await expect(store.saveTeach(s.id, { workmap_session_id: s.id, mastered: [], practice: [], interventions: 0 })).rejects.toBeInstanceOf(
      TeachUnavailableError,
    );
    expect((await store.getSession(s.id))?.teach).toBeUndefined();
  });

  it("pages past the row cap and returns every row in order", async () => {
    const { fake, client, store } = supabaseFixture({ maxRows: 5, pageSize: 5 });
    const s = await store.createSession({ kind: "capture" });
    const ts = Array.from({ length: 12 }, (_, i) => i + 1);
    await store.appendEvents(s.id, ts.map((t) => event(t)));
    await store.appendTranscript(s.id, ts.map((t) => entry(t, `line ${t}`)));
    for (const t of ts.slice(0, 7)) await store.upsertQA(s.id, qaPair(`qa_${String(t).padStart(2, "0")}`, t));
    for (const t of ts.slice(0, 6)) await store.saveFrame(s.id, t, jpg);
    // The cap is real: a single select stops at 5 rows.
    const capped = await client.from("session_events").select("id").eq("session_id", s.id);
    expect(capped.data).toHaveLength(5);
    expect(fake.tables.session_events).toHaveLength(12);

    const got = await store.getSession(s.id);
    expect(got?.events.map((e) => e.t)).toEqual(ts);
    expect(got?.transcript.map((e) => e.t)).toEqual(ts);
    expect(got?.qa.map((q) => q.t_question)).toEqual(ts.slice(0, 7));
    expect(got?.frames?.map((f) => f.t)).toEqual(ts.slice(0, 6));
    for (let i = 0; i < 6; i++) await store.createSession({ kind: "teach" });
    const list = await store.listSessions();
    expect(list).toHaveLength(7);
    expect(list.find((x) => x.id === s.id)?.counts).toEqual({ events: 12, transcript: 12, qa: 7 });
    expect(list.map((x) => x.started_at)).toEqual([...list.map((x) => x.started_at)].sort().reverse());
  });

  it("recentSessions issues one limited sessions query for the workspace and no count queries", async () => {
    const { fake, client, store, workspaceId } = supabaseFixture();
    const otherWs = randomUUID();
    fake.visibleWorkspaces.add(otherWs);
    const other = createSupabaseStore(client, { workspaceId: otherWs, userId: UID });
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const s = await store.createSession({ kind: "capture" });
      await store.appendEvents(s.id, [event(1)]);
      ids.push(s.id);
      await new Promise((r) => setTimeout(r, 2));
    }
    await other.createSession({ kind: "capture" });
    fake.calls = [];
    const recent = await store.recentSessions(3);
    expect(recent.map((x) => x.id)).toEqual(ids.slice(-3).reverse());
    expect(fake.calls).toEqual([{ table: "sessions", op: "select", limit: 3, countHead: false }]);
    fake.calls = [];
    expect((await store.recentSessions()).map((x) => x.id)).toEqual(ids.slice(-6).reverse());
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: "sessions", limit: 6 });
    expect(workspaceId).not.toBe(otherWs);
  });

  it("treats a hidden workspace as a missing session", async () => {
    const { fake, store, workspaceId } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    fake.visibleWorkspaces.delete(workspaceId);
    expect(await store.getSession(s.id)).toBeNull();
    await expect(store.appendEvents(s.id, [event(1)])).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(store.saveWorkMap(s.id, { task: "", expert: "", confirmed_by_expert: false, steps: [], open_questions: [] })).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(store.saveFrame(s.id, 1, jpg)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(await store.listSessions()).toEqual([]);
  });

  it("returns 42501 from the fake for child inserts on an invisible session", async () => {
    const { fake, client, store, workspaceId } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    fake.visibleWorkspaces.delete(workspaceId);
    const res = await client.from("session_events").insert({ session_id: s.id, t: 1, payload: event(1) });
    expect(res.error).toMatchObject({ code: "42501" });
  });

  it("throws injected query and storage errors", async () => {
    const { fake, store } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    fake.failNext("session_events", { message: "boom", code: "XX000" });
    await expect(store.appendEvents(s.id, [event(1)])).rejects.toThrow(/boom/);
    fake.failNext("sessions", { message: "sessions down", code: "XX000" });
    await expect(store.getSession(s.id)).rejects.toThrow(/sessions down/);
    fake.failNext("storage", { name: "StorageApiError", message: "storage down", status: 500, statusCode: "500" });
    await expect(store.saveFrame(s.id, 1, jpg)).rejects.toThrow(/storage down/);
    await store.saveFrame(s.id, 2, jpg);
    fake.failNext("storage", { name: "StorageApiError", message: "storage down", status: 500, statusCode: "500" });
    await expect(store.readFrame(s.id, frameName(2))).rejects.toThrow(/storage down/);
  });

  it("returns null from readFrame on storage not-found", async () => {
    const { store } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    expect(await store.readFrame(s.id, frameName(9))).toBeNull();
  });

  it("rejects saveFrame on a missing session and uploads nothing", async () => {
    const { fake, store } = supabaseFixture();
    await expect(store.saveFrame("s_missing", 1, jpg)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(fake.objects.size).toBe(0);
  });

  it("converges when a purge fails after the range is written and the call is retried", async () => {
    const { fake, store, workspaceId } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    await store.appendEvents(s.id, [event(5), event(15), event(25), event(35)]);
    await store.appendTranscript(s.id, [entry(12, "a"), entry(28, "b")]);
    for (const t of [5, 15, 25, 35]) await store.saveFrame(s.id, t, jpg);
    await store.setOffRecord(s.id, { from: 10 });

    fake.failNext("storage", { name: "StorageApiError", message: "storage down", status: 503, statusCode: "503" });
    await expect(store.setOffRecord(s.id, { from: 20, to: 30 })).rejects.toThrow(/storage down/);
    // Step 1 landed: the merged range [10, 30] is recorded; frame rows and objects are still there.
    expect(fake.tables.sessions[0].off_record_ranges).toEqual([{ from: 10, to: 30 }]);
    expect(fake.tables.session_frames.map((f) => f.t)).toEqual([5, 15, 25, 35]);

    const again = await store.setOffRecord(s.id, { from: 20, to: 30 });
    expect(again.off_record_ranges).toEqual([{ from: 10, to: 30 }]);
    const inside = (t: unknown) => (t as number) >= 10 && (t as number) <= 30;
    for (const table of ["session_events", "session_transcript", "session_frames"]) {
      expect(fake.tables[table].filter((r) => inside(r.t))).toEqual([]);
    }
    expect([...fake.objects.keys()].sort()).toEqual([
      `${workspaceId}/${s.id}/${frameName(5)}`,
      `${workspaceId}/${s.id}/${frameName(35)}`,
    ]);
    expect(again.events.map((e) => e.t)).toEqual([5, 35]);
  });

  it("takes workspace_id and created_by from the context and returns ISO timestamps", async () => {
    const { fake, store, workspaceId } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    expect(fake.tables.sessions[0]).toMatchObject({ id: s.id, workspace_id: workspaceId, created_by: UID });
    expect(String(fake.tables.sessions[0].started_at)).toMatch(/\+00:00$/);
    expect(s.started_at).toMatch(/Z$/);
  });

  it("hides agents of another workspace and rejects a session linked to one", async () => {
    const { fake, client, store } = supabaseFixture();
    const otherWs = randomUUID();
    fake.visibleWorkspaces.add(otherWs);
    const other = createSupabaseStore(client, { workspaceId: otherWs, userId: UID });
    const foreign = await other.createAgent({
      name: "Elsewhere",
      role: "Other",
      avatar: { shape: "pill", face: "calm", color: "#123456", accent: "#654321" },
    });
    expect(await store.getAgent(foreign.id)).toBeNull();
    expect((await store.listAgents()).map((a) => a.id)).not.toContain(foreign.id);
    await expect(store.updateAgent(foreign.id, { name: "x" })).rejects.toThrow(/agent not found/);
    expect(await store.deleteAgent(foreign.id)).toBe(false);
    await expect(store.createSession({ kind: "capture", agent_id: foreign.id })).rejects.toThrow(/agent not found/);
    expect(fake.tables.agents).toHaveLength(1);
  });

  it("skips a malformed agent row on listAgents and getAgent with a log line naming the id", async () => {
    const { fake, store } = supabaseFixture();
    const good = await store.createAgent({ name: "Good", role: "R", avatar: { shape: "star", face: "robot", color: "#112233", accent: "#445566" } });
    const badId = randomUUID();
    fake.tables.agents.push({ ...fake.tables.agents[0], id: badId, avatar: { shape: "cube", face: "smile", color: "red", accent: "#000000" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await store.listAgents()).map((a) => a.id)).toEqual([good.id]);
      expect(await store.getAgent(badId)).toBeNull();
      expect(await store.getAgent(good.id)).toMatchObject({ id: good.id });
      expect(log).toHaveBeenCalledWith(expect.stringContaining(badId));
    } finally {
      log.mockRestore();
    }
  });

  it("maps a 23503 on sessions_agent_fkey in createSession to AgentNotFoundError (delete race)", async () => {
    const { fake, store } = supabaseFixture();
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "bean", face: "wink", color: "#ABCDEF", accent: "#000000" } });
    fake.failNext("sessions", {
      message: 'insert or update on table "sessions" violates foreign key constraint "sessions_agent_fkey"',
      code: "23503",
    });
    await expect(store.createSession({ kind: "teach", agent_id: a.id })).rejects.toBeInstanceOf(AgentNotFoundError);
    // Another foreign key violation is not an agent problem and stays a plain error.
    fake.failNext("sessions", { message: 'violates foreign key constraint "sessions_workspace_id_fkey"', code: "23503" });
    const err = await store.createSession({ kind: "teach", agent_id: a.id }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AgentNotFoundError);
    expect(String(err)).toMatch(/23503/);
  });

  it("takes agents workspace_id and created_by from the context", async () => {
    const { fake, store, workspaceId } = supabaseFixture();
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "bean", face: "wink", color: "#ABCDEF", accent: "#000000" } });
    expect(fake.tables.agents[0]).toMatchObject({ id: a.id, workspace_id: workspaceId, created_by: UID });
    expect(a.created_at).toMatch(/Z$/);
  });

  it("throws when userId is not the authenticated user (sessions insert policy)", async () => {
    const workspaceId = randomUUID();
    const fake = new FakeSupabase({ uid: UID, workspaces: [workspaceId] });
    const store = createSupabaseStore(fake.client as SupabaseClient, { workspaceId, userId: randomUUID() });
    await expect(store.createSession({ kind: "capture" })).rejects.toThrow(/42501/);
  });

  it("rejects a session_frames row whose storage_path is outside the session prefix", async () => {
    const { client, store } = supabaseFixture();
    const s = await store.createSession({ kind: "capture" });
    const res = await client
      .from("session_frames")
      .upsert({ session_id: s.id, name: "0001.jpg", t: 1, storage_path: "elsewhere/0001.jpg" }, { onConflict: "session_id,name" });
    expect(res.error).toMatchObject({ code: "42501" });
  });

  it("throws ProcessesUnavailableError for every process method while the migration is missing", async () => {
    const workspaceId = randomUUID();
    const fake = new FakeSupabase({ uid: UID, workspaces: [workspaceId], missingTables: ["processes", "process_versions"] });
    const store = createSupabaseStore(fake.client as SupabaseClient, { workspaceId, userId: UID });
    const a = await store.createAgent({ name: "A", role: "R", avatar: { shape: "bean", face: "wink", color: "#ABCDEF", accent: "#000000" } });
    const wm = { task: "t", expert: "e", confirmed_by_expert: true, steps: [], open_questions: [] };
    const id = randomUUID();
    for (const call of [
      () => store.listProcesses(),
      () => store.getProcess(id),
      () => store.createProcess({ agent_id: a.id, title: "t", workmap: wm }),
      () => store.updateProcess(id, { title: "t" }),
      () => store.deleteProcess(id),
      () => store.listProcessVersions(id),
    ])
      await expect(call()).rejects.toBeInstanceOf(ProcessesUnavailableError);
    // Sessions keep working without the migration.
    expect((await store.createSession({ kind: "capture" })).id).toBeDefined();
  });

  it("hides processes of another workspace and keeps created_by and changed_by from the context", async () => {
    const { fake, client, store, workspaceId } = supabaseFixture();
    const otherWs = randomUUID();
    fake.visibleWorkspaces.add(otherWs);
    const other = createSupabaseStore(client, { workspaceId: otherWs, userId: UID });
    const avatar = { shape: "bean", face: "wink", color: "#ABCDEF", accent: "#000000" } as const;
    const wm = { task: "t", expert: "e", confirmed_by_expert: true, steps: [], open_questions: [] };
    const foreign = await other.createProcess({ agent_id: (await other.createAgent({ name: "B", role: "R", avatar })).id, title: "Theirs", workmap: wm });
    const mine = await store.createProcess({ agent_id: (await store.createAgent({ name: "A", role: "R", avatar })).id, title: "Mine", workmap: wm });
    expect(await store.getProcess(foreign.id)).toBeNull();
    expect((await store.listProcesses()).map((p) => p.id)).toEqual([mine.id]);
    expect(await store.deleteProcess(foreign.id)).toBe(false);
    expect(await store.listProcessVersions(foreign.id)).toEqual([]);
    expect(fake.tables.processes.find((p) => p.id === mine.id)).toMatchObject({ workspace_id: workspaceId, created_by: UID });
    expect(fake.tables.process_versions.find((v) => v.process_id === mine.id)).toMatchObject({ workspace_id: workspaceId, changed_by: UID, version: 1 });
  });

  it("fails loudly on a method the fake does not support", () => {
    const { client } = supabaseFixture();
    expect(() => (client.from("sessions") as unknown as { neq: () => void }).neq()).toThrow(/neq/);
  });
});

describe("getStore", () => {
  const ctx = () => {
    const { client, workspaceId } = supabaseFixture();
    return { supabase: client, workspaceId, userId: UID };
  };
  const stubSupabase = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-placeholder");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-placeholder");
  };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the file store in local mode", () => {
    expect(getStore()).toBe(fileStore);
    expect(getStore(ctx())).toBe(fileStore);
  });

  it("returns a supabase store in supabase mode with a context", async () => {
    stubSupabase();
    const c = ctx();
    const store = getStore(c);
    expect(store).not.toBe(fileStore);
    const s = await store.createSession({ kind: "teach" });
    expect(await store.getSession(s.id)).toMatchObject({ id: s.id, kind: "teach" });
  });

  it("throws store_context_required in supabase mode without a context", () => {
    stubSupabase();
    expect(() => getStore()).toThrow("store_context_required");
    expect(() => getStore({ ...ctx(), supabase: undefined as unknown as SupabaseClient })).toThrow("store_context_required");
  });

  it("throws supabase_not_configured when misconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test.invalid");
    expect(() => getStore(ctx())).toThrow("supabase_not_configured");
  });
});
