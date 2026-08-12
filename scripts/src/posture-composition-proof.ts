// Posture-composition proof — pure and deterministic, no I/O.
//
// Proves the fusion of the decision signals into one unified posture: the
// strongest action across all signals wins (fail-safe — a calm signal never
// dilutes a severe one), the risk tier follows from it, drivers come back
// most-severe-first with stable ordering, and the per-dimension adapters map
// onto the unified ladder correctly.
import {
  SIGNAL_KINDS,
  composeDeviceRisk,
  fromDetection,
  fromDevicePosture,
  fromLocation,
  fromCustody,
  fromDataProtection,
  fromCredentialExposure,
  fromIdentityRisk,
  fromPeripheral,
  fromReachability,
  fromThreat,
  fromVuln,
  type ComposableSignal,
} from "@workspace/posture-composition";
import type { ThreatVerdict } from "@workspace/integrations/edr-threat";
import type { IdentityRiskVerdict } from "@workspace/integrations/identity-risk";
import type { CustodyVerdict } from "@workspace/integrations/rtls-custody";
import type { PeripheralVerdict } from "@workspace/integrations/peripheral-control";
import type { DlpVerdict } from "@workspace/integrations/data-protection";
import type { CredentialExposureVerdict } from "@workspace/integrations/credential-exposure";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Posture-composition proof");

// ── adapters map each dimension onto the unified ladder ───────────────────────
check("reachability escalate → escalate",
  fromReachability({ posture: "unreachable", reasonCode: "FULLY_UNREACHABLE", recommendedAction: "escalate", locatable: false }).action === "escalate");
check("location locate → locate",
  fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false }).action === "locate");
check("vuln restrict → restrict",
  fromVuln({ posture: "critical_exposure", highestSeverity: "critical", findingCount: 1, exploitableCount: 1, reasonCode: "CRITICAL_OR_EXPLOITABLE", recommendedAction: "restrict" }).action === "restrict");
check("detection critical → escalate",
  fromDetection({ code: "DOCK_TAMPER_WITH_NETWORK_LOSS", severity: "critical", reason: "x", correlationId: "c", evidenceEventIds: [] }).action === "escalate");
check("threat critical_compromise → escalate",
  fromThreat(threat({ posture: "critical_compromise", reasonCode: "CRITICAL_ACTIVE_THREAT", recommendedAction: "escalate", activeThreatCount: 1 })).action === "escalate");
check("threat active_threat → restrict",
  fromThreat(threat({ posture: "active_threat", reasonCode: "ACTIVE_THREAT", recommendedAction: "restrict", activeThreatCount: 1 })).action === "restrict");
check("threat unprotected (agent absent) → alert",
  fromThreat(threat({ posture: "unprotected", reasonCode: "AGENT_ABSENT", recommendedAction: "alert", protectionHealthy: false })).action === "alert");
check("threat degraded_protection → step_up",
  fromThreat(threat({ posture: "degraded_protection", reasonCode: "PROTECTION_DEGRADED", recommendedAction: "step_up", protectionHealthy: false })).action === "step_up");
check("threat protected → none, and its kind is 'threat'",
  fromThreat(threat({})).action === "none" && fromThreat(threat({})).kind === "threat");
check("identity compromised → escalate",
  fromIdentityRisk(identity({ posture: "compromised", reasonCode: "CONFIRMED_COMPROMISED", recommendedAction: "escalate" })).action === "escalate");
check("identity high_risk → restrict",
  fromIdentityRisk(identity({ posture: "high_risk", reasonCode: "HIGH_RISK_SIGNIN", recommendedAction: "restrict", riskLevel: "high" })).action === "restrict");
check("identity at_risk → step_up",
  fromIdentityRisk(identity({ posture: "at_risk", reasonCode: "MEDIUM_RISK_SIGNIN", recommendedAction: "step_up", riskLevel: "medium" })).action === "step_up");
check("identity trusted → none, and its kind is 'identity'",
  fromIdentityRisk(identity({})).action === "none" && fromIdentityRisk(identity({})).kind === "identity");
check("custody left_area → escalate",
  fromCustody(custody({ posture: "left_area", reasonCode: "LEFT_AREA", recommendedAction: "escalate" })).action === "escalate");
check("custody at_egress → alert",
  fromCustody(custody({ posture: "at_egress", reasonCode: "AT_EGRESS", recommendedAction: "alert" })).action === "alert");
