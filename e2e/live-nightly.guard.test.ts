// Guard for the nightly live run (.github/workflows/nightly-live.yml, T-0292) and the summary reporter's summary.json.
// No YAML parser in the deps, so the workflow checks are string checks on the file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { describe, expect, it } from "vitest";
import SummaryReporter, { type SummaryJson } from "./live/summary-reporter";

const root = fileURLToPath(new URL("..", import.meta.url));
const yml = fs.readFileSync(path.join(root, ".github/workflows/nightly-live.yml"), "utf8");
const lines = yml.split("\n");
const NAMES = ["BASE_URL", "E2E_EMAIL", "E2E_PASSWORD"];

describe("nightly-live workflow", () => {
  it("runs on a 03:00 UTC schedule and on demand", () => {
    expect(yml).toMatch(/^\s*schedule:\s*\n\s*- cron: "0 3 \* \* \*"/m);
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
  });

  it("never overlaps two runs", () => {
    expect(yml).toMatch(/^concurrency:\s*\n\s+group: nightly-live/m);
  });

  it("reads the credentials from secrets.* only", () => {
    for (const n of NAMES) expect(yml).toContain(`${n}: \${{ secrets.${n} }}`);
    const refs = [...yml.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
    for (const r of refs) expect(r, r).toMatch(/^secrets\.\w+$/);
    expect(yml).not.toMatch(/E2E_(EMAIL|PASSWORD)\s*[:=]\s*["']?[^$\s"']/);
  });

  it("never echoes or prints a secret", () => {
    const printing = lines.filter((l) => /\b(echo|printf|console\.log|core\.info)\b/.test(l));
    for (const l of printing) {
      expect(l, l).not.toMatch(/secrets\.|\$\{?(BASE_URL|E2E_EMAIL|E2E_PASSWORD)\b|\$\{!/);
    }
    expect(yml).not.toMatch(/set -x/);
  });

  it("fails fast when a secret is missing, naming it only", () => {
    expect(yml).toContain("for name in BASE_URL E2E_EMAIL E2E_PASSWORD");
    expect(yml).toMatch(/::error::Repository secret \$name is not set/);
    expect(yml.indexOf("Check secrets")).toBeLessThan(yml.indexOf("npm run e2e:live"));
  });

  it("installs Chrome and runs e2e:live", () => {
    expect(yml).toContain("npm ci");
    expect(yml).toContain("npx playwright install chrome");
    expect(yml).toContain("npm run e2e:live");
  });

  it("uploads e2e/live/out for 14 days and posts the summary to the run", () => {
    expect(yml).toContain("actions/upload-artifact@");
    expect(yml).toMatch(/path: e2e\/live\/out\/?\n/);
    expect(yml).toMatch(/retention-days: 14/);
    expect(yml).toMatch(/summary\.md >> "\$GITHUB_STEP_SUMMARY"/);
  });

  it("opens or updates the failure issue on failure and closes it on success", () => {
    expect(yml).toContain("actions/github-script@");
    expect(yml).toContain("secrets.GITHUB_TOKEN");
    expect(yml).toMatch(/if: failure\(\)[\s\S]*issues\.create\(/);
    expect(yml).toMatch(/if: failure\(\)[\s\S]*issues\.update\(/);
    expect(yml).toMatch(/if: success\(\)[\s\S]*state: "closed"/);
    expect(yml).toContain('"Nightly live e2e failed"');
    expect(yml).toContain("nightly-live");
  });
});

const test = (title: string): TestCase => ({ title, annotations: [] }) as unknown as TestCase;
const result = (status: TestResult["status"], duration: number, message?: string): TestResult =>
  ({ status, duration, attachments: [], error: message ? { message } : undefined }) as unknown as TestResult;

function run(dir: string) {
  const r = new SummaryReporter({ outputFile: path.join(dir, "summary.md") });
  r.onTestEnd(test("sign in"), result("passed", 1200));
  r.onTestEnd(test("agents home"), result("failed", 3400, "boom\nsecond line"));
  r.onEnd({ status: "failed" } as FullResult);
  return {
    md: fs.readFileSync(path.join(dir, "summary.md"), "utf8"),
    json: JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")) as SummaryJson,
  };
}

describe("summary reporter", () => {
  it("writes summary.json next to summary.md with counts and steps", () => {
    const { json } = run(fs.mkdtempSync(path.join(os.tmpdir(), "live-summary-")));
    expect(json).toEqual({
      passed: 1,
      total: 2,
      status: "failed",
      steps: [
        { title: "sign in", status: "passed", ms: 1200 },
        { title: "agents home", status: "failed", ms: 3400 },
      ],
    });
  });

  it("keeps summary.md as before", () => {
    const { md } = run(fs.mkdtempSync(path.join(os.tmpdir(), "live-summary-")));
    const body = md.replace(/^Run: \S+ /m, "Run: <time> ");
    expect(body).toBe(
      [
        "# e2e:live summary",
        "",
        `Run: <time> against ${process.env.BASE_URL ?? "(no BASE_URL)"}. Overall: failed, 1/2 steps passed.`,
        "",
        "| Step | Result | Duration | Console errors | Failed requests | 401 probes |",
        "| --- | --- | --- | --- | --- | --- |",
        "| sign in | pass | 1.2 s | - | - | - |",
        "| agents home | FAIL (failed) | 3.4 s | - | - | - |",
        "",
        "## Details",
        "",
        "### agents home",
        "",
        "- error: boom",
        "",
        "## Page load times (navigation timing)",
        "",
        "Not measured (the load-times step did not run).",
        "",
      ].join("\n"),
    );
  });

  it("puts no error text or observations in summary.json", () => {
    const { json } = run(fs.mkdtempSync(path.join(os.tmpdir(), "live-summary-")));
    expect(JSON.stringify(json)).not.toContain("boom");
    for (const s of json.steps) expect(Object.keys(s).sort()).toEqual(["ms", "status", "title"]);
  });
});
