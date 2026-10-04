// Debrief loop (docs/BUILD_SPEC.md Module 2, section 6 row 3): gap-driven follow-ups, rising scores,
// spoken teach-back with expert confirm. Framework free; all I/O is injected.
// Pacing: one full build at start, a rescore only after each answer, one full rebuild before the teach-back.
import { fallbackQuestion } from "@/lib/capture/controller";
import { buildAskTurn, buildTeachBackTurn, buildThinkingTurn } from "@/lib/voice/prompts";
import type { Gap } from "@/lib/workmap";
import { newId, type QAPair, type ScreenEvent, type Session, type TranscriptEntry, type WorkMap } from "@/lib/types";

export type BuildResult = { workmap: WorkMap; gaps: Gap[]; understood: boolean; teach_back: string };

export type DebriefApi = {
  buildWorkMap(sessionId: string, rescoreOnly?: boolean): Promise<BuildResult>;
  confirm(sessionId: string, confirmed: boolean, correction?: string): Promise<{ workmap?: WorkMap } | void>;
  postTranscript(entries: TranscriptEntry[]): Promise<unknown>;
  postQA(qa: QAPair): Promise<unknown>;
};

export type DebriefVoice = {
  promptTurn(text: string): void;
  injectContext(text: string): void;
};

export type DebriefPhase = "idle" | "building" | "asking" | "teach_back" | "confirmed" | "corrected";
export type EndReason = "all steps above threshold" | "question budget reached";

export type ScoreSnapshot = {
  at: number;
  steps: { n: number; reason_captured: number; guardrail_captured: number }[];
};

export type DebriefQuestion = {
  text: string;
  about: QAPair["about"];
  step_n?: number;
  event_id?: string;
  source: "gap" | "saved" | "probe";
};

export type DebriefControllerOptions = {
  api: DebriefApi;
  voice: DebriefVoice;
  sessionId: string;
  /** The session as it was after capture: its capture-phase QA pairs are the questions already asked live. */
  session?: Pick<Session, "qa" | "events" | "transcript">;
  /** Events the capture loop saved for the debrief (or left unasked). */
  savedForDebrief?: ScreenEvent[];
  minFollowUps?: number;
  maxFollowUps?: number;
  /** Wall clock in ms. */
  now: () => number;
  onChange?: () => void;
  onError?: (where: string, err: unknown) => void;
};

export type DebriefState = {
  phase: DebriefPhase;
  busy: boolean;
  /** True while the Work Map scores an answer or rebuilds before the teach-back. */
  thinking?: boolean;
  question: DebriefQuestion | null;
  queue: DebriefQuestion[];
  asked: DebriefQuestion[];
  followUpsAsked: number;
  minFollowUps: number;
  maxFollowUps: number;
  understood: boolean;
  endReason: EndReason | null;
  history: ScoreSnapshot[];
  workmap: WorkMap | null;
  gaps: Gap[];
  teachBack: string | null;
  /** True after 'Not quite' without a correction yet. */
  awaitingCorrection: boolean;
  error: string | null;
};

const WORDS_PER_SECOND = 2.5;

/** Spoken length estimate in seconds (words / 2.5 per second). */
export function spokenSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round((words / WORDS_PER_SECOND) * 10) / 10;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function onScreenObject(step: WorkMap["steps"][number]): string {
  const field = step.screen_moment.field ? `, ${step.screen_moment.field.replace(/[_-]+/g, " ")}` : "";
  return `${step.screen_moment.entity || "this record"}${field}`;
}

