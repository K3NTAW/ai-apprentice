// Cost window and row mapping for GET /api/workspace/cost and the CostCard. Rows are untrusted: every field is mapped defensively.

export const COST_DEFAULT_DAYS = 30;
export const COST_MAX_DAYS = 90;
export const COST_ROW_LIMIT = 500;

const KINDS = ["vision", "decide", "workmap", "voice", "frame"] as const;
export type CostKind = (typeof KINDS)[number] | "other";

export type CostRow = {
  day: string;
  kind: CostKind;
  events: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  voice_seconds: number | null;
  bytes: number | null;
  chf: number | null;
  unpriced_events: number;
};

export type CostResponse = { days: number; truncated: boolean; rows: CostRow[]; local?: true };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Europe/Zurich minus days - 1, as YYYY-MM-DD: the first day bucket of the window. */
export function zurichCutoff(days: number, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

// numeric columns arrive as strings from PostgREST.
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function mapCostRow(raw: unknown): CostRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== "string" || !DAY.test(r.day)) return null;
  const kind = (KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as CostKind) : "other";
  return {
    day: r.day,
    kind,
    events: num(r.events),
    input_tokens: num(r.input_tokens),
    output_tokens: num(r.output_tokens),
    cache_read_tokens: num(r.cache_read_tokens),
    voice_seconds: num(r.voice_seconds),
    bytes: num(r.bytes),
    chf: num(r.chf),
    unpriced_events: num(r.unpriced_events) ?? 0,
  };
}

export function parseDays(raw: string | null): number | null {
  if (raw === null) return COST_DEFAULT_DAYS;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= COST_MAX_DAYS ? n : null;
}
