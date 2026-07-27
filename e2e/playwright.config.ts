import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
  },
});
