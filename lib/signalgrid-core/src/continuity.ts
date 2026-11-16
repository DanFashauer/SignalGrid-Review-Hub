/**
 * Decision continuity — reconciling decisions that were made on both sides of a
 * network partition.
 *
 * WHY THIS EXISTS
 *
 * A frontline device that keeps working offline keeps *deciding* offline. When it
 * reconnects, two answers exist for the same subject and action: the one the device
 * minted alone, and the one the control plane minted (or would have). Something has
 * to say which stands. Until this file, nothing in the fabric did.
 *
 * The offline-sync literature answers this with last-write-wins or with CRDT merge.
 * Both are wrong here, for reasons specific to what is being merged:
 *
 *  - LAST-WRITE-WINS reads a clock. On a shared, badge-checked-out device the clock
 *    is settable by whoever holds the device, so "newest timestamp wins" makes
 *    *changing the date* a grant primitive: a stale `allow` beats a fresh `deny`.
 *    Golden rule 2 already forbids a wall-clock read in a decision path; this is the
 *    concrete harm behind the rule, not a style preference.
 *
 *  - A CRDT JOIN is order-independent and clock-free, which is right, but a join can
 *    only ever move UP its lattice. Policy relaxation moves DOWN: version 8 exists
 *    precisely so that something version 7 restricted can now be allowed. A pure join
 *    over outcomes can never express that, so a fabric built on one is fail-STUCK —
 *    a single stale `deny` from a device that never came back vetoes the corrected
 *    policy forever.
 *
 * So this is neither. It is an ORDER-INDEPENDENT SET REDUCTION over a partial order
 * of provenance, with a fail-closed veto on top. It gets the property that matters
 * from the CRDT world — the answer does not depend on the order records arrived in,
 * or on how many times one arrived — without pretending outcome merge is monotone.
 *
 * WHY NO VECTOR CLOCKS. Vector clocks exist because record edits originate anywhere,
 * so causality has to be reconstructed after the fact. SignalGrid's decision
 * provenance does not originate anywhere: `policyVersion` is minted by the control
 * plane and `coreNormalizationVersion` is generated from a source digest
 * (`scripts/generate-core-normalization-version.mjs`). Both are already logical
 * counters with a single writer. The pair is the causal order; there is nothing left
 * for a vector clock to recover.
 *
 * THE ASYMMETRY THIS PROTECTS. Going offline SHRINKS the reachable signal set. Under
 * golden rule 2 an unreachable signal raises assurance, so a decision made offline is
 * by construction made on less evidence than one made online. A naive offline-first
 * build makes the partition NEUTRAL — the local engine evaluates whatever it can
 * still see and returns `allow`. That is the unearned affirmative at the heart of
 * offline-first, and `OFFLINE_AUTHORITY_CANNOT_RELAX` below is the rule that refuses
 * it: a newer policy version licenses a device to be MORE restrictive on its own; it
 * never licenses it to be less restrictive than a better-connected evaluation.
 *
 * WHAT THIS IS NOT. Not a transport. There is no queue, no retry schedule, no
 * backoff, no persistence here — those are the host app's, and none of them can
 * manufacture a grant on their own. The one transport fact that CAN is carried as
 * data (`policyKnownSuperseded`): a node that knew a newer bundle was waiting and
 * decided anyway is asserting an answer it already had reason to doubt.
 */

import {
  CoreError,
  type DecisionOutcome,
} from "./types";

/**
 * Worst-first precedence, matching `policy.ts`. Duplicated deliberately rather than
 * shared: `policy.ts` is inside the core normalization closure
 * (`scripts/generate-core-normalization-version.mjs` walks the import graph from the
 * mint sites) and this file is not, so exporting the constant from there would drag a
 * reconciliation change into the stamp on every decision record that never used it.
 * `decision-continuity-proof.ts` pins the two against each other so the duplication
 * cannot drift silently.
 */
