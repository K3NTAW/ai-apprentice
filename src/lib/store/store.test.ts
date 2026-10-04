import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getFrame } from "@/app/api/session/[id]/frames/[name]/route";
import { POST as postOffRecord } from "@/app/api/session/[id]/off-record/route";
import type { ScreenEvent, TranscriptEntry } from "@/lib/types";
import { fileStore, InvalidOffRecordRangeError } from "./index";

// The file store directly; the top-level wrappers in ./index were removed in T-0068.
const appendEvents = fileStore.appendEvents.bind(fileStore);
const appendTranscript = fileStore.appendTranscript.bind(fileStore);
const createSession = fileStore.createSession.bind(fileStore);
const endSession = fileStore.endSession.bind(fileStore);
const getSession = fileStore.getSession.bind(fileStore);
const listSessions = fileStore.listSessions.bind(fileStore);
const readFrame = fileStore.readFrame.bind(fileStore);
const saveFrame = fileStore.saveFrame.bind(fileStore);
const setOffRecord = fileStore.setOffRecord.bind(fileStore);
const upsertQA = fileStore.upsertQA.bind(fileStore);


let dir: string;
const prevDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "apprentice-store-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dir, { recursive: true, force: true });
});

const entry = (t: number, text: string): TranscriptEntry => ({
  id: `tr_${t}`,
  t,
  speaker: "expert",
  text,
  phase: "capture",
  redacted: false,
});

const event = (t: number): ScreenEvent => ({
  id: `ev_${t}`,
  t,
  source: "dom",
  type: "field_changed",
  entity: { kind: "invoice", id: "4471" },
});

const sessionJson = (id: string) => readFile(path.join(dir, "sessions", id, "session.json"), "utf8");

describe("store", () => {
  it("creates, lists and ends sessions", async () => {
    const s = await createSession({ kind: "capture", expert: "Sabine Keller" });
    expect(await getSession(s.id)).toMatchObject({ id: s.id, kind: "capture", expert: "Sabine Keller" });
    const ended = await endSession(s.id);
    expect(ended.ended_at).toBeDefined();
    const summary = (await listSessions()).find((x) => x.id === s.id);
    expect(summary).toMatchObject({ counts: { events: 0, transcript: 0, qa: 0 }, has_workmap: false });
    expect(await getSession("nope")).toBeNull();
  });

  it("redacts transcript and QA text before writing", async () => {
    const s = await createSession({ kind: "capture", expert: "Sabine Keller" });
    await appendTranscript(s.id, [entry(1, "Sabine here: pay invoice 4471 to CH93 0076 2011 6238 5295 7.")]);
    await upsertQA(s.id, {
      id: "qa_1",
      t_question: 2,
      question: "Why call Frau Meier?",
      answer: "Her IBAN DE89370400440532013000 changed.",
      phase: "capture",
      about: "reason",
    });
    const raw = await sessionJson(s.id);
    expect(raw).not.toContain("CH93 0076");
    expect(raw).not.toContain("DE89370400440532013000");
    expect(raw).not.toContain("Meier");
    const got = await getSession(s.id);
    expect(got?.transcript[0]).toMatchObject({ text: "Sabine here: pay invoice 4471 to <IBAN_CODE>.", redacted: true });
  });

  it("drops entries inside open or closed off-record ranges and purges earlier ones", async () => {
    const s = await createSession({ kind: "capture" });
    await appendTranscript(s.id, [entry(5, "before"), entry(15, "secret earlier"), entry(25, "after")]);
    await appendEvents(s.id, [event(5), event(15), event(25)]);

    await setOffRecord(s.id, { from: 10, to: 20 });
    let got = await getSession(s.id);
    expect(got?.transcript.map((e) => e.t)).toEqual([5, 25]);
    expect(got?.events.map((e) => e.t)).toEqual([5, 25]);

    await appendTranscript(s.id, [entry(12, "inside closed"), entry(30, "ok")]);
    await setOffRecord(s.id, { from: 40 });
    await appendTranscript(s.id, [entry(41, "while open"), entry(2, "also dropped while open")]);
    await appendEvents(s.id, [event(42)]);
    await setOffRecord(s.id, { from: 40, to: 50 });
    await appendTranscript(s.id, [entry(45, "inside second"), entry(60, "back on")]);

    got = await getSession(s.id);
    expect(got?.transcript.map((e) => e.t)).toEqual([5, 25, 30, 60]);
    expect(got?.events.map((e) => e.t)).toEqual([5, 25]);
    expect(got?.off_record_ranges).toEqual([
      { from: 10, to: 20 },
      { from: 40, to: 50 },
    ]);
    expect(await sessionJson(s.id)).not.toContain("secret earlier");
  });

  it("keeps all events across 20 concurrent appends", async () => {
    const s = await createSession({ kind: "capture" });
    await Promise.all(Array.from({ length: 20 }, (_, i) => appendEvents(s.id, [event(100 + i)])));
    const got = await getSession(s.id);
    expect(got?.events).toHaveLength(20);
    expect(new Set(got?.events.map((e) => e.id)).size).toBe(20);
  });

  it("rejects an off-record range with to < from and keeps an open range open", async () => {
    const s = await createSession({ kind: "capture" });
    await setOffRecord(s.id, { from: 40 });
    await expect(setOffRecord(s.id, { from: 50, to: 45 })).rejects.toBeInstanceOf(InvalidOffRecordRangeError);
    expect((await getSession(s.id))?.off_record_ranges).toEqual([{ from: 40 }]);
    await appendTranscript(s.id, [entry(55, "still off record")]);
    expect((await getSession(s.id))?.transcript).toEqual([]);
    await setOffRecord(s.id, { from: 40, to: 40 });
    expect((await getSession(s.id))?.off_record_ranges).toEqual([{ from: 40, to: 40 }]);
  });

  it("shares the write queue Map on globalThis across module re-imports", async () => {
    const key = Symbol.for("apprentice.store.writeQueues");
    const g = globalThis as Record<symbol, unknown>;
    const first = g[key];
    expect(first).toBeInstanceOf(Map);
    vi.resetModules();
    const again = await import("./index");
    expect(g[key]).toBe(first);
    const s = await createSession({ kind: "capture" });
    const pending = again.fileStore.endSession(s.id);
    expect((first as Map<string, unknown>).has(s.id)).toBe(true);
    await pending;
  });

  it("rejects invalid session ids", async () => {
    await expect(getSession("../up")).rejects.toThrow(/invalid session id/);
    await expect(appendEvents("a/b", [])).rejects.toThrow(/invalid session id/);
    await expect(appendTranscript("..", [])).rejects.toThrow(/invalid session id/);
  });
});