check("custody stale_fix → locate",
  fromCustody(custody({ posture: "stale_fix", reasonCode: "STALE_FIX", recommendedAction: "locate" })).action === "locate");
check("custody in_zone → none, and its kind is 'custody'",
  fromCustody(custody({})).action === "none" && fromCustody(custody({})).kind === "custody");
check("peripheral exfil_risk → restrict",
  fromPeripheral(peripheral({ posture: "exfil_risk", reasonCode: "UNAUTHORIZED_UNENCRYPTED_MEDIA", recommendedAction: "restrict" })).action === "restrict");
check("peripheral unencrypted_media → alert",
  fromPeripheral(peripheral({ posture: "unencrypted_media", reasonCode: "UNENCRYPTED_WRITABLE_MEDIA", recommendedAction: "alert" })).action === "alert");
check("peripheral policy_unenforced → step_up",
  fromPeripheral(peripheral({ posture: "policy_unenforced", reasonCode: "POLICY_UNENFORCED", recommendedAction: "step_up" })).action === "step_up");
check("peripheral no_removable → none, and its kind is 'peripheral'",
  fromPeripheral(peripheral({})).action === "none" && fromPeripheral(peripheral({})).kind === "peripheral");
check("dlp confirmed_exfiltration → escalate",
  fromDataProtection(dlp({ posture: "confirmed_exfiltration", reasonCode: "REGULATED_DATA_EGRESS", recommendedAction: "escalate" })).action === "escalate");
check("dlp data_egress → alert",
  fromDataProtection(dlp({ posture: "data_egress", reasonCode: "DATA_EGRESS", recommendedAction: "alert" })).action === "alert");
check("dlp policy_unenforced → step_up",
  fromDataProtection(dlp({ posture: "policy_unenforced", reasonCode: "POLICY_UNENFORCED", recommendedAction: "step_up" })).action === "step_up");
check("dlp protected → none, and its kind is 'data_protection'",
  fromDataProtection(dlp({})).action === "none" && fromDataProtection(dlp({})).kind === "data_protection");
check("credential-exposure active_credential_exposed → escalate",
  fromCredentialExposure(credx({ posture: "active_credential_exposed", reasonCode: "HIGH_VALUE_SECRET_EXPOSED", recommendedAction: "escalate" })).action === "escalate");
check("credential-exposure secrets_exposed → alert",
  fromCredentialExposure(credx({ posture: "secrets_exposed", reasonCode: "SECRETS_EXPOSED", recommendedAction: "alert" })).action === "alert");
check("credential-exposure scanner_unenrolled → step_up",
  fromCredentialExposure(credx({ posture: "scanner_unenrolled", reasonCode: "SCANNER_UNENROLLED", recommendedAction: "step_up" })).action === "step_up");
check("credential-exposure clean → none, and its kind is 'credential_exposure'",
  fromCredentialExposure(credx({})).action === "none" && fromCredentialExposure(credx({})).kind === "credential_exposure");
check("device posture disabled identity → escalate",
  fromDevicePosture(posture({ identityStatus: "disabled" })).action === "escalate");
check("device posture non-compliant → restrict",
  fromDevicePosture(posture({ deviceComplianceState: "non_compliant" })).action === "restrict");
check("device posture unmanaged → step_up",
  fromDevicePosture(posture({ deviceManagementState: "unmanaged" })).action === "step_up");
check("device posture high user-risk → alert",
  fromDevicePosture(posture({ userRisk: "high" })).action === "alert");
check("device posture compliant+managed → none",
  fromDevicePosture(posture({})).action === "none");

// ── grant discipline: a grant needs POSITIVE CONFIRMATION OF EVERY INPUT ──────
//
// The adapter tested five specific bad values and let everything else fall through
// to `none` / `COMPLIANT_MANAGED`. Every Graph field has an `"unknown"` member, two
// have extra non-clean members, and `deviceRegistrationState` was never read at all
// — so an unreadable signal was reported as an affirmatively compliant, managed
// device. Golden rule 2 inverted.
//
// The exhaustive sweep below is the real gate; these named cases exist so a failure
// says WHICH state regressed instead of only that the count moved.
check("management state UNKNOWN must not grant → step_up",
  fromDevicePosture(posture({ deviceManagementState: "unknown" })).action === "step_up");
