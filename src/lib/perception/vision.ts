// Server-side vision call: one frame -> new VisionEvents. Best effort; DOM is ground truth.
import { VisionResultSchema, type ScreenEvent, type VisionEvent } from "@/lib/types";

export const VISION_TIMEOUT_MS = 10_000;
const API_URL = "https://api.anthropic.com/v1/messages";
const EVENT_TYPES = ["record_opened", "field_changed", "button_clicked", "status_changed"];

export const VISION_SYSTEM_PROMPT =
  "You watch an accounts-payable ERP screen. Emit only events that are new compared with the " +
  "previous events listed. Never invent ids or values: use only what is readable on screen. " +
  "Return an empty list when nothing changed.";

const str = { type: "string" } as const;

export const VISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: EVENT_TYPES },
          entity: {
            type: "object",
            properties: { kind: str, id: str },
            required: ["kind", "id"],
            additionalProperties: false,
          },
          field: str,
          from: str,
          to: str,
        },
        required: ["type", "entity"],
        additionalProperties: false,
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
} as const;

export type DescribeFrameInput = {
  jpegBase64: string;
  mediaType?: string;
  previousEvents?: ScreenEvent[];
  fetchImpl?: typeof fetch;
};

function previousText(previous: ScreenEvent[]): string {
  if (!previous.length) return "Previous events: none.";
  const lines = previous.map((e) =>
    JSON.stringify({ type: e.type, entity: e.entity, field: e.field, from: e.from, to: e.to }),
  );
  return `Previous events:\n${lines.join("\n")}`;
}

export async function describeFrame({
  jpegBase64,
  mediaType = "image/jpeg",
  previousEvents = [],
  fetchImpl = fetch,
}: DescribeFrameInput): Promise<VisionEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetchImpl(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.VISION_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: VISION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: jpegBase64 } },
              { type: "text", text: `${previousText(previousEvents)}\nList the new events on this screen.` },
            ],
          },
        ],
        output_config: { format: { type: "json_schema", schema: VISION_JSON_SCHEMA } },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal") return [];
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) return [];
    const raw = JSON.parse(text) as { events?: unknown };
    if (Array.isArray(raw.events)) {
      raw.events = raw.events.map((e) =>
        e && typeof e === "object" && typeof (e as { type?: unknown }).type === "string"
          ? { ...e, type: (e as { type: string }).type.toLowerCase() }
          : e,
      );
    }
    const parsed = VisionResultSchema.safeParse(raw);
    return parsed.success ? parsed.data.events : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
