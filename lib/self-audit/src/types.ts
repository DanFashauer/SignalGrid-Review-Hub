// @workspace/self-audit — a SELF-AWARE, SELF-HEALING checklist over the fabric's
// own backend, frontend, and API-integration contracts.
//
// "Self-aware" has a precise, falsifiable meaning here: the checklist is DERIVED
// from the machine-readable contract inventory the repo already maintains (the
// live-sync manifest), so when a new contract dimension appears without a
// checklist item covering it, the checklist reports THAT as a finding — it knows
// the boundaries of its own coverage rather than silently passing what it never
// looked at. A blind spot is a finding, not a green check.
//
// "Self-healing" is done the only way this repo permits: PROPOSAL, NOT MUTATION.
// A broken item can emit a governed HealProposal that DESCRIBES a remediation, and
// that proposal cannot apply itself — application is reachable only through an
// approval carrying a non-empty human approver ref, exactly as
// `@workspace/adaptive-proposals` governs a policy change. There is no auto-apply
// flag and no code path that reaches `applied` without a prior `approved` state.
//
// THE DISCIPLINE (inherited from work-context / adaptive-proposals):
//   • fail closed — a check whose probe is missing, malformed, or throws is
//     `unknown`, and `unknown` is NEVER treated as healthy; a grant of "healthy"
//     requires positive confirmation, an absent signal raises concern;
//   • deterministic — no Date.now / Math.random; identical input → byte-identical
//     report; every returned value is DEEP-FROZEN and inputs are never mutated;
//   • descriptive, never permissive — a HealProposal is DATA describing a fix,
//     never an executable payload a runtime could run;
//   • refusals are typed and asserted WITH their reason, and no refusal message
//     echoes a caller-supplied ref.

// ── the three layers of the system the checklist covers ────────────────────────

/** Which layer of the full-stack solution a checklist item guards. `meta` is the
 *  self-awareness layer: items about the checklist's OWN coverage of the contracts. */
export type AuditLayer = "backend" | "frontend" | "api_integration" | "meta";

export const AUDIT_LAYERS: readonly AuditLayer[] = [
  "backend",
  "frontend",
  "api_integration",
  "meta",
];

// ── the health of a single checklist item ──────────────────────────────────────

/** The status of one checked item.
 *   • `healthy`  — the probe positively confirmed the item holds.
 *   • `drifted`  — the item holds in a degraded/partial way that should be repaired
 *                  but is not an outright break (e.g. a count moved but is non-zero).
 *   • `broken`   — the probe positively confirmed the item does NOT hold.
 *   • `unknown`  — the probe did not run, returned malformed output, or threw. This
 *                  is the FAIL-CLOSED state: unknown is never healthy. */
export type CheckStatus = "healthy" | "drifted" | "broken" | "unknown";

export const CHECK_STATUSES: readonly CheckStatus[] = [
  "healthy",
  "drifted",
  "broken",
  "unknown",
];

/** Severity ordering for worst-status-wins aggregation. A higher number is worse.
 *  `unknown` outranks `drifted`: not knowing is worse than a known partial degrade,
 *  because an unmonitored item can hide an outright break. */
export const STATUS_RANK: Readonly<Record<CheckStatus, number>> = Object.freeze({
  healthy: 0,
  drifted: 1,
  unknown: 2,
  broken: 3,
});

/** The remediation hint of a non-healable item: deliberately empty. Named so a
 *  reader (and the proof) can assert "this item proposes no fix" explicitly rather
 *  than testing against a bare "". */
export const HEAL_NA = "";

/** A single item on the checklist: something that SHOULD be true about the system,
 *  and how to tell whether it is. */
export interface ChecklistItem {
  /** Stable, unique id (kebab). */
  id: string;
  layer: AuditLayer;
  /** What this item asserts, in plain language. */
  description: string;
  /** The probe whose result answers "does this hold?" — an opaque key the caller
   *  supplies a result for. A checklist item with no matching probe result is
   *  `unknown` (fail closed), never assumed healthy. */
  probeKey: string;
  /** Whether a broken/drifted result has a KNOWN-SAFE proposed remediation. An item
   *  that is not `healable` is reported but never generates a heal proposal — we do
   *  not invent fixes we cannot describe safely. */
  healable: boolean;
  /** Descriptive remediation guidance (DATA, never an executable command). Empty
   *  when `healable` is false. */
  remediationHint: string;
}

/** A checklist item joined with the status a probe produced for it. */
export interface CheckedItem {
  item: ChecklistItem;
  status: CheckStatus;
  /** Human-readable detail from the probe (or the fail-closed reason). Never echoes
   *  a secret; probes return descriptive text only. */
  detail: string;
}

/** The result of running the whole checklist. */
export interface SelfAuditReport {
  /** Every item, in deterministic id order, with its resolved status. */
  items: CheckedItem[];
  /** Worst-status-wins over all items: the system's overall health. */
  overall: CheckStatus;
  /** Per-status counts, for a one-glance summary. */
  counts: Readonly<Record<CheckStatus, number>>;
  /** Per-layer worst status, so a reader sees which layer is unhealthy. */
  byLayer: Readonly<Record<AuditLayer, CheckStatus>>;
}

// ── the governed self-healing lifecycle ────────────────────────────────────────

/** A heal proposal's lifecycle. Mirrors `@workspace/adaptive-proposals`:
 *  `proposed → approved → applied`, plus `rejected`. There is NO transition to
 *  `applied` that does not pass through `approved` carrying a human approver. */
export type HealStatus = "proposed" | "approved" | "applied" | "rejected";

/** A DESCRIPTIVE proposed remediation for a broken/drifted item. It names the item
 *  and states the fix as prose; it carries no executable payload and enacts nothing.
 *  Applying it is a governed, human-approved act (see `heal.ts`). */
export interface HealProposal {
  /** Deterministic id derived from the checklist item id. */
  proposalId: string;
  /** The checklist item this heals. */
  targetItemId: string;
  layer: AuditLayer;
  /** The status that triggered the proposal (`broken` or `drifted`). */
  triggeredBy: CheckStatus;
  /** The remediation, as description-only data. */
  remediation: string;
  status: HealStatus;
  /** Opaque handle naming the human who approved — a ref into the identity system,
   *  never an authority in itself. `null` until an approval carries one. Reaching
   *  `applied` REQUIRES this to be a non-empty string. */
  approvedByRef: string | null;
  /** Advances on every transition, so a consumer can reject a stale copy. */
  version: number;
}

// ── typed refusals ─────────────────────────────────────────────────────────────

export type SelfAuditReasonCode =
  | "unknown_status"
  | "not_healable"
  | "missing_approver"
  | "illegal_transition"
  | "malformed_input";

/** A refusal, asserted WITH its reason. Never echoes a caller-supplied ref. */
export class SelfAuditError extends Error {
  constructor(
    readonly reason: SelfAuditReasonCode,
    message: string,
  ) {
    super(message);
    this.name = "SelfAuditError";
  }
}

// ── determinism helper ─────────────────────────────────────────────────────────

/** Recursively freeze — every value this package returns is immutable, so a
 *  consumer can neither mutate a report nor smuggle state back into the engine. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
