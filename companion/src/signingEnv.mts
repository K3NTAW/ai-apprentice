// Checks that the env a signed, notarised mac build needs is present.
// `npm run package:signed` runs this before electron-builder. Prints names only, never values.
import { pathToFileURL } from "node:url";

type Env = Record<string, string | undefined>;

const NOTARY = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;
const CERT_FILE = ["CSC_LINK", "CSC_KEY_PASSWORD"] as const;

const has = (env: Env, name: string): boolean => !!env[name];

export function missingSigningEnv(env: Env): string[] {
  const missing: string[] = NOTARY.filter((n) => !has(env, n));
  // The certificate comes either from a .p12 (CSC_LINK + CSC_KEY_PASSWORD) or from the keychain (CSC_NAME).
  if (!has(env, "CSC_NAME")) missing.push(...CERT_FILE.filter((n) => !has(env, n)));
  return missing;
}

export function signingEnvReport(env: Env): string[] {
  return missingSigningEnv(env).map((n) => `missing signing env: ${n}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = signingEnvReport(process.env);
  for (const line of lines) process.stderr.write(line + "\n");
  process.exit(lines.length ? 1 : 0);
}
