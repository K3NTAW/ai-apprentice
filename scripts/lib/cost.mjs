// Measured unit cost (P0-10, docs/checks/unit-cost.md). Pure: no I/O, no env, never throws on missing prices.
//
// summarise(events, sessions, prices) turns usage_events rows into per-session rows and per-kind cost per hour.
// - events: usage_events rows { session_id, user_id, kind, model, input_tokens, output_tokens, cache_read_tokens,
//   voice_seconds, bytes, created_at }. Numbers may arrive as strings (PostgREST numeric), they go through Number().
// - sessions: sessions rows { id, kind ('capture' | 'teach'), created_by, started_at, ended_at }.
// - prices: { models: model_prices rows, voice: voice_prices rows, storageChfPerGbMonth, retentionMonths }.
//
// Attribution: vision, decide, workmap and frame rows carry the session id. Voice rows carry the usage token
// (v_<uuid>), so a voice row goes to the session of the same user whose window (started_at - 5 min to
// ended_at + 5 min) contains its created_at; the latest started session wins. Rows that match no session are
// counted in `unattributed`. A model row without a price valid on its Europe/Zurich day is costed 0 and listed in
// `unpriced`; the session is marked partial. Voice rows with voice_seconds null (nothing reported yet) are skipped.

export const CATEGORIES = ["vision", "voice", "decide", "workmap", "storage"];
export const MODEL_KINDS = ["vision", "decide", "workmap"];
export const VOICE_SLACK_MS = 5 * 60 * 1000;

const zurichDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of an ISO timestamp in Europe/Zurich, or null for an invalid date. */
export function dayOf(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? zurichDay.format(new Date(t)) : null;
}

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? 0 : n;
};

/** Median of a non-empty number list. */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Latest row with valid_from <= day, or null. */
function priceOn(rows, day) {
  let best = null;
  for (const r of rows) if (day && String(r.valid_from) <= day && (!best || String(r.valid_from) > String(best.valid_from))) best = r;
  return best;
}

function emptyCost() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
}

function newRow(s) {
  return {
    session_id: s.id,
    kind: s.kind,
    started_at: s.started_at,
    ended_at: s.ended_at ?? null,
    minutes: 0,
    vision_calls: 0,
    decide_calls: 0,
    workmap_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    voice_seconds: 0,
    frames: 0,
    frame_bytes: 0,
    chf: emptyCost(),
    chf_total: 0,
    chf_per_hour: null,
    partial: false,
    last_event_at: null,
  };
}

function stats(xs) {
  return xs.length ? { min: Math.min(...xs), median: median(xs), max: Math.max(...xs) } : { min: null, median: null, max: null };
}

/**
 * @returns {{ sessions: object[], kinds: { capture: object, teach: object }, unpriced: object[], unattributed: object }}
 */
export function summarise(events = [], sessions = [], prices = {}) {
  const models = prices.models ?? [];
  const voicePrices = prices.voice ?? [];
  const storagePerGbMonth = num(prices.storageChfPerGbMonth);
  const retentionMonths = num(prices.retentionMonths);

  const rows = new Map();
  for (const s of sessions) if (s && s.id && (s.kind === "capture" || s.kind === "teach")) rows.set(s.id, newRow(s));
  const byUser = [...rows.values()].map((r) => ({ row: r, user: sessions.find((s) => s.id === r.session_id)?.created_by ?? null }));

  const unpriced = new Map();
  const unattributed = { events: 0, chf: 0 };
  const noteUnpriced = (kind, model) => {
    const key = `${kind}\u0000${model ?? ""}`;
    const u = unpriced.get(key) ?? { kind, model: model ?? null, events: 0 };
    u.events += 1;
    unpriced.set(key, u);
  };

  const voiceSession = (e) => {
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t)) return null;
    let best = null;
    for (const { row, user } of byUser) {
      if (e.user_id && user && e.user_id !== user) continue;
      const start = Date.parse(row.started_at);
      const end = row.ended_at ? Date.parse(row.ended_at) : Infinity;
      if (!Number.isFinite(start)) continue;
      if (t >= start - VOICE_SLACK_MS && t <= end + VOICE_SLACK_MS && (!best || start > Date.parse(best.started_at))) best = row;
    }
    return best;
  };

  for (const e of events) {
    if (!e || typeof e.kind !== "string") continue;
    if (e.kind === "voice" && (e.voice_seconds === null || e.voice_seconds === undefined)) continue;
    const day = dayOf(e.created_at);

    let chf = 0;
    let priced = true;
    let category = null;
    if (MODEL_KINDS.includes(e.kind)) {
      category = e.kind;
      const p = priceOn(models.filter((m) => m.model === e.model), day);
      if (p) {
        chf =
          (num(e.input_tokens) * num(p.chf_per_m_input) +
            num(e.output_tokens) * num(p.chf_per_m_output) +
            num(e.cache_read_tokens) * num(p.chf_per_m_cache_read)) /
          1e6;
      } else priced = false;
    } else if (e.kind === "voice") {
      category = "voice";
      const p = priceOn(voicePrices, day);
      if (p) chf = (num(e.voice_seconds) / 60) * num(p.chf_per_minute);
      else priced = false;
    } else if (e.kind === "frame") {
      category = "storage";
      chf = (num(e.bytes) / 1e9) * storagePerGbMonth * retentionMonths;
    } else continue;
    if (!priced) noteUnpriced(e.kind, e.kind === "voice" ? null : e.model);

    const row = e.kind === "voice" ? voiceSession(e) : rows.get(e.session_id);
    if (!row) {
      unattributed.events += 1;
      unattributed.chf += chf;
      continue;
    }
    if (MODEL_KINDS.includes(e.kind)) {
      row[`${e.kind}_calls`] += 1;
      row.input_tokens += num(e.input_tokens);
      row.output_tokens += num(e.output_tokens);
      row.cache_read_tokens += num(e.cache_read_tokens);
    } else if (e.kind === "voice") {
      row.voice_seconds += num(e.voice_seconds);
    } else {
      row.frames += 1;
      row.frame_bytes += num(e.bytes);
    }
    if (!priced) row.partial = true;
    row.chf[category] += chf;
    row.chf_total += chf;
    if (!row.last_event_at || String(e.created_at) > row.last_event_at) row.last_event_at = String(e.created_at);
  }

  const out = [...rows.values()];
  for (const r of out) {
    const start = Date.parse(r.started_at);
    const endIso = r.ended_at ?? r.last_event_at;
    const end = endIso ? Date.parse(endIso) : NaN;
    r.minutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : 0;
    r.chf_per_hour = r.minutes > 0 ? r.chf_total / (r.minutes / 60) : null;
  }
  out.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));

  const kinds = {};
  for (const kind of ["capture", "teach"]) {
    const of = out.filter((r) => r.kind === kind);
    const timed = of.filter((r) => r.chf_per_hour !== null);
    const total = of.reduce((s, r) => s + r.chf_total, 0);
    const byCategory = emptyCost();
    for (const r of of) for (const c of CATEGORIES) byCategory[c] += r.chf[c];
    kinds[kind] = {
      sessions: of.length,
      minutes: of.reduce((s, r) => s + r.minutes, 0),
      chf_total: total,
      chf_per_hour: stats(timed.map((r) => r.chf_per_hour)),
      chf_by_category: byCategory,
      share: Object.fromEntries(CATEGORIES.map((c) => [c, total > 0 ? byCategory[c] / total : null])),
      partial: of.some((r) => r.partial),
    };
  }

  return { sessions: out, kinds, unpriced: [...unpriced.values()], unattributed };
}
