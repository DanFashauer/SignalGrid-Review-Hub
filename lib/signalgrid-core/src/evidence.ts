import { CORE_NORMALIZATION_VERSION } from "./core-normalization-version";
import { canonicalJson, deterministicId, digest } from "./util";
import { OWNER_TYPES, RISK_TIERS } from "./types";
import type {
  BadgeBindingState,
  BaselineState,
  BenchmarkSelectionState,
  ShiftContextState,
  BatteryHealthState,
  ChargeState,
  ComplianceState,
  CustodyState,
  DecisionEvidence,
  Device,
  DockState,
  EvidenceSnapshot,
  Freshness,
  Identity,
  LocalAuthorityGrantState,
  ManagementHealthState,
  NormalizedSignal,
  PolicyVersion,
  TamperState,
  Workflow,
} from "./types";

/**
 * Derive the normalized decision-evidence context from cached signals plus the
 * resolved subjects. Missing signals are represented as "unknown"/"missing"
 * (never assumed healthy), and `criticalSignalsPresent` is true only when all
 * critical inputs are present and not degraded.
 */
export function buildEvidence(
  identity: Identity,
  device: Device,
  workflow: Workflow,
  signals: NormalizedSignal[],
): DecisionEvidence {
  // Group the signals into the single latest-per-category entry in one pass,
  // instead of filtering+sorting the whole array once per category (this was 9
  // filter+sort passes per decision). For each category we keep the entry with
  // the greatest PARSED observedAt, and on a tie the first in the original order.
  // That is no longer byte-identical to the original filter+sort: it ordered by
  // STRING, which two timestamp shapes broke in the fail-open direction — see
  // `groupLatest` for both, measured.
  const latestByCategory = groupLatest(signals);
  const compliance = readCompliance(latestByCategory);
  const managed = readBoolean(latestByCategory, "device_management");
  const encrypted = readBoolean(latestByCategory, "device_encryption");
  const osSupported = readBoolean(latestByCategory, "os_support");
  const postureFreshness = readFreshness(latestByCategory);

  // Two sources can speak to whether the account is enabled: the resolved
  // identity row, and an `identity_state` signal from the identity connector.
  // Before this fold the signal was normalized, counted into `signalsUsed`, and
  // never read — so a connector reporting a DISABLED account still produced
  // `identityEnabled: true` and an allow, while the evidence snapshot recorded
  // the signal as an input to a decision it had not influenced.
  const identityEnabledFromRow: boolean | "unknown" =
    identity.state === "enabled"
      ? true
      : identity.state === "disabled"
        ? false
        : "unknown";
  const identityEnabled = foldIdentityEnabled(
    identityEnabledFromRow,
    readBoolean(latestByCategory, "identity_state"),
  );

  const partial = {
    identityEnabled,
    deviceManaged: managed,
    deviceCompliance: compliance,
    deviceEncrypted: encrypted,
    osSupported,
    ownerType: device.ownerType,
    postureFreshness,
    workflowRiskTier: workflow.riskTier,
    custodyState: readCustody(latestByCategory),
    dockChargeState: readCharge(latestByCategory),
    batteryHealth: readBatteryHealth(latestByCategory),
    tamperState: readTamper(latestByCategory),
    dockEvidenceFreshness: readDockEvidenceFreshness(latestByCategory),
    dockState: readDock(latestByCategory),
    baselineCompliance: readBaseline(latestByCategory),
    benchmarkSelection: readBenchmarkSelection(latestByCategory),
    shiftContext: readShiftContext(latestByCategory),
    badgeBinding: readBadge(latestByCategory),
    managementHealthState: readManagementHealth(latestByCategory),
    localAuthorityState: readLocalAuthority(latestByCategory),
  };

  return {
    ...partial,
    criticalSignalsPresent: deriveCriticalSignalsPresent(partial),
  };
}

/**
 * Critical evidence is present only when every critical input is known and not
 * degraded. Shared by evidence derivation and resolution simulation so a
 * simulated fix recomputes the same way a real signal would.
 */
