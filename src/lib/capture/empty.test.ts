// Empty capture runs (T-0213): thresholds, the purge after 24 h and the file store's 'No work recorded' mark.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupRecent } from "@/components/shell/recent";
import type { QAPair, ScreenEvent, Session, WorkMap } from "@/lib/types";
import { EMPTY_PURGE_MS, isEmptyCapture, isEmptyRun, isEmptySession, isPurgeable, NO_WORK_RECORDED, type RunFacts } from "./empty";
import { purgeEmptySessions, type EmptyPurgePort } from "./emptyPurge";

vi.mock("@/lib/supabase/env", () => ({ appMode: () => "local" }));

const T0 = "2026-10-04T08:00:00.000Z";
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const run = (over: Partial<RunFacts> = {}): RunFacts => ({ kind: "capture", started_at: T0, ended_at: at(120), events: 0, answered: 0, work: false, ...over });

const ev = (i: number): ScreenEvent => ({ id: `e${i}`, t: i, source: "vision", type: "record_opened", entity: { kind: "email", id: `m${i}` } }) as ScreenEvent;
const qa = (answer?: string): QAPair => ({ id: `q${answer ?? "x"}`, t_question: 1, question: "Why?", phase: "capture", about: "reason", ...(answer !== undefined ? { answer, t_answer: 2 } : {}) });
const step = { n: 1 } as unknown as WorkMap["steps"][number];
const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  kind: "capture",
  started_at: T0,
  ended_at: at(120),
  events: [],
  transcript: [],
  qa: [],
  off_record_ranges: [],
  ...over,
});

describe("empty-run thresholds", () => {
  it("under 30 s is empty, 30 s is not (by duration)", () => {
    expect(isEmptyRun(run({ ended_at: at(29.9), events: 10, answered: 2 }))).toBe(true);
    expect(isEmptyRun(run({ ended_at: at(30), events: 10, answered: 2 }))).toBe(false);
  });
  it("fewer than 3 events and no answered question is empty; 3 events or one answer is not", () => {
    expect(isEmptyRun(run({ events: 2 }))).toBe(true);
    expect(isEmptyRun(run({ events: 3 }))).toBe(false);
    expect(isEmptyRun(run({ events: 0, answered: 1 }))).toBe(false);
  });
  it("a live run is never empty", () => {
    expect(isEmptyRun(run({ ended_at: undefined }))).toBe(false);
    expect(isEmptyRun(run({ ended_at: null }))).toBe(false);
  });
  it("teach sessions, runs with recorded work and runs linked to a process are never empty", () => {
    expect(isEmptyCapture(run())).toBe(true);
    expect(isEmptyCapture(run({ kind: "teach" }))).toBe(false);
    expect(isEmptyCapture(run({ work: true }))).toBe(false);
    expect(isEmptyCapture(run({ process_id: "p1" }))).toBe(false);
  });
  it("reads a session: unanswered questions do not count, a Work Map without steps is no work", () => {
    expect(isEmptySession(session({ events: [ev(1), ev(2)], qa: [qa(), qa("  ")] }))).toBe(true);
    expect(isEmptySession(session({ events: [ev(1)], qa: [qa("Because the supplier is new")] }))).toBe(false);
    expect(isEmptySession(session({ events: [ev(1), ev(2), ev(3)] }))).toBe(false);
    const noSteps = { task: "unspecified task", expert: "x", confirmed_by_expert: true, steps: [], open_questions: [] };
    expect(isEmptySession(session({ workmap: noSteps }))).toBe(true);
    expect(isEmptySession(session({ ended_at: at(5), workmap: { ...noSteps, steps: [step] } }))).toBe(false);
  });
});

