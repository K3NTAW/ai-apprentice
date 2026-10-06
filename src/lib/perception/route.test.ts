import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { POST } from "@/app/api/vision/route";
import { log } from "@/lib/log";
import { fileStore } from "@/lib/store";

const createSession = fileStore.createSession.bind(fileStore);
const getSession = fileStore.getSession.bind(fileStore);
const setOffRecord = fileStore.setOffRecord.bind(fileStore);

const describeFrame = vi.hoisted(() => vi.fn());
vi.mock("@/lib/perception/vision", () => ({ describeFrame }));

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

let dir: string;
const prevDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "apprentice-vision-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  describeFrame.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
});

const onDisk = (id: string, name: string) =>
  access(path.join(dir, "sessions", id, "frames", name)).then(
    () => true,
    () => false,
  );

describe("POST /api/vision", () => {
  it("skips frames off the record and still handles frames outside the range", async () => {
    const s = await createSession({ kind: "capture" });
    await setOffRecord(s.id, { from: 10, to: 20 });
    const event = { t: 25, type: "screen_changed", summary: "invoice list", importance: "key" };
    describeFrame.mockResolvedValue({ events: [event] });

    const skipped = await post({ session_id: s.id, t: 15, frame: "data:image/jpeg;base64,/9j/" });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toEqual({ events: [], skipped: "off_record" });
    expect(describeFrame).not.toHaveBeenCalled();
    expect(await onDisk(s.id, "0015.jpg")).toBe(false);

    const kept = await post({ session_id: s.id, t: 25, frame: "data:image/jpeg;base64,/9j/" });
    expect(await kept.json()).toEqual({ events: [event], frame_ref: "frames/0025.jpg" });
    expect(describeFrame).toHaveBeenCalledTimes(1);
    expect(await onDisk(s.id, "0025.jpg")).toBe(true);
    expect((await getSession(s.id))?.frames).toEqual([{ name: "0025.jpg", t: 25 }]);
  });

  it("skips frames while a range is open", async () => {
    const s = await createSession({ kind: "capture" });
    await setOffRecord(s.id, { from: 40 });
    const res = await post({ session_id: s.id, t: 41, frame: "/9j/" });
    expect(await res.json()).toEqual({ events: [], skipped: "off_record" });
    expect(describeFrame).not.toHaveBeenCalled();
    expect(await onDisk(s.id, "0041.jpg")).toBe(false);
  });

  it.each(["a/b", "..", "../etc", "x..y"])("rejects session_id %s with 400", async (session_id) => {
    const res = await post({ session_id, t: 1, frame: "AAAA" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/vision upstream errors", () => {
  it("answers 502 (never 429) when the vision model fails upstream", async () => {
    const s = await createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [], error: "upstream_429" });
    const res = await post({ session_id: s.id, t: 3, frame: "/9j/" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "vision_upstream", detail: "upstream_429" });
  });
});

describe("POST /api/vision frame size limit", () => {
  it("answers 413 frame_too_large for a body over 2 MB without calling the model or the store", async () => {
    const s = await createSession({ kind: "capture" });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    const frame = "data:image/jpeg;base64," + "A".repeat(2 * 1024 * 1024 + 1);
    const res = await post({ session_id: s.id, t: 5, frame });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "frame_too_large" });
    expect(describeFrame).not.toHaveBeenCalled();
    expect(saveFrame).not.toHaveBeenCalled();
    expect(await onDisk(s.id, "0005.jpg")).toBe(false);
    saveFrame.mockRestore();
  });
});

const FRAME = "data:image/jpeg;base64,/9j/";
// handle() rethrows unknown errors out of withApi, so Next.js answers 500: a rejected POST here is that 500.
const status500 = (res: Promise<Response>) => expect(res).rejects.toThrow("boom");
const ev = (t: number, importance?: "key" | "routine") => ({
  t,
  type: "screen_changed",
  summary: `secret summary ${t}`,
  ...(importance ? { importance } : {}),
});

