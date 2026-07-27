// Proof: @workspace/self-audit — the self-aware, self-healing checklist.
//
// Proves the load-bearing invariants:
//   1. FAIL-CLOSED awareness — a missing/malformed probe result is `unknown`, and
//      `unknown` is never `healthy`; overall health is worst-status-wins.
//   2. SELF-AWARE coverage — a manifest dimension no declared item covers becomes a
//      synthesized `meta` coverage-gap finding; the checklist reports its blind spots.
//   3. DESCRIPTIVE, NEVER PERMISSIVE — a HealProposal carries no executable payload,
//      and proposeHeals marks nothing applied.
//   4. A HEAL CANNOT HEAL ITSELF — exhaustive sweep of all status pairs proves the
//      ONLY route to `applied` is `approved → applied` with a non-empty approver ref.
//   5. DETERMINISM + IMMUTABILITY — identical input → byte-identical output; every
//      result is deep-frozen; inputs are never mutated.
//
// Run: pnpm --filter @workspace/scripts run proof:self-audit

import {
  deriveChecklist,
  runAudit,
  proposeHeals,
  approveHeal,
  applyHeal,
  rejectHeal,
  summarizePlain,
  DEFAULT_CHECKLIST,
  HEAL_NA,
  type DeclaredItem,
  type ContractInventory,
  type ProbeResult,
  type HealProposal,
  type HealStatus,
  SelfAuditError,
  CHECK_STATUSES,
  STATUS_RANK,
} from "@workspace/self-audit";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

// ── a small but representative checklist across the three real layers ──────────
const DECLARED: DeclaredItem[] = [
  {
    id: "backend-decision-api",
    layer: "backend",
    description: "The /v1 decision API returns a fail-closed verdict for every request.",
    probeKey: "api:v1-evaluate",
    healable: true,
    remediationHint: "Re-run proof:api-contract; if the route drifted, restore the neighbor routes.",
    covers: ["signalKinds"],
  },
  {
    id: "frontend-consoles",
    layer: "frontend",
    description: "Every operator console route renders against a real decision verdict.",
    probeKey: "web:console-e2e",
    healable: true,
    remediationHint: "Re-run the Playwright console sweep; repair the drifted surface.",
    covers: ["consumers"],
  },
  {
    id: "api-integration-connectors",
    layer: "api_integration",
    description: "Every posture connector normalizes fail-closed (weak posture only raises assurance).",
    probeKey: "connector:posture-composition",
    healable: true,
    remediationHint: "Re-run the connector proofs; a weak-posture-grants-allow regression is a hard stop.",
    covers: ["signalCategories", "mcpTools"],
  },
  {
    id: "api-integration-task-exception",
    layer: "api_integration",
    description: "Task-exception reason codes route to the correct operations plane.",
    probeKey: "connector:task-exception",
    healable: false, // reported but not auto-proposable — the routing is policy, not mechanical
    remediationHint: HEAL_NA,
    covers: ["taskExceptionReasonCodes"],
  },
];

// The inventory the checklist is derived against — deliberately includes a
// dimension ("handoffSimRefusalCodes") that NO declared item covers, so the
// self-awareness machinery must synthesize exactly one coverage-gap finding.
const INVENTORY: ContractInventory = {
  dimensions: [
    "signalKinds",
    "signalCategories",
    "taskExceptionReasonCodes",
    "mcpTools",
    "consumers",
    "handoffSimRefusalCodes", // <-- uncovered on purpose
  ],
};

const checklist = deriveChecklist(DECLARED, INVENTORY);

// ── (2) SELF-AWARE coverage ────────────────────────────────────────────────────
const gapItems = checklist.filter((i) => i.id.startsWith("coverage-gap-"));
check("exactly one coverage-gap item is synthesized for the uncovered dimension", gapItems.length === 1);
check("the gap names the uncovered dimension", gapItems[0]?.id === "coverage-gap-handoffSimRefusalCodes");
check("the gap is a meta-layer item", gapItems[0]?.layer === "meta");
check("a covered dimension produces NO gap item",
  !checklist.some((i) => i.id === "coverage-gap-signalKinds"));