export function deriveCriticalSignalsPresent(
  evidence: Omit<DecisionEvidence, "criticalSignalsPresent">,
): boolean {
  // NORMALIZE AT THE BOUNDARY, not just inside `buildEvidence` (review finding
  // F2, 2026-09-02). This function is EXPORTED and `resolution.ts` calls it on a
  // `DecisionEvidence` its caller supplied — a durable row cast with an unchecked
  // `as`, a JSON body, a connector's own vocabulary. The fields are typed, so
  // in-process the case cannot arise; across a process boundary it can, and the
  // failure was fail-OPEN in the quietest possible way: a freshness of
  // "totally-bogus" (or "", or 7, or "FRESH") equals none of the strings the two
  // ladders below reject, so it passed the backstop as though it were fresh.
  // `asFreshness` sends anything outside the union to "unknown" — the raising
  // answer, which both ladders disqualify.
  const postureFreshness = asFreshness(evidence.postureFreshness);
  const dockEvidenceFreshness = asFreshness(evidence.dockEvidenceFreshness);
  return (
    evidence.identityEnabled !== "unknown" &&
    evidence.deviceCompliance !== "unknown" &&
    evidence.deviceManaged !== "unknown" &&
    evidence.deviceEncrypted !== "unknown" &&
    // osSupported belongs here and was missing. The shipped v1 rules MASK the
    // gap — `healthy-allow` gates on osSupported: true, so an unknown one simply
    // fails to match and the step_up default applies — but createPolicyDraft
    // lets an owner activate any rule set validatePolicyRules accepts, and
    // nothing requires an allow rule to gate on this field. A version whose only
    // allow rule is {deviceManaged: true} would have allowed on unverifiable OS
    // support with the backstop none the wiser. The backstop is the layer that
    // is supposed to hold when the rules do not.
    evidence.osSupported !== "unknown" &&
    postureFreshness !== "missing" &&
    postureFreshness !== "unknown" &&
    // "expired" counted as PRESENT, which is the same unearned affirmative in a
    // different coat: a posture answer whose own freshness says it has lapsed is
    // not a posture answer. `posture-stale` catches it in v1; this makes it hold
    // when a custom rule set does not.
    postureFreshness !== "expired" &&
    // "stale" was MISSING from this ladder while the dock ladder eleven lines
    // below rejected it — the two disagreed about the same word, and posture is
    // the more load-bearing of the two. A stale posture answer passed the
    // backstop, so a custom rule set that does not itself gate on freshness
    // could allow on a compliance answer of unknown age. The shipped v1
    // `posture-stale` rule masks it, which is exactly why it survived: the
    // backstop is the layer that holds when the rules do NOT, and it was not
    // holding. Verified before and after against the real function.
    postureFreshness !== "stale" &&
    // Dock evidence that EXISTS but is stale, expired, or unreadable is not
    // evidence. "missing" is deliberately absent from this list: no dock at all
    // is a deployment shape, not a degraded signal, and treating the two alike
    // would step up every tenant without dock hardware.
    dockEvidenceFreshness !== "stale" &&
    dockEvidenceFreshness !== "expired" &&
    dockEvidenceFreshness !== "unknown"
  );
}

/**
 * The EXACT set of fields the snapshot digest covers, in one place.
 *
 * WHY THIS EXISTS. `buildSnapshot` and `verifySnapshot` each hand-wrote the same
 * eight-key literal. Two hand-maintained copies of a definition that must agree is
 * the shape this repository keeps finding defects in — and here the failure would
 * have been maximally quiet: add a field to the minting body and forget the
 * verifying one, and every freshly-minted snapshot verifies FALSE, which the
 * operator console renders as "tampered". Drop a field from the verifying body only,
 * and tampering in that field stops being detected at all. One function, two callers,
 * no way to disagree.
 *
 * The parameter is typed as the snapshot's own field set so a future field added to
 * `EvidenceSnapshot` cannot silently miss the digest: it must be added here, or it is
 * deliberately outside the tamper-evidence and that is a visible decision.
 */
type SnapshotDigestFields = Pick<
  EvidenceSnapshot,
  | "tenantId"
  | "decisionId"
  | "capturedAt"
  | "evidence"
  | "signalsUsed"
  | "policyVersionId"
  | "policyVersion"
  | "sourceReferences"
> & Pick<EvidenceSnapshot, "coreNormalizationVersion">;

function snapshotDigestBody(fields: SnapshotDigestFields): string {
  return canonicalJson({
    tenantId: fields.tenantId,
    decisionId: fields.decisionId,
    capturedAt: fields.capturedAt,
    evidence: fields.evidence,
    signalsUsed: fields.signalsUsed,
    policyVersionId: fields.policyVersionId,
    policyVersion: fields.policyVersion,
    sourceReferences: fields.sourceReferences,
    // CONDITIONAL, and this single spread is the entire migration story: an unstamped
    // snapshot's canonical body is byte-identical to the pre-stamp one, so durable rows
    // written before this field existed keep verifying `true` with no version-conditional
    // branch and no precondition anywhere. Both tamper directions still fail — delete the
    // key from a stamped row and it recomputes to the legacy body; add it to a legacy row
    // and it recomputes to a stamped body. Proven by the pinned legacy digest above.
    ...(fields.coreNormalizationVersion === undefined
      ? {}
      : { coreNormalizationVersion: fields.coreNormalizationVersion }),
  });
}

