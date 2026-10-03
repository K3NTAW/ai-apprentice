import { describe, expect, it } from "vitest";
import { compileRule, isHostAllowed, isOriginAllowed, parseAllowlist } from "./origin.mjs";
import { codesEqual, generateCode, MAX_FAILED_ATTEMPTS, Pairing } from "./pairing.mjs";
import { CLOSE, DEFAULT_PORT, parseClientMessage, parsePort, statusMessage } from "./protocol.mjs";
import { MAX_PENDING, SessionGate } from "./session.mjs";

const PORT = DEFAULT_PORT;
const HOST = `127.0.0.1:${PORT}`;
const defaults = parseAllowlist(undefined);
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
    for (const raw of ["", "nope", "null", "[]", "42", '{"type":1}', '{"type":"hack"}', '{"type":"hello"}', '{"type":"hello","token":123}', '{"type":"overlay.clear","id":5}', '{"type":"overlay.halo","id":"x"}', undefined, 7, {}]) {
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
  it("allows the default origins and wildcard matches", () => {
    for (const o of [
      "http://localhost:3000",
      "https://ai-apprentice.vercel.app",
      "https://ai-apprentice-git-main.vercel.app",
      "https://ai-apprentice-abc123-k3ntaws-projects.vercel.app",
      "https://feature-x-k3ntaws-projects.vercel.app",
    ]) {
      expect(isOriginAllowed(o, defaults), o).toBe(true);
    }
  });

  it("rejects look-alikes, wrong scheme or port, missing and null", () => {
    for (const o of [
      "https://evil.com",
      "https://ai-apprentice.vercel.app.evil.com",
      "http://127.0.0.1.evil.com",
      "http://localhost:3000.evil.com",
      "https://a.b-k3ntaws-projects.vercel.app",
      "https://evil.com/ai-apprentice.vercel.app",
      "http://ai-apprentice.vercel.app",
      "https://localhost:3000",
      "http://localhost:3001",
      "http://localhost",
      "https://ai-apprentice.vercel.app:8443",
      "https://xai-apprentice.vercel.app",
      "https://ai-apprentice_x.vercel.app",
      "null",
      "",
      undefined,
      null,
    ]) {
      expect(isOriginAllowed(o as string | undefined, defaults), String(o)).toBe(false);
    }
  });

  it("treats default ports as equal", () => {
    const list = parseAllowlist("https://app.example.com");
    expect(isOriginAllowed("https://app.example.com", list)).toBe(true);
    expect(isOriginAllowed("https://app.example.com:443", list)).toBe(true);
  });

  it("compiles wildcard rules only inside the first label", () => {
    expect(compileRule("*")).toBeNull();
    expect(compileRule("https://*")).toBeNull();
    expect(compileRule("https://*.vercel.app")).toBeNull();
    expect(compileRule("https://app.*.com")).toBeNull();
    expect(compileRule("https://*.com")).toBeNull();
    expect(compileRule("ftp://x.example.com")).toBeNull();
    expect(compileRule("https://pre-*.example.com")).not.toBeNull();
    const list = parseAllowlist("https://pre-*.example.com");
    expect(isOriginAllowed("https://pre-.example.com", list)).toBe(true);
    expect(isOriginAllowed("https://pre-abc-1.example.com", list)).toBe(true);
    expect(isOriginAllowed("https://pre-a.b.example.com", list)).toBe(false);
  });

  it("denies everything when the override is empty or has no valid entries", () => {
    for (const env of ["", " , ", "*", "nonsense"]) {
      const list = parseAllowlist(env);
      expect(list.rules).toHaveLength(0);
      expect(list.errors.length).toBeGreaterThan(0);
      expect(isOriginAllowed(okOrigin, list)).toBe(false);
    }
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

  it("rotates the code after too many failures", () => {
    let n = 0;
    const p = new Pairing(() => String(100000 + n++));
    const first = p.current();
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) expect(p.check("000000")).toBe("bad");
    expect(p.check("000000")).toBe("locked");
    expect(p.current()).not.toBe(first);
    expect(p.check(first)).toBe("bad");
    expect(p.check(p.current())).toBe("ok");
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

  it("locks with 4429 after repeated wrong codes", () => {
    const { gate } = gateWith();
    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      gate.admit(i, { origin: okOrigin, host: HOST });
      last = gate.hello(i, "000000");
      gate.close(i);
    }
    expect(last).toMatchObject({ ok: false, code: CLOSE.LOCKED });
  });
});
