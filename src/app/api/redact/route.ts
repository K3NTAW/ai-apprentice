import { z } from "zod";
import { redactTextAsync } from "@/lib/redact";
import { requireContext } from "@/lib/auth/context";

export const runtime = "nodejs";

const Body = z.object({ text: z.string() });

export async function POST(req: Request) {
  // Signed-in member of a workspace only (401 signed out, 503 misconfigured).
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid body", details: parsed.error.issues }, { status: 400 });
  return Response.json(await redactTextAsync(parsed.data.text));
}