export function buildSnapshot(
  tenantId: string,
  decisionId: string,
  capturedAt: string,
  evidence: DecisionEvidence,
  signalsUsed: NormalizedSignal[],
  version: PolicyVersion,
): EvidenceSnapshot {
  const sourceReferences = [
    ...new Set(signalsUsed.map((signal) => signal.sourceReference)),
  ].sort();
  const id = deterministicId("evid", tenantId, decisionId);
  const fields: SnapshotDigestFields = {
    tenantId,
    decisionId,
    capturedAt,
    evidence,
    signalsUsed,
    policyVersionId: version.id,
    policyVersion: version.version,
    sourceReferences,
    coreNormalizationVersion: CORE_NORMALIZATION_VERSION,
  };
  return {
    id,
    ...fields,
    digest: digest(snapshotDigestBody(fields)),
  };
}

/** Recompute a snapshot digest to confirm it has not been altered. */
export function verifySnapshot(snapshot: EvidenceSnapshot): boolean {
  return digest(snapshotDigestBody(snapshot)) === snapshot.digest;
}

/**
 * One category's current reading, split by whether its `observedAt` could be
 * placed on a timeline at all.
 *
 * `illegible` is a reading that EXISTS but that nothing can order — neither
 * absence nor a trustworthy answer, and the three states must not be collapsed
 * into two (see `groupLatest` and `resolveWorst`). Both halves are kept, because
 * an illegible reading's VALUE still counts even when a parseable sibling is
 * present: it cannot win on time, but it can win on badness.
 *
 * ALL illegible readings are kept, not the first one (2026-09-02, verdict-core
 * finding F-1). Keeping only the first made ARRAY ORDER decide the answer among
 * illegible peers, and it decided it in the fail-open direction: measured through
 * `buildEvidence` → `evaluatePolicy(SHARED_DEVICE_RULES_V1)`, a legible
 * `tamper_state: "none"` plus an illegible `"confirmed"` denied, and ADDING a
 * second illegible `"none"` ahead of it allowed. Adding a signal must never buy
 * leniency. Nothing can order these readings by time, so none of them may be
 * dropped for another; every reader folds the whole list worst-wins, which is
 * order-independent by construction.
 */
interface CategoryReading {
  /** Latest reading whose `observedAt` parsed, if any. */
  ordered?: NormalizedSignal;
  /**
   * Every OTHER reading stamped at exactly the same instant as `ordered`, in
   * arrival order (2026-09-05, eighth-round finding). Two readings of one
   * category at one instant have an equal claim to be current, so neither may
   * be dropped for the other; the readers fold them worst-wins, like `illegible`
   * but WITHOUT the "unknown" floor — a tied reading is legible and can vouch
   * for its own currency, it just cannot outrank its twin on time.
   */
  tied: NormalizedSignal[];
  /** EVERY reading whose `observedAt` did not parse, in arrival order. */
  illegible: NormalizedSignal[];
}

type LatestByCategory = Map<NormalizedSignal["category"], CategoryReading>;

/**
 * One pass over the signals, keeping the latest (max observedAt) entry per
 * category.
 *
 * AN EXACT TIE KEEPS BOTH (2026-09-05, eighth-round verdict-core finding). The
 * previous rule — "on an observedAt tie the first entry in the original order
 * wins" — was ARRAY ORDER deciding the answer, the same defect finding F-1
 * removed for illegible peers, and it decided in the fail-open direction: two
 * `device_compliance` readings at one instant, `compliant` first and
 * `non_compliant` second, derived `compliant`; swap them and the same evidence
 * derived `non_compliant`. Measured on `buildEvidence` before the change. A
 * category cannot be both at once, and nothing can order two readings at one
 * instant by time, so the second is kept in `tied` and every reader folds it
 * worst-wins — order-independent by construction. A strictly newer reading
 * still replaces `ordered` AND clears `tied`: the tie was at the old instant.
 *
 * "Latest" is by PARSED INSTANT (2026-09-02, verdict-core finding V8b), not by
 * string order. The previous `observedAt.localeCompare(...)` was chronological
 * only for a uniformly-formatted UTC-Z corpus, and two shapes broke it in the
 * dangerous direction, both reproduced against this function before the change:
 *   - an offset timestamp — "2026-07-13T09:00:00+02:00" is 07:00Z, EARLIER than
 *     "2026-07-13T08:00:00.000Z", but sorts later as text, so a stale reading
 *     overwrote a newer one;
 *   - an unparseable one — "not-a-date" sorts above every "2026-…" string, so a
 *     malformed emission became the authoritative reading for its category.
 *
 * AN UNORDERABLE TIMESTAMP NEVER ERASES A READING (V8b, corrected 2026-09-02
 * after review finding F1). The first cut of this function `continue`d past an
 * unparseable `observedAt` entirely, which deleted the reading from the map —
 * and for the dock family that was fail-OPEN, because `readDockEvidenceFreshness`
 * returns "missing" for an absent category and "missing" is the one freshness
 * `deriveCriticalSignalsPresent` deliberately does NOT disqualify. Measured on
 * the real function: a dock reading of `freshness: "stale"` with
 * `observedAt: "not-a-date"` moved the decision from STEP_UP to ALLOW. A bad
 * clock stamp is not a missing dock.
 *
 * So: an unparseable reading can never WIN as latest (a parseable sibling always
 * outranks it, whatever the array order), but it is never discarded either —
 * both halves are kept and every reader resolves them WORST-WINS, in both
 * directions. See `resolveWorst` for the value rule and `readDockEvidenceFreshness`
 * for the freshness one; they are the same rule applied to two kinds of member.
 */
