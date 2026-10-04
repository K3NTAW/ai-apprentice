// Login view model (password login, T-0160), framework free. The free-tier Supabase project cannot change email
// templates, so the emailed one-time code is gone: the desktop app signs in with email + password ('Sign in' and
// 'Create account' tabs); the browser offers email + password and the magic link ('Email me a link').
// After signInWithPassword / signUp (browser client), POST /api/auth/bootstrap runs the workspace bootstrap server
// side with the new session cookie and returns where to go (a safe next, default /agents).
// Forgot password: resetPasswordForEmail with redirectTo <origin>/auth/reset; /auth/reset sets the new password.

export const PASSWORD_LOGIN_DEFAULT_NEXT = "/agents";
export const PASSWORD_MIN = 8;
export const BOOTSTRAP_URL = "/api/auth/bootstrap";

export type LoginMethod = "password" | "link";
export type PasswordTab = "signin" | "signup";

export type LoginView = { methods: LoginMethod[]; tabs: { id: PasswordTab; label: string }[] };

export const PASSWORD_TABS: LoginView["tabs"] = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

/** Desktop app: email + password only. Browser: email + password and the magic link. */
export function loginView(inApp: boolean): LoginView {
  return { methods: inApp ? ["password"] : ["password", "link"], tabs: PASSWORD_TABS };
}

export type AuthErrorCode =
  | "bad_request"
  | "wrong_credentials"
  | "account_exists"
  | "weak_password"
  | "password_too_short"
  | "password_mismatch"
  | "email_not_confirmed"
  | "rate_limited"
  | "workspace_setup_failed"
  | "send_failed"
  | "link_invalid"
  | "failed";

export const AUTH_ERRORS: Record<AuthErrorCode, string> = {
  bad_request: "Enter your email and password.",
  wrong_credentials: "Wrong email or password.",
  account_exists: "An account with this email already exists. Sign in instead.",
  weak_password: "That password is too weak. Use a longer one, or mix letters, numbers and symbols.",
  password_too_short: `Use at least ${PASSWORD_MIN} characters.`,
  password_mismatch: "The two passwords do not match.",
  email_not_confirmed: "Confirm your email first: open the link we sent you, then sign in.",
  rate_limited: "Too many attempts. Wait a few minutes, then try again.",
  workspace_setup_failed: "Signed in, but your workspace could not be set up. Try again or contact the workspace owner.",
  send_failed: "The email could not be sent. Try again.",
  link_invalid: "This reset link is invalid or has expired. Request a new one from the sign-in page.",
  failed: "That did not work. Try again.",
};

export type AuthErr = { status?: number; code?: string; message?: string };

export function isRateLimited(err: AuthErr): boolean {
  return err.status === 429 || /rate_limit/.test(err.code ?? "");
}

/** Supabase Auth error to a fixed code. Says no more about an address than Supabase's own answer. */
export function mapAuthError(err: AuthErr): AuthErrorCode {
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (isRateLimited(err)) return "rate_limited";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "wrong_credentials";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "account_exists";
  if (code === "weak_password" || msg.includes("password should")) return "weak_password";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "email_not_confirmed";
  return "failed";
}

/** null when the new password is acceptable, else the error to show. */
export function checkNewPassword(password: string, confirm: string): AuthErrorCode | null {
  if (password.length < PASSWORD_MIN) return "password_too_short";
  if (password !== confirm) return "password_mismatch";
  return null;
}

export type PostJson = (url: string, body: unknown) => Promise<{ status: number; json: unknown }>;

type Resp = { error: AuthErr | null };

export type PasswordClient = {
  auth: {
    signInWithPassword(args: { email: string; password: string }): Promise<Resp>;
    signUp(args: { email: string; password: string; options?: { emailRedirectTo?: string } }): Promise<
      Resp & { data: { session: unknown } | null }
    >;
  };
};

export type LinkClient = {
  auth: { signInWithOtp(args: { email: string; options?: { emailRedirectTo?: string } }): Promise<Resp> };
};

export type ResetRequestClient = {
  auth: { resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<Resp> };
};

export type ResetClient = {
  auth: {
    setSession(args: { access_token: string; refresh_token: string }): Promise<Resp>;
    updateUser(args: { password: string }): Promise<Resp>;
    signOut(options?: { scope?: "global" | "local" | "others" }): Promise<Resp>;
  };
};

export type AuthResult = { kind: "redirect"; to: string } | { kind: "confirm_email" } | { kind: "error"; error: AuthErrorCode };

const fail = (error: AuthErrorCode): AuthResult => ({ kind: "error", error });
const BOOTSTRAP_CODES = new Set<string>(["rate_limited", "workspace_setup_failed"]);

