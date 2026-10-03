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
import { frameName, SessionNotFoundError } from "./types";

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
