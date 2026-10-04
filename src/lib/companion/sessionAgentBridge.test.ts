// One app (bridge): session.state carries the session agent's eight avatar data URLs (Capture and Teach).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_STATES } from "@/lib/types";
import { AVATAR_URL_PREFIX, buildSessionAgent } from "./agentState";
import { createBridgeTransport, type ApprenticeBridge } from "./transport";

const agent = { id: "0b5c-1", name: "Pip", role: "Learning from Sabine", avatar: { shape: "bean", face: "robot", color: "#F4A261", accent: "#2A9D8F" } };

function bridge() {
  const sent: Record<string, unknown>[] = [];
  const handlers = new Map<string, (p: unknown) => void>();
  const b: ApprenticeBridge = { version: "1.0.0", platform: "darwin", on: (type, h) => (handlers.set(type, h), () => {}), send: (m) => void sent.push(m as Record<string, unknown>), window: () => {} };
  const status = () =>
    handlers.get("status")?.({ type: "status", version: "1.0.0", permissions: { accessibility: true, input: true, screen: true }, paused: false, protocol: 3 });
  return { b, sent, status };
}

describe("session.state over the bridge", () => {
  it("carries agent.avatar data URLs for every state of the session's agent", () => {
    const { b, sent, status } = bridge();
    const t = createBridgeTransport(b);
    t.connect();
    status();
    expect(t.status().status).toBe("paired");
    const sessionAgent = buildSessionAgent(agent as Parameters<typeof buildSessionAgent>[0]);
    expect(sessionAgent).not.toBeNull();
    t.sessionState({
      mode: "teach",
      title: "Quote",
      expert: "Sabine",
      asked: 0,
      guardrails: 0,
      last_question: "",
      last_answer: "",
      off_record: false,
      app_url: "https://app.example.com/teach",
      agent: sessionAgent!,
    });
    const msg = sent.find((m) => m.type === "session.state") as { agent?: { id: string; avatar: Record<string, string> } } | undefined;
    expect(msg?.agent?.id).toBe(agent.id);
    for (const s of AVATAR_STATES) expect(msg!.agent!.avatar[s].startsWith(AVATAR_URL_PREFIX)).toBe(true);
    t.dispose();
  });

  it("Teach sends the agent with session.state (the teach buddy draws its avatar)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/teach/TeachApp.tsx"), "utf8");
    expect(src).toMatch(/buildSessionAgent\(agentLoad\.agent\)/);
    const start = src.indexOf("companionRef.current?.sessionState({");
    expect(src.slice(start, src.indexOf("});", start))).toContain("...(sessionAgent ? { agent: sessionAgent } : {})");
  });
});
