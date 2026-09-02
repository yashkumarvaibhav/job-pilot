import { defineConfig } from "@playwright/test";

import { BASE_URL } from "./tests/responsive/fixture";

export default defineConfig({
  testDir: "./tests/responsive",
  globalSetup: "./tests/responsive/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: [["line"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
  },
});
