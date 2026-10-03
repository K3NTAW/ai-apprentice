import { describe, expect, it } from "vitest";
import { loginErrorMessage, safeNext } from "./redirect";

describe("loginErrorMessage", () => {
  it("maps the three known codes to fixed text", () => {
    for (const code of ["missing_code", "link_invalid", "workspace_setup_failed"]) {
      expect(loginErrorMessage(code)).toEqual(expect.any(String));
    }
    expect(loginErrorMessage("link_invalid")).toMatch(/same browser/);
  });
  it("returns null for anything else and never echoes input", () => {
    for (const code of ["<script>alert(1)</script>", "toString", "__proto__", "", null, undefined, ["link_invalid"]]) {
      expect(loginErrorMessage(code)).toBeNull();
    }
  });
});

describe("safeNext", () => {
  for (const ok of ["/teach?x=1", "/map/abc", "/loginx", "/authors", "/capture#top"]) {
    it(`accepts ${JSON.stringify(ok)}`, () => {
      expect(safeNext(ok)).toBe(ok);
    });
  }

  const bad: unknown[] = [
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    42,
    { toString: () => "/capture" },
    "/login",
    "/login?x=1",
    "/login/",
    "/auth",
    "/auth/callback",
    "/AUTH/callback",
    "/%6Cogin",
    "/./login",
    "/a b",
    "/a\u007f",
    "/x\\y",
    `/${"a".repeat(2048)}`,
  ];
  for (const input of bad) {
    it(`rejects ${typeof input === "string" ? JSON.stringify(input.slice(0, 40)) : String(input)}`, () => {
      expect(safeNext(input)).toBe("/dashboard");
    });
  }

  it("uses the given fallback", () => {
    expect(safeNext("//evil.com", "/workspace")).toBe("/workspace");
  });
});
