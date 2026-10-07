import { defineConfig } from "vitest/config";

// The RLS suite only. Not merged with the root vitest.config.ts; its include allowlist keeps db-tests out of npm test.
export default defineConfig({
  test: {
    root: new URL("..", import.meta.url).pathname,
    environment: "node",
    // Vitest 5 hides logs of passing tests by default; the SKIPPED line must show.
    silent: false,
    include: ["db-tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
