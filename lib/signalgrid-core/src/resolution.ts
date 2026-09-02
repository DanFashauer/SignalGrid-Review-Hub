import { deriveCriticalSignalsPresent } from "./evidence";
import { evaluatePolicy } from "./policy";
import type {
  Decision,
  DecisionEvidence,
  PolicyVersion,
  ResolutionChannel,
  ResolutionClass,
  ResolutionConfig,
  ResolutionPlan,
  ResolutionSimulation,
  ResolutionStep,
} from "./types";

/**
 * The Resolution Assistant — deterministic, fixture-backed, public-safe.
 *
 * It turns a non-allow decision into a resolution path: it explains the blocks
 * from the reason codes, proposes ordered steps classified as auto_proposed /
 * requires_approval / manual_only, routes them to the organization's channels,
 * and can SIMULATE the outcome after the resolvable fixes are applied.
 *
 * SAFETY: every proposal is approval-gated and simulated. Nothing here executes
 * a change on a source system, and there is no autonomous production
 * remediation — the private production core would gate real execution behind a
 * human approval. Simulation only previews a projected outcome.
 */

type EvidenceTransform = Partial<
  Pick<
    DecisionEvidence,
    | "postureFreshness"
    | "identityEnabled"
    | "deviceCompliance"
    | "deviceManaged"
    | "deviceEncrypted"
    | "custodyState"
    | "tamperState"
    | "dockChargeState"
    | "dockState"
    | "baselineCompliance"
    | "badgeBinding"
    // Added with the descriptors for the four refusals that previously had no served
    // path. This list is a WHITELIST, not a convenience: it names the evidence a
    // resolution is allowed to claim it changed, and every entry is a field some
    // human or system can actually put right. `criticalSignalsPresent` is
    // deliberately absent and must stay absent — it is DERIVED from the others by
    // `deriveCriticalSignalsPresent`, and letting a transform set it directly would
    // let a resolution assert completeness it had not earned.
    | "benchmarkSelection"
    | "shiftContext"
    // The two launch-family rollups: a restored management plane and a re-verified
    // local-authority grant are both states a named owner can actually produce.
    | "managementHealthState"
    | "localAuthorityState"
  >
>;

interface ResolutionDescriptor {
  baseClass: ResolutionClass;
  workerAction: string;
  operatorAction: string;
  /** The evidence change a successful resolution would produce (null = hard). */
  transform: EvidenceTransform | null;
  /** Route worker-facing steps to the org's primary hardware channel. */
  hardwareOriented: boolean;
}

