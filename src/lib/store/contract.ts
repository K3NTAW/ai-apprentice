// Shared behaviour contract for every SessionStore backend. Imported by contract.test.ts; not a test file itself.
// Events and transcript are appended in non-decreasing t; QA and frames are compared as sets keyed by id / name.
import { beforeEach, describe, expect, it } from "vitest";
import { redactText } from "@/lib/redact";
import type { QAPair, ScreenEvent, TranscriptEntry, WorkMap } from "@/lib/types";
import {
  frameName,
  InvalidOffRecordRangeError,
  InvalidSessionIdError,
  SessionNotFoundError,
  type SessionStore,
} from "./types";

export const entry = (t: number, text: string): TranscriptEntry => ({
  id: `tr_${t}`,
  t,
  speaker: "expert",
  text,
  phase: "capture",
  redacted: false,
});

export const event = (t: number, id = `ev_${t}`): ScreenEvent => ({
  id,
  t,
  source: "dom",
  type: "field_changed",
  entity: { kind: "invoice", id: "4471" },
});

export const qaPair = (id: string, t: number, extra: Partial<QAPair> = {}): QAPair => ({
  id,
  t_question: t,
  question: `question ${id}`,
  phase: "capture",
  about: "reason",
  ...extra,
});

const workmap: WorkMap = { task: "pay invoice", expert: "Sabine", confirmed_by_expert: false, steps: [], open_questions: [] };
const byKey = <T,>(xs: T[], k: (x: T) => string) => [...xs].sort((a, b) => k(a).localeCompare(k(b)));

