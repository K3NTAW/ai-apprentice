import { describe, expect, it, vi } from "vitest";
import { DROPPED, initCrashReporting, scrubEvent, sentryOptions } from "./crash.mjs";

const HOME = "/Users/name";

describe("initCrashReporting", () => {
  it.each([[null], ["{}"], ['{"appUrl":null}'], ['{"sentryDsn":""}'], ['{"sentryDsn":"  "}'], ['{"sentryDsn":42}'], ["{corrupt"]])("no init for %s", (configText) => {
    const init = vi.fn();
    expect(initCrashReporting({ configText, init })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("calls init once with the dsn", () => {
    const init = vi.fn();
    expect(initCrashReporting({ configText: '{"appUrl":null,"sentryDsn":"https://k@o1.ingest.sentry.io/1"}', init })).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0].dsn).toBe("https://k@o1.ingest.sentry.io/1");
  });
});

describe("sentryOptions", () => {
  const opts = sentryOptions("https://k@o1.ingest.sentry.io/1", HOME);

  it("no PII, no screenshots, no breadcrumbs", () => {
    expect(opts.dsn).toBe("https://k@o1.ingest.sentry.io/1");
    expect(opts.attachScreenshot).toBe(false);
    expect(opts.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
    expect(opts.beforeBreadcrumb?.({ message: "x" }, undefined)).toBeNull();
    expect("autoSessionTracking" in opts).toBe(false);
  });

  it("drops the named integrations and keeps the rest", () => {
    expect([...DROPPED].sort()).toEqual(["ChildProcess", "Console", "ElectronBreadcrumbs", "ElectronNet", "Screenshots"]);
    const names = ["SentryMinidump", ...DROPPED, "OnUncaughtException", "LinkedErrors", "NormalizePaths"];
    const filter = opts.integrations as (d: { name: string }[]) => { name: string }[];
    expect(filter(names.map((name) => ({ name }))).map((i) => i.name)).toEqual(["SentryMinidump", "OnUncaughtException", "LinkedErrors", "NormalizePaths"]);
  });

  it("beforeSend scrubs", () => {
    const out = (opts.beforeSend as (e: unknown, h: unknown) => any)({ type: undefined, user: { id: "1" }, server_name: "name-mbp" }, {});
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
  });
});

describe("scrubEvent", () => {
  it("removes identifying fields and rewrites home paths, keeps message and exception type", () => {
    const frame = (p: string) => ({ abs_path: p, filename: p, function: "boot", lineno: 10 });
    const event = {
      message: "boom",
      server_name: "names-MacBook-Pro.local",
      user: { id: "u1", ip_address: "{{auto}}" },
      request: { url: "https://app.example/x", headers: { cookie: "a=b" } },
      contexts: { device: { model: "Mac15,3" }, culture: { locale: "de-CH" }, os: { name: "macOS" } },
      exception: {
        values: [
          {
            type: "TypeError",
            value: "x is undefined",
            stacktrace: {
              frames: [
                frame(`${HOME}/Applications/AI Apprentice.app/Contents/Resources/app.asar/dist/main.mjs`),
                frame("/Applications/AI Apprentice.app/Contents/Resources/app.asar/dist/main.mjs"),
                frame("/Users/namesake/x.mjs"),
              ],
            },
          },
        ],
      },
      threads: { values: [{ stacktrace: { frames: [frame(`${HOME}/Library/x.js`)] } }] },
    };
    const out = scrubEvent(event, HOME);
    expect(out).toBe(event);
    expect(out.request).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.contexts.device).toBeUndefined();
    expect(out.contexts.culture).toBeUndefined();
    expect(out.contexts.os).toEqual({ name: "macOS" });
    expect(out.message).toBe("boom");
    const [ex] = out.exception.values;
    expect(ex.type).toBe("TypeError");
    expect(ex.value).toBe("x is undefined");
    const [f0, f1, f2] = ex.stacktrace.frames;
    expect(f0.abs_path).toBe("~/Applications/AI Apprentice.app/Contents/Resources/app.asar/dist/main.mjs");
    expect(f0.filename).toBe("~/Applications/AI Apprentice.app/Contents/Resources/app.asar/dist/main.mjs");
    expect(f1.abs_path).toBe("/Applications/AI Apprentice.app/Contents/Resources/app.asar/dist/main.mjs");
    expect(f2.abs_path).toBe("/Users/namesake/x.mjs");
    expect(out.threads.values[0].stacktrace.frames[0].abs_path).toBe("~/Library/x.js");
    expect(out.threads.values[0].stacktrace.frames[0].filename).toBe("~/Library/x.js");
  });

  it("tolerates an event without the optional parts", () => {
    const bare: { message: string; user?: unknown } = { message: "m" };
    expect(scrubEvent(bare, HOME)).toEqual({ message: "m" });
  });
});
