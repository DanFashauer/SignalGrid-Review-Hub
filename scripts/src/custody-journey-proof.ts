// Smart-charging custody JOURNEY proof — one clinician, one shared iPhone, one
// shift, end to end, and the four failure branches the runbooks actually produce.
//
// WHAT THIS GATES, and why it is not covered by `proof:signalgrid-simulator`.
// That proof asks whether each scenario decides correctly ON ITS OWN. A journey
// is a different claim: that an ORDER of decisions holds, that each stage grants
// only while its own evidence is affirmative, and that every departure from it
// withdraws the grant. `docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`
// carried that as its last open gap — "a faithful end-to-end smart-charging
// simulator scenario (badge → dock → provision → in-use → check-in, with the
// real failure branches)" — and DR-054 is the record for closing it.
//
// THE SHAPE. Five ordered stages and four branches, all declared in
// `lib/signalgrid-simulator/src/scenarios.ts` under one `custody-journey-` id
// prefix. The prefix IS the journey identifier and the array order IS the
// order; both are asserted here, contiguously, so a stage dropped, renamed or
// reordered fails rather than silently shortening the journey. No new type, no
// stage machine: `SimulatorScenario` already describes one decision, a journey
// is an ordered list of them, and every existing consumer of that list — the
// /v1 route, the review console, three other proofs — keeps working unchanged.
//
// WHAT MAKES A BRANCH FALSIFIABLE. "The branch does not allow" is worth little
// on its own: a scenario can refuse for reasons that have nothing to do with
// the fault it is named for. So each branch also carries a RESTORED control —
// the same moment with only its fault removed — and that control must ALLOW.
// A branch therefore proves a grant WITHDRAWN BY ITS NAMED FAULT, which is the
// only version of the claim worth gating.
//
// THE DECISION CORE IS NOT TOUCHED. `decisionEngine.ts` is byte-parity-gated
// against the frozen Swift port (CLAUDE.md golden rule 1) and nothing here
// edits or imports its internals — the journey is expressed entirely in
// fixtures the existing rules already read.
//
// THE FAMILY EVALUATORS BEHIND EACH STAGE are driven for real, not described:
// supervision-identity, the custody ledger, device-prep, the manual-fallback
// sequence, custody-beacon, local-authority, network/NAC and change-window all
// answer for the same moment the stage decides, from their own fixtures. And
// the same journey is replayed as an EVENT-CONTRACT timeline through
// `detect.ts`, because the cross-domain plane is the one place a contradiction
// between planes can show up at all.
//
//   pnpm run proof:custody-journey
//   pnpm run proof:custody-journey --self-test   # the planted-defect suite only
//
// `--self-test` is a real mode: it runs the planted-defect controls, prints a
// count and exits on it, so the gate can be SEEN to fail. The same controls
// also run inline in the ordinary mode.

import {
  listSimulatorScenarios,
  runScenario,
  type DecisionOutcome,
  type SignalGridSignal,
  type SimulatorScenario,
} from "@workspace/signalgrid-simulator";
import { detectCrossDomain, type SignalGridEvent } from "@workspace/event-contract";
import { evaluateSupervisionIdentityFixture } from "@workspace/integrations/device-attestation";
import { evaluateDevicePrepFixture } from "@workspace/integrations/app-update";
import { evaluateCustodyLedgerFixture } from "@workspace/integrations/rtls-custody";
import { evaluateManualFallbackFixture } from "@workspace/integrations/break-glass";
import { evaluateCustodyBeacon } from "@workspace/integrations/custody-beacon";
import { evaluateLocalAuthority } from "@workspace/integrations/local-authority";
import { evaluateNetwork } from "@workspace/integrations/network-nac";
import { evaluateChangeWindow } from "@workspace/integrations/change-window";

const SELF_TEST_ONLY = process.argv.slice(2).includes("--self-test");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) passed += 1;
  else failures.push(name);
};

const PREFIX = "custody-journey-";

/** The journey, in order. Editing this list is editing the claim. */
const STAGES = [
  "custody-journey-01-badge-tap",
  "custody-journey-02-dock-release",
  "custody-journey-03-provision",
  "custody-journey-04-in-use",
  "custody-journey-05-check-in",
] as const;

