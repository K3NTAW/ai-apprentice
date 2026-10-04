import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveAppUrl } from "./appConfig.mjs";
import { hasAppSession, loadMainWindow, mainEntryUrl, planMainLoad, serializeStoredAppUrl, validateSetupUrl, type MainWindowLike } from "./appUrl.mjs";

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
      url: "https://env.example.com/app/login",
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

  it("main.mts stores the URL in userData and ships the local setup screen", () => {
    const src = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    expect(src).toMatch(/app\.getPath\("userData"\), STORED_APP_URL_FILE/);
    expect(src).toMatch(/validateSetupUrl\(raw\)/);
    expect(fs.existsSync(path.join(here, "..", "static", "setup.html"))).toBe(true);
  });
});

describe("main window opens straight into the app (T-0205)", () => {
  const resolved = resolveAppUrl({ env: "https://app.example.com/?x=1", configText: null, storedText: null });
  const FILES = { setup: "/static/setup.html", error: "/static/app-error.html" };

  /** A fake main window whose session returns the given cookie names, or rejects. Records what was loaded. */
  function fakeWindow(cookies: string[] | Error, destroyed = false) {
    const loads: { url?: string; file?: string; query?: Record<string, string> }[] = [];
    const cookieUrls: string[] = [];
    const win: MainWindowLike = {
      isDestroyed: () => destroyed,
      loadURL: (url) => loads.push({ url }),
      loadFile: (file, options) => loads.push({ file, ...(options?.query ? { query: options.query } : {}) }),
      webContents: {
        session: {
          cookies: {
            get: async ({ url }) => {
              cookieUrls.push(url);
              if (cookies instanceof Error) throw cookies;
              return cookies.map((name) => ({ name }));
            },
          },
        },
      },
    };
    return { win, loads, cookieUrls };
  }

  it("signed out loads APP_URL + /login", async () => {
    const { win, loads, cookieUrls } = fakeWindow(["other", "sb-abc-auth-token-code-verifier"]);
    expect(await loadMainWindow(win, resolved, FILES)).toEqual({ kind: "remote", url: "https://app.example.com/login" });
    expect(loads).toEqual([{ url: "https://app.example.com/login" }]);
    expect(cookieUrls).toEqual(["https://app.example.com"]);
  });

  it("signed in (a Supabase session cookie or a chunk of one) loads APP_URL + /agents", async () => {
    for (const cookies of [["sb-abc-auth-token"], ["sb-abc-auth-token.0", "sb-abc-auth-token.1"]]) {
      const { win, loads } = fakeWindow(cookies);
      await loadMainWindow(win, resolved, FILES);
      expect(loads, cookies.join()).toEqual([{ url: "https://app.example.com/agents" }]);
    }
  });

  it("a failing cookie check counts as signed out and loads /login", async () => {
    const { win, loads } = fakeWindow(new Error("session gone"));
    await loadMainWindow(win, resolved, FILES);
    expect(loads).toEqual([{ url: "https://app.example.com/login" }]);
  });

  it("keeps a sub-path in APP_URL (https://x/app -> https://x/app/login or /app/agents), dropping query and hash", async () => {
    const sub = resolveAppUrl({ env: "https://app.example.com/app?x=1#y", configText: null, storedText: null });
    for (const [cookies, url] of [
      [[], "https://app.example.com/app/login"],
      [["sb-abc-auth-token"], "https://app.example.com/app/agents"],
    ] as const) {
      const { win, loads, cookieUrls } = fakeWindow([...cookies]);
      await loadMainWindow(win, sub, FILES);
      expect(loads).toEqual([{ url }]);
      expect(cookieUrls).toEqual(["https://app.example.com"]);
    }
    expect(mainEntryUrl("https://app.example.com/app/", true)).toBe("https://app.example.com/app/agents");
    expect(mainEntryUrl("http://localhost:3000/", true)).toBe("http://localhost:3000/agents");
    expect(mainEntryUrl("http://localhost:3000", false)).toBe("http://localhost:3000/login");
  });

  it("without APP_URL loads the local setup screen and checks no cookies", async () => {
    const { win, loads, cookieUrls } = fakeWindow(["sb-abc-auth-token"]);
    expect(await loadMainWindow(win, resolveAppUrl({ env: undefined, configText: shipped, storedText: null }), FILES)).toEqual({ kind: "setup" });
    expect(loads).toEqual([{ file: FILES.setup }]);
    expect(cookieUrls).toEqual([]);
  });

  it("an invalid APP_URL loads the local error page with the reason, never a remote page", async () => {
    const { win, loads } = fakeWindow([]);
    await loadMainWindow(win, resolveAppUrl({ env: "http://example.com", configText: null, storedText: null }), FILES);
    expect(loads).toEqual([{ file: FILES.error, query: { reason: "app_url_scheme" } }]);
  });

  it("loads nothing when the window was closed during the cookie check", async () => {
    const { win, loads } = fakeWindow([], true);
    expect(await loadMainWindow(win, resolved, FILES)).toBeNull();
    expect(loads).toEqual([]);
  });

  it("signed in means a Supabase session cookie (or a chunk of one), not the PKCE verifier", () => {
    expect(hasAppSession(["sb-abc-auth-token"])).toBe(true);
    expect(hasAppSession(["other", "sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
    expect(hasAppSession(["sb-abc-auth-token-code-verifier"])).toBe(false);
    expect(hasAppSession([])).toBe(false);
  });

  it("the setup screen says the window opens into the app", () => {
    const setup = fs.readFileSync(path.join(here, "..", "static", "setup.html"), "utf8");
    expect(setup).toContain("opens straight into your agents, or the sign-in");
    expect(planMainLoad(resolved)).toEqual({ kind: "remote", url: "https://app.example.com/login" });
  });
});