function groupLatest(signals: NormalizedSignal[]): LatestByCategory {
  const map: LatestByCategory = new Map();
  const at = new Map<NormalizedSignal["category"], number>();
  for (const signal of signals) {
    let reading = map.get(signal.category);
    if (!reading) {
      reading = { tied: [], illegible: [] };
      map.set(signal.category, reading);
    }
    const observed = Date.parse(signal.observedAt);
    if (Number.isNaN(observed)) {
      // Present, but unorderable. Kept ALONGSIDE any parseable sibling rather
      // than instead of it — and ALONGSIDE its illegible peers, all of them.
      // Nothing can order these by time, so no tie-break among them is
      // defensible; the readers fold the whole list worst-wins instead, and
      // worst-wins does not care what order they arrived in (finding F-1).
      reading.illegible.push(signal);
      continue;
    }
    const currentAt = at.get(signal.category);
    if (currentAt === undefined || observed > currentAt) {
      reading.ordered = signal;
      reading.tied = [];
      at.set(signal.category, observed);
    } else if (observed === currentAt) {
      // Same instant, equal claim. Kept, never dropped; folded worst-wins by
      // every reader, so arrival order cannot pick the answer.
      reading.tied.push(signal);
    }
  }
  return map;
}

/**
 * THE VALUE RULE, and it is the freshness rule applied to values (2026-09-02,
 * second-review finding F-A). The first cut of this file answered "unknown" for
 * every present-but-illegible reading, which is correct for a GOOD value and
 * catastrophic for a BAD one: a `tamper_state: "confirmed"` whose clock stamp
 * would not parse turned a DENY into a step-up, and the same for a forced badge,
 * a non-compliant device and an unmanaged one — the corruption BOUGHT leniency,
 * which is the exact direction fail-closed forbids. Measured on the real
 * `buildEvidence` → `evaluatePolicy(SHARED_DEVICE_RULES_V1)` before and after.
 *
 * So an illegible reading's VALUE is read; only its claim to be CURRENT and its
 * claim to be GOOD are discounted:
 *
 *  - SOLE illegible reading: its value stands, EXCEPT when it is the family's
 *    affirmative-good member (compliant / true / "none" / "healthy" / …), which
 *    is downgraded to the same "no answer" silence yields. A reading nothing can
 *    place in time may accuse; it may not vouch.
 *  - MIXED readings: the parseable ones are ordered by time as usual and the
 *    latest of them is the answer — an illegible reading NEVER wins as latest —
 *    but if an illegible reading's value is WORSE than that answer, the worse
 *    value wins. Worst-wins in both directions, exactly as freshness resolves.
 *  - SEVERAL illegible readings: EVERY one of them is folded, so the worst value
 *    among them wins (finding F-1). Keeping only the first let a good peer
 *    arriving ahead of an accusing one erase the accusation.
 *
 * Severity has three levels and nothing finer, because nothing finer is
 * defensible without a policy: affirmative-good (0) < no answer (1) < anything
 * else the family can say (2). "Anything else" is the accusing half of every
 * family here, so a bad value is never traded down to silence.
 */
function severityOf<T extends string | boolean>(
  value: T | undefined,
  good: readonly T[],
): number {
  if (value === undefined) return 1;
  return good.includes(value) ? 0 : 2;
}

