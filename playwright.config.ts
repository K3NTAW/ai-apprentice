// E2E click-through against the local-mode app. Drives the installed Google Chrome (channel 'chrome'); no browser download.
// webServer runs `next dev` (NODE_ENV=development resolves appMode to 'local'; a production build would be 'misconfigured').
import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PORT = 3217;
const DATA_DIR = path.join(os.tmpdir(), "ai-apprentice-e2e");

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: path.join(os.tmpdir(), "ai-apprentice-e2e-report.json") }]],
  outputDir: path.join(os.tmpdir(), "ai-apprentice-e2e-artifacts"),
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    headless: true,
    acceptDownloads: true,
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"] },
  },
  webServer: {
    command: `node e2e/seed.mjs && npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/agents`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATA_DIR,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  },
});