export function createDebriefController(opts: DebriefControllerOptions) {
  const { api, voice, sessionId, now, onChange, onError } = opts;
  const minFollowUps = opts.minFollowUps ?? 3;
  const maxFollowUps = Math.max(opts.maxFollowUps ?? 6, minFollowUps);
  const session = opts.session ?? { qa: [], events: [], transcript: [] };
  const liveQA = session.qa.filter((q) => q.phase === "capture");
  const liveTexts = new Set(liveQA.map((q) => norm(q.question)));
  const liveEventIds = new Set(liveQA.map((q) => q.event_id).filter((x): x is string => Boolean(x)));
  const eventsById = new Map(session.events.map((e) => [e.id, e]));

  // Debrief times continue after the last captured moment, in session seconds.
  const lastT = Math.max(
    0,
    ...session.events.map((e) => e.t),
    ...session.transcript.map((e) => e.t),
    ...session.qa.map((q) => q.t_answer ?? q.t_question),
  );
  const startedAt = now();
  const getT = () => Math.round((lastT + 1 + (now() - startedAt) / 1000) * 10) / 10;

  const state: DebriefState = {
    phase: "idle",
    busy: false,
    thinking: false,
    question: null,
    queue: [],
    asked: [],
    followUpsAsked: 0,
    minFollowUps,
    maxFollowUps,
    understood: false,
    endReason: null,
    history: [],
    workmap: null,
    gaps: [],
    teachBack: null,
    awaitingCorrection: false,
    error: null,
  };
  let tQuestion = 0;
  let stopped = false;
  /** Answers posted since the last full build (each only rescored). */
  let rescoredSinceFull = 0;

  const changed = () => onChange?.();
  const fail = (where: string, err: unknown) => {
    state.error = `${where}: ${err instanceof Error ? err.message : String(err)}`;
    onError?.(where, err);
  };

  /** A step question was asked live when a capture QA sits on the step's screen moment and covers the same kind. */
  function askedLive(step_n: number | undefined, about: QAPair["about"], text: string): boolean {
    if (liveTexts.has(norm(text))) return true;
    const step = state.workmap?.steps.find((s) => s.n === step_n);
    if (!step) return false;
    return liveQA.some((q) => {
      const ev = q.event_id ? eventsById.get(q.event_id) : undefined;
      const onStep = ev ? ev.t === step.screen_moment.t : q.t_question === step.screen_moment.t;
      return onStep && (q.about === about || q.about === "other");
    });
  }

  function buildQueue(gaps: Gap[]): DebriefQuestion[] {
    const seen = new Set(state.asked.map((q) => norm(q.text)));
    const out: DebriefQuestion[] = [];
    const add = (q: DebriefQuestion) => {
      const key = norm(q.text);
      if (seen.has(key) || liveTexts.has(key)) return;
      seen.add(key);
      out.push(q);
    };
    // gaps() already sorts lowest score first.
    for (const g of gaps) {
      if (askedLive(g.step_n, g.missing, g.suggested_question)) continue;
      add({ text: g.suggested_question, about: g.missing, step_n: g.step_n, source: "gap" });
    }
    const need = () => minFollowUps - state.followUpsAsked - out.length;
    if (need() > 0) {
      for (const ev of opts.savedForDebrief ?? []) {
        if (need() <= 0) break;
        if (liveEventIds.has(ev.id)) continue;
        add({ text: fallbackQuestion(ev, "reason"), about: "reason", event_id: ev.id, source: "saved" });
      }
    }
    if (need() > 0 && state.workmap) {
      const steps = state.workmap.steps;
      const ordered = [...steps.filter((s) => s.is_judgment_call), ...steps.filter((s) => !s.is_judgment_call)];
      for (const step of ordered) {
        if (need() <= 0) break;
        const obj = onScreenObject(step);
        add({ text: `Is there a limit on ${obj}?`, about: "guardrail", step_n: step.n, source: "probe" });
        if (need() <= 0) break;
        add({ text: `When would you stop and ask someone about ${obj}?`, about: "guardrail", step_n: step.n, source: "probe" });
      }
    }
    return out;
  }

  function applyBuild(res: BuildResult) {
    state.workmap = res.workmap;
    state.gaps = res.gaps;
    state.understood = res.understood;
    state.teachBack = res.teach_back;
    state.history.push({
      at: now(),
      steps: res.workmap.steps.map((s) => ({
        n: s.n,
        reason_captured: s.scores.reason_captured,
        guardrail_captured: s.scores.guardrail_captured,
      })),
    });
    state.queue = buildQueue(res.gaps);
  }

  function shouldEnd(): EndReason | null {
    const enough = state.followUpsAsked >= minFollowUps;
    if (state.understood && enough) return "all steps above threshold";
    if (state.followUpsAsked >= maxFollowUps) return "question budget reached";
    if (!state.queue.length) return state.understood ? "all steps above threshold" : "question budget reached";
    return null;
  }

  /** One full rebuild before the teach-back; on failure (e.g. the route timed out) the last map stays. */
  async function fullRebuild() {
    if (!rescoredSinceFull) return;
    state.thinking = true;
    changed();
    try {
      applyBuild(await api.buildWorkMap(sessionId, false));
      rescoredSinceFull = 0;
    } catch (err) {
      fail("rebuild", err);
    } finally {
      state.thinking = false;
    }
  }

  async function beginTeachBack(reason: EndReason) {
    state.endReason = reason;
    state.question = null;
    await fullRebuild();
    if (stopped) return;
    state.phase = "teach_back";
    voice.injectContext(`Debrief questions are done (${reason}). Give the teach-back next.`);
    voice.promptTurn(buildTeachBackTurn(state.teachBack ?? "", { closing: true }));
  }

  async function askNext() {
    const reason = shouldEnd();
    if (reason) return beginTeachBack(reason);
    const q = state.queue.shift()!;
    state.question = q;
    state.phase = "asking";
    tQuestion = getT();
    voice.promptTurn(buildAskTurn(q.text));
  }

  async function postEntry(speaker: TranscriptEntry["speaker"], text: string, t = getT()) {
    try {
      await api.postTranscript([{ id: newId("tr"), t, speaker, text, phase: "debrief", redacted: false }]);
    } catch (err) {
      fail("postTranscript", err);
    }
  }

  async function start() {
    if (state.phase !== "idle" || state.busy) return;
    state.phase = "building";
    state.busy = true;
    state.error = null;
    changed();
    try {
      applyBuild(await api.buildWorkMap(sessionId, false));
      rescoredSinceFull = 0;
      if (!stopped) await askNext();
    } catch (err) {
      state.phase = "idle";
      fail("buildWorkMap", err);
    } finally {
      state.busy = false;
      changed();
    }
  }

  /** The expert's next utterance answers the current question; outside of asking it is only transcribed. */
  async function onExpertUtterance(text: string) {
    const answer = text.trim();
    if (!answer || stopped) return;
    if (state.phase !== "asking" || !state.question || state.busy) {
      if (state.phase !== "idle") void postEntry("expert", answer);
      return;
    }
    const q = state.question;
    state.busy = true;
    state.question = null;
    state.asked.push(q);
    state.followUpsAsked += 1;
    changed();
    const tAnswer = Math.max(getT(), tQuestion);
    const qa: QAPair = {
      id: newId("qa"),
      t_question: tQuestion,
      t_answer: tAnswer,
      question: q.text,
      answer,
      phase: "debrief",
      about: q.about,
      ...(q.event_id ? { event_id: q.event_id } : {}),
    };
    try {
      await postEntry("expert", answer, tAnswer);
      await api.postQA(qa);
      rescoredSinceFull += 1;
      state.thinking = true;
      changed();
      voice.promptTurn(buildThinkingTurn());
      applyBuild(await api.buildWorkMap(sessionId, true));
    } catch (err) {
      fail("answer", err);
      state.queue = buildQueue(state.gaps);
    }
    state.thinking = false;
    if (!stopped) await askNext();
    state.busy = false;
    changed();
  }

  function onAgentUtterance(text: string) {
    const t = text.trim();
    if (t && !stopped && state.phase !== "idle") void postEntry("agent", t);
  }

  /** From the confirm_teach_back client tool or the on-screen buttons. */
  async function onTeachBackResult(result: { confirmed: boolean; correction?: string }) {
    if ((state.phase !== "teach_back" && state.phase !== "corrected") || state.busy || stopped) return;
    const correction = result.correction?.trim();
    state.busy = true;
    state.error = null;
    changed();
    try {
      if (result.confirmed && !correction) {
        const res = await api.confirm(sessionId, true);
        if (res && res.workmap) state.workmap = res.workmap;
        else if (state.workmap) state.workmap = { ...state.workmap, confirmed_by_expert: true };
        state.phase = "confirmed";
        state.awaitingCorrection = false;
      } else if (!correction) {
        state.awaitingCorrection = true;
      } else {
        const t = getT();
        await api.postQA({
          id: newId("qa"),
          t_question: t,
          t_answer: t,
          question: `Teach-back: ${state.teachBack ?? ""}`,
          answer: correction,
          phase: "debrief",
          about: "other",
        });
        applyBuild(await api.buildWorkMap(sessionId, false));
        // Confirm after the rebuild so the correction note stays on the saved map.
        const res = await api.confirm(sessionId, false, correction);
        if (res && res.workmap) state.workmap = res.workmap;
        state.awaitingCorrection = false;
        state.phase = "corrected";
        voice.promptTurn(buildTeachBackTurn(`Thanks, I fixed that. ${state.teachBack ?? ""}`));
      }
    } catch (err) {
      fail("confirm", err);
    } finally {
      state.busy = false;
      changed();
    }
  }

  return {
    start,
    onExpertUtterance,
    onAgentUtterance,
    onTeachBackResult,
    stop: () => {
      stopped = true;
    },
    getState: (): Readonly<DebriefState> => state,
  };
}

export type DebriefController = ReturnType<typeof createDebriefController>;
