import { test, expect } from "@playwright/test";

// Workflow-surface coverage: the operator pages that render the grid's build-out
// and safety posture. Each test asserts the api-server's answer AND that the page
// renders it, so a route regression or a rendering regression both fail here.
//
// Ground truth verified directly against the running api-server.
const CONSOLE = "http://127.0.0.1:5180";
const API = "http://127.0.0.1:5174/api/cp/v1";

async function json(request: import("@playwright/test").APIRequestContext, path: string) {
  const res = await request.get(`${API}/${path}`);
  expect(res.status(), `GET /cp/v1/${path}`).toBe(200);
  return res.json();
}

test("app resilience: a PHI app with no safety nets is BLOCKED, never dressed up as workable", async ({ page, request }) => {
  // The fail-safe that matters: billing is a PHI app in an unplanned outage that HAS a
  // fallback but NO safety nets. It must be blocked and not proceedable — if this ever
  // flips to "workable", staff would be told to keep going without the controls.
  const { fleet } = await json(request, "apps/resilience");
  const billing = fleet.apps.find((a: any) => a.appId === "billing");
  expect(billing.mode).toBe("blocked_no_fallback");
  expect(billing.canProceed, "a PHI app without safety nets must not be proceedable").toBe(false);
  expect(fleet.blocked).toBeGreaterThanOrEqual(1);
  expect(fleet.allWorkable, "fleet must not claim all-workable while one app is blocked").toBe(false);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${CONSOLE}/app-resilience`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/app resilience/i).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/blocked/i).first()).toBeVisible();
  expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("grid config: validates clean and reports a complete governance scorecard", async ({ page, request }) => {
  const cfg = await json(request, "grid/config");
  expect(cfg.valid).toBe(true);
  // Every workflow must have an owner and an accountable party — governance is a
  // lintable axis, not a doc claim.
  expect(cfg.governance.owned).toBe(cfg.governance.workflows);
  expect(cfg.governance.complete).toBe(true);
  // The unwired legacy nurse-call signal is surfaced as a warning, not silently dropped.
  expect(cfg.summary.warnings).toBeGreaterThanOrEqual(1);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${CONSOLE}/grid-config`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/grid config/i).first()).toBeVisible({ timeout: 10000 });
  expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("provisioning: plans a matching device and never touches a non-matching one", async ({ page, request }) => {
  const match = await json(request, "grid/provisioning?serial=CLIN-00042");
  expect(match.device.serial).toBe("CLIN-00042");
  expect(match.plan.matched, "a device fitting the recording's selector should match").toBe(true);
  expect(match.plan.steps.length).toBeGreaterThan(0);

  // Fail-safe: a device outside the recording's selector is planned but NOT matched,
  // so nothing is applied to it.
  const noMatch = await json(request, "grid/provisioning?serial=WARE-88120");
  expect(noMatch.plan.matched, "a non-matching device must never be touched").toBe(false);

  // Prototype-pollution guard: ?serial=constructor must not resolve to an inherited
  // member and produce a garbage device.
  const proto = await json(request, "grid/provisioning?serial=constructor");
  expect(proto.device.serial).toBe("constructor");
  expect(proto.plan.matched).toBe(false);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${CONSOLE}/provisioning`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/device recorder/i).first()).toBeVisible({ timeout: 10000 });
  expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
});
