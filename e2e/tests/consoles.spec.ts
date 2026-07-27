import { test, expect } from "@playwright/test";

// Full-stack E2E. A REAL browser loads each built console.
//   LIVE consoles must reach the LIVE api-server (:5174) and render its data with
//   no failed calls / no page errors — proving browser → JS → api-server → DOM.
//   STATIC consoles must render meaningful content with no page errors.
const API = "127.0.0.1:5174";

// `drive` reaches a data-backed view (landing pages can be static); it runs after
// the initial load and before assertions.
const LIVE = [
  { name: "user-signalgrid-app", url: "http://127.0.0.1:5180/", drive: null as null | ((p: import("@playwright/test").Page) => Promise<void>) },
  { name: "mobile-pwa", url: "http://127.0.0.1:5181/", drive: async (p) => { await p.getByText(/^overview$/i).first().click(); } },
  { name: "desktop", url: "http://127.0.0.1:5182/decisions", drive: null },
];
const STATIC = [
  { name: "admin-signalgrid-review", url: "http://127.0.0.1:5173/" },
  { name: "website-signalgrid-web", url: "http://127.0.0.1:5183/" },
];

function watch(page: import("@playwright/test").Page) {
  const calls: { url: string; status: number }[] = [];
  const failed: { url: string; error: string }[] = [];
  const errors: string[] = [];
  page.on("response", (r) => { if (r.url().includes(API)) calls.push({ url: r.url(), status: r.status() }); });
  page.on("requestfailed", (req) => { if (req.url().includes(API)) failed.push({ url: req.url(), error: req.failure()?.errorText ?? "?" }); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { calls, failed, errors };
}

for (const c of LIVE) {
  test(`LIVE ${c.name}: renders live api-server data end-to-end`, async ({ page }) => {
    const w = watch(page);
    // Wait on the actual api-server response — networkidle alone races lazy chunks
    // + react-query. Set up before navigation so an early fetch isn't missed.
    const gotData = page
      .waitForResponse((r) => r.url().includes(API) && r.status() >= 200 && r.status() < 400, { timeout: 15000 })
      .catch(() => null);
    await page.goto(c.url, { waitUntil: "domcontentloaded" });
    if (c.drive) await c.drive(page);
    await gotData;
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    const ok = w.calls.filter((x) => x.status >= 200 && x.status < 400);
    const bad = w.calls.filter((x) => x.status >= 400);
    console.log(`[${c.name}] api calls:${w.calls.length} ok:${ok.length} bad:${bad.length} failed:${w.failed.length}`);
    if (bad.length) console.log(`  bad: ${JSON.stringify(bad)}`);
    if (w.failed.length) console.log(`  failed(CORS/net): ${JSON.stringify(w.failed)}`);
    expect(w.failed, `no CORS/network-failed calls: ${JSON.stringify(w.failed)}`).toHaveLength(0);
    expect(w.calls.length, "reached the api-server").toBeGreaterThan(0);
    expect(ok.length, "≥1 successful api-server call").toBeGreaterThan(0);
    expect(bad, `no 4xx/5xx: ${JSON.stringify(bad)}`).toHaveLength(0);
    expect(w.errors, `no page errors: ${w.errors.join(" | ")}`).toHaveLength(0);
    expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(50);
    await page.screenshot({ path: `screens/${c.name}.png`, fullPage: true });
  });
}

for (const c of STATIC) {
  test(`STATIC ${c.name}: renders without errors`, async ({ page }) => {
    const w = watch(page);
    await page.goto(c.url, { waitUntil: "networkidle" });
    console.log(`[${c.name}] rendered; page errors:${w.errors.length}`);
    expect(w.errors, `no page errors: ${w.errors.join(" | ")}`).toHaveLength(0);
    expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(50);
    await page.screenshot({ path: `screens/${c.name}.png`, fullPage: true });
  });
}