// PROTOTYPE-LESS ON PURPOSE. This was a plain object literal, and two guards
// below tested membership with `in`, which walks Object.prototype. So
// `"constructor" in OUTCOME_RANK` was TRUE and a record could carry
// outcome:"constructor" through validation. The damage was not cosmetic:
// mostRestrictiveOutcome reduces WITHOUT an initial value, so the poisoned key
// becomes the accumulator when it arrives first, its "rank" is a function, and
// `4 > function` is NaN — false. Nothing ever displaces it.
//
//   mostRestrictiveOutcome(["constructor", "deny"])  ->  "constructor"
//   mostRestrictiveOutcome(["deny", "constructor"])  ->  "deny"
//
// A genuine deny was erased, and the answer became order-dependent — which
// falsifies this file's own headline claim, twenty lines above, that the result
// "does not depend on the order records arrived in".
//
// Two independent fixes, because either alone leaves a hole. The guards now use
// a Set — the pattern policy.ts:224 already used — and mostRestrictiveOutcome
// validates its OWN input below, because it is exported and a caller can reach
// it without passing through validateRecord at all.
//
// The table itself stays a plain literal on purpose. Making it prototype-less
// was the first attempt and the continuity proof rejected it: policy.ts holds a
// twin table and a parity check requires the two to be byte-identical. That
// guard is right, so the defense moved to where the danger actually is rather
// than deforming a table that has to match its twin.
const OUTCOME_RANK: Record<DecisionOutcome, number> = {
  deny: 4,
  restrict: 3,
  step_up: 2,
  allow: 1,
};

/** Membership, without Object.prototype in the answer. */
const VALID_OUTCOMES: ReadonlySet<string> = new Set(["deny", "restrict", "step_up", "allow"]);

/** The fail-closed join on outcomes: the most restrictive of the set wins. */
export function mostRestrictiveOutcome(outcomes: readonly DecisionOutcome[]): DecisionOutcome {
  if (outcomes.length === 0) {
    throw new CoreError("validation", "mostRestrictiveOutcome requires at least one outcome.", 400);
  }
  // Validate before ranking. This function is EXPORTED, so it can be reached
  // without validateRecord — and an unranked key does not merely rank low, it
  // ranks `undefined`, which loses every `>` comparison as NaN and therefore
  // STICKS as the accumulator. That is a fail-closed inversion, not a typo.
  for (const outcome of outcomes) {
    if (!VALID_OUTCOMES.has(outcome)) {
      throw new CoreError("validation", `mostRestrictiveOutcome received an unknown outcome "${String(outcome)}".`, 400);
    }
  }
  return outcomes.reduce((worst, next) => (OUTCOME_RANK[next] > OUTCOME_RANK[worst] ? next : worst));
}

/**
 * What a decision was decided WITH — the two centrally-minted version counters, plus
 * the two facts about the conditions it was minted under.
 *
 * Only the counters participate in the ordering. The two booleans are vetoes applied
 * after the order is resolved, because "was offline" is not newer or older than
 * anything — it is a statement about how much evidence was reachable.
 */
export interface DecisionProvenance {
  /** Control-plane-minted policy version the decision was evaluated against. */
  readonly policyVersion: number;
  /**
   * Which build of the core decision path evaluated it.
   *
   * OPTIONAL for the same reason it is optional on `EvidenceSnapshot`: records minted
   * before the stamp existed genuinely do not carry one, and inventing a value would
   * be back-dating. An absent stamp is treated as UNKNOWN, not as zero — see
   * `compareProvenance`, where unknown is incomparable with every known value, so an
   * unstamped record can neither dominate nor be dominated and always forces the
   * fail-closed join.
   */
  readonly coreNormalizationVersion?: number;
  /**
   * True when one or more required sources were unreachable at evaluation time —
   * i.e. the device decided on a shrunken signal set.
   */
  readonly evaluatedOffline: boolean;
  /**
   * True when the evaluating node already knew a newer policy bundle was available
   * and evaluated anyway. This is `updateAvailable` from the edge-sync plan
   * (`@workspace/control-plane` `syncPlan`) captured at mint time, not re-derived
   * here — a node that has since caught up must not be able to retroactively claim
   * its old decision was current.
   */
  readonly policyKnownSuperseded: boolean;
}

/** One side's answer, as it arrives at the reconciler. */
export interface ReconcilableDecision {
  /** Stable identifier — the decision id. Used for reporting and for de-duplication. */
  readonly id: string;
  readonly outcome: DecisionOutcome;
  readonly provenance: DecisionProvenance;
}

