// break-glass family — public surface and the fixture corpus.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, fixtures, proof, and no network primitive anywhere.
//
// THE FIRST DRAFT SHIPPED NO GATE, on the reasoning that this family reads "the host
// application's own record" rather than a third-party vendor, so there was no live
// boundary to gate. The connector-discipline check refused it, and the check was
// right: a break-glass invocation record lives in the EHR's audit surface — Epic,
// Oracle Health, MEDITECH — and reading it is a vendor API call like any other. The
// absence of a transport in this repository is normal (no family ships one); it is
// not evidence that no boundary exists. The gate's insistence that "silence is not an
// option" is what turned an unexamined assumption into a corrected one.

import { evaluateBreakGlass } from "./evaluate";
import type {
  AssignmentAtInvocation,
  BreakGlassVerdict,
  ExpiryState,
  InvocationScope,
  JustificationState,
  NormalizedBreakGlass,
  ReviewState,
} from "./types";

export * from "./types";
export { evaluateBreakGlass } from "./evaluate";

/** A read transport. Deliberately NOT implemented in this repository. */
export interface BreakGlassReadTransport {
  readBreakGlassInvocation(invocationRef: string): Promise<unknown>;
}

export type BreakGlassResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: BreakGlassReadTransport };

/**
 * Decide whether this deployment may make a live EHR audit-plane read.
 *
 * Fail-closed and unanimous: every condition must hold, and any one failing returns
 * fixture mode naming the specific cause. The transport must be INJECTED and this
 * repository ships none, so the failure mode is "there is no code" rather than "a
 * flag was set wrong".
 *
 * The EHR plane is named explicitly rather than accepted as free text — the same
 * refusal `service-lifecycle` makes for on-prem AD. A gate that configures cleanly
 * for a system whose payload nobody here has read is a gate that lies.
 */
