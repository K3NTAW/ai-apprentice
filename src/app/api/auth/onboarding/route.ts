// Onboarding progress (T-0211). GET: the current state. POST { step, mark, agentId? }: marks one step done or skipped;
// onboarding_completed_at is set once every step is marked. Supabase: user_metadata through auth.updateUser on the
// session client (the fresh context read the current metadata with getUser). Local mode: <DATA_DIR>/onboarding.json.
// A failed write answers 500 save_failed; the page shows it and moves on, so nothing ever traps the user.
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { readLocalOnboarding, writeLocalOnboarding } from "@/lib/onboarding/file";
import { emptyState, markStep, ONBOARDING_STEPS, toMetadata, type OnboardingState } from "@/lib/onboarding/state";

export const runtime = "nodejs";

const Body = z.object({
  step: z.enum(ONBOARDING_STEPS),
  mark: z.enum(["done", "skipped"]),
  agentId: z.string().min(1).max(64).nullish(),
});

export async function GET(): Promise<Response> {
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  const state = ctx.mode === "local" ? await readLocalOnboarding() : (ctx.onboarding ?? emptyState());
  return Response.json({ state });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  let parsed: z.infer<typeof Body>;
  try {
    const r = Body.safeParse(await req.json());
    if (!r.success) return Response.json({ error: "invalid_input" }, { status: 400 });
    parsed = r.data;
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const now = new Date().toISOString();
  try {
    let state: OnboardingState;
    if (ctx.mode === "local" || !ctx.supabase) {
      state = markStep(await readLocalOnboarding(), parsed.step, parsed.mark, now, parsed.agentId);
      await writeLocalOnboarding(state);
    } else {
      state = markStep(ctx.onboarding ?? emptyState(), parsed.step, parsed.mark, now, parsed.agentId);
      const { error } = await ctx.supabase.auth.updateUser({ data: toMetadata(state) });
      if (error) {
        console.error("onboarding updateUser:", error.message);
        return Response.json({ error: "save_failed" }, { status: 500 });
      }
    }
    return Response.json({ state });
  } catch (e) {
    console.error("onboarding save:", e instanceof Error ? e.message : String(e));
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
