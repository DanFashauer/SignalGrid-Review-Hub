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
  BATTERY_CRITICAL: {
    baseClass: "auto_proposed",
    workerAction: "Battery is critically low — swap to a charged shared device, or dock this one before starting.",
    operatorAction: "Direct the worker to a charged device; the low-battery device can keep charging in its bay.",
    transform: { dockChargeState: "charged" },
    hardwareOriented: true,
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
};

export function buildResolutionPlan(
  decision: Decision,
  config: ResolutionConfig,
): ResolutionPlan {
  const steps: ResolutionStep[] = [];
  let order = 1;
  for (const code of decision.reasonCodes) {
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

  const hasManual = steps.some((s) => s.resolutionClass === "manual_only");
  const hasApproval = steps.some((s) => s.resolutionClass === "requires_approval");
  const path = hasManual ? "escalation" : hasApproval ? "assisted" : "self_service";
  const autoResolvable = steps.length > 0 && !hasManual;

  return {
    decisionId: decision.id,
    outcome: decision.outcome,
    summaryForWorker: workerSummary(decision, path),
    summaryForOperator: operatorSummary(decision, steps, path),
    steps,
    autoResolvable,
    path,
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
  for (const code of decision.reasonCodes) {
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

function workerSummary(decision: Decision, path: string): string {
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
): string {
  const auto = steps.filter((s) => s.resolutionClass === "auto_proposed").length;
  const approval = steps.filter((s) => s.resolutionClass === "requires_approval").length;
  const manual = steps.filter((s) => s.resolutionClass === "manual_only").length;
  return `${decision.outcome.toUpperCase()} · path=${path} · ${auto} self-service, ${approval} approval-gated, ${manual} manual. All actions are approval-gated and simulated.`;
}