/** Each branch, the stage it departs from, and the reason codes it must name. */
const BRANCHES = [
  {
    id: "custody-journey-branch-unpaired",
    departsFrom: "custody-journey-05-check-in",
    reasonCodes: ["DOCK_EXCEPTION"],
  },
  {
    id: "custody-journey-branch-network-down",
    departsFrom: "custody-journey-04-in-use",
    reasonCodes: ["STATE_FRESHNESS_FAILURE", "POSTURE_STALE"],
  },
  {
    id: "custody-journey-branch-cap-hit",
    departsFrom: "custody-journey-02-dock-release",
    reasonCodes: ["CUSTODY_EXCEPTION"],
  },
  {
    id: "custody-journey-branch-dock-fault",
    departsFrom: "custody-journey-05-check-in",
    reasonCodes: ["OPERATIONAL_HEALTH_DEGRADED", "INTEGRATION_ROUTE_DEGRADED"],
  },
] as const;

/**
 * The same journey moment with ONLY the branch's named fault removed. The control
 * that turns "this branch refuses" into "this branch refuses BECAUSE of the thing
 * it is named for" — without it a branch could pass while refusing for an
 * unrelated accident, and the proof would be reporting coverage it does not have.
 */
const RESTORED: Record<string, (signals: SignalGridSignal[]) => SignalGridSignal[]> = {
  "custody-journey-branch-unpaired": (signals) =>
    signals.map((s) =>
      s.type === "dock.wrong_slot_return"
        ? {
            ...s,
            id: "restored:dock.device_docked",
            type: "dock.device_docked" as SignalGridSignal["type"],
            severity: "info" as SignalGridSignal["severity"],
            attributes: { ...s.attributes, pairing: "paired" },
          }
        : s,
    ),
  "custody-journey-branch-network-down": (signals) =>
    signals.map((s) => {
      if (s.type === "device.stale_checkin") {
        return {
          ...s,
          id: "restored:device.posture_observed",
          type: "device.posture_observed" as SignalGridSignal["type"],
          layer: "device" as SignalGridSignal["layer"],
          severity: "info" as SignalGridSignal["severity"],
          attributes: { compliance: "compliant", freshness: "fresh" },
        };
      }
      if (s.attributes["networkAuthState"] === "unknown") {
        return { ...s, attributes: { networkAuthState: "authenticated", nacCompliant: true, segment: "clinical-mobile" } };
      }
      return s;
    }),
  "custody-journey-branch-cap-hit": (signals) =>
    signals.map((s) =>
      s.attributes["missingReturn"] === true ? { ...s, attributes: { ...s.attributes, missingReturn: false } } : s,
    ),
  "custody-journey-branch-dock-fault": (signals) =>
    signals.filter((s) => s.type !== "device.health_degraded" && s.type !== "api.integration_failed"),
};

// ── Pure predicates, so the planted-defect suite can exercise the same code ──

/** True when `want` appears in `ids` in that exact order with nothing between. */
export function orderedContiguously(ids: readonly string[], want: readonly string[]): boolean {
  if (want.length === 0) return false;
  const start = ids.indexOf(want[0]);
  if (start < 0 || start + want.length > ids.length) return false;
  return want.every((id, k) => ids[start + k] === id);
}

