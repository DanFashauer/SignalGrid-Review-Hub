// Portable work context — the WORK follows the person; the ACCESS never does.
//
// Issue #136's core semantic, stated as a type: the same verified person receives a
// consistent, role-appropriate experience across authorized devices WITHOUT copying
// access everywhere. What travels between devices is a DESCRIPTION of where the
// person's work stands — which workflow, which tasks, which exceptions are still open,
// what trust floor the fabric last established. What never travels is anything a
// device could REPLAY: no credential, no token, no session cookie, no grant material
// of any kind. Trust is re-evaluated per device, every time, by composing that
// device's own signals through the fabric's real `composeDeviceRisk`.
//
// THE TYPE-LEVEL DISCIPLINE: every reference in this schema is an OPAQUE STRING — a
// handle a system of record can dereference, never a value that IS the thing. A
// `personRef` names a person to the identity system; it is not an identity assertion.
// A `lastVerdictRef` names a sealed verdict in the attestation layer; it is not the
// verdict's authority. This is "descriptive, never permissive" as a schema property,
// and it is machine-checked rather than commented: `assembleWorkContext` REFUSES (a
// typed error, not a warning) any input whose string values smell like credential
// material — see `CREDENTIAL_DENYLIST` below. A context that cannot carry a secret
// cannot leak one, and a context that cannot carry a grant cannot become one.
//
// This package sits where `pim-activation` sits: it consumes other dimensions'
// VERDICTS rather than normalizing a bridge report. It has no connector, no
// normalizer and no allow path of its own — the only "grant" near it is the one each
// device's composition earns for itself, downstream.

import { ACTION_RANK, rankOf, type RiskDriver, type RiskTier, type UnifiedAction } from "@workspace/posture-composition";

// ── the trust ceiling ─────────────────────────────────────────────────────────

/** The three rungs of the unified action ladder a carried trust floor may sit on.
 *
 *  A SUBSET on purpose. The full ladder has eight rungs, but most of them describe
 *  what to DO about a device right now (`patch`, `locate`, `alert`, `escalate`) —
 *  they are not levels a person can re-prove on the next device. What travels with
 *  the person is the MINIMUM that must be re-proven wherever they pick up:
 *
 *    `none`     — no carried concern; the device's own composition decides alone.
 *    `step_up`  — something unconfirmed followed this person's work; any device
 *                 must re-prove identity at step-up strength before the work resumes.
 *    `restrict` — a confirmed finding followed this person's work; the work is
 *                 visible but held until the finding is explicitly resolved.
 *
 *  It is a CEILING on permissiveness, not a grant: a device may always be judged
 *  worse than the carried level by its own signals; it may never be judged better.
 *  Full-ladder actions project onto these rungs fail-safe (`alert` → `step_up`,
 *  `escalate` → `restrict`) — see `ceilingFromAction` in `reevaluate.ts`. */
export const CONTEXT_TRUST_CEILINGS = ["none", "step_up", "restrict"] as const;

export type ContextTrustCeiling = (typeof CONTEXT_TRUST_CEILINGS)[number];

/** Project a full-ladder action onto the ceiling subset, FAIL-SAFE: an action at or
 *  above `restrict` projects to `restrict` (so `escalate` is not rounded DOWN past
 *  it), one at or above `step_up` projects to `step_up` (so `alert` keeps its
 *  step-up floor), and everything milder projects to `none` — `monitor`, `patch`
 *  and `locate` are things to DO about a device, not levels a person re-proves. */
export function ceilingFromAction(action: UnifiedAction): ContextTrustCeiling {
  // Guarded lookup: an off-ladder action ranks ABOVE restrict and projects to
  // `restrict` — the fail-safe direction — instead of `undefined` projecting to `none`.
  const rank = rankOf(action);
  if (rank >= ACTION_RANK.restrict) return "restrict";
  if (rank >= ACTION_RANK.step_up) return "step_up";
  return "none";
}

/** The stricter of two ceilings, using the SAME ladder ranks composition uses —
 *  a private severity table here would be one more hand-copy waiting to drift. */
export function worstCeiling(a: ContextTrustCeiling, b: ContextTrustCeiling): ContextTrustCeiling {
  return rankOf(a) >= rankOf(b) ? a : b;
}

// ── the schema ────────────────────────────────────────────────────────────────

/** WHO the context follows. All refs are opaque handles into systems of record —
 *  the identity system, the scheduling system — never assertions in themselves. */
export interface WorkContextSubject {
  /** Opaque handle for the verified physical person (badge/face/finger happened at
   *  a reader; the PACS did the matching; this names the resulting identity). */
  personRef: string;
  tenantId: string;
  /** Role label driving the role-appropriate experience (which app catalog, which
   *  workflow templates) — a description of what to SHOW, never of what to allow. */
  role: string;
  /** Opaque shift handle, when a scheduling system contributed one. */
  shiftRef: string | null;
  /** Opaque assignment handle (the WMS wave, the unit assignment), when known. */
  assignmentRef: string | null;
}

