import { defineConfig } from "@playwright/test";

import { BASE_URL } from "./tests/responsive/fixture";

export default defineConfig({
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
  // One server, two suites. `responsive` audits every registered page for
  // layout and accessibility; `journeys` drives the product the way somebody
  // running an off-campus search actually would. They are separate projects so
  // either can be run alone while a failure is being chased.
  projects: [
    // The responsive audit walks every registered page inside single tests, so
    // it genuinely needs the long timeout above.
    { name: "responsive", testDir: "./tests/responsive" },
    // A journey step is one click and one render. Anything still waiting after
    // a minute is a selector that no longer matches, and finding that out in a
    // minute rather than ten is the difference between fixing it and giving up.
    { name: "journeys", testDir: "./tests/journeys", timeout: 60_000 },
  ],
});
