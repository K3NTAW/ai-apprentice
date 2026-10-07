import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

/** Text from a `## Heading` up to the next `## ` heading. */
function section(heading: string): string {
  const start = readme.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}

describe("companion README privacy section", () => {
  const privacy = section("Privacy");

  it("describes update checks and scrubbed Sentry crash reports for signed releases", () => {
    expect(privacy).toMatch(/update checks/i);
    expect(privacy).toMatch(/every 6 hours/);
    expect(privacy).toMatch(/crash reports/i);
    expect(privacy).toContain("Sentry");
    expect(privacy).toMatch(/scrubbed/i);
    expect(privacy).toContain("updates: true");
    expect(privacy).toContain("sentryDsn");
  });

  it("says there is no opt-out yet", () => {
    expect(privacy).toMatch(/no opt-out yet/i);
  });

  it("no longer claims no telemetry and no network calls", () => {
    expect(readme).not.toMatch(/no\s+telemetry,\s+no\s+network\s+calls/i);
  });

  it("keeps the unsigned-build steps and links the release doc", () => {
    expect(readme).toContain("### Unsigned local builds");
    expect(readme).toContain("xattr -dr com.apple.quarantine");
    expect(readme).toContain("tccutil reset ScreenCapture");
    expect(readme).toContain("### Signed releases");
    expect(readme).toContain("(../docs/RELEASE.md)");
    expect(readme).toMatch(/Windows stays unsigned[^.]*no auto-update/);
  });
});
