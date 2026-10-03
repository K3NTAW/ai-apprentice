import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveAppUrl } from "./appConfig.mjs";
import { planMainLoad, serializeStoredAppUrl, validateSetupUrl } from "./appUrl.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shipped = fs.readFileSync(path.join(here, "..", "app.config.json"), "utf8");

describe("main window target", () => {
  it("with no APP_URL and no stored setting loads the local setup screen and nothing remote", () => {
    const resolved = resolveAppUrl({ env: undefined, configText: shipped, storedText: null });
    expect(resolved).toEqual({ ok: false, reason: "app_url_unset" });
    expect(planMainLoad(resolved)).toEqual({ kind: "setup" });
    for (const env of [undefined, "", "  "]) {
      expect(planMainLoad(resolveAppUrl({ env, configText: null, storedText: null }))).toEqual({ kind: "setup" });
    }
  });

  it("APP_URL env wins, then app.config.json, then the stored setting", () => {
    const stored = serializeStoredAppUrl("https://stored.example.com/");
    const config = JSON.stringify({ appUrl: "https://config.example.com" });
    expect(planMainLoad(resolveAppUrl({ env: "https://env.example.com/app", configText: config, storedText: stored }))).toEqual({
      kind: "remote",
      url: "https://env.example.com/app",
    });
    expect(resolveAppUrl({ env: undefined, configText: config, storedText: stored })).toMatchObject({ ok: true, origin: "https://config.example.com" });
    expect(resolveAppUrl({ env: undefined, configText: shipped, storedText: stored })).toMatchObject({ ok: true, origin: "https://stored.example.com" });
  });

  it("an invalid value shows the local error page, never a remote fallback", () => {
    expect(planMainLoad(resolveAppUrl({ env: "http://example.com", configText: null, storedText: null }))).toEqual({ kind: "error", reason: "app_url_scheme" });
    expect(planMainLoad(resolveAppUrl({ env: undefined, configText: null, storedText: serializeStoredAppUrl("ftp://x.example.com") })).kind).toBe("error");
  });
});

describe("setup screen URL", () => {
  it("accepts https and normalises it", () => {
    expect(validateSetupUrl(" https://App.Example.com/control ")).toEqual({ ok: true, url: "https://app.example.com/control", origin: "https://app.example.com" });
  });

  it("rejects non-https URLs, userinfo and junk", () => {
    for (const bad of ["http://app.example.com", "http://localhost:3000", "ftp://app.example.com", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(validateSetupUrl(bad), bad).toEqual({ ok: false, reason: "app_url_scheme" });
    }
    expect(validateSetupUrl("https://u:p@app.example.com").ok).toBe(false);
    for (const bad of ["", "not a url", undefined, 42, "https://app.example.com/" + "a".repeat(3000)]) expect(validateSetupUrl(bad).ok, String(bad)).toBe(false);
  });

  it("main.mts loads the setup screen from a local file and stores the URL in userData", () => {
    const src = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    expect(src).toMatch(/plan\.kind === "remote"\) void win\.loadURL\(plan\.url\)/);
    expect(src).toMatch(/plan\.kind === "setup"\) void win\.loadFile\(SETUP_HTML\)/);
    expect(src).toMatch(/app\.getPath\("userData"\), STORED_APP_URL_FILE/);
    expect(src).toMatch(/validateSetupUrl\(raw\)/);
    expect(fs.existsSync(path.join(here, "..", "static", "setup.html"))).toBe(true);
  });
});
