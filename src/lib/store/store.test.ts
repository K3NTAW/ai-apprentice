import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getFrame } from "@/app/api/session/[id]/frames/[name]/route";
import type { ScreenEvent, TranscriptEntry } from "@/lib/types";
import {
  appendEvents,
  appendTranscript,
  createSession,
  endSession,
  getSession,
  listSessions,
  setOffRecord,
  upsertQA,
} from "./index";

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

  it("rejects invalid session ids", async () => {
    await expect(getSession("../up")).rejects.toThrow(/invalid session id/);
    await expect(appendEvents("a/b", [])).rejects.toThrow(/invalid session id/);
    await expect(appendTranscript("..", [])).rejects.toThrow(/invalid session id/);
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
