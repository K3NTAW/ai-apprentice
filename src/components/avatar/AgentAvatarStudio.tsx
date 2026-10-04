"use client";
// Studio wired to the HTTP saver (PATCH /api/agents/[id]); the saver cannot cross the server/client boundary as a prop.
import { useMemo } from "react";
import { httpAvatarSaver } from "@/lib/avatar/save";
import AvatarStudio from "./AvatarStudio";

export default function AgentAvatarStudio({ agentId }: { agentId: string }) {
  const saver = useMemo(() => httpAvatarSaver(), []);
  return <AvatarStudio agentId={agentId} saver={saver} page={{ backHref: `/agents/${agentId}`, backLabel: "Agent" }} />;
}
