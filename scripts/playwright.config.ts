import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Browser-level E2E for the SignalGrid web surfaces — the first layer in this
 * repo that verifies what a human SEES, not what a module exports. The proof
 * scripts already pin the core, the API contract, and the connectors; what
 * none of them could catch is a page that builds green and renders wrong (or
 * renders copy the core no longer honours). These tests close that gap.
 *
 * Every server is localhost and every fixture is the deterministic demo seed,
 * so a red run is a real regression, never an environment coin-flip. Each app
 * is built from the current tree and served the way production serves it —
 * `vite preview` over the built bundle for the static apps, `node
 * dist/index.mjs` for the api-server — so a green run pins the built
 * artifact, not the dev server.
 *
 * Browsers: uses the preinstalled Chromium via PLAYWRIGHT_BROWSERS_PATH
 * (never run `playwright install` in this environment). If default
 * resolution ever fails, point E2E_CHROMIUM_PATH at the browser binary
 * (e.g. /opt/pw-browsers/chromium).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Fixed, uncommon localhost ports so a stray dev server (5173, 8080) can never
// be mistaken for the app under test. Overridable if something squats on them.
// The specs derive the same values from the same env vars — keep them in sync.
const PORTS = {
  review: Number(process.env.E2E_REVIEW_PORT ?? 4611),
  web: Number(process.env.E2E_WEB_PORT ?? 4612),
  api: Number(process.env.E2E_API_PORT ?? 4613),
  admin: Number(process.env.E2E_ADMIN_PORT ?? 4614),
};

// Browser resolution, in order: explicit override → the runner's preinstalled
// Chromium symlink → Playwright's own registry lookup. The preinstalled
// browser tree can lag the Playwright package's expected revision (it does on
// this runner: revision 1194 vs expected 1234), and downloading browsers here
// is forbidden — so when the stable symlink exists, use it directly instead
// of letting the registry demand a download that must never happen.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const chromiumPath =
  process.env.E2E_CHROMIUM_PATH ??
  (fs.existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);

export default defineConfig({
  testDir: "./src/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Zero retries on purpose: the fixtures are deterministic, so a retry could
  // only launder a real regression into a "flake".
  retries: 0,
  workers: 3,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "retain-on-failure",
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: [
    {
      // Operator/review console: static SPA, no backend — the decision core
      // runs in the browser, which is exactly what these tests must witness.
      command:
        "pnpm --filter @workspace/signalgrid-review run build && pnpm --filter @workspace/signalgrid-review run serve",
      cwd: repoRoot,
      env: { PORT: String(PORTS.review) },
      url: `http://localhost:${PORTS.review}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // Public website: static SPA (fonts self-hosted, no backend).
      command:
        "pnpm --filter @workspace/signalgrid-web run build && pnpm --filter @workspace/signalgrid-web run serve",
      cwd: repoRoot,
      env: { PORT: String(PORTS.web) },
      url: `http://localhost:${PORTS.web}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // api-server: the real built server (dist/index.mjs), in-memory demo
      // core — no DATABASE_URL, no live vendor calls, public-safe keys only.
      command:
        "pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start",
      cwd: repoRoot,
      env: { PORT: String(PORTS.api) },
      url: `http://localhost:${PORTS.api}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // Admin console, wired to the LIVE api-server above: `vite preview`
      // proxies /api/* to API_PROXY_TARGET (see the app's vite.config.ts), so
      // the browser → proxy → express → decision-core path is the real one.
      command:
        "pnpm --filter @workspace/signalgrid-app run build && pnpm --filter @workspace/signalgrid-app run serve",
      cwd: repoRoot,
      env: {
        PORT: String(PORTS.admin),
        API_PROXY_TARGET: `http://localhost:${PORTS.api}`,
      },
      url: `http://localhost:${PORTS.admin}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