/**
 * A caller-posed bound on how long a decision made offline may keep standing.
 *
 * CALLER-POSED, not clock-read: the caller states the bound and states how much time
 * has elapsed for each record. Nothing here reads a clock, so the same inputs replay
 * to the same answer forever — which is the whole reason a decision path may not call
 * `Date.now()`.
 */
export interface StandingBound {
  /** Seconds an offline decision may stand without re-contact. Must be finite and > 0. */
  readonly maxStandingSeconds: number;
  /**
   * Elapsed seconds since each record was minted, by record id.
   *
   * A record the caller says nothing about is treated as EXPIRED, not as fresh. An
   * unstated age is an unknown, and an unknown that bought unbounded standing would
   * be the same defect this whole file exists to refuse: silence purchasing an
   * affirmative.
   */
  readonly elapsedSecondsById: Readonly<Record<string, number>>;
  /**
   * What an expired offline decision becomes. Its outcome is RAISED to this floor —
   * never dropped. Dropping an expired record would remove a restriction from the
   * set, and "no decision" reads downstream as "nothing restricting me". Defaults to
   * `step_up`: the worker is not stopped, they are asked to re-prove.
   */
  readonly floor?: DecisionOutcome;
}

export interface ReconciliationOptions {
  /** Absent means no bound is asserted and nothing expires. */
  readonly standingBound?: StandingBound;
}

export interface ReconciliationResult {
  readonly outcome: DecisionOutcome;
  /** Stable, sorted, order-independent. */
  readonly reasonCodes: readonly string[];
  /** Ids on the provenance frontier — the maxima of the partial order. Sorted. */
  readonly authorityIds: readonly string[];
  /** True when the frontier holds two mutually incomparable provenances. */
  readonly contested: boolean;
  /** Ids whose outcome was raised by the standing bound. Sorted. */
  readonly expiredIds: readonly string[];
  /** How many distinct records were reduced. */
  readonly considered: number;
}

export type ProvenanceComparison = "equal" | "left_dominates" | "right_dominates" | "incomparable";

/**
 * Compare two provenances under the product order on (policyVersion, coreNormalizationVersion).
 *
 * An ABSENT `coreNormalizationVersion` is unknown, and unknown is incomparable with
 * every known value — including with a *lower* one. That looks strict, and it is the
 * point: the alternative is to read absence as zero, which would let every stamped
 * record dominate every legacy record on an axis where nothing is actually known. Two
 * absent stamps are equal to each other (the pre-stamp world's best available answer),
 * so a fleet that predates the stamp still orders by policy version alone.
 */
export function compareProvenance(a: DecisionProvenance, b: DecisionProvenance): ProvenanceComparison {
  const policy = compareNumbers(a.policyVersion, b.policyVersion);
  const core = compareOptionalNumbers(a.coreNormalizationVersion, b.coreNormalizationVersion);
  if (policy === "incomparable" || core === "incomparable") return "incomparable";
  if (policy === "equal" && core === "equal") return "equal";
  // A dominates B iff A is >= on every axis and > on at least one.
  if ((policy === "greater" || policy === "equal") && (core === "greater" || core === "equal")) {
    return "left_dominates";
  }
  if ((policy === "less" || policy === "equal") && (core === "less" || core === "equal")) {
    return "right_dominates";
  }
  // One axis up, the other down — a staged rollout, and genuinely undecidable.
  return "incomparable";
}

type AxisComparison = "equal" | "greater" | "less" | "incomparable";

function compareNumbers(a: number, b: number): AxisComparison {
  if (a === b) return "equal";
  return a > b ? "greater" : "less";
}

function compareOptionalNumbers(a: number | undefined, b: number | undefined): AxisComparison {
  if (a === undefined && b === undefined) return "equal";
  if (a === undefined || b === undefined) return "incomparable";
  return compareNumbers(a, b);
}