const DESCRIPTORS: Record<string, ResolutionDescriptor> = {
  POSTURE_STALE: {
    baseClass: "auto_proposed",
    workerAction: "Reconnect the device (or return it to its dock) to refresh its compliance check, then retry.",
    operatorAction: "Request a posture re-sync from the device-management source, then re-evaluate.",
    transform: { postureFreshness: "fresh" },
    hardwareOriented: false,
  },
  POSTURE_STALE_STRICT: {
    baseClass: "auto_proposed",
    workerAction: "Reconnect the device (or return it to its dock) to refresh its compliance check, then retry.",
    operatorAction: "Request a posture re-sync from the device-management source, then re-evaluate.",
    transform: { postureFreshness: "fresh" },
    hardwareOriented: false,
  },
  POSTURE_MISSING: {
    baseClass: "auto_proposed",
    workerAction: "Bring the device online and let it check in (dock or reconnect), then retry.",
    operatorAction: "Request a posture check-in; if the device never reports, escalate to device operations.",
    transform: { postureFreshness: "fresh" },
    hardwareOriented: false,
  },
  IDENTITY_STATE_UNKNOWN: {
    baseClass: "auto_proposed",
    workerAction: "Re-verify your identity (re-badge at the reader or re-authenticate), then retry.",
    operatorAction: "Ask the worker to re-authenticate; confirm the identity source is reachable.",
    transform: { identityEnabled: true },
    hardwareOriented: true,
  },
  IDENTITY_STATE_UNKNOWN_STRICT: {
    baseClass: "auto_proposed",
    workerAction: "Re-verify your identity (re-badge at the reader or re-authenticate), then retry.",
    operatorAction: "Ask the worker to re-authenticate; confirm the identity source is reachable.",
    transform: { identityEnabled: true },
    hardwareOriented: true,
  },
  DEVICE_NONCOMPLIANT: {
    baseClass: "requires_approval",
    workerAction: "Follow the on-device compliance prompt, or hand the device to IT to bring it back into compliance.",
    operatorAction: "Approve a compliance remediation request to the device-management owner, then re-evaluate.",
    transform: { deviceCompliance: "compliant" },
    hardwareOriented: false,
  },
  DEVICE_UNMANAGED: {
    baseClass: "requires_approval",
    workerAction: "Use a managed shared device for this task, or enrol this device via the company portal.",
    operatorAction: "Approve an enrolment request, or direct the worker to a managed device.",
    transform: { deviceManaged: true },
    hardwareOriented: false,
  },
  ENCRYPTION_REQUIRED_FOR_WORKFLOW: {
    baseClass: "requires_approval",
    workerAction: "Wait for device encryption to be enforced before starting this workflow.",
    operatorAction: "Approve an encryption-enforcement request for this device.",
    transform: { deviceEncrypted: true },
    hardwareOriented: false,
  },
  IDENTITY_DISABLED: {
    baseClass: "manual_only",
    workerAction: "Your account is disabled — contact your manager or IT to have it reviewed.",
    operatorAction: "Route to the identity/access owner: the account is disabled and needs human review.",
    transform: null,
    hardwareOriented: false,
  },
  CRITICAL_WORKFLOW_UNTRUSTED_DEVICE: {
    baseClass: "manual_only",
    workerAction: "This high-risk workflow requires a managed, trusted device — switch to one to continue.",
    operatorAction: "Advise the worker to use a managed shared device; do not grant this workflow on an untrusted device.",
    transform: null,
    hardwareOriented: false,
  },
  CUSTODY_OVERDUE: {
    baseClass: "auto_proposed",
    workerAction: "Return the device to its dock or bay to check it back in, then retry.",
    operatorAction: "Confirm the device is returned/checked in at its bay, then re-evaluate.",
    transform: { custodyState: "checked_in" },
    hardwareOriented: true,
  },
  CUSTODY_EXCEPTION: {
    baseClass: "requires_approval",
    workerAction: "A custody issue was flagged — an operator is reviewing the device's dock/bay status.",
    operatorAction: "Review the custody exception (removed without a session?) and clear or route it.",
    transform: { custodyState: "checked_in" },
    hardwareOriented: false,
  },
  CUSTODY_MAINTENANCE: {
    baseClass: "requires_approval",
    workerAction: "This device is in maintenance — use a different device; an operator can release it from maintenance.",
    operatorAction: "Confirm the device has completed maintenance and release it (check it back in), then re-evaluate.",
    transform: { custodyState: "checked_in" },
    hardwareOriented: false,
  },
  BATTERY_CRITICAL: {
    baseClass: "auto_proposed",
    workerAction: "Battery is critically low — swap to a charged shared device, or dock this one before starting.",
    operatorAction: "Direct the worker to a charged device; the low-battery device can keep charging in its bay.",
    transform: { dockChargeState: "charged" },
    hardwareOriented: true,
  },
  BATTERY_FAILING: {
    // `manual_only` with a null transform, and the pairing is the point.
    //
    // Every other battery/charge path has a transform because charging clears it.
    // This one has none: no automated or worker-performed step changes a failing
    // battery, so there is nothing honest to project. `simulateResolution` skips
    // null transforms, so the simulation will correctly show this NOT resolving.
    //
    // It must also be `manual_only` rather than `requires_approval`, because
    // `autoResolvable` is computed as "no manual step present" — a
    // `requires_approval` step with no transform would report the plan as
    // auto-resolvable while the simulation showed it resolving nothing. That
    // contradiction is the same self-contradictory-verdict shape this repo has
    // been closing elsewhere, so the invariant is asserted in the proof:
    // transform === null if and only if manual_only.
    baseClass: "manual_only",
    workerAction:
      "This device's battery can no longer hold a shift — charging will not fix it. Use a different device and hand this one in.",
    operatorAction:
      "Pull the device for battery replacement; it will keep failing on charge. Do not clear this by re-docking.",
    transform: null,
    hardwareOriented: false,
  },
  TAMPER_SUSPECTED: {
    baseClass: "requires_approval",
    workerAction: "This device is flagged for a physical check — an operator will inspect it before it can be used.",
    operatorAction: "Inspect the device for tamper; approve to clear only after physical inspection.",
    transform: { tamperState: "none" },
    hardwareOriented: false,
  },
  TAMPER_CONFIRMED: {
    baseClass: "manual_only",
    workerAction: "This device is out of service (tamper confirmed) — use a different device and report it.",
    operatorAction: "Remove the device from service and route to security operations; do not clear automatically.",
    transform: null,
    hardwareOriented: false,
  },
  TAMPER_SENSOR_UNAVAILABLE: {
    baseClass: "requires_approval",
    workerAction: "This device's tamper sensor isn't reporting — an operator will confirm the device is intact before it can be used.",
    operatorAction: "Physically confirm the device is intact (or move it to a dock with a working tamper sensor), then approve to clear.",
    transform: { tamperState: "none" },
    hardwareOriented: false,
  },
  DOCK_FAULTED: {
    baseClass: "requires_approval",
    workerAction: "The dock holding this device is faulted — an operator will move it to a healthy dock/bay before it can be used.",
    operatorAction: "Move the device to a healthy SmartDock/bay to re-establish custody (and service the faulted dock), then re-evaluate.",
    transform: { dockState: "occupied" },
    hardwareOriented: false,
  },
  DOCK_OFFLINE: {
    baseClass: "auto_proposed",
    workerAction: "This dock is offline — return the device to an online dock/bay to refresh its custody state, then retry.",
    operatorAction: "Confirm the device is on an online SmartDock/bay (or reconnect the dock), then re-evaluate.",
    transform: { dockState: "occupied" },
    hardwareOriented: true,
  },
  BADGE_REMOVED: {
    baseClass: "auto_proposed",
    workerAction: "Re-insert your badge into the reader case to re-bind it to this device, then retry.",
    operatorAction: "Confirm the worker's badge is re-seated in the reader case, then re-evaluate.",
    transform: { badgeBinding: "present" },
    hardwareOriented: true,
  },
  BADGE_FORCED_REMOVAL: {
    baseClass: "manual_only",
    workerAction: "This device is locked out — the badge was forcibly removed. Use a different device and report it.",
    operatorAction: "Out of service: forced badge removal / reader-case tamper — route to security operations; do not clear automatically.",
    transform: null,
    hardwareOriented: false,
  },
  BASELINE_DRIFTED: {
    baseClass: "auto_proposed",
    workerAction: "This device has drifted from its security baseline — return it to its dock or reconnect so the hardening profile re-applies, then retry.",
    operatorAction: "Request a baseline (CIS/hardening) re-scan and profile re-apply from the endpoint-management source, then re-evaluate.",
    transform: { baselineCompliance: "aligned" },
    hardwareOriented: true,
  },
  BASELINE_DRIFTED_STRICT: {
    baseClass: "requires_approval",
    workerAction: "This device drifted from its security baseline and needs review before this workflow — an operator will re-apply the hardening profile.",
    operatorAction: "Approve a baseline re-apply (CIS/hardening profile) for this device, then re-evaluate.",
    transform: { baselineCompliance: "aligned" },
    hardwareOriented: false,
  },

  // ── The four refusals that used to have NO served path ─────────────────────
  //
  // Found by the ITSM derivation in `scripts/check-it-layer-model.mjs`, which reads
  // this table to decide what carries a refusal. These four had no descriptor, so a
  // worker stopped by one got an honest human owner and nothing else: no step, no
  // simulation, no way back. `buildResolutionPlan` was right to route them to a
  // person rather than promise a fix it did not have — but "correct" and "useful"
  // are different, and this closes the gap the derivation made visible.
  //
  // BOTH ARE `requires_approval`, NEITHER IS `auto_proposed`, and that is the whole
  // judgement here.

  // Benchmark selection: the hardening answer rests on the wrong document — another
  // platform's benchmark, an empty assessment, or one this workflow does not accept.
  // No worker can fix that; re-assigning a baseline is a security-engineering action.
  BENCHMARK_SELECTION_MISFIT: {
    baseClass: "requires_approval",
    workerAction:
      "This device's hardening result was measured against the wrong benchmark. It needs a security owner — nothing you can do on the device changes it.",
    operatorAction:
      "Assign the benchmark that matches this device's platform and this workflow's requirement, re-run the assessment, then re-evaluate.",
    transform: { benchmarkSelection: "confirmed" },
    hardwareOriented: false,
  },
  BENCHMARK_SELECTION_UNESTABLISHED_STRICT: {
    baseClass: "requires_approval",
    workerAction:
      "This device's benchmark selection has not been established, and this workflow requires it. A security owner has to confirm which benchmark applies.",
    operatorAction:
      "Establish the applicable benchmark for this platform (the strict policy will not accept an unverified selection), then re-evaluate.",
    transform: { benchmarkSelection: "confirmed" },
    hardwareOriented: false,
  },

  // Shift context: the labor plane disagrees with this moment. `auto_proposed` was
  // considered and REJECTED, and the reason matters more than the classification.
  //
  // A self-service step here would read "clock in to continue" — and the misfit
  // states are precisely: scheduled-but-clocked-out (which IS off-the-clock work, a
  // wage-and-hour control), operating while neither scheduled nor punched in, or
  // someone else's badge. Prompting the worker would coach them around the control
  // in the first case and deepen an impersonation in the last. A dimension that
  // exists to detect off-the-clock operation must not offer clocking in as its fix.
  //
  // So the path back is a supervisor confirming the labor record — a real served
  // path, re-evaluatable, with a human who owns the exception.
  SHIFT_CONTEXT_MISFIT: {
    baseClass: "requires_approval",
    workerAction:
      "The labor system does not show you on shift for this. Ask your supervisor to confirm your shift record — do not clock in to get past this.",
    operatorAction:
      "Have the supervisor or workforce-management owner verify this worker's shift, punch state and site, correct the record if it is wrong, then re-evaluate.",
    transform: { shiftContext: "confirmed" },
    hardwareOriented: false,
  },
  SHIFT_CONTEXT_UNESTABLISHED_STRICT: {
    baseClass: "requires_approval",
    workerAction:
      "Your shift could not be confirmed, and this workflow requires it. Ask your supervisor to confirm your shift record.",
    operatorAction:
      "Establish the labor-plane answer for this worker (the strict policy will not accept an unverified shift), then re-evaluate.",
    transform: { shiftContext: "confirmed" },
    hardwareOriented: false,
  },

  // The two launch-family refusals (PRODUCT_COMPLETION_PLAN §10 D1). Both are
  // `requires_approval`: restoring a management plane and re-verifying a device's
  // local authority are operator actions against systems of record, never
  // something the worker fixes on the device.
  MANAGEMENT_HEALTH_BROKEN: {
    baseClass: "requires_approval",
    workerAction:
      "This device's management system has failed — its safety answers can't be trusted right now. Swap to a healthy device; an operator has to repair this one's enrollment.",
    operatorAction:
      "Re-enroll the device in the management plane (or complete the failed enrollment), confirm a fresh check-in, then re-evaluate.",
    transform: { managementHealthState: "healthy" },
    hardwareOriented: false,
  },
  LOCAL_AUTHORITY_WITHHELD: {
    baseClass: "requires_approval",
    workerAction:
      "This device's permission to act on its own was withdrawn by the control plane. Nothing on the device changes that — an operator has to re-verify its authority.",
    operatorAction:
      "Re-issue the device's local-authority lease (verify its clock source and revocation state first), then re-evaluate.",
    transform: { localAuthorityState: "verified" },
    hardwareOriented: false,
  },
};

