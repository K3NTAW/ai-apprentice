// Shared behaviour contract for every SessionStore backend. Imported by contract.test.ts; not a test file itself.
// Events and transcript are appended in non-decreasing t; QA and frames are compared as sets keyed by id / name.
import { beforeEach, describe, expect, it } from "vitest";
import { redactText } from "@/lib/redact";
import type { Avatar, QAPair, ScreenEvent, TranscriptEntry, WorkMap } from "@/lib/types";
import {
  AgentNotFoundError,
  EmptyProcessPatchError,
  frameName,
  InvalidOffRecordRangeError,
  InvalidSessionIdError,
  ProcessExistsError,
  ProcessNotFoundError,
  ProcessVersionConflictError,
  SessionLinkedError,
  SessionNotFoundError,
  type SessionStore,
} from "./types";
import { backfillProcesses } from "@/lib/processes/server";

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
// Backfill needs recorded work: a confirmed Work Map with steps (a Work Map without steps is an empty run).
const step: WorkMap["steps"][number] = { n: 1, title: "s", decision: "d", is_judgment_call: false, screen_moment: { t: 0, entity: "e" }, guardrails: [], scores: { reason_captured: 1, guardrail_captured: 1 }, reason: null };
const avatar: Avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

    it("lists recent sessions newest first, at most limit", async () => {
      const tick = () => new Promise((r) => setTimeout(r, 3));
      const a = await store.createSession({ kind: "capture", expert: "Sabine" });
      await tick();
      const b = await store.createSession({ kind: "teach" });
      await tick();
      const c = await store.createSession({ kind: "capture", agent_id: (await store.createAgent({ name: "A", role: "R", avatar })).id });
      await store.saveWorkMap(b.id, workmap);
      await store.endSession(a.id);
      const two = await store.recentSessions(2);
      expect(two.map((x) => x.id)).toEqual([c.id, b.id]);
      expect(two[0]).toMatchObject({ kind: "capture", agent_id: c.agent_id, has_workmap: false });
      expect(two[0].ended_at).toBeUndefined();
      expect(two[1]).toMatchObject({ kind: "teach", has_workmap: true });
      const all = await store.recentSessions();
      expect(all.length).toBeLessThanOrEqual(6);
      expect(all.slice(0, 3).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
      expect(all[2]).toMatchObject({ expert: "Sabine", ended_at: expect.any(String) });
      expect(all.map((x) => x.started_at)).toEqual([...all.map((x) => x.started_at)].sort().reverse());
      expect(await store.recentSessions(0)).toEqual([]);
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

    it("creates, lists, gets, patches and deletes agents", async () => {
      const a = await store.createAgent({ name: "Senior Sales Person", role: "Sales", expert_name: "Sabine", avatar });
      expect(a).toMatchObject({ name: "Senior Sales Person", role: "Sales", expert_name: "Sabine", avatar });
      expect(a.id).toMatch(UUID_RE);
      expect(new Date(a.created_at).toISOString()).toBe(a.created_at);
      const b = await store.createAgent({ name: "Controller", role: "Finance", avatar });
      expect(b.expert_name).toBeUndefined();
      expect(await store.getAgent(a.id)).toEqual(a);
      const list = await store.listAgents();
      expect(list.map((x) => x.id)).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(list.map((x) => x.created_at)).toEqual(list.map((x) => x.created_at).sort().reverse());

      const other: Avatar = { shape: "star", face: "robot", color: "#000000", accent: "#FFFFFF" };
      const p = await store.updateAgent(a.id, { name: "Sales Lead", avatar: other, expert_name: null });
      expect(p).toMatchObject({ id: a.id, name: "Sales Lead", role: "Sales", avatar: other, created_at: a.created_at });
      expect(p.expert_name).toBeUndefined();
      expect(await store.getAgent(a.id)).toEqual(p);

      expect(await store.deleteAgent(b.id)).toBe(true);
      expect(await store.deleteAgent(b.id)).toBe(false);
      expect(await store.getAgent(b.id)).toBeNull();
      await expect(store.updateAgent(b.id, { name: "x" })).rejects.toBeInstanceOf(AgentNotFoundError);
      expect(await store.getAgent("not-a-uuid")).toBeNull();
      expect(await store.deleteAgent("not-a-uuid")).toBe(false);
    });

    it("links a session to an agent and clears the link when the agent is deleted", async () => {
      const a = await store.createAgent({ name: "Senior Sales Person", role: "Sales", avatar });
      const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      expect(s.agent_id).toBe(a.id);
      expect((await store.getSession(s.id))?.agent_id).toBe(a.id);
      expect((await store.listSessions()).find((x) => x.id === s.id)?.agent_id).toBe(a.id);
      const plain = await store.createSession({ kind: "teach" });
      expect(plain.agent_id).toBeUndefined();
      await expect(store.createSession({ kind: "teach", agent_id: "00000000-0000-4000-8000-00000000dead" })).rejects.toBeInstanceOf(
        AgentNotFoundError,
      );
      await store.deleteAgent(a.id);
      const kept = await store.getSession(s.id);
      expect(kept?.agent_id).toBeUndefined();
      expect(kept?.expert).toBe("Sabine");
    });

    it("lists session digests newest first, without child rows", async () => {
      const a = await store.createAgent({ name: "Digest Agent", role: "Ops", avatar });
      const first = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      await store.appendEvents(first.id, [event(1)]);
      await store.saveWorkMap(first.id, workmap);
      await new Promise((r) => setTimeout(r, 5));
      const second = await store.createSession({ kind: "teach" });
      const digests = await store.listSessionDigests();
      const ids = digests.map((d) => d.id);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
      const d = digests.find((x) => x.id === first.id)!;
      expect(d).toMatchObject({ kind: "capture", expert: "Sabine", agent_id: a.id, workmap });
      expect(d).not.toHaveProperty("events");
      expect(d).not.toHaveProperty("transcript");
      expect(digests.find((x) => x.id === second.id)?.workmap).toBeUndefined();
    });

    it("creates, gets, lists, updates, archives and deletes processes, with a version row per Work Map change", async () => {
      const a = await store.createAgent({ name: "Process Agent", role: "AP", avatar });
      const other = await store.createAgent({ name: "Other Agent", role: "AP", avatar });
      const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      const p = await store.createProcess({ agent_id: a.id, title: "Pay invoice", workmap: { ...workmap, confirmed_by_expert: true }, source_session_id: s.id });
      expect(p).toMatchObject({ agent_id: a.id, title: "Pay invoice", version: 1, confirmed: true, archived_at: null });
      expect(p.id).toMatch(UUID_RE);
      expect(new Date(p.created_at).toISOString()).toBe(p.created_at);
      expect(await store.getProcess(p.id)).toEqual(p);
      expect((await store.getSession(s.id))?.process_id).toBe(p.id);

      await new Promise((r) => setTimeout(r, 3));
      const q = await store.createProcess({ agent_id: a.id, title: "Draft", workmap });
      expect(q.confirmed).toBe(false);
      const o = await store.createProcess({ agent_id: other.id, title: "Theirs", workmap });
      expect((await store.listProcesses({ agent_id: a.id })).map((x) => x.id)).toEqual([q.id, p.id]);
      expect((await store.listProcesses()).map((x) => x.id)).toEqual(expect.arrayContaining([p.id, q.id, o.id]));

      const renamed = await store.updateProcess(p.id, { title: "Pay supplier invoice" });
      expect(renamed).toMatchObject({ title: "Pay supplier invoice", version: 1, created_at: p.created_at });
      const s2 = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      const extended = { ...workmap, task: "pay invoice v2", confirmed_by_expert: true };
      const v2 = await store.updateProcess(p.id, { workmap: extended, change_kind: "extended", source_session_id: s2.id });
      expect(v2).toMatchObject({ version: 2, workmap: extended, title: "Pay supplier invoice" });
      expect((await store.getSession(s2.id))?.process_id).toBe(p.id);
      const v3 = await store.updateProcess(p.id, { workmap: { ...extended, open_questions: ["why?"] } });
      expect(v3.version).toBe(3);

      const versions = await store.listProcessVersions(p.id);
      expect(versions.map((v) => [v.version, v.change_kind, v.source_session_id])).toEqual([
        [3, "edited", null],
        [2, "extended", s2.id],
        [1, "trained", s.id],
      ]);
      expect(versions[1].workmap).toEqual(extended);
      expect(versions[2].workmap.task).toBe("pay invoice");

      const archived = await store.updateProcess(q.id, { archived: true });
      expect(archived.archived_at).toEqual(expect.any(String));
      expect((await store.listProcesses({ agent_id: a.id })).map((x) => x.id)).toEqual([p.id]);
      expect((await store.listProcesses({ agent_id: a.id, include_archived: true })).map((x) => x.id)).toEqual([q.id, p.id]);
      expect((await store.updateProcess(q.id, { archived: false })).archived_at).toBeNull();

      expect(await store.deleteProcess(p.id)).toBe(true);
      expect(await store.deleteProcess(p.id)).toBe(false);
      expect(await store.getProcess(p.id)).toBeNull();
      expect(await store.listProcessVersions(p.id)).toEqual([]);
      const kept = await store.getSession(s.id);
      expect(kept?.process_id).toBeUndefined();
      expect(kept?.expert).toBe("Sabine");
      await expect(store.updateProcess(p.id, { title: "x" })).rejects.toBeInstanceOf(ProcessNotFoundError);
      expect(await store.getProcess("not-a-uuid")).toBeNull();
      expect(await store.deleteProcess("not-a-uuid")).toBe(false);
      expect(await store.listProcessVersions("not-a-uuid")).toEqual([]);

      // Deleting the agent deletes its processes and their versions.
      await store.deleteAgent(a.id);
      expect(await store.getProcess(q.id)).toBeNull();
      expect(await store.listProcessVersions(q.id)).toEqual([]);
      expect(await store.getProcess(o.id)).toMatchObject({ id: o.id });
    });

    it("updates a Work Map only from the expected version; a stale one writes nothing", async () => {
      const a = await store.createAgent({ name: "Conflict Agent", role: "AP", avatar });
      const p = await store.createProcess({ agent_id: a.id, title: "T", workmap });
      const mine = { ...workmap, task: "mine", confirmed_by_expert: true };
      const v2 = await store.updateProcess(p.id, { workmap: mine, expected_version: 1 });
      expect(v2).toMatchObject({ version: 2, confirmed: true });
      // A second editor still on version 1 loses: no process change, no version row, no session link.
      const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      await expect(
        store.updateProcess(p.id, { workmap: { ...workmap, task: "theirs" }, expected_version: 1, source_session_id: s.id }),
      ).rejects.toBeInstanceOf(ProcessVersionConflictError);
      expect(await store.getProcess(p.id)).toMatchObject({ version: 2, workmap: mine, confirmed: true });
      expect((await store.listProcessVersions(p.id)).map((v) => v.version)).toEqual([2, 1]);
      expect((await store.getSession(s.id))?.process_id).toBeUndefined();
      // confirmed follows the Work Map: an unconfirmed edit unconfirms the process.
      const v3 = await store.updateProcess(p.id, { workmap: { ...mine, confirmed_by_expert: false }, expected_version: 2 });
      expect(v3).toMatchObject({ version: 3, confirmed: false });
      const [latest] = await store.listProcessVersions(p.id);
      expect(latest).toMatchObject({ version: 3, change_kind: "edited" });
      expect(latest.workmap.confirmed_by_expert).toBe(false);
    });

    it("backfills one process per legacy confirmed session, idempotently, and lists the link on digests", async () => {
      const a = await store.createAgent({ name: "Legacy Agent", role: "AP", avatar });
      const legacy = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      await store.saveWorkMap(legacy.id, { ...workmap, task: "  Book   invoices ", confirmed_by_expert: true, steps: [step] });
      const draft = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      await store.saveWorkMap(draft.id, workmap);
      const held = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      await store.saveWorkMap(held.id, { ...workmap, confirmed_by_expert: true });
      const existing = await store.createProcess({ agent_id: a.id, title: "Held", workmap: { ...workmap, confirmed_by_expert: true }, source_session_id: held.id });

      // Two concurrent calls: each legacy session becomes one process, created_at is the session's started_at.
      const both = await Promise.all([backfillProcesses(store, { agent_id: a.id }), backfillProcesses(store, { agent_id: a.id })]);
      const created = both.flat();
      expect(created.map((p) => [p.title, p.confirmed, p.version])).toEqual([["Book invoices", true, 1]]);
      expect(created[0].created_at).toBe(legacy.started_at);
      expect((await store.listProcesses({ agent_id: a.id })).filter((p) => p.title === "Book invoices")).toHaveLength(1);
      expect((await store.listProcessVersions(created[0].id))[0]).toMatchObject({ change_kind: "trained", source_session_id: legacy.id });
      const digests = await store.listSessionDigests();
      expect(digests.find((d) => d.id === legacy.id)?.process_id).toBe(created[0].id);
      expect(digests.find((d) => d.id === held.id)?.process_id).toBe(existing.id);
      expect(digests.find((d) => d.id === draft.id)?.process_id).toBeUndefined();

      expect(await backfillProcesses(store, { agent_id: a.id })).toEqual([]);
      expect((await store.listProcesses({ agent_id: a.id })).map((p) => p.id).sort()).toEqual([created[0].id, existing.id].sort());
    });

    it("rejects a process for a missing agent or source session", async () => {
      await expect(
        store.createProcess({ agent_id: "00000000-0000-4000-8000-00000000dead", title: "x", workmap }),
      ).rejects.toBeInstanceOf(AgentNotFoundError);
      const a = await store.createAgent({ name: "A", role: "R", avatar });
      await expect(store.createProcess({ agent_id: a.id, title: "x", workmap, source_session_id: "s_missing" })).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
      expect(await store.listProcesses({ agent_id: a.id })).toEqual([]);
    });

    it("rejects an empty patch and writes nothing", async () => {
      const a = await store.createAgent({ name: "Empty Agent", role: "AP", avatar });
      const p = await store.createProcess({ agent_id: a.id, title: "T", workmap });
      await expect(store.updateProcess(p.id, {})).rejects.toBeInstanceOf(EmptyProcessPatchError);
      await expect(store.updateProcess(p.id, { expected_version: 1, change_kind: "edited" })).rejects.toBeInstanceOf(EmptyProcessPatchError);
      expect(await store.getProcess(p.id)).toEqual(p);
    });

    it("never takes a session from another process", async () => {
      const a = await store.createAgent({ name: "Link Agent", role: "AP", avatar });
      const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      const s2 = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      const mine = await store.createProcess({ agent_id: a.id, title: "Mine", workmap, source_session_id: s.id });
      const theirs = await store.createProcess({ agent_id: a.id, title: "Theirs", workmap });
      await store.updateProcess(mine.id, { title: "Mine 2", source_session_id: s2.id });
      // Re-linking to the same process is fine; to another process it is refused and writes nothing.
      expect(await store.updateProcess(mine.id, { title: "Mine 3", source_session_id: s.id })).toMatchObject({ title: "Mine 3" });
      await expect(store.updateProcess(theirs.id, { title: "Stolen", source_session_id: s.id })).rejects.toBeInstanceOf(SessionLinkedError);
      await expect(
        store.updateProcess(theirs.id, { workmap: { ...workmap, task: "stolen" }, source_session_id: s2.id }),
      ).rejects.toBeInstanceOf(SessionLinkedError);
      expect(await store.getProcess(theirs.id)).toMatchObject({ title: "Theirs", version: 1 });
      await expect(store.createProcess({ agent_id: a.id, title: "New", workmap, source_session_id: s2.id })).rejects.toBeInstanceOf(
        SessionLinkedError,
      );
      await expect(store.createProcess({ agent_id: a.id, title: "New", workmap, source_session_id: s.id })).rejects.toBeInstanceOf(
        ProcessExistsError,
      );
      expect((await store.listProcesses({ agent_id: a.id })).map((x) => x.id).sort()).toEqual([mine.id, theirs.id].sort());
      expect((await store.getSession(s.id))?.process_id).toBe(mine.id);
      expect((await store.getSession(s2.id))?.process_id).toBe(mine.id);
    });

    it("does not recreate a deleted process on the next backfill", async () => {
      const a = await store.createAgent({ name: "Tombstone Agent", role: "AP", avatar });
      const legacy = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
      await store.saveWorkMap(legacy.id, { ...workmap, confirmed_by_expert: true, steps: [step] });
      const [p] = await backfillProcesses(store, { agent_id: a.id });
      expect(p).toMatchObject({ agent_id: a.id });
      expect(await store.deleteProcess(p.id)).toBe(true);
      expect((await store.getSession(legacy.id))?.process_id).toBeUndefined();
      expect(await backfillProcesses(store, { agent_id: a.id })).toEqual([]);
      expect(await store.listProcesses({ agent_id: a.id, include_archived: true })).toEqual([]);
    });

    it("saves teach progress, replaces it and shows it in digests and summaries", async () => {
      const src = await store.createSession({ kind: "capture" });
      const t = await store.createSession({ kind: "teach" });
      const first = { workmap_session_id: src.id, mastered: ["s1"], practice: ["s2"], interventions: 1 };
      expect((await store.saveTeach(t.id, first)).teach).toEqual(first);
      const second = { ...first, mastered: ["s1", "s2"], practice: [], interventions: 2, finished_at: "2026-10-04T10:00:00.000Z" };
      await store.saveTeach(t.id, second);
      expect((await store.getSession(t.id))?.teach).toEqual(second);
      expect((await store.listSessionDigests()).find((d) => d.id === t.id)?.teach).toEqual(second);
      expect((await store.listSessionDigests()).find((d) => d.id === src.id)?.teach).toBeUndefined();
      await expect(store.saveTeach("s_missing", first)).rejects.toBeInstanceOf(SessionNotFoundError);
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
