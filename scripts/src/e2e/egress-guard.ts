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
 * `allowedHosts` names the off-page hosts the page is KNOWN to reference (read from
 * its index.html, not guessed). They are still aborted — the run stays offline and a
 * CDN hiccup cannot masquerade as an app regression — but attempting them is not a
 * failure. Any other host is. The default is the empty list: an unlisted host fails.
 *
 * Call it at the top of a spec, BEFORE any `beforeEach` that navigates, so the route
 * is installed before the first request.
 */
export function guardEgress(test: typeof baseTest, allowedHosts: readonly string[] = []): void {
  let unexpected: string[] = [];

  test.beforeEach(async ({ page }) => {
    unexpected = [];
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
      if (!allowedHosts.includes(url.hostname)) unexpected.push(url.href);
      return route.abort();
    });
  });

  test.afterEach(() => {
    expect(
      unexpected,
      `the page attempted requests to hosts outside its allowlist [${allowedHosts.join(", ")}]`,
    ).toEqual([]);
  });
}