/**
 * The MINIMUM a gate needs to assert the transform/class invariant, and nothing
 * more.
 *
 * An earlier version of this exported the descriptor objects themselves behind
 * `ReadonlyArray<readonly [string, Readonly<ResolutionDescriptor>]>` and claimed
 * in a comment that "the table stays private". That was false, and an
 * adversarial review demonstrated it with no type casts at all: `Readonly<T>` is
 * shallow and erased at runtime, so `entries[i][1].transform.dockChargeState =
 * "low"` typechecks and mutates the live table. Flipping `BATTERY_FAILING` that
 * way produced a plan reporting `autoResolvable: true` while its own simulation
 * resolved nothing — the exact contradiction the invariant exists to prevent,
 * reachable from any consumer, and AFTER the gate had already run.
 *
 * So this projects to primitives. There is no object here to reach through: a
 * caller can copy these booleans, and copying them changes nothing.
 */
export interface ResolutionDescriptorShape {
  reasonCode: string;
  baseClass: ResolutionClass;
  hasTransform: boolean;
}

export const RESOLUTION_DESCRIPTOR_SHAPES: readonly ResolutionDescriptorShape[] =
  Object.freeze(
    Object.entries(DESCRIPTORS).map(([reasonCode, d]) =>
      Object.freeze({
        reasonCode,
        baseClass: d.baseClass,
        hasTransform: d.transform !== null,
      }),
    ),
  );

