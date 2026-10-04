// Fails the run before any browser starts when a required env var is missing. Names only, never values.
import { missingEnv } from "./env";

export default function globalSetup() {
  const missing = missingEnv();
  if (missing.length) throw new Error(`e2e:live needs ${missing.join(", ")} in env (see docs/checks/e2e-live.md)`);
}
