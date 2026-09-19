import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVIDENCE_AXES, buildCoverageReport } from "@workspace/flows";

/**
 * docs/evidence-coverage.html — the standalone, self-contained Evidence Coverage page.
 *
 * This is the one surface a design partner can be handed directly: a single file with the
 * real coverage model bundled in, no server and no network. That makes it the surface with
 * the LEAST infrastructure standing between a bad build and a prospect's screen —
 * `pnpm run build:evidence-coverage` produces valid HTML whether or not the model linked
 * in, whether or not the toggles wire up, and whether or not anything renders at all.
 *
 * So it is loaded from a `file://` URL — exactly how it will be opened when it is emailed
 * rather than published — and asserted against the same measured figures the proof and the
 * api suite pin by equality. No webServer is involved.
 *
 * ASSERTIONS ARE DELIBERATELY NOT ALL KEYED ON `data-*`. A review demonstrated the cost of
 * that habit: inverting every coverage badge's TEXT, swapping the answerable and dark stat
 * CAPTIONS, and zeroing the not-sourced card each left the suite at 3/3 green while the
 * page told a prospect the opposite of the truth. Data attributes prove the model; the
 * visible strings are what a human is actually shown, so both are pinned.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `file://${path.resolve(here, "../../../docs/evidence-coverage.html")}`;

// THE FIGURES ARE DERIVED FROM THE MODEL THE PAGE BUNDLES, not typed here.
//
// They used to be literals — 21 axes, 12 answerable, 6 silent holes — and adding four
// evidence axes in one branch broke five specs across two files at once, every one of
// them on a number rather than on a behaviour. The two specs that assert SHAPE rather
// than COUNT passed untouched, which is the tell (cloud lane, reviewing #753).
//
// This does NOT weaken the suite, and it is worth being precise about why. The model's
// own numbers are pinned BY EQUALITY elsewhere — `proof:evidence-coverage` and
// `api.test.mjs` both assert them, and that is where a wrong model is caught. What this
// file is for is whether the PAGE renders what the model says, and a page built from a
// stale bundle now fails here exactly as it should: the derivation reads the live model,
// the assertions read the shipped HTML, and drift between them is the finding.
const AXES = EVIDENCE_AXES.length;
const darkOf = (r: ReturnType<typeof buildCoverageReport>) =>
  r.findings.filter((f) => f.coverage === "needs_instrumentation").length;
const notSourcedOf = (r: ReturnType<typeof buildCoverageReport>) =>
  r.findings.filter((f) => f.coverage === "not_sourced").length;
/** The estate the page opens on. */
const WEDGE = buildCoverageReport(["identity", "device_management"]);
/** …plus the one plane the toggle test turns on. */
const WEDGE_WFM = buildCoverageReport(["identity", "device_management", "workforce_management"]);
/** The honest opening position: nothing declared. */
const EMPTY = buildCoverageReport([]);
const denominator = (r: ReturnType<typeof buildCoverageReport>, rows: number) =>
  `${r.answerable} + ${darkOf(r)} + ${notSourcedOf(r)} = ${rows} evidence axes`;

/** Every non-file request the page attempted. Must stay empty — see the first test. */
let offPageRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  offPageRequests = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file://")) return route.continue();
    offPageRequests.push(url);
    return route.abort();
  });
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
});

async function stat(page: Page, testId: string): Promise<number> {
  return Number((await page.getByTestId(testId).innerText()).trim());
}

