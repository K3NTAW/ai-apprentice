// Every agent setting changes behaviour: ask gate gap, guardrails-first priority, chords, voice overrides,
// redaction recognizers, the off-record phrase, retention and the delete contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureController, type CaptureApi, type CaptureVoice } from "@/lib/capture/controller";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { redactText } from "@/lib/redact";
import { recognizersFromSettings } from "@/lib/store/types";
import type { DecisionResult } from "@/lib/types";
import { createAskGate, questionPriority, type PendingItem } from "@/lib/voice/askGate";
import { interviewerFirstMessage, interviewerPrompt } from "@/lib/voice/prompts";
import {
  deleteAgentData,
  DeleteAgentError,
  isMigrationMissing,
  runRetention,
  SettingsUnavailableError,
  supabaseAgentAdmin,
  validCronBearer,
  type DataPort,
  type FrameRef,
  type RetentionPort,
} from "./admin";
import {
  AgentSettingsPatch,
  DEFAULT_SETTINGS,
  minGapMs,
  offRecordPhrase,
  offRecordRegExp,
  recognizers,
  resolveSettings,
  voiceOverrides,
  VOICE_PRESET_FALLBACK,
} from "./settings";

const dr = (question: string, answer: string | number): DecisionResult =>
  ({ question, answer, confidence: 1, provider: "heuristic", latency_ms: 0 }) as DecisionResult;
const item = (cls: string, id: string): PendingItem => ({
  event: { id, t: 0, source: "os", type: "field_changed", entity: { kind: "invoice", id } } as unknown as PendingItem["event"],
  eventClass: dr("event_class", cls),
  screenExplains: dr("screen_explains_it", 0),
  timing: dr("ask_timing", "ask_now"),
});
const quiet = { typing: false, speaking: false, silence_ms: 5000 };

describe("settings schema", () => {
  it("defaults: redaction on, interval 60 s (active cadence minimum gap), phrase 'off the record'", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ redact_names_emails: true, redact_iban_phone: true, question_interval_s: 60, off_record_phrase: "off the record" });
    expect(minGapMs(DEFAULT_SETTINGS)).toBe(60000);
    // Stored rows with an explicit 20 keep it; rows without the key get the new default.
    expect(minGapMs(resolveSettings({ question_interval_s: 20 }))).toBe(20000);
    expect(minGapMs(resolveSettings({}))).toBe(60000);
    expect(resolveSettings({ retention_days: 7, voice_speed: 9, bogus: 1 })).toEqual({ ...DEFAULT_SETTINGS, retention_days: 7 });
  });
  it("rejects unknown keys, out of range values and an adversarial phrase", () => {
    expect(AgentSettingsPatch.safeParse({ nope: true }).success).toBe(false);
    expect(AgentSettingsPatch.safeParse({ question_interval_s: 45 }).success).toBe(false);
    expect(AgentSettingsPatch.safeParse({ voice_speed: 1.3 }).success).toBe(false);
    expect(AgentSettingsPatch.safeParse({ voice_speed: 0.9 }).success).toBe(true);
    for (const bad of [".*", "(a+)+$", "off\\b|", "x".repeat(41), "say \"hi\"", "<script>"])
      expect(AgentSettingsPatch.safeParse({ off_record_phrase: bad }).success).toBe(false);
    expect(offRecordPhrase({ off_record_phrase: ".*" })).toBe("off the record");
    expect(offRecordPhrase({ off_record_phrase: "  " })).toBe("off the record");
  });
});

