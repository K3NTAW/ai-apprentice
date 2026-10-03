import { z } from "zod";
import { redactTextAsync } from "@/lib/redact";

const Body = z.object({ text: z.string() });

export async function POST(req: Request) {
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