check("checklist = declared items + the one gap", checklist.length === DECLARED.length + 1);
check("checklist is sorted by id", checklist.map((i) => i.id).join("|") ===
  [...checklist].map((i) => i.id).sort((a, b) => a.localeCompare(b)).join("|"));
check("duplicate declared ids are refused", (() => {
  try { deriveChecklist([DECLARED[0], DECLARED[0]], INVENTORY); return false; } catch { return true; }
})());
// NEGATIVE CONTROL (adversarial-review finding): a declared item may NOT claim an id
// in the synthesized coverage-gap namespace — that collision would let a careless id
// MASK the very gap it should surface in an id-keyed consumer. The reserved prefix is
// rejected, so the derived checklist can never carry a duplicate id.
check("a declared id in the reserved 'coverage-gap-' namespace is refused", (() => {
  const evil: DeclaredItem = { ...DECLARED[0], id: "coverage-gap-handoffSimRefusalCodes", covers: [] };
  try { deriveChecklist([evil], INVENTORY); return false; }
  catch (e) { return e instanceof Error && /reserved/.test(e.message); }
})());
check("the derived checklist never contains a duplicate id", (() => {
  const ids = checklist.map((i) => i.id);
  return new Set(ids).size === ids.length;
})());

// ── (1) FAIL-CLOSED awareness ──────────────────────────────────────────────────
// Supply healthy results for the real probes, but DELIBERATELY omit the gap probe
// and one real probe, and hand one malformed result — all must fail closed.
const healthyProbes: Record<string, ProbeResult> = {
  "api:v1-evaluate": { status: "healthy", detail: "137/137" },
  "web:console-e2e": { status: "healthy", detail: "22/22 routes" },
  "connector:posture-composition": { status: "healthy", detail: "all connectors fail-closed" },
  "connector:task-exception": { status: "healthy", detail: "routes correct" },
  // coverage:handoffSimRefusalCodes deliberately absent
};
const reportGapUnknown = runAudit(checklist, healthyProbes);
check("an omitted probe (the gap) resolves to unknown, never healthy",
  reportGapUnknown.items.find((i) => i.item.id === "coverage-gap-handoffSimRefusalCodes")?.status === "unknown");
check("overall is unknown when a gap is unprobed (fail-closed, not healthy)",
  reportGapUnknown.overall === "unknown");

// A malformed probe result must fail closed to unknown.
const malformed = runAudit(checklist, {
  ...healthyProbes,
  "coverage:handoffSimRefusalCodes": { status: "broken", detail: "no item covers this" },
  "api:v1-evaluate": { notAStatus: true } as unknown as ProbeResult,
});
check("a malformed probe result fails closed to unknown",
  malformed.items.find((i) => i.item.id === "backend-decision-api")?.status === "unknown");
check("an unrecognized status string fails closed to unknown",
  runAudit(checklist, { ...healthyProbes, "api:v1-evaluate": { status: "great" } as unknown as ProbeResult })
    .items.find((i) => i.item.id === "backend-decision-api")?.status === "unknown");

// The fully-probed, all-healthy case (gap reported broken by the runner) → overall broken.
const fullProbes: Record<string, ProbeResult> = {
  ...healthyProbes,
  "coverage:handoffSimRefusalCodes": { status: "broken", detail: "uncovered dimension" },
};
const reportBroken = runAudit(checklist, fullProbes);
check("a reported coverage gap makes overall broken", reportBroken.overall === "broken");
check("the meta layer carries the broken status", reportBroken.byLayer.meta === "broken");
check("a fully-healthy real layer stays healthy", reportBroken.byLayer.backend === "healthy");

