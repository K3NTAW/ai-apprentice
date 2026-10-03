// Code login view-model (one-app D2), framework free: 'Email me a code' (signInWithOtp, the same email as the
// magic link; the template must include {{ .Token }}, see docs/DEPLOY.md), then the code goes to /auth/verify,
// which runs verifyOtp(type 'email') and the workspace bootstrap server side, and the page navigates to the
// returned safe path (default /agents).
// Supabase's OTP length is configurable (6 by default, up to 10), so 6 to 10 digits are accepted.

export const CODE_LOGIN_DEFAULT_NEXT = "/agents";
export const OTP_MIN = 6;
export const OTP_MAX = 10;

export type VerifyErrorCode = "bad_request" | "code_invalid" | "code_expired" | "rate_limited" | "workspace_setup_failed";
export type SendErrorCode = "send_failed" | "rate_limited";

export const CODE_LOGIN_ERRORS: Record<VerifyErrorCode | SendErrorCode, string> = {
  bad_request: "Enter your email and the code from the email.",
  code_invalid: "That code is not right. Check the latest email and try again.",
  code_expired: "The code has expired or was already used. Request a new code.",
  rate_limited: "Too many attempts. Wait a few minutes, then try again.",
  workspace_setup_failed: "Signed in, but your workspace could not be set up. Try again or contact the workspace owner.",
  send_failed: "The code could not be sent. Try again.",
};

export const isOtpCode = (v: string): boolean => new RegExp(`^\\d{${OTP_MIN},${OTP_MAX}}$`).test(v);

export type OtpClient = {
  auth: {
    signInWithOtp(args: {
      email: string;
      options?: { emailRedirectTo?: string };
    }): Promise<{ error: { status?: number; code?: string } | null }>;
  };
};

export type PostJson = (url: string, body: unknown) => Promise<{ status: number; json: unknown }>;

export function isRateLimited(err: { status?: number; code?: string }): boolean {
  return err.status === 429 || err.code === "over_email_send_rate_limit" || err.code === "over_request_rate_limit";
}

/** Requests the sign-in email (link and code). The link still works when opened in a browser. */
export async function requestCode(
  supabase: OtpClient,
  email: string,
  emailRedirectTo: string,
): Promise<{ ok: true } | { ok: false; error: SendErrorCode }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo } });
    if (!error) return { ok: true };
    return { ok: false, error: isRateLimited(error) ? "rate_limited" : "send_failed" };
  } catch {
    return { ok: false, error: "send_failed" };
  }
}

const VERIFY_CODES = new Set<string>(Object.keys(CODE_LOGIN_ERRORS));

/** Posts the code to /auth/verify; on success returns the path to navigate to. */
export async function verifyCode(
  post: PostJson,
  input: { email: string; token: string; next: string | null },
): Promise<{ ok: true; redirect: string } | { ok: false; error: VerifyErrorCode }> {
  const token = input.token.replace(/\s+/g, "");
  if (!isOtpCode(token)) return { ok: false, error: "code_invalid" };
  try {
    const res = await post("/auth/verify", { email: input.email.trim(), token, ...(input.next ? { next: input.next } : {}) });
    const body = (res.json ?? {}) as { redirect?: unknown; error?: unknown };
    if (res.status === 200 && typeof body.redirect === "string" && body.redirect.startsWith("/") && !body.redirect.startsWith("//")) {
      return { ok: true, redirect: body.redirect };
    }
    if (typeof body.error === "string" && VERIFY_CODES.has(body.error)) return { ok: false, error: body.error as VerifyErrorCode };
    return { ok: false, error: res.status === 429 ? "rate_limited" : "code_invalid" };
  } catch {
    return { ok: false, error: "code_invalid" };
  }
}

export const browserPost: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};
