// Active workspace cookie. The value is a workspace uuid and is only trusted after
// it has been compared with the user's memberships (see context.ts).
export const WS_COOKIE = "ws";

export function wsCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