/** Does this scenario release the workflow? */
export function grants(scenario: SimulatorScenario): boolean {
  return runScenario(scenario).decision.outcomes.includes("allow");
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

const scenarios = listSimulatorScenarios();
const byId = new Map(scenarios.map((s) => [s.id, s]));
const journeyIds = scenarios.map((s) => s.id).filter((id) => id.startsWith(PREFIX));
const need = (id: string): SimulatorScenario => {
  const s = byId.get(id);
  if (!s) throw new Error(`journey scenario missing from the simulator: ${id}`);
  return s;
};

// ── THE PLANTED-DEFECT SUITE ────────────────────────────────────────────────
// Every predicate this proof leans on is shown to REPORT FALSE on an input that
// should fail it. Run inline below and, alone, under `--self-test`.
function selfTest(): number {
  const results: Array<[string, boolean]> = [];
  const t = (name: string, ok: boolean): void => { results.push([name, ok]); };

  t("order: a contiguous run in order is accepted", orderedContiguously(["x", "a", "b", "c"], ["a", "b", "c"]));
  t("order: a REORDERED pair is rejected", !orderedContiguously(["x", "b", "a", "c"], ["a", "b", "c"]));
  t("order: a stage REMOVED from the middle is rejected", !orderedContiguously(["a", "c"], ["a", "b", "c"]));
  t("order: an interleaved stranger is rejected (the run must be contiguous)", !orderedContiguously(["a", "zzz", "b"], ["a", "b"]));
  t("order: an empty expectation is rejected, never vacuously true", !orderedContiguously(["a", "b"], []));

  // A stage must grant, and must STOP granting when its base trust is removed.
  const stage1 = need(STAGES[0]);
  t("grant: the badge-tap stage releases the workflow", grants(stage1));
  t(
    "grant: the SAME stage with its identity signal removed no longer releases it",
    !grants({ ...stage1, startingSignals: stage1.startingSignals.filter((s) => s.type !== "identity.authenticated") }),
  );

  // A branch must refuse, and its restored control must grant — if the restore
  // did NOT grant, the branch would be proving nothing about its named fault.
  for (const branch of BRANCHES) {
    const scenario = need(branch.id);
    t(`branch ${branch.id}: refuses`, !grants(scenario));
    t(
      `branch ${branch.id}: the same moment WITHOUT its named fault grants (so the refusal is caused by the fault)`,
      grants({ ...scenario, startingSignals: RESTORED[branch.id](scenario.startingSignals) }),
    );
  }

  const failed = results.filter(([, ok]) => !ok);
  for (const [name, ok] of results) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length ? "FAILED" : "passed"} (${results.length - failed.length}/${results.length})`);
  return failed.length ? 1 : 0;
}

if (SELF_TEST_ONLY) {
  process.exit(selfTest());
}

// ── 1. THE JOURNEY IS DECLARED, ORDERED AND CONTIGUOUS ──────────────────────
check(
  `the journey declares exactly ${STAGES.length} stages and ${BRANCHES.length} branches (found ${journeyIds.length} scenarios under "${PREFIX}")`,
  journeyIds.length === STAGES.length + BRANCHES.length,
);
check(
  "the five stages appear in the simulator in journey order, contiguously",
  orderedContiguously(
    scenarios.map((s) => s.id),
    STAGES,
  ),
);
check(
  "every declared stage and branch exists in the simulator",
  [...STAGES, ...BRANCHES.map((b) => b.id)].every((id) => byId.has(id)),
);
check(
  "no journey scenario is declared that this proof does not name",
  journeyIds.every((id) => STAGES.includes(id as (typeof STAGES)[number]) || BRANCHES.some((b) => b.id === id)),
);

// ── 2. EVERY STAGE GRANTS, AND SAYS SO THE SAME WAY ─────────────────────────
for (const id of STAGES) {
  const result = runScenario(need(id));
  check(`${id}: the simulator's own verdict is PASS`, result.status === "PASS");
  check(
    `${id}: releases the workflow and records audit, and nothing else`,
    sameSet(result.decision.outcomes, ["allow", "record_audit"] satisfies DecisionOutcome[]),
  );
  check(`${id}: confidence is high (no degraded route in the happy path)`, result.decision.confidence === "high");
  check(`${id}: an owner is named on every routed action`, result.routedActions.every((a) => a.ownerTeam.length > 0));
  check(`${id}: every routed action is simulated only`, result.routedActions.every((a) => a.simulatedOnly));
}

// ── 3. EVERY BRANCH WITHDRAWS THE GRANT, FOR ITS OWN NAMED REASON ───────────
for (const branch of BRANCHES) {
  const scenario = need(branch.id);
  const result = runScenario(scenario);
  check(`${branch.id}: the simulator's own verdict is PASS`, result.status === "PASS");
  check(`${branch.id}: never allows`, !result.decision.outcomes.includes("allow"));
  check(
    `${branch.id}: names exactly its own reason codes (${branch.reasonCodes.join(", ")})`,
    sameSet(result.decision.reasonCodes, branch.reasonCodes),
  );
  check(
    `${branch.id}: the stage it departs from (${branch.departsFrom}) DOES grant — so this is a grant withdrawn, not a refusal in isolation`,
    grants(need(branch.departsFrom)),
  );
  check(
    `${branch.id}: the same moment without its named fault grants — the refusal is caused by the fault`,
    grants({ ...scenario, startingSignals: RESTORED[branch.id](scenario.startingSignals) }),
  );
  check(`${branch.id}: routes to a named owner`, result.routedActions.every((a) => a.ownerTeam.length > 0));
}

