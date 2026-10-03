import { describe, expect, it } from "vitest";
import { buildAllowlist, compileRule, isHostAllowed, isOriginAllowed, parseAllowlist } from "./origin.mjs";
import { codesEqual, generateCode, Pairing } from "./pairing.mjs";
import { CLOSE, DEFAULT_PORT, parseClientMessage, parsePort, statusMessage } from "./protocol.mjs";
import { MAX_PENDING, SessionGate } from "./session.mjs";

const PORT = DEFAULT_PORT;
const HOST = `127.0.0.1:${PORT}`;
const defaults = buildAllowlist({ appOrigin: "https://app.example.com", isPackaged: false, env: undefined });
const okOrigin = "http://localhost:3000";

function gateWith(code = "123456") {
  const pairing = new Pairing(() => code);
  return { gate: new SessionGate(defaults, PORT, pairing), pairing };
}

describe("message validation", () => {
  it("accepts the four client message types", () => {
    expect(parseClientMessage('{"type":"hello","token":"123456"}')).toEqual({ ok: true, msg: { type: "hello", token: "123456" } });
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ ok: true, msg: { type: "ping" } });
    expect(parseClientMessage('{"type":"overlay.clear"}')).toEqual({ ok: true, msg: { type: "overlay.clear" } });
    expect(parseClientMessage('{"type":"overlay.clear","id":"a"}')).toEqual({ ok: true, msg: { type: "overlay.clear", id: "a" } });
    const halo = parseClientMessage(JSON.stringify({ type: "overlay.halo", id: "h1", rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, text: "Stop" }));
    expect(halo).toEqual({ ok: true, msg: { type: "overlay.halo", id: "h1", rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, text: "Stop" } });
  });

  it("rejects bad input without throwing", () => {
    for (const raw of ["", "nope", "null", "[]", "42", '{"type":1}', '{"type":"hack"}', '{"type":"hello"}', '{"type":"hello","token":123}', '{"type":"overlay.clear","id":5}', '{"type":"overlay.halo","id":"x"}', '{"type":"buddy.state","state":"x"}', '{"type":"buddy.say"}', '{"type":"buddy.point","id":"x"}', '{"type":"shortcut","action":"end_task"}', undefined, 7, {}]) {
      expect(parseClientMessage(raw).ok).toBe(false);
    }
    expect(parseClientMessage("x".repeat(20_000))).toEqual({ ok: false, reason: "too_large" });
    expect(parseClientMessage('{"type":"__proto__"}').ok).toBe(false);
  });

  it("drops unknown fields from parsed messages", () => {
    expect(parseClientMessage('{"type":"ping","evil":1}')).toEqual({ ok: true, msg: { type: "ping" } });
  });

  it("builds status with exactly the protocol keys", () => {
    expect(statusMessage("0.1.0", { input: true, screen: false, accessibility: true })).toEqual({
      type: "status",
      version: "0.1.0",
      protocol: 3,
      permissions: { input: true, screen: false, accessibility: true },
    });
    expect(statusMessage("0.1.0", { input: false, screen: false, accessibility: false }, true).paused).toBe(true);
  });

  it("parses COMPANION_PORT", () => {
    expect(parsePort(undefined)).toEqual({ ok: true, port: 47321 });
    expect(parsePort("50000")).toEqual({ ok: true, port: 50000 });
    for (const bad of ["abc", "0", "80", "70000", "123x", "-1"]) expect(parsePort(bad).ok).toBe(false);
  });
});