export function buildResolutionPlan(
  decision: Decision,
  config: ResolutionConfig,
): ResolutionPlan {
  const steps: ResolutionStep[] = [];
  let order = 1;
  // A failing battery SUPERSEDES a low one. Both reason codes fire on a device
  // that is both flat and worn out, and the outcome is already correct
  // (restrict, escalation) — but the worker-facing text was not: it still read
  // "swap to a charged device, or dock this one before starting", which is
  // precisely the charge-and-retry loop `BATTERY_FAILING` exists to end. The
  // verdict was honest and the guidance contradicted it. Dropping the charge
  // step is safe in one direction only: it removes advice, never a block.
  const batteryFailing = decision.reasonCodes.includes("BATTERY_FAILING");
  for (const code of decision.reasonCodes) {
    if (batteryFailing && code === "BATTERY_CRITICAL") {
      continue;
    }
    const descriptor = DESCRIPTORS[code];
    if (!descriptor) {
      continue;
    }
    let resolutionClass = descriptor.baseClass;
    if (resolutionClass === "auto_proposed" && !config.autoProposeEnabled) {
      resolutionClass = "requires_approval";
    }
    const worker = resolutionClass === "auto_proposed";
    steps.push({
      order: order++,
      reasonCode: code,
      audience: worker ? "worker" : "operator",
      channel: channelFor(descriptor, resolutionClass, config),
      resolutionClass,
      action: worker ? descriptor.workerAction : descriptor.operatorAction,
      clears: code,
    });
  }

  // SILENCE IS NOT RESOLVABILITY (2026-09-02, verdict-core finding V9).
  //
  // The loop above `continue`s past any reason code with no DESCRIPTORS entry, so
  // a blocking code the planner has no answer for left NO trace in the plan: the
  // plan was assembled as though that code had never fired. `autoResolvable`
  // already refused to be true with zero steps, but `path` did not — a DENY whose
  // only codes lack descriptors reported `path: "self_service"` (executed
  // counterexample, 2026-09-02), which is the wrong word for a block nobody can
  // clear. The unanswered codes are now CARRIED, and every optimistic field is
  // false while the list is non-empty.
  //
  // Which codes count is DERIVED from the MATCHED RULE that contributed the code,
  // not from the code's identity (review finding F3, 2026-09-02). A code
  // contributed by a rule whose own outcome was `allow` (TRUST_ESTABLISHED is the
  // live case, and it rides along on most restrict/step_up decisions) is an
  // affirmative finding with nothing to resolve, and an `allow` decision has no
  // block at all. What remains is exactly the set of descriptor-less codes that
  // could have held the worker back.
  //
  // The first cut of this excluded by code IDENTITY — any code an allow rule
  // mentioned was excluded outright — and reason codes are NOT unique to a rule
  // (`policy.ts` pushes `rule.reasonCode` verbatim, and tenant-authored rule sets
  // may reuse a spelling). One allow rule anywhere in an active version carrying
  // the same code as a DENY rule therefore disappeared the deny's own block from
  // the plan, restoring the exact silence this carrying exists to end. The
  // exclusion now requires that EVERY matched rule contributing the code was an
  // allow: one non-allow contributor is enough to keep it.
  const matched = decision.matchedRules ?? [];
  const allowContributed = new Set(
    matched.filter((rule) => rule.outcome === "allow").map((rule) => rule.reasonCode),
  );
  for (const rule of matched) {
    if (rule.outcome !== "allow") {
      allowContributed.delete(rule.reasonCode);
    }
  }
  const unresolvedCodes =
    decision.outcome === "allow"
      ? []
      : decision.reasonCodes.filter(
          (code) => !DESCRIPTORS[code] && !allowContributed.has(code),
        );

  const hasManual = steps.some((s) => s.resolutionClass === "manual_only");
  const hasApproval = steps.some((s) => s.resolutionClass === "requires_approval");
  const hasUnresolved = unresolvedCodes.length > 0;
  const path =
    hasManual || hasUnresolved ? "escalation" : hasApproval ? "assisted" : "self_service";
  const autoResolvable = steps.length > 0 && !hasManual && !hasUnresolved;

  return {
    decisionId: decision.id,
    outcome: decision.outcome,
    summaryForWorker: workerSummary(decision, path, steps.length),
    summaryForOperator: operatorSummary(decision, steps, path, unresolvedCodes),
    steps,
    autoResolvable,
    path,
    unresolvedCodes,
  };
}

