import { test, expect } from "@playwright/test";

// Breadth pass over every console route that has no deeper spec of its own. Each
// must mount, render real content, and make no failing api-server calls. This is
// the cheap net that catches a page which throws, or one whose endpoint has
// quietly disappeared — the class of regression that removed the /cp/v1/grid
// routes once already.
//
// Must match PORTS.admin in ../../playwright.config.ts.
const CONSOLE = `http://localhost:${Number(process.env.E2E_ADMIN_PORT ?? 4614)}`;

const ROUTES = [
  "/decisions",
  "/integrations",
  "/policies",
  "/signals",
  "/fleet",
  "/app-workflows",
  "/intelligence",
  "/signal-sourcing",
  "/grid",
];

for (const route of ROUTES) {
  test(`route ${route} mounts and renders without errors`, async ({ page }) => {
    const failed: string[] = [];
    const bad: string[] = [];
    const errors: string[] = [];
    page.on("requestfailed", (r) => {
      if (r.url().includes("/api/")) failed.push(`${r.url()} ${r.failure()?.errorText}`);
    });
    page.on("response", (r) => {
      if (r.url().includes("/api/") && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${CONSOLE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // The router falls through to a not-found component ("404 Page Not Found")
    // for an unknown path, so a route that quietly stops resolving would
    // otherwise still "render fine".
    await expect(
      page.getByText(/404 page not found/i),
      `${route} should not fall through to not-found`,
    ).toHaveCount(0);

    const body = (await page.locator("body").innerText()).trim();
    expect(body.length, `${route} rendered meaningful content`).toBeGreaterThan(50);

    expect(errors, `${route} page errors: ${errors.join(" | ")}`).toHaveLength(0);
    expect(failed, `${route} failed api calls: ${failed.join(" | ")}`).toHaveLength(0);
    expect(bad, `${route} 4xx/5xx api calls: ${bad.join(" | ")}`).toHaveLength(0);
  });
}
