// POST /api/vision usage events per branch: one vision event per answered model call (recorded before any early return),
// one frame event only after saveFrame succeeded, nothing when describeFrame rejects. Local file store, describeFrame mocked.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/vision/route";
import { FALLBACK_MODEL, resolveModel } from "@/lib/models";
import { fileStore } from "@/lib/store";

const describeFrame = vi.hoisted(() => vi.fn());
const recordUsage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/perception/vision", () => ({ describeFrame }));
vi.mock("@/lib/usage/events", () => ({ recordUsage }));

const FRAME_B64 = "/9j/4AAQSkZJRg==";
const FRAME = `data:image/jpeg;base64,${FRAME_B64}`;
const BYTES = Buffer.byteLength(FRAME_B64, "base64");
const usage = { model: "claude-haiku-4-5-20251001", input_tokens: 1500, output_tokens: 40, cache_read_tokens: 0 };
const ev = (importance: "key" | "routine") => ({ t: 1, type: "screen_changed", summary: "s", importance });

const post = (session_id: string, t: number) =>
  POST(
    new Request("http://localhost/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id, t, frame: FRAME }),
    }),
  );
const kinds = () => recordUsage.mock.calls.map((c) => c[1].kind);

let dir: string;
const prevDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "apprentice-vision-usage-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  describeFrame.mockReset();
  recordUsage.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/vision usage events", () => {
  it("key event stored: vision then frame", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [ev("key")], usage });
    const res = await post(s.id, 3);
    expect(res.status).toBe(200);
    expect(kinds()).toEqual(["vision", "frame"]);
    expect(recordUsage.mock.calls[0][1]).toEqual({ kind: "vision", ...usage, session_id: s.id });
    expect(recordUsage.mock.calls[1][1]).toEqual({ kind: "frame", bytes: BYTES, session_id: s.id });
  });

  it("routine only, not stored: vision only", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [ev("routine")], usage });
    const res = await post(s.id, 4);
    expect(await res.json()).not.toHaveProperty("frame_ref");
    expect(kinds()).toEqual(["vision"]);
  });

  it("off-record opened during the model call: vision is still recorded", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockImplementation(async () => {
      await fileStore.setOffRecord(s.id, { from: 0 });
      return { events: [ev("routine")], usage };
    });
    const res = await post(s.id, 5);
    expect(await res.json()).toEqual({ events: [], skipped: "off_record" });
    expect(kinds()).toEqual(["vision"]);
  });

  it("STORE_ALL_FRAMES=1: frame and vision", async () => {
    vi.stubEnv("STORE_ALL_FRAMES", "1");
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [ev("routine")], usage });
    const res = await post(s.id, 6);
    expect(res.status).toBe(200);
    expect(kinds().sort()).toEqual(["frame", "vision"]);
  });

  it("saveFrame throws: vision only", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [ev("key")], usage });
    vi.spyOn(fileStore, "saveFrame").mockRejectedValue(new Error("boom"));
    await expect(post(s.id, 7)).rejects.toThrow("boom");
    expect(kinds()).toEqual(["vision"]);
  });

  it("describeFrame rejects: nothing", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockRejectedValue(new Error("down"));
    await expect(post(s.id, 8)).rejects.toThrow("down");
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("upstream failure without usage: nothing", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    describeFrame.mockResolvedValue({ events: [], error: "upstream_500" });
    expect((await post(s.id, 9)).status).toBe(502);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("records the model of the response (fallback) while resolveModel gives the default", async () => {
    const s = await fileStore.createSession({ kind: "capture" });
    expect(resolveModel("vision")).not.toBe(FALLBACK_MODEL);
    describeFrame.mockResolvedValue({ events: [ev("routine")], usage: { ...usage, model: FALLBACK_MODEL } });
    await post(s.id, 10);
    expect(recordUsage.mock.calls[0][1].model).toBe(FALLBACK_MODEL);
  });
});
