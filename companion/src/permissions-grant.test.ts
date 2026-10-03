import { describe, expect, it } from "vitest";
import { appAllowlist } from "./appConfig.mjs";
import {
  allowDisplayMedia,
  checkPermission,
  DISPLAY_MEDIA_OPTIONS,
  grantPermission,
  pickPrimarySource,
  type PermissionRequest,
} from "./permissionsGrant.mjs";

const list = appAllowlist({ appOrigin: "https://ai-apprentice.vercel.app", isPackaged: true, env: undefined });
const OK = "https://ai-apprentice.vercel.app/train";
const LOOKALIKES = [
  "https://ai-apprentice.vercel.app.evil.com/",
  "https://ai-apprentice-vercel.app/",
  "https://xai-apprentice.vercel.app/",
  "http://ai-apprentice.vercel.app/",
  "https://ai-apprentice.vercel.app:8443/",
  "https://user:pw@ai-apprentice.vercel.app/",
  "https://evil.com/#https://ai-apprentice.vercel.app",
  "http://localhost:3000/",
  "file:///Users/x/index.html",
  "",
];
const req = (over: Partial<PermissionRequest>): PermissionRequest => ({
  permission: "media",
  url: OK,
  isMainFrame: true,
  mediaTypes: ["audio"],
  fromMainWindow: true,
  ...over,
});

describe("permission requests", () => {
  it("grants the microphone and display-capture to the allowlisted main frame", () => {
    expect(grantPermission(req({}), list)).toBe(true);
    expect(grantPermission(req({ permission: "display-capture", mediaTypes: undefined }), list)).toBe(true);
  });

  it("rejects look-alike origins", () => {
    for (const url of LOOKALIKES) {
      expect(grantPermission(req({ url }), list)).toBe(false);
      expect(grantPermission(req({ url, permission: "display-capture" }), list)).toBe(false);
    }
  });

  it("denies the camera, iframes, other windows and every other permission", () => {
    expect(grantPermission(req({ mediaTypes: ["video"] }), list)).toBe(false);
    expect(grantPermission(req({ mediaTypes: ["audio", "video"] }), list)).toBe(false);
    expect(grantPermission(req({ mediaTypes: [] }), list)).toBe(false);
    expect(grantPermission(req({ isMainFrame: false }), list)).toBe(false);
    expect(grantPermission(req({ fromMainWindow: false }), list)).toBe(false);
    for (const permission of ["geolocation", "notifications", "clipboard-read", "midi", "openExternal", "pointerLock", "fullscreen", "hid", "serial", "usb"]) {
      expect(grantPermission(req({ permission }), list)).toBe(false);
    }
  });

  it("permission checks follow the same rule", () => {
    expect(checkPermission({ permission: "media", origin: "https://ai-apprentice.vercel.app", mediaType: "audio", fromMainWindow: true }, list)).toBe(true);
    expect(checkPermission({ permission: "media", origin: "https://ai-apprentice.vercel.app", mediaType: "video", fromMainWindow: true }, list)).toBe(false);
    expect(checkPermission({ permission: "media", origin: "https://ai-apprentice.vercel.app.evil.com", mediaType: "audio", fromMainWindow: true }, list)).toBe(false);
    expect(checkPermission({ permission: "media", origin: "https://ai-apprentice.vercel.app", mediaType: "audio", fromMainWindow: false }, list)).toBe(false);
    expect(checkPermission({ permission: "geolocation", origin: "https://ai-apprentice.vercel.app", fromMainWindow: true }, list)).toBe(false);
  });
});

describe("display media", () => {
  const dm = { url: OK, isMainFrame: true, fromMainWindow: true, videoRequested: true };

  it("answers only the allowlisted main frame of the main window, video only", () => {
    expect(allowDisplayMedia(dm, list)).toBe(true);
    for (const url of LOOKALIKES) expect(allowDisplayMedia({ ...dm, url }, list)).toBe(false);
    expect(allowDisplayMedia({ ...dm, isMainFrame: false }, list)).toBe(false);
    expect(allowDisplayMedia({ ...dm, fromMainWindow: false }, list)).toBe(false);
    expect(allowDisplayMedia({ ...dm, videoRequested: false }, list)).toBe(false);
  });

  it("picks the primary screen without the system picker", () => {
    const sources = [
      { id: "window:12:0", display_id: "", name: "Outlook" },
      { id: "screen:2:0", display_id: "2", name: "Screen 2" },
      { id: "screen:1:0", display_id: "1", name: "Screen 1" },
    ];
    expect(pickPrimarySource(sources, 1)?.id).toBe("screen:1:0");
    expect(pickPrimarySource(sources, 99)?.id).toBe("screen:2:0");
    expect(pickPrimarySource([sources[0]], 1)).toBeNull();
    expect(DISPLAY_MEDIA_OPTIONS.useSystemPicker).toBe(false);
  });
});