/** WHERE THE WORK STANDS — the part continuity exists to carry. Task and exception
 *  refs are handles into the execution system (the WMS, the EMR task list), which
 *  stays system of record; this context never completes, holds or closes anything. */
export interface WorkContextWork {
  /** Which workflow the person is inside (an `app-workflows` catalog key). */
  workflowKey: string;
  /** Tasks in flight — what the next device should surface first. */
  activeTaskRefs: string[];
  /** Tasks HELD in the execution system (an Oracle-style HELD is an operator action
   *  on the task, not an exception about the work — but it must not vanish in a
   *  handoff, or the hold silently becomes a loss). */
  heldTaskRefs: string[];
  /** Open task-exception records travelling with the work: each entry is
   *  `<TaskExceptionReasonCode>:<opaque exception ref>` (e.g.
   *  `INVENTORY_EXCEPTION_ACTIVE:exc-fixture-0007`), so the class is judgeable and
   *  the record findable without ever copying the execution system's row here.
   *  These come from the task-exception dimension's verdicts and they TRAVEL — see
   *  `reevaluateForDevice`: no movement between devices may drop one. */
  unresolvedExceptionRefs: string[];
  /** Which apps the role-appropriate experience is composed from. Catalog KEYS —
   *  what to render, never what to authorize. */
  appCatalogKeys: string[];
}

/** WHERE the person and their equipment last were, as opaque situation handles. */
export interface WorkContextSituation {
  /** Opaque zone handle from the location dimension, when one was contributed. */
  lastKnownZoneRef: string | null;
  /** Opaque custody-record handles (which case, which dock bay, which cart) from
   *  the physical-custody dimension. */
  custodyRefs: string[];
}

/** THE CARRIED TRUST FLOOR — what the fabric last concluded about this person's
 *  work, expressed as the minimum any next device must re-prove. Never a grant:
 *  the next device's own composition can only tighten this, never spend it. */
export interface WorkContextTrust {
  /** The minimum rung on the fabric's action ladder that must be re-proven on ANY
   *  device before this context's work resumes. Monotone under movement: a
   *  reevaluation may raise it, only an explicit resolution call with a non-empty
   *  resolution ref may lower it. */
  requiredStepUpLevel: ContextTrustCeiling;
  /** Reason codes of confirmed restrict-grade findings travelling with the work
   *  (e.g. `TASK_ASSIGNMENT_MISMATCH`). Confirmed facts, not gaps — the fabric
   *  grades unknowns `step_up`, so a gap raises the ceiling instead of landing
   *  here. Removed only by `clearRestriction` with a resolution ref. */
  activeRestrictions: string[];
  /** Opaque handle naming the policy version these conclusions were drawn under,
   *  so a consumer can tell a context assembled under an old policy from a fresh
   *  one without this schema carrying the policy itself. */
  policyVersionRef: string;
  /** Opaque handle to the most recent sealed verdict that fed this context (the
   *  verdict-attestation layer owns the verdict; this only names it). */
  lastVerdictRef: string;
}

/** HOW THIS CONTEXT CAME TO BE — enough to reproduce and audit the assembly. */
export interface WorkContextProvenance {
  /** Opaque MONOTONIC assembly ref (a sequence handle like `asm-000123`), NOT a
   *  wall-clock. Deliberate: two assemblies from identical inputs must be
   *  byte-identical, and a timestamp would make determinism unprovable. Ordering
   *  questions belong to the system that mints the refs. */
  assembledAtRef: string;
  /** Every verdict this context was assembled from, oldest first. */
  sourceVerdictRefs: string[];
  /** Monotone counter, +1 on every reevaluation or resolution. Lets any consumer
   *  reject a stale copy of the same person's context without comparing bodies. */
  contextVersion: number;
}

/** The portable work context. DESCRIPTIVE, NEVER PERMISSIVE: presenting this object
 *  to any endpoint grants nothing — it tells the next device what work to surface
 *  and what trust floor to re-prove, and the device's own signals do the rest. */
export interface PortableWorkContext {
  subject: WorkContextSubject;
  work: WorkContextWork;
  situation: WorkContextSituation;
  trust: WorkContextTrust;
  provenance: WorkContextProvenance;
}

// ── the credential denylist ───────────────────────────────────────────────────

/** Why a string was refused as credential-smelling. Each value names the family it
 *  catches, so a refusal is diagnosable without echoing the offending value. */
export type CredentialSmell =
  | "jwt_like"
  | "bearer_token"
  | "secret_key_prefix"
  | "pem_block"
  | "aws_access_key_id"
  | "userinfo_in_url";