describe("POST /api/vision key moments", () => {
  let info: MockInstance<typeof log.info>;
  let warn: MockInstance<typeof log.warn>;
  const frameLines = () => [
    ...info.mock.calls.filter((c) => c[0] === "vision.frame").map((c) => ({ level: "info", fields: c[1] })),
    ...warn.mock.calls.filter((c) => c[0] === "vision.frame").map((c) => ({ level: "warn", fields: c[1] })),
  ];

  beforeEach(() => {
    info = vi.spyOn(log, "info");
    warn = vi.spyOn(log, "warn");
    return () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    };
  });

  it("off-record at request time: no model call, no save, skipped body, no line", async () => {
    const s = await createSession({ kind: "capture" });
    await setOffRecord(s.id, { from: 5, to: 9 });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    const res = await post({ session_id: s.id, t: 6, frame: FRAME });
    expect(await res.json()).toEqual({ events: [], skipped: "off_record" });
    expect(describeFrame).not.toHaveBeenCalled();
    expect(saveFrame).not.toHaveBeenCalled();
    expect(frameLines()).toEqual([]);
  });

  it("stores one frame for a key plus routine batch", async () => {
    const s = await createSession({ kind: "capture" });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    describeFrame.mockResolvedValue({ events: [ev(1, "key"), ev(2, "routine")] });
    const res = await post({ session_id: s.id, t: 2, frame: FRAME });
    const body = await res.json();
    expect(saveFrame).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ events: [ev(1, "key"), ev(2, "routine")], frame_ref: "frames/0002.jpg" });
    expect(await onDisk(s.id, "0002.jpg")).toBe(true);
  });

  it.each([
    ["routine-only", [ev(1, "routine")]],
    ["unrated-only", [ev(1)]],
    ["zero-event", []],
  ])("%s reply: nothing stored, no frame_ref key", async (_name, events) => {
    const s = await createSession({ kind: "capture" });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    describeFrame.mockResolvedValue({ events });
    const res = await post({ session_id: s.id, t: 3, frame: FRAME });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(saveFrame).not.toHaveBeenCalled();
    expect("frame_ref" in body).toBe(false);
    expect(body).toEqual({ events });
    expect(await onDisk(s.id, "0003.jpg")).toBe(false);
  });

  it.each([
    ["key plus unrated", [ev(1, "key"), ev(2)], { key: 1, routine: 0, unrated: 1 }],
    ["key plus routine plus unrated", [ev(1, "key"), ev(2, "routine"), ev(3)], { key: 1, routine: 1, unrated: 1 }],
  ])("%s: stored with an info line carrying the counts", async (_name, events, counts) => {
    const s = await createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events });
    const res = await post({ session_id: s.id, t: 4, frame: FRAME });
    expect(await res.json()).toEqual({ events, frame_ref: "frames/0004.jpg" });
    expect(await onDisk(s.id, "0004.jpg")).toBe(true);
    const lines = frameLines();
    expect(lines).toEqual([{ level: "info", fields: { ...counts, stored: true, model: "called" } }]);
    expect(JSON.stringify(lines)).not.toContain("secret summary");
  });

  it.each([
    ["routine-only", [ev(1, "routine")]],
    ["key", [ev(1, "key")]],
  ])("off-record opened during the model call, %s reply: skipped, nothing stored", async (name, events) => {
    const s = await createSession({ kind: "capture" });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    describeFrame.mockImplementation(async () => {
      await fileStore.setOffRecord(s.id, { from: 0 });
      return { events };
    });
    const res = await post({ session_id: s.id, t: 7, frame: FRAME });
    expect(await res.json()).toEqual({ events: [], skipped: "off_record" });
    if (name === "routine-only") expect(saveFrame).not.toHaveBeenCalled();
    expect(await onDisk(s.id, "0007.jpg")).toBe(false);
  });

  it("no API key: 200 empty events, nothing stored, warn line no_api_key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const s = await createSession({ kind: "capture" });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    const res = await post({ session_id: s.id, t: 8, frame: FRAME });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ events: [] });
    expect("frame_ref" in body).toBe(false);
    expect(saveFrame).not.toHaveBeenCalled();
    expect(describeFrame).not.toHaveBeenCalled();
    expect(frameLines()).toEqual([
      { level: "warn", fields: { key: 0, routine: 0, unrated: 0, stored: false, model: "no_api_key" } },
    ]);
  });

  it("STORE_ALL_FRAMES=1 stores before the model call, even for an unrated reply", async () => {
    vi.stubEnv("STORE_ALL_FRAMES", "1");
    const s = await createSession({ kind: "capture" });
    const saveFrame = vi.spyOn(fileStore, "saveFrame");
    const frameAllowed = vi.spyOn(fileStore, "frameAllowed");
    describeFrame.mockResolvedValue({ events: [ev(1)] });
    const res = await post({ session_id: s.id, t: 9, frame: FRAME });
    expect(await res.json()).toEqual({ events: [ev(1)], frame_ref: "frames/0009.jpg" });
    expect(saveFrame.mock.invocationCallOrder[0]).toBeLessThan(describeFrame.mock.invocationCallOrder[0]);
    expect(frameAllowed).not.toHaveBeenCalled();
    expect(await onDisk(s.id, "0009.jpg")).toBe(true);
  });

  it("STORE_ALL_FRAMES=1 without an API key stores the frame with an info line", async () => {
    vi.stubEnv("STORE_ALL_FRAMES", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const s = await createSession({ kind: "capture" });
    const res = await post({ session_id: s.id, t: 10, frame: FRAME });
    expect(await res.json()).toEqual({ events: [], frame_ref: "frames/0010.jpg" });
    expect(await onDisk(s.id, "0010.jpg")).toBe(true);
    expect(describeFrame).not.toHaveBeenCalled();
    const lines = frameLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", fields: { stored: true } });
  });

  it("STORE_ALL_FRAMES=1 with saveFrame rejecting: 500, no model call, warn save_failed", async () => {
    vi.stubEnv("STORE_ALL_FRAMES", "1");
    const s = await createSession({ kind: "capture" });
    vi.spyOn(fileStore, "saveFrame").mockRejectedValueOnce(new Error("boom"));
    await status500(post({ session_id: s.id, t: 11, frame: FRAME }));
    expect(describeFrame).not.toHaveBeenCalled();
    expect(frameLines()).toEqual([
      {
        level: "warn",
        fields: { key: 0, routine: 0, unrated: 0, stored: false, model: "not_called", error: "save_failed" },
      },
    ]);
  });

  it("saveFrame rejecting at the key-moment save: 500, warn save_failed", async () => {
    const s = await createSession({ kind: "capture" });
    vi.spyOn(fileStore, "saveFrame").mockRejectedValueOnce(new Error("boom"));
    describeFrame.mockResolvedValue({ events: [ev(1, "key")] });
    await status500(post({ session_id: s.id, t: 12, frame: FRAME }));
    expect(describeFrame).toHaveBeenCalledTimes(1);
    expect(frameLines()).toEqual([
      { level: "warn", fields: { key: 1, routine: 0, unrated: 0, stored: false, model: "called", error: "save_failed" } },
    ]);
  });

  it("frameAllowed rejecting at request time: 500, no model call, warn check_failed with zero counts", async () => {
    const s = await createSession({ kind: "capture" });
    vi.spyOn(fileStore, "frameAllowed").mockRejectedValueOnce(new Error("boom"));
    await status500(post({ session_id: s.id, t: 13, frame: FRAME }));
    expect(describeFrame).not.toHaveBeenCalled();
    expect(frameLines()).toEqual([
      {
        level: "warn",
        fields: { key: 0, routine: 0, unrated: 0, stored: false, model: "not_called", error: "check_failed" },
      },
    ]);
  });

  it("frameAllowed rejecting at the recheck: 500, model called once, warn check_failed", async () => {
    const s = await createSession({ kind: "capture" });
    vi.spyOn(fileStore, "frameAllowed")
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("boom"));
    describeFrame.mockResolvedValue({ events: [ev(1, "routine")] });
    await status500(post({ session_id: s.id, t: 14, frame: FRAME }));
    expect(describeFrame).toHaveBeenCalledTimes(1);
    expect(frameLines()).toEqual([
      { level: "warn", fields: { key: 0, routine: 1, unrated: 0, stored: false, model: "called", error: "check_failed" } },
    ]);
  });

  it("describeFrame error: 502 unchanged, nothing on disk, no line", async () => {
    const s = await createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [ev(1, "key")], error: "upstream_500" });
    const res = await post({ session_id: s.id, t: 15, frame: FRAME });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "vision_upstream", detail: "upstream_500" });
    expect(await onDisk(s.id, "0015.jpg")).toBe(false);
    expect(frameLines()).toEqual([]);
  });

  it("describeFrame throwing: 500, nothing on disk, no line", async () => {
    const s = await createSession({ kind: "capture" });
    describeFrame.mockRejectedValue(new Error("boom"));
    await status500(post({ session_id: s.id, t: 16, frame: FRAME }));
    expect(await onDisk(s.id, "0016.jpg")).toBe(false);
    expect(frameLines()).toEqual([]);
  });

  it("all-unrated reply: warn line with key 0, routine 0, unrated count, stored false", async () => {
    const s = await createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [ev(1), ev(2), ev(3)] });
    await post({ session_id: s.id, t: 17, frame: FRAME });
    expect(frameLines()).toEqual([
      { level: "warn", fields: { key: 0, routine: 0, unrated: 3, stored: false, model: "called" } },
    ]);
  });
});
