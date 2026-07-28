import { test, expect } from "@playwright/test";

// The two client shells nothing else covers: the desktop client and the mobile
// PWA. Both consume the same generated api-client as the admin console but wire
// it differently — desktop through URL routes, the PWA through lazy-loaded tabs —
// so a client-wiring regression can hide in one while the others stay green.
//
// Both are served through the preview proxy against the live api-server, so the
// browser → proxy → express → decision-core path is the real one.
// Must match PORTS.desktop / PORTS.pwa in ../../playwright.config.ts.
const DESKTOP = `http://localhost:${Number(process.env.E2E_DESKTOP_PORT ?? 4615)}`;
const PWA = `http://localhost:${Number(process.env.E2E_PWA_PORT ?? 4616)}`;

/** Records api traffic + page errors for the assertions below. */
function watch(page: import("@playwright/test").Page) {
  const calls: { url: string; status: number }[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/")) calls.push({ url: r.url(), status: r.status() });
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes("/api/")) failed.push(`${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { calls, failed, errors };
}

test("desktop client renders live api-server data end to end", async ({ page }) => {
  const w = watch(page);
  const got = page
    .waitForResponse((r) => r.url().includes("/api/") && r.status() >= 200 && r.status() < 400, { timeout: 20_000 })
    .catch(() => null);
  await page.goto(`${DESKTOP}/decisions`, { waitUntil: "domcontentloaded" });
  await got;
  await page.waitForLoadState("networkidle").catch(() => {});

  const ok = w.calls.filter((c) => c.status >= 200 && c.status < 400);
  const bad = w.calls.filter((c) => c.status >= 400);
  expect(w.failed, `no failed api calls: ${w.failed.join(" | ")}`).toHaveLength(0);
  expect(ok.length, "desktop reached the api-server").toBeGreaterThan(0);
  expect(bad, `no 4xx/5xx: ${JSON.stringify(bad)}`).toHaveLength(0);
  expect(w.errors, `no page errors: ${w.errors.join(" | ")}`).toHaveLength(0);
  expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(50);
});

test("mobile PWA loads its overview tab from the live api-server", async ({ page }) => {
  const w = watch(page);
  // The PWA opens on a static support tab and lazy-loads the rest, so the data
  // path only runs once Overview is selected — waiting on load state alone would
  // assert nothing.
  const got = page
    .waitForResponse((r) => r.url().includes("/api/") && r.status() >= 200 && r.status() < 400, { timeout: 20_000 })
    .catch(() => null);
  await page.goto(`${PWA}/`, { waitUntil: "domcontentloaded" });
  await page.getByText(/^overview$/i).first().click();
  await got;
  await page.waitForLoadState("networkidle").catch(() => {});

  const ok = w.calls.filter((c) => c.status >= 200 && c.status < 400);
  const bad = w.calls.filter((c) => c.status >= 400);
  expect(w.failed, `no failed api calls: ${w.failed.join(" | ")}`).toHaveLength(0);
  expect(ok.length, "PWA reached the api-server").toBeGreaterThan(0);
  expect(bad, `no 4xx/5xx: ${JSON.stringify(bad)}`).toHaveLength(0);
  expect(w.errors, `no page errors: ${w.errors.join(" | ")}`).toHaveLength(0);
  expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(50);
});
