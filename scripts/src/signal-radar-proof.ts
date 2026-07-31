// Proof: Signal Radar (@workspace/signal-radar) — new-signal detection.
//
// Asserts the radar correctly classifies evaluated / candidate / novel signals,
// raises first-seen alerts for novel ones, counts observations, and is
// deterministic. This is the "detect a new signal being delivered and alert +
// monitor" behavior, verified.
//
// Run: pnpm --filter @workspace/scripts run proof:signal-radar

import { scanSignals, classifyCategory, signalCatalog } from "@workspace/signal-radar";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

// ── classification ───────────────────────────────────────────────────────────
check("evaluated category classified as evaluated", classifyCategory("badge_binding") === "evaluated");
check("candidate category classified as candidate", classifyCategory("rtls_location") === "candidate");
check("unknown category classified as novel", classifyCategory("smart_bed_occupancy") === "novel");
check("empty category is novel", classifyCategory("") === "novel");

// ── scan: mixed batch ────────────────────────────────────────────────────────
const report = scanSignals([
  { category: "identity_state", sourceReference: "idp" },
  { category: "identity_state", sourceReference: "idp" },
  { category: "rtls_location", sourceReference: "rtls-1" },
  { category: "smart_bed_occupancy", sourceReference: "bed-42" },
  { category: "iv_pump_telemetry", sourceReference: "pump-7" },
]);
check("evaluated signal is not flagged novel", !report.novel.some((o) => o.category === "identity_state"));
check("counts aggregate per category", report.observations.find((o) => o.category === "identity_state")?.count === 2);
check("two novel signals detected", report.novel.length === 2);
check("novel list names the new signals", report.novel.map((o) => o.category).sort().join(",") === "iv_pump_telemetry,smart_bed_occupancy");
check("novel signal raises a first-seen alert", !!report.novel[0].alert && report.novel[0].alert.includes("New signal type"));
check("candidate observed but not counted as novel", report.candidates.some((o) => o.category === "rtls_location") && !report.novel.some((o) => o.category === "rtls_location"));
check("first-seen reference captured", report.observations.find((o) => o.category === "smart_bed_occupancy")?.firstSeenRef === "bed-42");
check("summary reports the novel count", report.summary.includes("2 novel"));

// ── all-known batch raises no novel alert ────────────────────────────────────
const known = scanSignals([{ category: "device_compliance" }, { category: "custody_state" }]);
check("all-evaluated batch has no novel signals", known.novel.length === 0);
check("all-evaluated batch summary is reassuring", known.summary.includes("already evaluated"));

// ── determinism ──────────────────────────────────────────────────────────────
const a = JSON.stringify(scanSignals([{ category: "z_new" }, { category: "a_new" }]));
const b = JSON.stringify(scanSignals([{ category: "z_new" }, { category: "a_new" }]));
check("radar reports are deterministic", a === b);

// ── catalog ──────────────────────────────────────────────────────────────────
check("catalog lists the 15 evaluated categories", signalCatalog().evaluated.length === 15);
check("catalog lists candidate categories", signalCatalog().candidate.length > 0);

const total = passed + failures.length;
console.log(`Signal Radar proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("New-signal detection + alerting verified (evaluated / candidate / novel).");
