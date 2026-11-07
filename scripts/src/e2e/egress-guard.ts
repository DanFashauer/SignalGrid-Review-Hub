import { expect, type test as baseTest } from "@playwright/test";

/**
 * Hermetic network for a browser spec, with the assertion that makes it a test.
 *
 * Every spec that served a page used to `route.abort()` off-localhost requests and
 * stop there, so a page that grew a webfont, a logo or an analytics beacon was
 * silently neutered by the suite and shipped green — the lesson
 * `evidence-coverage-page.spec.ts` recorded in its own words and that stayed in the
 * file it was learned in (plan row 147). Aborting is the setup; the `afterEach`
 * below is the test.
 *
 * What "attempted" covers, so the claim holds for more than the obvious fetch:
 *   - every HTTP request from ANY page of the context — `context.route`, not
 *     `page.route`, so a `window.open` popup is held to the same list;
 *   - every WebSocket (`context.routeWebSocket`), which HTTP routing never sees;
 *   - service workers are BLOCKED for the spec, because a worker's own fetches bypass
 *     routing entirely — an unrouted path is an unasserted one;
 *   - a settle wait in `afterEach`, so a request fired just after the test body ends
 *     (a deferred beacon) is still inside the window the assertion reads.
 *
 * `allowedHosts` names the off-page hosts the page is KNOWN to reference (read from
 * its index.html, not guessed). They are still aborted — the run stays offline and a
 * CDN hiccup cannot masquerade as an app regression — but attempting them is not a
 * failure. Any other host is. The default is the empty list.
 *
 * `serves` says what the page under test is loaded from, and only that passes
 * through: `"localhost"` (a webServer of the Playwright config) or `"file"` (a
 * standalone document, for which even localhost is off-page).
 *
 * Call it at the top of a spec, BEFORE any `beforeEach` that navigates, so the routes
 * are installed before the first request.
 */
export interface EgressOptions {
  serves?: "localhost" | "file";
  settleMs?: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function guardEgress(
  test: typeof baseTest,
  allowedHosts: readonly string[] = [],
  { serves = "localhost", settleMs = 300 }: EgressOptions = {},
): void {
  let unexpected: string[] = [];
  const isServed = (url: URL): boolean =>
    serves === "file" ? url.protocol === "file:" : LOCAL_HOSTS.has(url.hostname);
  const record = (url: URL): void => {
    if (!allowedHosts.includes(url.hostname)) unexpected.push(url.href);
  };

  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ context }) => {
    unexpected = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (isServed(url)) return route.continue();
      record(url);
      return route.abort();
    });
    await context.routeWebSocket(/.*/, (ws) => {
      const url = new URL(ws.url());
      if (isServed(url)) return ws.connectToServer();
      record(url);
      return ws.close();
    });
  });

  test.afterEach(async ({ page }) => {
    await page.waitForTimeout(settleMs);
    expect(
      unexpected,
      `the page attempted requests to hosts outside its allowlist [${allowedHosts.join(", ")}]`,
    ).toEqual([]);
  });
}