/**
 * Reduce a set of decisions for the SAME subject and action to the one that stands.
 *
 * The reduction, in order:
 *
 *  1. Validate. A malformed record or a malformed bound is refused outright — a
 *     reconciler that guesses is a reconciler that can be fed a guess.
 *  2. Apply the standing bound: an offline decision past its bound (or with an
 *     unstated age) has its outcome RAISED to the floor.
 *  3. Find the frontier — the maxima of the provenance partial order.
 *  4. Join the frontier's outcomes fail-closed. That is the AUTHORITY outcome.
 *  5. Veto: if the frontier is contested, or if any frontier record decided offline
 *     or knowingly under a superseded policy, the authority may not RELAX below the
 *     fail-closed join of every record.
 *
 * The result depends only on the SET of records, never on their order and never on
 * how many copies of one arrived. `decision-continuity-proof.ts` measures both.
 */
export function reconcileDecisions(
  records: readonly ReconcilableDecision[],
  options: ReconciliationOptions = {},
): ReconciliationResult {
  if (!Array.isArray(records) || records.length === 0) {
    // Refusing beats returning. There is no fail-closed default outcome to hand back
    // here, because a caller with nothing to reconcile has a bug, and any outcome
    // this function invented would be indistinguishable from a real one downstream.
    throw new CoreError("validation", "reconcileDecisions requires at least one decision.", 400);
  }

  const deduped = new Map<string, ReconcilableDecision>();
  for (const record of records) {
    validateRecord(record);
    const existing = deduped.get(record.id);
    if (existing) {
      // The same id twice must be the same record. Two different answers under one id
      // is a corrupted sync payload, not a conflict to reconcile.
      if (existing.outcome !== record.outcome || compareProvenance(existing.provenance, record.provenance) !== "equal") {
        throw new CoreError(
          "validation",
          `reconcileDecisions received conflicting records under id "${record.id}".`,
          400,
        );
      }
      continue;
    }
    deduped.set(record.id, record);
  }

  const bound = options.standingBound;
  if (bound !== undefined) validateStandingBound(bound);

  const reasonCodes = new Set<string>();
  const expiredIds: string[] = [];

  // ── 2. standing bound ──────────────────────────────────────────────────────
  const effective = [...deduped.values()].map((record) => {
    if (bound === undefined || !record.provenance.evaluatedOffline) return record;
    // Own-property read: a record id that names an inherited member
    // ("constructor", "toString") must read as UNSTATED, not as a function
    // that then fails the numeric bound under a misleading reason.
    const elapsed = Object.prototype.hasOwnProperty.call(bound.elapsedSecondsById, record.id)
      ? bound.elapsedSecondsById[record.id]
      : undefined;
    const unstated = elapsed === undefined;
    if (!unstated && elapsed <= bound.maxStandingSeconds) return record;
    const floor = bound.floor ?? "step_up";
    expiredIds.push(record.id);
    reasonCodes.add(unstated ? "OFFLINE_STANDING_AGE_UNSTATED" : "OFFLINE_STANDING_BOUND_EXCEEDED");
    const raised = mostRestrictiveOutcome([record.outcome, floor]);
    return raised === record.outcome ? record : { ...record, outcome: raised };
  });

  // ── 3. frontier ────────────────────────────────────────────────────────────
  const frontier = effective.filter(
    (candidate) =>
      !effective.some(
        (other) => other.id !== candidate.id && compareProvenance(other.provenance, candidate.provenance) === "left_dominates",
      ),
  );

  const contested = frontier.some((a) =>
    frontier.some((b) => a.id !== b.id && compareProvenance(a.provenance, b.provenance) === "incomparable"),
  );

  // ── 4/5. join, then veto ───────────────────────────────────────────────────
  const authorityOutcome = mostRestrictiveOutcome(frontier.map((r) => r.outcome));
  const failClosedOutcome = mostRestrictiveOutcome(effective.map((r) => r.outcome));
  const authorityWouldRelax = OUTCOME_RANK[authorityOutcome] < OUTCOME_RANK[failClosedOutcome];

  let outcome = authorityOutcome;
  if (contested) {
    reasonCodes.add("PROVENANCE_CONTESTED_FAIL_CLOSED");
    outcome = failClosedOutcome;
  } else if (authorityWouldRelax) {
    const offlineAuthority = frontier.some((r) => r.provenance.evaluatedOffline);
    const supersededAuthority = frontier.some((r) => r.provenance.policyKnownSuperseded);
    if (offlineAuthority) reasonCodes.add("OFFLINE_AUTHORITY_CANNOT_RELAX");
    if (supersededAuthority) reasonCodes.add("SUPERSEDED_POLICY_AUTHORITY_CANNOT_RELAX");
    if (offlineAuthority || supersededAuthority) {
      outcome = failClosedOutcome;
    } else {
      // The un-stick path, and the only place a relaxation is honoured: a fully
      // connected evaluation under a strictly newer policy overrides an older
      // restriction. Without this the fabric would be fail-stuck — one stale `deny`
      // from a device that never came back would veto the corrected policy forever.
      reasonCodes.add("NEWER_PROVENANCE_RELAXED_STALE_DECISION");
    }
  }

  if (frontier.length === effective.length && effective.length > 1 && !contested) {
    // Every record is a maximum and none is incomparable — they all share one
    // provenance, so nothing was superseded and the join is the whole answer.
    reasonCodes.add("PROVENANCE_UNIFORM_ACROSS_RECORDS");
  }

  return {
    outcome,
    reasonCodes: [...reasonCodes].sort(),
    authorityIds: frontier.map((r) => r.id).sort(),
    contested,
    expiredIds: expiredIds.sort(),
    considered: effective.length,
  };
}

