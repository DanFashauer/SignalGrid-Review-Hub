import {
  type AttestationPosture,
  type AttestationReasonCode,
  type AttestationRecommendedAction,
  type AttestationVerdict,
  type NormalizedAttestation,
} from "./types";

/**
 * Pure, deterministic hardware-rooted attestation evaluator. Folds a device's
 * Managed Device Attestation into ONE posture + the action it warrants, fail-safe.
 *
 * The assurance model is deliberately different from the self-reported dimensions:
 *  - a FRESH, ROOT-VERIFIED attestation proving a healthy hardware state grants the
 *    TOP assurance tier (`attested_hardened` / none) — the one claim no self-report
 *    can make;
 *  - a fresh, root-verified attestation PROVING a bad state is the STRONGEST
 *    negative: attested SIP disabled → ESCALATE, permissive secure boot → RESTRICT
 *    (you cannot argue with the Secure Enclave);
 *  - a reduced secure boot or third-party kexts allowed → STEP_UP;
 *  - an attestation that was EXPECTED (capable/unknown hardware) but is
 *    UNVERIFIABLE, STALE, or absent → STEP_UP (a stripped/replayed attestation is a
 *    tamper signal — never grant the top tier);
 *  - hardware PROVABLY not attestation-capable (Intel) → ABSTAIN (`not_attestable`
 *    / none): attestation is an upgrade, not a universal requirement, and the
 *    device's baseline posture is gated by the other dimensions. Only an explicit
 *    `attestable === false` abstains — unknown capability still raises the bar.
 *
 * `covered=false` = no attestation was returned for this device at all → unknown
 * (a gap), step_up — distinct from the proven-incapable abstain above.
 */

