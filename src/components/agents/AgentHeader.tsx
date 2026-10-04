// Agent strip above Capture and Teach: the agent's avatar and name, or the error when ?agent is unknown.
import AgentAvatar from "./AgentAvatar";
import { agentBlocker, type AgentLoad } from "./useAgent";
import type { AvatarState } from "@/lib/avatar/render";

export default function AgentHeader({ load, state = "idle", verb }: { load: AgentLoad; state?: AvatarState; verb: string }) {
  if (load.status === "none") return null;
  if (load.status !== "ok")
    return (
      <div role={load.status === "loading" ? "status" : "alert"} className="border-b border-line px-4 py-2 text-sm text-red-500">
        {agentBlocker(load)}
      </div>
    );
  const { agent } = load;
  return (
    <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 text-sm">
      <AgentAvatar avatar={agent.avatar} state={state} size={40} />
      <span className="flex flex-col">
        <span className="font-semibold">{agent.name}</span>
        <span className="text-xs text-muted">
          {agent.role} · {verb}
        </span>
      </span>
    </div>
  );
}
