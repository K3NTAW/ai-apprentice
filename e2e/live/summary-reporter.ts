// Writes e2e/live/out/summary.md: each step with pass/fail, duration, console errors, failed requests, app gaps found,
// and the page load times from the load-times step. Everything in here already went through scrub() in fixtures.ts.
// Also writes summary.json next to it ({passed, total, status, steps: [{title, status, ms}]}) for the nightly workflow;
// it carries step titles, statuses and durations only, no error text or observations.
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";
import type { Observations } from "./fixtures";

export type SummaryJson = {
  passed: number;
  total: number;
  status: FullResult["status"];
  steps: { title: string; status: string; ms: number }[];
};

export type LoadTime = { path: string; ttfbMs: number; domContentLoadedMs: number; loadMs: number };

type Row = { title: string; status: string; ms: number; obs: Observations | null; gaps: string[]; error: string };

const read = <T,>(result: TestResult, name: string): T | null => {
  const a = result.attachments.find((x) => x.name === name && x.body);
  return a?.body ? (JSON.parse(a.body.toString("utf8")) as T) : null;
};

const firstLine = (s = "") =>
  s
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .find((l) => l.trim()) ?? "";

export default class SummaryReporter implements Reporter {
  private rows: Row[] = [];
  private loads: LoadTime[] = [];
  private started = new Date();

  constructor(private options: { outputFile?: string } = {}) {}

  onTestEnd(test: TestCase, result: TestResult) {
    this.rows.push({
      title: test.title,
      status: result.status,
      ms: result.duration,
      obs: read<Observations>(result, "observations"),
      gaps: test.annotations.filter((a) => a.type === "app-gap").map((a) => a.description ?? ""),
      error: firstLine(result.error?.message).slice(0, 200),
    });
    this.loads.push(...(read<LoadTime[]>(result, "load-times") ?? []));
  }

  onEnd(result: FullResult) {
    const file = this.options.outputFile ?? path.join("e2e", "live", "out", "summary.md");
    const passed = this.rows.filter((r) => r.status === "passed").length;
    const lines = [
      "# e2e:live summary",
      "",
      `Run: ${this.started.toISOString()} against ${process.env.BASE_URL ?? "(no BASE_URL)"}. Overall: ${result.status}, ${passed}/${this.rows.length} steps passed.`,
      "",
      "| Step | Result | Duration | Console errors | Failed requests | 401 probes |",
      "| --- | --- | --- | --- | --- | --- |",
      ...this.rows.map(
        (r) =>
          `| ${r.title} | ${r.status === "passed" ? "pass" : `FAIL (${r.status})`} | ${(r.ms / 1000).toFixed(1)} s | ${r.obs?.console.length ?? "-"} | ${r.obs?.network.length ?? "-"} | ${r.obs?.ignored401 ?? "-"} |`,
      ),
      "",
      "## Details",
      "",
    ];
    for (const r of this.rows) {
      const items = [
        ...(r.error ? [`- error: ${r.error}`] : []),
        ...r.gaps.map((g) => `- app gap: ${g}`),
        ...(r.obs?.console ?? []).map((c) => `- console: ${c.replace(/\n/g, " ")}`),
        ...(r.obs?.network ?? []).map((n) => `- request: ${n}`),
      ];
      if (items.length) lines.push(`### ${r.title}`, "", ...items, "");
    }
    lines.push("## Page load times (navigation timing)", "");
    if (this.loads.length) {
      lines.push("| Page | TTFB | DOMContentLoaded | Load |", "| --- | --- | --- | --- |");
      for (const l of this.loads) lines.push(`| ${l.path} | ${l.ttfbMs} ms | ${l.domContentLoadedMs} ms | ${l.loadMs} ms |`);
    } else lines.push("Not measured (the load-times step did not run).");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    const json: SummaryJson = {
      passed,
      total: this.rows.length,
      status: result.status,
      steps: this.rows.map((r) => ({ title: r.title, status: r.status, ms: r.ms })),
    };
    const jsonFile = path.join(path.dirname(file), "summary.json");
    fs.writeFileSync(jsonFile, `${JSON.stringify(json, null, 2)}\n`);
  }

  printsToStdio() {
    return false;
  }
}