const ACTION_SEVERITY: Record<AttestationRecommendedAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateAttestationOptions {
  /** False when no attestation result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: AttestationPosture;
  action: AttestationRecommendedAction;
  reason: AttestationReasonCode;
}

export function evaluateAttestation(
  posture: NormalizedAttestation,
  options: EvaluateAttestationOptions = {},
): AttestationVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: posture.deviceId };

  // No attestation returned at all → a gap. Raise the bar (never the top tier).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", hardwareRooted: false };
  }

  // Does the report carry ANY attestation evidence — a chain, a freshness result,
  // a decoded control, or a signed identity fact? All are decoded attestation
  // output, so any of them counts: a report claiming `attestable:false` while
  // echoing a fresh/stale freshness, an attested serial, or an attested OS version
  // is as self-contradictory as one carrying a chain.
  const carriesAttestation =
    posture.chain !== "unknown" ||
    posture.freshness !== "unknown" ||
    posture.attestedSip !== "unknown" ||
    posture.attestedSecureBoot !== "unknown" ||
    posture.attestedKextAllowed !== null ||
    posture.attestedSerial !== null ||
    posture.attestedOsVersion !== null;

  // Provably NOT attestation-capable (e.g. Intel) → abstain. Attestation is an
  // assurance upgrade, not a universal requirement — penalizing hardware that
  // cannot attest would be wrong; its baseline posture is gated elsewhere. Only an
  // explicit `false` abstains; `null`/unknown capability still expects attestation.
  // GUARD: abstain ONLY when the report is self-consistent — declares incapable AND
  // carries no attestation. A report that says the device cannot attest yet still
  // presents a chain or attested facts is malformed or tampered; it must NEVER
  // abstain to `none` (fail closed). Such a contradiction falls through below, where
  // any proven-bad fact still drives the verdict and the best case is floored at
  // step_up — never the top tier.
  if (posture.attestable === false && !carriesAttestation) {
    return { ...base, posture: "not_attestable", reasonCode: "NOT_ATTESTABLE", recommendedAction: "none", hardwareRooted: false };
  }
  // `attestable === false` here implies `carriesAttestation` — a self-contradiction.
  const attestabilityConflict = posture.attestable === false;

  // From here the device is (or may be) capable, so a fresh, root-verified
  // attestation is EXPECTED.
  const verifiedFresh = posture.chain === "verified" && posture.freshness === "fresh";

  if (!verifiedFresh) {
    // Attestation expected but not usable for this session → raise the bar. Never
    // grant, never the top tier. Distinguish the reason for the operator.
    if (posture.chain === "unknown") unknownSignals.push("chain");
    if (posture.freshness === "unknown") unknownSignals.push("freshness");
    if (attestabilityConflict) unknownSignals.push("attestable_conflict");
    let reasonCode: AttestationReasonCode;
    let pos: AttestationPosture;
    if (attestabilityConflict) {
      // A "can't attest" flag paired with an actual (but unusable) attestation.
      reasonCode = "ATTESTATION_CONFLICT";
      pos = "unverified";
    } else if (posture.chain === "unverifiable") {
      // A chain was presented but did not validate to Apple's root — tamper/replay.
      reasonCode = "ATTESTATION_UNVERIFIABLE";
      pos = "unattested";
    } else if (posture.chain === "verified" && posture.freshness === "stale") {
      // Root-valid but cached/replayed (Apple rate-limits new attestations) — can't
      // trust it for THIS session's challenge.
      reasonCode = "ATTESTATION_STALE";
      pos = "unattested";
    } else {
      reasonCode = "ATTESTATION_STATE_UNKNOWN";
      pos = "unverified";
    }
    return { ...base, posture: pos, reasonCode, recommendedAction: "step_up", hardwareRooted: false };
  }

  // verified & fresh → a real hardware-rooted attestation. Read the PROVEN facts,
  // worst-concern-wins. The chain is genuine regardless of whether the news is good.
  const hardwareRooted = true;
  const candidates: Candidate[] = [];

  // A genuine, root-verified chain paired with an `attestable: false` claim is
  // self-contradictory: the chain is real, but the report cannot be wholly trusted.
  // Floor the verdict at step_up so a contradictory report can NEVER reach the top
  // tier; a proven-bad fact below still outranks it (worst-concern-wins).
  if (attestabilityConflict) {
    unknownSignals.push("attestable_conflict");
    candidates.push({ posture: "unverified", action: "step_up", reason: "ATTESTATION_CONFLICT" });
  }

  // Cryptographically-proven SIP disabled — the strongest negative on a shared
  // device (integrity protection off, and it can't be a misread).
  if (posture.attestedSip === "off") {
    criticalFindings.push("attested_sip_disabled");
    candidates.push({ posture: "attested_compromised", action: "escalate", reason: "ATTESTED_SIP_DISABLED" });
  }
  // Permissive secure boot (proven) — any OS may boot; contain it.
  if (posture.attestedSecureBoot === "permissive") {
    criticalFindings.push("attested_secureboot_permissive");
    candidates.push({ posture: "attested_reduced", action: "restrict", reason: "ATTESTED_SECUREBOOT_PERMISSIVE" });
  } else if (posture.attestedSecureBoot === "reduced") {
    // Reduced security — some third-party/older OS allowances; raise the bar.
    candidates.push({ posture: "attested_reduced", action: "step_up", reason: "ATTESTED_SECUREBOOT_REDUCED" });
  }
  // Third-party kexts allowed (proven) — a reduced-integrity posture.
  if (posture.attestedKextAllowed === true) {
    candidates.push({ posture: "attested_reduced", action: "step_up", reason: "ATTESTED_KEXT_ALLOWED" });
  }

  // A verified chain but an attested fact we could not read is not the top tier —
  // raise the bar rather than assume healthy.
  const hasUnknownAttestedFact =
    posture.attestedSip === "unknown" ||
    posture.attestedSecureBoot === "unknown" ||
    posture.attestedKextAllowed === null;
  if (posture.attestedSip === "unknown") unknownSignals.push("attested_sip");
  if (posture.attestedSecureBoot === "unknown") unknownSignals.push("attested_secure_boot");
  if (posture.attestedKextAllowed === null) unknownSignals.push("attested_kext");
  if (hasUnknownAttestedFact) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "ATTESTATION_STATE_UNKNOWN" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "attested_hardened", action: "none", reason: "FULLY_ATTESTED" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action, hardwareRooted };
}
