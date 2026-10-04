import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/*.guard.test.ts"],
    exclude: ["spikes/**", "wt/**", "companion/**", "marketing/**", "node_modules/**"],
  },
});
