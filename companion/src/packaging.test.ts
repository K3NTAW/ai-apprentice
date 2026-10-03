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

  it("mac builds dmg and dir for arm64 and x64, with icon, entitlements and usage texts, as a Dock app", () => {
    const targets: Target[] = build.mac.target;
    for (const name of ["dmg", "dir"]) {
      const t = targets.find((x) => x.target === name);
      expect(t?.arch.sort()).toEqual(["arm64", "x64"]);
    }
    expect(fs.existsSync(path.join(root, build.mac.icon))).toBe(true);
    expect(fs.readFileSync(path.join(root, build.mac.entitlements), "utf8")).toContain("com.apple.security.device.audio-input");
    expect(build.mac.extendInfo.LSUIElement).toBeUndefined();
    expect(build.mac.extendInfo.NSMicrophoneUsageDescription).toBeTruthy();
    expect(build.mac.extendInfo.NSScreenCaptureUsageDescription).toBeTruthy();
  });

  it("windows builds nsis x64", () => {
    expect(build.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
  });

  it("app.config.json ships no default appUrl (APP_URL or the setup screen provides it)", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8"));
    expect(cfg.appUrl).toBeNull();
  });
});