check("management state retire_pending must not grant → step_up",
  fromDevicePosture(posture({ deviceManagementState: "retire_pending" })).action === "step_up");
check("compliance state UNKNOWN must not grant → step_up",
  fromDevicePosture(posture({ deviceComplianceState: "unknown" })).action === "step_up");
check("compliance in_grace_period must not grant → step_up",
  fromDevicePosture(posture({ deviceComplianceState: "in_grace_period" })).action === "step_up");
check("identity state UNKNOWN must not grant → step_up",
  fromDevicePosture(posture({ identityStatus: "unknown" })).action === "step_up");
check("user risk UNKNOWN must not grant → step_up",
  fromDevicePosture(posture({ userRisk: "unknown" })).action === "step_up");
check("registration not_registered must not grant → step_up",
  fromDevicePosture(posture({ deviceRegistrationState: "not_registered" })).action === "step_up");
check("registration state UNKNOWN must not grant → step_up",
  fromDevicePosture(posture({ deviceRegistrationState: "unknown" })).action === "step_up");
check("an unknown input never DENIES — it forecloses the grant, it does not restrict",
  (["unknown"] as const).every((u) =>
    [
      fromDevicePosture(posture({ identityStatus: u })),
      fromDevicePosture(posture({ userRisk: u })),
      fromDevicePosture(posture({ deviceComplianceState: u })),
      fromDevicePosture(posture({ deviceManagementState: u })),
      fromDevicePosture(posture({ deviceRegistrationState: u })),
    ].every((r) => r.action === "step_up")));

// EXHAUSTIVE: enumerate the whole input space and assert that the ONLY states
// contributing nothing are the ones positively confirmed clean on every field.
// A spot-check cannot see a field nobody thought to test — which is exactly how
// `deviceRegistrationState` went unread. This can.
{
  const IDENTITY = ["enabled", "disabled", "unknown"] as const;
  const RISK = ["none", "low", "medium", "high", "unknown"] as const;
  const COMPLIANCE = ["compliant", "non_compliant", "in_grace_period", "missing", "unknown"] as const;
  const MANAGEMENT = ["managed", "unmanaged", "retire_pending", "unknown"] as const;
  const REGISTRATION = ["registered", "not_registered", "unknown"] as const;

  let total = 0;
  const unjustifiedGrants: string[] = [];
  for (const identityStatus of IDENTITY)
    for (const userRisk of RISK)
      for (const deviceComplianceState of COMPLIANCE)
        for (const deviceManagementState of MANAGEMENT)
          for (const deviceRegistrationState of REGISTRATION) {
            total += 1;
            const r = fromDevicePosture(
              posture({ identityStatus, userRisk, deviceComplianceState, deviceManagementState, deviceRegistrationState }),
            );
            if (r.action !== "none") continue;
            const confirmedClean =
              identityStatus === "enabled" &&
              userRisk !== "unknown" &&
              deviceComplianceState === "compliant" &&
              deviceManagementState === "managed" &&
              deviceRegistrationState === "registered";
            if (!confirmedClean) {
              unjustifiedGrants.push(
                `${identityStatus}/${userRisk}/${deviceComplianceState}/${deviceManagementState}/${deviceRegistrationState}`,
              );
            }
          }
  check(`device-posture space enumerated (${total} states)`, total === 900);
  check(
    `ZERO unjustified grants across all ${total} states (was 213)` +
      (unjustifiedGrants.length ? ` — leaked: ${unjustifiedGrants.slice(0, 5).join(", ")}` : ""),
    unjustifiedGrants.length === 0,
  );
  // Non-vacuity: the assertion above passes trivially if nothing ever grants.
  // Exactly three states are fully confirmed (userRisk none/low/medium), so the
  // grant path must be reachable and must be exactly that wide.
  const grants = [...RISK].filter((userRisk) =>
    fromDevicePosture(posture({ userRisk })).action === "none").length;
  check("...and the grant path is still REACHABLE — exactly 3 confirmed-clean states", grants === 3);
}

// ── order-proof: the STRONGEST device-posture concern wins (a severe signal is
// never diluted by a calmer one checked later — regression for the adapter bug) ──
check("high user-risk (alert) is NOT diluted by unmanaged (step_up) → alert",
  fromDevicePosture(posture({ userRisk: "high", deviceManagementState: "unmanaged" })).action === "alert");
