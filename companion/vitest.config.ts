import { defineConfig } from "vitest/config";

// Companion-only config. No '@' alias and no Electron runtime: tests import the pure modules only.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "release/**"],
  },
});