describe("question interval and guardrails first (ask gate)", () => {
  it("the interval is the gate's minimum gap", () => {
    let t = 0;
    const gate = createAskGate({ cadence: "classic", minGapMs: minGapMs({ ...DEFAULT_SETTINGS, question_interval_s: 120 }), now: () => t });
    const ask = () => gate.consider({ ...item("judgment_call", "a"), activity: quiet, agentSpeaking: false });
    expect(ask().action).toBe("ask_now");
    gate.markAsked("reason");
    t = 119_000;
    expect(ask()).toMatchObject({ action: "save_for_debrief", why: "min_gap" });
    t = 120_000;
    expect(ask().action).toBe("ask_now");
  });
  it("guardrails first raises possible_guardrail from priority 1 to 2 and asks it before an earlier judgment call", () => {
    expect(questionPriority("possible_guardrail", true)).toBe(2);
    expect(questionPriority("possible_guardrail", false)).toBe(1);
    expect(questionPriority("judgment_call", true)).toBe(1);
    for (const [first, expected] of [[true, "g"], [false, "j"]] as const) {
      const gate = createAskGate({ cadence: "classic", guardrailsFirst: first, now: () => 0 });
      gate.enqueue(item("judgment_call", "j"));
      gate.enqueue(item("possible_guardrail", "g"));
      expect(gate.nextReady(quiet)?.item.event.entity?.id).toBe(expected);
    }
  });
});

describe("capture controller: shortcuts and the off-record phrase", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(extra: { learnShortcuts?: boolean; offRecordPhrase?: string }) {
    const api = {
      postEvents: vi.fn<CaptureApi["postEvents"]>(async () => ({})),
      postTranscript: vi.fn<CaptureApi["postTranscript"]>(async () => ({})),
      postQA: vi.fn<CaptureApi["postQA"]>(async () => ({})),
      setOffRecord: vi.fn<CaptureApi["setOffRecord"]>(async () => ({})),
      decide: vi.fn<CaptureApi["decide"]>(async () => ({}) as never),
    };
    const voice = { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: vi.fn(() => false) };
    const now = () => Date.now();
    const bus = createEventBus({ now: () => now() / 1000 });
    const publish = vi.spyOn(bus, "publishOs");
    const c = createCaptureController({
      api,
      voice: voice as unknown as CaptureVoice,
      bus,
      activity: createActivityTracker({ now }),
      gate: createAskGate({ cadence: "classic", now }),
      now,
      sessionId: "s_test",
      getT: () => now() / 1000,
      shortcutLearning: true,
      ...extra,
    });
    c.start();
    return { c, api, publish };
  }
  const chordsPublished = (publish: { mock: { calls: unknown[][] } }) =>
    publish.mock.calls.filter((call) => (call[0] as { type?: string }).type === "shortcut_used").length;

  it("learn keyboard shortcuts off drops every chord (no shortcut events, so no shortcut questions)", async () => {
    for (const learn of [true, false]) {
      const { c, publish } = setup({ learnShortcuts: learn });
      for (let i = 0; i < 3; i++) {
        c.onCompanionChord({ t: i, chord: "Cmd+Enter", app: "Outlook" });
        await vi.advanceTimersByTimeAsync(3000);
      }
      c.stop();
      expect(chordsPublished(publish) > 0).toBe(learn);
    }
  });

  it("the agent's phrase starts off the record; the default phrase then does not", () => {
    const { c, api } = setup({ offRecordPhrase: "pause please" });
    c.onTranscript("expert", "let's go off the record");
    expect(c.isOffRecord()).toBe(false);
    c.onTranscript("expert", "OK, Pause  please.");
    expect(c.isOffRecord()).toBe(true);
    expect(api.setOffRecord).toHaveBeenCalledTimes(1);
    expect(offRecordRegExp("a.b").test("axb")).toBe(false);
    expect(interviewerPrompt("pause please")).toContain('when the expert says "pause please"');
    expect(interviewerFirstMessage("pause please")).toContain("Say 'pause please' any time");
  });
});

describe("voice preset and speed", () => {
  const s = { ...DEFAULT_SETTINGS, voice_preset: "energetic" as const, voice_speed: 1.2 };
  it("go into the TTS session overrides when the agent allows them", () => {
    expect(voiceOverrides(s, true)).toEqual({ overrides: { tts: { speed: 1.2, stability: 0.3 } }, notice: null });
  });
  it("only the speed is applied, with the fallback notice, when overrides are not allowed", () => {
    expect(voiceOverrides(s, false)).toEqual({ overrides: { tts: { speed: 1.2 } }, notice: VOICE_PRESET_FALLBACK });
  });
});

