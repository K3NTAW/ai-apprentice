import { describe, expect, it, vi } from "vitest";
import { checkTeachSource, teachSessionBody } from "@/components/teach/agentSource";
import { AgentNotFound, createAgentCaptureSession } from "./agentSession";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("capture with ?agent", () => {
  it("creates the capture session with agent_id", async () => {
    const fetcher = vi.fn(async () => json(201, { id: "s1" }));
    expect(await createAgentCaptureSession("Sabine", "agent-a", fetcher as unknown as typeof fetch)).toBe("s1");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/session");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "capture", expert: "Sabine", agent_id: "agent-a" });
  });

  it("an unknown agent (404) throws AgentNotFound instead of falling back", async () => {
    const fetcher = vi.fn(async () => json(404, { error: "agent not found" }));
    await expect(createAgentCaptureSession("Sabine", "nope", fetcher as unknown as typeof fetch)).rejects.toBeInstanceOf(AgentNotFound);
  });
});

describe("teach with ?agent and ?session", () => {
  it("teach session body carries agent_id only with an agent", () => {
    expect(teachSessionBody("agent-a")).toEqual({ kind: "teach", agent_id: "agent-a" });
    expect(teachSessionBody(null)).toEqual({ kind: "teach" });
  });

  it("checks that the Work Map session belongs to the agent", async () => {
    const session = { kind: "capture", agent_id: "agent-a", workmap: { steps: [] } };
    const ok = vi.fn(async () => json(200, session)) as unknown as typeof fetch;
    expect(await checkTeachSource("agent-a", "cap-1", ok)).toBeNull();
    expect(await checkTeachSource("agent-b", "cap-1", ok)).toMatch(/different agent/);
    const missing = vi.fn(async () => json(404, {})) as unknown as typeof fetch;
    expect(await checkTeachSource("agent-a", "cap-x", missing)).toMatch(/not found/);
  });
});
