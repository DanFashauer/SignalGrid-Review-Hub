// session-readiness family — public surface, the live-call gate, one grounded
// normalizer, and the fixture corpus.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS
// + credential + injected transport, fixtures, proof, and no network primitive
// anywhere in the family.

import { evaluateSessionReadiness } from "./evaluate";
import type {
  AppReadiness,
  NormalizedSessionReadiness,
  ReadinessBudget,
  ReadinessMeasurement,
  SessionOrigin,
  SessionReadinessVerdict,
  WorkflowRisk,
} from "./types";

export * from "./types";
export { evaluateSessionReadiness } from "./evaluate";

/** A read transport. Deliberately NOT implemented in this repository. */
export interface SessionReadinessReadTransport {
  readSessionReadiness(sessionRef: string): Promise<unknown>;
}

export type SessionReadinessResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: SessionReadinessReadTransport };

/**
 * Decide whether this deployment may make a live DEX-plane read.
 *
 * Fail-closed and unanimous: every condition must hold, and any one failing returns
 * fixture mode naming the specific cause. The transport must be INJECTED and this
 * repository ships none, so the gate's failure mode is "there is no code" rather than
 * "a flag was set correctly".
 */
export function resolveSessionReadinessConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: SessionReadinessReadTransport,
): SessionReadinessResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  // ControlUp is the only DEX plane this normalizer is grounded in. Accepting a vendor
  // whose payload shape nobody here has read would ship a gate that configures cleanly
  // for a system this dimension cannot actually normalize — the same trap
  // `service-lifecycle` avoids by refusing on-prem AD by name.
  const plane = (env["SESSION_READINESS_DEX_PLANE"] ?? "").trim().toLowerCase();
  if (plane !== "controlup") {
    return { mode: "fixture", reason: "SESSION_READINESS_DEX_PLANE is not 'controlup'" };
  }
  if (!env["SESSION_READINESS_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "SESSION_READINESS_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return { mode: "fixture", reason: "no read transport is injected; this repository ships none" };
  }
  return { mode: "live", transport: transportOverride };
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Whole non-negative seconds, or null. A negative or fractional duration is not a
 *  duration we can grade, so it reads as absent rather than being coerced. */
const asSeconds = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

const READINESS: readonly AppReadiness[] = ["usable", "degraded", "not_usable", "unknown"];
const MEASUREMENT: readonly ReadinessMeasurement[] = ["measured", "not_instrumented", "plane_unreachable"];
const ORIGIN: readonly SessionOrigin[] = ["fresh", "reconnected", "unknown"];
const RISK: readonly WorkflowRisk[] = ["routine", "elevated", "critical", "unstated"];

/**
 * Normalize one ControlUp-shaped tap-to-app record.
 *
 * DEFENSIVE THROUGHOUT, and asymmetric on purpose. Every unrecognised or missing value
 * falls to the axis's ignorance member — `unknown`, `unstated`, or in the measurement
 * axis's case `plane_unreachable`, which is the conservative reading of "we asked and
 * got something we cannot parse".
 *
 * NOTE WHAT IS *NOT* DERIVED HERE. A record that carries no `appReadiness` does not
 * become `usable` because nothing looked wrong, and a record with no elapsed time does
 * not become "fast". Both read as ignorance. That is the row-45 rule for this family:
 * silence from a measurement plane is not a measurement.
 */
export function normalizeControlUpReadiness(
  raw: Record<string, unknown>,
  opts: { readonly budget?: ReadinessBudget | null; readonly workflowRisk?: WorkflowRisk } = {},
): NormalizedSessionReadiness {
  const sessionRef = asString(raw["sessionRef"]) ?? asString(raw["sessionId"]);
  if (sessionRef === null) {
    // A record we cannot even name. Everything unknown, integrity malformed — never a
    // partially-trusted read wearing an intact label.
    return {
      sessionRef: "",
      appReadiness: "unknown",
      measurement: "plane_unreachable",
      sessionOrigin: "unknown",
      elapsedToUsableSeconds: null,
      budget: opts.budget ?? null,
      workflowRisk: opts.workflowRisk ?? "unstated",
      reportIntegrity: "malformed",
    };
  }

  const readinessRaw = asString(raw["appReadiness"]);
  const measurementRaw = asString(raw["measurement"]);
  const originRaw = asString(raw["sessionOrigin"]);

  const appReadiness = READINESS.find((r) => r === readinessRaw) ?? "unknown";
  const measurement = MEASUREMENT.find((m) => m === measurementRaw) ?? "plane_unreachable";
  const sessionOrigin = ORIGIN.find((o) => o === originRaw) ?? "unknown";
  const workflowRisk = RISK.find((r) => r === opts.workflowRisk) ?? "unstated";

  // ONE unreadable field makes the WHOLE record malformed. A partially-parsed record
  // that grades on its readable half is how a garbled feed manufactures a confident
  // answer — the rule `service-lifecycle` pins across its own state space.
  const anyPresentButUnrecognised =
    (readinessRaw !== null && !READINESS.some((r) => r === readinessRaw)) ||
    (measurementRaw !== null && !MEASUREMENT.some((m) => m === measurementRaw)) ||
    (originRaw !== null && !ORIGIN.some((o) => o === originRaw));

  return {
    sessionRef,
    appReadiness,
    measurement,
    sessionOrigin,
    elapsedToUsableSeconds: asSeconds(raw["elapsedToUsableSeconds"]),
    budget: opts.budget ?? null,
    workflowRisk,
    reportIntegrity: anyPresentButUnrecognised ? "malformed" : "intact",
  };
}

/** Deterministic fixture corpus — the states a demo or proof exercises without a
 *  vendor. Named for what they DEMONSTRATE, not for the vendor's wording. */
export const SESSION_READINESS_FIXTURES: Readonly<Record<string, NormalizedSessionReadiness>> = {
  "clinician-ready": {
    sessionRef: "sess-ready",
    appReadiness: "usable",
    measurement: "measured",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: 8,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "critical",
    reportIntegrity: "intact",
  },
  // The headline case from the intake: 42 seconds to a usable app, a posed budget of
  // 30, and a critical workflow. Chart view would be fine; the medication order is not.
  "tap-to-app-over-budget-critical": {
    sessionRef: "sess-slow",
    appReadiness: "usable",
    measurement: "measured",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: 42,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "critical",
    reportIntegrity: "intact",
  },
  // Same 42 seconds, routine workflow. The SAME measurement must not produce the same
  // answer — this pair is the reason `workflowRisk` is an axis.
  "tap-to-app-over-budget-routine": {
    sessionRef: "sess-slow-routine",
    appReadiness: "usable",
    measurement: "measured",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: 42,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "routine",
    reportIntegrity: "intact",
  },
  // Nobody is watching this endpoint. No bad news, and no news.
  "endpoint-not-instrumented": {
    sessionRef: "sess-dark",
    appReadiness: "unknown",
    measurement: "not_instrumented",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: null,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "critical",
    reportIntegrity: "intact",
  },
  // The DEX plane itself is down. Every dashboard is green because nothing is reporting.
  "dex-plane-unreachable": {
    sessionRef: "sess-blind",
    appReadiness: "unknown",
    measurement: "plane_unreachable",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: null,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "critical",
    reportIntegrity: "intact",
  },
  // Fast BECAUSE nothing was torn down — the previous clinician's session, reconnected.
  "reconnected-shared-workstation": {
    sessionRef: "sess-reconnect",
    appReadiness: "usable",
    measurement: "measured",
    sessionOrigin: "reconnected",
    elapsedToUsableSeconds: 3,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "critical",
    reportIntegrity: "intact",
  },
  "app-never-came-up": {
    sessionRef: "sess-dead",
    appReadiness: "not_usable",
    measurement: "measured",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: null,
    budget: { thresholdSeconds: 30 },
    workflowRisk: "critical",
    reportIntegrity: "intact",
  },
  // A number nobody can grade: the deployment measured but posed no budget.
  "measured-with-no-posed-budget": {
    sessionRef: "sess-unposed",
    appReadiness: "usable",
    measurement: "measured",
    sessionOrigin: "fresh",
    elapsedToUsableSeconds: 42,
    budget: null,
    workflowRisk: "routine",
    reportIntegrity: "intact",
  },
};

/** Evaluate a named fixture, or undefined when the name is not in the corpus. */
export function evaluateSessionReadinessFixture(name: string): SessionReadinessVerdict | undefined {
  const state = SESSION_READINESS_FIXTURES[name];
  return state ? evaluateSessionReadiness(state) : undefined;
}