function resolveWorst<T extends string | boolean>(
  reading: CategoryReading | undefined,
  parse: (value: NormalizedSignal["value"]) => T | undefined,
  good: readonly T[],
): T | undefined {
  if (!reading) {
    return undefined;
  }
  let ordered = reading.ordered ? parse(reading.ordered.value) : undefined;
  // A same-instant twin has the same claim to be current as `ordered`, so it is
  // folded worst-wins with NO floor: a good twin changes nothing, a bad one
  // stands (eighth-round finding — array order used to pick the winner).
  for (const signal of reading.tied) {
    const candidate = parse(signal.value);
    if (severityOf(candidate, good) > severityOf(ordered, good)) {
      ordered = candidate;
    }
  }
  if (reading.illegible.length === 0) {
    return ordered;
  }
  // With no parseable sibling the floor is `undefined` — "no answer" — so a
  // good value is downgraded to it and a bad value beats it and stands. Every
  // illegible peer is folded against that floor, worst-wins: a strictly worse
  // value replaces it, an equal or better one leaves it alone, so the result
  // does not depend on the order the peers arrived in (finding F-1).
  let worst = ordered;
  for (const signal of reading.illegible) {
    const candidate = parse(signal.value);
    if (severityOf(candidate, good) > severityOf(worst, good)) {
      worst = candidate;
    }
  }
  return worst;
}

/**
 * Every value domain an evidence reader can produce: the members a SIGNAL can
 * express, and the affirmative-good member(s) an illegible reading is not
 * allowed to assert on its own.
 *
 * Exported because sweeps must probe the whole space and a hand-listed probe set
 * fossilises: `[true, false, "unknown", ...FRESHNESS_VALUES]` missed every
 * disqualifying member outside it (`ownerType: "personal"`, `tamperState:
 * "confirmed"`, `badgeBinding: "forced"` all planted, all undetected). The
 * readers below consume this object, so a family added here is swept without
 * anyone editing a proof, and a family added WITHOUT a domain does not compile.
 */
const COMPLIANCE_STATES = ["compliant", "non_compliant"] as const;
const BOOLEAN_MEMBERS = [true, false] as const;

function readCompliance(latestByCategory: LatestByCategory): ComplianceState {
  return (
    resolveWorst(
      latestByCategory.get("device_compliance"),
      (value) =>
        typeof value === "string" && (COMPLIANCE_STATES as readonly string[]).includes(value)
          ? (value as (typeof COMPLIANCE_STATES)[number])
          : undefined,
      EVIDENCE_VALUE_DOMAINS.compliance.good,
    ) ?? "unknown"
  );
}

/**
 * Fold the identity row's state together with the connector's `identity_state`
 * signal, worst-wins.
 *
 * The direction is the whole point, and it is deliberately asymmetric:
 *
 * - An affirmative `false` from EITHER source wins. A revoked account must not
 *   be allowed because the other source had not caught up yet.
 * - SILENCE NEVER LOOSENS AND NEVER TIGHTENS. An absent signal leaves the row's
 *   verdict alone, so a fixture with no identity connector behaves exactly as it
 *   did before this fold existed. Equally, an absent signal can never promote an
 *   `"unknown"` row to `true` — an unknown stays unknown, which `policy.ts`
 *   already steps up on.
 *
 * The remaining case — row `true`, signal `true` or `"unknown"` — is `true`.
 */
export function foldIdentityEnabled(
  fromRow: boolean | "unknown",
  fromSignal: boolean | "unknown",
): boolean | "unknown" {
  if (fromRow === false || fromSignal === false) {
    return false;
  }
  if (fromRow === "unknown") {
    return "unknown";
  }
  return true;
}

function readBoolean(
  latestByCategory: LatestByCategory,
  category: NormalizedSignal["category"],
): boolean | "unknown" {
  return (
    resolveWorst(
      latestByCategory.get(category),
      (value) => (typeof value === "boolean" ? value : undefined),
      EVIDENCE_VALUE_DOMAINS.boolean.good,
    ) ?? "unknown"
  );
}

