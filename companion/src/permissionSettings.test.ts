import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appAllowlist } from "./appConfig.mjs";
import { navigationAllowed } from "./loadError.mjs";
import { MAC_SETTINGS_URLS, openPermissionSettings, PERMISSION_KINDS, type PermissionSettingsApis } from "./permissionSettings.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function apis(platform: NodeJS.Platform, micGranted = false) {
  const calls: string[] = [];
  const a: PermissionSettingsApis = {
    platform,
    openExternal: (url) => void calls.push(`open:${url}`),
    askForMicrophone: async () => {
      calls.push("ask:microphone");
      return micGranted;
    },
    touchScreenCapture: async () => void calls.push("getSources"),
    refresh: () => void calls.push("refresh"),
  };
  return { a, calls };
}

describe("openPermissionSettings", () => {
  it("macOS: opens exactly the allowlisted pane per kind", async () => {
    const expected = {
      microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      "input-monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    };
    expect(MAC_SETTINGS_URLS).toEqual(expected);
    for (const kind of PERMISSION_KINDS) {
      const { a, calls } = apis("darwin");
      expect(await openPermissionSettings(kind, a)).toEqual({ ok: true, opened: expected[kind] });
      expect(calls.filter((c) => c.startsWith("open:"))).toEqual([`open:${expected[kind]}`]);
      expect(calls.at(-1)).toBe("refresh");
    }
  });

  it("macOS microphone: asks for access first, opens Settings only when not granted", async () => {
    const denied = apis("darwin", false);
    await openPermissionSettings("microphone", denied.a);
    expect(denied.calls).toEqual(["ask:microphone", `open:${MAC_SETTINGS_URLS.microphone}`, "refresh"]);
    const granted = apis("darwin", true);
    expect(await openPermissionSettings("microphone", granted.a)).toEqual({ ok: true, opened: null, granted: true });
    expect(granted.calls).toEqual(["ask:microphone", "refresh"]);
  });

  it("macOS screen: triggers the prompt with getSources once before opening the pane", async () => {
    const { a, calls } = apis("darwin");
    await openPermissionSettings("screen", a);
    expect(calls).toEqual(["getSources", `open:${MAC_SETTINGS_URLS.screen}`, "refresh"]);
  });

  it("Windows: ms-settings:privacy-microphone, 'not needed' for the rest", async () => {
    const mic = apis("win32");
    expect(await openPermissionSettings("microphone", mic.a)).toEqual({ ok: true, opened: "ms-settings:privacy-microphone" });
    expect(mic.calls).toEqual(["open:ms-settings:privacy-microphone", "refresh"]);
    for (const kind of ["screen", "accessibility", "input-monitoring"]) {
      const { a, calls } = apis("win32");
      expect(await openPermissionSettings(kind, a)).toEqual({ ok: false, reason: "not_needed" });
      expect(calls).toEqual([]);
    }
  });

  it("rejects unknown kinds and URLs from the page", async () => {
    for (const kind of ["camera", "", null, 1, "Microphone", MAC_SETTINGS_URLS.screen, "ms-settings:privacy-microphone", "https://evil.com"]) {
      for (const platform of ["darwin", "win32"] as const) {
        const { a, calls } = apis(platform);
        expect(await openPermissionSettings(kind, a)).toEqual({ ok: false, reason: "unknown_kind" });
        expect(calls).toEqual([]);
      }
    }
  });

  it("is wired in main behind the bridge sender check and exposed by the preload", () => {
    const main = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    const start = main.indexOf("ipcMain.handle(BRIDGE_CHANNELS.permissionSettings");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf("\n});", start));
    expect(body).toContain("senderAllowed(bridgeSender(e), appList)");
    expect(body).toContain('systemPreferences.askForMediaAccess("microphone")');
    expect(body).toContain("desktopCapturer.getSources");
    expect(body).toContain("emit(status())");
    const preload = fs.readFileSync(path.join(here, "preloadApp.cts"), "utf8");
    expect(preload).toContain('ipcRenderer.invoke("apprentice-permission-settings", kind)');
  });
});

describe("navigation guard stays strict", () => {
  const list = appAllowlist({ appOrigin: "https://app.example.com", isPackaged: true, env: undefined });
  it("blocks x-apple.systempreferences and ms-settings navigations", () => {
    for (const url of [...Object.values(MAC_SETTINGS_URLS), "x-apple.systempreferences:", "ms-settings:privacy-microphone", "ms-settings:"]) {
      expect(navigationAllowed(url, list), url).toBe(false);
    }
    expect(navigationAllowed("https://app.example.com/train", list)).toBe(true);
  });
});