// The four branches must be four DIFFERENT answers. If two ever collapsed onto
// the same reason set, one of them would have stopped carrying its own meaning
// while both stayed green above.
const branchReasonKeys = BRANCHES.map((b) => [...b.reasonCodes].sort().join("+"));
check(
  "the four branches name four DISTINCT reason sets",
  new Set(branchReasonKeys).size === BRANCHES.length,
);
check(
  "the declared branch reason sets are the ones the engine actually emits",
  BRANCHES.every((b) => sameSet(runScenario(need(b.id)).decision.reasonCodes, b.reasonCodes)),
);

// ── 4. UNKNOWN RAISES ASSURANCE, ACROSS THE SAME MOMENT ─────────────────────
// The network-down branch is the whole premise of the runbooks: nearly every
// real failure root-causes to network or pairing. Same person, same device,
// same assignment as stage 4 — the only thing that changed is that the evidence
// stopped arriving, and the answer TIGHTENED. Golden rule 2, on the journey.
const inUse = runScenario(need("custody-journey-04-in-use"));
const netDown = runScenario(need("custody-journey-branch-network-down"));
check("stage 4 grants while its evidence is current", inUse.decision.outcomes.includes("allow"));
check("the network-down branch does NOT grant", !netDown.decision.outcomes.includes("allow"));
check(
  "the network-down branch steps up and asks for remediation rather than failing silent",
  netDown.decision.outcomes.includes("step_up") && netDown.decision.outcomes.includes("request_remediation"),
);
check(
  "the person is unchanged between the two — the tightening came from the missing evidence, not from the identity",
  need("custody-journey-04-in-use").startingSignals.some((s) => s.subject === "user:rn-501") &&
    need("custody-journey-branch-network-down").startingSignals.some((s) => s.subject === "user:rn-501" && s.attributes["risk"] === "low"),
);

// ── 5. DETERMINISM ──────────────────────────────────────────────────────────
for (const id of journeyIds) {
  const a = JSON.stringify(runScenario(need(id)));
  const b = JSON.stringify(runScenario(need(id)));
  check(`${id}: two runs of the same input are byte-identical`, a === b);
}

// ── 6. THE FAMILY EVALUATORS BEHIND EACH STAGE ──────────────────────────────
// Driven for real from their own fixtures, at the moment the stage decides.
// These are read-only graders in deferred connector families; none of them is
// on the simulator's decision path — they are the surfaces the stage REPRESENTS,
// answering the same question independently.

// Stage 1 — badge tap: device trust present, the badge worked so no fallback
// was needed, and the bay's beacon confirms custody.
const supervised = evaluateSupervisionIdentityFixture("supervised-trusted");
check(
  "stage 1 / device-attestation: a supervised, org-bound, enrolled, responsive device is the one grant",
  supervised?.recommendedAction === "none" && supervised.trustPreconditionMet === true,
);
const badgeOk = evaluateManualFallbackFixture("badge-succeeded-no-fallback");
check(
  "stage 1 / break-glass: a badge that SUCCEEDED is allowed without a manual fallback, not denied for never using one",
  badgeOk?.decision === "allow" && badgeOk.reasonCode === "FALLBACK_BADGE_CHECKOUT_OK",
);
const beaconInBay = evaluateCustodyBeacon({
  sourceSystem: "custody-beacon",
  deviceRef: "iphone-shared-51",
  zone: "in_custody_zone",
  freshness: "fresh",
  reachability: "reachable",
  reportIntegrity: "clean",
  source: "journey-fixture",
});
check(
  "stage 1 / custody-beacon: in zone, reachable and fresh confirms custody",
  beaconInBay.recommendedAction === "none" && beaconInBay.custodyConfirmed === true,
);

// Stage 2 — dock release: the ledger is clear and the requester is under cap.
const ledgerClear = evaluateCustodyLedgerFixture("clear");
check(
  "stage 2 / rtls-custody: a clear ledger over a seated, paired bay with the requester under cap is ready for check-out",
  ledgerClear?.recommendedAction === "none" && ledgerClear.readyForCheckout === true,
);