check("high user-risk (alert) is NOT diluted by missing compliance (step_up) → alert",
  fromDevicePosture(posture({ userRisk: "high", deviceComplianceState: "missing" })).action === "alert");
check("non-compliant (restrict) outranks a high-risk user (alert) → restrict",
  fromDevicePosture(posture({ userRisk: "high", deviceComplianceState: "non_compliant" })).action === "restrict");
check("disabled identity (escalate) outranks everything → escalate",
  fromDevicePosture(posture({ identityStatus: "disabled", deviceComplianceState: "non_compliant", userRisk: "high" })).action === "escalate");

// ── composition: strongest action wins, tier follows ──────────────────────────
const mixed: ComposableSignal[] = [
  fromDevicePosture(posture({})),                         // none
  fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
  fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false }), // locate
  fromVuln({ posture: "critical_exposure", highestSeverity: "critical", findingCount: 2, exploitableCount: 1, reasonCode: "CRITICAL_OR_EXPLOITABLE", recommendedAction: "restrict" }), // restrict
];
const u = composeDeviceRisk(mixed);
check("strongest action wins (restrict over locate/monitor/none)", u.strongestAction === "restrict");
check("risk tier follows the strongest action (restrict ⇒ blocked)", u.riskTier === "blocked");
check("all signals are retained as drivers", u.signalCount === 4 && u.drivers.length === 4);
check("drivers are ordered most-severe first", u.drivers[0].action === "restrict" && u.drivers[u.drivers.length - 1].action === "none");

// escalate outranks restrict.
const withDetection = composeDeviceRisk([...mixed, fromDetection({ code: "DOCK_TAMPER_WITH_NETWORK_LOSS", severity: "critical", reason: "x", correlationId: "c", evidenceEventIds: [] })]);
check("a critical detection (escalate) outranks a restrict", withDetection.strongestAction === "escalate" && withDetection.riskTier === "blocked");

// an active EDR threat fuses in and drives the verdict alongside the others.
const withThreat = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
  fromThreat(threat({ posture: "critical_compromise", reasonCode: "CRITICAL_ACTIVE_THREAT", recommendedAction: "escalate", activeThreatCount: 1, threatCount: 1 })), // escalate
]);
check("an active critical EDR threat (escalate) drives the fused verdict", withThreat.strongestAction === "escalate" && withThreat.riskTier === "blocked");
check("the threat signal is retained as a driver, tagged kind 'threat'", withThreat.drivers.some((d) => d.kind === "threat" && d.action === "escalate"));

// identity/SSO sign-in risk fuses in: a compliant, reachable device whose USER
// is confirmed-compromised composes to escalate/blocked — device fine, identity not.
const withIdentity = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
  fromIdentityRisk(identity({ posture: "compromised", reasonCode: "CONFIRMED_COMPROMISED", recommendedAction: "escalate", riskState: "confirmed_compromised" })), // escalate
]);
check("a confirmed-compromised identity (escalate) drives the fused verdict on an otherwise-clean device", withIdentity.strongestAction === "escalate" && withIdentity.riskTier === "blocked");
check("the identity signal is retained as a driver, tagged kind 'identity'", withIdentity.drivers.some((d) => d.kind === "identity" && d.action === "escalate"));

// RTLS physical custody fuses in: a device that has left the monitored area
// composes to escalate/blocked even when its cyber signals are calm.
const withCustody = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromVuln({ posture: "clean", highestSeverity: "info", findingCount: 0, exploitableCount: 0, reasonCode: "NO_FINDINGS", recommendedAction: "none" }), // none
  fromCustody(custody({ posture: "left_area", reasonCode: "LEFT_AREA", recommendedAction: "escalate" })), // escalate
]);
check("a device that left the monitored area (escalate) drives the fused verdict", withCustody.strongestAction === "escalate" && withCustody.riskTier === "blocked");
check("the custody signal is retained as a driver, tagged kind 'custody'", withCustody.drivers.some((d) => d.kind === "custody" && d.action === "escalate"));

