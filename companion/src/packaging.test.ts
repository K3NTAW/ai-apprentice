import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const build = pkg.build;
type Target = { target: string; arch: string[] };

describe("electron-builder config", () => {
  it("is named AI Apprentice and ships the app config", () => {
    expect(build.productName).toBe("AI Apprentice");
    expect(build.files).toContain("app.config.json");
  });

  it("mac builds dmg, zip and dir for arm64 and x64, with icon, entitlements and usage texts, as a Dock app", () => {
    const targets: Target[] = build.mac.target;
    expect(targets.map((t) => t.target).sort()).toEqual(["dir", "dmg", "zip"]);
    for (const name of ["dmg", "zip", "dir"]) {
      const t = targets.find((x) => x.target === name);
      expect(t?.arch.sort()).toEqual(["arm64", "x64"]);
    }
    expect(fs.existsSync(path.join(root, build.mac.icon))).toBe(true);
    expect(fs.readFileSync(path.join(root, build.mac.entitlements), "utf8")).toContain("com.apple.security.device.audio-input");
    expect(build.mac.extendInfo.LSUIElement).toBeUndefined();
    expect(build.mac.extendInfo.NSMicrophoneUsageDescription).toBeTruthy();
    expect(build.mac.extendInfo.NSScreenCaptureUsageDescription).toBeTruthy();
  });

  it("mac has no identity key, notarises and publishes to the desktop GitHub repo", () => {
    expect("identity" in build.mac).toBe(false);
    expect(build.mac.notarize).toBe(true);
    expect(build.mac.publish).toEqual([{ provider: "github", owner: "K3NTAW", repo: "ai-apprentice-desktop" }]);
    expect(build.publish).toBeUndefined();
  });

  it("windows never publishes", () => {
    expect(build.win.publish).toBeNull();
  });

  it("local package scripts build unsigned and never publish; package:signed checks env first", () => {
    for (const name of ["package", "package:dir"]) {
      expect(pkg.scripts[name]).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
      expect(pkg.scripts[name]).toContain("--publish never");
    }
    const signed: string = pkg.scripts["package:signed"];
    expect(signed).toContain("--publish never");
    expect(signed).not.toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    const check = signed.indexOf("node dist/signingEnv.mjs");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(signed.indexOf("electron-builder"));
  });

  it("ships electron-updater and @sentry/electron as runtime dependencies, locked", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    for (const name of ["electron-updater", "@sentry/electron"]) {
      expect(pkg.dependencies[name]).toBeTruthy();
      expect(pkg.devDependencies[name]).toBeUndefined();
      expect(lock.packages[""].dependencies[name]).toBe(pkg.dependencies[name]);
      expect(lock.packages[`node_modules/${name}`]?.version).toBeTruthy();
    }
  });

  it("windows builds nsis x64", () => {
    expect(build.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    // The app icon lives in assets/; static/ ships no tray icon any more.
    expect(build.win.icon).toBe("assets/icon.ico");
    expect(fs.existsSync(path.join(root, build.win.icon))).toBe(true);
  });

  it("app.config.json ships no default appUrl (APP_URL or the setup screen provides it)", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8"));
    expect(cfg).toEqual({ appUrl: null });
    expect("updates" in cfg).toBe(false);
    expect("sentryDsn" in cfg).toBe(false);
  });
});
