import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    actionTimeout: 10000,
    channel: process.platform === "win32" ? "msedge" : undefined,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/e2e-api.mjs",
      url: "http://127.0.0.1:8789/api/health",
      reuseExistingServer: false,
      timeout: 60000,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
    {
      command: "npm run dev:web -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 60000,
      env: { PLANNER_API_URL: "http://127.0.0.1:8789" },
    },
  ],
});