// Removable-media fuses in: an unauthorized unencrypted writable USB on an
// otherwise-compliant device composes to restrict/blocked.
const withPeripheral = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromCustody(custody({})),                                                                        // none (in-zone)
  fromPeripheral(peripheral({ posture: "exfil_risk", reasonCode: "UNAUTHORIZED_UNENCRYPTED_MEDIA", recommendedAction: "restrict", writableRemovableCount: 1 })), // restrict
]);
check("an unauthorized+unencrypted writable USB (restrict) drives the fused verdict", withPeripheral.strongestAction === "restrict" && withPeripheral.riskTier === "blocked");
check("the peripheral signal is retained as a driver, tagged kind 'peripheral'", withPeripheral.drivers.some((d) => d.kind === "peripheral" && d.action === "restrict"));

// DLP fuses in: regulated data leaving via cloud/email (confirmed exfiltration)
// escalates even on an otherwise-clean device.
const withDlp = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                    // none
  fromPeripheral(peripheral({})),                                                                    // none (no removable)
  fromDataProtection(dlp({ posture: "confirmed_exfiltration", reasonCode: "REGULATED_DATA_EGRESS", recommendedAction: "escalate", egressCount: 1 })), // escalate
]);
check("a regulated-data exfiltration (escalate) drives the fused verdict", withDlp.strongestAction === "escalate" && withDlp.riskTier === "blocked");
check("the DLP signal is retained as a driver, tagged kind 'data_protection'", withDlp.drivers.some((d) => d.kind === "data_protection" && d.action === "escalate"));

// tiers across the ladder
check("all-calm signals ⇒ ok tier", composeDeviceRisk([fromDevicePosture(posture({})), fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true })]).riskTier === "ok");
check("a step_up ⇒ at_risk tier", composeDeviceRisk([fromDevicePosture(posture({ deviceManagementState: "unmanaged" }))]).riskTier === "at_risk");
check("a locate ⇒ watch tier", composeDeviceRisk([fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false })]).riskTier === "watch");

// no signals ⇒ ok/none, distinguishable by signalCount.
const empty = composeDeviceRisk([]);
check("no signals ⇒ ok / none / signalCount 0", empty.riskTier === "ok" && empty.strongestAction === "none" && empty.signalCount === 0);

// determinism + stable ordering for equal ranks.
const a = composeDeviceRisk(mixed);
const b = composeDeviceRisk(mixed);
check("composition is deterministic", JSON.stringify(a) === JSON.stringify(b));
const equalRank: ComposableSignal[] = [
  { kind: "reachability", posture: "p1", action: "alert", reason: "R1" },
  { kind: "vulnerability", posture: "p2", action: "alert", reason: "R2" },
];
const stable = composeDeviceRisk(equalRank);
check("equal-rank drivers keep input order (stable sort)", stable.drivers[0].reason === "R1" && stable.drivers[1].reason === "R2");