describe("purge after 24 h", () => {
  const now = Date.parse(at(120)) + EMPTY_PURGE_MS;
  it("purges at exactly 24 h after the end, not a moment before", () => {
    expect(isPurgeable(run(), now)).toBe(true);
    expect(isPurgeable(run(), now - 1)).toBe(false);
    expect(isPurgeable(run({ events: 5 }), now)).toBe(false);
  });
  it("deletes frames first, then only the purgeable sessions", async () => {
    const calls: string[] = [];
    const port: EmptyPurgePort = {
      candidates: async (cutoff) => {
        expect(cutoff).toBe(now - EMPTY_PURGE_MS);
        return [
          { id: "old", ...run() },
          { id: "busy", ...run({ events: 4 }) },
          { id: "fresh", ...run({ ended_at: at(200) }) },
        ];
      },
      frameObjectsOf: async (ids) => ids.map((id) => `${id}/f.jpg`),
      removeObjects: async (paths) => void calls.push(`objects:${paths.join(",")}`),
      deleteSessions: async (ids) => void calls.push(`sessions:${ids.join(",")}`),
    };
    expect(await purgeEmptySessions(port, now)).toEqual({ purged: 1 });
    expect(calls).toEqual(["objects:old/f.jpg", "sessions:old"]);
  });
});

describe("file store: 'No work recorded', Delete and the one-time cleanup", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "empty-runs-"));
    vi.stubEnv("DATA_DIR", dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  const put = async (s: Session) => {
    await mkdir(path.join(dir, "sessions", s.id), { recursive: true });
    await writeFile(path.join(dir, "sessions", s.id, "session.json"), JSON.stringify(s));
  };

  it("marks empty runs, lists them as 'No work recorded' and the cron purges old ones (existing ones included)", async () => {
    const { fileStore } = await import("@/lib/store");
    const { fileEmptyPurgePort } = await import("./emptyPurge");
    // Before the rule: no events, no Work Map, ended days ago. Same mark, purged by the next cron run.
    await put(session({ id: "legacy", started_at: "2026-10-01T08:00:00.000Z", ended_at: "2026-10-01T08:10:00.000Z" }));
    await put(session({ id: "today", started_at: at(0), ended_at: at(10) }));
    await put(session({ id: "work", events: [ev(1), ev(2), ev(3)] }));
    const list = await fileStore.listSessions();
    const byId = Object.fromEntries(list.map((s) => [s.id, s]));
    expect(byId.legacy.empty).toBe(true);
    expect(byId.today.empty).toBe(true);
    expect(byId.work.empty).toBeUndefined();
    const titles = groupRecent(list, new Date(at(60))).flatMap((g) => g.items);
    expect(titles.find((i) => i.id === "today")).toMatchObject({ title: NO_WORK_RECORDED, href: "/debrief/today" });
    expect(titles.find((i) => i.id === "work")?.title).not.toBe(NO_WORK_RECORDED);

    expect(await purgeEmptySessions(fileEmptyPurgePort(), Date.parse(at(60)))).toEqual({ purged: 1 });
    expect((await fileStore.listSessions()).map((s) => s.id).sort()).toEqual(["today", "work"]);
    expect(await purgeEmptySessions(fileEmptyPurgePort(), Date.parse(at(10)) + EMPTY_PURGE_MS)).toEqual({ purged: 1 });
    expect((await fileStore.listSessions()).map((s) => s.id)).toEqual(["work"]);
  });

  it("a Work Map without steps (the old 'unspecified task' run) is 'No work recorded' and deletable by the creator or owner", async () => {
    const { fileStore } = await import("@/lib/store");
    const noSteps = { task: "unspecified task", expert: "x", confirmed_by_expert: true, steps: [], open_questions: [] };
    await put(session({ id: "nosteps", workmap: noSteps }));
    const [s] = await fileStore.listSessions();
    expect(s).toMatchObject({ id: "nosteps", empty: true, has_workmap: true });
    const [item] = groupRecent([s], new Date(at(60)), {}, 6, () => true).flatMap((g) => g.items);
    expect(item).toMatchObject({ title: NO_WORK_RECORDED, deletable: true });
    expect(groupRecent([s], new Date(at(60))).flatMap((g) => g.items)[0].deletable).toBeUndefined();
  });
});
