// session.state.agent (protocol v3): the session's agent with its eight avatar states as data URLs.
// Any failure omits the block; there is no default avatar.
import { AVATAR_STATES, type Agent, type AvatarState } from "@/lib/types";
import { renderAvatarSet, MAX_DATA_URL_BYTES } from "@/lib/avatar/render";

export const AVATAR_URL_PREFIX = "data:image/svg+xml;base64,";
const NAME_MAX = 60;
const ROLE_MAX = 80;

export type SessionAgent = { id: string; name: string; role: string; avatar: Record<AvatarState, string> };

/** All eight states present, each an SVG base64 data URL of at most 100 KB. */
export function validAvatarUrls(avatar: unknown): avatar is Record<AvatarState, string> {
  if (!avatar || typeof avatar !== "object") return false;
  const a = avatar as Record<string, unknown>;
  return AVATAR_STATES.every((s) => {
    const v = a[s];
    return typeof v === "string" && v.startsWith(AVATAR_URL_PREFIX) && v.length <= MAX_DATA_URL_BYTES;
  });
}

export function validSessionAgent(a: unknown): a is SessionAgent {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  return typeof x.id === "string" && !!x.id && typeof x.name === "string" && typeof x.role === "string" && validAvatarUrls(x.avatar);
}

let warned = false;
const warnOnce = (msg: string) => {
  if (warned) return;
  warned = true;
  console.warn(`companion: ${msg}; session.state goes out without an agent`);
};

/** Renders the eight avatar states for the agent. Null (logged once) when the agent is missing or rendering fails. */
export function buildSessionAgent(
  agent: Pick<Agent, "id" | "name" | "role" | "avatar"> | null | undefined,
  render: typeof renderAvatarSet = renderAvatarSet,
): SessionAgent | null {
  if (!agent) return null;
  try {
    const avatar = render(agent.avatar);
    if (!validAvatarUrls(avatar)) throw new Error("avatar data URLs invalid");
    return { id: agent.id, name: agent.name.slice(0, NAME_MAX), role: agent.role.slice(0, ROLE_MAX), avatar };
  } catch (err) {
    warnOnce(`avatar render failed (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
