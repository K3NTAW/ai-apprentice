import { decideMany } from "@/lib/decide";
import { DECISION_QUESTIONS, type DecisionQuestionName } from "@/lib/types";
import { requireContext } from "@/lib/auth/context";
import { consumeUsage } from "@/lib/usage";
import { recordUsage } from "@/lib/usage/events";
import { withRequestLog } from "@/lib/log";

export const runtime = "nodejs";
// Vercel function limit: 60 s fits the plan (model calls can take tens of seconds).
export const maxDuration = 60;

const SESSION_ID = /^[a-zA-Z0-9_-]{1,100}$/;

function isQuestion(q: unknown): q is DecisionQuestionName {
  return typeof q === "string" && Object.prototype.hasOwnProperty.call(DECISION_QUESTIONS, q);
}

async function handlePOST(req: Request): Promise<Response> {
  // Signed-in member of a workspace only (401 signed out, 503 misconfigured).
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  // Daily decide cap per workspace (429 daily_limit).
  const usage = await consumeUsage(ctx, "decide");
  if (usage instanceof Response) return usage;
  let body: { question?: unknown; questions?: unknown; state?: unknown; session_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const asked: unknown[] = [];
  if (body.question !== undefined) asked.push(body.question);
  if (Array.isArray(body.questions)) asked.push(...body.questions);
  else if (body.questions !== undefined) return Response.json({ error: "questions must be an array" }, { status: 400 });
  if (asked.length === 0) return Response.json({ error: "no question given" }, { status: 400 });
  const unknown = asked.filter((q) => !isQuestion(q));
  if (unknown.length) {
    return Response.json({ error: "unknown question", unknown }, { status: 400 });
  }
  // Optional: tags the usage event with the session when the client sends one.
  const session_id = typeof body.session_id === "string" && SESSION_ID.test(body.session_id) ? body.session_id : undefined;
  const results = await decideMany(asked as DecisionQuestionName[], body.state, {
    onUsage: (u) => recordUsage(ctx, { kind: "decide", ...u, session_id }),
  });
  return Response.json({ results });
}

export const POST = withRequestLog("/api/decide", handlePOST);
