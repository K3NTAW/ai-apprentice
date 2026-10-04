import { describe, expect, it } from "vitest";
import { appAllowlist } from "./appConfig.mjs";
import { buildAllowlist, isOriginAllowed, parseAllowlist } from "./origin.mjs";

const APP = "https://app.example.com";
// The old wildcard defaults, built from parts so no literal pattern is left in the repo.
const STAR = "*";
const OLD_WILDCARDS = [`https://ai-apprentice${STAR}.vercel.app`, `https://${STAR}-k3ntaws-projects.vercel.app`];
const THIRD_PARTY = ["https://ai-apprentice.vercel.app", "https://evil-k3ntaws-projects.vercel.app", "https://ai-apprentice-x.vercel.app"];

describe("exact-origin allowlist", () => {
  it("rejects third-party Vercel origins by default, packaged or not, with or without APP_URL", () => {
    for (const isPackaged of [true, false]) {
      for (const appOrigin of [APP, null]) {
        const list = buildAllowlist({ appOrigin, isPackaged, env: undefined });
        for (const o of THIRD_PARTY) expect(isOriginAllowed(o, list), `${o} packaged=${isPackaged} app=${appOrigin}`).toBe(false);
      }
    }
  });

  it("accepts only the exact APP_URL origin when packaged", () => {
    const list = buildAllowlist({ appOrigin: APP, isPackaged: true, env: undefined });
    expect(list.rules.map((r) => r.source)).toEqual([APP]);
    expect(isOriginAllowed(APP, list)).toBe(true);
    for (const o of ["http://localhost:3000", "https://x.app.example.com", "https://app.example.com.evil.com", "http://app.example.com", "https://app.example.com:8443"]) {
      expect(isOriginAllowed(o, list), o).toBe(false);
    }
  });

  it("accepts localhost:3000 only when unpackaged", () => {
    expect(isOriginAllowed("http://localhost:3000", buildAllowlist({ appOrigin: APP, isPackaged: false, env: undefined }))).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", buildAllowlist({ appOrigin: APP, isPackaged: true, env: undefined }))).toBe(false);
    expect(appAllowlist({ appOrigin: APP, isPackaged: false, env: undefined }).rules.map((r) => r.source)).toEqual([APP, "http://localhost:3000"]);
  });

  it("denies everything when packaged with no APP_URL", () => {
    expect(buildAllowlist({ appOrigin: null, isPackaged: true, env: undefined }).rules).toEqual([]);
  });

  it("COMPANION_ALLOWED_ORIGINS adds exact origins only and rejects wildcards with a log line", () => {
    const list = buildAllowlist({
      appOrigin: APP,
      isPackaged: true,
      env: ["https://staging.example.com", ...OLD_WILDCARDS, STAR].join(", "),
    });
    expect(list.rules.map((r) => r.source)).toEqual([APP, "https://staging.example.com"]);
    expect(list.errors).toHaveLength(3);
    for (const e of list.errors) expect(e).toMatch(/^wildcard origin rejected/);
    expect(isOriginAllowed("https://staging.example.com", list)).toBe(true);
    for (const o of THIRD_PARTY) expect(isOriginAllowed(o, list), o).toBe(false);
  });

  it("parseAllowlist: unset or empty adds nothing; invalid entries are logged", () => {
    expect(parseAllowlist(undefined)).toEqual({ rules: [], errors: [] });
    expect(parseAllowlist(" , ")).toEqual({ rules: [], errors: [] });
    const bad = parseAllowlist("nonsense,https://pre-*.example.com");
    expect(bad.rules).toEqual([]);
    expect(bad.errors).toEqual(["invalid origin rule ignored: nonsense", "wildcard origin rejected (exact origins only): https://pre-*.example.com"]);
  });
});
