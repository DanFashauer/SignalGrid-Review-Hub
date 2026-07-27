import { test, expect } from "@playwright/test";

// Deep full-stack assertion: drive the user console's "Live decision · /v1 core"
// panel through every seeded scenario and assert the RENDERED verdict matches what
// the deterministic decision core actually returns — outcome AND reason code.
//
// This is the real product contract, not a smoke test: browser → console → the
// authenticated /v1 decision surface → decision core → DOM. If the core's
// semantics regress (a deny silently becomes an allow), this fails.
//
// Ground truth verified directly against POST /api/v1/decisions/evaluate.
const USER_CONSOLE = "http://127.0.0.1:5180/";

const SCENARIOS = [
  { button: "Compliant nurse", outcome: "ALLOW", reason: "TRUST_ESTABLISHED" },
  { button: "Non-compliant device", outcome: "RESTRICT", reason: "DEVICE_NONCOMPLIANT" },
  { button: "Badge withdrawn", outcome: "RESTRICT", reason: "BADGE_REMOVED" },
  { button: "Tamper flag", outcome: "RESTRICT", reason: "TAMPER_SUSPECTED" },
  { button: "Disabled account", outcome: "DENY", reason: "IDENTITY_DISABLED" },
];

test.describe("live decision core → user console", () => {
  for (const s of SCENARIOS) {
    test(`"${s.button}" renders ${s.outcome} · ${s.reason}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));

      await page.goto(USER_CONSOLE, { waitUntil: "domcontentloaded" });

      const panel = page.locator("div").filter({ hasText: /live decision/i }).last();
      await expect(panel).toBeVisible();

      // Evaluate this scenario against the real core.
      const evaluated = page.waitForResponse(
        (r) => r.url().includes("/v1/decisions/evaluate") && r.request().method() === "POST",
        { timeout: 15000 },
      );
      await page.getByRole("button", { name: new RegExp(s.button, "i") }).click();
      const res = await evaluated;

      // The API itself must have succeeded (a 4xx would otherwise render as an
      // error panel and silently pass a looser assertion).
      expect(res.status(), `POST /v1/decisions/evaluate for "${s.button}"`).toBe(200);
      const decision = (await res.json()).decision;
      expect(decision.outcome.toUpperCase().replace("_", "-")).toBe(s.outcome);
      expect(decision.reasonCodes, `core reason codes for "${s.button}"`).toContain(s.reason);

      // …and the console must RENDER that verdict, not just receive it.
      await expect(page.getByText(s.outcome, { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(s.reason, { exact: true }).first()).toBeVisible();

      expect(pageErrors, `no page errors: ${pageErrors.join(" | ")}`).toHaveLength(0);
    });
  }
});
