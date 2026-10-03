import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_BASE_MS, CODE_KEY, createCompanionClient, parseCompanionMessage, type SocketLike } from "./client";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

const STATUS = { type: "status", version: "0.1.0", permissions: { input: true, screen: true, accessibility: false } };

function setup(code: string | null = "123456") {
  const sockets: FakeSocket[] = [];
  const storage = memoryStore(code ? { [CODE_KEY]: code } : {});
  const client = createCompanionClient({
    createSocket: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    storage,
    random: () => 1,
  });
  const last = () => sockets[sockets.length - 1];
  return { client, sockets, storage, last };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("companion client", () => {
  it("connects to 127.0.0.1:47321 and says hello with the stored code", () => {
    const { client, last } = setup();
    client.connect();
    expect(last().url).toBe("ws://127.0.0.1:47321");
    expect(client.status()).toBe("connecting");
    last().open();
    expect(JSON.parse(last().sent[0])).toEqual({ type: "hello", token: "123456" });
    last().receive(STATUS);
    expect(client.status()).toBe("paired");
    expect(client.permissions()).toEqual(STATUS.permissions);
    expect(client.version()).toBe("0.1.0");
  });

  it("without a stored code asks for pairing and opens no socket; pair() stores the code", () => {
    const { client, sockets, storage, last } = setup(null);
    client.connect();
    expect(client.status()).toBe("pair");
    expect(sockets).toHaveLength(0);
    expect(client.pair("12a")).toBe(false);
    expect(client.pair("654321")).toBe(true);
    expect(storage.map.get(CODE_KEY)).toBe("654321");
    last().open();
    expect(JSON.parse(last().sent[0]).token).toBe("654321");
  });

  it("reconnects with capped exponential backoff and resets after open", () => {
    const { client, sockets, last } = setup();
    client.connect();
    last().serverClose(1006);
    expect(client.status()).toBe("not connected");
    vi.advanceTimersByTime(BACKOFF_BASE_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().serverClose(1006);
    vi.advanceTimersByTime(2 * BACKOFF_BASE_MS - 1);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    for (let i = 0; i < 10; i++) {
      last().serverClose(1006);
      vi.advanceTimersByTime(30000);
    }
    expect(sockets).toHaveLength(13);
    last().open();
    last().serverClose(1006);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(sockets).toHaveLength(14);
  });

  it("4401 clears the stored code and does not reconnect; 4403 is origin blocked", () => {
    const a = setup();
    a.client.connect();
    a.last().serverClose(4401);
    expect(a.client.status()).toBe("pair");
    expect(a.storage.map.has(CODE_KEY)).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(a.sockets).toHaveLength(1);

    const b = setup();
    b.client.connect();
    b.last().serverClose(4403);
    expect(b.client.status()).toBe("origin blocked");
    vi.advanceTimersByTime(60000);
    expect(b.sockets).toHaveLength(1);
  });

  it("parses status, activity and app events and ignores malformed frames", () => {
    const { client, last } = setup();
    const activity = vi.fn();
    const app = vi.fn();
    const status = vi.fn();
    client.on("activity", activity);
    client.on("app", app);
    client.on("status", status);
    client.connect();
    last().open();
    last().receive({ type: "activity", t: 1, typing: true, pointer: false, keys: 3, clicks: 0, idle_ms: 10 });
    expect(activity).not.toHaveBeenCalled();
    last().receive(STATUS);
    expect(status).toHaveBeenLastCalledWith("paired", STATUS.permissions);
    last().receive({ type: "activity", t: 2, typing: true, pointer: false, keys: 3, clicks: 0, idle_ms: 10 });
    last().receive({ type: "app", t: 3, app: "Microsoft Outlook", title: "Inbox" });
    last().receive("not json");
    last().receive({ type: "activity", t: 4, typing: "yes", pointer: false, keys: 1, clicks: 0, idle_ms: 0 });
    last().receive({ type: "activity", t: 4, typing: true, pointer: false, keys: -1, clicks: 0, idle_ms: 0 });
    last().receive({ type: "app", t: 5, app: "", title: "x" });
    last().receive({ type: "key", code: 65 });
    expect(activity).toHaveBeenCalledTimes(1);
    expect(activity.mock.calls[0][0]).toMatchObject({ typing: true, keys: 3, idle_ms: 10 });
    expect(app).toHaveBeenCalledTimes(1);
    expect(app.mock.calls[0][0]).toEqual({ type: "app", t: 3, app: "Microsoft Outlook", title: "Inbox" });
    expect(parseCompanionMessage(JSON.stringify({ type: "pong" }))).toEqual({ type: "pong" });
  });

  it("showHalo and clearHalo send protocol messages, clamped, and are no-ops while not paired", () => {
    const { client, last } = setup();
    client.connect();
    expect(client.showHalo("h1", { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(false);
    last().open();
    last().receive(STATUS);
    expect(client.showHalo("h1", { x: -1, y: 0.2, w: 2, h: 0.4 }, "x".repeat(200))).toBe(true);
    expect(client.clearHalo("h1")).toBe(true);
    expect(client.clearHalo()).toBe(true);
    const out = last().sent.slice(1).map((s) => JSON.parse(s));
    expect(out[0]).toEqual({ type: "overlay.halo", id: "h1", rect: { x: 0, y: 0.2, w: 1, h: 0.4 }, text: "x".repeat(140) });
    expect(out[1]).toEqual({ type: "overlay.clear", id: "h1" });
    expect(out[2]).toEqual({ type: "overlay.clear" });
  });

  it("no exception when the companion is not running or WebSocket is missing", () => {
    const client = createCompanionClient({
      createSocket: () => {
        throw new Error("ECONNREFUSED");
      },
      storage: memoryStore({ [CODE_KEY]: "123456" }),
    });
    expect(() => client.connect()).not.toThrow();
    expect(client.status()).toBe("not connected");
    expect(() => vi.advanceTimersByTime(120000)).not.toThrow();
    expect(client.showHalo("h", { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);

    const broken = createCompanionClient({
      createSocket: () => {
        throw new Error("ECONNREFUSED");
      },
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {},
      },
    });
    expect(() => broken.connect()).not.toThrow();
    expect(broken.status()).toBe("pair");
    expect(() => broken.pair("123456")).not.toThrow();
    broken.dispose();
  });

  it("dispose clears timers and closes the socket", () => {
    const { client, last } = setup();
    client.connect();
    last().serverClose(1006);
    expect(vi.getTimerCount()).toBe(1);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("protocol v2", () => {
  function paired() {
    const s = setup();
    s.client.connect();
    s.last().open();
    s.last().receive(STATUS);
    s.last().sent.length = 0;
    return s;
  }
  const sent = (s: { last: () => FakeSocket }) => s.last().sent.map((m) => JSON.parse(m));
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
  const session = {
    mode: "capture" as const,
    title: "Capture: Sabine",
    expert: "Sabine",
    asked: 2,
    guardrails: 1,
    last_question: "Why 0400?",
    last_answer: "Capex.",
    off_record: false,
    app_url: "https://ai-apprentice.vercel.app/capture",
  };

  it("senders emit exactly the protocol shapes", () => {
    const s = paired();
    expect(s.client.buddyState("thinking")).toBe(true);
    s.client.buddySay("x".repeat(400));
    s.client.buddySay("Why?", 4000);
    s.client.buddyPoint({ id: "g1", rect, style: "glance" });
    s.client.buddyPoint({ id: "iv_1", rect: { ...rect, x: 2 }, style: "stop", text: "y".repeat(200), ttl_ms: 9000 });
    s.client.buddyClear("iv_1");
    s.client.buddyClear();
    s.client.sessionState(session);
    expect(sent(s)).toEqual([
      { type: "buddy.state", state: "thinking" },
      { type: "buddy.say", text: "x".repeat(280) },
      { type: "buddy.say", text: "Why?", ttl_ms: 4000 },
      { type: "buddy.point", id: "g1", rect, style: "glance" },
      { type: "buddy.point", id: "iv_1", rect: { ...rect, x: 1 }, style: "stop", text: "y".repeat(140), ttl_ms: 9000 },
      { type: "buddy.clear", id: "iv_1" },
      { type: "buddy.clear" },
      { type: "session.state", ...session },
    ]);
  });

  it("senders are no-ops when not paired; state is resent on pairing", () => {
    const s = setup();
    s.client.connect();
    s.last().open();
    s.last().sent.length = 0;
    expect(s.client.buddyState("listening")).toBe(false);
    expect(s.client.buddySay("hi")).toBe(false);
    expect(s.client.buddyPoint({ id: "g", rect, style: "glance" })).toBe(false);
    expect(s.client.buddyClear()).toBe(false);
    expect(s.client.sessionState(session)).toBe(false);
    expect(s.last().sent).toEqual([]);
    s.last().receive(STATUS);
    expect(sent(s)).toEqual([{ type: "buddy.state", state: "listening" }, { type: "session.state", ...session }]);
  });

  it("a shortcut message reaches the registered handler; unknown actions are ignored", () => {
    const s = paired();
    const fn = vi.fn();
    s.client.on("shortcut", fn);
    s.last().receive({ type: "shortcut", action: "end_task" });
    s.last().receive({ type: "shortcut", action: "format_disk" });
    expect(fn.mock.calls).toEqual([["end_task"]]);
    expect(parseCompanionMessage(JSON.stringify({ type: "shortcut", action: "talk_start" }))).toEqual({ type: "shortcut", action: "talk_start" });
  });
});
