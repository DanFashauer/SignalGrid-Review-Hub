import { test, expect, type Page } from "@playwright/test";

/**
 * signalgrid-app (admin console) + api-server — browser-level E2E.
 *
 * This is the one surface with a real network path: the admin console's
 * `vite preview` proxies /api/* to a LIVE api-server booted by the Playwright
 * webServer config (API_PROXY_TARGET). So every assertion here exercises
 * browser → preview proxy → express → decision core, the same wiring the
 * re-pointed admin app uses in deployment — no mocks anywhere in the chain.
 */

// Must match PORTS.admin in ../../playwright.config.ts (same env var).
const PORT = Number(process.env.E2E_ADMIN_PORT ?? 4614);
const BASE = `http://localhost:${PORT}`;

// index.html references Google Fonts; block non-localhost so runs are
// hermetic and the /api proxy traffic is the only network that matters.
async function blockExternal(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "localhost" || host === "127.0.0.1") return route.continue();
    return route.abort();
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternal(page);
});

test("api-server health and demo-key discovery respond through the app's own proxy", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // fetch() from the page origin — the exact path the app's data layer takes
  // (relative /api/*, proxied by vite preview to the live api-server).
  const health = await page.evaluate(async () => {
    const res = await fetch("/api/healthz");
    return { status: res.status, body: (await res.json()) as { status: string } };
  });
  expect(health.status).toBe(200);
  expect(health.body.status).toBe("ok");

  const keys = await page.evaluate(async () => {
    const res = await fetch("/api/v1/keys");
    return {
      status: res.status,
      body: (await res.json()) as { note: string; keys: Array<{ tenant: string }> },
    };
  });
  expect(keys.status).toBe(200);
  // Public-safe fixture keys only — and the server says so in-band.
  expect(keys.body.note).toContain("not real credentials");
  expect(
    keys.body.keys.filter((k) => k.tenant === "tenant_northwind").length,
  ).toBeGreaterThanOrEqual(3);
});

test("dashboard renders the deterministic fixture telemetry", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("SignalGrid — Operator Dashboard");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // The fixture provenance label — the dashboard says what its numbers are.
  await expect(page.getByText("24H SYSTEM TELEMETRY (FIXTURE)")).toBeVisible();

  // Exact fixture values (fixed at api-server process start): if these render,
  // the metrics round-trip through the proxy delivered real server data.
  await expect(page.getByText("Total Decisions")).toBeVisible();
  await expect(page.getByText("18,432")).toBeVisible();
  await expect(page.getByText("82.0%")).toBeVisible();
});

test("live decision panel evaluates a RESTRICT through the real /v1 core", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Live decision · /v1 core")).toBeVisible();

  // Click a preset → browser POSTs /api/v1/decisions/evaluate with the demo
  // bearer token → deterministic core answers. No fixture, no mock.
  // (The fixture table's badges render "Restrict"; the live panel's literal
  // "RESTRICT" is unique in the DOM, so no extra scoping is needed.)
  await page.getByRole("button", { name: /Non-compliant device/ }).click();

  await expect(page.getByText("RESTRICT", { exact: true })).toBeVisible();
  await expect(page.getByText("DEVICE_NONCOMPLIANT", { exact: true })).toBeVisible();
  // The engine's provenance trail reaches the operator: decision id,
  // evidence snapshot id, and the versioned policy that decided.
  await expect(page.getByText(/decision dec_[0-9a-f]+/)).toBeVisible();
  await expect(page.getByText(/evidence evid_[0-9a-f]+/)).toBeVisible();
  await expect(page.getByText(/policy pol_tenant_northwind_shared_device v1/)).toBeVisible();
});

test("decisions page lists the REAL /v1 decision ledger", async ({ page }) => {
  await page.goto(`${BASE}/decisions`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
  // The list is the core's own ledger now, seeded at api-server boot by
  // running the real decision loop over the demo subjects. Pairing a device
  // with its outcome badge proves rows render as coherent records: the
  // non-compliant ward iPad restricts; the disabled account denies.
  // `.first()` throughout: other specs in this suite evaluate the SAME demo
  // subjects against the shared server, so a device can have several ledger
  // rows by the time this test runs — every one of them carries the same
  // deterministic outcome, so asserting the first is sufficient and stable.
  await expect(page.getByText("nurse.compliant").first()).toBeVisible();
  await expect(page.locator("tr").filter({ hasText: "ipad-ward-02" }).first()).toContainText("Restrict");
  await expect(page.locator("tr").filter({ hasText: "nurse.disabled" }).first()).toContainText("Deny");
});

test("decision detail renders the trust moment from /v1 (reasons, rules, verified evidence)", async ({ page }) => {
  await page.goto(`${BASE}/decisions`, { waitUntil: "domcontentloaded" });
  await page.locator("tr").filter({ hasText: "ipad-ward-02" }).first().click();

  // Reason codes + matched rules from the core, and the evidence snapshot's
  // digest re-verified server-side on this request.
  await expect(page.getByText("DEVICE_NONCOMPLIANT").first()).toBeVisible();
  await expect(page.getByText("digest verified")).toBeVisible();
  await expect(page.getByText("Signals used")).toBeVisible();
});

test("assurance status page renders the server-derived posture", async ({ page }) => {
  await page.goto(`${BASE}/status`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Deployment assurance" })).toBeVisible();
  // Server-derived, not copy: the fixture posture and the advisory effect both
  // come off /v1/context on this request.
  await expect(page.getByText(/fixtures — no live vendor call/)).toBeVisible();
  await expect(page.getByText(/advisory — the gate answers/)).toBeVisible();
  // The declared-divergence block labels itself as a declaration.
  await expect(page.getByText("Declared divergence — a declaration, not a measurement")).toBeVisible();
});

test("connector setup renders the server-resolved mode and runs a fixture sync", async ({ page }) => {
  await page.goto(`${BASE}/connectors/setup`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Microsoft connector" })).toBeVisible();
  // The mode chip is the server's own resolution, not copy.
  await expect(page.getByText("resolved mode: fixture")).toBeVisible();
  await expect(page.getByText("microsoft-entra-intune").first()).toBeVisible();

  // The sync button drives the real POST /v1/connectors/:id/sync — a fixture
  // pipeline run whose result lands in the history list.
  const synced = page.waitForResponse((r) => r.url().includes("/sync") && r.request().method() === "POST");
  await page.getByRole("button", { name: /RUN FIXTURE SYNC/ }).click();
  const res = await synced;
  expect(res.status(), "POST /v1/connectors/:id/sync").toBe(200);
  await expect(page.getByText(/records · \d+ signals/).first()).toBeVisible();
});

test("audit page verifies the tamper-evident chain from /v1", async ({ page }) => {
  await page.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();
  await expect(page.getByText("chain verified")).toBeVisible();
});

test("policies page lists the core's versioned policies and the detail runs tests", async ({ page }) => {
  await page.goto(`${BASE}/policies`, { waitUntil: "domcontentloaded" });

  // The core's real policy inventory, read from /v1 — not the fixture catalog.
  await expect(page.getByText("Shared-device baseline access policy")).toBeVisible();
  await expect(page.getByText("READ-ONLY AT LAUNCH").first()).toBeVisible();

  await page.getByText("Shared-device baseline access policy").click();
  // The versioned rule set renders with its digest, and the pinned policy
  // tests run server-side against the active version.
  await expect(page.getByText(/digest [0-9a-f]+/).first()).toBeVisible();
  await expect(page.getByText(/\d+\/\d+ passed/)).toBeVisible();
});
