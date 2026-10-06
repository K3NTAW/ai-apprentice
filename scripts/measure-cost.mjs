#!/usr/bin/env node
// Measured unit cost per capture hour and teach hour (P0-10, docs/checks/unit-cost.md). Node 18+, no dependencies.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/measure-cost.mjs --workspace <uuid> --since 2026-10-08T00:00:00Z [--until <iso>] [--json]
//
// Reads usage_events, sessions, model_prices and voice_prices through PostgREST with the service role (read only).
// The key is read from the environment and sent only as a request header: it is never printed, logged or written.
// Storage is priced at STORAGE_CHF_PER_GB_MONTH (default 0.0189: 0.021 USD x 0.90) for RETENTION_MONTHS (default 3).
// The aggregation is summarise() in scripts/lib/cost.mjs.

import { CATEGORIES, summarise } from "./lib/cost.mjs";

function usage(message) {
  if (message) console.error(`measure-cost: ${message}`);
  console.error("usage: node scripts/measure-cost.mjs --workspace <uuid> --since <iso> [--until <iso>] [--json]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--workspace" || a === "--since" || a === "--until") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) usage(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else usage(`unknown argument ${a}`);
  }
  if (!out.workspace || !/^[0-9a-f-]{36}$/i.test(out.workspace)) usage("--workspace must be a uuid");
  for (const k of ["since", "until"]) {
    if (out[k] === undefined) continue;
    if (!Number.isFinite(Date.parse(out[k]))) usage(`--${k} must be an ISO date or timestamp`);
    out[k] = new Date(Date.parse(out[k])).toISOString();
  }
  if (!out.since) usage("--since is required");
  return out;
}

const args = parseArgs(process.argv.slice(2));
const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!BASE || !KEY) usage("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment");

const PAGE = 1000;

/** All rows of a PostgREST query, paged with Range. Errors name the table and status only, never the key. */
async function select(table, query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}`, range: `${from}-${from + PAGE - 1}`, "range-unit": "items" },
    });
    if (!res.ok) {
      const body = (await res.text()).replaceAll(KEY, "<redacted>").slice(0, 300);
      throw new Error(`${table}: HTTP ${res.status} ${body}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const ws = encodeURIComponent(args.workspace);
const since = encodeURIComponent(args.since);
const until = args.until ? encodeURIComponent(args.until) : null;

let result;
try {
  const [events, sessions, models, voice] = await Promise.all([
    select(
      "usage_events",
      `select=session_id,user_id,kind,model,input_tokens,output_tokens,cache_read_tokens,voice_seconds,bytes,created_at` +
        `&workspace_id=eq.${ws}&created_at=gte.${since}${until ? `&created_at=lt.${until}` : ""}&order=created_at.asc,id.asc`,
    ),
    select(
      "sessions",
      `select=id,kind,created_by,started_at,ended_at&workspace_id=eq.${ws}` +
        `&or=(ended_at.gte.${since},ended_at.is.null)${until ? `&started_at=lt.${until}` : ""}&order=started_at.asc,id.asc`,
    ),
    select("model_prices", "select=model,valid_from,chf_per_m_input,chf_per_m_output,chf_per_m_cache_read&order=model.asc,valid_from.asc"),
    select("voice_prices", "select=valid_from,chf_per_minute&order=valid_from.asc"),
  ]);
  result = summarise(events, sessions, {
    models,
    voice,
    storageChfPerGbMonth: Number(process.env.STORAGE_CHF_PER_GB_MONTH ?? 0.0189),
    retentionMonths: Number(process.env.RETENTION_MONTHS ?? 3),
  });
} catch (err) {
  console.error(`measure-cost: ${String(err?.message ?? err).replaceAll(KEY, "<redacted>")}`);
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify({ workspace: args.workspace, since: args.since, until: args.until ?? null, ...result }, null, 2));
  process.exit(0);
}

const f = (n, d = 2) => (n === null || n === undefined ? "-" : Number(n).toFixed(d));
const pct = (n) => (n === null ? "-" : `${(n * 100).toFixed(0)}%`);

console.log(`workspace ${args.workspace}, ${args.since} to ${args.until ?? "now"}, CHF`);
console.log("");
console.log("| session | kind | minutes | vision calls | decide | workmap | tokens in | tokens out | cache read | voice s | frames | frame MB | CHF | CHF/h |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const s of result.sessions) {
  console.log(
    `| ${s.session_id} | ${s.kind} | ${f(s.minutes, 1)} | ${s.vision_calls} | ${s.decide_calls} | ${s.workmap_calls} | ${s.input_tokens} | ` +
      `${s.output_tokens} | ${s.cache_read_tokens} | ${f(s.voice_seconds, 0)} | ${s.frames} | ${f(s.frame_bytes / 1e6, 1)} | ` +
      `${f(s.chf_total, 3)}${s.partial ? " (partial)" : ""} | ${f(s.chf_per_hour)} |`,
  );
}
console.log("");
console.log(`| kind | sessions | minutes | CHF/h min | CHF/h median | CHF/h max | ${CATEGORIES.join(" | ")} |`);
console.log(`| --- | --- | --- | --- | --- | --- | ${CATEGORIES.map(() => "---").join(" | ")} |`);
for (const [kind, k] of Object.entries(result.kinds)) {
  console.log(
    `| ${kind}${k.partial ? " (partial)" : ""} | ${k.sessions} | ${f(k.minutes, 1)} | ${f(k.chf_per_hour.min)} | ${f(k.chf_per_hour.median)} | ` +
      `${f(k.chf_per_hour.max)} | ${CATEGORIES.map((c) => pct(k.share[c])).join(" | ")} |`,
  );
}
if (result.unpriced.length) {
  console.log("");
  console.log("Unpriced (costed 0, add a price row in a new migration):");
  for (const u of result.unpriced) console.log(`- ${u.kind} ${u.model ?? "(voice)"}: ${u.events} events`);
}
if (result.unattributed.events) {
  console.log("");
  console.log(`Unattributed: ${result.unattributed.events} events, CHF ${f(result.unattributed.chf, 3)} (no matching session)`);
}
