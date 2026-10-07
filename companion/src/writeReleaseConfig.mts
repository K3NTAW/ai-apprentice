// Release runner only: `node companion/dist/writeReleaseConfig.mjs` after `npm run build`, before `package:signed`.
// Adds "updates": true and, when SENTRY_DSN_ELECTRON is non-empty, "sentryDsn" to companion/app.config.json.
// Prints key names only, never the DSN.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function withReleaseConfig(text: string, { sentryDsn, updates }: { sentryDsn?: string; updates: boolean }): string {
  const parsed: unknown = JSON.parse(text);
  const config: Record<string, unknown> = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  if (updates) config.updates = true;
  // An unset GitHub secret arrives as "": that means unset.
  if (typeof sentryDsn === "string" && sentryDsn.trim() !== "") config.sentryDsn = sentryDsn;
  return JSON.stringify(config, null, 2) + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app.config.json");
  const dsn = process.env.SENTRY_DSN_ELECTRON;
  const next = withReleaseConfig(fs.readFileSync(file, "utf8"), { sentryDsn: dsn, updates: true });
  fs.writeFileSync(file, next);
  const keys = ["updates", ...("sentryDsn" in JSON.parse(next) ? ["sentryDsn"] : [])];
  // No explicit process.exit: stdout to a pipe is async and would be cut off; the natural exit code is 0.
  process.stdout.write(`release config: set ${keys.join(", ")}\n`);
}
