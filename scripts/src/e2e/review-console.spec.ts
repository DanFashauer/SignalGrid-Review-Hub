import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * signalgrid-review (operator/review console) — browser-level E2E.
 *
 * The console runs the deterministic decision core IN the browser: fifteen
 * seeded scenarios are evaluated on mount and rendered as a decision list plus
 * a full evidence trace. The unit proofs already pin the core's outcomes; what
 * only a browser can pin is that an OPERATOR actually sees them — the outcome
 * badge, the reason code, and the evidence rows that justify a RESTRICT.
 */

// Must match PORTS.review in ../../playwright.config.ts (same env var).
const PORT = Number(process.env.E2E_REVIEW_PORT ?? 4611);
const BASE = `http://localhost:${PORT}`;

// index.html references Google Fonts. Block everything non-localhost so the
// assertions witness only what we serve — a CDN hiccup must never be able to
// masquerade as an app regression (and the suite stays offline-capable).
async function blockExternal(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "localhost" || host === "127.0.0.1") return route.continue();
    return route.abort();
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternal(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
});

// All operator-console content lives inside <section id="operator-console">;
// scoping there keeps other dashboard sections from matching by accident.
function console_(page: Page): Locator {
  return page.locator("#operator-console");
}

// The decision-detail card is the only p-5/space-y-5 card carrying the
// "Decision evidence" trace title.
function detail(page: Page): Locator {
  return console_(page).locator("div.p-5.space-y-5").filter({ hasText: "Decision evidence" });
}

// An evidence row is a flex div whose first span is exactly the label; the
// second span is the value. Targeting the pair (not bare text) proves the
// label and its value render TOGETHER, the way an operator reads them.
function evidenceRow(scope: Locator, label: string): Locator {
  return scope.locator(`div:has(> span:text-is("${label}"))`);
}

function decisionRow(page: Page, label: string): Locator {
  return console_(page).locator("button").filter({ hasText: label });
}

test("dashboard shell renders real content, not a blank mount", async ({ page }) => {
  await expect(page).toHaveTitle("SignalGrid Second-Opinion Review");
  await expect(page.locator("h1").first()).toContainText("SignalGrid");
  // The nav proves the full dashboard hydrated, not just the header.
  // (Nav items are anchor links to in-page section ids.)
  await expect(page.getByRole("link", { name: "Operator Console" }).first()).toBeVisible();
});

test("operator console lists the seeded decisions with outcome badges and reason codes", async ({ page }) => {
  const c = console_(page);
  // The count renders from the evaluated scenario list — digits prove the
  // in-browser core actually ran, without pinning the exact scenario count
  // (adding a scenario must not break this line).
  await expect(c.getByText(/^Decisions \(\d+\)$/)).toBeVisible();

  // One row per outcome class, each with its badge AND its reason code —
  // the pair is what makes a decision reviewable rather than just colored.
  await expect(decisionRow(page, "Compliant nurse · clinical session")).toContainText("ALLOW");
  await expect(decisionRow(page, "Compliant nurse · clinical session")).toContainText("TRUST_ESTABLISHED");

  await expect(decisionRow(page, "Non-compliant device")).toContainText("RESTRICT");
  await expect(decisionRow(page, "Non-compliant device")).toContainText("DEVICE_NONCOMPLIANT");

  await expect(decisionRow(page, "Critically low battery (DockBridge)")).toContainText("STEP-UP");
  await expect(decisionRow(page, "Critically low battery (DockBridge)")).toContainText("BATTERY_CRITICAL");

  await expect(decisionRow(page, "Disabled account")).toContainText("DENY");
  await expect(decisionRow(page, "Disabled account")).toContainText("IDENTITY_DISABLED");
});

test("a RESTRICT decision renders its reason code and full evidence trace", async ({ page }) => {
  await decisionRow(page, "Non-compliant device").click();
  const d = detail(page);

  // Outcome + reason code visible in the detail pane (the task's RESTRICT
  // requirement): the operator sees WHAT was decided and WHY, together.
  await expect(d).toContainText("RESTRICT");
  await expect(d).toContainText("DEVICE_NONCOMPLIANT");

  // The decision-evidence surface: labeled rows with the values that caused
  // the outcome, plus the integrity fields that make the trace trustworthy.
  await expect(evidenceRow(d, "Compliance")).toContainText("non_compliant");
  await expect(evidenceRow(d, "Device managed")).toContainText("true");
  await expect(evidenceRow(d, "Critical evidence intact")).toContainText("true");
  await expect(evidenceRow(d, "Snapshot integrity")).toContainText("verified");
  await expect(evidenceRow(d, "Snapshot digest")).toBeVisible();
});

