// Deleting an agent deletes everything of it, in both backends: processes, versions, every session (capture and
// teach) with events, Q&A, transcript, Work Map, teach progress, frame rows and frame objects, and its settings.
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { entry, event, qaPair } from "@/lib/store/contract";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { createSupabaseStore, fileStore, type SessionStore } from "@/lib/store";
import type { Avatar, WorkMap } from "@/lib/types";
import { deleteAgentData, fileAgentAdmin, fileDataPort, supabaseDataPort, type DataPort } from "./admin";

const UID = "00000000-0000-4000-8000-000000000001";
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const avatar: Avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" };
const workmap: WorkMap = { task: "pay invoice", expert: "Sabine", confirmed_by_expert: false, steps: [], open_questions: [] };

let dir: string;
const prevDataDir = process.env.DATA_DIR;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "apprentice-agent-delete-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dir, { recursive: true, force: true });
});

async function seed(store: SessionStore) {
  const doomed = await store.createAgent({ name: "Doomed", role: "AP", avatar });
  const kept = await store.createAgent({ name: "Kept", role: "AP", avatar });
  const capture = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: doomed.id });
  await store.appendEvents(capture.id, [event(1)]);
  await store.appendTranscript(capture.id, [entry(1, "hello")]);
  await store.upsertQA(capture.id, qaPair("q1", 2));
  await store.saveWorkMap(capture.id, workmap);
  await store.saveFrame(capture.id, 1, jpg);
  const teach = await store.createSession({ kind: "teach", agent_id: doomed.id });
  await store.saveTeach(teach.id, { workmap_session_id: capture.id, mastered: ["1"], practice: [], interventions: 0 });
  await store.saveFrame(teach.id, 1, jpg);
  const process = await store.createProcess({ agent_id: doomed.id, title: "Pay", workmap, source_session_id: capture.id });
  await store.updateProcess(process.id, { workmap: { ...workmap, task: "v2" }, expected_version: 1 });
  const other = await store.createSession({ kind: "capture", agent_id: kept.id });
  await store.saveFrame(other.id, 1, jpg);
  const otherProcess = await store.createProcess({ agent_id: kept.id, title: "Keep", workmap, source_session_id: other.id });
  return { doomed, kept, capture, teach, process, other, otherProcess };
}

async function expectGone(store: SessionStore, s: Awaited<ReturnType<typeof seed>>) {
  expect(await store.getAgent(s.doomed.id)).toBeNull();
  expect(await store.getSession(s.capture.id)).toBeNull();
  expect(await store.getSession(s.teach.id)).toBeNull();
  expect(await store.getProcess(s.process.id)).toBeNull();
  expect(await store.listProcessVersions(s.process.id)).toEqual([]);
  const ids = (await store.listSessions()).map((x) => x.id);
  expect(ids).toEqual([s.other.id]);
  expect((await store.listSessionDigests()).map((x) => x.id)).toEqual([s.other.id]);
  expect((await store.listProcesses()).map((p) => p.id)).toEqual([s.otherProcess.id]);
  expect((await store.listAgents()).map((a) => a.id)).toEqual([s.kept.id]);
  expect(await store.getSession(s.other.id)).toMatchObject({ agent_id: s.kept.id });
}

describe("delete agent with everything (file backend)", () => {
  it("removes processes, versions, sessions with their children and frames, and the settings", async () => {
    const s = await seed(fileStore);
    const admin = fileAgentAdmin({ workspaceId: "local", userId: "local" });
    await admin.patchSettings(s.doomed.id, { question_interval_s: 120 });
    const port = fileDataPort();
    const remove = vi.spyOn(port, "removeObjects");
    const listed = await port.frameObjectsOf([s.capture.id, s.teach.id]);
    expect(listed.length).toBe(2);
    for (const f of listed) await access(f);

    expect(await deleteAgentData(port, { workspaceId: "local", agentId: s.doomed.id, userId: null })).toEqual({ deleted: true, frames: 2, sessions: 2 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0].map((p) => path.basename(path.dirname(path.dirname(p)))).sort()).toEqual([s.capture.id, s.teach.id].sort());
    for (const f of listed) await expect(access(f)).rejects.toThrow();
    await expect(access(path.join(dir, "sessions", s.capture.id))).rejects.toThrow();
    await expectGone(fileStore, s);
    const settings = JSON.parse(await readFile(path.join(dir, "agent_settings.json"), "utf8")) as Record<string, unknown>;
    expect(settings[s.doomed.id]).toBeUndefined();
    const procs = JSON.parse(await readFile(path.join(dir, "processes.json"), "utf8")) as { tombstones: string[] };
    expect(procs.tombstones).not.toContain(s.capture.id);
    expect(await deleteAgentData(port, { workspaceId: "local", agentId: s.doomed.id, userId: null })).toEqual({ deleted: false, frames: 0, sessions: 0 });
  });
});