// ── EVERY SIGNAL KIND HAS EXACTLY ONE PRODUCER ───────────────────────────────
//
// This is what protects `adapters.ts`, and it exists because the mutation guard could
// NOT. Registering that file returned `mutations=0`: the adapters are pass-through
// mapping (`action: v.recommendedAction as UnifiedAction`) with no branching to
// falsify, so a sweep says nothing about them. The property that CAN be wrong is
// structural, so it is asserted structurally.
//
// A kind declared in the union but emitted by no adapter is dead: `proof:incident-playbook`
// checks routing across all SIGNAL_KINDS and would pass it happily, because a kind that
// nothing produces still routes fine. It would look covered from both ends and reach the
// composer never. The reverse — an adapter emitting a kind outside the union — is a
// signal the incident playbook has no route for, which lands in the generic queue.
{
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/posture-composition/src/adapters.ts"),
    "utf8",
  );
  const emitted = [...source.matchAll(/kind:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const emittedSet = new Set(emitted);

  const unproduced = SIGNAL_KINDS.filter((k) => !emittedSet.has(k));
  check(
    `every one of the ${SIGNAL_KINDS.length} signal kinds is emitted by an adapter${unproduced.length ? " — missing: " + unproduced.join(", ") : ""}`,
    unproduced.length === 0,
  );

  const unknown = [...emittedSet].filter((k) => !(SIGNAL_KINDS as readonly string[]).includes(k));
  check(
    `no adapter emits a kind outside SIGNAL_KINDS${unknown.length ? " — stray: " + unknown.join(", ") : ""}`,
    unknown.length === 0,
  );

  // MULTIPLE producers per kind is legitimate — one dimension can be answerable from
  // more than one source plane, which is the point of a fabric. `device_posture` is
  // genuinely produced twice: `fromMacosPosture` (endpoint hardening, via the MCP
  // grid_collected path) and the Intune/Entra management-plane adapter.
  //
  // The first draft of this check asserted "no kind has two producers" and FAILED on
  // exactly that pair. The rule was wrong, not the code — asserted over a premise that
  // was never true. So the useful property is not uniqueness, it is that every
  // multi-producer kind is DELIBERATE: pinned by name here, so a copy-pasted adapter
  // that forgot to change its `kind` — silently merging two dimensions into one, where
  // the stronger would mask the other in the composer — fails instead of shipping.
  const multi = [...new Set(emitted.filter((k, i) => emitted.indexOf(k) !== i))].sort();
  check(
    `every kind with more than one producer is enumerated on purpose (${multi.length}: ${multi.join(", ") || "none"})`,
    multi.length === 1 && multi[0] === "device_posture",
  );

  check(
    "NON-VACUITY: the scan actually found adapters, so the three checks above are not passing over an empty set",
    emittedSet.size > 30,
  );
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }

// Build a GraphPostureSignal with sane compliant defaults, overriding as needed.
function posture(over: Partial<import("@workspace/integrations/graph").GraphPostureSignal>): import("@workspace/integrations/graph").GraphPostureSignal {
  return {
    sourceSystem: "microsoft-graph",
    correlationId: "u:d",
    observedAt: "2026-07-20T12:00:00.000Z",
    subjectId: "u",
    identityStatus: "enabled",
    userRisk: "none",
    deviceId: "d",
    deviceComplianceState: "compliant",
    deviceManagementState: "managed",
    deviceRegistrationState: "registered",
    deviceLastSeenAt: "2026-07-20T11:59:00Z",
    ...over,
  };
}

// Build a ThreatVerdict with sane "protected" defaults, overriding as needed.
function threat(over: Partial<ThreatVerdict>): ThreatVerdict {
  return {
    posture: "protected",
    highestThreatSeverity: "info",
    threatCount: 0,
    activeThreatCount: 0,
    protectionHealthy: true,
    reasonCode: "NO_THREATS_HEALTHY",
    recommendedAction: "none",
    ...over,
  };
}

// Build an IdentityRiskVerdict with sane "trusted" defaults, overriding as needed.
function identity(over: Partial<IdentityRiskVerdict>): IdentityRiskVerdict {
  return {
    posture: "trusted",
    riskLevel: "none",
    riskState: "unknown",
    detectionCount: 0,
    highestDetectionGrade: null,
    mfaSatisfied: true,
    reasonCode: "NO_RISK",
    recommendedAction: "none",
    ...over,
  };
}

// Build a CustodyVerdict with sane "in_zone" defaults, overriding as needed.
function custody(over: Partial<CustodyVerdict>): CustodyVerdict {
  return {
    posture: "in_zone",
    zoneId: "z1",
    zoneType: "clinical",
    fixAgeSeconds: 30,
    dwellSeconds: 120,
    badgeAssociated: true,
    reasonCode: "CUSTODY_OK",
    recommendedAction: "none",
    ...over,
  };
}

// Build a PeripheralVerdict with sane "no_removable" defaults, overriding as needed.
function peripheral(over: Partial<PeripheralVerdict>): PeripheralVerdict {
  return {
    posture: "no_removable",
    removableCount: 0,
    writableRemovableCount: 0,
    policyEnforced: true,
    reasonCode: "NO_REMOVABLE",
    recommendedAction: "none",
    ...over,
  };
}

// Build a DlpVerdict with sane "protected" defaults, overriding as needed.
function dlp(over: Partial<DlpVerdict>): DlpVerdict {
  return {
    posture: "protected",
    violationCount: 0,
    egressCount: 0,
    highestSeverity: "unknown",
    dlpPolicyEnforced: true,
    reasonCode: "NO_VIOLATIONS",
    recommendedAction: "none",
    ...over,
  };
}

// Build a CredentialExposureVerdict with sane "clean" defaults, overriding as needed.
function credx(over: Partial<CredentialExposureVerdict>): CredentialExposureVerdict {
  return {
    posture: "clean",
    findingCount: 0,
    exposedCount: 0,
    highestSeverity: "unknown",
    scannerEnrolled: true,
    reasonCode: "NO_FINDINGS",
    recommendedAction: "none",
    ...over,
  };
}
