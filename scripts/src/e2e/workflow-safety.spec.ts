import { test, expect } from "@playwright/test";

// The workflow surfaces, asserted on their SAFETY semantics rather than on
// "the page rendered". Each test pins the api-server's answer and then checks the
// console renders it, so a route regression and a rendering regression both fail.
//
// Must match PORTS.api / PORTS.admin in ../../playwright.config.ts.
const API = `http://localhost:${Number(process.env.E2E_API_PORT ?? 4613)}/api/cp/v1`;
const CONSOLE = `http://localhost:${Number(process.env.E2E_ADMIN_PORT ?? 4614)}`;

async function cp(request: import("@playwright/test").APIRequestContext, path: string) {
  const res = await request.get(`${API}/${path}`);
  expect(res.status(), `GET /cp/v1/${path}`).toBe(200);
  return res.json();
}

test("a PHI app with no safety nets is BLOCKED, never dressed up as workable", async ({ page, request }) => {
  // The fail-safe that matters most here: `billing` is a PHI app in an unplanned
  // outage that HAS a fallback but NO safety nets. It must be blocked and not
  // proceedable — if this ever flips to "workable", staff would be told to keep
  // working without the controls that make the fallback safe.
  const { fleet } = await cp(request, "apps/resilience");
  const billing = fleet.apps.find((a: { appId: string }) => a.appId === "billing");
  expect(billing.mode).toBe("blocked_no_fallback");
  expect(billing.canProceed, "a PHI app without safety nets must not be proceedable").toBe(false);
  expect(fleet.blocked).toBeGreaterThanOrEqual(1);
  expect(fleet.allWorkable, "fleet must not claim all-workable while an app is blocked").toBe(false);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${CONSOLE}/app-resilience`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/app resilience/i).first()).toBeVisible();
  await expect(page.getByText(/blocked/i).first()).toBeVisible();
  expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("grid config validates clean with a complete governance scorecard", async ({ page, request }) => {
  const cfg = await cp(request, "grid/config");
  expect(cfg.valid).toBe(true);
  // Ownership and accountability are lintable axes, not doc claims.
  expect(cfg.governance.owned).toBe(cfg.governance.workflows);
  expect(cfg.governance.complete).toBe(true);
  // The unwired legacy nurse-call signal is surfaced as a warning, never silently
  // dropped — a gap the grid can't source must stay visible.
  expect(cfg.summary.warnings).toBeGreaterThanOrEqual(1);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${CONSOLE}/grid-config`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/grid config/i).first()).toBeVisible();
  expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("provisioning plans a matching device and never touches a non-matching one", async ({ page, request }) => {
  const match = await cp(request, "grid/provisioning?serial=CLIN-00042");
  expect(match.device.serial).toBe("CLIN-00042");
  expect(match.plan.matched, "a device fitting the recording's selector should match").toBe(true);
  expect(match.plan.steps.length).toBeGreaterThan(0);

  // Fail-safe: a device outside the selector is planned but NOT matched, so
  // nothing is ever applied to it.
  const noMatch = await cp(request, "grid/provisioning?serial=WARE-88120");
  expect(noMatch.plan.matched, "a non-matching device must never be touched").toBe(false);

  // Prototype-pollution guard: `?serial=constructor` must not resolve through the
  // prototype chain into a garbage device that then gets planned against.
  const proto = await cp(request, "grid/provisioning?serial=constructor");
  expect(proto.device.serial).toBe("constructor");
  expect(proto.plan.matched).toBe(false);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${CONSOLE}/provisioning`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/device recorder/i).first()).toBeVisible();
  expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
});
