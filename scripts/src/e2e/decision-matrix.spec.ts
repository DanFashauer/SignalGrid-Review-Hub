import { test, expect } from "@playwright/test";

// The full seeded-scenario matrix through the live decision panel. admin-console
// .spec.ts pins one RESTRICT in depth (evidence trace, reason rendering); this
// covers every preset so a shift anywhere in the outcome space is caught —
// including the two that must never silently soften: DENY and ALLOW.
//
// Ground truth verified against POST /api/v1/decisions/evaluate.
// Must match PORTS.admin in ../../playwright.config.ts.
const CONSOLE = `http://localhost:${Number(process.env.E2E_ADMIN_PORT ?? 4614)}`;

const SCENARIOS = [
  { button: "Compliant nurse", outcome: "ALLOW", reason: "TRUST_ESTABLISHED" },
  { button: "Non-compliant device", outcome: "RESTRICT", reason: "DEVICE_NONCOMPLIANT" },
  { button: "Badge withdrawn", outcome: "RESTRICT", reason: "BADGE_REMOVED" },
  { button: "Tamper flag", outcome: "RESTRICT", reason: "TAMPER_SUSPECTED" },
  { button: "Disabled account", outcome: "DENY", reason: "IDENTITY_DISABLED" },
];

for (const s of SCENARIOS) {
  test(`"${s.button}" evaluates to ${s.outcome} · ${s.reason}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${CONSOLE}/`, { waitUntil: "domcontentloaded" });

    const evaluated = page.waitForResponse(
      (r) => r.url().includes("/v1/decisions/evaluate") && r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: new RegExp(s.button, "i") }).click();
    const res = await evaluated;

    // Assert the call succeeded first: a 4xx renders as an error panel, which
    // would otherwise satisfy a looser "something rendered" check.
    expect(res.status(), `POST /v1/decisions/evaluate for "${s.button}"`).toBe(200);
    const { decision } = await res.json();
    expect(decision.outcome.toUpperCase().replace("_", "-")).toBe(s.outcome);
    expect(decision.reasonCodes, `core reason codes for "${s.button}"`).toContain(s.reason);

    // …and the console must RENDER that verdict, not merely receive it.
    await expect(page.getByText(s.outcome, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(s.reason, { exact: true }).first()).toBeVisible();

    expect(errors, `no page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
}
