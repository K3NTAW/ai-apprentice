// POST /api/vision: store one frame, then ask the vision model for new events.
// Frames inside an off-record range are neither stored nor sent to the model.
import { ScreenEventSchema, type VisionEvent } from "@/lib/types";
import { describeFrame } from "@/lib/perception/vision";
import { type Api, requireCreatorOrOwner, withApi } from "../session/_http";

const SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function bad(error: string) {
  return Response.json({ error }, { status: 400 });
}

// Order: requireContext, validate the body, creator-or-owner, then saveFrame through the workspace store
// (Storage in supabase mode, no local disk). SessionNotFoundError answers 404 via handle().
export async function POST(req: Request): Promise<Response> {
  return withApi((api) => visionFor(api, req));
}

async function visionFor(api: Api, req: Request): Promise<Response> {
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

  const denied = await requireCreatorOrOwner(api, session_id);
  if (denied) return denied;
  const jpegBase64 = frame.replace(/^data:image\/\w+;base64,/, "");
  const saved = await api.store.saveFrame(session_id, t, Buffer.from(jpegBase64, "base64"));
  if (!saved.stored) return Response.json({ events: [], skipped: saved.reason });

  const events: VisionEvent[] = process.env.ANTHROPIC_API_KEY
    ? await describeFrame({ jpegBase64, previousEvents: prev.data })
    : [];
  return Response.json({ events, frame_ref: `frames/${saved.name}` });
}
