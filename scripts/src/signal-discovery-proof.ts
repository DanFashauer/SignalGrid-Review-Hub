// Proof: the signal-discovery + auto-onboarding tool (@workspace/signal-discovery).
//
//   • classify detected signals as recognised / candidate / novel (via radar);
//   • auto-onboard an unrecognised signal ONLY when its source has an API;
//   • a no-API source's signals are flagged for an admin (never silently added);
//   • already-active signals are passed through untouched;
//   • the summary is one-glance correct; discovery is deterministic.
//
// Run: pnpm --filter @workspace/scripts run proof:signal-discovery

import {
  discover,
  planOnboarding,
  discoverySummary,
  DEMO_SOURCES,
  DEMO_OBSERVED,
} from "@workspace/signal-discovery";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const discovered = discover(DEMO_OBSERVED, DEMO_SOURCES);
const find = (cat: string) => discovered.find((d) => d.category === cat);

// ── classification + staging ─────────────────────────────────────────────────
check("recognised signal is active, not onboardable", find("identity_state")?.class === "evaluated" && find("identity_state")?.lifecycle === "active" && find("identity_state")?.autoOnboardable === false);
check("candidate from an API source is proposed + auto-onboardable", find("network_posture")?.class === "candidate" && find("network_posture")?.autoOnboardable === true);
check("novel from a connector source is auto-onboardable", find("vehicle_telemetry")?.class === "novel" && find("vehicle_telemetry")?.autoOnboardable === true);
check("candidate from a no-API source needs an admin", find("environment_state")?.class === "candidate" && find("environment_state")?.autoOnboardable === false);
check("novel from a no-API source needs an admin", find("coolant_pressure")?.class === "novel" && find("coolant_pressure")?.autoOnboardable === false);
check("auto-onboardable recommendation names the source + pull method", find("network_posture")?.recommendation.includes("EDR sensor") === true);

// ── onboarding plan ──────────────────────────────────────────────────────────
const plan = planOnboarding(discovered);
check("auto-onboarded signals advance to lifecycle 'onboarded'", plan.onboarded.every((d) => d.lifecycle === "onboarded"));
check("exactly the API-source unrecognised signals were auto-onboarded",
  plan.onboarded.map((d) => d.category).sort().join(",") === "network_posture,vehicle_telemetry");
check("SAFETY: no-API signals are NOT auto-added (await an admin)",
  plan.needsAdmin.map((d) => d.category).sort().join(",") === "coolant_pressure,environment_state" &&
  plan.onboarded.every((d) => d.category !== "coolant_pressure" && d.category !== "environment_state"));
check("already-active signals pass through untouched", plan.alreadyActive.every((d) => d.class === "evaluated" && d.lifecycle === "active"));

// ── summary ──────────────────────────────────────────────────────────────────
const sum = discoverySummary(discovered, DEMO_SOURCES);
check("summary counts add up", sum.recognized + sum.candidate + sum.novel === sum.detected);
check("summary: 2 recognised, 2 candidate, 2 novel", sum.recognized === 2 && sum.candidate === 2 && sum.novel === 2);
check("summary: 2 auto-onboardable, 2 need admin", sum.autoOnboardable === 2 && sum.needsAdmin === 2);

// ── dedup + determinism ──────────────────────────────────────────────────────
check("duplicate observations collapse to one", discover([...DEMO_OBSERVED, ...DEMO_OBSERVED], DEMO_SOURCES).length === discovered.length);
check("discovery is deterministic", JSON.stringify(discover(DEMO_OBSERVED, DEMO_SOURCES)) === JSON.stringify(discovered));
check("auto-onboardable signals are listed first", (() => { const firstNonAuto = discovered.findIndex((d) => !d.autoOnboardable); return firstNonAuto === -1 || discovered.slice(firstNonAuto).every((d) => !d.autoOnboardable); })());

const total = passed + failures.length;
console.log(`Signal-discovery proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Signal discovery + auto-onboarding verified (classify, auto-pull with API, admin-gate without, lifecycle).");
