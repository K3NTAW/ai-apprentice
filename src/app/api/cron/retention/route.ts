// Daily frame retention (vercel.json crons, 03:00 UTC). Not a user route: the proxy lets every /api path through
// without a session (src/proxy.ts) and this handler checks the bearer itself.
// Authorization: Bearer <CRON_SECRET>, compared in constant time. Fails closed: with CRON_SECRET unset or shorter
// than 16 characters no bearer is accepted. Without a valid bearer the request is handled like any user route
// (requireContext: 401 signed out, 403 no workspace, 503 misconfigured) and a signed-in user still gets 401.
// Work: src/lib/agents/admin.ts runRetention with the service role (idempotent, at most RETENTION_BATCH frames
// per run, Storage objects before rows). Then the empty capture runs that ended 24 h ago or more
// (src/lib/capture/emptyPurge.ts, at most EMPTY_PURGE_BATCH per run); the answer adds empty_purged. Then capture
// sessions idle for more than 2 h are ended (endIdleCaptures), so they stop showing 'live' in the sidebar; the answer
// adds ended_captures.
// The three run independently: any may fail (error / empty_error / idle_error in the answer, 502, or 503 for
// settings) and the others still run and report their result.
import {
  endIdleCaptures,
  fileDataPort,
  fileIdleCapturePort,
  runRetention,
  SettingsUnavailableError,
  supabaseIdleCapturePort,
  supabaseRetentionPort,
  validCronBearer,
} from "@/lib/agents/admin";
import { requireContext } from "@/lib/auth/context";
import { fileEmptyPurgePort, purgeEmptySessions, supabaseEmptyPurgePort } from "@/lib/capture/emptyPurge";
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
  const now = Date.now();
  let db: ReturnType<typeof createSupabaseAdminClient> | null = null;
  try {
    db = mode === "local" ? null : createSupabaseAdminClient();
  } catch (err) {
    console.error("cron retention:", message(err));
    return Response.json({ error: "retention_failed", empty_error: "empty_purge_failed", idle_error: "end_idle_failed" }, { status: 502 });
  }
  // Three independent jobs: a failure in one never skips the others, and the answer reports all three.
  let status = 200;
  let retention: Record<string, unknown>;
  try {
    retention = { ...(await runRetention(db ? supabaseRetentionPort(db) : fileDataPort(), now)) };
  } catch (err) {
    console.error("cron retention:", message(err));
    if (err instanceof SettingsUnavailableError) {
      retention = { error: err.code, message: err.message };
      status = 503;
    } else {
      retention = { error: "retention_failed" };
      status = 502;
    }
  }
  let empty: Record<string, unknown>;
  try {
    empty = { empty_purged: (await purgeEmptySessions(db ? supabaseEmptyPurgePort(db) : fileEmptyPurgePort(), now)).purged };
  } catch (err) {
    console.error("cron empty purge:", message(err));
    empty = { empty_error: "empty_purge_failed" };
    if (status === 200) status = 502;
  }
  let idle: Record<string, unknown>;
  try {
    idle = { ended_captures: (await endIdleCaptures(db ? supabaseIdleCapturePort(db) : fileIdleCapturePort(), now)).ended };
  } catch (err) {
    console.error("cron end idle captures:", message(err));
    idle = { idle_error: "end_idle_failed" };
    if (status === 200) status = 502;
  }
  return Response.json({ ...retention, ...empty, ...idle }, { status });
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
