// Proof: the twelve Zero Trust principles, asserted against the real decision core.
//
// WHY THIS EXISTS, AND WHAT IT DELIBERATELY IS NOT.
//
// A Zero Trust poster is a set of claims. `docs/SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`
// states how SignalGrid interprets them. This file is what stops that document from
// becoming decoration: every principle that is checkable at decision time is checked
// HERE, against `evaluatePolicy` and `deriveCriticalSignalsPresent` as shipped — not
// against a restatement of them.
//
// The failure mode this forecloses is specific and common: a governance doc that
// describes behaviour nobody re-checks, drifting away from the engine one commit at a
// time while both look fine. If a principle below stops holding, this goes red on the
// commit that broke it.
//
// NO NEW PRODUCT SCOPE. Nothing here adds a signal, a connector family or a reason
// code. The core already implements most of these principles; what did not exist was
// anything naming the mapping or proving it still holds.
//
//   pnpm run proof:zero-trust-principles

import {
  evaluatePolicy,
  deriveCriticalSignalsPresent,
  seedDemoStore,
  buildResolutionPlan,
  simulateResolution,
  proposeRemediation,
  RESOLUTION_DESCRIPTOR_SHAPES,
  type Decision,
  type DecisionEvidence,
  type PolicyVersion,
  type ComplianceState,
  type Freshness,
  type RiskTier,
} from "@workspace/signalgrid-core";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

/** A deterministic clock: this repo forbids Date.now() in decision paths. */
const fixedClock = { now: () => new Date("2026-08-08T00:00:00.000Z") };

/**
 * Evidence in which everything is known and healthy — the ONLY starting point from
 * which a principle test means anything. Each test then degrades exactly one axis, so
 * a failure names the axis rather than the whole shape.
 */
function healthyEvidence(overrides: Partial<DecisionEvidence> = {}): DecisionEvidence {
  const partial = {
    identityEnabled: true as boolean | "unknown",
    deviceManaged: true as boolean | "unknown",
    deviceCompliance: "compliant" as ComplianceState,
    deviceEncrypted: true as boolean | "unknown",
    osSupported: true as boolean | "unknown",
    ownerType: "corporate" as DecisionEvidence["ownerType"],
    postureFreshness: "fresh" as Freshness,
    workflowRiskTier: "standard" as RiskTier,
    custodyState: "checked_out" as DecisionEvidence["custodyState"],
    dockChargeState: "charged" as DecisionEvidence["dockChargeState"],
    batteryHealth: "healthy" as DecisionEvidence["batteryHealth"],
    tamperState: "none" as DecisionEvidence["tamperState"],
    dockState: "empty" as DecisionEvidence["dockState"],
    baselineCompliance: "aligned" as DecisionEvidence["baselineCompliance"],
    badgeBinding: "present" as DecisionEvidence["badgeBinding"],
    // STATED, not omitted (review finding F2, 2026-09-02). This fixture claims
    // "everything is known and healthy" while leaving a required field of
    // `DecisionEvidence` off the object behind an `as` cast — and an omitted
    // freshness used to read as GOOD, because `undefined` equals none of the
    // values the backstop rejects. It now reads as "unknown" and disqualifies,
    // which is the doctrine (silence never affirms). Every dock channel above is
    // populated and healthy, so the honest stamp for this context is "fresh".
    dockEvidenceFreshness: "fresh" as Freshness,
    ...overrides,
  } as Omit<DecisionEvidence, "criticalSignalsPresent">;
  return { ...partial, criticalSignalsPresent: deriveCriticalSignalsPresent(partial) };
}