describe("delete agent with everything (supabase backend, fake client)", () => {
  function fixture() {
    const workspaceId = randomUUID();
    const fake = new FakeSupabase({ uid: UID, workspaces: [workspaceId] });
    const client = fake.client as SupabaseClient;
    return { fake, client, workspaceId, store: createSupabaseStore(client, { workspaceId, userId: UID }) };
  }

  it("lists frames by session prefix, removes them, then deletes sessions with their children and the agent", async () => {
    const { fake, client, workspaceId, store } = fixture();
    const s = await seed(store);
    fake.tables.agent_reports.push({ workspace_id: workspaceId, agent_id: s.doomed.id, agent_name: "Doomed", teach: [] });
    // An object without a row (an interrupted upload) is found by the prefix listing too.
    fake.objects.set(`${workspaceId}/${s.teach.id}/orphan.jpg`, jpg);
    const doomed = [...fake.objects.keys()].filter((k) => !k.startsWith(`${workspaceId}/${s.other.id}/`)).sort();
    expect(doomed).toHaveLength(3);
    const port = supabaseDataPort(client, workspaceId);
    const remove = vi.spyOn(port, "removeObjects");

    expect(await deleteAgentData(port, { workspaceId, agentId: s.doomed.id, userId: UID })).toEqual({ deleted: true, frames: 3, sessions: 2 });
    expect(remove.mock.calls.flatMap((c) => c[0]).sort()).toEqual(doomed);
    expect([...fake.objects.keys()].every((k) => k.startsWith(`${workspaceId}/${s.other.id}/`))).toBe(true);
    expect(fake.objects.size).toBe(1);
    for (const t of ["session_events", "session_transcript", "session_qa", "session_frames"])
      expect(fake.tables[t].filter((r) => r.session_id === s.capture.id || r.session_id === s.teach.id)).toEqual([]);
    expect(fake.tables.session_frames.map((r) => r.session_id)).toEqual([s.other.id]);
    expect(fake.tables.processes_tombstones).toEqual([]);
    expect(fake.tables.agent_reports).toEqual([]);
    await expectGone(store, s);
  });

  it("a Storage failure is logged and the rows are still deleted", async () => {
    const { fake, client, workspaceId, store } = fixture();
    const s = await seed(store);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const port = supabaseDataPort(client, workspaceId);
    port.removeObjects = async () => {
      throw new Error("storage down");
    };
    expect(await deleteAgentData(port, { workspaceId, agentId: s.doomed.id, userId: UID })).toMatchObject({ deleted: true, sessions: 2 });
    expect(log).toHaveBeenCalled();
    expect(fake.objects.size).toBe(3);
    await expectGone(store, s);
    log.mockRestore();
  });

  it("removes objects in batches of STORAGE_BATCH", async () => {
    const calls: number[] = [];
    const paths = Array.from({ length: 250 }, (_, i) => `w/s/${i}.jpg`);
    const port: DataPort = {
      agentName: async () => "A",
      sessionsOf: async () => [{ id: "s", kind: "capture", created_by: null, started_at: "2026-10-04T08:00:00Z", ended_at: null }],
      frameObjectsOf: async () => paths,
      removeObjects: async (p) => void calls.push(p.length),
      deleteSessions: async () => {},
      deleteAgent: async () => {},
    };
    await deleteAgentData(port, { workspaceId: "w", agentId: "a", userId: null });
    expect(calls).toEqual([100, 100, 50]);
  });
});
