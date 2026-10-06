import { defineConfig, devices } from "@playwright/test";

const PORT = 3495;

// E2E_SERVER lets CI test the packaged server instead of the dev one.
export default defineConfig({
  testDir: "e2e",
  // One server, one browser, in file order: the last file uses up the server's rate limit.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_SERVER ?? `npm run dev -- -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Empty on purpose: these tests must never reach Azure, whatever .env.local holds.
    env: {
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      AZURE_CUSTOM_VISION_PREDICTION_URL: "",
      AZURE_CUSTOM_VISION_PREDICTION_KEY: "",
    },
  },
});
