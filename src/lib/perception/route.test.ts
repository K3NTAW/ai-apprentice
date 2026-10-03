import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/vision/route";
import { createSession, getSession, setOffRecord } from "@/lib/store";

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
    const event = { t: 25, type: "screen_changed", summary: "invoice list" };
    describeFrame.mockResolvedValue([event]);

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