// worst-status-wins ordering: unknown outranks drifted, broken outranks all.
check("STATUS_RANK: broken > unknown > drifted > healthy",
  STATUS_RANK.broken > STATUS_RANK.unknown &&
  STATUS_RANK.unknown > STATUS_RANK.drifted &&
  STATUS_RANK.drifted > STATUS_RANK.healthy);

// An all-green world (cover every dimension) → overall healthy, no gaps.
const fullInventory: ContractInventory = { dimensions: ["signalKinds", "consumers", "signalCategories", "mcpTools", "taskExceptionReasonCodes"] };
const fullChecklist = deriveChecklist(DECLARED, fullInventory);
check("with every dimension covered there are no gap items",
  !fullChecklist.some((i) => i.id.startsWith("coverage-gap-")));
const allHealthy = runAudit(fullChecklist, healthyProbes);
check("a fully-covered, fully-healthy audit is overall healthy", allHealthy.overall === "healthy");
check("counts sum to the item total",
  CHECK_STATUSES.reduce((s, k) => s + allHealthy.counts[k], 0) === fullChecklist.length);

// ── (3) DESCRIPTIVE, never permissive + which items propose heals ──────────────
// Make the healable connector item broken and the non-healable one broken too.
const brokenProbes: Record<string, ProbeResult> = {
  "api:v1-evaluate": { status: "healthy" },
  "web:console-e2e": { status: "drifted", detail: "one route slow" },
  "connector:posture-composition": { status: "broken", detail: "a connector granted on weak posture" },
  "connector:task-exception": { status: "broken", detail: "routing wrong" },
  "coverage:handoffSimRefusalCodes": { status: "broken" },
};
const brokenReport = runAudit(checklist, brokenProbes);
const heals = proposeHeals(brokenReport);
check("a broken NON-healable item proposes NO heal",
  !heals.some((h) => h.targetItemId === "api-integration-task-exception"));
check("a broken healable item proposes a heal",
  heals.some((h) => h.targetItemId === "api-integration-connectors"));
check("a drifted healable item proposes a heal",
  heals.some((h) => h.targetItemId === "frontend-consoles"));
check("a healthy item proposes NO heal",
  !heals.some((h) => h.targetItemId === "backend-decision-api"));
check("the coverage gap (healable) proposes a heal",
  heals.some((h) => h.targetItemId === "coverage-gap-handoffSimRefusalCodes"));
check("every proposal starts at 'proposed' with no approver and enacts nothing",
  heals.every((h) => h.status === "proposed" && h.approvedByRef === null && h.version === 1));
check("a proposal carries only DATA (remediation is a string, no function/exec field)",
  heals.every((h) => typeof h.remediation === "string" &&
    !Object.values(h as unknown as Record<string, unknown>).some((v) => typeof v === "function")));
check("proposals are sorted by proposalId",
  heals.map((h) => h.proposalId).join("|") === [...heals].map((h) => h.proposalId).sort().join("|"));

// ── (4) A HEAL CANNOT HEAL ITSELF — exhaustive status-pair sweep ───────────────
// Build a proposal in each status and attempt every transition; assert the ONLY
// path to `applied` is approved→applied with a non-empty ref.
const base = heals.find((h) => h.targetItemId === "api-integration-connectors")!;
const proposed = base;
const approved = approveHeal(proposed, "user:owner-001");
const applied = applyHeal(approved);
const rejected = rejectHeal(proposed);

const byStatus: Record<HealStatus, HealProposal> = { proposed, approved, applied, rejected };
const HEAL_STATUSES: HealStatus[] = ["proposed", "approved", "applied", "rejected"];

// approveHeal reaches 'approved' only from 'proposed'.
let illegalApproveRefusals = 0;
for (const s of HEAL_STATUSES) {
  if (s === "proposed") continue;
  try { approveHeal(byStatus[s], "user:x"); } catch (e) { if (e instanceof SelfAuditError) illegalApproveRefusals += 1; }
}
check("approve is legal ONLY from proposed (every other status refuses)", illegalApproveRefusals === 3);