function validateRecord(record: ReconcilableDecision): void {
  if (!record || typeof record !== "object") {
    throw new CoreError("validation", "reconcileDecisions received a non-object record.", 400);
  }
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new CoreError("validation", "reconcileDecisions record has no id.", 400);
  }
  if (!VALID_OUTCOMES.has(record.outcome)) {
    throw new CoreError("validation", `reconcileDecisions record "${record.id}" has an unknown outcome.`, 400);
  }
  const p = record.provenance;
  if (!p || typeof p !== "object") {
    throw new CoreError("validation", `reconcileDecisions record "${record.id}" has no provenance.`, 400);
  }
  if (!Number.isInteger(p.policyVersion) || p.policyVersion < 1) {
    throw new CoreError(
      "validation",
      `reconcileDecisions record "${record.id}" has a non-integer or non-positive policyVersion.`,
      400,
    );
  }
  if (
    p.coreNormalizationVersion !== undefined &&
    (!Number.isInteger(p.coreNormalizationVersion) || p.coreNormalizationVersion < 1)
  ) {
    throw new CoreError(
      "validation",
      `reconcileDecisions record "${record.id}" has a non-integer or non-positive coreNormalizationVersion.`,
      400,
    );
  }
  // Booleans are REQUIRED rather than defaulted. `evaluatedOffline` defaulting to
  // false and `policyKnownSuperseded` defaulting to false would both default in the
  // permissive direction: an omitted field would buy the record the right to relax.
  // The caller has to say.
  if (typeof p.evaluatedOffline !== "boolean") {
    throw new CoreError(
      "validation",
      `reconcileDecisions record "${record.id}" must state evaluatedOffline; omission is not "online".`,
      400,
    );
  }
  if (typeof p.policyKnownSuperseded !== "boolean") {
    throw new CoreError(
      "validation",
      `reconcileDecisions record "${record.id}" must state policyKnownSuperseded; omission is not "current".`,
      400,
    );
  }
}

function validateStandingBound(bound: StandingBound): void {
  if (!Number.isFinite(bound.maxStandingSeconds) || bound.maxStandingSeconds <= 0) {
    throw new CoreError("validation", "standingBound.maxStandingSeconds must be a finite positive number.", 400);
  }
  if (!bound.elapsedSecondsById || typeof bound.elapsedSecondsById !== "object") {
    throw new CoreError("validation", "standingBound.elapsedSecondsById must be an object.", 400);
  }
  for (const [id, elapsed] of Object.entries(bound.elapsedSecondsById)) {
    // A negative elapsed is the clock attack in a different coat: it would buy
    // standing that was never served. Reject rather than clamp — clamping would make
    // a tampered payload indistinguishable from an honest one.
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new CoreError("validation", `standingBound.elapsedSecondsById["${id}"] must be a finite, non-negative number.`, 400);
    }
  }
  if (bound.floor !== undefined && !(VALID_OUTCOMES.has(bound.floor))) {
    throw new CoreError("validation", "standingBound.floor is not a known outcome.", 400);
  }
}