// Stage 3 — provision, inside the shift-change automation window.
const prepReady = evaluateDevicePrepFixture("ready");
check(
  "stage 3 / app-update: enrolled + profiles applied + apps installed + OS current + prep complete is ready",
  prepReady?.recommendedAction === "none" && prepReady.readyForCheckout === true,
);
const shiftWindow = {
  sourceSystem: "change-window" as const,
  changeRef: "CHG-shift-ed-501",
  source: "journey-fixture",
  windowStanding: "inside" as const,
  approvalState: "approved" as const,
  actorAuthorization: "authorized" as const,
  recordFreshness: "fresh" as const,
  reportIntegrity: "clean" as const,
  itsmChangeRef: "CHG-shift-ed-501",
  windowStart: null,
  windowEnd: null,
  authorizedActorRef: "svc:shift-automation",
  operatingActorRef: "svc:shift-automation",
  changeClass: "normal",
  recordObservedAt: "2026-06-09T14:00:00.000Z",
  itsmSource: "journey-fixture",
};
check(
  "stage 3 / change-window: the shift-change automation runs inside an approved window, by the authorized actor",
  evaluateChangeWindow(shiftWindow).changeAuthorized === true,
);
check(
  "stage 3 / change-window: the same run OUTSIDE its window is not authorized",
  evaluateChangeWindow({ ...shiftWindow, windowStanding: "outside" }).changeAuthorized === false,
);

// Stage 4 — in use on the expected network segment.
const NOW_MS = Date.parse("2026-06-09T14:05:00.000Z");
const onSegment = evaluateNetwork(
  {
    sourceSystem: "network-nac",
    correlationId: "custody-journey-501",
    observedAt: "2026-06-09T14:00:00.000Z",
    deviceId: "iphone-shared-51",
    authState: "authenticated",
    segment: "clinical-mobile",
    accessLocation: "ap-ed-04",
    nacCompliant: true,
    lastAuthAt: "2026-06-09T14:00:00.000Z",
    freshness: "fresh",
  },
  NOW_MS,
  { segmentPolicy: { expected: ["clinical-mobile"] } },
);
check(
  "stage 4 / network-nac: authenticated, NAC-compliant, on the expected segment grades clean",
  onSegment.recommendedAction === "none" && onSegment.posture === "on_trusted_segment",
);

// Stage 5 — check-in: the ledger clears again and the device re-provisions.
check(
  "stage 5 / rtls-custody + app-update: check-in re-reads the same two grants (the journey closes where it opened)",
  evaluateCustodyLedgerFixture("clear")?.recommendedAction === "none" &&
    evaluateDevicePrepFixture("ready")?.recommendedAction === "none",
);

// Branch surfaces — each branch's family answer, and each one refuses.
const unpairedLedger = evaluateCustodyLedgerFixture("unpaired-in-slot");
check(
  "branch unpaired / rtls-custody: an unpaired device occupying a bay is CONTAINED and named",
  unpairedLedger?.recommendedAction === "restrict" && unpairedLedger.reasonCode === "CUSTODY_UNPAIRED_IN_SLOT",
);
const capLedger = evaluateCustodyLedgerFixture("cap-blocked-stale");
check(
  "branch cap-hit / rtls-custody: a cap hit only by returns that never cleared HOLDS with a legible reason, not a mystery beep",
  capLedger?.recommendedAction === "step_up" && capLedger.reasonCode === "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN",
);
const faultedPrep = evaluateDevicePrepFixture("prep-failed");
check(
  "branch dock-fault / app-update: a device whose prep failed in the bay is contained, never handed out",
  faultedPrep?.recommendedAction === "restrict" && faultedPrep.readyForCheckout === false,
);
const darkChannel = evaluateSupervisionIdentityFixture("channel-unresponsive");
check(
  "branch network-down / device-attestation: supervised on paper but answering no command is a hold, never a grant",
  darkChannel?.recommendedAction === "step_up" && darkChannel.trustPreconditionMet === false,
);
const netUnknown = evaluateNetwork(
  {
    sourceSystem: "network-nac",
    correlationId: "custody-journey-501",
    observedAt: "2026-06-09T14:00:00.000Z",
    deviceId: "iphone-shared-51",
    authState: "unknown",
    segment: null,
    accessLocation: null,
    nacCompliant: null,
    lastAuthAt: null,
    freshness: "unknown",
  },
  NOW_MS,
  { segmentPolicy: { expected: ["clinical-mobile"] } },
);
check(
  "branch network-down / network-nac: an unreported network state is never the clean grade the authenticated path earns",
  netUnknown.recommendedAction !== "none" && netUnknown.posture !== "on_trusted_segment",
);
// "The decision must still be made when the network is down" — the local-authority
// row of the ground-truth map. Offline is not an excuse for no answer, and it is
// not an excuse for a loose one either.
const localBase = {
  deviceRef: "iphone-shared-51",
  covered: true,
  grantAgeSeconds: 600,
  maxDisconnectedSeconds: 86400,
  source: "journey-fixture",
  observedAt: "2026-06-09T14:00:00.000Z",
};
const localCurrent = evaluateLocalAuthority({
  ...localBase,
  protectedData: "available",
  localAuth: "verified",
  standing: "within_grant",
  clockConfidence: "trusted",
});
check(
  "branch network-down / local-authority: a device with a readable vault, a human unlock and an unexpired grant may still act offline",
  localCurrent.action === "none" && localCurrent.mayActLocally === true,
);
const localUnknown = evaluateLocalAuthority({
  ...localBase,
  protectedData: "unknown",
  localAuth: "unknown",
  standing: "unknown",
  clockConfidence: "unknown",
  grantAgeSeconds: null,
  maxDisconnectedSeconds: null,
});
check(
  "branch network-down / local-authority: when the same device cannot establish those, it may NOT act — unknown raises",
  localUnknown.action !== "none" && localUnknown.mayActLocally === false,
);