const CUSTODY_STATES = [
  "checked_in",
  "checked_out",
  "overdue",
  "exception",
  "maintenance",
] as const;
const CHARGE_STATES = ["charging", "charged", "low", "critical", "not_present"] as const;
const TAMPER_STATES = ["none", "suspected", "confirmed", "sensor_unavailable"] as const;
const DOCK_STATES = ["occupied", "empty", "reserved", "faulted", "offline"] as const;
const BATTERY_HEALTH_STATES = ["healthy", "degraded", "failing"] as const;
const BASELINE_STATES = ["aligned", "partial", "drifted", "not_assessed"] as const;
// Only the two AFFIRMATIVE values are readable from a signal. Absent or
// unrecognized falls back to "unverified" — the same silence-is-not-an-answer
// rule as every other read here, and the value the active v1 rule deliberately
// does not match.
const BENCHMARK_SELECTION_STATES = ["confirmed", "misfit"] as const;
// Same rule for the labor plane: only the two AFFIRMATIVE values are readable;
// absent or unrecognized falls back to "unverified", which the active v1 rule
// deliberately does not match.
const SHIFT_CONTEXT_STATES = ["confirmed", "misfit"] as const;
const BADGE_STATES = ["present", "removed", "forced", "absent"] as const;
// Rollup of the device-management-health family. All three values are readable —
// the family computes them from enrollment, check-in freshness and policy drift —
// but SILENCE reads as "unknown", never as a healthy management plane.
const MANAGEMENT_HEALTH_STATES = ["healthy", "degraded", "broken"] as const;
// Only the two AFFIRMATIVE values are readable for local authority; absent or
// unrecognized falls back to "unverified" — the same day-one-quiet rule as
// benchmark_selection and shift_context, so nothing fires until a connector
// actually emits the signal.
const LOCAL_AUTHORITY_STATES = ["verified", "withheld"] as const;

/** The dock-family categories whose age the dock connector stamps. */
const DOCK_CATEGORIES = [
  "custody_state",
  "charge_state",
  "battery_health",
  "tamper_state",
  "dock_state",
  "badge_binding",
] as const;

/** Worst-wins, because one stale channel is enough to make the reading unreliable. */
// Exported so proofs can sweep EVERY freshness value instead of hand-listing a
// few. The asymmetry fixed above survived because the core proof enumerated all
// five values for the dock ladder and hand-wrote a single "expired" case for
// posture — 221 green assertions, and the one value that mattered was the one
// nobody wrote down. A `Record<Freshness, …>` is exhaustive by construction: add
// a member to the union and this object fails to compile until it is handled, so
// a list derived from its keys cannot fossilise the way a literal array does.
const FRESHNESS_SEVERITY: Record<Freshness, number> = {
  fresh: 0,
  missing: 1,
  unknown: 2,
  stale: 3,
  expired: 4,
};

/** Every member of the `Freshness` union, derived from the exhaustive severity
 *  map above rather than written out again. Use this in any sweep that must
 *  cover the whole union. */
export const FRESHNESS_VALUES = Object.keys(FRESHNESS_SEVERITY) as readonly Freshness[];

/**
 * EVERY VALUE DOMAIN an evidence reader can produce: the members a signal can
 * express for that family, and the AFFIRMATIVE-GOOD member(s) — the ones that
 * assert the family is healthy, and therefore the ones an illegible reading is
 * not allowed to assert on its own (`resolveWorst`).
 *
 * GOOD is a judgement and is stated as one: it is the member(s) that vouch, not
 * the member(s) no rule happens to punish. Everything else in a family — every
 * accusing member, and every member a rule set might one day punish — is kept as
 * read, so this classification can only ever RAISE assurance, never lower it.
 *
 * EXPORTED because a sweep must probe the whole space and a hand-listed probe set
 * fossilises. The core proof's probe set was `[true, false, "unknown",
 * ...FRESHNESS_VALUES]`, which contains none of `"personal"`, `"confirmed"` or
 * `"forced"` — so three planted defects in `deriveCriticalSignalsPresent` passed
 * 322/322 assertions (second-review finding F-C, 2026-09-02). The readers below
 * consume this object, so a family added here is swept without anyone editing a
 * proof, and each reader's declared return type rejects a `good` member that is
 * not in that family's union.
 */
export const EVIDENCE_VALUE_DOMAINS = {
  compliance: { members: COMPLIANCE_STATES, good: ["compliant"] },
  boolean: { members: BOOLEAN_MEMBERS, good: [true] },
  freshness: { members: FRESHNESS_VALUES, good: ["fresh"] },
  custody: { members: CUSTODY_STATES, good: ["checked_in", "checked_out"] },
  charge: { members: CHARGE_STATES, good: ["charging", "charged"] },
  batteryHealth: { members: BATTERY_HEALTH_STATES, good: ["healthy"] },
  tamper: { members: TAMPER_STATES, good: ["none"] },
  dock: { members: DOCK_STATES, good: ["occupied", "empty", "reserved"] },
  baseline: { members: BASELINE_STATES, good: ["aligned"] },
  benchmarkSelection: { members: BENCHMARK_SELECTION_STATES, good: ["confirmed"] },
  shiftContext: { members: SHIFT_CONTEXT_STATES, good: ["confirmed"] },
  badge: { members: BADGE_STATES, good: ["present"] },
  managementHealth: { members: MANAGEMENT_HEALTH_STATES, good: ["healthy"] },
  localAuthority: { members: LOCAL_AUTHORITY_STATES, good: ["verified"] },
} as const;

