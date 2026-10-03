import { decideMany } from "@/lib/decide";
import { DECISION_QUESTIONS, type DecisionQuestionName } from "@/lib/types";

export const runtime = "nodejs";

function isQuestion(q: unknown): q is DecisionQuestionName {
  return typeof q === "string" && Object.prototype.hasOwnProperty.call(DECISION_QUESTIONS, q);
}

export async function POST(req: Request): Promise<Response> {
  let body: { question?: unknown; questions?: unknown; state?: unknown };
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
  const results = await decideMany(asked as DecisionQuestionName[], body.state);
  return Response.json({ results });
}
