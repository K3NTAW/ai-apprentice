import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withReleaseConfig } from "./writeReleaseConfig.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED = '{"appUrl": null}\n';

describe("withReleaseConfig", () => {
  it.each([[undefined], [""], ["   "]])("dsn %j leaves sentryDsn absent", (sentryDsn) => {
    const out = withReleaseConfig(COMMITTED, { sentryDsn, updates: true });
    expect(JSON.parse(out)).toEqual({ appUrl: null, updates: true });
  });

  it("adds sentryDsn when set, keeps appUrl and other keys", () => {
    const out = withReleaseConfig('{"appUrl":"https://app.example","other":1}', { sentryDsn: "https://k@o1.ingest.sentry.io/1", updates: true });
    expect(JSON.parse(out)).toEqual({ appUrl: "https://app.example", other: 1, updates: true, sentryDsn: "https://k@o1.ingest.sentry.io/1" });
  });

  it("updates false adds no key", () => {
    expect(JSON.parse(withReleaseConfig(COMMITTED, { updates: false }))).toEqual({ appUrl: null });
  });

  it("pretty-prints with 2 spaces and a trailing newline", () => {
    const out = withReleaseConfig(COMMITTED, { updates: true });
    expect(out).toBe('{\n  "appUrl": null,\n  "updates": true\n}\n');
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe("writeReleaseConfig as main", () => {
  it("rewrites ../app.config.json next to the script and never prints the DSN", () => {
    // realpath: macOS tmpdir is a /var -> /private/var symlink and the main guard compares exact URLs.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "release-config-")));
    try {
      fs.mkdirSync(path.join(dir, "dist"));
      fs.writeFileSync(path.join(dir, "app.config.json"), COMMITTED);
      // The .mts source runs directly under node type stripping, laid out like dist/ next to app.config.json.
      const script = path.join(dir, "dist", "writeReleaseConfig.mts");
      fs.copyFileSync(path.join(here, "writeReleaseConfig.mts"), script);
      const dsn = "https://secretkey@o1.ingest.sentry.io/1";
      const stdout = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script], {
        env: { ...process.env, SENTRY_DSN_ELECTRON: dsn },
        encoding: "utf8",
      });
      expect(stdout).not.toContain("secretkey");
      expect(stdout).toContain("updates");
      expect(stdout).toContain("sentryDsn");
      expect(JSON.parse(fs.readFileSync(path.join(dir, "app.config.json"), "utf8"))).toEqual({ appUrl: null, updates: true, sentryDsn: dsn });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("committed companion/app.config.json carries no updates or sentryDsn", () => {
    const committed = JSON.parse(fs.readFileSync(path.join(here, "..", "app.config.json"), "utf8"));
    expect(committed).not.toHaveProperty("updates");
    expect(committed).not.toHaveProperty("sentryDsn");
  });
});