/**
 * Every member of every domain above, de-duplicated and in declaration order:
 * the probe set a sweep over `DecisionEvidence` fields should use. DERIVED from
 * the object the readers themselves consume, so it cannot drift from what the
 * evidence layer can actually say. Note the two members no SIGNAL can express
 * but the FIELDS can — the silence defaults `"unknown"` and `"unverified"` — are
 * appended here, because a sweep of a field's value space must include them.
 */
export const EVIDENCE_VALUE_MEMBERS: readonly (string | boolean)[] = (() => {
  const seen: (string | boolean)[] = [];
  for (const domain of Object.values(EVIDENCE_VALUE_DOMAINS)) {
    for (const member of domain.members as readonly (string | boolean)[]) {
      if (!seen.includes(member)) seen.push(member);
    }
  }
  // The two subject-derived fields are not read from a signal and so have no
  // domain above, but a sweep over DecisionEvidence must still probe them —
  // `ownerType` is exactly where finding F-C's undetected plant lived.
  for (const member of [...OWNER_TYPES, ...RISK_TIERS] as readonly string[]) {
    if (!seen.includes(member)) seen.push(member);
  }
  // The silence defaults no SIGNAL can express but every FIELD can.
  for (const silence of ["unknown", "unverified"]) {
    if (!seen.includes(silence)) seen.push(silence);
  }
  return seen;
})();

/**
 * The worst freshness across dock signals THAT EXIST. Absent dock evidence
 * stays "missing" — a deployment with no dock is not a degraded deployment, and
 * making it one would step up every such tenant on day one.
 *
 * ABSENCE AND ILLEGIBILITY ARE DIFFERENT ANSWERS HERE, and this function is the
 * one place in the file where the difference is safety-critical: "missing" is the
 * single freshness `deriveCriticalSignalsPresent` does not disqualify, so any
 * reading that quietly resolved to "missing" would raise assurance instead of
 * lowering it. A dock reading whose `observedAt` cannot be ordered is therefore
 * never better than "unknown", and never better than what it stamps about itself
 * — worst-wins, in both directions at once.
 */
function readDockEvidenceFreshness(latestByCategory: LatestByCategory): Freshness {
  let worst: Freshness | undefined;
  for (const category of DOCK_CATEGORIES) {
    const reading = latestByCategory.get(category);
    if (!reading) continue;
    // Same shape as the value rule in `resolveWorst`: the parseable reading's own
    // stamp is the answer, an illegible one can only make it worse, and an
    // illegible one ALONE is floored at "unknown" because it cannot vouch for
    // its own currency.
    let freshness = reading.ordered ? asFreshness(reading.ordered.freshness) : undefined;
    // A same-instant twin folds worst-wins with no floor (eighth-round finding).
    for (const signal of reading.tied) {
      freshness = worseFreshness(freshness ?? "fresh", asFreshness(signal.freshness));
    }
    // EVERY illegible peer is folded, not the first (finding F-1).
    for (const signal of reading.illegible) {
      const stamped = asFreshness(signal.freshness);
      freshness =
        freshness === undefined
          ? worseFreshness(stamped, "unknown")
          : worseFreshness(freshness, stamped);
    }
    if (freshness === undefined) continue;
    if (worst === undefined || FRESHNESS_SEVERITY[freshness] > FRESHNESS_SEVERITY[worst]) {
      worst = freshness;
    }
  }
  return worst ?? "missing";
}

/** Worst-wins between two freshness values, by the severity map above. */
function worseFreshness(a: Freshness, b: Freshness): Freshness {
  return FRESHNESS_SEVERITY[a] >= FRESHNESS_SEVERITY[b] ? a : b;
}

/**
 * A freshness value the union does not contain resolves to "unknown" — the
 * RAISING answer — never to itself (2026-09-02, verdict-core finding V8a).
 *
 * The field is typed, so in-process this was unreachable; across a process
 * boundary (a durable row, a JSON body, a connector normalizer that emits a
 * vendor's own word) it was not, and the failure was silent and fail-OPEN:
 * `FRESHNESS_SEVERITY["totally-bogus"]` is `undefined`, `undefined > n` is
 * false, so the bogus string stuck as `worst`, and because it then equalled
 * none of the "stale"/"expired"/"unknown" strings that
 * `deriveCriticalSignalsPresent` rejects, a dock reading of an unrecognised
 * freshness passed the backstop and reached ALLOW. Reproduced before the fix.
 */
