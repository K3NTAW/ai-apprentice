// POST /api/vision: ask the vision model for new events, then store the frame only for key moments.
// Frames inside an off-record range are neither stored nor sent to the model.
// STORE_ALL_FRAMES=1 (read per request) restores the old order: store every frame, then call the model.
import { ScreenEventSchema, type VisionEvent } from "@/lib/types";
import { MAX_FRAME_BODY_BYTES } from "@/lib/perception/frame";
import { redactScreenEvent } from "@/lib/perception/redactEvent";
import { describeFrame, type DescribeFrameResult } from "@/lib/perception/vision";
import { consumeUsage } from "@/lib/usage";
import { recordUsage } from "@/lib/usage/events";
import { type Api, requireCreatorOrOwner, withApi } from "../session/_http";
import { log } from "@/lib/log";

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
  return withApi({ route: "/api/vision", req }, (api) => visionFor(api, req));
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
  const data = () => Buffer.from(jpegBase64, "base64");
  const skipped = (reason: "off_record") => Response.json({ events: [], skipped: reason });
  // One vision usage event per answered model call, recorded before any early return; none when describe rejects.
  const describe = async (): Promise<DescribeFrameResult> => {
    const result = await describeFrame({ jpegBase64, previousEvents: prev.data });
    if (result.usage) recordUsage(api.ctx, { kind: "vision", ...result.usage, session_id });
    return result;
  };
  // One frame event per stored frame, only after saveFrame succeeded.
  const frameStored = () => recordUsage(api.ctx, { kind: "frame", bytes: Buffer.byteLength(jpegBase64, "base64"), session_id });

  if (process.env.STORE_ALL_FRAMES === "1") {
    const saved = await guarded(() => api.store.saveFrame(session_id, t, data()), NO_COUNTS, "not_called", "save_failed");
    if (!saved.stored) {
      frameLine(NO_COUNTS, false, "not_called");
      return skipped(saved.reason);
    }
    frameStored();
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const result = hasKey ? await describe() : { events: [] };
    if (result.error) return upstreamFailed(result.error);
    const events: VisionEvent[] = result.events;
    frameLine(countImportance(events), true, hasKey ? "called" : "not_called");
    return Response.json({ events: events.map(redactScreenEvent), frame_ref: `frames/${saved.name}` });
  }

  const allowed = await guarded(() => api.store.frameAllowed(session_id, t), NO_COUNTS, "not_called", "check_failed");
  if (!allowed.ok) return skipped(allowed.reason);

  if (!process.env.ANTHROPIC_API_KEY) {
    frameLine(NO_COUNTS, false, "no_api_key");
    return Response.json({ events: [] });
  }

  const result = await describe();
  if (result.error) return upstreamFailed(result.error);
  const events: VisionEvent[] = result.events;
  const counts = countImportance(events);

  if (counts.key >= 1) {
    const saved = await guarded(() => api.store.saveFrame(session_id, t, data()), counts, "called", "save_failed");
    frameLine(counts, saved.stored, "called");
    if (!saved.stored) return skipped(saved.reason);
    frameStored();
    // Redact app, window, from and to before the client stores them (off-record frames never get here).
    return Response.json({ events: events.map(redactScreenEvent), frame_ref: `frames/${saved.name}` });
  }

  // No key event: nothing is stored. Recheck off-record (best effort) for a range opened during the model call.
  const still = await guarded(() => api.store.frameAllowed(session_id, t), counts, "called", "check_failed");
  frameLine(counts, false, "called");
  if (!still.ok) return skipped(still.reason);
  return Response.json({ events: events.map(redactScreenEvent) });
}

// Upstream model errors answer 502, never 429: a 429 means our daily cap and makes the client stop vision for the day.
function upstreamFailed(error: string): Response {
  log.warn("vision: upstream failed", { error });
  return Response.json({ error: "vision_upstream", detail: error }, { status: 502 });
}

type Counts = { key: number; routine: number; unrated: number };
type Model = "called" | "no_api_key" | "not_called";
type FrameError = "check_failed" | "save_failed";

const NO_COUNTS: Counts = { key: 0, routine: 0, unrated: 0 };

function countImportance(events: VisionEvent[]): Counts {
  const counts = { ...NO_COUNTS };
  for (const e of events) {
    if (e.importance === "key") counts.key++;
    else if (e.importance === "routine") counts.routine++;
    else counts.unrated++;
  }
  return counts;
}

// One vision.frame line per decided frame: counts and flags only, never event text.
// Warn when there is no API key, on a store error, or when every event lacks importance (prompt or schema regression).
function frameLine(counts: Counts, stored: boolean, model: Model, error?: FrameError): void {
  const allUnrated = counts.unrated > 0 && counts.key === 0 && counts.routine === 0;
  const fields = { ...counts, stored, model, ...(error ? { error } : {}) };
  if (model === "no_api_key" || error || allUnrated) log.warn("vision.frame", fields);
  else log.info("vision.frame", fields);
}

// A store throw writes the warn line, then rethrows so withApi answers as before (500, or 404 via handle()).
async function guarded<T>(op: () => Promise<T>, counts: Counts, model: Model, error: FrameError): Promise<T> {
  try {
    return await op();
  } catch (err) {
    frameLine(counts, false, model, error);
    throw err;
  }
}