// ── 7. THE SAME JOURNEY AS AN EVENT-CONTRACT TIMELINE ───────────────────────
// The cross-domain plane. `detect.ts` sees only the event fabric — no fixture,
// no evaluator — which is the point: a contradiction BETWEEN planes is the one
// thing no single plane can report.
const CORR = "custody-journey-501";
const ev = (
  eventType: SignalGridEvent["eventType"],
  eventId: string,
  extra: Partial<SignalGridEvent> = {},
): SignalGridEvent => ({
  eventType,
  eventId,
  occurredAt: "2026-06-09T14:00:00.000Z",
  correlationId: CORR,
  tenantId: "tenant-journey",
  userId: "rn-501",
  deviceId: "iphone-shared-51",
  ...extra,
});

/** The happy journey, plane by plane, start to finish. */
const happyTimeline: SignalGridEvent[] = [
  ev("badge_access", "e1", { badgeId: "badge-501", badgeAuthOutcome: "success", dockId: "ED-01" }),
  ev("checkout_requested", "e2", { dockId: "ED-01", bayId: "04" }),
  ev("checkout_granted", "e3", { dockId: "ED-01", bayId: "04" }),
  ev("dock_unlocked", "e4", { dockId: "ED-01", bayId: "04" }),
  ev("device_removed", "e5", { dockId: "ED-01", bayId: "04", chargeState: "discharging" }),
  ev("posture_changed", "e6", { mdmDeviceState: "compliant" }),
  ev("reachability_changed", "e7", { carrierConnectivityState: "online" }),
  ev("device_returned", "e8", { dockId: "ICU-03", bayId: "02" }),
  ev("dock_relocked", "e9", { dockId: "ICU-03", bayId: "02", chargeState: "charging" }),
  ev("posture_changed", "e10", { mdmDeviceState: "compliant" }),
];
const happyDetections = detectCrossDomain(happyTimeline);
check(
  `the completed journey raises NO cross-domain detection (raised: ${happyDetections.map((d) => d.code).join(", ") || "none"})`,
  happyDetections.length === 0,
);
check(
  "the happy timeline is not vacuous — it carries every plane the detections read",
  happyTimeline.some((e) => e.eventType === "badge_access") &&
    happyTimeline.some((e) => e.eventType === "checkout_granted") &&
    happyTimeline.some((e) => e.mdmDeviceState === "compliant") &&
    happyTimeline.some((e) => e.eventType === "device_returned"),
);

/** Unpaired: physically seated, but custody never closes — no return is ever recorded. */
const unpairedTimeline: SignalGridEvent[] = [
  ...happyTimeline.slice(0, 7),
  ev("dock_timeout", "u8", { dockId: "ICU-03", bayId: "02" }),
  ev("custody_expired", "u9", { dockId: "ICU-03", bayId: "02" }),
];
const unpairedDetections = detectCrossDomain(unpairedTimeline);
check(
  "timeline / unpaired: a seated device whose custody never closes is caught as LEFT_PREMISES_WITHOUT_RETURN",
  unpairedDetections.some((d) => d.code === "LEFT_PREMISES_WITHOUT_RETURN" && d.evidenceEventIds.includes("u9")),
);