/**
 * Preview the outcome after the resolvable (non-manual) fixes are applied to the
 * decision's immutable evidence. This never mutates stored state; it re-runs the
 * policy against a transformed copy of the evidence to project the result.
 */
export function simulateResolution(
  decision: Decision,
  evidence: DecisionEvidence,
  version: PolicyVersion,
): ResolutionSimulation {
  const applied: string[] = [];
  let projected: DecisionEvidence = { ...evidence };
  // Same suppression as `buildResolutionPlan`, and it must be the same or the
  // two disagree: the plan would omit the charge step while the simulation still
  // projected a charge fix, so `appliedReasonCodes` would list a step no worker
  // was ever given.
  const batteryFailing = decision.reasonCodes.includes("BATTERY_FAILING");
  for (const code of decision.reasonCodes) {
    if (batteryFailing && code === "BATTERY_CRITICAL") {
      continue;
    }
    const descriptor = DESCRIPTORS[code];
    if (!descriptor || descriptor.baseClass === "manual_only" || !descriptor.transform) {
      continue;
    }
    projected = { ...projected, ...descriptor.transform };
    if (!applied.includes(code)) {
      applied.push(code);
    }
  }
  projected = {
    ...projected,
    criticalSignalsPresent: deriveCriticalSignalsPresent(projected),
  };
  const evaluation = evaluatePolicy(version, projected);
  return {
    decisionId: decision.id,
    originalOutcome: decision.outcome,
    appliedReasonCodes: applied,
    projectedOutcome: evaluation.outcome,
    projectedReasonCodes: evaluation.reasonCodes,
    resolved: evaluation.outcome === "allow",
    note: "Simulated preview only — approval-gated; no source-system change is executed.",
  };
}