// applyHeal reaches 'applied' only from 'approved'.
let illegalApplyRefusals = 0;
for (const s of HEAL_STATUSES) {
  if (s === "approved") continue;
  try { applyHeal(byStatus[s]); } catch (e) { if (e instanceof SelfAuditError) illegalApplyRefusals += 1; }
}
check("apply is legal ONLY from approved (every other status refuses)", illegalApplyRefusals === 3);

check("approve REFUSES a blank approver ref (the human gate)", (() => {
  try { approveHeal(proposed, "   "); return false; } catch (e) { return e instanceof SelfAuditError && e.reason === "missing_approver"; }
})());
check("apply REFUSES an approved proposal whose ref was blanked (defense in depth)", (() => {
  const forged = { ...approved, approvedByRef: "" } as HealProposal;
  try { applyHeal(forged); return false; } catch (e) { return e instanceof SelfAuditError && e.reason === "missing_approver"; }
})());
check("there is NO proposed→applied edge: applying a proposed heal refuses", (() => {
  try { applyHeal(proposed); return false; } catch (e) { return e instanceof SelfAuditError && e.reason === "illegal_transition"; }
})());
check("applied carries the approver ref that authorized it",
  applied.status === "applied" && applied.approvedByRef === "user:owner-001");
check("version advances on every transition (proposed 1 → approved 2 → applied 3)",
  proposed.version === 1 && approved.version === 2 && applied.version === 3);

// Exhaustive: across all 16 (from,to) status pairs, count legal routes to 'applied'
// AND assert every OTHER source refuses — the earlier form only counted the approved
// case and swallowed the rest, so a regression opening a second route would not have
// been caught (adversarial-review finding). Now the else branch positively asserts a
// refusal, so `legalRoutesToApplied === 1` genuinely means "one route, all others shut".
let pairsToApplied = 0;
let legalRoutesToApplied = 0;
let illegalRoutesRefused = 0;
for (const from of HEAL_STATUSES) {
  for (const to of HEAL_STATUSES) {
    if (to !== "applied") continue;
    pairsToApplied += 1;
    if (from === "approved") {
      try { applyHeal(byStatus[from]); legalRoutesToApplied += 1; } catch { /* should not happen */ }
    } else {
      // Every non-approved source MUST refuse to reach applied.
      try { applyHeal(byStatus[from]); } catch (e) { if (e instanceof SelfAuditError) illegalRoutesRefused += 1; }
    }
  }
}
check("exactly ONE legal route to applied, and every other source positively refuses",
  legalRoutesToApplied === 1 && illegalRoutesRefused === 3 && pairsToApplied === 4);

// ── (5) DETERMINISM + IMMUTABILITY ─────────────────────────────────────────────
check("deriveChecklist is deterministic",
  JSON.stringify(deriveChecklist(DECLARED, INVENTORY)) === JSON.stringify(deriveChecklist(DECLARED, INVENTORY)));
check("runAudit is deterministic",
  JSON.stringify(runAudit(checklist, fullProbes)) === JSON.stringify(runAudit(checklist, fullProbes)));
check("proposeHeals is deterministic",
  JSON.stringify(proposeHeals(brokenReport)) === JSON.stringify(proposeHeals(brokenReport)));
check("every checklist item is deep-frozen", checklist.every((i) => Object.isFrozen(i)));
check("the report and its items/counts are deep-frozen",
  Object.isFrozen(reportBroken) && Object.isFrozen(reportBroken.items) &&
  reportBroken.items.every((i) => Object.isFrozen(i)) && Object.isFrozen(reportBroken.counts));
check("every heal proposal is deep-frozen", heals.every((h) => Object.isFrozen(h)));
check("the input proposal is never mutated across a transition",
  proposed.status === "proposed" && proposed.version === 1 && proposed.approvedByRef === null);
check("HEAL_NA sentinel is the empty remediation for non-healable items", HEAL_NA === "");

