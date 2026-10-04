// Daily frame retention (vercel.json crons, 03:00 UTC). Not a user route: the proxy lets every /api path through
// without a session (src/proxy.ts) and this handler checks the bearer itself.
// Authorization: Bearer <CRON_SECRET>, compared in constant time. Fails closed: with CRON_SECRET unset or shorter
// than 16 characters no bearer is accepted. Without a valid bearer the request is handled like any user route
// (requireContext: 401 signed out, 403 no workspace, 503 misconfigured) and a signed-in user still gets 401.
// Work: src/lib/agents/admin.ts runRetention with the service role (idempotent, at most RETENTION_BATCH frames
// per run, Storage objects before rows).
import { fileDataPort, runRetention, SettingsUnavailableError, supabaseRetentionPort, validCronBearer } from "@/lib/agents/admin";
import { requireContext } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appMode } from "@/lib/supabase/env";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!validCronBearer(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    const ctx = await requireContext();
    if (ctx instanceof Response) return ctx;
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const mode = appMode();
  if (mode === "misconfigured") return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  try {
    const port = mode === "local" ? fileDataPort() : supabaseRetentionPort(createSupabaseAdminClient());
    return Response.json(await runRetention(port, Date.now()));
  } catch (err) {
    if (err instanceof SettingsUnavailableError) return Response.json({ error: err.code, message: err.message }, { status: 503 });
    console.error("cron retention:", err instanceof Error ? err.message : String(err));
    return Response.json({ error: "retention_failed" }, { status: 502 });
  }
}
