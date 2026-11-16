// Fixture for scripts/lib/e2e-ports.mjs --self-test: ONE webServer, wired with the very same
// REUSE_SERVERS flag the real scripts/playwright.config.ts gives all six of its servers. The
// self-test occupies E2E_REVIEW_PORT with a foreign server and asks Playwright's own webServer
// setup whether it would reuse it. The command never starts a build: when Playwright refuses
// the busy port it never runs, and when it reuses the server it never needs to.
import { defineConfig } from "@playwright/test";
import { REUSE_SERVERS } from "../playwright.config";

const port = Number(process.env.E2E_REVIEW_PORT);

export default defineConfig({
  testDir: "./e2e-fresh-server-fixture-no-tests",
  webServer: [
    {
      command: "node -e \"process.exit(1)\"",
      url: `http://localhost:${port}/`,
      reuseExistingServer: REUSE_SERVERS,
      timeout: 10_000,
    },
  ],
});
