// Guard for the desktop release workflow (.github/workflows/desktop-release.yml, T-0363).
// No YAML parser in the deps, so these are string checks on the file, like live-nightly.guard.test.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const yml = fs.readFileSync(path.join(root, ".github/workflows/desktop-release.yml"), "utf8");
const lines = yml.split("\n");
const indent = (l: string) => l.length - l.trimStart().length;
/** Steps under `steps:`, split on the 6-space `- ` step markers. */
const steps = yml.split(/\n(?= {6}- )/).slice(1);
const stepWith = (s: string) => steps.filter((st) => st.includes(s));

describe("desktop-release workflow", () => {
  it("runs on demand with a required version input", () => {
    expect(yml).toMatch(/^on:\s*\n\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+version:/m);
    expect(yml).toMatch(/version:[\s\S]*?required: true/);
    const on = yml.slice(yml.indexOf("\non:"), yml.indexOf("\npermissions:"));
    expect(on).not.toMatch(/^\s+(push|pull_request|pull_request_target|schedule|release|workflow_run):/m);
  });

  it("has permissions contents: read and nothing else", () => {
    expect(yml).toMatch(/^permissions:\s*\n {2}contents: read\s*\n(?! {2}\S)/m);
    const keys = lines.filter((l) => /^\s*permissions:/.test(l));
    expect(keys).toEqual(["permissions:"]);
    expect(yml).not.toMatch(/:\s*write\b/);
  });

  it("never overlaps two runs", () => {
    expect(yml).toMatch(/^concurrency:\s*\n\s+group: desktop-release/m);
  });

  it("pins every action to a full commit SHA", () => {
    const uses = lines.filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l, l).toMatch(/@[0-9a-f]{40}\b\s+# v\d+\.\d+\.\d+/);
  });

  it("fails unless run from the default branch, before anything else", () => {
    const guard = stepWith("format('refs/heads/{0}', github.event.repository.default_branch)");
    expect(guard).toHaveLength(1);
    expect(guard[0]).toMatch(/if: github\.ref != format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
    expect(guard[0]).toMatch(/exit 1/);
    expect(steps.indexOf(guard[0])).toBe(0);
  });

  it("validates the version as semver equal to companion/package.json, input via env only", () => {
    const [v] = stepWith("require('./companion/package.json').version");
    expect(v).toBeDefined();
    expect(v).toContain("VERSION: ${{ inputs.version }}");
    expect(v).toContain(String.raw`^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`);
    expect(v).toMatch(/"\$VERSION" != "\$pkg"/);
    expect(v).toMatch(/exit 1/);
    const runText = lines.filter((l) => !/^\s+[A-Z_]+: \$\{\{/.test(l)).join("\n");
    expect(runText).not.toContain("inputs.version");
    expect(yml).not.toMatch(/npm version|git commit|git push/);
  });

  it("puts every secret in an env block and nowhere else", () => {
    lines.forEach((l, i) => {
      if (!l.includes("${{ secrets.")) return;
      let j = i - 1;
      while (j >= 0 && (lines[j].trim() === "" || indent(lines[j]) >= indent(l))) j--;
      expect(lines[j]?.trim(), `line ${i + 1}: ${l}`).toBe("env:");
    });
    const names = [...yml.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
    expect(names).toEqual(
      ["APPLE_API_ISSUER", "APPLE_API_KEY_ID", "APPLE_API_KEY_P8", "CSC_KEY_PASSWORD", "CSC_LINK", "DESKTOP_RELEASE_TOKEN", "SENTRY_DSN_ELECTRON"].sort(),
    );
    expect(yml).not.toMatch(/set -x/);
  });

  it("writes AuthKey.p8 with printf and exports only its path through GITHUB_ENV", () => {
    expect(yml).toContain(`printf '%s\\n' "$APPLE_API_KEY_P8" > "$RUNNER_TEMP/AuthKey.p8"`);
    const echoes = lines.filter((l) => /\becho\b/.test(l));
    const keyEchoes = echoes.filter((l) => l.includes("APPLE_API_KEY"));
    expect(keyEchoes.map((l) => l.trim())).toEqual([`echo "APPLE_API_KEY=$RUNNER_TEMP/AuthKey.p8" >> "$GITHUB_ENV"`]);
    for (const l of echoes) expect(l, l).not.toMatch(/secrets\.|CSC_|APPLE_API_KEY_P8|DESKTOP_RELEASE_TOKEN|SENTRY_DSN/);
    expect(lines.filter((l) => /\becho\b.*AuthKey\.p8/.test(l) && !l.includes("$GITHUB_ENV"))).toEqual([]);
  });

  it("installs, then writes the release config before package:signed", () => {
    expect(yml).toContain("npm --prefix companion ci");
    const cfg = yml.indexOf("node companion/dist/writeReleaseConfig.mjs");
    const pack = yml.indexOf("npm --prefix companion run package:signed");
    expect(cfg).toBeGreaterThan(yml.indexOf("npm --prefix companion run build"));
    expect(cfg).toBeGreaterThan(0);
    expect(pack).toBeGreaterThan(cfg);
    const [p] = stepWith("run package:signed");
    for (const n of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) expect(p).toContain(`${n}: \${{ secrets.${n} }}`);
  });

  it("uses DESKTOP_RELEASE_TOKEN only in the draft gh release create step", () => {
    expect(yml.match(/DESKTOP_RELEASE_TOKEN/g)).toHaveLength(1);
    const withToken = stepWith("DESKTOP_RELEASE_TOKEN");
    expect(withToken).toHaveLength(1);
    expect(withToken[0]).toContain("gh release create");
    const cmd = withToken[0].split("\n").find((l) => l.includes("gh release create"))!;
    for (const s of ["--draft", '--target "$GITHUB_SHA"', "*.dmg", "*.zip", "*.blockmap", "latest-mac.yml"]) expect(cmd, s).toContain(s);
    expect(stepWith("GH_TOKEN")).toHaveLength(1);
  });

  it("always removes the key file at the end", () => {
    const last = steps[steps.length - 1];
    expect(last).toMatch(/if: always\(\)/);
    expect(last).toContain(`rm -f "$RUNNER_TEMP/AuthKey.p8"`);
  });
});