function asFreshness(value: unknown): Freshness {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(FRESHNESS_SEVERITY, value)
    ? (value as Freshness)
    : "unknown";
}

function readCustody(latestByCategory: LatestByCategory): CustodyState {
  return readEnum(latestByCategory, "custody_state", EVIDENCE_VALUE_DOMAINS.custody) ?? "unknown";
}

function readBaseline(latestByCategory: LatestByCategory): BaselineState {
  return readEnum(latestByCategory, "security_baseline", EVIDENCE_VALUE_DOMAINS.baseline) ?? "unknown";
}

function readBenchmarkSelection(latestByCategory: LatestByCategory): BenchmarkSelectionState {
  return readEnum(latestByCategory, "benchmark_selection", EVIDENCE_VALUE_DOMAINS.benchmarkSelection) ?? "unverified";
}

function readShiftContext(latestByCategory: LatestByCategory): ShiftContextState {
  return readEnum(latestByCategory, "shift_context", EVIDENCE_VALUE_DOMAINS.shiftContext) ?? "unverified";
}

function readBadge(latestByCategory: LatestByCategory): BadgeBindingState {
  return readEnum(latestByCategory, "badge_binding", EVIDENCE_VALUE_DOMAINS.badge) ?? "unknown";
}

function readManagementHealth(latestByCategory: LatestByCategory): ManagementHealthState {
  return readEnum(latestByCategory, "device_management_health", EVIDENCE_VALUE_DOMAINS.managementHealth) ?? "unknown";
}

function readLocalAuthority(latestByCategory: LatestByCategory): LocalAuthorityGrantState {
  return readEnum(latestByCategory, "local_authority", EVIDENCE_VALUE_DOMAINS.localAuthority) ?? "unverified";
}

function readCharge(latestByCategory: LatestByCategory): ChargeState {
  return readEnum(latestByCategory, "charge_state", EVIDENCE_VALUE_DOMAINS.charge) ?? "unknown";
}

function readBatteryHealth(latestByCategory: LatestByCategory): BatteryHealthState {
  return readEnum(latestByCategory, "battery_health", EVIDENCE_VALUE_DOMAINS.batteryHealth) ?? "unknown";
}

function readTamper(latestByCategory: LatestByCategory): TamperState {
  return readEnum(latestByCategory, "tamper_state", EVIDENCE_VALUE_DOMAINS.tamper) ?? "unknown";
}

function readDock(latestByCategory: LatestByCategory): DockState {
  return readEnum(latestByCategory, "dock_state", EVIDENCE_VALUE_DOMAINS.dock) ?? "unknown";
}

function readEnum<T extends string>(
  latestByCategory: LatestByCategory,
  category: NormalizedSignal["category"],
  domain: { readonly members: readonly T[]; readonly good: readonly T[] },
): T | undefined {
  return resolveWorst(
    latestByCategory.get(category),
    (value) =>
      typeof value === "string" && (domain.members as readonly string[]).includes(value)
        ? (value as T)
        : undefined,
    domain.good,
  );
}

/**
 * The posture answer's own freshness, and it must tell three states apart, not
 * two: NO posture answer at all is "missing"; an answer that exists but whose
 * `observedAt` nothing can order is present-but-illegible; an orderable answer is
 * whatever it says.
 *
 * The illegible case resolves WORST-WINS against the value rule in
 * `resolveWorst`, on the freshness severity ladder rather than the three-level
 * one: a sole illegible reading is floored at "unknown", so an illegible "fresh"
 * reads "unknown" (it may not vouch) while an illegible "stale" or "expired"
 * stays what it says (it may still accuse). Mixed with a parseable sibling, the
 * parseable one is the answer unless the illegible one is worse.
 */
function readFreshness(latestByCategory: LatestByCategory): Freshness {
  const reading = latestByCategory.get("posture_freshness");
  if (!reading) {
    return "missing";
  }
  // The posture reading states its freshness in its VALUE, not in the `freshness`
  // field, but the out-of-union rule is the same one `asFreshness` applies.
  let ordered = reading.ordered ? asFreshness(reading.ordered.value) : undefined;
  // A same-instant twin folds worst-wins with no floor (eighth-round finding).
  for (const signal of reading.tied) {
    ordered = worseFreshness(ordered ?? "fresh", asFreshness(signal.value));
  }
  if (reading.illegible.length === 0) {
    return ordered ?? "unknown";
  }
  // Worst-wins across ALL the illegible peers, not just the first (finding F-1).
  let worst = ordered ?? "unknown";
  for (const signal of reading.illegible) {
    worst = worseFreshness(worst, asFreshness(signal.value));
  }
  return worst;
}
