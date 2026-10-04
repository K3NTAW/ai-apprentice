import { requireRole } from "@/lib/auth/context";
import { llmMatch } from "@/lib/processes/matchLlm";
import { saveFromSession, SessionNotConfirmedError, suggestForSession } from "@/lib/processes/server";
import { isValidSessionId } from "@/lib/store";
import { badRequest, parseBody, withApi, withMutation } from "../../session/_http";
import { SaveFromSessionBody } from "../_lib";

export const runtime = "nodejs";

// End of the debrief (slice c). 503 processes_unavailable until the migration is applied: the debrief then keeps
// the confirmed session as a legacy Work Map. 400 session_not_confirmed for a session without a confirmed Work Map.
async function notConfirmed(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SessionNotConfirmedError) return badRequest(err.code);
    throw err;
  }
}

// Any member. ?session_id=<id>: the match decision among the agent's processes ({ linked, match, candidates }).
export async function GET(req: Request) {
  return withApi(async ({ store }) => {
    const sessionId = new URL(req.url).searchParams.get("session_id");
    if (!sessionId || !isValidSessionId(sessionId)) return badRequest("invalid session_id");
    return notConfirmed(async () => Response.json(await suggestForSession(store, sessionId, llmMatch())));
  });
}

// Owner or expert. choice add (merge, 'extended'), replace ('replaced', old version kept) or new ('trained').
// preview: the merge's changes and conflicts without writing.
export async function POST(req: Request) {
  return withMutation(["agents", "sessions"], async ({ ctx, store }) => {
    const denied = requireRole(ctx, ["owner", "expert"]);
    if (denied) return denied;
    const body = await parseBody(req, SaveFromSessionBody);
    if (!body.ok) return body.res;
    return notConfirmed(async () => Response.json(await saveFromSession(store, body.data), { status: body.data.preview ? 200 : 201 }));
  });
}
