// Proof: application resilience (@workspace/flows) — keep staff working through
// cloud-app downtime, PHI-safely.
//
// Verifies the fail-safe rules that turn an app's availability into a resilience
// decision: available → normal; degraded/unknown → proceed-but-watch (never
// silently "healthy"); a maintenance window or unplanned outage → a downtime
// fallback ONLY when one is prepared AND, for a PHI app, its DR safety nets are
// configured — otherwise BLOCKED (surfaced, never an unsafe PHI workaround). The
// headline invariant: a PHI app is never placed on a fallback without safety nets.
//
// Run: pnpm --filter @workspace/scripts run proof:app-resilience

import {
  fleetResilience,
  resolveAppResilience,
  type AppService,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

const app = (over: Partial<AppService>): AppService => ({
  id: over.id ?? "ehr", name: over.name ?? "EHR", availability: over.availability ?? "available",
  hasFallback: over.hasFallback ?? false, handlesPhi: over.handlesPhi ?? false, safetyNets: over.safetyNets,
});

console.log("Application resilience proof");

// available → normal, staff work.
const avail = resolveAppResilience(app({ availability: "available" }));
check("available → normal, canProceed", avail.mode === "normal" && avail.canProceed);

// degraded → proceed but watch.
const deg = resolveAppResilience(app({ availability: "degraded" }));
check("degraded → degraded_monitor, canProceed", deg.mode === "degraded_monitor" && deg.canProceed);

// unknown → proceed but flagged, never silently normal.
const unk = resolveAppResilience(app({ availability: "unknown" }));
check("unknown availability → degraded_monitor (never silently normal)", unk.mode === "degraded_monitor" && unk.canProceed);

// unplanned outage, non-PHI, fallback ready → downtime fallback, staff keep working.
const outNonPhi = resolveAppResilience(app({ availability: "unplanned_outage", hasFallback: true, handlesPhi: false }));
check("outage + fallback (non-PHI) → downtime_fallback, canProceed", outNonPhi.mode === "downtime_fallback" && outNonPhi.canProceed);

// planned maintenance behaves like a controlled downtime.
const maint = resolveAppResilience(app({ availability: "planned_maintenance", hasFallback: true, handlesPhi: false }));
check("planned maintenance + fallback → downtime_fallback", maint.mode === "downtime_fallback" && maint.canProceed);

// outage, no fallback → blocked (surfaced, cannot proceed).
const outNoFb = resolveAppResilience(app({ availability: "unplanned_outage", hasFallback: false }));
check("outage + NO fallback → blocked_no_fallback, cannot proceed", outNoFb.mode === "blocked_no_fallback" && !outNoFb.canProceed);

// ── the headline fail-safe: PHI app never gets an un-safety-netted fallback ────
const phiNoNets = resolveAppResilience(app({ availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: [] }));
check("PHI outage + fallback but NO safety nets → BLOCKED (fail-safe)", phiNoNets.mode === "blocked_no_fallback" && !phiNoNets.canProceed);
const phiWithNets = resolveAppResilience(app({ availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: ["DR checkpoint", "post-hoc reconciliation", "witness"] }));
check("PHI outage + fallback + safety nets → downtime_fallback, nets surfaced", phiWithNets.mode === "downtime_fallback" && phiWithNets.canProceed && phiWithNets.requiredSafetyNets.length === 3);

// Global invariant across many shapes: NEVER downtime_fallback for a PHI app with no safety nets.
const phiStates: AppService["availability"][] = ["available", "degraded", "planned_maintenance", "unplanned_outage", "unknown"];
const phiInvariant = phiStates.every((av) => {
  const p = resolveAppResilience(app({ availability: av, hasFallback: true, handlesPhi: true, safetyNets: [] }));
  return !(p.mode === "downtime_fallback");
});
check("a PHI app with no safety nets is NEVER on a downtime fallback (any availability)", phiInvariant);

// A down app is NEVER reported as able to proceed without a real path.
const downStates: AppService["availability"][] = ["planned_maintenance", "unplanned_outage"];
const downInvariant = downStates.every((av) => {
  const noFb = resolveAppResilience(app({ availability: av, hasFallback: false }));
  return noFb.mode === "blocked_no_fallback" && !noFb.canProceed;
});
check("a down app with no fallback can never proceed", downInvariant);

// ── fleet rollup ──────────────────────────────────────────────────────────────
const suite: AppService[] = [
  app({ id: "ehr", name: "EHR", availability: "available", handlesPhi: true }),
  app({ id: "bcma", name: "BCMA", availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: ["reconciliation", "witness"] }),
  app({ id: "his", name: "HIS", availability: "degraded" }),
  app({ id: "billing", name: "Billing", availability: "unplanned_outage", hasFallback: false, handlesPhi: true }),
];
const fleet = fleetResilience(suite);
check("fleet rollup partitions the suite", fleet.normal + fleet.degraded + fleet.onFallback + fleet.blocked === fleet.total);
check("fleet workable = normal + degraded + fallback", fleet.workable === fleet.normal + fleet.degraded + fleet.onFallback);
check("fleet with a blocked app is not allWorkable", fleet.blocked === 1 && fleet.allWorkable === false);
const allUp = fleetResilience([app({ availability: "available" }), app({ id: "b", availability: "degraded" })]);
check("a fleet with no blocked apps is allWorkable", allUp.allWorkable === true);
check("an empty fleet is not allWorkable (nothing to run)", fleetResilience([]).allWorkable === false);

// ── determinism ──────────────────────────────────────────────────────────────
const d1 = resolveAppResilience(app({ availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: ["x"] }));
const d2 = resolveAppResilience(app({ availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: ["x"] }));
check("resolution is deterministic", JSON.stringify(d1) === JSON.stringify(d2));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
