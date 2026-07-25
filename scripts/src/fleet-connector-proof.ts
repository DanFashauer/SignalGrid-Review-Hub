// Proof: the Fleet (open-source, osquery-based MDM) posture connector
// (@workspace/fleet-connector).
//
//   • maps Fleet host reports to the core's decision dimensions (managed,
//     compliance, baseline, freshness) + supervision-aware `enforceable`;
//   • fail-closed — a weak posture (unmanaged, unsupervised, encryption off, OS
//     below floor, screen lock off, stale/missing check-in) can only RAISE
//     assurance (auto → step-up), never lower it;
//   • deterministic — normalization is pure over an injected observation time;
//   • the summary is one-glance correct.
//
// Run: pnpm --filter @workspace/scripts run proof:fleet-connector

import {
  normalizeFleetReport,
  normalizeFleetReports,
  fleetSummary,
  DEMO_FLEET_REPORTS,
  FLEET_OBSERVED_AT,
  type FleetHostReport,
} from "@workspace/fleet-connector";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const signals = normalizeFleetReports(DEMO_FLEET_REPORTS, FLEET_OBSERVED_AT);
const byRef = (ref: string) => signals.find((s) => s.hostRef === ref)!;

// ── healthy host: everything maps to the trusting values, no raise ────────────
const healthy = byRef("ipad-ward-01");
check("enrolled → managed", healthy.deviceManaged === true);
check("supervised → enforceable", healthy.enforceable === true);
check("encrypted+lock+floor → compliant", healthy.deviceCompliance === "compliant");
check("encrypted → baseline aligned", healthy.baselineCompliance === "aligned");
check("fresh check-in → freshness fresh", healthy.postureFreshness === "fresh");
check("healthy posture → assurance standard (no raise)", healthy.assurance === "standard");

// ── disk encryption off → non-compliant + drift + raise ───────────────────────
check("disk off → non_compliant", byRef("ipad-ward-02").deviceCompliance === "non_compliant");
check("disk off → baseline drifted", byRef("ipad-ward-02").baselineCompliance === "drifted");
check("disk off → raise step-up", byRef("ipad-ward-02").assurance === "raise_step_up");

// ── screen lock off → non-compliant + raise ───────────────────────────────────
check("screen lock off → non_compliant", byRef("ipad-ward-03").deviceCompliance === "non_compliant");
check("screen lock off → raise step-up", byRef("ipad-ward-03").assurance === "raise_step_up");

// ── OS below floor → non-compliant + raise ────────────────────────────────────
check("OS below floor → non_compliant", byRef("ipad-ward-04").deviceCompliance === "non_compliant");
check("OS below floor → raise step-up", byRef("ipad-ward-04").assurance === "raise_step_up");

// ── UNSUPERVISED (the enforcement axis) → not enforceable + raise ─────────────
// A clean-posture host that is NOT supervised can't be kiosked/allowlisted/made
// non-removable, so trust it less for a sensitive action even though disk/OS/lock
// are fine.
const byod = byRef("ipad-byod-01");
check("unsupervised → not enforceable", byod.enforceable === false);
check("unsupervised (otherwise clean) → raise step-up", byod.assurance === "raise_step_up");
check("unsupervised is still MDM-managed", byod.deviceManaged === true);

// ── freshness mapping + raise ─────────────────────────────────────────────────
check("stale check-in → freshness stale", byRef("ipad-ward-05").postureFreshness === "stale");
check("stale → raise step-up", byRef("ipad-ward-05").assurance === "raise_step_up");
check("never-seen → freshness missing", byRef("ipad-ward-06").postureFreshness === "missing");
check("unknown disk → compliance unknown", byRef("ipad-ward-06").deviceCompliance === "unknown");
check("never-seen → raise step-up", byRef("ipad-ward-06").assurance === "raise_step_up");

// ── unenrolled → not managed + not enforceable + raise ────────────────────────
check("unenrolled → not managed", byRef("iphone-personal-01").deviceManaged === false);
check("unenrolled → not enforceable", byRef("iphone-personal-01").enforceable === false);
check("unenrolled → raise step-up", byRef("iphone-personal-01").assurance === "raise_step_up");

// ── SAFETY: a weak posture NEVER yields assurance 'standard' ───────────────────
check("SAFETY: only the fully-healthy+supervised host is assurance standard",
  signals.filter((s) => s.assurance === "standard").length === 1);

// ── fail-closed on a future-dated report (don't trust it) ─────────────────────
const future: FleetHostReport = { hostRef: "ipad-future", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "on", osMajor: 26, osFloor: 26, lastSeenAt: "2099-01-01T00:00:00.000Z" };
const fs = normalizeFleetReport(future, FLEET_OBSERVED_AT);
check("future-dated check-in → freshness unknown (not fresh)", fs.postureFreshness === "unknown");
check("future-dated check-in → raise step-up (fail closed)", fs.assurance === "raise_step_up");

// ── determinism ───────────────────────────────────────────────────────────────
check("normalization is deterministic", JSON.stringify(normalizeFleetReports(DEMO_FLEET_REPORTS, FLEET_OBSERVED_AT)) === JSON.stringify(signals));

// ── summary ───────────────────────────────────────────────────────────────────
const sum = fleetSummary(signals, DEMO_FLEET_REPORTS);
check("summary counts 8 hosts", sum.hosts === 8);
check("summary counts 7 managed", sum.managed === 7);
check("summary counts 6 enforceable (supervised)", sum.enforceable === 6);
check("summary counts 5 disk-encrypted", sum.diskEncrypted === 5);
check("summary counts 3 non-compliant", sum.nonCompliant === 3);
check("summary raiseStepUp = all but the one healthy+supervised host", sum.raiseStepUp === 7);

const total = passed + failures.length;
console.log(`Fleet-connector proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Fleet host posture normalizes to decision dimensions, fail-closed (weak/unsupervised posture only raises assurance).");