// ── (6) THE DEFAULT CHECKLIST + PLAIN-LANGUAGE SUMMARY (the admin surface) ──────
// The real system checklist must cover all three functional layers and derive
// cleanly (no reserved-id collisions, no duplicate ids).
const defaultLayers = new Set(DEFAULT_CHECKLIST.map((i) => i.layer));
check("the default checklist covers backend, frontend, and api_integration",
  defaultLayers.has("backend") && defaultLayers.has("frontend") && defaultLayers.has("api_integration"));
const defaultDerived = deriveChecklist([...DEFAULT_CHECKLIST], INVENTORY);
check("the default checklist derives without a reserved-id or duplicate-id error",
  new Set(defaultDerived.map((i) => i.id)).size === defaultDerived.length);

// summarizePlain: an all-healthy report reads as the calm "just works" state.
const plainAllClear = summarizePlain(allHealthy, []);
check("an all-healthy audit summarizes as 'Everything is working.'",
  plainAllClear.headline === "Everything is working." && plainAllClear.allClear && plainAllClear.attentionCount === 0);
check("an all-clear summary contains NO attention lines",
  plainAllClear.lines.every((l) => !l.needsAttention));

// A report with problems reads as a plain, counted call to attention with human words.
const plainBroken = summarizePlain(brokenReport, heals);
check("a report with problems summarizes with a non-zero attention count",
  !plainBroken.allClear && plainBroken.attentionCount === brokenReport.counts.broken + brokenReport.counts.drifted + brokenReport.counts.unknown);
check("the headline counts things needing attention in plain words",
  /needs? your attention\.$/.test(plainBroken.headline));
check("attention lines are ordered worst-first (a 'Needs attention' line precedes any 'Working' line)", (() => {
  const firstWorking = plainBroken.lines.findIndex((l) => l.state === "Working");
  const lastAttention = plainBroken.lines.map((l) => l.needsAttention).lastIndexOf(true);
  return firstWorking === -1 || lastAttention < firstWorking;
})());
check("no line or headline leaks an internal status enum word",
  !/\b(healthy|drifted|broken|unknown)\b/.test(
    plainBroken.headline + plainBroken.lines.map((l) => l.state + l.sentence).join(" ")));
check("every suggested fix says it needs human approval (never auto-done)",
  plainBroken.suggestedFixes.length > 0 && plainBroken.suggestedFixes.every((f) => f.needsYourApproval === true));
check("each suggested fix maps to a proposed heal proposal",
  plainBroken.suggestedFixes.every((f) => heals.some((h) => h.proposalId === f.proposalId && h.status === "proposed")));
check("summarizePlain is deterministic",
  JSON.stringify(summarizePlain(brokenReport, heals)) === JSON.stringify(summarizePlain(brokenReport, heals)));
// An APPROVED heal is no longer an open "suggested fix" — the plain view only offers
// fixes still awaiting a decision, so an administrator never re-approves a done one.
const approvedHeal = approveHeal(heals[0], "user:owner-001");
const plainAfterApprove = summarizePlain(brokenReport, [approvedHeal, ...heals.slice(1)]);
check("an approved heal drops out of the open 'suggested fixes' list",
  !plainAfterApprove.suggestedFixes.some((f) => f.proposalId === approvedHeal.proposalId));

// ── figures (guarded against the docs) ─────────────────────────────────────────
const declaredCount = DECLARED.length;
const gapCount = gapItems.length;
const layers = new Set(checklist.map((i) => i.layer)).size;
const defaultItems = DEFAULT_CHECKLIST.length;
console.log(`figures=layers=${layers},declaredItems=${declaredCount},coverageGaps=${gapCount},healStatuses=${HEAL_STATUSES.length},pairsToApplied=${pairsToApplied},legalRoutesToApplied=${legalRoutesToApplied},defaultItems=${defaultItems}`);

// ── summary ─────────────────────────────────────────────────────────────────────
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
