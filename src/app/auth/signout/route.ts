import { NextResponse, type NextRequest } from "next/server";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { appMode } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest): Promise<Response> {
  if (appMode() === "supabase") {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) console.error("signout:", error.message);
    } catch (err) {
      console.error("signout:", err instanceof Error ? err.message : "unknown error");
    }
  }
  const res = NextResponse.redirect(new URL("/", new URL(request.url).origin), 303);
  res.cookies.set(WS_COOKIE, "", { ...wsCookieOptions(), maxAge: 0 });
  return res;
}
