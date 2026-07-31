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
import type { AgentBehaviorVerdict } from "@workspace/integrations/agent-behavior";
import type { CustodyBeaconVerdict } from "@workspace/integrations/custody-beacon";
import type { AppUpdateVerdict } from "@workspace/integrations/app-update";
import type { PlatformSsoVerdict } from "@workspace/integrations/platform-sso";
import type { PolicyBindingVerdict } from "@workspace/integrations/policy-binding";
import type { BenchmarkSelectionVerdict } from "@workspace/integrations/benchmark-selection";
import type { ShiftContextVerdict } from "@workspace/integrations/shift-context";
import type { BootstrapCredentialVerdict } from "@workspace/integrations/bootstrap-credential";
import type { LocationCertaintyVerdict } from "@workspace/facility-trust-graph";
import type { DeviceManagementHealthVerdict } from "@workspace/integrations/device-management-health";
import type { LinkUsabilityVerdict } from "@workspace/integrations/link-usability";
// Type-only, via the "./task-exception" subpath export (wired in the same change
// that adds this adapter). Erased at compile time.
import type * as taskException from "@workspace/integrations/task-exception";
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
  // fully-governed non-human identity contributes 'none'. A confirmed human contributes
  // 'monitor' — the same healthy tier, without certifying an actor label this dimension
  // cannot verify. Unknown is never fused as governed; an actor we cannot identify never
  // grants.
  return { kind: "agent_identity", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromAgentBehavior(v: AgentBehaviorVerdict): ComposableSignal {
  // Agent BEHAVIOR — is this ACTION sane and authorized, or anomalous. The sibling
  // `agent_identity` asks WHO is acting and whether that identity is governed; this asks
  // whether what they are DOING is in-pattern — the judgment layer a credentialed agent
  // can still violate. Its actions are already on the unified ladder. Fail-safe: a burst
  // volume (a one-line prompt that became tens of thousands of updates) escalates; an
  // action with no authorizing provenance, or one whose blast radius fans out across many
  // resources, restricts; an elevated volume, a first-seen target, a superhuman cadence,
  // or anything unreadable steps up. Only an action positively confirmed in-pattern on
  // every signal — within-baseline volume, familiar target, authorized provenance, scoped
  // blast radius, human-plausible cadence, bridge reachable — contributes 'none'. Judgment
  // we could not verify never grants.
  return { kind: "agent_behavior", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromCustodyBeacon(v: CustodyBeaconVerdict): ComposableSignal {
  // Custody BEACON — asset recovery. The independent, out-of-band channel that still
  // reports when every ONLINE custody signal (rtls, location, reachability, dock-state)
  // has gone dark with the device. Its whole value is the fusion it already performed:
  // in-zone + unreachable is benign (powered off in its bay) → monitor, no alarm;
  // off-premises + dark is high-confidence removal → escalate. Its actions are already on
  // the unified ladder. Fail-safe: only a device positively confirmed in the custody zone,
  // reachable, on a FRESH reading, contributes 'none'; a stale reading, an unknown zone,
  // or anything unreadable raises. It never lowers what the online custody dimensions say.
  return { kind: "custody_beacon", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromAppUpdate(v: AppUpdateVerdict): ComposableSignal {
  // App-update currency — the host app's version graded against the tenant's release
  // manifest (the per-app sibling of the fleet OS floor). Below the enforced floor or
  // a forced update pending contributes `restrict`; behind-but-permitted is a
  // `monitor` nudge; an unmanaged install is untrusted provenance even when current;
  // anything unknowable raises to `step_up`. Its actions are already on the unified
  // ladder, and it never lowers what any other dimension says — SignalGrid gates on
  // currency; distributing the update stays with MDM (docs/APP_UPDATE_CURRENCY.md).
  return { kind: "app_update", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromPlatformSso(v: PlatformSsoVerdict): ComposableSignal {
  // Platform SSO — what the Mac's platform credential is actually worth, vendor
  // "passwordless" labels notwithstanding. Only a user-registered Secure Enclave
  // key / smart card on a clean report contributes `none`; the Password method is a
  // `monitor` note (password-grade), a pre-release web method raises, and a login
  // policy claimed on a method it cannot work with is config drift (`alert` — the
  // tenant believes a control is enforced that the OS is not enforcing). Its
  // actions are already on the unified ladder; it never lowers what the identity
  // dimensions say.
  return { kind: "platform_sso", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromPolicyBinding(v: PolicyBindingVerdict): ComposableSignal {
  // Policy binding — is this device in the RIGHT group/team for what it is?
  // Membership IS the policy binding (Intune dynamic groups, Fleet teams, PACS
  // access levels — docs/POLICY_BINDING.md maps them), so a wrong binding applies
  // the wrong policies silently: unbound is ungoverned (restrict), a too-wide
  // binding is fail-open (restrict), too-narrow is a fail-closed nuisance
  // (monitor), mixed membership breaks targeting at group scale (alert). A correct
  // binding to a policy in REPORT-ONLY mode is `monitor`, not a grant — the device
  // is governed on paper and gated by nothing — and a disabled policy is `restrict`,
  // since it is `unbound` in effect. Its actions are already on the unified ladder;
  // it never lowers what any other dimension says.
  return { kind: "policy_binding", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromBenchmarkSelection(v: BenchmarkSelectionVerdict): ComposableSignal {
  // Benchmark selection — was this device graded against the RIGHT hardening
  // benchmark, from CIS's own published content, on the platform the document
  // targets, covering enough rules to mean anything? The baseline dimension records
  // the ANSWER (`aligned`/`drifted`); this one records whether the QUESTION was
  // sound. A device scored against a superseded or wrong-platform document reports
  // "aligned" and is not hardened — so this dimension raises where the answer alone
  // would have granted. It never lowers what any other dimension says, and it never
  // asserts the device passed: that stays with `baselineCompliance`.
  return { kind: "benchmark_selection", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromLocationCertainty(v: LocationCertaintyVerdict): ComposableSignal {
  // Location certainty — is the fix precise, fresh, healthy, on the CURRENT
  // map, and inside the graph, to the floor the workflow demands? A room-level
  // candidate against a bed-confirmed requirement steps up (scan the wristband)
  // rather than automating — the multi-bed rule. Never lowers what any other
  // dimension says, and never claims WHO or WHAT is at the location — identity,
  // custody, and the labor plane stay with their own dimensions.
  return { kind: "location_certainty", posture: v.state, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromShiftContext(v: ShiftContextVerdict): ComposableSignal {
  // Labor context — is this the right TIME and SITE for this worker to be
  // operating? Custody says which badge holds the device; access-governance says
  // the account is alive; this says the workforce-management plane agrees the
  // worker is scheduled now, on the clock, and where the shift places them.
  // Off-the-clock work on a scheduled shift and off-duty operation both step up
  // (a challenge resolves a borrowed badge without stranding an emergency
  // call-in); an unscheduled clock-in is visible, not blocked. Never lowers what
  // any other dimension says, and never grades WHO holds the badge — that stays
  // with custody.
  return { kind: "shift_context", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromBootstrapCredential(v: BootstrapCredentialVerdict): ComposableSignal {
  // Credential provenance — did a TEMPORARY bootstrap pass open this session,
  // and is it being used the only way a bootstrap pass may be used
  // (enrollment/recovery, alive, one-time, narrowly scoped, verified issuance)?
  // A bootstrap session beyond enrollment scope restricts — the hard TAP rule —
  // and even a perfectly-used pass reads monitor, because a temporary
  // credential is an elevated state, not a clean one. Never grades the
  // STRENGTH of a standing method (passkey-assurance / platform-sso own that),
  // and never lowers what any other dimension says.
  return { kind: "bootstrap_credential", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromDeviceManagementHealth(v: DeviceManagementHealthVerdict): ComposableSignal {
  // Management-plane health — is this device still under EFFECTIVE management, and on
  // the baseline it was assigned. This is what gives the other device signals an
  // expiry: a device that stopped checking in reports its last-known posture forever.
  // Its actions are already on the unified ladder. Fail-safe: a retired or failed
  // enrollment, or a device no compliance policy covers, restricts; a detected but
  // unremediated defect alerts; drift, a stale or absent check-in on EITHER delivery
  // channel, a remediation script that could not run, an unreachable plane, and anything
  // unreadable step up. Only a device confirmed fresh on the MDM channel + fresh (or
  // confirmed agent-less) on the agent channel + remediation-healthy + on-baseline +
  // covered + enrolled + reachable contributes 'none' — a management plane we could not
  // reach never grants.
  return { kind: "device_management_health", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromLinkUsability(v: LinkUsabilityVerdict): ComposableSignal {
  // Link usability — is the network link this device is sitting on actually carrying
  // traffic. `network-nac` answers "was it admitted"; this answers whether that
  // admission is still worth anything, which is what gives every OTHER dimension's
  // freshness claim its expiry: a bridge that answers over an associated-but-unusable
  // link returns a stale read wearing a fresh timestamp. Its actions are already on the
  // unified ladder. Fail-safe, with the severity inversion the dimension exists for: an
  // ASSOCIATED link the bridge affirmatively reports is carrying nothing alerts, above a
  // device that is plainly not associated, because the honest failure is the safer one.
  // Sticky or flapping roaming, degraded latency, an unreachable controller, a
  // self-contradictory report, and anything unreadable step up. Only a link confirmed
  // associated + carrying traffic + stable (or roam-less) + latency-nominal +
  // capability-reported + controller-reachable contributes 'none'.
  return { kind: "link_usability", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromTaskException(v: taskException.TaskExceptionVerdict): ComposableSignal {
  // Task-exception state from the execution system behind a shared frontline device —
  // did the system raise an exception about the WORK, and is anyone on it. This is the
  // one witness that watches every confirm, so it is where the fabric learns that the
  // person-to-device binding certified by badge/session/custody did not hold where the
  // work actually happened. Its actions are already on the unified ladder. Fail-safe:
  // an assignment mismatch (the executing worker/device differs from the assigned one)
  // or a bypassed required verification restricts; a failed verification or an open
  // inventory exception alerts — and acknowledged/resolution-task-created do NOT
  // soften either, because a ticket is not a fix; a failed RF transaction, a
  // self-contradictory report, an unreachable execution system, and anything
  // unreadable step up; a bridge-derived stall or a RESOLVED exception contributes
  // 'monitor' — watched, never granted. Only a stream confirmed exception-free +
  // lifecycle-free + on an affirmative task state + system-reachable + fully parsed
  // contributes 'none'. An unread task stream is never fused as clean work.
  return { kind: "task_exception", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
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
 * calmer one that happens to be checked later. Ranks: escalate > restrict > alert >
 * step_up, so e.g. a high-risk user (alert) on an unmanaged device (step_up)
 * composes to `alert`, and any non-compliant/disabled state outranks both.
 *
 * A GRANT REQUIRES POSITIVE CONFIRMATION OF EVERY INPUT. This function previously
 * tested only five specific bad values and let everything else fall through to
 * `{ action: "none", reason: "COMPLIANT_MANAGED" }`. Every Graph field carries an
 * `"unknown"` member, `deviceComplianceState` also carries `"in_grace_period"`,
 * `deviceManagementState` also carries `"retire_pending"` — and
 * `deviceRegistrationState` was never read at all. All of them contributed nothing
 * and composed to an affirmative claim that the device was compliant and managed.
 *
 * Measured over the full 900-state input space before the fix: 216 states composed
 * to `none`, of which 213 were NOT positively confirmed on every input — a grant
 * path 72x wider than the three genuinely-clean states. That inverts golden rule 2
 * (an unknown or unreachable signal must raise assurance, never lower it) and the
 * reason code made it worse: `COMPLIANT_MANAGED` asserted managed-and-compliant for
 * a device whose management state was unreadable.
 *
 * Unknowns FORECLOSE a grant but never deny — `step_up` throughout, never
 * `restrict`. An unreadable signal is not evidence of wrongdoing, and denying on one
 * would strand a clinician mid-shift over an API timeout. The sibling
 * `fromMacosPosture` already drew this line ("an unreadable Mac is never fused as
 * compliant"), and `macos-posture/types.ts` states it in the type itself: "null =
 * enrollment state could not be determined (unknown, not 'unmanaged')". This adapter
 * now matches. After the fix only the three fully-confirmed states grant.
 */
export function fromDevicePosture(s: GraphPostureSignal): ComposableSignal {
  const candidates: Array<{ action: UnifiedAction; reason: string }> = [];

  // AFFIRMATIVE CONCERNS — a known-bad fact was reported.
  if (s.identityStatus === "disabled") candidates.push({ action: "escalate", reason: "IDENTITY_DISABLED" });
  if (s.deviceComplianceState === "non_compliant") candidates.push({ action: "restrict", reason: "DEVICE_NON_COMPLIANT" });
  if (s.userRisk === "high") candidates.push({ action: "alert", reason: "USER_RISK_HIGH" });
  if (s.deviceManagementState === "unmanaged") candidates.push({ action: "step_up", reason: "DEVICE_UNMANAGED" });
  if (s.deviceManagementState === "retire_pending") candidates.push({ action: "step_up", reason: "DEVICE_RETIRE_PENDING" });
  if (s.deviceRegistrationState === "not_registered") candidates.push({ action: "step_up", reason: "DEVICE_NOT_REGISTERED" });
  if (s.deviceComplianceState === "missing") candidates.push({ action: "step_up", reason: "COMPLIANCE_MISSING" });
  if (s.deviceComplianceState === "in_grace_period") candidates.push({ action: "step_up", reason: "COMPLIANCE_IN_GRACE_PERIOD" });

  // UNCONFIRMED INPUTS — not bad news, but not good news either, and a grant needs
  // good news on every input. Each is enumerated separately rather than collapsed
  // into one catch-all so the evidence names WHICH signal could not be confirmed.
  if (s.identityStatus === "unknown") candidates.push({ action: "step_up", reason: "IDENTITY_STATE_UNKNOWN" });
  if (s.userRisk === "unknown") candidates.push({ action: "step_up", reason: "USER_RISK_UNKNOWN" });
  if (s.deviceComplianceState === "unknown") candidates.push({ action: "step_up", reason: "COMPLIANCE_STATE_UNKNOWN" });
  if (s.deviceManagementState === "unknown") candidates.push({ action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  if (s.deviceRegistrationState === "unknown") candidates.push({ action: "step_up", reason: "REGISTRATION_STATE_UNKNOWN" });

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
