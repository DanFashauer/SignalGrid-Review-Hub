// @workspace/integration-bridge — maps real-world integration signals (from
// @workspace/integrations) into the deterministic core's normalized signal
// vocabulary (@workspace/signalgrid-core), so a live MDM/EDR posture read can
// feed an ALLOW/STEP-UP/RESTRICT/DENY decision. Pure and deterministic: it does
// no I/O — the caller fetches the posture and wraps these drafts into full
// NormalizedSignals (adding tenant/connector/subject/id).
import { ageMs } from "@workspace/integrations/utils/freshness";
import type {
  NormalizedSignal,
  SignalCategory,
  Freshness,
  LocalAuthorityGrantState,
  ManagementHealthState,
} from "@workspace/signalgrid-core";
import type { telemetryTypes } from "@workspace/integrations";
import type { GraphPostureSignal } from "@workspace/integrations/graph";
import type { DeviceManagementHealthVerdict } from "@workspace/integrations/device-management-health";
import type { LocalAuthorityVerdict } from "@workspace/integrations/local-authority";

export interface PostureSignalDraft {
  category: SignalCategory;
  value: NormalizedSignal["value"];
  observedAt: string;
}

// The source-agnostic DeviceManagementEvidence contract + its adapters
// (Fleet, Headwind-shaped Android lab) — see ./evidence.ts.
export * from "./evidence";

const FRESH_HOURS = 24;
const STALE_HOURS = 72;
// The future-skew tolerance is NOT redeclared here. This file carried its own
// `const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000` — a second copy of the number the
// shared deriver already owns, which is how two tolerances become three. It now
// imports the one body (see the import of `ageMs` above).

/** Map a FleetDM (osquery) posture read into core posture signals. */
export function fleetDMToPostureDrafts(
  posture: telemetryTypes.FleetDMPostureSignal,
): PostureSignalDraft[] {
  const observedAt = posture.lastCheckAt;
  const drafts: PostureSignalDraft[] = [
    {
      category: "device_compliance",
      value: posture.compliant ? "compliant" : "non_compliant",
      observedAt,
    },
    { category: "device_management", value: true, observedAt },
  ];
  // All FleetDM policies passing → aligned security baseline; any failing → drifted.
  if (posture.policies.length > 0) {
    const allPass = posture.policies.every((p) => p.response === "pass");
    drafts.push({
      category: "security_baseline",
      value: allPass ? "aligned" : "drifted",
      observedAt,
    });
  }
  return drafts;
}

/**
 * Map a read-only Microsoft Graph posture read into core signal drafts.
 *
 * Emits at most one `identity_state` draft (route it to the IDENTITY subject —
 * the category is self-describing) plus device posture drafts. Silence is the
 * rule everywhere a source did not affirmatively answer: an `unknown` upstream
 * state emits NOTHING here, because the core's evidence readers already turn
 * absence into `unknown`, and an emitted signal must carry an answer the source
 * actually gave.
 */
export function graphPostureToDrafts(posture: GraphPostureSignal): PostureSignalDraft[] {
  const observedAt = posture.observedAt;
  const drafts: PostureSignalDraft[] = [];

  if (posture.identityStatus === "enabled") {
    drafts.push({ category: "identity_state", value: true, observedAt });
  } else if (posture.identityStatus === "disabled") {
    drafts.push({ category: "identity_state", value: false, observedAt });
  }

  switch (posture.deviceComplianceState) {
    case "compliant":
      drafts.push({ category: "device_compliance", value: "compliant", observedAt });
      break;
    // A grace period is a FAILED compliance evaluation with enforcement
    // deferred. Reporting it compliant would be the unearned affirmative;
    // non_compliant is the answer the policy engine actually produced.
    case "non_compliant":
    case "in_grace_period":
      drafts.push({ category: "device_compliance", value: "non_compliant", observedAt });
      break;
    case "missing":
      drafts.push({ category: "device_compliance", value: "unknown", observedAt });
      break;
    // "unknown" (an unrecognized vendor spelling): emit nothing — silence
    // normalizes to unknown without asserting a read we did not understand.
  }

  switch (posture.deviceManagementState) {
    case "managed":
      drafts.push({ category: "device_management", value: true, observedAt });
      break;
    // retire_pending is management affirmatively on its way out — the plane is
    // no longer effectively governing this device.
    case "unmanaged":
    case "retire_pending":
      drafts.push({ category: "device_management", value: false, observedAt });
      break;
  }

  return drafts;
}

/**
 * Map a device-management-health family verdict into the core's
 * `device_management_health` signal (healthy / degraded / broken / unknown).
 *
 * Faithful to the family's own action ladder — the bridge never escalates past
 * it and never softens it:
 *   managementEffective (seven-way positive confirmation) → healthy
 *   restrict/escalate (retired, failed enrollment, uncovered) → broken
 *   unverified/unknown posture (gaps, malformed, unreachable) → unknown
 *   everything else the family affirmatively diagnosed        → degraded
 */
export function deviceManagementHealthToDrafts(
  verdict: DeviceManagementHealthVerdict,
  observedAt: string,
): PostureSignalDraft[] {
  const value: ManagementHealthState = verdict.managementEffective
    ? "healthy"
    : verdict.recommendedAction === "restrict" || verdict.recommendedAction === "escalate"
      ? "broken"
      : verdict.posture === "unverified" || verdict.posture === "unknown"
        ? "unknown"
        : "degraded";
  return [{ category: "device_management_health", value, observedAt }];
}

/**
 * Map a local-authority family verdict into the core's `local_authority`
 * signal (verified / withheld / unverified).
 *
 * Only the family's own restrict-level findings (awaiting first unlock,
 * unreadable vault, expired grant) become the affirmative `withheld` the core's
 * v1 rule fires on. Every step_up/alert-level gap stays `unverified`, which the
 * core deliberately leaves quiet — unknown raises assurance, it never restricts
 * on its own.
 */
export function localAuthorityToDrafts(
  verdict: LocalAuthorityVerdict,
  observedAt: string,
): PostureSignalDraft[] {
  const value: LocalAuthorityGrantState = verdict.mayActLocally
    ? "verified"
    : verdict.action === "restrict"
      ? "withheld"
      : "unverified";
  return [{ category: "local_authority", value, observedAt }];
}

/** Classify the freshness of a FleetDM posture read against a reference time. */
export function fleetDMFreshness(
  posture: telemetryTypes.FleetDMPostureSignal,
  nowIso: string,
): Freshness {
  const checkMs = Date.parse(posture.lastCheckAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(checkMs) || Number.isNaN(nowMs)) return "unknown";
  // A check-in meaningfully in the FUTURE is contradictory — a skewed or
  // manipulated source clock. It used to read as "fresh" (nowMs - checkMs is
  // negative, so ageHours <= FRESH_HOURS is trivially true), the exact
  // fail-open every sibling deriver guards against (location-services,
  // pacs-access, access-governance, core util.ts). Contradiction resolves to
  // "unknown" — never to the freshest possible reading. (ECC-role review,
  // fail-closed-auditor, 2026-09-01.)
  // Folded onto the shared deriver at its DEFAULT tolerance — the same 60s this
  // file used to spell out for itself.
  const age = ageMs(checkMs, nowMs);
  if (age === null) return "unknown";
  const ageHours = age / 3_600_000;
  if (ageHours <= FRESH_HOURS) return "fresh";
  if (ageHours <= STALE_HOURS) return "stale";
  return "expired";
}
