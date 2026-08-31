import { test, expect, type Page } from "@playwright/test";

/**
 * signalgrid-web (public website) — browser-level E2E.
 *
 * The website is where product claims meet the outside world, so the tests
 * here pin CLAIMS, not layout. The load-bearing one: the Hardware page's
 * battery copy was corrected when batteryHealth became a decision signal —
 * the old copy said a dying battery "is stepped up", the core now RESTRICTS
 * on a failing battery. Asserting the corrected sentence (and the absence of
 * the old one) pins that fix at the level a prospect actually reads.
 */

// Must match PORTS.web in ../../playwright.config.ts (same env var).
const PORT = Number(process.env.E2E_WEB_PORT ?? 4612);
const BASE = `http://localhost:${PORT}`;

// Fonts are self-hosted (@fontsource), but block non-localhost anyway so no
// stray external fetch can slow or wobble a run.
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

test("landing page renders with brand and hardware nav", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // The retired category label was scrubbed 2026-08-31 (DR-019/DR-020); the
  // title now carries the DR-020 spine — door, device, room, app.
  await expect(page).toHaveTitle(
    "SignalGrid — one grid across door, device, room and app",
  );
  // Scoped to the header — the footer repeats both the brand and the link.
  await expect(
    page.locator("header").getByText("SIGNALGRID", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("header").getByRole("link", { name: "Hardware", exact: true }),
  ).toBeVisible();
});

test("hardware page shows the corrected battery copy — failing battery RESTRICTS", async ({ page }) => {
  // Direct deep-load (not client-side nav): also proves the built bundle's
  // SPA fallback serves routes a visitor lands on from a shared link.
  await page.goto(`${BASE}/hardware`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toContainText("The Badge-Locking");

  // The corrected claim, in the words the core now honours: charge and
  // health are separate signals, and only one of them is fixed by a bay.
  await expect(page.getByText("Smart charging as a decision signal")).toBeVisible();
  await expect(
    page.getByText("Charge state and battery health are separate signals"),
  ).toBeVisible();
  await expect(page.getByText("A failing battery restricts")).toBeVisible();
  await expect(
    page.getByText("the device needs a battery, not a bay"),
  ).toBeVisible();
  await expect(
    page.getByText("A critically low battery steps up and clears once the device charges"),
  ).toBeVisible();

  // The OLD copy claimed step-up and a top-up in the bay would fix it — the
  // exact loop the core was changed to break. It must be gone.
  await expect(page.getByText("stepped up before it is handed out")).toHaveCount(0);
  await expect(page.getByText("keeps it topped up in its bay")).toHaveCount(0);
});

test("hardware page keeps its honesty banner and SmartDock claims intact", async ({ page }) => {
  await page.goto(`${BASE}/hardware`, { waitUntil: "domcontentloaded" });

  // The disclosure that keeps the page public-safe: design concept, not a
  // shipping product. If this ever disappears, the page starts overselling.
  await expect(
    page.getByText("Pre-production hardware design concept.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("not shipped or certified")).toBeVisible();

  // SmartDock section: the optional embedded layer, described as modeled and
  // fixture-backed — matching what the repo actually ships.
  await expect(
    page.getByText("A dedicated smart-charging dock, with SignalGrid embedded."),
  ).toBeVisible();
  await expect(page.getByText("INGESTION MODE: embedded_smartdock")).toBeVisible();
  await expect(page.getByText("4-Phase Custody Detection")).toBeVisible();

  // One concrete spec value — content a buyer reads, not just a heading.
  await expect(page.getByText("4,800 mAh Li-Po")).toBeVisible();
});

test("client-side navigation reaches the hardware page from the landing page", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("header").getByRole("link", { name: "Hardware", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/hardware`);
  // Same corrected sentence via the router path — the wouter base-path wiring
  // in the built bundle, not just the static fallback, serves the fix.
  await expect(page.getByText("A failing battery restricts")).toBeVisible();
});
