import { test, expect } from "@playwright/test";

// Route sweep: every page of the user console must mount, render real content, and
// make no failing api-server calls. Cheap breadth — catches a page that throws, a
// route that 404s into the not-found component, or an endpoint a page depends on
// that has quietly disappeared (the class of regression that removed the /cp/v1/grid
// routes once already).
//
// Pages with deeper semantic assertions live in workflows.spec.ts / decisions.spec.ts.
const CONSOLE = "http://127.0.0.1:5180";
const API = "127.0.0.1:5174";

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
    page.on("requestfailed", (r) => { if (r.url().includes(API)) failed.push(`${r.url()} ${r.failure()?.errorText}`); });
    page.on("response", (r) => { if (r.url().includes(API) && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${CONSOLE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // The router falls through to a not-found component for an unknown path — a
    // silently dead route would otherwise "render fine".
    await expect(page.getByText(/404|not found/i).first(), `${route} should not be a dead route`).toHaveCount(0);

    const body = (await page.locator("body").innerText()).trim();
    expect(body.length, `${route} rendered meaningful content`).toBeGreaterThan(50);

    expect(errors, `${route} page errors: ${errors.join(" | ")}`).toHaveLength(0);
    expect(failed, `${route} failed api calls: ${failed.join(" | ")}`).toHaveLength(0);
    expect(bad, `${route} 4xx/5xx api calls: ${bad.join(" | ")}`).toHaveLength(0);
  });
}