export function runStoreContract(name: string, makeStore: () => SessionStore | Promise<SessionStore>): void {
  describe(`store contract: ${name}`, () => {
    let store: SessionStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    it("creates, gets, lists, saves a workmap and ends a session", async () => {
      const s = await store.createSession({ kind: "capture", expert: "Sabine Keller" });
      expect(s).toMatchObject({ kind: "capture", expert: "Sabine Keller", events: [], transcript: [], qa: [], off_record_ranges: [] });
      expect(new Date(s.started_at).toISOString()).toBe(s.started_at);
      expect(await store.getSession(s.id)).toEqual(s);
      const t = await store.createSession({ kind: "teach" });
      expect(t.expert).toBeUndefined();
      await store.appendEvents(s.id, [event(1), event(2)]);
      await store.upsertQA(s.id, qaPair("qa_1", 1));
      await store.saveWorkMap(s.id, workmap);
      const list = await store.listSessions();
      const mine = list.find((x) => x.id === s.id);
      expect(mine).toMatchObject({ kind: "capture", expert: "Sabine Keller", has_workmap: true });
      expect(mine?.counts).toEqual({ events: 2, transcript: 0, qa: 1 });
      expect(list.find((x) => x.id === t.id)).toMatchObject({ kind: "teach", has_workmap: false });
      const ended = await store.endSession(s.id);
      expect(ended.ended_at).toBeDefined();
      expect((await store.endSession(s.id)).ended_at).toBe(ended.ended_at);
      expect((await store.getSession(s.id))?.workmap).toEqual(workmap);
    });

    it("keeps append order for events and transcript", async () => {
      const s = await store.createSession({ kind: "capture" });
      await store.appendEvents(s.id, [event(1), event(2, "ev_2a"), event(2, "ev_2b")]);
      await store.appendEvents(s.id, [event(3)]);
      await store.appendTranscript(s.id, [entry(1, "one"), entry(2, "two")]);
      await store.appendTranscript(s.id, [entry(5, "five")]);
      const got = await store.getSession(s.id);
      expect(got?.events.map((e) => e.id)).toEqual(["ev_1", "ev_2a", "ev_2b", "ev_3"]);
      expect(got?.transcript.map((e) => e.text)).toEqual(["one", "two", "five"]);
    });

    it("upserts QA by id", async () => {
      const s = await store.createSession({ kind: "capture" });
      await store.upsertQA(s.id, qaPair("qa_1", 1));
      await store.upsertQA(s.id, qaPair("qa_2", 2));
      await store.upsertQA(s.id, qaPair("qa_1", 1, { answer: "because", t_answer: 3 }));
      const qa = byKey((await store.getSession(s.id))!.qa, (q) => q.id);
      expect(qa).toEqual([qaPair("qa_1", 1, { answer: "because", t_answer: 3 }), qaPair("qa_2", 2)]);
    });

    it("redacts transcript and QA text before storing", async () => {
      const s = await store.createSession({ kind: "capture", expert: "Sabine Keller" });
      const raw = "Sabine here: pay invoice 4471 to CH93 0076 2011 6238 5295 7.";
      await store.appendTranscript(s.id, [entry(1, raw)]);
      await store.upsertQA(s.id, qaPair("qa_1", 2, { question: "Why call Frau Meier?", answer: "Her IBAN DE89370400440532013000 changed." }));
      const got = await store.getSession(s.id);
      expect(got?.transcript[0]).toMatchObject({ text: redactText(raw, { keepNames: ["Sabine"] }).text, redacted: true });
      expect(got?.transcript[0].text).toBe("Sabine here: pay invoice 4471 to <IBAN_CODE>.");
      const blob = JSON.stringify(got);
      expect(blob).not.toContain("CH93 0076");
      expect(blob).not.toContain("DE89370400440532013000");
      expect(blob).not.toContain("Meier");
    });

    it("skips off-record items and purges stored rows and frame objects when a range closes", async () => {
      const s = await store.createSession({ kind: "capture" });
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      await store.appendEvents(s.id, [event(5), event(50)]);
      await store.appendTranscript(s.id, [entry(5, "kept"), entry(50, "purged later")]);
      expect(await store.saveFrame(s.id, 5, jpg)).toEqual({ stored: true, name: frameName(5) });
      expect(await store.saveFrame(s.id, 50, jpg)).toEqual({ stored: true, name: frameName(50) });

      await store.setOffRecord(s.id, { from: 40 });
      await store.appendEvents(s.id, [event(45), event(100)]);
      await store.appendTranscript(s.id, [entry(60, "while open")]);
      expect(await store.saveFrame(s.id, 45, jpg)).toEqual({ stored: false, reason: "off_record" });
      expect(await store.saveFrame(s.id, 100, jpg)).toEqual({ stored: false, reason: "off_record" });

      const closed = await store.setOffRecord(s.id, { from: 42, to: 70 });
      expect(closed.off_record_ranges).toEqual([{ from: 40, to: 70 }]);
      expect(closed.events.map((e) => e.t)).toEqual([5]);
      expect(closed.transcript.map((e) => e.t)).toEqual([5]);
      expect(closed.frames).toEqual([{ name: frameName(5), t: 5 }]);
      expect(await store.readFrame(s.id, frameName(50))).toBeNull();
      expect(await store.readFrame(s.id, frameName(5))).toEqual(jpg);

      await store.appendEvents(s.id, [event(60), event(80)]);
      expect(await store.saveFrame(s.id, 70, jpg)).toEqual({ stored: false, reason: "off_record" });
      expect((await store.getSession(s.id))?.events.map((e) => e.t)).toEqual([5, 80]);
    });

    it("rejects an invalid range and keeps the stored ranges", async () => {
      const s = await store.createSession({ kind: "capture" });
      await store.setOffRecord(s.id, { from: 10 });
      await expect(store.setOffRecord(s.id, { from: 10, to: 5 })).rejects.toBeInstanceOf(InvalidOffRecordRangeError);
      expect((await store.getSession(s.id))?.off_record_ranges).toEqual([{ from: 10 }]);
    });

    it("reports missing sessions and invalid ids", async () => {
      const id = "s_missing";
      expect(await store.getSession(id)).toBeNull();
      await expect(store.appendEvents(id, [event(1)])).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.appendTranscript(id, [entry(1, "x")])).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.upsertQA(id, qaPair("qa_1", 1))).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.setOffRecord(id, { from: 1 })).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.saveWorkMap(id, workmap)).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.endSession(id)).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.getSession("../etc")).rejects.toBeInstanceOf(InvalidSessionIdError);
      // The file backend throws synchronously for a bad id, so normalise to a rejection.
      await expect(Promise.resolve().then(() => store.appendEvents("a/b", []))).rejects.toBeInstanceOf(InvalidSessionIdError);
    });
  });
}
