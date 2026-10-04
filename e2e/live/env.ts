// The only place that reads the test user's credentials. Values go to Playwright fill() calls and to scrub(); they are
// never logged, attached or written to disk.
const REQUIRED = ["BASE_URL", "E2E_EMAIL", "E2E_PASSWORD"] as const;

export const PREFIX = "E2E ";
export const AGENT_NAME = "E2E Pip";
export const ONBOARDING_AGENT = "E2E Onboard";
export const WORKSPACE_NAME = "E2E Workspace";

export function missingEnv(): string[] {
  return REQUIRED.filter((k) => !process.env[k]);
}

export function creds(): { email: string; password: string } {
  return { email: process.env.E2E_EMAIL ?? "", password: process.env.E2E_PASSWORD ?? "" };
}

/** Removes the credentials from any text before it goes into the summary. */
export function scrub(text: string): string {
  let out = text;
  for (const secret of Object.values(creds())) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}