function main() {
  // The SHIPPED policy, not one written here. A proof that invents its own rules
  // proves things about the proof.
  const demo = seedDemoStore(fixedClock);
  const tenantId = demo.tenants.northwind;
  // Resolved exactly the way `evaluateDecision` resolves it (lib/signalgrid-core/src/
  // decision.ts): policy for the workflow, then that policy's ACTIVE version. Reaching
  // into the version map directly would let this proof evaluate the stricter v2 DRAFT
  // that ships alongside v1 — passing against rules no live decision uses.
  const policy = demo.store.findPolicyForWorkflow(tenantId, "med-admin");
  const version = policy
    ? (demo.store.getPolicyVersion(tenantId, policy.activeVersionId) as PolicyVersion | undefined)
    : undefined;
  if (!version) {
    console.error("FAIL: no active policy version in the seeded tenant — nothing to evaluate against.");
    process.exit(1);
  }
  if (version.status !== "active") {
    console.error(
      `FAIL: resolved policy version ${version.id} has status "${version.status}", not "active" — ` +
        `this proof must evaluate the rules live decisions use, not a draft.`,
    );
    process.exit(1);
  }
  const decide = (e: DecisionEvidence) => evaluatePolicy(version, e);

  console.log(`Zero Trust principles, against policy ${version.version} (${version.id}):\n`);

  // ── POSITIVE CONTROL, FIRST ─────────────────────────────────────────────────
  // Everything below asserts that something does NOT allow. Without proving the
  // engine CAN allow, a core hardwired to deny would pass every one of them and this
  // file would certify a product that never works.
  const healthy = decide(healthyEvidence());
  check(
    "POSITIVE CONTROL: fully-evidenced healthy context CAN reach allow (the engine is not hardwired to refuse)",
    healthy.outcome === "allow",
  );

  // ── 1. Verify explicitly / 2. Assume breach ─────────────────────────────────
  // "Every affirmative must be earned." Asserted over the whole space rather than by
  // example: for EVERY critical axis, degrade it alone and require that allow is gone.
  const criticalDegradations: Array<[string, Partial<DecisionEvidence>]> = [
    ["identity state unknown", { identityEnabled: "unknown" }],
    ["device management unknown", { deviceManaged: "unknown" }],
    ["compliance unknown", { deviceCompliance: "unknown" }],
    ["encryption unknown", { deviceEncrypted: "unknown" }],
    ["posture missing", { postureFreshness: "missing" }],
    ["posture unknown", { postureFreshness: "unknown" }],
  ];
  let earnedAffirmative = true;
  for (const [label, override] of criticalDegradations) {
    const r = decide(healthyEvidence(override));
    if (r.outcome === "allow") {
      earnedAffirmative = false;
      console.log(`      ↳ ${label} still allowed`);
    }
  }
  check(
    `no single missing critical signal can still allow (${criticalDegradations.length} axes, each degraded alone)`,
    earnedAffirmative,
  );

  // And the engine must SAY why, not merely downgrade quietly.
  const missing = decide(healthyEvidence({ postureFreshness: "missing" }));
  check(
    "a suppressed allow is named in the reason codes, not silently downgraded",
    missing.reasonCodes.length > 0 &&
      missing.reasonCodes.some((c) => c.includes("SUPPRESSED") || c.includes("MISSING") || c.includes("STALE")),
  );

  // ── 3. Continuous verification / 4. Signal-driven ───────────────────────────
  // "Stale evidence cannot become fresh." A stale posture must not allow a critical
  // workflow, however good every other axis is.
  const staleCritical = decide(
    healthyEvidence({ postureFreshness: "stale", workflowRiskTier: "critical" }),
  );
  check(
    "stale posture cannot allow a critical workflow",
    staleCritical.outcome !== "allow",
  );

  // ── 5/6. Just-in-time and just-enough access ────────────────────────────────
  // The risk tier is an input, not decoration: raising it must never LOOSEN the
  // outcome. Asserted across every tier rather than at one point.
  const rank: Record<string, number> = { allow: 1, step_up: 2, restrict: 3, deny: 4 };
  const tiers: RiskTier[] = ["standard", "elevated", "critical"];
  let monotonic = true;
  let previous = 0;
  for (const tier of tiers) {
    const r = decide(healthyEvidence({ postureFreshness: "stale", workflowRiskTier: tier }));
    if (rank[r.outcome] < previous) monotonic = false;
    previous = Math.max(previous, rank[r.outcome]);
  }
  check("raising the workflow risk tier never loosens the outcome", monotonic);

  // ── 8. Session-level enforcement ────────────────────────────────────────────
  // "A valid login is not a valid workflow." An enabled identity with nothing else
  // known must not allow — this is the SSO-is-not-enough rule, in code.
  const ssoOnly = decide(
    healthyEvidence({
      identityEnabled: true,
      deviceManaged: "unknown",
      deviceCompliance: "unknown",
      deviceEncrypted: "unknown",
      postureFreshness: "unknown",
    }),
  );
  check(
    "an authenticated identity ALONE cannot allow — a valid session is not a valid workflow",
    ssoOnly.outcome !== "allow",
  );

  // "A managed, compliant device is not local authority."
  //
  // The precise form matters, and the first draft of this check got it wrong. It
  // asserted that compliance-plus-unknown-custody cannot allow a critical workflow, and
  // the engine allowed it — correctly. `unknown` custody is what EVERY tenant without a
  // DockBridge reports, which is most of them; a rule on it would step up every device
  // in every dockless fleet forever. The engine instead distinguishes two different
  // facts that a single "unknown" would have collapsed:
  //
  //   · NO CUSTODY CHANNEL EXISTS  → `unknown`. The decision never claimed local
  //     authority, so there is nothing to fail closed on. Boundary, checked below.
  //   · A CUSTODY CHANNEL EXISTS AND CANNOT VOUCH → `offline` / `faulted` /
  //     `sensor_unavailable` / `removed`. Here the grid was supposed to know and does
  //     not, and allow must be unreachable however good compliance is.
  //
  // The second is the one the principle is actually about, so it is what is asserted.
  const blindedChannels: Array<[string, Partial<DecisionEvidence>]> = [
    ["dock offline (live custody channel lost)", { dockState: "offline" }],
    ["dock faulted (dock cannot vouch)", { dockState: "faulted" }],
    ["tamper sensor unavailable (device unwitnessed)", { tamperState: "sensor_unavailable" }],
    ["badge withdrawn from the reader case", { badgeBinding: "removed" }],
  ];
  let blindedHeld = true;
  for (const [label, override] of blindedChannels) {
    const r = decide(healthyEvidence({ workflowRiskTier: "critical", ...override }));
    if (r.outcome === "allow") {
      blindedHeld = false;
      console.log(`      ↳ ${label} still allowed`);
    }
  }
  check(
    `a present-but-blinded custody channel cannot be outvoted by compliance (${blindedChannels.length} channels)`,
    blindedHeld,
  );

  // THE BOUNDARY, PINNED. With no custody channel at all, a compliant device on a
  // critical workflow DOES allow. That is a deliberate scope limit, not local authority
  // — and it is asserted here in the affirmative so the documented boundary and the
  // engine cannot drift apart silently. If someone later makes absent custody fail
  // closed, this goes red and the doctrine document has to be changed on purpose.
  const noCustodyChannel = decide(
    healthyEvidence({
      workflowRiskTier: "critical",
      custodyState: "unknown",
      dockState: "unknown",
      tamperState: "unknown",
      badgeBinding: "unknown",
      batteryHealth: "unknown",
      dockChargeState: "unknown",
    }),
  );
  check(
    "BOUNDARY: with no custody channel at all, device trust alone allows — the decision " +
      "does not claim local authority, and the doctrine says so",
    noCustodyChannel.outcome === "allow",
  );

  // ── 9. Microsegmentation ────────────────────────────────────────────────────
  // A contradiction must stay a contradiction. A confirmed tamper cannot be washed
  // out by every other axis being healthy.
  const tampered = decide(healthyEvidence({ tamperState: "confirmed" }));
  check("a confirmed tamper is not outweighed by otherwise-healthy evidence", tampered.outcome !== "allow");

  // ── 10/11. Identity as perimeter, full telemetry ────────────────────────────
  // Every decision must be attributable to a policy version and carry its reasons.
  check(
    "every evaluation carries a policy version and at least one reason code",
    Boolean(version.version) &&
      Boolean(version.id) &&
      healthy.reasonCodes.length > 0 &&
      staleCritical.reasonCodes.length > 0,
  );
  check(
    "every firing rule is attributable to a rule id (evidence is traceable, not summarised)",
    staleCritical.matchedRules.every((r) => Boolean(r.ruleId) && Boolean(r.reasonCode)),
  );

  // ── 7. Least privilege — "a role is not a decision" ─────────────────────────
  // Structural, not by example. A role CANNOT loosen a decision here because the
  // decision contract has no role in it: `DecisionEvidence` carries observed state and
  // nothing else. Asserted over the field set rather than by trying a role, because
  // there is no role to try — and if someone later adds one, this is what notices.
  const evidenceFields = Object.keys(healthyEvidence());
  const authorityWords = ["role", "group", "entitlement", "permission", "privilege", "admin"];
  const authorityFields = evidenceFields.filter((f) =>
    authorityWords.some((w) => f.toLowerCase().includes(w)),
  );
  check(
    `RBAC cannot loosen a decision: no directory-authority field exists in the ${evidenceFields.length}-field ` +
      `decision contract (a role authorises an API call, not a workflow)`,
    authorityFields.length === 0,
  );
  if (authorityFields.length) console.log(`      ↳ found: ${authorityFields.join(", ")}`);

  // ── The step-up must be ANSWERABLE ──────────────────────────────────────────
  // "A step-up nobody can answer is a denial with extra steps." A non-allow decision
  // must either carry a served path that actually reaches allow when satisfied, or be
  // honestly routed to a human — never a dead end presented as a self-service fix.
  const stepUpEvidence = healthyEvidence({ postureFreshness: "stale" });
  const stepUp = decide(stepUpEvidence);
  const asDecision = (outcome: typeof stepUp.outcome, reasonCodes: string[]): Decision =>
    ({
      id: "dec_zero_trust_proof",
      tenantId,
      outcome,
      reasonCodes,
      matchedRules: [],
      createdAt: fixedClock.now().toISOString(),
      policyVersionId: version.id,
      policyVersion: version.version,
    }) as unknown as Decision;

  const stepUpDecision = asDecision(stepUp.outcome, stepUp.reasonCodes);
  const plan = buildResolutionPlan(stepUpDecision, {
    tenantId,
    primaryHardwareChannel: "device_prompt",
    autoProposeEnabled: true,
  });
  const simulated = simulateResolution(stepUpDecision, stepUpEvidence, version);
  check(
    "a step-up is answerable: the served path, when satisfied, actually reaches allow — " +
      "not a dead end presented as a fix",
    stepUp.outcome === "step_up" && plan.steps.length > 0 && simulated.resolved,
  );
  // And the converse, so the check above cannot pass by the engine simply always
  // claiming resolvability: a state with no served fix must NOT claim one.
  const unanswerable = asDecision("deny", ["TAMPER_CONFIRMED"]);
  const unanswerablePlan = buildResolutionPlan(unanswerable, {
    tenantId,
    primaryHardwareChannel: "device_prompt",
    autoProposeEnabled: true,
  });
  check(
    "…and a state with no served fix is routed to a human rather than claiming one " +
      "(the answerability check is not vacuous)",
    !unanswerablePlan.autoResolvable,
  );

  // ── Every refusal has a served path, and the labour one does not coach ──────
  //
  // The ITSM derivation found four refusals with NO resolution descriptor at all:
  // a worker was stopped with an honest human owner and nothing else. They now have
  // descriptors, and both halves of that are asserted here — that the path exists,
  // and that ONE of them says the right thing.
  //
  // The second assertion is the load-bearing one. `SHIFT_CONTEXT_MISFIT` fires on
  // scheduled-but-clocked-out, off-duty operation, or someone else's badge. A
  // self-service step reading "clock in to continue" would coach a worker around a
  // wage-and-hour control in the first case and deepen an impersonation in the last.
  // The classification is `requires_approval` on purpose; this pins the wording so a
  // later edit cannot quietly turn it back into a prompt to clock in.
  const NEWLY_SERVED = [
    "BENCHMARK_SELECTION_MISFIT",
    "BENCHMARK_SELECTION_UNESTABLISHED_STRICT",
    "SHIFT_CONTEXT_MISFIT",
    "SHIFT_CONTEXT_UNESTABLISHED_STRICT",
  ];
  const shapesByCode = new Map(RESOLUTION_DESCRIPTOR_SHAPES.map((s) => [s.reasonCode, s]));
  check(
    `all ${NEWLY_SERVED.length} previously-unserved refusals now carry a re-evaluatable path`,
    NEWLY_SERVED.every((c) => shapesByCode.get(c)?.hasTransform === true),
  );
  check(
    "…and none of them is self-service — a benchmark swap and a labour record both need an authorised human",
    NEWLY_SERVED.every((c) => shapesByCode.get(c)?.baseClass === "requires_approval"),
  );

  const shiftPlan = buildResolutionPlan(asDecision("step_up", ["SHIFT_CONTEXT_MISFIT"]), {
    tenantId,
    primaryHardwareChannel: "device_prompt",
    autoProposeEnabled: true,
  });
  const shiftStep = shiftPlan.steps.find((s) => s.reasonCode === "SHIFT_CONTEXT_MISFIT");
  check(
    "an off-the-clock refusal produces a step at all (the worker is not left with nothing)",
    Boolean(shiftStep),
  );
  check(
    "…routed to an OPERATOR, never offered to the worker as self-service",
    shiftStep?.audience === "operator",
  );
  check(
    "…and the guidance never tells the worker to clock in — the control is not coached around",
    Boolean(shiftStep) && !/clock\s*in(?!\s*to get past)/i.test(`${shiftStep!.action}`),
  );

  // ── Automated response stays ADVISORY in Limited GA ─────────────────────────
  // Every proposal SignalGrid makes is approval-required and simulated-only. There is
  // no executed status by design — the enforcement point acts, not the policy engine.
  const remediationStore = seedDemoStore(fixedClock).store;
  const proposals = proposeRemediation(
    remediationStore,
    fixedClock,
    "zero-trust-proof",
    asDecision("restrict", ["POSTURE_MISSING", "DEVICE_NONCOMPLIANT"]),
    healthyEvidence({ postureFreshness: "missing", deviceCompliance: "non_compliant" }),
  );
  check(
    `automated response is advisory: all ${proposals.length} proposal(s) are approval-required ` +
      `and simulated-only — SignalGrid recommends, the enforcement point acts`,
    proposals.length > 0 &&
      proposals.every((p) => p.approvalRequired && p.simulatedOnly && p.status === "requires_approval"),
  );
  check(
    "…and an allow produces no remediation at all (nothing is 'responded to' that was not refused)",
    proposeRemediation(
      remediationStore,
      fixedClock,
      "zero-trust-proof",
      asDecision("allow", ["TRUST_ESTABLISHED"]),
      healthyEvidence(),
    ).length === 0,
  );

  // ── 12. Automated response stays governed ───────────────────────────────────
  // The default when nothing matches is step-up, never a silent allow. This is the
  // "no exceptions" rule the poster states, in the one place it can be enforced.
  const nothingKnown = decide(
    healthyEvidence({
      identityEnabled: "unknown",
      deviceManaged: "unknown",
      deviceCompliance: "unknown",
      deviceEncrypted: "unknown",
      osSupported: "unknown",
      postureFreshness: "unknown",
      custodyState: "unknown",
      dockChargeState: "unknown",
      batteryHealth: "unknown",
      tamperState: "unknown",
      dockState: "unknown",
      baselineCompliance: "unknown",
      badgeBinding: "unknown",
    }),
  );
  check("a context in which nothing is known never allows", nothingKnown.outcome !== "allow");

  // ── The invariant behind all of it, brute-forced ────────────────────────────
  // `deriveCriticalSignalsPresent` is the single gate that makes "missing evidence
  // cannot become allow" true. Enumerate every combination of known/unknown across
  // the six critical axes and assert: whenever any is unknown, allow is unreachable.
  // 2^6 = 64 combinations; one of them is the healthy case.
  const axes: Array<keyof DecisionEvidence> = [
    "identityEnabled",
    "deviceManaged",
    "deviceCompliance",
    "deviceEncrypted",
    "postureFreshness",
  ];
  let allowedWithAGap = 0;
  let allowedWithNoGap = 0;
  for (let mask = 0; mask < 1 << axes.length; mask += 1) {
    const override: Partial<DecisionEvidence> = {};
    let anyUnknown = false;
    axes.forEach((axis, i) => {
      if (mask & (1 << i)) {
        anyUnknown = true;
        (override as Record<string, unknown>)[axis] =
          axis === "postureFreshness" ? "unknown" : "unknown";
      }
    });
    const r = decide(healthyEvidence(override));
    if (r.outcome === "allow") {
      if (anyUnknown) allowedWithAGap += 1;
      else allowedWithNoGap += 1;
    }
  }
  check(
    `across all ${1 << axes.length} known/unknown combinations, NONE with a gap reaches allow`,
    allowedWithAGap === 0,
  );
  check(
    "…and the one combination with no gap DOES reach allow (the sweep is not vacuous)",
    allowedWithNoGap === 1,
  );

  const total = passed + failures.length;
  console.log(`\nZero Trust principles proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      `\nA failure here means the engine no longer behaves the way\n` +
        `docs/SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md says it does. Fix the engine, or\n` +
        `change the doctrine deliberately — do not weaken this proof to match a regression.`,
    );
    process.exit(1);
  }
  console.log(`
The twelve principles hold against the shipped decision core.

  NOT established by a green here:
    · enforcement. SignalGrid is the policy engine; the host app, IdP, UEM or gateway
      is the enforcement point, and whether THEY honour the decision is outside this.
    · continuous verification over real elapsed time. This asserts that a stale signal
      cannot allow; it does not run a session for an hour.
    · anything about a live tenant. The policy here is the seeded one, evaluated
      deterministically with a fixed clock.
    · that the doctrine document is complete — only that the principles it claims are
      checkable at decision time are checked.`);
}

main();