describe("redaction toggles select recognizers", () => {
  const text = "Mail anna.meier@example.com or call +41 44 123 45 67, IBAN CH93 0076 2011 6238 5295 7";
  it("names and emails off keeps the address, IBAN and phone still go", () => {
    const out = redactText(text, { recognizers: recognizers({ ...DEFAULT_SETTINGS, redact_names_emails: false }) }).text;
    expect(out).toContain("anna.meier@example.com");
    expect(out).toContain("<PHONE_NUMBER>");
    expect(out).toContain("<IBAN_CODE>");
  });
  it("IBAN and phone off keeps them, the address goes; stored settings map the same way", () => {
    const sel = recognizersFromSettings({ redact_iban_phone: false });
    expect(sel).toEqual({ namesEmails: true, ibanPhone: false });
    const out = redactText(text, { recognizers: sel }).text;
    expect(out).toContain("<EMAIL_ADDRESS>");
    expect(out).toContain("+41 44 123 45 67");
    expect(out).not.toContain("<IBAN_CODE>");
  });
});

const DAY = 24 * 60 * 60 * 1000;

describe("retention cleanup (fake store and storage)", () => {
  it("deletes Storage objects first, then rows, only older than the agent's setting, batch-limited, idempotent", async () => {
    const now = Date.UTC(2026, 9, 4);
    const frames: (FrameRef & { at: number; agent: string })[] = [
      { session_id: "s1", name: "a.jpg", path: "w/s1/a.jpg", at: now - 10 * DAY, agent: "a7" },
      { session_id: "s1", name: "b.jpg", path: "w/s1/b.jpg", at: now - 2 * DAY, agent: "a7" },
      { session_id: "s2", name: "c.jpg", path: "w/s2/c.jpg", at: now - 10 * DAY, agent: "a90" },
    ];
    const log: string[] = [];
    const port: RetentionPort = {
      agents: async () => [{ id: "a7", settings: { retention_days: 7 } }, { id: "a90", settings: {} }],
      oldFrames: async (agent, cutoff, limit) => frames.filter((f) => f.agent === agent && f.at < cutoff).slice(0, limit),
      removeObjects: async (paths) => void log.push(`storage:${paths.join(",")}`),
      deleteFrameRows: async (fs) => {
        log.push(`rows:${fs.map((f) => f.name).join(",")}`);
        for (const f of fs) frames.splice(frames.findIndex((x) => x.name === f.name), 1);
      },
    };
    expect(await runRetention(port, now)).toEqual({ agents: 2, deleted: 1, more: false });
    expect(log).toEqual(["storage:w/s1/a.jpg", "rows:a.jpg"]);
    expect(frames.map((f) => f.name)).toEqual(["b.jpg", "c.jpg"]);
    expect(await runRetention(port, now)).toEqual({ agents: 2, deleted: 0, more: false });
    frames.push({ session_id: "s1", name: "d.jpg", path: "w/s1/d.jpg", at: now - 9 * DAY, agent: "a7" }, { session_id: "s1", name: "e.jpg", path: "w/s1/e.jpg", at: now - 9 * DAY, agent: "a7" });
    expect(await runRetention(port, now, 1)).toEqual({ agents: 2, deleted: 1, more: true });
  });
  it("a Storage failure leaves the rows for the next run", async () => {
    const rows = vi.fn();
    const port: RetentionPort = {
      agents: async () => [{ id: "a", settings: { retention_days: 7 } }],
      oldFrames: async () => [{ session_id: "s", name: "x.jpg", path: "p" }],
      removeObjects: async () => {
        throw new Error("storage down");
      },
      deleteFrameRows: rows,
    };
    await expect(runRetention(port, Date.now())).rejects.toThrow("storage down");
    expect(rows).not.toHaveBeenCalled();
  });
});

