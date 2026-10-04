#!/usr/bin/env node
// Median TTFB of the main pages. Node 18+ (global fetch), no dependencies.
//
//   BASE_URL=https://<preview-host> SESSION_COOKIE='sb-<ref>-auth-token=...; ws=...' node scripts/measure-ttfb.mjs
//
// BASE_URL defaults to http://localhost:3000 (local mode needs no cookie). RUNS (default 5) requests per page,
// PAGES (comma separated) overrides the page list. The cookie is read from the environment only; never commit it.
// Prints one row per page: median and min/max TTFB in ms, the status, and the Server-Timing header of the last run
// (proxy-auth on pages; auth and db on /api routes).

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const COOKIE = process.env.SESSION_COOKIE ?? "";
const RUNS = Number(process.env.RUNS ?? 5);
const PAGES = (process.env.PAGES ?? "/agents,/dashboard,/map,/learn,/capture,/workspace,/api/session").split(",").filter(Boolean);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function ttfb(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: COOKIE ? { cookie: COOKIE } : {}, redirect: "manual" });
  const ms = performance.now() - t0; // fetch resolves once the status line and headers arrive
  await res.arrayBuffer();
  return { ms, status: res.status, timing: res.headers.get("server-timing") ?? "" };
}

const rows = [];
for (const page of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await ttfb(`${BASE_URL}${page}`));
  const ms = runs.map((r) => r.ms);
  const last = runs.at(-1);
  rows.push({
    page,
    median: median(ms).toFixed(0),
    min: Math.min(...ms).toFixed(0),
    max: Math.max(...ms).toFixed(0),
    status: last.status,
    timing: last.timing,
  });
}

console.log(`${BASE_URL}, ${RUNS} runs per page${COOKIE ? ", with session cookie" : ""}`);
console.log("| page | median ms | min | max | status | server-timing |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r.page} | ${r.median} | ${r.min} | ${r.max} | ${r.status} | ${r.timing} |`);