/** The machine check behind "descriptive, never permissive".
 *
 *  A schema comment saying "no credentials here" survives exactly until the first
 *  caller pastes a session token into `lastVerdictRef` because it was the string
 *  they had. So the discipline is enforced at assembly: every string value in the
 *  inputs is swept against this list, and one hit REFUSES the whole assembly with a
 *  typed error naming the field path and the smell — never a context with the value
 *  quietly carried.
 *
 *  A DENYLIST is the honest shape for this check, and its limits are stated rather
 *  than hidden: it catches the recognizable families (JWTs, bearer strings, vendor
 *  secret-key prefixes, PEM blocks, cloud key ids, credentials embedded in URLs),
 *  and it cannot catch an arbitrary opaque secret — nothing syntactic can. The
 *  structural guarantee stays with the schema (there is no field whose MEANING is a
 *  credential); this check is defence in depth against the field-misuse path. */
export const CREDENTIAL_DENYLIST: readonly { smell: CredentialSmell; pattern: RegExp }[] = [
  // The JWT header `{"alg":...` base64url-encodes to `eyJ` — the prefix every
  // compact JWS/JWE serialization starts with.
  { smell: "jwt_like", pattern: /\beyJ[A-Za-z0-9_-]{6,}/ },
  // An HTTP Authorization value pasted whole ("Bearer x...").
  { smell: "bearer_token", pattern: /\bbearer\s+\S/i },
  // Vendor secret-key prefixes of the `sk_live_...` / `sk_test_...` / bare `sk_`
  // family.
  { smell: "secret_key_prefix", pattern: /\bsk_[A-Za-z0-9_]*/ },
  // A PEM-armored key or certificate block header.
  { smell: "pem_block", pattern: /-----BEGIN [A-Z ]+-----/ },
  // AWS access key ids (AKIA/ASIA + 16 uppercase alphanumerics).
  { smell: "aws_access_key_id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // Credentials smuggled inside a URL (`https://user:pass@host/`).
  { smell: "userinfo_in_url", pattern: /\/\/[^/\s:@]+:[^/\s@]+@/ },
];

/** Scan one string for credential smells. Exported so the proof can assert the
 *  detector directly as well as through the assembly refusal. */
export function credentialSmellOf(value: string): CredentialSmell | null {
  for (const entry of CREDENTIAL_DENYLIST) {
    if (entry.pattern.test(value)) return entry.smell;
  }
  return null;
}

// ── typed refusals ────────────────────────────────────────────────────────────

export type WorkContextErrorCode =
  /** A string in the inputs matched the credential denylist. The context was NOT
   *  assembled — this is a refusal, never a sanitization. */
  | "credential_material_refused"
  /** A context must be assembled FROM verdicts; zero sources is not a context, it
   *  is an assertion with no provenance. */
  | "no_source_verdicts"
  /** A resolution call (resolveException / clearRestriction / lowerTrustCeiling)
   *  arrived without a non-empty resolution ref. Lowering carried trust without a
   *  referenced resolution is exactly the movement-based widening this package
   *  exists to make impossible. */
  | "resolution_ref_required"
  /** The named exception ref is not in this context. Removing what is not there
   *  must be an error, not a silent success — a silent success is how a retry
   *  "resolves" the wrong exception. */
  | "unknown_exception_ref"
  /** The named restriction is not in this context. Same rule. */
  | "unknown_restriction"
  /** The resolution door only LOWERS the ceiling. Raising it happens through
   *  reevaluation, where it is driven by evidence rather than by a caller. */
  | "not_a_lowering";

export class WorkContextError extends Error {
  readonly code: WorkContextErrorCode;
  /** For credential refusals: the dotted field path that carried the smell (e.g.
   *  `work.activeTaskRefs[1]`). The VALUE is deliberately not echoed — an error
   *  message that repeats a secret is a second leak. */
  readonly path: string | null;
  /** For credential refusals: which denylist family matched. */
  readonly smell: CredentialSmell | null;
  constructor(code: WorkContextErrorCode, message: string, path: string | null = null, smell: CredentialSmell | null = null) {
    super(message);
    this.name = "WorkContextError";
    this.code = code;
    this.path = path;
    this.smell = smell;
  }
}

// ── the reevaluation result ───────────────────────────────────────────────────

/** What `reevaluateForDevice` decides for ONE device, plus the context that moves
 *  on with the person. The decision is device-scoped and disposable; the context
 *  is person-scoped and monotone. */
export interface DeviceDecision {
  /** The action this device must satisfy before the context's work resumes: the
   *  WORST of the device's own composed action and the carried trust ceiling.
   *  Full-ladder, so a `patch` or `locate` concern is visible even though it never
   *  becomes part of the carried ceiling. */
  finalRequiredAction: UnifiedAction;
  /** What this device's own signals composed to, before the ceiling was applied. */
  deviceAction: UnifiedAction;
  /** The ceiling that was carried IN — kept in the decision so an operator can see
   *  whether the device or the person's history drove the outcome. */
  carriedCeiling: ContextTrustCeiling;
  riskTier: RiskTier;
  /** The composed drivers, most-severe first, verbatim from `composeDeviceRisk`. */
  drivers: RiskDriver[];
}

export interface DeviceReevaluation {
  decision: DeviceDecision;
  /** The context that follows the person onward. Never the input object; the input
   *  is never mutated. */
  nextContext: PortableWorkContext;
}