/** Network-down: the device goes dark mid-shift and never reports compliant. */
const networkDownTimeline: SignalGridEvent[] = [
  ...happyTimeline.slice(0, 5),
  ev("posture_changed", "n6", { mdmDeviceState: "unknown" }),
  ev("reachability_changed", "n7", { carrierConnectivityState: "offline" }),
];
const netDetectionObjs = detectCrossDomain(networkDownTimeline);
const netDetections = netDetectionObjs.map((d) => d.code);
check(
  `timeline / network-down: raises exactly CHECKOUT_WITHOUT_COMPLIANCE + LEFT_PREMISES_WITHOUT_RETURN + INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE (raised: ${netDetections.join(", ") || "none"})`,
  sameSet(netDetections, [
    "CHECKOUT_WITHOUT_COMPLIANCE",
    "LEFT_PREMISES_WITHOUT_RETURN",
    "INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE",
  ]),
);

/** Cap-hit: the release is DENIED, and the prior checkout that blocks it never closed. */
const capTimeline: SignalGridEvent[] = [
  ev("custody_expired", "c1", { deviceId: "iphone-shared-49", dockId: "ED-01" }),
  ev("badge_access", "c2", { badgeId: "badge-501", badgeAuthOutcome: "success", dockId: "ED-01" }),
  ev("checkout_requested", "c3", { deviceId: "iphone-shared-52", dockId: "ED-01", bayId: "06" }),
  ev("checkout_denied", "c4", { deviceId: "iphone-shared-52", dockId: "ED-01", bayId: "06" }),
];
const capDetections = detectCrossDomain(capTimeline);
check(
  "timeline / cap-hit: the STALE PRIOR checkout that blocks the cap is what the fabric surfaces, on a device that was never released",
  capDetections.some((d) => d.code === "LEFT_PREMISES_WITHOUT_RETURN" && d.evidenceEventIds.includes("c1")) &&
    !capDetections.some((d) => d.code === "CHECKOUT_WITHOUT_COMPLIANCE"),
);

/** Dock-fault: the bay's bridge drops and the check-in is never written. */
const dockFaultTimeline: SignalGridEvent[] = [
  ...happyTimeline.slice(0, 7),
  ev("reachability_changed", "d8", { carrierConnectivityState: "offline", dockId: "ICU-03", bayId: "02" }),
  ev("dock_timeout", "d9", { dockId: "ICU-03", bayId: "02" }),
];
const dockFaultDetections = detectCrossDomain(dockFaultTimeline);
check(
  "timeline / dock-fault: the unclosed custody is caught, and on DIFFERENT evidence than the unpaired branch",
  dockFaultDetections.some((d) => d.code === "LEFT_PREMISES_WITHOUT_RETURN" && d.evidenceEventIds.includes("d8")) &&
    !dockFaultDetections.some((d) => d.code === "LEFT_PREMISES_WITHOUT_RETURN" && d.evidenceEventIds.includes("u9")),
);

// HONEST LIMIT, stated rather than implied — and ASSERTED, so it cannot quietly
// become a claim. ALL FOUR branch timelines resolve to the same
// `LEFT_PREMISES_WITHOUT_RETURN` code on different evidence, because the contract
// has exactly one "custody never closed" detection today. Telling them apart on
// the timeline is `CUSTODY_STALE_OR_CONTESTED`, which is decision-core work and
// an open row in docs/BUILD_BACKLOG.md — not something this proof pretends to have.
const branchTimelineCodes = [unpairedDetections, netDetectionObjs, capDetections, dockFaultDetections].map((ds) =>
  ds.map((d) => d.code as string),
);
check(
  "all four branch timelines raise the SAME custody-never-closed code — they are NOT distinguishable by code today, and the distinguishing detection is a filed backlog row",
  branchTimelineCodes.filter((codes) => codes.includes("LEFT_PREMISES_WITHOUT_RETURN")).length === 4,
);

// ── 8. THE PLANTED-DEFECT SUITE, INLINE ─────────────────────────────────────
check("self-test suite: every planted defect is caught", selfTest() === 0);

const total = passed + failures.length;
console.log(`\nCustody journey proof: ${STAGES.length} stages + ${BRANCHES.length} branches`);
for (const id of journeyIds) {
  const r = runScenario(need(id));
  console.log(`- ${r.status} ${id}: ${r.decision.primaryOutcome} [${r.decision.reasonCodes.join(", ") || "—"}]`);
}
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
