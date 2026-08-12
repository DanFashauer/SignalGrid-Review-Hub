import { test, expect } from "@playwright/test";

/**
 * The operator console must not render a CEILING as a measurement.
 *
 * WHAT THIS EXISTS TO STOP, because it shipped and nothing caught it.
 * `/cp/v1/grid/coverage` serves a projection: signal states inferred from each
 * source's acquisition method, nothing contacted, nothing observed. The console
 * rendered that payload as a panel titled "situations handled autonomously", a
 * Coverage metric of 100% in emerald, and rows reading AUTO HANDLED. Every one of
 * those is present tense about work that had never been measured.
 *
 * WHY route-sweep.spec.ts DID NOT CATCH IT, which is the point of a second spec
 * rather than a stricter assertion over there. That sweep asks whether each route
 * mounts, renders more than 50 characters, throws no page errors and makes no
 * failing API calls. A confidently wrong green panel satisfies all four. Breadth
 * nets catch a page that is broken; they cannot catch a page that is untruthful.
 *
 * So these assertions are about MEANING, and they are written in both directions:
 * the honest wording must be present, AND the wording that over-claims must be
 * absent. The absence half is the regression guard — without it, someone could
 * restore "handled autonomously" alongside the new copy and stay green.
 *
 * Must match PORTS.admin in ../../playwright.config.ts.
 */
const CONSOLE = `http://localhost:${Number(process.env.E2E_ADMIN_PORT ?? 4614)}`;

/**
 * Read the basis the server actually served, rather than assuming it. If the
 * control plane is ever wired to observed states, these tests must follow the
 * server instead of pinning today's answer — a test that hard-codes "projected"
 * would start failing for the right reason and be "fixed" in the wrong direction.
 */
async function servedBasis(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get(`${CONSOLE}/api/cp/v1/grid/coverage`);
  expect(res.ok(), "the console proxy must reach /cp/v1/grid/coverage").toBeTruthy();
  const body = await res.json();
  return body?.coverage?.basis as string | undefined;
}

test("the served coverage payload declares its basis at all", async ({ request }) => {
  const basis = await servedBasis(request);
  // Not "is projected" — that the field EXISTS and carries a known value. A
  // response that stopped declaring a basis would leave every consumer guessing,
  // which is the state this whole change removed.
  expect(["observed", "projected_from_sourcing"]).toContain(basis);
});

test("grid intelligence describes a projection as a ceiling, not as autonomy", async ({ page, request }) => {
  const basis = await servedBasis(request);
  await page.goto(`${CONSOLE}/intelligence`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const body = page.locator("body");
  if (basis === "projected_from_sourcing") {
    await expect(body).toContainText(/could handle/i);
    await expect(body).toContainText(/coverage ceiling/i);
    // The over-claims, asserted absent. These are the exact strings that shipped.
    await expect(body).not.toContainText(/situations handled autonomously/i);
    await expect(body).not.toContainText(/auto handled/i);
  } else {
    // Under a real observation the present tense is earned, so it must come back.
    await expect(body).toContainText(/handled autonomously/i);
  }
});

test("the grid overview names the projection as a caveat instead of showing an all-clear", async ({ page, request }) => {
  const basis = await servedBasis(request);
  await page.goto(`${CONSOLE}/grid`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const body = page.locator("body");
  if (basis === "projected_from_sourcing") {
    await expect(body).toContainText(/ceiling, not a reading/i);
    // The headline that must not appear over a projection. It is the loudest
    // sentence on the page and the one an operator would act on.
    await expect(body).not.toContainText(/handling its situations on its own/i);
  }
});