describe("delete contract", () => {
  function fakePort(fail?: keyof DataPort) {
    const log: string[] = [];
    const wrap = <K extends keyof DataPort>(k: K, fn: DataPort[K]): DataPort[K] =>
      (async (...a: unknown[]) => {
        if (k === fail) throw new Error(`${k} failed`);
        log.push(k);
        return (fn as (...x: unknown[]) => unknown)(...a);
      }) as DataPort[K];
    const port: DataPort = {
      agentName: wrap("agentName", async () => "Pip"),
      sessionsOf: wrap("sessionsOf", async () => [
        { id: "c1", kind: "capture", created_by: "u1", started_at: "2026-10-01T08:00:00Z", ended_at: null },
        { id: "t1", kind: "teach", created_by: "u2", started_at: "2026-10-02T08:00:00Z", ended_at: "2026-10-02T09:00:00Z" },
      ]),
      framesOf: wrap("framesOf", async () => [{ session_id: "c1", name: "f.jpg", path: "w/c1/f.jpg" }]),
      removeObjects: wrap("removeObjects", async () => {}),
      deleteFrameRows: wrap("deleteFrameRows", async () => {}),
      upsertReport: wrap("upsertReport", async () => {}),
      deleteSessions: wrap("deleteSessions", async () => {}),
      deleteAgent: wrap("deleteAgent", async () => {}),
    };
    return { port, log };
  }
  const input = { workspaceId: "w", agentId: "a", userId: "owner" };

  it("frames in Storage, frame rows, report with the teach sessions, capture sessions, then the agent", async () => {
    const { port, log } = fakePort();
    const upsert = vi.spyOn(port, "upsertReport");
    expect(await deleteAgentData(port, input)).toEqual({ deleted: true, frames: 1, sessions: 1, kept_teach: 1 });
    expect(log.slice(3)).toEqual(["removeObjects", "deleteFrameRows", "upsertReport", "deleteSessions", "deleteAgent"]);
    expect(upsert.mock.calls[0][0].teach.map((t) => t.session_id)).toEqual(["t1"]);
  });
  it("stops at the failing step and leaves the agent (retry repeats every step)", async () => {
    const { port, log } = fakePort("upsertReport");
    const err = await deleteAgentData(port, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteAgentError);
    expect((err as DeleteAgentError).step).toBe("report");
    expect(log).not.toContain("deleteSessions");
    expect(log).not.toContain("deleteAgent");
  });
  it("an already deleted agent answers deleted false without touching anything", async () => {
    const { port, log } = fakePort();
    port.agentName = async () => null;
    expect(await deleteAgentData(port, input)).toEqual({ deleted: false, frames: 0, sessions: 0, kept_teach: 0 });
    expect(log).toEqual([]);
  });
});

describe("missing column (migration not applied)", () => {
  const missing = { code: "42703", message: "column agents.settings does not exist" };
  const client = {
    from: () => {
      const q = { select: () => q, eq: () => q, order: async () => ({ data: null, error: { code: "42P01", message: 'relation "public.agent_deletion_requests" does not exist' } }), maybeSingle: async () => ({ data: null, error: missing }) };
      return q;
    },
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.agent_settings_patch" } }),
  };
  const admin = supabaseAgentAdmin(client as never, { workspaceId: "w", userId: "u" });
  it("reads answer the defaults with available false; saves throw settings_unavailable", async () => {
    expect(await admin.getSettings("a")).toEqual({ settings: DEFAULT_SETTINGS, available: false });
    expect(await admin.listRequests()).toEqual([]);
    await expect(admin.patchSettings("a", { guardrails_first: false })).rejects.toBeInstanceOf(SettingsUnavailableError);
  });
  it("only the undefined column, function or table errors count", () => {
    expect(isMigrationMissing(missing)).toBe(true);
    expect(isMigrationMissing({ code: "42703", message: "column foo does not exist" })).toBe(false);
    expect(isMigrationMissing({ code: "42501", message: "permission denied for agents.settings" })).toBe(false);
  });
});

describe("cron bearer", () => {
  it("constant-time check that fails closed without a secret", () => {
    const secret = "s".repeat(32);
    expect(validCronBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(validCronBearer(`Bearer ${secret}x`, secret)).toBe(false);
    expect(validCronBearer(null, secret)).toBe(false);
    expect(validCronBearer("Bearer ", undefined)).toBe(false);
    expect(validCronBearer("Bearer short", "short")).toBe(false);
  });
});