export function resolveBreakGlassConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: BreakGlassReadTransport,
): BreakGlassResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const plane = (env["BREAK_GLASS_EHR_PLANE"] ?? "").trim().toLowerCase();
  if (plane !== "epic" && plane !== "oracle-health" && plane !== "meditech") {
    return { mode: "fixture", reason: "BREAK_GLASS_EHR_PLANE is not a recognised EHR audit plane" };
  }
  if (!env["BREAK_GLASS_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "BREAK_GLASS_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return { mode: "fixture", reason: "no read transport is injected; this repository ships none" };
  }
  return { mode: "live", transport: transportOverride };
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const JUSTIFICATION: readonly JustificationState[] = ["recorded", "absent", "unreadable"];
const SCOPE: readonly InvocationScope[] = ["single_encounter", "broad", "unknown"];
const EXPIRY: readonly ExpiryState[] = ["bounded", "unbounded", "unknown"];
const REVIEW: readonly ReviewState[] = ["reviewed", "pending", "never_reviewed", "unknown"];
const ASSIGNMENT: readonly AssignmentAtInvocation[] = ["not_assigned", "assigned", "unknown"];

/**
 * Normalize one host-application break-glass record.
 *
 * ASYMMETRIC ON PURPOSE. A missing `justification` field reads `absent` — not
 * `unknown` — because the question "did the workflow capture a reason" has a
 * definite answer when the field is not there: it did not. Every OTHER axis falls to
 * its ignorance member, because their absence really is ignorance.
 *
 * That asymmetry is the row-45 fix for this family. Letting a missing justification
 * read as ignorance would let a deployment that never asks for one grade the same as
 * a deployment whose evidence merely failed to reach us, and the first is the exact
 * condition this dimension exists to surface.
 */
export function normalizeBreakGlassRecord(raw: Record<string, unknown>): NormalizedBreakGlass {
  const invocationRef = asString(raw["invocationRef"]) ?? asString(raw["id"]);
  if (invocationRef === null) {
    return {
      invocationRef: "",
      justification: "absent",
      scope: "unknown",
      expiry: "unknown",
      review: "unknown",
      assignmentAtInvocation: "unknown",
      reportIntegrity: "malformed",
    };
  }
  const jRaw = asString(raw["justification"]);
  const sRaw = asString(raw["scope"]);
  const eRaw = asString(raw["expiry"]);
  const rRaw = asString(raw["review"]);
  const aRaw = asString(raw["assignmentAtInvocation"]);

  const unrecognised =
    (jRaw !== null && !JUSTIFICATION.some((v) => v === jRaw)) ||
    (sRaw !== null && !SCOPE.some((v) => v === sRaw)) ||
    (eRaw !== null && !EXPIRY.some((v) => v === eRaw)) ||
    (rRaw !== null && !REVIEW.some((v) => v === rRaw)) ||
    (aRaw !== null && !ASSIGNMENT.some((v) => v === aRaw));

  return {
    invocationRef,
    // Absent → `absent`. See the note above: this axis's silence is an answer.
    justification: JUSTIFICATION.find((v) => v === jRaw) ?? "absent",
    scope: SCOPE.find((v) => v === sRaw) ?? "unknown",
    expiry: EXPIRY.find((v) => v === eRaw) ?? "unknown",
    review: REVIEW.find((v) => v === rRaw) ?? "unknown",
    assignmentAtInvocation: ASSIGNMENT.find((v) => v === aRaw) ?? "unknown",
    reportIntegrity: unrecognised ? "malformed" : "intact",
  };
}

/** Deterministic fixture corpus, named for what each demonstrates. */
export const BREAK_GLASS_FIXTURES: Readonly<Record<string, NormalizedBreakGlass>> = {
  // The shape a regulator wants: an unassigned clinician reached a record in an
  // emergency, said why, for one encounter, time-boxed, and it was reviewed after.
  "accountable-emergency": {
    invocationRef: "bg-good",
    justification: "recorded",
    scope: "single_encounter",
    expiry: "bounded",
    review: "reviewed",
    assignmentAtInvocation: "not_assigned",
    reportIntegrity: "intact",
  },
  // The defect that makes the whole mechanism unauditable.
  "no-justification-captured": {
    invocationRef: "bg-silent",
    justification: "absent",
    scope: "single_encounter",
    expiry: "bounded",
    review: "reviewed",
    assignmentAtInvocation: "not_assigned",
    reportIntegrity: "intact",
  },
  // Not an emergency measure — a permission change nobody filed.
  "standing-bypass": {
    invocationRef: "bg-standing",
    justification: "recorded",
    scope: "broad",
    expiry: "unbounded",
    review: "never_reviewed",
    assignmentAtInvocation: "not_assigned",
    reportIntegrity: "intact",
  },
  // The clinician was already assigned. Nothing was bypassed.
  "override-that-was-not-needed": {
    invocationRef: "bg-needless",
    justification: "recorded",
    scope: "single_encounter",
    expiry: "bounded",
    review: "reviewed",
    assignmentAtInvocation: "assigned",
    reportIntegrity: "intact",
  },
  // A working review queue with this item still in it — the system functioning.
  "review-queue-working": {
    invocationRef: "bg-pending",
    justification: "recorded",
    scope: "single_encounter",
    expiry: "bounded",
    review: "pending",
    assignmentAtInvocation: "not_assigned",
    reportIntegrity: "intact",
  },
  // No programme evidence reached us at all.
  "no-programme-evidence": {
    invocationRef: "bg-dark",
    justification: "recorded",
    scope: "unknown",
    expiry: "unknown",
    review: "unknown",
    assignmentAtInvocation: "unknown",
    reportIntegrity: "intact",
  },
};

export function evaluateBreakGlassFixture(name: string): BreakGlassVerdict | undefined {
  const state = BREAK_GLASS_FIXTURES[name];
  return state ? evaluateBreakGlass(state) : undefined;
}
