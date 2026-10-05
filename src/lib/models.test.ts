import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECIDE_MODEL_DEFAULT,
  FALLBACK_MODEL,
  isModelNotFound,
  resolveModel,
  sendWithModelFallback,
  VISION_MODEL_DEFAULT,
  WORKMAP_MODEL_DEFAULT,
} from "./models";

const notFound = () => new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model" } }), { status: 404 });
const ok = () => new Response("{}", { status: 200 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("models", () => {
  it("has the dated defaults and the fallback", () => {
    expect(VISION_MODEL_DEFAULT).toBe("claude-haiku-4-5-20251001");
    expect(DECIDE_MODEL_DEFAULT).toBe("claude-haiku-4-5-20251001");
    expect(WORKMAP_MODEL_DEFAULT).toBe("claude-opus-5-5");
    expect(FALLBACK_MODEL).toBe("claude-sonnet-5-5");
  });

  it("resolves from env, else the default", () => {
    expect(resolveModel("vision")).toBe(VISION_MODEL_DEFAULT);
    expect(resolveModel("decide")).toBe(DECIDE_MODEL_DEFAULT);
    expect(resolveModel("workmap")).toBe(WORKMAP_MODEL_DEFAULT);
    vi.stubEnv("VISION_MODEL", "claude-sonnet-5-5");
    vi.stubEnv("DECIDE_MODEL", "claude-sonnet-5-5");
    vi.stubEnv("WORKMAP_MODEL", "  ");
    expect(resolveModel("vision")).toBe("claude-sonnet-5-5");
    expect(resolveModel("decide")).toBe("claude-sonnet-5-5");
    expect(resolveModel("workmap")).toBe(WORKMAP_MODEL_DEFAULT);
  });

  it("detects only a 404 not_found_error", async () => {
    expect(await isModelNotFound(notFound())).toBe(true);
    expect(await isModelNotFound(new Response(JSON.stringify({ error: { type: "not_found_error" } }), { status: 400 }))).toBe(false);
    expect(await isModelNotFound(new Response("nope", { status: 404 }))).toBe(false);
  });

  it("retries once with FALLBACK_MODEL and returns the second failure as is", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent: string[] = [];
    const res = await sendWithModelFallback("decide", async (m) => (sent.push(m), notFound()));
    expect(res.status).toBe(404);
    expect(sent).toEqual([DECIDE_MODEL_DEFAULT, FALLBACK_MODEL]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the model already is FALLBACK_MODEL or the reply is fine", async () => {
    vi.stubEnv("VISION_MODEL", FALLBACK_MODEL);
    const sent: string[] = [];
    await sendWithModelFallback("vision", async (m) => (sent.push(m), notFound()));
    await sendWithModelFallback("decide", async (m) => (sent.push(m), ok()));
    expect(sent).toEqual([FALLBACK_MODEL, DECIDE_MODEL_DEFAULT]);
  });
});
