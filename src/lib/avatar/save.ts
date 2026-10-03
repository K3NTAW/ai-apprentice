// Saving an avatar sits behind an interface so the studio works before PATCH /api/agents/[id] exists.
import type { Avatar } from "./render";

export interface AvatarSaver {
  save(agentId: string, avatar: Avatar): Promise<void>;
}

export function httpAvatarSaver(fetchImpl: typeof fetch = (...args) => fetch(...args)): AvatarSaver {
  return {
    async save(agentId, avatar) {
      const res = await fetchImpl(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
    },
  };
}