describe("file backend agent links", () => {
  const avatar = { shape: "blob", face: "calm", color: "#123456", accent: "#ABCDEF" } as const;

  it("reads an agent_id with no matching agent as absent", async () => {
    const a = await fileStore.createAgent({ name: "Gone", role: "R", avatar });
    const s = await createSession({ kind: "teach", agent_id: a.id });
    // The agent vanishes without the link cleanup (the createSession vs deleteAgent race).
    const file = path.join(dir, "agents.json");
    const agents = JSON.parse(await readFile(file, "utf8")) as { id: string }[];
    await writeFile(file, JSON.stringify(agents.filter((x) => x.id !== a.id)));
    expect(JSON.parse(await sessionJson(s.id)).agent_id).toBe(a.id);
    expect((await getSession(s.id))?.agent_id).toBeUndefined();
    const summary = (await listSessions()).find((x) => x.id === s.id);
    expect(summary).toBeDefined();
    expect(summary?.agent_id).toBeUndefined();
  });

  it("deleteAgent deletes its sessions in the same write queue as the agent removal", async () => {
    const a = await fileStore.createAgent({ name: "Doomed", role: "R", avatar });
    const keep = await fileStore.createAgent({ name: "Kept", role: "R", avatar });
    const linked = await Promise.all([1, 2, 3].map(() => createSession({ kind: "capture", agent_id: a.id })));
    await saveFrame(linked[0].id, 1, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const other = await createSession({ kind: "capture", agent_id: keep.id });
    const deleted = fileStore.deleteAgent(a.id);
    // Queued behind the delete: when it lands, the sessions must already be gone from disk.
    await fileStore.updateAgent(keep.id, { name: "Kept 2" });
    for (const s of linked) await expect(access(path.join(dir, "sessions", s.id))).rejects.toThrow();
    expect(JSON.parse(await sessionJson(other.id)).agent_id).toBe(keep.id);
    expect(await deleted).toBe(true);
    expect(await fileStore.getAgent(a.id)).toBeNull();
    expect(await fileStore.deleteAgent(a.id)).toBe(false);
  });

});

describe("frames route", () => {
  const call = (id: string, name: string) =>
    getFrame(new Request("http://x/"), { params: Promise.resolve({ id, name }) });

  it("serves an existing frame", async () => {
    const s = await createSession({ kind: "capture" });
    await mkdir(path.join(dir, "sessions", s.id, "frames"), { recursive: true });
    await writeFile(path.join(dir, "sessions", s.id, "frames", "f_001.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    const res = await call(s.id, "f_001.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await call(s.id, "missing.jpg")).status).toBe(404);
  });

  it("rejects traversal names", async () => {
    for (const [id, name] of [
      ["abc", "../x.jpg"],
      ["abc", "..%2Fx.jpg"],
      ["..", "x.jpg"],
    ]) {
      expect([400, 404]).toContain((await call(id, name)).status);
    }
  });
});

describe("frames and off the record", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff]);
  const onDisk = (id: string, name: string) =>
    access(path.join(dir, "sessions", id, "frames", name)).then(
      () => true,
      () => false,
    );
  const call = (id: string, name: string) =>
    getFrame(new Request("http://x/"), { params: Promise.resolve({ id, name }) });

  it("does not write frames inside an open or closed range and writes frames outside", async () => {
    const s = await createSession({ kind: "capture" });
    await setOffRecord(s.id, { from: 10, to: 20 });
    expect(await saveFrame(s.id, 15, jpg)).toEqual({ stored: false, reason: "off_record" });
    expect(await onDisk(s.id, "0015.jpg")).toBe(false);
    expect(await saveFrame(s.id, 25, jpg)).toEqual({ stored: true, name: "0025.jpg" });
    expect(await onDisk(s.id, "0025.jpg")).toBe(true);

    await setOffRecord(s.id, { from: 30 });
    expect((await saveFrame(s.id, 31, jpg)).stored).toBe(false);
    expect((await saveFrame(s.id, 5, jpg)).stored).toBe(false);
    expect(await onDisk(s.id, "0031.jpg")).toBe(false);
    expect(await onDisk(s.id, "0005.jpg")).toBe(false);
    expect((await getSession(s.id))?.frames).toEqual([{ name: "0025.jpg", t: 25 }]);
  });

  it("closing a range deletes stored frames inside it and keeps the rest", async () => {
    const s = await createSession({ kind: "capture" });
    for (const t of [5, 12.5, 18, 25]) await saveFrame(s.id, t, jpg);
    await setOffRecord(s.id, { from: 10 });
    await setOffRecord(s.id, { from: 10, to: 20 });
    expect(await onDisk(s.id, "0005.jpg")).toBe(true);
    expect(await onDisk(s.id, "0012.jpg")).toBe(false);
    expect(await onDisk(s.id, "0018.jpg")).toBe(false);
    expect(await onDisk(s.id, "0025.jpg")).toBe(true);
    expect((await getSession(s.id))?.frames?.map((f) => f.t)).toEqual([5, 25]);
    expect(await readFrame(s.id, "0012.jpg")).toBeNull();
    expect((await call(s.id, "0012.jpg")).status).toBe(404);
    expect((await call(s.id, "0018.jpg")).status).toBe(404);
    expect((await call(s.id, "0025.jpg")).status).toBe(200);
  });

  it("returns 404 for a frame that was never stored", async () => {
    const s = await createSession({ kind: "capture" });
    await setOffRecord(s.id, { from: 0, to: 10 });
    await saveFrame(s.id, 3, jpg);
    expect((await call(s.id, "0003.jpg")).status).toBe(404);
  });
});

describe("off-record route", () => {
  const post = (id: string, body: unknown) =>
    postOffRecord(new Request("http://x/", { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });

  it("returns 400 for to < from and 200 for a valid range", async () => {
    const s = await createSession({ kind: "capture" });
    expect((await post(s.id, { from: 20, to: 10 })).status).toBe(400);
    expect((await getSession(s.id))?.off_record_ranges).toEqual([]);
    expect((await post(s.id, { from: 10, to: 20 })).status).toBe(200);
  });
});
