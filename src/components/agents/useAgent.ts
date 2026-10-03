"use client";
// Loads the agent named by ?agent=<id> for Capture and Teach headers. An unknown agent (404) or a malformed id is
// 'missing': the pages then show an error and never fall back to an agentless session.
import { useEffect, useState } from "react";
import type { Agent } from "@/lib/types";
import { parseId } from "./model";

export type AgentLoad =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; agent: Agent }
  | { status: "missing" }
  | { status: "error" };

export async function fetchAgent(id: string, fetcher: typeof fetch = fetch): Promise<AgentLoad> {
  try {
    const res = await fetcher(`/api/agents/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return { status: "missing" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", agent: (await res.json()) as Agent };
  } catch {
    return { status: "error" };
  }
}

export function useAgent(param: string | null): AgentLoad {
  const id = parseId(param);
  const [load, setLoad] = useState<AgentLoad>(param === null ? { status: "none" } : id ? { status: "loading" } : { status: "missing" });
  useEffect(() => {
    if (!id) return;
    let live = true;
    void fetchAgent(id).then((l) => live && setLoad(l));
    return () => {
      live = false;
    };
  }, [id]);
  return load;
}

/** Why a session may not start yet for this agent load, or null when it may. */
export function agentBlocker(load: AgentLoad): string | null {
  if (load.status === "missing") return "This agent was not found in your workspace. Open it again from Agents.";
  if (load.status === "error") return "The agent could not be loaded. Reload the page to try again.";
  if (load.status === "loading") return "Loading the agent.";
  return null;
}
