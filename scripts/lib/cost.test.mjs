import { describe, expect, it } from "vitest";
import { dayOf, median, summarise } from "./cost.mjs";

const prices = {
  models: [
    { model: "claude-haiku-4-5-20251001", valid_from: "2026-10-01", chf_per_m_input: "0.90", chf_per_m_output: "4.50", chf_per_m_cache_read: "0.09" },
    { model: "claude-opus-5-5", valid_from: "2026-10-01", chf_per_m_input: 3.6, chf_per_m_output: 18, chf_per_m_cache_read: 0.36 },
  ],
  voice: [{ valid_from: "2026-10-01", chf_per_minute: "0.072" }],
  storageChfPerGbMonth: 0.0189,
  retentionMonths: 3,
};

const HAIKU = "claude-haiku-4-5-20251001";
const sessions = [
  { id: "cap1", kind: "capture", created_by: "u1", started_at: "2026-10-07T08:00:00Z", ended_at: "2026-10-07T09:00:00Z" },
  { id: "cap2", kind: "capture", created_by: "u1", started_at: "2026-10-07T10:00:00Z", ended_at: "2026-10-07T10:30:00Z" },
  { id: "cap3", kind: "capture", created_by: "u1", started_at: "2026-10-07T12:00:00Z", ended_at: "2026-10-07T14:00:00Z" },
  { id: "tch1", kind: "teach", created_by: "u2", started_at: "2026-10-07T08:00:00Z", ended_at: "2026-10-07T08:30:00Z" },
];

const vision = (session_id, at, model = HAIKU) => ({
  session_id,
  user_id: "u1",
  kind: "vision",
  model,
  input_tokens: 1_000_000,
  output_tokens: 0,
  cache_read_tokens: 0,
  created_at: at,
});

