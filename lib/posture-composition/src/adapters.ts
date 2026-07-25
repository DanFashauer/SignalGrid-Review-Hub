import type { ReachabilityVerdict } from "@workspace/integrations/carrier";
import type { LocationVerdict } from "@workspace/integrations/location-services";
import type { VulnVerdict } from "@workspace/integrations/vuln-scan";
import type { NetworkVerdict } from "@workspace/integrations/network-nac";
import type { ThreatVerdict } from "@workspace/integrations/edr-threat";
import type { IdentityRiskVerdict } from "@workspace/integrations/identity-risk";
import type { CustodyVerdict } from "@workspace/integrations/rtls-custody";
import type { PeripheralVerdict } from "@workspace/integrations/peripheral-control";
import type { DlpVerdict } from "@workspace/integrations/data-protection";
import type { CredentialExposureVerdict } from "@workspace/integrations/credential-exposure";
import type { MacosPostureVerdict } from "@workspace/integrations/macos-posture";
import type { OtPostureVerdict } from "@workspace/integrations/ot-posture";
import type { AccessGovernanceVerdict } from "@workspace/integrations/access-governance";
import type { AttestationVerdict } from "@workspace/integrations/device-attestation";
import type { SsoSessionVerdict } from "@workspace/integrations/sso-session";
import type { OAuthConsentVerdict } from "@workspace/integrations/oauth-consent";
import type { TokenBindingVerdict } from "@workspace/integrations/token-binding";
import type { PacsAccessVerdict } from "@workspace/integrations/pacs-access";
import type { AgentIdentityVerdict } from "@workspace/integrations/agent-identity";
import type { GraphPostureSignal } from "@workspace/integrations/graph";
import type { Detection } from "@workspace/event-contract";
import { ACTION_RANK } from "./compose";
import type { ComposableSignal, UnifiedAction } from "./types";

/**
 * Adapters that map each dimension's native verdict onto the ONE unified action
 * ladder, so `composeDeviceRisk` can fuse them. Each dimension's action set is a
 * subset of the unified ladder; these adapters keep that mapping in one place and
 * are pure.
 */

