import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blockedNavigationLog, classifyLoadFailure, isLoadErrorAction, loadErrorView, navigationAllowed } from "./loadError.mjs";
import { buildAllowlist } from "./origin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SSO = "https://vercel.com/sso-api?url=https%3A%2F%2Fpreview.vercel.app&nonce=secret";

describe("load failure reasons", () => {
  it("a redirect to vercel.com/sso-api is Vercel Deployment Protection", () => {
    const r = classifyLoadFailure({ kind: "blocked", url: SSO });
    expect(r.kind).toBe("deployment-protection");
    expect(r.message).toContain("vercel.com");
    expect(r.message).toContain("Deployment Protection");
    expect(r.message).toContain("production URL");
    expect(r.message).not.toContain("nonce");
  });

  it("any other foreign origin is the generic redirect message", () => {
    const r = classifyLoadFailure({ kind: "blocked", url: "https://login.example.org/auth?x=1" });
    expect(r.kind).toBe("redirect");
    expect(r.message).toContain("login.example.org");
    expect(r.message).not.toContain("Deployment Protection");
  });

  it("network error codes give the network message with the error text", () => {
    const r = classifyLoadFailure({ kind: "network", code: -105, description: "ERR_NAME_NOT_RESOLVED" });
    expect(r.kind).toBe("network");
    expect(r.message).toContain("ERR_NAME_NOT_RESOLVED");
    const other = classifyLoadFailure({ kind: "network", code: -999, description: "" });
    expect(other.kind).toBe("network");
    expect(other.message).toContain("-999");
  });

  it("a renderer crash is explained too", () => {
    expect(classifyLoadFailure({ kind: "crash", reason: "oom" }).message).toContain("oom");
  });
});

describe("error page view model", () => {
  it("names the app origin and offers Retry, Change URL and Open in browser", () => {
    const v = loadErrorView("https://preview-abc.vercel.app/studio?q=1", { kind: "blocked", url: SSO });
    expect(v.title).toBe("Couldn't load AI Apprentice from https://preview-abc.vercel.app.");
    expect(v.reason).toContain("Deployment Protection");
    expect(v.actions.map((a) => a.label)).toEqual(["Retry", "Change URL", "Open in browser"]);
    expect(v.actions.every((a) => isLoadErrorAction(a.id))).toBe(true);
    expect(isLoadErrorAction("navigate")).toBe(false);
  });

  it("the static page has the three buttons", () => {
    const html = fs.readFileSync(path.join(here, "..", "static", "load-error.html"), "utf8");
    for (const id of ["retry", "change-url", "open-browser"]) expect(html).toContain(`data-action="${id}"`);
  });
});

describe("navigation guard", () => {
  const list = buildAllowlist({ appOrigin: "https://preview-abc.vercel.app", isPackaged: true, env: undefined });

  it("still blocks the foreign origin and allows the app origin", () => {
    expect(navigationAllowed(SSO, list)).toBe(false);
    expect(navigationAllowed("https://evil.example.com/", list)).toBe(false);
    expect(navigationAllowed("https://preview-abc.vercel.app/studio", list)).toBe(true);
  });

  it("logs the blocked origin only, no query string", () => {
    expect(blockedNavigationLog(SSO)).toBe("navigation blocked: https://vercel.com");
  });
});