describe("origin allowlist", () => {
  it("allows the APP_URL origin and localhost:3000 (unpackaged)", () => {
    for (const o of ["http://localhost:3000", "https://app.example.com", "https://app.example.com:443"]) {
      expect(isOriginAllowed(o, defaults), o).toBe(true);
    }
  });

  it("rejects third-party Vercel origins, look-alikes, wrong scheme or port, missing and null", () => {
    for (const o of [
      "https://ai-apprentice.vercel.app",
      "https://evil-k3ntaws-projects.vercel.app",
      "https://ai-apprentice-x.vercel.app",
      "https://ai-apprentice-git-main.vercel.app",
      "https://evil.com",
      "https://app.example.com.evil.com",
      "https://x.app.example.com",
      "http://127.0.0.1.evil.com",
      "http://localhost:3000.evil.com",
      "http://app.example.com",
      "https://localhost:3000",
      "http://localhost:3001",
      "http://localhost",
      "https://app.example.com:8443",
      "null",
      "",
      undefined,
      null,
    ]) {
      expect(isOriginAllowed(o as string | undefined, defaults), String(o)).toBe(false);
    }
  });

  it("compiles exact origins only; any '*' is invalid", () => {
    for (const bad of ["*", "https://*", "https://*.vercel.app", "https://pre-*.example.com", "https://app.*.com", "ftp://x.example.com"]) {
      expect(compileRule(bad), bad).toBeNull();
    }
    expect(compileRule("https://app.example.com")).not.toBeNull();
  });

  it("checks the Host header against loopback and port (DNS rebinding)", () => {
    expect(isHostAllowed(HOST, PORT)).toBe(true);
    expect(isHostAllowed(`localhost:${PORT}`, PORT)).toBe(true);
    expect(isHostAllowed(`evil.com:${PORT}`, PORT)).toBe(false);
    expect(isHostAllowed("127.0.0.1:1", PORT)).toBe(false);
    expect(isHostAllowed(undefined, PORT)).toBe(false);
  });
});

describe("pairing", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("compares codes in constant time and is safe on length mismatch", () => {
    expect(codesEqual("123456", "123456")).toBe(true);
    expect(codesEqual("123456", "123457")).toBe(false);
    expect(codesEqual("123456", "1234567")).toBe(false);
    expect(codesEqual("123456", "")).toBe(false);
  });

  it("rotates only on demand", () => {
    let n = 0;
    const p = new Pairing(() => String(100000 + n++));
    const first = p.current();
    expect(p.check("000000")).toBe(false);
    expect(p.check(first)).toBe(true);
    expect(p.rotate()).not.toBe(first);
    expect(p.check(first)).toBe(false);
  });
});

describe("session gate", () => {
  it("closes 4403 on a bad origin or host", () => {
    const { gate } = gateWith();
    expect(gate.admit(1, { origin: "https://evil.com", host: HOST })).toMatchObject({ ok: false, code: CLOSE.FORBIDDEN });
    expect(gate.admit(2, { host: HOST })).toMatchObject({ ok: false, code: 4403 });
    expect(gate.admit(3, { origin: okOrigin, host: "evil.com:47321" })).toMatchObject({ ok: false, code: 4403 });
  });

  it("closes 4401 on a wrong code and pairs on the right one", () => {
    const { gate } = gateWith("654321");
    expect(gate.admit(1, { origin: okOrigin, host: HOST }).ok).toBe(true);
    expect(gate.hello(1, "111111")).toMatchObject({ ok: false, code: CLOSE.UNAUTHORIZED });
    expect(gate.admit(2, { origin: okOrigin, host: HOST }).ok).toBe(true);
    expect(gate.hello(2, "654321")).toEqual({ ok: true });
    expect(gate.isPaired(2)).toBe(true);
  });

  it("allows one client at a time and frees the slot on close", () => {
    const { gate } = gateWith();
    gate.admit(1, { origin: okOrigin, host: HOST });
    gate.admit(2, { origin: okOrigin, host: HOST });
    expect(gate.hello(1, "123456").ok).toBe(true);
    expect(gate.hello(2, "123456")).toMatchObject({ ok: false, code: CLOSE.BUSY });
    expect(gate.admit(3, { origin: okOrigin, host: HOST })).toMatchObject({ ok: false, code: 4409 });
    expect(gate.close(1)).toBe(true);
    expect(gate.admit(4, { origin: okOrigin, host: HOST }).ok).toBe(true);
    expect(gate.hello(4, "123456").ok).toBe(true);
  });

  it("caps pending unauthenticated sockets", () => {
    const { gate } = gateWith();
    for (let i = 0; i < MAX_PENDING; i++) expect(gate.admit(i, { origin: okOrigin, host: HOST }).ok).toBe(true);
    expect(gate.admit(99, { origin: okOrigin, host: HOST })).toMatchObject({ ok: false, code: CLOSE.BUSY });
  });

});
