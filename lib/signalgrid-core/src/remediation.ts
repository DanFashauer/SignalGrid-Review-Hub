import { appendAudit } from "./audit";
import type { MemoryStore } from "./store";
import { deterministicId } from "./util";
import type { Clock } from "./util";
import type {
  Decision,
  DecisionEvidence,
  RemediationAction,
  RemediationKind,
} from "./types";

/**
 * Propose remediation for a non-allow decision.
 *
 * SAFETY CONTRACT (also enforced by AGENTS.md and the core proof):
 *  - Every proposal is approval-required (`approvalRequired: true`).
 *  - Every proposal is simulated-only (`simulatedOnly: true`); approving it
 *    records and simulates the action — it never executes a change on a source
 *    system. There is no "executed" status by design.
 *  - `allow` decisions produce no remediation.
 */
export function proposeRemediation(
  store: MemoryStore,
  clock: Clock,
  actor: string,
  decision: Decision,
  evidence: DecisionEvidence,
): RemediationAction[] {
  if (decision.outcome === "allow") {
    return [];
  }

  const proposals = mapReasonsToRemediation(decision, evidence);
  const created: RemediationAction[] = [];
  for (const proposal of proposals) {
    const action: RemediationAction = {
      id: deterministicId("rem", decision.id, proposal.kind),
      tenantId: decision.tenantId,
      decisionId: decision.id,
      kind: proposal.kind,
      targetType: proposal.targetType,
      targetRef: proposal.targetRef,
      reasonCode: proposal.reasonCode,
      status: "requires_approval",
      approvalRequired: true,
      simulatedOnly: true,
      requestedAt: decision.createdAt,
      approvedAt: null,
      note: proposal.note,
    };
    store.putRemediation(action);
    created.push(action);
    appendAudit(store, {
      tenantId: decision.tenantId,
      type: "remediation.requested",
      actor,
      subject: action.id,
      summary: `Remediation proposed (${action.kind}) for ${proposal.reasonCode} — approval required, simulated only.`,
      references: [decision.id, action.id],
      recordedAt: decision.createdAt,
    });
  }
  return created;
}

interface Proposal {
  kind: RemediationKind;
  targetType: RemediationAction["targetType"];
  targetRef: string;
  reasonCode: string;
  note: string;
}

function mapReasonsToRemediation(
  decision: Decision,
  _evidence: DecisionEvidence,
): Proposal[] {
  const device = decision.deviceId;
  const identity = decision.identityId;
  const proposals = new Map<RemediationKind, Proposal>();

  for (const reason of decision.reasonCodes) {
    switch (reason) {
      case "DEVICE_NONCOMPLIANT":
      case "DEVICE_UNMANAGED":
        proposals.set("request_device_remediation", {
          kind: "request_device_remediation",
          targetType: "device",
          targetRef: device,
          reasonCode: reason,
          note: "Request the device-management owner to bring the device into compliance. No change is applied by SignalGrid.",
        });
        break;
      case "POSTURE_STALE":
      case "POSTURE_STALE_STRICT":
      case "POSTURE_MISSING":
        proposals.set("request_posture_refresh", {
          kind: "request_posture_refresh",
          targetType: "device",
          targetRef: device,
          reasonCode: reason,
          note: "Request a posture/compliance re-sync so a fresh decision can be made.",
        });
        break;
      case "ENCRYPTION_REQUIRED_FOR_WORKFLOW":
        proposals.set("request_encryption_enforcement", {
          kind: "request_encryption_enforcement",
          targetType: "device",
          targetRef: device,
          reasonCode: reason,
          note: "Request encryption enforcement before elevated/critical workflows.",
        });
        break;
      case "IDENTITY_DISABLED":
      case "IDENTITY_STATE_UNKNOWN":
      case "IDENTITY_STATE_UNKNOWN_STRICT":
        proposals.set("notify_identity_owner", {
          kind: "notify_identity_owner",
          targetType: "identity",
          targetRef: identity,
          reasonCode: reason,
          note: "Notify the identity/access owner to review the account state.",
        });
        break;
      case "CRITICAL_WORKFLOW_UNTRUSTED_DEVICE":
        proposals.set("notify_security", {
          kind: "notify_security",
          targetType: "workflow",
          targetRef: decision.workflowId,
          reasonCode: reason,
          note: "Route to security operations: a critical workflow was attempted on an untrusted device.",
        });
        break;
      default:
        break;
    }
  }
  return [...proposals.values()];
}