test("battery charge evidence renders for the critically-low-battery decision", async ({ page }) => {
  await decisionRow(page, "Critically low battery (DockBridge)").click();
  const d = detail(page);

  await expect(d).toContainText("STEP-UP");
  await expect(d).toContainText("BATTERY_CRITICAL");
  await expect(evidenceRow(d, "Battery charge")).toContainText("critical");

  // Negative control: this device reports NO battery-health reading, and the
  // console must not fabricate one — `unknown` stays hidden rather than being
  // dressed up as healthy. (Same anti-fabrication property the core proof
  // pins; this is the operator-facing half of it.)
  await expect(evidenceRow(d, "Battery health")).toHaveCount(0);
});

test("a failing-battery device surfaces the Battery health row with its RESTRICT reason", async ({ page }) => {
  // The core seeds a device that reads fully CHARGED with a FAILING battery
  // (ipad-loan-04) precisely so charge and health cannot be conflated. The
  // operator console must carry that distinction to the human: a decision row
  // reason-coded BATTERY_FAILING, and a "Battery health" evidence row in its
  // trace — otherwise the operator sees a RESTRICT with no visible cause.
  const failingRow = console_(page)
    .locator("button")
    .filter({ hasText: "BATTERY_FAILING" });
  await expect(
    failingRow.first(),
    "operator console must list a failing-battery decision (reason code BATTERY_FAILING); " +
      "the core seeds one (nurse.failbatt / ipad-loan-04) but no console scenario evaluates it",
  ).toBeVisible();

  await failingRow.first().click();
  const d = detail(page);
  await expect(d).toContainText("RESTRICT");
  await expect(d).toContainText("BATTERY_FAILING");
  await expect(evidenceRow(d, "Battery health")).toContainText("failing");
});

test("audit chain and operations panels render verified, non-empty state", async ({ page }) => {
  const c = console_(page);

  // Tamper-evident audit chain reports VERIFIED — in the UI, not just the proof.
  await expect(c.getByText("Audit chain (Northwind tenant)")).toBeVisible();
  await expect(c.getByText("VERIFIED", { exact: true })).toBeVisible();
  await expect(c.getByText(/tamper-evident events, digest-chained\./)).toBeVisible();

  // Metrics tiles carry the operational read-outs an operator scans first.
  await expect(c.getByText("p95 latency")).toBeVisible();
  await expect(c.getByText("With policy version")).toBeVisible();

  // The remediation queue keeps its safety promise on-screen.
  await expect(c.getByText("SignalGrid never executes a change.")).toBeVisible();
});

test("the continuity panel shows the offline device LOSING to the connected deny", async ({ page }) => {
  // The panel runs the real reconciler in the browser, so this asserts the thing a
  // reviewer would otherwise have to take on faith: that the case which distinguishes
  // this from last-write-wins actually resolves the way the docs say. Written as a
  // browser assertion for the same reason the Battery health row was — the core can be
  // right while nothing on screen says so.
  const c = console_(page);
  await expect(
    c.getByText("Decision continuity — which decision wins after a partition"),
  ).toBeVisible();

  const offlineCase = c
    .locator("div")
    .filter({ hasText: /^Offline device holds the NEWER policy and says allow/ })
    .first();
  await expect(offlineCase).toBeVisible();
  // Both sides are shown with their provenance, so the reader can see that the losing
  // record is the NEWER one — which is the whole point of the case.
  await expect(offlineCase).toContainText("p8/c2 said ALLOW");
  await expect(offlineCase).toContainText("p7/c2 said DENY");
  await expect(offlineCase).toContainText("OFFLINE_AUTHORITY_CANNOT_RELAX");

  // And the un-stick path is on screen too, so the panel cannot be read as
  // "restriction always wins" — a lattice that could only tighten would be useless.
  await expect(c.getByText("NEWER_PROVENANCE_RELAXED_STALE_DECISION")).toBeVisible();

  // Silence about an offline decision's age expires it rather than granting it standing.
  await expect(c.getByText("OFFLINE_STANDING_AGE_UNSTATED")).toBeVisible();
});
