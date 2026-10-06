// Unauthenticated liveness check for uptime monitors. No session, no store: answers {ok: true} or nothing.
import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/log";

export const runtime = "nodejs";

export const GET = withRequestLog("/api/health", () =>
  NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }),
);
