// Fixture, preview and __audit routes are local-mode dev tools: off in production builds and in Supabase mode,
// where every preview page answers notFound() (T-0289).
import { appMode } from "@/lib/supabase/env";

export function fixturesEnabled(): boolean {
  return appMode() === "local" && process.env.NODE_ENV !== "production";
}