function channelFor(
  descriptor: ResolutionDescriptor,
  resolutionClass: ResolutionClass,
  config: ResolutionConfig,
): ResolutionChannel {
  if (resolutionClass === "manual_only") {
    return "notify_owner";
  }
  if (resolutionClass === "requires_approval") {
    // Device-management actions route to ITSM; others to the operator console.
    return descriptor.transform && "deviceCompliance" in descriptor.transform
      ? "itsm_ticket"
      : descriptor.transform && "deviceManaged" in descriptor.transform
        ? "itsm_ticket"
        : "operator_console";
  }
  // auto_proposed worker step
  return descriptor.hardwareOriented ? config.primaryHardwareChannel : "device_prompt";
}

function workerSummary(decision: Decision, path: string, stepCount: number): string {
  if (stepCount === 0) {
    // No mapped resolution step (e.g. a bare default step-up): don't promise a
    // self-service fix that has no step attached — route to a human.
    return `Access needs another look (${decision.outcome}). There's no self-service step for this one — retry, or ask your operator/IT to review.`;
  }
  if (path === "self_service") {
    return "You can resolve this yourself in a moment — complete the step below and retry.";
  }
  if (path === "assisted") {
    return "This needs a quick approval from your operator/IT before you can continue.";
  }
  return `Access is blocked (${decision.outcome}) and needs a person to review — see the guidance below.`;
}

function operatorSummary(
  decision: Decision,
  steps: ResolutionStep[],
  path: string,
  unresolvedCodes: string[] = [],
): string {
  const auto = steps.filter((s) => s.resolutionClass === "auto_proposed").length;
  const approval = steps.filter((s) => s.resolutionClass === "requires_approval").length;
  const manual = steps.filter((s) => s.resolutionClass === "manual_only").length;
  // Named, not counted away: an operator reading this needs the code itself to
  // look it up, and a bare "1 unresolved" would be the same silence in a
  // shorter sentence.
  const unresolved =
    unresolvedCodes.length > 0
      ? ` ${unresolvedCodes.length} reason code(s) have no resolution step and need a person: ${unresolvedCodes.join(", ")}.`
      : "";
  return `${decision.outcome.toUpperCase()} · path=${path} · ${auto} self-service, ${approval} approval-gated, ${manual} manual. All actions are approval-gated and simulated.${unresolved}`;
}
