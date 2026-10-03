// POST /api/vision: store one frame, then ask the vision model for new events.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ScreenEventSchema, type VisionEvent } from "@/lib/types";
import { describeFrame } from "@/lib/perception/vision";

const SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function bad(error: string) {
  return Response.json({ error }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("invalid json");
  }
  const { session_id, t, frame, previous } = (body ?? {}) as Record<string, unknown>;
  if (typeof session_id !== "string" || !SESSION_ID.test(session_id)) return bad("invalid session_id");
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return bad("invalid t");
  if (typeof frame !== "string" || !frame) return bad("invalid frame");
  const prev = ScreenEventSchema.array().safeParse(previous ?? []);
  if (!prev.success) return bad("invalid previous");

  const jpegBase64 = frame.replace(/^data:image\/\w+;base64,/, "");
  const name = `${String(Math.floor(t)).padStart(4, "0")}.jpg`;
  const dir = path.join(process.cwd(), "data", "sessions", session_id, "frames");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(jpegBase64, "base64"));

  const events: VisionEvent[] = process.env.ANTHROPIC_API_KEY
    ? await describeFrame({ jpegBase64, previousEvents: prev.data })
    : [];
  return Response.json({ events, frame_ref: `frames/${name}` });
}
