import { describe, expect, it } from "vitest";
import { formatPairingLine, isPermissionKey, pairingViewModel, splitCode } from "./pairingWindow.mjs";

const allGranted = { input: true, screen: true, accessibility: true };

describe("pairing code formatting", () => {
  it("splits a 6-digit code as '123 456'", () => {
    expect(splitCode("123456")).toBe("123 456");
    expect(splitCode("000042")).toBe("000 042");
    expect(splitCode("12345")).toBe("12345");
  });

  it("prints the stdout line in the documented format", () => {
    expect(formatPairingLine("123456")).toBe("[companion] pairing code: 123 456 (enter it in the web app)");
  });
});

describe("pairing window view model", () => {
  it("shows the split code and not paired state", () => {
    const v = pairingViewModel({ code: "123456", paired: false, permissions: allGranted });
    expect(v.code).toBe("123 456");
    expect(v.paired).toBe(false);
    expect(v.stateText).toBe("Not paired");
    expect(v.missing).toEqual([]);
  });

  it("shows paired state", () => {
    const v = pairingViewModel({ code: "123456", paired: true, permissions: allGranted });
    expect(v.paired).toBe(true);
    expect(v.stateText).toBe("Paired with web app");
  });

  it("shows a server error instead of the pairing state", () => {
    const v = pairingViewModel({ code: "123456", paired: false, permissions: allGranted, serverError: "port 47321 is in use" });
    expect(v.stateText).toBe("Error: port 47321 is in use");
  });

  it("lists only the missing permissions, in a stable order", () => {
    const v = pairingViewModel({ code: "123456", paired: false, permissions: { input: false, screen: false, accessibility: true } });
    expect(v.missing.map((m) => m.key)).toEqual(["input", "screen"]);
    expect(v.missing[0]).toMatchObject({ label: "Input Monitoring" });
    const none = pairingViewModel({ code: "123456", paired: false, permissions: { input: false, screen: false, accessibility: false } });
    expect(none.missing.map((m) => m.key)).toEqual(["accessibility", "input", "screen"]);
  });

  it("accepts only known permission keys from the renderer", () => {
    expect(isPermissionKey("screen")).toBe(true);
    expect(isPermissionKey("javascript:alert(1)")).toBe(false);
    expect(isPermissionKey(undefined)).toBe(false);
  });
});
