// Live hands-on suite against the DEPLOYED app (docs/checks/e2e-live.md). Run: npm run e2e:live.
// BASE_URL, E2E_EMAIL and E2E_PASSWORD come from env only (checked in global-setup.ts). Trace, video and Playwright's own
// screenshots stay off so typed input is never recorded; the specs take their own screenshots with the password masked.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: "./out/artifacts",
  globalSetup: "./global-setup.ts",
  reporter: [["list"], ["./summary-reporter.ts", { outputFile: "e2e/live/out/summary.md" }]],
  use: {
    baseURL: process.env.BASE_URL,
    channel: "chrome",
    headless: process.env.E2E_HEADED !== "1",
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
