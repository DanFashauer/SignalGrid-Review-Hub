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

check("summary: sources heard from is counted separately from sources configured",
  sum.sourcesObserved === new Set(discovered.map((d) => d.sourceId)).size && sum.sourcesObserved <= sum.sources);
// Four configured sources and NO detections used to read "sources: 4" and nothing
// else — a source that is down or credential-less looked exactly like a healthy one.
const silent = discoverySummary([], DEMO_SOURCES);
check("summary over no detections: configured 4, observed 0 — silence is visible", silent.sources === DEMO_SOURCES.length && silent.sourcesObserved === 0 && silent.detected === 0);

// ── dedup + determinism ──────────────────────────────────────────────────────
check("duplicate observations collapse to one", discover([...DEMO_OBSERVED, ...DEMO_OBSERVED], DEMO_SOURCES).length === discovered.length);
// Byte-identical duplicates are the KNOWN value; whitespace variants are the one
// that used to inflate "recognized" to three for one signal type (the dedupe key
// was the raw string while the classifier trimmed it).
const variants = discover([
  { sourceId: DEMO_OBSERVED[0]!.sourceId, category: "identity_state" },
  { sourceId: DEMO_OBSERVED[0]!.sourceId, category: " identity_state" },
  { sourceId: DEMO_OBSERVED[0]!.sourceId, category: "identity_state " },
], DEMO_SOURCES);
check("whitespace variants of one category are ONE detection, emitted trimmed", variants.length === 1 && variants[0]!.category === "identity_state");
// planOnboarding is an exported entry point: a truthy non-boolean used to auto-onboard.
const forged = planOnboarding([{ ...discovered.find((d) => d.class === "novel")!, autoOnboardable: "false" as unknown as boolean }]);
check("planOnboarding: only a literal true auto-onboards — the string \"false\" waits for an admin", forged.onboarded.length === 0 && forged.needsAdmin.length === 1);
// Codepoint order, pinned (two calls in one process share a locale and cannot see a
// locale-dependent sort): "Z" < "a" < "z" < "ä".
const srcId = DEMO_SOURCES.find((s) => s.hasApi)!.id;
const ordered = discover(["ätemp", "zone", "Zebra", "a_new"].map((category) => ({ sourceId: srcId, category })), DEMO_SOURCES).map((d) => d.category).join(",");
check("discovered signals are in CODEPOINT order, not the process locale's collation", ordered === "Zebra,a_new,zone,ätemp");
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