function planeToggle(page: Page, name: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${name}`) });
}

/** The card that OWNS a stat value — used to pin value and caption together. */
function statCard(page: Page, testId: string): Locator {
  return page.locator(".stat").filter({ has: page.getByTestId(testId) });
}

test("the page reaches nothing outside itself", async ({ page }) => {
  // The route handler above aborts off-page requests, and the first version of this file
  // stopped there — which meant a page that grew a webfont, a logo or an analytics beacon
  // would be silently neutered by the test and ship green to a public marketing domain.
  // Aborting is the setup; this assertion is the test.
  await page.waitForTimeout(250);
  expect(offPageRequests).toEqual([]);
});

test("the standalone page renders the real model, not an empty shell", async ({ page }) => {
  await expect(page).toHaveTitle("SignalGrid — Evidence Coverage");

  // The axis rows and plane toggles prove the bundled model was linked in and iterated;
  // the two assertions below carry the counts. A build that resolved the import to
  // nothing produces a valid, blank page.
  await expect(page.locator("tbody tr")).toHaveCount(AXES);
  await expect(page.locator("button.p")).toHaveCount(7);

  // Opens on the wedge, with the figures pinned by equality in proof:evidence-coverage
  // and api.test.mjs. Three surfaces, one set of numbers.
  expect(await stat(page, "stat-answerable")).toBe(WEDGE.answerable);
  expect(await stat(page, "stat-dark")).toBe(darkOf(WEDGE));
  expect(await stat(page, "stat-not-sourced")).toBe(notSourcedOf(WEDGE));
  expect(await stat(page, "stat-silent-holes")).toBe(WEDGE.silentHoles);

  // Each value sits with ITS OWN caption. Swapping two captions leaves every number and
  // every test id correct and tells the reader "10 dark, 6 answerable".
  await expect(statCard(page, "stat-answerable")).toContainText("answerable");
  await expect(statCard(page, "stat-dark")).toContainText("dark");
  await expect(statCard(page, "stat-not-sourced")).toContainText("not sourced");

  // The denominator is tied to what is actually on screen AND to the live model, so it
  // cannot print a sum that does not add up in either direction.
  const rows = await page.locator("tbody tr").count();
  await expect(page.getByTestId("coverage-denominator")).toContainText(denominator(WEDGE, rows));

  // The toggles must agree with the report they produced.
  await expect(planeToggle(page, "Identity")).toHaveAttribute("aria-pressed", "true");
  await expect(planeToggle(page, "Dock Hardware")).toHaveAttribute("aria-pressed", "false");

  // Each plane asks its OWN question. A swapped pair would put "are the devices returned
  // to instrumented cradles?" under the Identity heading.
  await expect(planeToggle(page, "Identity")).toContainText("identity provider");
  await expect(planeToggle(page, "Dock Hardware")).toContainText("cradles");
});

test("the visible coverage labels say what the data attributes say", async ({ page }) => {
  // Inverting COVERAGE_LABEL renders all 21 badges backwards and changes no attribute.
  for (const [coverage, label] of [
    ["answerable", "answerable"],
    ["needs_instrumentation", "dark"],
    ["not_sourced", "not sourced"],
  ] as const) {
    const rows = page.locator(`tr[data-coverage="${coverage}"]`);
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      await expect(rows.nth(i).locator(".badge")).toHaveText(label);
    }
  }
});

test("silent holes rank first, say what they are, and name what would answer them", async ({
  page,
}) => {
  const holes = page.locator('tr[data-silent-hole="true"]');
  await expect(holes).toHaveCount(WEDGE.silentHoles);
  await expect(page.locator("tbody tr").first()).toHaveAttribute("data-silent-hole", "true");
  await expect(page.locator("tbody tr").last()).toHaveAttribute("data-coverage", "not_sourced");
  await expect(holes.first()).toContainText("the active rules grant when this is unknown");

  // EVERY hole names a remedy, not just the one I happened to pick. A gap with no remedy
  // beside it is a complaint, not an agenda item — and blanking that column left a
  // single-row check green.
  const n = await holes.count();
  for (let i = 0; i < n; i += 1) {
    await expect(holes.nth(i).locator("td").last()).not.toBeEmpty();
  }
  await expect(page.locator('tr[data-axis="shiftContext"] td:last-child')).toContainText(
    "Workforce Management",
  );

  // An axis two planes can answer must read "or". "and" tells the prospect they need to
  // buy both when either suffices — the model's own check is `.filter(...).length > 0`.
  await expect(page.locator('tr[data-axis="custodyState"] td:last-child')).toHaveText(
    "Badge Custody or Dock Hardware",
  );

  // The headline states the subset relation against the real dark count.
  await expect(page.locator(".headline")).toContainText(`silent holes — of the ${darkOf(WEDGE)} dark axes`);

  // Posed by the calling app — must stay NOT SOURCED rather than inflating the gap count.
  const posed = page.locator('tr[data-axis="workflowRiskTier"]');
  await expect(posed).toHaveAttribute("data-coverage", "not_sourced");
  await expect(posed).toHaveAttribute("data-silent-hole", "false");
});

test("declaring and undeclaring planes moves the report, down to the empty estate", async ({
  page,
}) => {
  const shift = page.locator('tr[data-axis="shiftContext"]');
  await expect(shift).toHaveAttribute("data-coverage", "needs_instrumentation");

  await planeToggle(page, "Workforce Management").click();
  await expect(shift).toHaveAttribute("data-coverage", "answerable");
  await expect(planeToggle(page, "Workforce Management")).toHaveAttribute("aria-pressed", "true");
  expect(await stat(page, "stat-silent-holes")).toBe(WEDGE_WFM.silentHoles);

  // Strip the estate to nothing: the honest opening position, and proof the page cannot
  // flatter — the numbers only get worse as the estate thins.
  for (const plane of ["Workforce Management", "Identity", "Device Management"]) {
    await planeToggle(page, plane).click();
  }
  expect(await stat(page, "stat-answerable")).toBe(EMPTY.answerable);
  expect(await stat(page, "stat-silent-holes")).toBe(EMPTY.silentHoles);
  expect(await stat(page, "stat-dark")).toBe(darkOf(EMPTY));
  await expect(page.getByTestId("coverage-denominator")).toContainText(denominator(EMPTY, AXES));
  // NON-VACUITY: an empty estate must answer NOTHING, or every derivation above could be
  // reading a report that quietly agrees with any page.
  expect(EMPTY.answerable).toBe(0);
});

test("a keyboard user can work the toggles without losing their place", async ({ page }) => {
  // The first version rebuilt every button on each press, so the element holding focus was
  // destroyed mid-interaction and `activeElement` fell back to <body>: reaching the second
  // toggle meant tabbing from the top of the document again, every time. `page.click()`
  // cannot see that, which is why this is asserted on focus rather than on the report.
  await page.locator("button.p").first().focus();
  const first = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.plane);
  expect(first).toBeTruthy();

  // Read the state and assert it FLIPPED. The first version asserted the literal "false",
  // which encoded a guess about which plane sorts first (`KNOWN_SOURCE_PLANES` is sorted,
  // so it is badge_custody — undeclared by default, so pressing it makes it true). A test
  // that hardcodes the answer breaks when the plane list grows, for no defect.
  const before = await page
    .locator(`button.p[data-plane="${first}"]`)
    .getAttribute("aria-pressed");
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.plane),
  ).toBe(first);
  await expect(page.locator(`button.p[data-plane="${first}"]`)).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );

  // Tab moves on to the NEXT toggle, which only holds if focus never left.
  await page.keyboard.press("Tab");
  const second = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.plane);
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);

  // The report is replaced wholesale on every press; without a live region a screen reader
  // is told the control changed and never told the answer did.
  await expect(page.locator("#report")).toHaveAttribute("aria-live", "polite");
});
