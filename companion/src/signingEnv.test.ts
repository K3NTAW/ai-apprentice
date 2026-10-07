import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { missingSigningEnv, signingEnvReport } from "./signingEnv.mjs";

const NOTARY = { APPLE_API_KEY: "k-secret", APPLE_API_KEY_ID: "id-secret", APPLE_API_ISSUER: "iss-secret" };
const P12 = { CSC_LINK: "link-secret", CSC_KEY_PASSWORD: "pw-secret" };

describe("missingSigningEnv", () => {
  it.each([
    ["nothing set", {}, ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER", "CSC_LINK", "CSC_KEY_PASSWORD"]],
    ["notary only", NOTARY, ["CSC_LINK", "CSC_KEY_PASSWORD"]],
    ["certificate only", P12, ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]],
    ["no key password", { ...NOTARY, CSC_LINK: "x" }, ["CSC_KEY_PASSWORD"]],
    ["no issuer", { ...P12, APPLE_API_KEY: "a", APPLE_API_KEY_ID: "b" }, ["APPLE_API_ISSUER"]],
    ["empty string is missing", { ...NOTARY, ...P12, APPLE_API_KEY_ID: "", CSC_KEY_PASSWORD: "" }, ["APPLE_API_KEY_ID", "CSC_KEY_PASSWORD"]],
    ["empty CSC_NAME does not count", { ...NOTARY, CSC_NAME: "" }, ["CSC_LINK", "CSC_KEY_PASSWORD"]],
    ["CSC_NAME satisfies the certificate half", { ...NOTARY, CSC_NAME: "Developer ID Application: X" }, []],
    ["p12 and notary complete", { ...NOTARY, ...P12 }, []],
  ] as const)("%s", (_label, env, expected) => {
    expect(missingSigningEnv(env)).toEqual(expected);
  });

  it("reports one readable line per missing name and never a value", () => {
    const env = { ...NOTARY, CSC_LINK: "link-secret" };
    const lines = signingEnvReport(env);
    expect(lines).toEqual(["missing signing env: CSC_KEY_PASSWORD"]);
    for (const v of Object.values(env)) expect(lines.join("\n")).not.toContain(v);
  });
});

describe("signingEnv as main", () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "signingEnv.mts");
  const run = (env: Record<string, string>) => {
    const clean = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("APPLE_API_") && !k.startsWith("CSC_")),
    );
    return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", file], {
      env: { ...clean, ...env },
      encoding: "utf8",
    });
  };

  it("exits 1 with one line per missing name and no values", () => {
    const r = run({ ...NOTARY, APPLE_API_ISSUER: "" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toEqual([
      "missing signing env: APPLE_API_ISSUER",
      "missing signing env: CSC_LINK",
      "missing signing env: CSC_KEY_PASSWORD",
    ]);
    for (const v of Object.values(NOTARY)) expect(r.stderr).not.toContain(v);
  });

  it("exits 0 silently when complete", () => {
    const r = run({ ...NOTARY, CSC_NAME: "Developer ID Application: X" });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
  });
});