describe("summarise", () => {
  it("returns empty rows and null stats for empty input", () => {
    const r = summarise([], [], {});
    expect(r.sessions).toEqual([]);
    expect(r.unpriced).toEqual([]);
    expect(r.unattributed).toEqual({ events: 0, chf: 0 });
    expect(r.kinds.capture).toMatchObject({ sessions: 0, chf_total: 0, chf_per_hour: { min: null, median: null, max: null } });
    expect(r.kinds.teach.share.vision).toBeNull();
    expect(summarise().sessions).toEqual([]);
  });

  it("builds per-session rows and capture cost per hour with min/median/max", () => {
    const events = [
      vision("cap1", "2026-10-07T08:10:00Z"),
      { session_id: "cap1", user_id: "u1", kind: "decide", model: HAIKU, input_tokens: 0, output_tokens: 1_000_000, cache_read_tokens: 0, created_at: "2026-10-07T08:11:00Z" },
      { session_id: "cap1", user_id: "u1", kind: "workmap", model: "claude-opus-5-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: "1000000", created_at: "2026-10-07T08:55:00Z" },
      { session_id: "cap1", user_id: "u1", kind: "frame", bytes: "1000000000", created_at: "2026-10-07T08:12:00Z" },
      { session_id: "v_00000000-0000-0000-0000-000000000001", user_id: "u1", kind: "voice", voice_seconds: "600", created_at: "2026-10-07T09:01:00Z" },
      vision("cap2", "2026-10-07T10:05:00Z"),
      vision("cap3", "2026-10-07T12:05:00Z"),
    ];
    const r = summarise(events, sessions, prices);
    const cap1 = r.sessions.find((s) => s.session_id === "cap1");
    expect(cap1).toMatchObject({ minutes: 60, vision_calls: 1, decide_calls: 1, workmap_calls: 1, frames: 1, frame_bytes: 1e9, voice_seconds: 600, partial: false });
    expect(cap1.input_tokens).toBe(1_000_000);
    expect(cap1.chf.vision).toBeCloseTo(0.9);
    expect(cap1.chf.decide).toBeCloseTo(4.5);
    expect(cap1.chf.workmap).toBeCloseTo(0.36);
    expect(cap1.chf.voice).toBeCloseTo(0.72);
    expect(cap1.chf.storage).toBeCloseTo(0.0567);
    expect(cap1.chf_per_hour).toBeCloseTo(0.9 + 4.5 + 0.36 + 0.72 + 0.0567);

    const cap = r.kinds.capture;
    expect(cap.sessions).toBe(3);
    // cap2: 0.9 CHF in 0.5 h = 1.8/h, cap3: 0.9 in 2 h = 0.45/h
    expect(cap.chf_per_hour.min).toBeCloseTo(0.45);
    expect(cap.chf_per_hour.median).toBeCloseTo(1.8);
    expect(cap.chf_per_hour.max).toBeCloseTo(6.5367);
    const shares = Object.values(cap.share).reduce((a, b) => a + b, 0);
    expect(shares).toBeCloseTo(1);
    expect(cap.share.vision).toBeCloseTo(2.7 / cap.chf_total);
    expect(r.unattributed.events).toBe(0);
  });

  it("attributes voice by user and time window to a teach session", () => {
    const events = [
      { session_id: "tch1", user_id: "u2", kind: "vision", model: HAIKU, input_tokens: 1_000_000, created_at: "2026-10-07T08:05:00Z" },
      { session_id: "tch1", user_id: "u2", kind: "decide", model: HAIKU, input_tokens: 1_000_000, created_at: "2026-10-07T08:06:00Z" },
      { session_id: "v_00000000-0000-0000-0000-000000000002", user_id: "u2", kind: "voice", voice_seconds: 1800, created_at: "2026-10-07T07:58:00Z" },
      { session_id: "v_00000000-0000-0000-0000-000000000003", user_id: "u2", kind: "voice", voice_seconds: null, created_at: "2026-10-07T08:10:00Z" },
      { session_id: "v_00000000-0000-0000-0000-000000000004", user_id: "u3", kind: "voice", voice_seconds: 60, created_at: "2026-10-07T08:10:00Z" },
    ];
    const r = summarise(events, sessions, prices);
    const t = r.sessions.find((s) => s.session_id === "tch1");
    expect(t).toMatchObject({ kind: "teach", minutes: 30, voice_seconds: 1800 });
    expect(t.chf.voice).toBeCloseTo(2.16);
    expect(r.kinds.teach.chf_per_hour.median).toBeCloseTo((0.9 + 0.9 + 2.16) * 2);
    expect(r.kinds.teach.share.voice).toBeCloseTo(2.16 / 3.96);
    expect(r.kinds.capture.chf_total).toBe(0);
    expect(r.unattributed.events).toBe(1);
  });

  it("reports a model without a price row instead of throwing", () => {
    const events = [vision("cap2", "2026-10-07T10:05:00Z", "claude-unknown-9"), vision("cap2", "2026-10-07T10:06:00Z", "claude-unknown-9"), vision("cap2", "2026-10-07T10:07:00Z")];
    let r;
    expect(() => (r = summarise(events, sessions, prices))).not.toThrow();
    expect(r.unpriced).toEqual([{ kind: "vision", model: "claude-unknown-9", events: 2 }]);
    const cap2 = r.sessions.find((s) => s.session_id === "cap2");
    expect(cap2).toMatchObject({ vision_calls: 3, partial: true });
    expect(cap2.chf.vision).toBeCloseTo(0.9);
    expect(r.kinds.capture.partial).toBe(true);
  });

  it("does not price a row dated before the price's valid_from", () => {
    const r = summarise([vision("cap1", "2026-09-30T08:10:00Z")], sessions, prices);
    expect(r.unpriced).toEqual([{ kind: "vision", model: HAIKU, events: 1 }]);
  });

  it("uses the last event as the end of an open session", () => {
    const open = [{ id: "open", kind: "capture", created_by: "u1", started_at: "2026-10-07T08:00:00Z", ended_at: null }];
    const r = summarise([vision("open", "2026-10-07T08:20:00Z")], open, prices);
    expect(r.sessions[0].minutes).toBe(20);
  });
});

describe("helpers", () => {
  it("dayOf uses the Europe/Zurich date", () => {
    expect(dayOf("2026-10-06T22:30:00Z")).toBe("2026-10-07");
    expect(dayOf("nope")).toBeNull();
  });

  it("median handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
