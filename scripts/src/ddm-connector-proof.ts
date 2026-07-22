// Proof: the DDM / device-health connector (@workspace/ddm-connector).
//
//   • maps DDM device reports to the core's decision dimensions (managed,
//     compliance, baseline, freshness);
//   • fail-closed — a weak posture (permissive/disabled binary control, partial/
//     missing privacy, degraded health, stale/missing check-in, unenrolled) can
//     only RAISE assurance (auto → step-up), never lower it;
//   • deterministic — normalization is pure over an injected observation time;
//   • the summary is one-glance correct.
//
// Run: pnpm --filter @workspace/scripts run proof:ddm-connector

import {
  normalizeDdmReport,
  normalizeDdmReports,
  ddmSummary,
  enforcementCurrencyOf,
  DEMO_DDM_REPORTS,
  DDM_OBSERVED_AT,
  type DdmDeviceReport,
} from "@workspace/ddm-connector";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const signals = normalizeDdmReports(DEMO_DDM_REPORTS, DDM_OBSERVED_AT);
const byRef = (ref: string) => signals.find((s) => s.deviceRef === ref)!;

// ── healthy device: everything maps to the trusting values, no raise ──────────
const healthy = byRef("mac-noc-01");
check("enrolled → managed", healthy.deviceManaged === true);
check("healthy → compliant", healthy.deviceCompliance === "compliant");
check("binary enforced → baseline aligned", healthy.baselineCompliance === "aligned");
check("fresh check-in → freshness fresh", healthy.postureFreshness === "fresh");
check("healthy posture → assurance standard (no raise)", healthy.assurance === "standard");

// ── binary control not enforced → baseline drift + raise ──────────────────────
check("permissive binary control → baseline drifted", byRef("mac-noc-02").baselineCompliance === "drifted");
check("permissive → raise step-up", byRef("mac-noc-02").assurance === "raise_step_up");
check("disabled binary control → baseline drifted", byRef("mac-noc-03").baselineCompliance === "drifted");
check("disabled → raise step-up", byRef("mac-noc-03").assurance === "raise_step_up");

// ── incomplete privacy declaration → raise ────────────────────────────────────
check("partial privacy → raise step-up (posture incomplete)", byRef("mac-noc-04").assurance === "raise_step_up");
check("partial privacy keeps baseline aligned (binary still enforced)", byRef("mac-noc-04").baselineCompliance === "aligned");

// ── degraded health → non-compliant + raise ───────────────────────────────────
check("degraded health → non_compliant", byRef("mac-noc-05").deviceCompliance === "non_compliant");
check("degraded health → raise step-up", byRef("mac-noc-05").assurance === "raise_step_up");

// ── freshness mapping + raise ─────────────────────────────────────────────────
check("stale check-in → freshness stale", byRef("mac-noc-06").postureFreshness === "stale");
check("stale → raise step-up", byRef("mac-noc-06").assurance === "raise_step_up");
check("never-checked-in → freshness missing", byRef("mac-noc-07").postureFreshness === "missing");
check("unreporting → compliance unknown", byRef("mac-noc-07").deviceCompliance === "unknown");
check("unreporting → raise step-up", byRef("mac-noc-07").assurance === "raise_step_up");

// ── unenrolled → not managed + raise ──────────────────────────────────────────
check("unenrolled → not managed", byRef("mac-byod-01").deviceManaged === false);
check("unenrolled → raise step-up", byRef("mac-byod-01").assurance === "raise_step_up");

// ── update-enforcement currency (OS-27 cutover, fail-safe) ────────────────────
// THE core case: a device that looks perfect (enrolled, enforced, declared, fresh)
// but whose update enforcement is legacy on OS 27 — silently a no-op. "Compliant"
// is not trustworthy, so it must raise, not pass as standard.
check("legacy enforcement on OS 27 → currency dead", byRef("mac-noc-08").enforcementCurrency === "dead");
check("SILENT-DEATH CASE: an otherwise-perfect device with dead enforcement raises step-up", byRef("mac-noc-08").assurance === "raise_step_up");
check("legacy enforcement on pre-27 → currency at_risk (dies on upgrade)", byRef("mac-noc-09").enforcementCurrency === "at_risk");
check("at-risk enforcement → raise step-up", byRef("mac-noc-09").assurance === "raise_step_up");
check("no enforcement configured → currency dead", byRef("mac-noc-10").enforcementCurrency === "dead");
check("declarative enforcement → currency current", byRef("mac-noc-01").enforcementCurrency === "current");
// Fail-safe units: only an exact 'declarative' is current; everything unverifiable is not.
check("legacy + unknown OS → at_risk (cannot confirm pre-cutover, never current)", enforcementCurrencyOf({ deviceRef: "x", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: DEMO_DDM_REPORTS[0].lastCheckInAt, updateEnforcement: "legacy" }) === "at_risk");
check("unreported enforcement → currency unknown (fail-safe, raises)", byRef("mac-noc-07").enforcementCurrency === "unknown");

// ── SAFETY: a weak posture NEVER yields assurance 'standard' ───────────────────
check("SAFETY: only the fully-healthy device is assurance standard",
  signals.filter((s) => s.assurance === "standard").length === 1);

// ── fail-closed on ambiguous health (unreporting/unknown) even if otherwise ok ─
const unreporting: DdmDeviceReport = { deviceRef: "mac-unrep", enrolled: true, health: "unreporting", binaryControl: "enforced", privacy: "declared", lastCheckInAt: DEMO_DDM_REPORTS[0].lastCheckInAt };
const ur = normalizeDdmReport(unreporting, DDM_OBSERVED_AT);
check("unreporting health → compliance unknown", ur.deviceCompliance === "unknown");
check("unreporting health (otherwise healthy posture) → raise step-up (fail closed)", ur.assurance === "raise_step_up");

// ── fail-closed on a future-dated report (don't trust it) ─────────────────────
const future: DdmDeviceReport = { deviceRef: "mac-future", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: "2099-01-01T00:00:00.000Z" };
const fs = normalizeDdmReport(future, DDM_OBSERVED_AT);
check("future-dated check-in → freshness unknown (not fresh)", fs.postureFreshness === "unknown");
check("future-dated check-in → raise step-up (fail closed)", fs.assurance === "raise_step_up");

// ── determinism ───────────────────────────────────────────────────────────────
check("normalization is deterministic", JSON.stringify(normalizeDdmReports(DEMO_DDM_REPORTS, DDM_OBSERVED_AT)) === JSON.stringify(signals));

// ── summary ───────────────────────────────────────────────────────────────────
const sum = ddmSummary(signals, DEMO_DDM_REPORTS);
check("summary counts 11 devices", sum.devices === 11);
check("summary counts managed devices", sum.managed === 10);
check("summary counts binary-enforced devices", sum.binaryEnforced === 7);
check("summary counts dead update enforcement (legacy-on-27 / none)", sum.enforcementDead === 2);
check("summary counts at-risk update enforcement (legacy pre-27)", sum.enforcementAtRisk === 1);
check("summary raiseStepUp = all but the one healthy+current device", sum.raiseStepUp === 10);

const total = passed + failures.length;
console.log(`DDM-connector proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("DDM device signals normalize to decision dimensions, fail-closed (weak posture only raises assurance).");
