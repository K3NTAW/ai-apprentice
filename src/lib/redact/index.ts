// PII redaction with Presidio-style recognizers and placeholders (docs/BUILD_SPEC.md section 7).
// Pure: no I/O except the optional Presidio round trip in redactTextAsync.

export type RedactEntity = { type: string; start: number; end: number };
export type RedactResult = { text: string; entities: RedactEntity[] };
export type RedactOptions = {
  /** Names that must always be redacted, e.g. seed contact names. */
  knownNames?: readonly string[];
  /** Names that must never be redacted, e.g. the expert's first name. */
  keepNames?: readonly string[];
};

type Candidate = RedactEntity & { value: string };

const NAME_WORD = String.raw`\p{Lu}[\p{L}'-]+`;

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w+])(?:(?:\+|00)[1-9]|0[1-9])[\d /.()-]{6,}\d(?!\w)/g;
const CREDIT_CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const TITLED_NAME = new RegExp(
  String.raw`\b(?:Herr|Frau|Mrs|Mr|Ms|Dr)\.?\s+(${NAME_WORD}(?:\s+${NAME_WORD})?)`,
  "gud",
);
const CONTACT_NAME = new RegExp(
  String.raw`\b(?:Contact|Ansprechpartner(?:in)?)\s*:\s*(${NAME_WORD}\s+${NAME_WORD})`,
  "gud",
);

const digitCount = (s: string) => s.replace(/\D/g, "").length;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function collect(text: string, re: RegExp, type: string, accept: (v: string) => boolean = () => true) {
  const out: Candidate[] = [];
  for (const m of text.matchAll(re)) {
    const v = m[0];
    if (accept(v)) out.push({ type, start: m.index, end: m.index + v.length, value: v });
  }
  return out;
}

function collectGroup(text: string, re: RegExp, type: string) {
  const out: Candidate[] = [];
  for (const m of text.matchAll(re)) {
    const span = m.indices?.[1];
    if (span) out.push({ type, start: span[0], end: span[1], value: m[1] });
  }
  return out;
}

function knownNameCandidates(text: string, names: readonly string[], keep: Set<string>) {
  const variants = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    variants.add(name);
    const parts = name.split(/\s+/);
    if (parts.length > 1) {
      for (const p of parts) if (p.length >= 3 && !keep.has(p.toLowerCase())) variants.add(p);
    }
  }
  if (variants.size === 0) return [];
  const alt = [...variants]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");
  return collect(text, new RegExp(String.raw`(?<!\p{L})(?:${alt})(?!\p{L})`, "gu"), "PERSON");
}

export function analyze(text: string, opts: RedactOptions = {}): RedactEntity[] {
  const keep = new Set((opts.keepNames ?? []).map((n) => n.trim().toLowerCase()));
  const isKept = (v: string) => v.split(/\s+/).every((w) => keep.has(w.toLowerCase()));

  const candidates: Candidate[] = [
    ...collect(text, IBAN, "IBAN_CODE", (v) => {
      const n = v.replace(/ /g, "").length;
      return n >= 15 && n <= 34;
    }),
    ...collect(text, EMAIL, "EMAIL_ADDRESS"),
    ...collect(text, PHONE, "PHONE_NUMBER", (v) => {
      const n = digitCount(v);
      return n >= 9 && n <= 15;
    }),
    ...collect(text, CREDIT_CARD, "CREDIT_CARD"),
    ...collectGroup(text, TITLED_NAME, "PERSON"),
    ...collectGroup(text, CONTACT_NAME, "PERSON"),
    ...knownNameCandidates(text, opts.knownNames ?? [], keep),
  ].filter((c) => c.type !== "PERSON" || !isKept(c.value));

  // Overlaps: longest wins, earlier start breaks ties.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: RedactEntity[] = [];
  for (const c of candidates) {
    if (chosen.some((k) => c.start < k.end && k.start < c.end)) continue;
    chosen.push({ type: c.type, start: c.start, end: c.end });
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Replace entities with <TYPE> placeholders. Entity offsets refer to the input text. */
export function anonymize(text: string, entities: readonly RedactEntity[]): string {
  let out = "";
  let pos = 0;
  for (const e of [...entities].sort((a, b) => a.start - b.start)) {
    if (e.start < pos) continue;
    out += text.slice(pos, e.start) + `<${e.type}>`;
    pos = e.end;
  }
  return out + text.slice(pos);
}

export function redactText(text: string, opts: RedactOptions = {}): RedactResult {
  const entities = analyze(text, opts);
  return { text: anonymize(text, entities), entities };
}

type PresidioResult = { entity_type: string; start: number; end: number; score?: number };

/** Uses a Presidio server when PRESIDIO_URL is set; falls back to the local recognizers on any error. */
export async function redactTextAsync(text: string, opts: RedactOptions = {}): Promise<RedactResult> {
  const base = process.env.PRESIDIO_URL;
  if (!base) return redactText(text, opts);
  try {
    const url = base.replace(/\/+$/, "");
    const post = async (path: string, body: unknown): Promise<unknown> => {
      const res = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`presidio ${path} ${res.status}`);
      return res.json();
    };
    const keep = new Set((opts.keepNames ?? []).map((n) => n.trim().toLowerCase()));
    const found = ((await post("/analyze", { text, language: "en" })) as PresidioResult[]).filter(
      (r) => !(r.entity_type === "PERSON" && keep.has(text.slice(r.start, r.end).trim().toLowerCase())),
    );
    // Local hits are merged in so seed contact names never slip through.
    const local: PresidioResult[] = analyze(text, opts)
      .filter((e) => !found.some((r) => e.start < r.end && r.start < e.end))
      .map((e) => ({ entity_type: e.type, start: e.start, end: e.end, score: 1 }));
    const results = [...found, ...local];
    const anon = (await post("/anonymize", { text, analyzer_results: results })) as { text?: unknown };
    if (typeof anon.text !== "string") throw new Error("presidio anonymize: no text");
    const entities = results
      .map((r) => ({ type: r.entity_type, start: r.start, end: r.end }))
      .sort((a, b) => a.start - b.start);
    return { text: anon.text, entities };
  } catch {
    return redactText(text, opts);
  }
}
