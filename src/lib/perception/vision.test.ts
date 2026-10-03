import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFrame } from "./vision";

function reply(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const textReply = (events: unknown) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ events }) }],
});

afterEach(() => vi.unstubAllEnvs());

describe("describeFrame", () => {
  it("sends the image block first and a json_schema output_config", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchImpl = reply(textReply([]));
    await describeFrame({ jpegBase64: "AAAA", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(600);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    const content = body.messages[0].content;
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    expect(content[1].type).toBe("text");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.format.schema.properties.events.items.properties.type.enum).toContain(
      "field_changed",
    );
  });

  it("parses a valid reply and accepts an upper-case type", async () => {
    const events = [
      { type: "RECORD_OPENED", entity: { kind: "invoice", id: "INV-7" } },
      { type: "field_changed", entity: { kind: "invoice", id: "INV-7" }, field: "amount", to: "5" },
    ];
    const out = await describeFrame({ jpegBase64: "AAAA", fetchImpl: reply(textReply(events)) });
    expect(out).toEqual([
      { type: "record_opened", entity: { kind: "invoice", id: "INV-7" } },
      { type: "field_changed", entity: { kind: "invoice", id: "INV-7" }, field: "amount", to: "5" },
    ]);
  });

  it("returns [] on refusal, HTTP error, invalid JSON, or a thrown fetch", async () => {
    expect(
      await describeFrame({ jpegBase64: "A", fetchImpl: reply({ stop_reason: "refusal", content: [] }) }),
    ).toEqual([]);
    expect(await describeFrame({ jpegBase64: "A", fetchImpl: reply({ error: "boom" }, 500) })).toEqual([]);
    expect(
      await describeFrame({
        jpegBase64: "A",
        fetchImpl: reply({ content: [{ type: "text", text: "not json" }] }),
      }),
    ).toEqual([]);
    expect(
      await describeFrame({ jpegBase64: "A", fetchImpl: reply(textReply([{ type: "bogus" }])) }),
    ).toEqual([]);
    const thrower = vi.fn(async () => {
      throw new Error("aborted");
    });
    expect(await describeFrame({ jpegBase64: "A", fetchImpl: thrower })).toEqual([]);
  });
});