export function fromReachability(v: ReachabilityVerdict): ComposableSignal {
  // Reachability actions are already on the unified ladder.
  return { kind: "reachability", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromLocation(v: LocationVerdict): ComposableSignal {
  return { kind: "location", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromVuln(v: VulnVerdict): ComposableSignal {
  return { kind: "vulnerability", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromNetwork(v: NetworkVerdict): ComposableSignal {
  // Network/NAC actions (none|monitor|step_up|restrict) are already on the ladder.
  return { kind: "network", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromThreat(v: ThreatVerdict): ComposableSignal {
  // EDR/EPP threat actions (none|monitor|step_up|alert|restrict|escalate) are
  // already on the unified ladder.
  return { kind: "threat", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromIdentityRisk(v: IdentityRiskVerdict): ComposableSignal {
  // Identity / SSO sign-in-risk actions (none|monitor|step_up|alert|restrict|
  // escalate) are already on the unified ladder.
  return { kind: "identity", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromCustody(v: CustodyVerdict): ComposableSignal {
  // RTLS custody actions (none|monitor|locate|alert|escalate) are already on the
  // unified ladder.
  return { kind: "custody", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromPeripheral(v: PeripheralVerdict): ComposableSignal {
  // Peripheral-control actions (none|monitor|step_up|alert|restrict) are already
  // on the unified ladder.
  return { kind: "peripheral", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromDataProtection(v: DlpVerdict): ComposableSignal {
  // Data-protection / DLP actions (none|monitor|step_up|alert|restrict|escalate)
  // are already on the unified ladder.
  return { kind: "data_protection", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromCredentialExposure(v: CredentialExposureVerdict): ComposableSignal {
  // Credential-exposure actions (none|monitor|step_up|alert|restrict|escalate)
  // are already on the unified ladder. A live high-value secret on the endpoint
  // escalates — contain the blast radius of a device assumed compromised.
  return { kind: "credential_exposure", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromOtPosture(v: OtPostureVerdict): ComposableSignal {
  // OT/IIoT edge-device posture from the grid_collected path (an edge gateway
  // reading a PLC/RTU/HMI that can't run an agent). Actions are already on the
  // unified ladder. Fail-safe: a flat network / exposed protocol / unpatchable
  // device restricts; a stale gateway or unreadable control steps up — an
  // unseen OT device is never fused as secure.
  return { kind: "ot_posture", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromAccessGovernance(v: AccessGovernanceVerdict): ComposableSignal {
  // IAM / access-governance runtime authorization for the identity bound to a
  // badge-checked-out session — "is this principal ALLOWED to do this, and is that
  // grant still governed?". Its actions (none|monitor|step_up|alert|restrict|
  // escalate) are already on the unified ladder. Fail-safe: a leaver/disabled
  // account still transacting escalates; an orphaned account / out-of-scope or
  // decertified entitlement / SoD conflict / expired or unmonitored privilege
  // restricts; standing (not JIT) privilege or a stale certification steps up — an
  // unverified or uncovered grant is never fused as authorized.
  return { kind: "access_governance", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromAttestation(v: AttestationVerdict): ComposableSignal {
  // Hardware-rooted Managed Device Attestation — the top assurance tier. Its
  // actions (none|monitor|step_up|alert|restrict|escalate) are already on the
  // unified ladder. Fail-safe: a cryptographically-PROVEN bad state (attested SIP
  // off → escalate; permissive secure boot → restrict) is the strongest negative;
  // an expected-but-unverifiable/stale attestation steps up; only a proven-healthy
  // fresh attestation contributes 'none', and hardware provably not attestation-
  // capable abstains — an unverified attestation is never fused as attested-secure.
  return { kind: "attestation", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromSsoSession(v: SsoSessionVerdict): ComposableSignal {
  // Live SSO session-binding on a shared, badge-checked-out device. Its actions
  // (none|monitor|step_up|alert|restrict|escalate) are already on the unified
  // ladder. Fail-safe: a leftover session whose subject ≠ the current badge-holder
  // is the strongest negative (a live one escalates, an expired one restricts); an
  // active session bound to nobody restricts; a single-factor / near- or past-expiry
  // / unreadable bound session steps up; only a bound, MFA-backed, fresh session
  // contributes 'none'. No active session is the baseline; unknown is never bound.
  return { kind: "sso_session", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromOAuthConsent(v: OAuthConsentVerdict): ComposableSignal {
  // OAuth-consent / workload-identity — what third-party apps can do ON BEHALF OF
  // the session's principal via a delegated grant. Its actions are already on the
  // unified ladder. Fail-safe: an illicit consent grant (consent-phishing) escalates;
  // a full-access grant not admin-governed restricts; over-scoped / unverified-
  // publisher / unmanaged-workload-secret steps up; only a positively-confirmed
  // governed (or no-) grant contributes 'none'. Unknown is never fused as governed.
  return { kind: "oauth_consent", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromTokenBinding(v: TokenBindingVerdict): ComposableSignal {
  // Token-binding / proof-of-possession — is the session's access token sender-
  // constrained (DPoP/mTLS, bound to a hardware key on THIS device) or a replayable
  // bearer. Its actions are already on the unified ladder. Fail-safe: a bound token
  // whose key belongs to another device escalates (a stolen bound token); an unbound
  // bearer token restricts (replayable); a software-key / unattested / non-audience-
  // restricted / unverified token steps up; only a positively-confirmed sender-
  // constrained token contributes 'none'. Unknown is never fused as bound.
  return { kind: "token_binding", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromPacsAccess(v: PacsAccessVerdict): ComposableSignal {
  // Physical access-control (PACS) — did the badge-holder legitimately badge into
  // this controlled area, are they authorized right now, and is the door secure. Its
  // actions are already on the unified ladder. Fail-safe: a denied/revoked entry or a
  // PACS holder ≠ the checked-out device holder escalates; an anti-passback
  // (tailgating) violation or a forced door restricts; an out-of-schedule/zone entry
  // or a held door steps up; only a positively-confirmed authorized entry at a secure
  // door contributes 'none'. Unknown is never fused as a confirmed physical entry.
  return { kind: "pacs_access", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromAgentIdentity(v: AgentIdentityVerdict): ComposableSignal {
  // Agentic / non-human identity — WHO is taking this action, and if it is not a
  // person, is that identity governed. Its actions are already on the unified ladder.
  // Fail-safe: an unregistered agent, an expired approval, or a standing credential
  // escalates; an over-scoped/unscoped, unrecorded, or never-approved agent restricts;
  // a long-lived credential or pending approval steps up; only a confirmed human, or a
  // fully-governed non-human identity, contributes 'none'. Unknown is never fused as
  // governed — an actor we cannot identify never grants.
  return { kind: "agent_identity", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromMacosPosture(v: MacosPostureVerdict): ComposableSignal {
  // macOS endpoint-hardening from the grid_collected path (signalgrid-mcp). Its
  // actions (none|monitor|step_up|alert|restrict|escalate) are already on the
  // unified ladder. Fail-safe: a disabled control restricts, and an unverifiable
  // control steps up — an unreadable Mac is never fused as compliant.
  return { kind: "device_posture", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

/** Cross-domain detection severity → unified action. */
export function fromDetection(d: Detection): ComposableSignal {
  const action: UnifiedAction =
    d.severity === "critical" ? "escalate" : d.severity === "high" ? "restrict" : d.severity === "medium" ? "alert" : "monitor";
  return { kind: "detection", posture: d.code, action, reason: d.reason };
}

/**
 * Device posture (Graph/MDM) → unified action. Fail-safe and ORDER-PROOF: every
 * matching condition contributes a candidate action, and the STRONGEST (highest
 * rank on the unified ladder) wins — so a severe concern is never diluted by a
 * calmer one that happens to be checked later. A compliant managed device with no
 * risk factors contributes nothing (`none`). Ranks: escalate > restrict > alert >
 * step_up, so e.g. a high-risk user (alert) on an unmanaged device (step_up)
 * composes to `alert`, and any non-compliant/disabled state outranks both.
 */
export function fromDevicePosture(s: GraphPostureSignal): ComposableSignal {
  const candidates: Array<{ action: UnifiedAction; reason: string }> = [];
  if (s.identityStatus === "disabled") candidates.push({ action: "escalate", reason: "IDENTITY_DISABLED" });
  if (s.deviceComplianceState === "non_compliant") candidates.push({ action: "restrict", reason: "DEVICE_NON_COMPLIANT" });
  if (s.userRisk === "high") candidates.push({ action: "alert", reason: "USER_RISK_HIGH" });
  if (s.deviceManagementState === "unmanaged") candidates.push({ action: "step_up", reason: "DEVICE_UNMANAGED" });
  if (s.deviceComplianceState === "missing") candidates.push({ action: "step_up", reason: "COMPLIANCE_MISSING" });

  const winner = candidates.reduce<{ action: UnifiedAction; reason: string }>(
    (max, c) => (ACTION_RANK[c.action] > ACTION_RANK[max.action] ? c : max),
    { action: "none", reason: "COMPLIANT_MANAGED" },
  );

  const posture =
    winner.action === "none"
      ? "compliant"
      : winner.action === "escalate"
        ? "identity_blocked"
        : winner.action === "restrict"
          ? "non_compliant"
          : "degraded";
  return { kind: "device_posture", posture, action: winner.action, reason: winner.reason };
}
