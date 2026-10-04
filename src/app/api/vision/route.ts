// POST /api/vision: store one frame, then ask the vision model for new events.
// Frames inside an off-record range are neither stored nor sent to the model.
import { ScreenEventSchema, type VisionEvent } from "@/lib/types";
import { MAX_FRAME_BODY_BYTES } from "@/lib/perception/frame";
import { redactScreenEvent } from "@/lib/perception/redactEvent";
import { describeFrame } from "@/lib/perception/vision";
import { consumeUsage } from "@/lib/usage";
import { type Api, requireCreatorOrOwner, withMutation } from "../session/_http";

export const runtime = "nodejs";
// Vercel function limit: 60 s fits the plan (model calls can take tens of seconds).
export const maxDuration = 60;

const SESSION_ID = /^[a-zA-Z0-9_-]+$/;

// Request bodies over 2 MB answer 413 before any model or storage call (Vercel caps bodies at 4.5 MB).
// The client keeps frames under it: 1600 px wide at quality 0.7, one retry at 0.5 (lib/perception/frame).
export { MAX_FRAME_BODY_BYTES };

const tooLarge = () => Response.json({ error: "frame_too_large" }, { status: 413 });

function bad(error: string) {
  return Response.json({ error }, { status: 400 });
}

// Order: requireContext, the daily vision cap (one per frame, 429 daily_limit), validate the body, creator-or-owner, then saveFrame through the workspace store
// (Storage in supabase mode, no local disk). SessionNotFoundError answers 404 via handle().
export async function POST(req: Request): Promise<Response> {
  return withMutation(["sessions"], (api) => visionFor(api, req));
}

async function visionFor(api: Api, req: Request): Promise<Response> {
  const usage = await consumeUsage(api.ctx, "vision");
  if (usage instanceof Response) return usage;
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FRAME_BODY_BYTES) return tooLarge();
  let text: string;
  try {
    text = await req.text();
  } catch {
    return bad("invalid json");
  }
  if (Buffer.byteLength(text) > MAX_FRAME_BODY_BYTES) return tooLarge();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return bad("invalid json");
  }
  const { session_id, t, frame, previous } = (body ?? {}) as Record<string, unknown>;
  if (typeof session_id !== "string" || !SESSION_ID.test(session_id)) return bad("invalid session_id");
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return bad("invalid t");
  if (typeof frame !== "string" || !frame) return bad("invalid frame");
  const prev = ScreenEventSchema.array().safeParse(previous ?? []);
  if (!prev.success) return bad("invalid previous");

  const denied = await requireCreatorOrOwner(api, session_id);
  if (denied) return denied;
  const jpegBase64 = frame.replace(/^data:image\/\w+;base64,/, "");
  const saved = await api.store.saveFrame(session_id, t, Buffer.from(jpegBase64, "base64"));
  if (!saved.stored) return Response.json({ events: [], skipped: saved.reason });

  const events: VisionEvent[] = process.env.ANTHROPIC_API_KEY
    ? await describeFrame({ jpegBase64, previousEvents: prev.data })
    : [];
  // Redact app, window, from and to before the client stores them (off-record frames never get here).
  return Response.json({ events: events.map(redactScreenEvent), frame_ref: `frames/${saved.name}` });
}