/** POSTs /api/auth/bootstrap (the session cookie goes along); on success the safe path to navigate to. */
export async function bootstrapSession(post: PostJson, next: string | null): Promise<AuthResult> {
  try {
    const res = await post(BOOTSTRAP_URL, next ? { next } : {});
    const body = (res.json ?? {}) as { redirect?: unknown; error?: unknown };
    if (res.status === 200 && typeof body.redirect === "string" && body.redirect.startsWith("/") && !body.redirect.startsWith("//")) {
      return { kind: "redirect", to: body.redirect };
    }
    if (typeof body.error === "string" && BOOTSTRAP_CODES.has(body.error)) return fail(body.error as AuthErrorCode);
    return fail(res.status === 429 ? "rate_limited" : "failed");
  } catch {
    return fail("failed");
  }
}

type Credentials = { email: string; password: string; next: string | null };

export async function signInWithPassword(supabase: PasswordClient, post: PostJson, input: Credentials): Promise<AuthResult> {
  const email = input.email.trim();
  if (!email || !input.password) return fail("bad_request");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password: input.password });
    if (error) return fail(mapAuthError(error));
  } catch {
    return fail("failed");
  }
  return bootstrapSession(post, input.next);
}

/**
 * Creates the account. With 'Confirm email' off (this project) signUp returns a session and the bootstrap runs;
 * with it on there is no session yet and the user is told to confirm by email first.
 */
export async function signUpWithPassword(
  supabase: PasswordClient,
  post: PostJson,
  input: Credentials & { confirm: string; emailRedirectTo?: string },
): Promise<AuthResult> {
  const email = input.email.trim();
  if (!email) return fail("bad_request");
  const bad = checkNewPassword(input.password, input.confirm);
  if (bad) return fail(bad);
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      ...(input.emailRedirectTo ? { options: { emailRedirectTo: input.emailRedirectTo } } : {}),
    });
    if (error) return fail(mapAuthError(error));
    if (!data?.session) return { kind: "confirm_email" };
  } catch {
    return fail("failed");
  }
  return bootstrapSession(post, input.next);
}

/** Browser only: the magic link (the default Magic Link email of the free tier carries a link, no code). */
export async function requestMagicLink(
  supabase: LinkClient,
  email: string,
  emailRedirectTo: string,
): Promise<{ ok: true } | { ok: false; error: AuthErrorCode }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo } });
    if (!error) return { ok: true };
    return { ok: false, error: isRateLimited(error) ? "rate_limited" : "send_failed" };
  } catch {
    return { ok: false, error: "send_failed" };
  }
}

export const resetRedirectTo = (origin: string) => `${origin}/auth/reset`;

/** 'Forgot password?': the default recovery email links to <origin>/auth/reset. */
export async function requestPasswordReset(
  supabase: ResetRequestClient,
  email: string,
  origin: string,
): Promise<{ ok: true } | { ok: false; error: AuthErrorCode }> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "bad_request" };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo: resetRedirectTo(origin) });
    if (!error) return { ok: true };
    return { ok: false, error: isRateLimited(error) ? "rate_limited" : "send_failed" };
  } catch {
    return { ok: false, error: "send_failed" };
  }
}

export type RecoveryTokens = { access_token: string; refresh_token: string };

/**
 * The tokens the recovery link brings in the URL hash. The reset is requested with the implicit flow
 * (lib/auth/recoveryClient), so the link works in any browser, not only the one (or the app) that asked for it.
 */
export function readRecoveryTokens(hash: string): RecoveryTokens | null {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const access_token = h.get("access_token");
  const refresh_token = h.get("refresh_token");
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}

/** Starts the recovery session from the link tokens. */
export async function startRecovery(supabase: ResetClient, tokens: RecoveryTokens | null): Promise<{ ok: true } | { ok: false; error: AuthErrorCode }> {
  if (!tokens) return { ok: false, error: "link_invalid" };
  try {
    const { error } = await supabase.auth.setSession(tokens);
    return error ? { ok: false, error: "link_invalid" } : { ok: true };
  } catch {
    return { ok: false, error: "link_invalid" };
  }
}

/** Sets the new password, then ends the browser session: the user signs in again in the app. */
export async function updatePassword(
  supabase: ResetClient,
  password: string,
  confirm: string,
): Promise<{ ok: true } | { ok: false; error: AuthErrorCode }> {
  const bad = checkNewPassword(password, confirm);
  if (bad) return { ok: false, error: bad };
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const code = mapAuthError(error);
      return { ok: false, error: code === "rate_limited" || code === "weak_password" ? code : "failed" };
    }
  } catch {
    return { ok: false, error: "failed" };
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The password is changed either way.
  }
  return { ok: true };
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
