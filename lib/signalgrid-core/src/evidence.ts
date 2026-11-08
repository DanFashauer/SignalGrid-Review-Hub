import { CORE_NORMALIZATION_VERSION } from "./core-normalization-version";
import {
  DIGEST_ALG,
  canonicalJson,
  classifyFreshness,
  deterministicId,
  digest,
  FRESH_WINDOW_HOURS,
  parseObservedInstant,
  PRE_STRICT_HOST_OFFSETS_MINUTES,
  preStrictInstantAt,
  preStrictOffsetSteps,
  preStrictReading,
  preStrictStamp,
  STALE_WINDOW_HOURS,
  type PreStrictStamp,
} from "./util";
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
  PreStrictReadings,
  RetainedAccusations,
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
  // The decision instant (DR-059). When given, posture freshness is re-derived
  // from each reading's observedAt against it and folded worst-wins with the
  // value the sync stamped — so a posture read fresh at sync and never refreshed
  // ages into stale and expired instead of staying fresh forever. Absent (older
  // callers, proofs of the stamped path) the stamped value stands, as before.
  nowIso?: string,
): DecisionEvidence {
  // Group the signals into the single latest-per-category entry in one pass,
  // instead of filtering+sorting the whole array once per category (this was 9
  // filter+sort passes per decision). For each category we keep the entry with
  // the greatest PARSED observedAt, and on a tie the first in the original order.
  // That is no longer byte-identical to the original filter+sort: it ordered by
  // STRING, which two timestamp shapes broke in the fail-open direction — see
  // `groupLatest` for both, measured.
  const latestByCategory = groupLatest(signals);
  const identityEnabledFromRow = identityRowState(identity);
  const evidence = readEvidence(latestByCategory, identityEnabledFromRow, device, workflow, nowIso);
  // Owner decision (a), 2026-11-06: keep every accusation the core could not order. Added only when there is
  // one, so an unambiguous snapshot is byte-identical to before.
  const retained = retainAccusations(latestByCategory, evidence, nowIso, identityEnabledFromRow);
  // Round 5 (2026-11-07): the answer the PRE-STRICT reader gave, kept beside the strict one so the policy can never
  // come out milder than it (see `readPreStrict`). Added only when it can differ, so an unambiguous snapshot is
  // byte-identical to before.
  const preStrict = readPreStrict(signals, identityEnabledFromRow, device, workflow, nowIso, evidence, retained !== undefined);
  return {
    ...evidence,
    ...(retained === undefined ? {} : { retainedAccusations: retained }),
    ...(preStrict === undefined ? {} : { preStrictReadings: preStrict }),
  };
}

/** What the resolved identity row says about the account, before the `identity_state` signal is folded in. */
function identityRowState(identity: Identity): boolean | "unknown" {
  return identity.state === "enabled" ? true : identity.state === "disabled" ? false : "unknown";
}

/**
 * The evidence the pre-strict reader produces when `instantOf` places every stamp: the grouping and the folds
 * `readPreStrict` uses for one modelled host. Exported for `proof:evidence-observedat-tz`, which passes the host's
 * OWN `Date.parse` (mainline's reader) in child processes under several zones and requires every verdict to be at
 * least as strict as the one this produces there.
 */
export function preStrictEvidenceWith(
  identity: Identity,
  device: Device,
  workflow: Workflow,
  signals: NormalizedSignal[],
  nowIso: string | undefined,
  instantOf: (observedAt: string) => number,
): DecisionEvidence {
  return readEvidence(groupLatest(signals, instantOf), identityRowState(identity), device, workflow, nowIso);
}

/**
 * Every evidence field, read from one grouping of the signals. `buildEvidence` runs it once with the strict reader
 * and `readPreStrict` once per modelled host with the pre-strict one; the grouping says which (`preStrict`).
 */
function readEvidence(
  latestByCategory: LatestByCategory,
  identityEnabledFromRow: boolean | "unknown",
  device: Device,
  workflow: Workflow,
  nowIso: string | undefined,
): DecisionEvidence {
  const compliance = readCompliance(latestByCategory);
  const managed = readBoolean(latestByCategory, "device_management");
  const encrypted = readBoolean(latestByCategory, "device_encryption");
  const osSupported = readBoolean(latestByCategory, "os_support");
  const postureFreshness = readFreshness(latestByCategory, nowIso);

  // Two sources can speak to whether the account is enabled: the resolved
  // identity row, and an `identity_state` signal from the identity connector.
  // Before this fold the signal was normalized, counted into `signalsUsed`, and
  // never read — so a connector reporting a DISABLED account still produced
  // `identityEnabled: true` and an allow, while the evidence snapshot recorded
  // the signal as an input to a decision it had not influenced.
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
    attachState: readPresentOrNotApplicable(latestByCategory, "attach_state", EVIDENCE_VALUE_DOMAINS.attach),
    enrollmentStrength: readPresentOrNotApplicable(latestByCategory, "enrollment_strength", EVIDENCE_VALUE_DOMAINS.enrollment),
    credentialReadMethod: readPresentOrNotApplicable(latestByCategory, "credential_read_method", EVIDENCE_VALUE_DOMAINS.readMethod),
  };

  return {
    ...partial,
    criticalSignalsPresent: deriveCriticalSignalsPresent(partial),
  };
}

/**
 * The families whose readers fold readings worst-wins, as [evidence field, category, domain key, FLOOR]. The floor is
 * what the reader answers when the category is PRESENT but nothing in it could be read (an out-of-domain value, or
 * only a good value that may not vouch): DR-065's "unreadable" for the dock family, DR-043's "unknown" for the
 * credential readers, and each family's own silence word otherwise.
 */
const RETAINED_ENUM_FAMILIES = [
  ["deviceCompliance", "device_compliance", "compliance", "unknown"],
  ["custodyState", "custody_state", "custody", "unreadable"],
  ["dockChargeState", "charge_state", "charge", "unreadable"],
  ["batteryHealth", "battery_health", "batteryHealth", "unreadable"],
  ["tamperState", "tamper_state", "tamper", "unreadable"],
  ["dockState", "dock_state", "dock", "unreadable"],
  ["baselineCompliance", "security_baseline", "baseline", "unknown"],
  ["benchmarkSelection", "benchmark_selection", "benchmarkSelection", "unverified"],
  ["shiftContext", "shift_context", "shiftContext", "unverified"],
  ["badgeBinding", "badge_binding", "badge", "unreadable"],
  ["managementHealthState", "device_management_health", "managementHealth", "unknown"],
  ["localAuthorityState", "local_authority", "localAuthority", "unverified"],
  ["attachState", "attach_state", "attach", "unknown"],
  ["enrollmentStrength", "enrollment_strength", "enrollment", "unknown"],
  ["credentialReadMethod", "credential_read_method", "readMethod", "unknown"],
  ["deviceManaged", "device_management", "boolean", "unknown"],
  ["deviceEncrypted", "device_encryption", "boolean", "unknown"],
  ["osSupported", "os_support", "boolean", "unknown"],
] as const satisfies readonly (readonly [keyof RetainedAccusations, NormalizedSignal["category"], keyof typeof EVIDENCE_VALUE_DOMAINS, string])[];

/**
 * OWNER DECISION (a), 2026-11-06 — KEEP BOTH (the Codex P1 on #1442/#1792 at the `worse` tiers), widened after the
 * independent and Codex reviews of 2026-11-07 so that NO value the pre-strict reader could have answered is lost.
 *
 * `resolveWorst` picks ONE value per family: the member the SHIPPED rules rank worst. This lists, per family, EVERY
 * value the reader saw among the readings it folds (the latest orderable one, its same-instant twins, and every
 * illegible one): each reading's stated value, GOOD values included (a tenant may punish what the shipped rules
 * call good, e.g. a legacy enrollment), and the family's FLOOR whenever a folded value is out of domain or a
 * reading is illegible (an illegible good value may not vouch, and the floor is what that leaves). Posture
 * freshness also keeps each orderable reading's aged value and, for an illegible reading, the age the pre-strict
 * reading gave it (an offset-less or date-only stamp read as UTC; future-dated ages to "unknown").
 *
 * Why this is never milder than the pre-strict reader on a UTC host: that reader's answer for a family is the value
 * of a reading it folded (its latest, a twin, or one it could not parse) or the family's floor, and every such
 * reading is folded here: its latest is this reader's latest orderable reading, a twin of it, or a reading this
 * reader cannot order. The one exception is the owner's decision (c): an exact `±HH` stamp it could not parse is
 * now ordered. `evaluatePolicy` judges every combination (or a bound above them) and keeps the strictest, so the
 * old combination is always covered. A family is listed only when it has two or more distinct values.
 */
function retainAccusations(
  latestByCategory: LatestByCategory,
  evidence: DecisionEvidence,
  nowIso: string | undefined,
  identityRow: boolean | "unknown",
): RetainedAccusations | undefined {
  const out: Record<string, readonly unknown[]> = {};
  for (const [field, category, domainKey, floor] of RETAINED_ENUM_FAMILIES) {
    const reading = latestByCategory.get(category);
    if (!reading) continue;
    const domain = EVIDENCE_VALUE_DOMAINS[domainKey] as { readonly members: readonly unknown[]; readonly good: readonly unknown[] };
    const values = new Set<unknown>([evidence[field]]);
    for (const signal of [reading.ordered, ...reading.tied].filter((x): x is NormalizedSignal => x !== undefined)) {
      values.add(domain.members.includes(signal.value) ? signal.value : floor);
    }
    for (const signal of reading.illegible) {
      if (domain.members.includes(signal.value)) values.add(signal.value);
      values.add(floor);
    }
    if (values.size >= 2) out[field] = sortValues([...values]);
  }
  // The identity flag folds the account row with the identity_state signal: its alternatives are the row folded
  // with each value that signal family could answer.
  const identityReading = latestByCategory.get("identity_state");
  if (identityReading) {
    const values = new Set<unknown>([evidence.identityEnabled]);
    const folded = [identityReading.ordered, ...identityReading.tied, ...identityReading.illegible].filter((x): x is NormalizedSignal => x !== undefined);
    for (const signal of folded) values.add(foldIdentityEnabled(identityRow, typeof signal.value === "boolean" ? signal.value : "unknown"));
    if (identityReading.illegible.length > 0) values.add(foldIdentityEnabled(identityRow, "unknown"));
    if (values.size >= 2) out.identityEnabled = sortValues([...values]);
  }
  // Posture freshness: each reading's STATED value; an orderable reading's AGED value; an illegible reading's age as
  // the pre-strict reading gave it, when it could (review F1 and Codex (d), 2026-11-07).
  const posture = latestByCategory.get("posture_freshness");
  if (posture) {
    const ageAt = (observedAtIso: string): Freshness =>
      nowIso === undefined ? "fresh" : classifyFreshness(observedAtIso, nowIso, FRESH_WINDOW_HOURS, STALE_WINDOW_HOURS);
    const values = new Set<Freshness>([evidence.postureFreshness]);
    for (const signal of [posture.ordered, ...posture.tied].filter((x): x is NormalizedSignal => x !== undefined)) {
      values.add(asFreshness(signal.value));
      values.add(ageAt(signal.observedAt));
    }
    for (const signal of posture.illegible) {
      // Its stated value, and every age the PRE-STRICT reader gave it on any modelled host, when that reader could
      // place it at all (round 5: the reader itself, not a re-implementation of it; `preStrictStamp`). A stamp
      // nothing could ever place keeps only its stated value, as before.
      values.add(asFreshness(signal.value));
      for (const age of preStrictAges(signal.observedAt, nowIso)) values.add(age);
    }
    if (values.size >= 2) out.postureFreshness = sortValues([...values]) as Freshness[];
  }
  return Object.keys(out).length === 0 ? undefined : (out as RetainedAccusations);
}

/** Every age the pre-strict reader gave a stamp, over the modelled hosts; none when it could not place the stamp. */
function preStrictAges(observedAt: string, nowIso: string | undefined): Freshness[] {
  const stampOf = preStrictStamp;
  const stamp = stampOf(observedAt);
  if (stamp.kind === "fixed" && Number.isNaN(stamp.at)) return [];
  if (nowIso === undefined) return ["fresh"];
  // A stamp the core does not place (`ambiguous`) could have been any age.
  if (stamp.kind === "ambiguous") return ["fresh", "stale", "expired", "unknown"];
  const offsets = stamp.kind === "floating" || stampOf(nowIso).kind === "floating" ? PRE_STRICT_HOST_OFFSETS_MINUTES : [0];
  const ages = new Set<Freshness>();
  for (const offset of offsets) {
    ages.add(classifyFreshness(observedAt, nowIso, FRESH_WINDOW_HOURS, STALE_WINDOW_HOURS, (iso) => preStrictInstantAt(stampOf(iso), offset)));
  }
  return [...ages];
}

/**
 * ROUND 5 (2026-11-07) — NEVER MILDER THAN THE PRE-STRICT READER, BY CONSTRUCTION.
 *
 * Four review rounds found inputs where the strict reader's verdict came out milder than mainline's, each one a
 * shape the previous fix had not listed: an offset-less stamp, a date-only one, an impossible calendar value, then
 * RFC 2822 text (whose `unknown` age vanished) and a recomputed backstop the retained worlds pinned to false. So
 * instead of predicting what the old reader would have said, this RUNS it: the signals are grouped again with the
 * pre-strict instant of every stamp (`Date.parse`, which is what mainline calls) and read with mainline's own folds
 * (no accusation tiers, the age ladder for posture), and the result is kept beside the strict evidence.
 * `evaluatePolicy` judges every kept reading with the active policy and returns the most restrictive outcome, so
 * the verdict is never milder than the pre-strict reader's on ANY modelled host, whatever the policy tests,
 * `criticalSignalsPresent` and `dockEvidenceFreshness` included (each reading carries its own, recomputed).
 *
 * Deterministic: `Date.parse` reads offset-less and zone-less text in the HOST's zone, at the offset that zone had
 * at that wall time, so the readings are taken for every host instead of this one (`preStrictCategoryReadings`):
 * each category's floating stamps are placed at a base offset on the whole-quarter-hour grid from −12:00 to +14:00
 * (`PRE_STRICT_HOST_OFFSETS_MINUTES`) up to some point in wall order and one zone step away from it after
 * (round 6, 2026-11-08: a daylight-saving switch or a zone change between two stamps of one decision; Codex P1 on
 * #1809, `preStrictOffsetSteps` says why that is every host). The posture category is placed together with an
 * offset-less evaluation clock. Every combination of the categories' readings is read (the categories are placed
 * independently, which can only add readings), and every distinct reading is kept: the answer is the most
 * restrictive across hosts, not this host's. Past `PRE_STRICT_PRODUCT_CAP` combinations, or `PRE_STRICT_UNIT_CAP`
 * floating stamps in one category, the readings are BOUNDED instead (each category's readings one at a time, every
 * dock-wide freshness; the policy then lets a rule count when each of its conditions holds in some reading). A
 * stamp `Date.parse` accepts in a shape the core cannot place (`ambiguous`) is not guessed at: every family
 * carrying one gets every value it could read, and the policy BOUNDS the outcome (`bounded`).
 *
 * Owner decision (c) stands: an exact ±HH stamp `Date.parse` rejects is read here as the strict reader reads it.
 * Kept only when it differs from the strict evidence, and computed only when a stamp is read differently by the
 * two readers or a family retained more than one value; otherwise the readers agree and nothing is added.
 */
function readPreStrict(
  signals: NormalizedSignal[],
  identityEnabledFromRow: boolean | "unknown",
  device: Device,
  workflow: Workflow,
  nowIso: string | undefined,
  evidence: DecisionEvidence,
  retained: boolean,
): PreStrictReadings | undefined {
  const stampOf = preStrictStamp;
  let disputed = false;
  let floating = false;
  const ambiguous = new Set<string>();
  const consider = (iso: string): PreStrictStamp["kind"] => {
    const { stamp, agrees } = preStrictReading(iso);
    if (stamp.kind === "floating") floating = true;
    if (!agrees) disputed = true;
    return stamp.kind;
  };
  for (const signal of signals) {
    if (consider(signal.observedAt) === "ambiguous") ambiguous.add(signal.category);
  }
  if (nowIso !== undefined && consider(nowIso) === "ambiguous") ambiguous.add("posture_freshness");
  if (!disputed && !retained) return undefined;

  const seen = new Set<string>([JSON.stringify(evidence)]);
  const worlds: Partial<PreStrictReadingFields>[] = [];
  const keep = (world: Partial<PreStrictReadingFields>): void => {
    if (Object.keys(world).length > 0) worlds.push(world);
  };
  const read = (grouping: LatestByCategory): void => {
    const reading = readEvidence(grouping, identityEnabledFromRow, device, workflow, nowIso);
    // `readEvidence` builds every reading with one key order, so its JSON is a key (the snapshot never sees it).
    const key = JSON.stringify(reading);
    if (seen.has(key)) return;
    seen.add(key);
    keep(differingFields(reading, evidence));
  };
  const atZero = (iso: string): number => preStrictInstantAt(stampOf(iso), 0);
  let bounded = false;
  if (!floating) {
    // No stamp depends on the host: one grouping.
    read(groupLatest(signals, atZero));
  } else {
    // Round 6: every reading each category can have on SOME host (`preStrictCategoryReadings`), combined.
    const { readings, overCap } = preStrictCategoryReadings(signals, nowIso);
    for (const category of overCap) ambiguous.add(category);
    const categories = [...readings.keys()];
    const assemble = (pick: (category: NormalizedSignal["category"]) => PreStrictCategoryReading): LatestByCategory => {
      const grouping: LatestByCategory = new Map();
      let instantOf: (iso: string) => number = atZero;
      for (const category of categories) {
        const option = pick(category);
        grouping.set(category, option.reading);
        if (option.instantOf !== undefined) instantOf = option.instantOf;
      }
      grouping.preStrict = { instantOf };
      return grouping;
    };
    let combinations = 1;
    for (const options of readings.values()) combinations = Math.min(combinations * options.length, PRE_STRICT_PRODUCT_CAP + 1);
    if (combinations <= PRE_STRICT_PRODUCT_CAP) {
      const choice = new Map<NormalizedSignal["category"], number>(categories.map((category) => [category, 0]));
      for (;;) {
        read(assemble((category) => readings.get(category)![choice.get(category)!]!));
        // Next combination (odometer over the categories, in first-seen order).
        let moved = false;
        for (const category of categories) {
          const next = choice.get(category)! + 1;
          if (next < readings.get(category)!.length) {
            choice.set(category, next);
            moved = true;
            break;
          }
          choice.set(category, 0);
        }
        if (!moved) break;
      }
    } else {
      // Too many combinations to read one by one: each category's readings one at a time over the first reading
      // of every other category, and every dock-wide freshness (the one field read from several categories; the
      // backstop is flipped by `evidenceWorlds`). The policy bounds the outcome over them.
      bounded = true;
      for (const varied of categories) {
        for (const option of readings.get(varied)!) {
          read(assemble((category) => (category === varied ? option : readings.get(category)![0]!)));
        }
      }
      for (const value of FRESHNESS_VALUES) {
        if (value !== evidence.dockEvidenceFreshness) keep({ dockEvidenceFreshness: value });
      }
    }
  }
  if (ambiguous.size > 0) {
    // Every value each family carrying an ambiguous stamp could read, one field at a time; the policy bounds the
    // outcome over them (a rule counts when each of its conditions holds in some reading).
    for (const [field, category, domainKey, floor] of RETAINED_ENUM_FAMILIES) {
      if (!ambiguous.has(category)) continue;
      const domain = EVIDENCE_VALUE_DOMAINS[domainKey] as { readonly members: readonly unknown[] };
      const values = new Set<unknown>([floor]);
      for (const signal of signals) {
        if (signal.category === category && domain.members.includes(signal.value)) values.add(signal.value);
      }
      for (const value of values) if (value !== evidence[field]) keep({ [field]: value } as Partial<PreStrictReadingFields>);
    }
    if (ambiguous.has("identity_state")) {
      for (const value of [true, false, "unknown"] as const) {
        const folded = foldIdentityEnabled(identityEnabledFromRow, value);
        if (folded !== evidence.identityEnabled) keep({ identityEnabled: folded });
      }
    }
    for (const value of FRESHNESS_VALUES) {
      if (ambiguous.has("posture_freshness") && value !== evidence.postureFreshness) keep({ postureFreshness: value });
      if (DOCK_CATEGORIES.some((category) => ambiguous.has(category)) && value !== evidence.dockEvidenceFreshness) {
        keep({ dockEvidenceFreshness: value });
      }
    }
    return { worlds, bounded: true };
  }
  if (bounded) return { worlds, bounded: true };
  return worlds.length === 0 ? undefined : { worlds };
}

/** Above this many floating stamps in one category's competing set, its readings are bounded, not enumerated. */
export const PRE_STRICT_UNIT_CAP = 6;
/** Above this many combinations of the categories' pre-strict readings, the readings are bounded, not enumerated. */
export const PRE_STRICT_PRODUCT_CAP = 1024;
/** Above this many (reading x placement) steps for one category, its readings are bounded, not enumerated. */
export const PRE_STRICT_WORK_CAP = 2_000_000;
/** Two floating stamps further apart than this never compete: no pair of host offsets reorders them. */
const COMPETE_WINDOW_MS = 26 * 60 * 60_000;

/** One category's reading on some host, and (posture only) how that host placed the stamps it ages. */
interface PreStrictCategoryReading {
  readonly reading: CategoryReading;
  readonly instantOf?: (observedAt: string) => number;
}

/**
 * ROUND 6 (2026-11-08) — EVERY READING EACH CATEGORY CAN HAVE ON SOME HOST, offsets varying stamp by stamp.
 *
 * Round 5 placed every floating stamp of a decision at ONE host offset. A real zone gives different offsets to
 * different wall times: Codex's repro on #1809 (America/New_York, 2026-03-08) read `01:30` at −05:00 and `03:30`
 * at −04:00, which selected the fresh reading in BOTH dock categories, a combination no single offset produced, and
 * a tenant rule on `criticalSignalsPresent=true` denied there while round 5 stepped up.
 *
 * A category's reading depends only on which of its stamps is latest (and ties it) and, for posture, how old those
 * are at the clock. So per category: its COMPETING floating stamps (within 26 hours of its latest floating wall
 * time; an older one is behind the latest on every host, whatever the two offsets) are placed at base offset `a`
 * up to a point in wall order and at `a + step` from there on, for every base offset on the grid, every point, and
 * every step `preStrictOffsetSteps` allows (that is every host, `util.ts` says why). Posture's competing stamps are
 * placed together with an offset-less evaluation clock, since their ages compare the two. Identical text is one
 * stamp (one wall time, one offset). The categories are placed independently of each other, which can only ADD
 * readings: whatever one host does to all of them at once is one choice per category.
 *
 * Bounded: a category with more than `PRE_STRICT_UNIT_CAP` competing floating stamps is not enumerated
 * (`overCap`); the caller gives that family every value it could read, as for an ambiguous stamp, and bounds.
 */
function preStrictCategoryReadings(
  signals: NormalizedSignal[],
  nowIso: string | undefined,
): { readings: Map<NormalizedSignal["category"], PreStrictCategoryReading[]>; overCap: Set<NormalizedSignal["category"]> } {
  const stampOf = preStrictStamp;
  const byCategory = new Map<NormalizedSignal["category"], NormalizedSignal[]>();
  for (const signal of signals) {
    const list = byCategory.get(signal.category);
    if (list) list.push(signal);
    else byCategory.set(signal.category, [signal]);
  }
  const clock = nowIso === undefined ? undefined : stampOf(nowIso);
  const lowest = PRE_STRICT_HOST_OFFSETS_MINUTES[0]!;
  const highest = PRE_STRICT_HOST_OFFSETS_MINUTES[PRE_STRICT_HOST_OFFSETS_MINUTES.length - 1]!;
  const readings = new Map<NormalizedSignal["category"], PreStrictCategoryReading[]>();
  const overCap = new Set<NormalizedSignal["category"]>();
  for (const [category, members] of byCategory) {
    const posture = category === "posture_freshness" && nowIso !== undefined;
    // Each member's stamp, once: a floating wall time (moves with the host), or a fixed instant (NaN: illegible).
    const count = members.length;
    const wall = new Array<number>(count);
    const fixedAt = new Array<number>(count);
    let latestWall = -Infinity;
    for (let i = 0; i < count; i++) {
      const stamp = stampOf(members[i]!.observedAt);
      wall[i] = stamp.kind === "floating" ? stamp.wall : Number.NaN;
      fixedAt[i] = stamp.kind === "floating" ? Number.NaN : preStrictInstantAt(stamp, 0);
      if (stamp.kind === "floating") latestWall = Math.max(latestWall, stamp.wall);
    }
    // The competing floating stamps (one entry per text), and the clock with posture when it floats too.
    const unitWalls = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      if (!Number.isNaN(wall[i]!) && wall[i]! >= latestWall - COMPETE_WINDOW_MS) unitWalls.set(members[i]!.observedAt, wall[i]!);
    }
    const clockFloats = posture && clock?.kind === "floating";
    if (clockFloats) unitWalls.set(nowIso!, (clock as { readonly wall: number }).wall);
    const unit = [...unitWalls].sort(([a, wa], [b, wb]) => (wa !== wb ? wa - wb : a < b ? -1 : a > b ? 1 : 0));
    const position = new Map<string, number>(unit.map(([text], i) => [text, i]));
    // A floating stamp outside the competing set never leads, at any offset: it is placed at the base offset.
    const at = members.map((signal) => position.get(signal.observedAt) ?? -1);
    const clockAt = clockFloats ? position.get(nowIso!)! : -1;
    const clockWall = clock?.kind === "floating" ? clock.wall : Number.NaN;
    const clockFixedAt = clock === undefined || clock.kind === "floating" ? Number.NaN : preStrictInstantAt(clock, 0);
    // Only these can lead on some host: the latest fixed reading(s), and the competing floating ones (every other
    // fixed reading is behind the latest one everywhere; every other floating one is behind the latest floating one).
    let latestFixed = -Infinity;
    for (let i = 0; i < count; i++) if (fixedAt[i]! > latestFixed) latestFixed = fixedAt[i]!;
    const candidates: number[] = [];
    for (let i = 0; i < count; i++) if (at[i]! >= 0 || fixedAt[i] === latestFixed) candidates.push(i);
    const steps = unit.length === 0 ? [] : preStrictOffsetSteps(unit[0]![1]);
    const placementCount = PRE_STRICT_HOST_OFFSETS_MINUTES.length * (1 + Math.max(0, unit.length - 1) * steps.length);
    if (unit.length > PRE_STRICT_UNIT_CAP || candidates.length * placementCount > PRE_STRICT_WORK_CAP) overCap.add(category);

    const options: PreStrictCategoryReading[] = [];
    const placements = new Set<number | string>();
    const contents = new Set<string>();
    const AGES: readonly Freshness[] = ["fresh", "stale", "expired", "unknown"];
    const tiedAt: number[] = [];
    // Hot loop (up to ~20k placements for one category): no closures, a numeric placement key.
    const place = (base: number, split: number, step: number): void => {
      let lead = -1;
      let leadAt = -Infinity;
      tiedAt.length = 0;
      for (const i of candidates) {
        const t = Number.isNaN(wall[i]!) ? fixedAt[i]! : wall[i]! - (at[i]! >= split ? base + step : base) * 60_000;
        if (lead < 0 || t > leadAt) {
          lead = i;
          leadAt = t;
          tiedAt.length = 0;
        } else if (t === leadAt) tiedAt.push(i);
      }
      // Posture: the selected readings share one instant, so one age at the clock (placed with them when it
      // floats). The same arithmetic as `classifyFreshness`.
      let age = 0;
      let clockInstant = Number.NaN;
      if (posture && lead >= 0) {
        clockInstant = clockFloats ? clockWall - (clockAt >= split ? base + step : base) * 60_000 : clockFixedAt;
        const hours = (clockInstant - leadAt) / (1000 * 60 * 60);
        age = Number.isNaN(clockInstant) || leadAt > clockInstant ? 3 : hours <= FRESH_WINDOW_HOURS ? 0 : hours <= STALE_WINDOW_HOURS ? 1 : 2;
      }
      let placement: number | string;
      if (count <= 24) {
        let mask = lead < 0 ? 0 : 2 ** lead;
        for (const i of tiedAt) mask += 2 ** i;
        placement = mask * 4 + age;
      } else placement = `${lead},${tiedAt.join(",")}:${age}`;
      if (placements.has(placement)) return;
      placements.add(placement);
      // Two placements that select readings with the same values, labels and age read the same (the readers look
      // at nothing else), so only the first is kept.
      const selected = lead < 0 ? [] : [lead, ...tiedAt];
      const content = `${selected.map((i) => `${typeof members[i]!.value}:${JSON.stringify(members[i]!.value)}|${String(members[i]!.freshness)}`).join(";")}:${posture ? AGES[age] : ""}`;
      if (contents.has(content)) return;
      contents.add(content);
      const reading: CategoryReading = {
        ...(lead < 0 ? {} : { ordered: members[lead]! }),
        tied: tiedAt.map((i) => members[i]!),
        illegible: members.filter((_, i) => Number.isNaN(wall[i]!) && Number.isNaN(fixedAt[i]!)),
      };
      if (!posture) {
        options.push({ reading });
        return;
      }
      const fixedClock = clockInstant;
      const placed = (iso: string): number => {
        if (iso === nowIso) return fixedClock;
        const stamp = stampOf(iso);
        if (stamp.kind !== "floating") return preStrictInstantAt(stamp, 0);
        const p = position.get(iso);
        return stamp.wall - (p !== undefined && p >= split ? base + step : base) * 60_000;
      };
      options.push({ reading, instantOf: placed });
    };
    // Offset 0 first: the reading the bounded fallback holds the other categories at.
    place(0, 0, 0);
    if (unit.length > 0 && !overCap.has(category)) {
      for (const base of PRE_STRICT_HOST_OFFSETS_MINUTES) {
        place(base, 0, 0);
        for (let split = 1; split < unit.length; split++) {
          for (const step of steps) {
            if (base + step >= lowest && base + step <= highest) place(base, split, step);
          }
        }
      }
    }
    readings.set(category, options);
  }
  return { readings, overCap };
}

/** The evidence fields a pre-strict reading may carry (the backstop is recomputed from them, never carried). */
type PreStrictReadingFields = Omit<DecisionEvidence, "criticalSignalsPresent" | "retainedAccusations" | "preStrictReadings">;

/** The fields of `reading` that differ from `evidence` (both single-valued; the backstop is left out). */
function differingFields(reading: DecisionEvidence, evidence: DecisionEvidence): Partial<PreStrictReadingFields> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(reading)) {
    if (key === "criticalSignalsPresent") continue;
    if (value !== (evidence as unknown as Record<string, unknown>)[key]) out[key] = value;
  }
  return out as Partial<PreStrictReadingFields>;
}

/** Deterministic order for a retained list: booleans before strings, then by code point (never by locale). */
function sortValues(values: unknown[]): unknown[] {
  const key = (v: unknown): string => `${typeof v}:${String(v)}`;
  return values.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Above this many combinations the worlds are not enumerated one by one (see `evidenceWorlds`). */
export const MAX_EVIDENCE_WORLDS = 4096;

/**
 * Every combination of the retained values (owner decision (a)), the evidence as built FIRST, then every kept
 * PRE-STRICT reading (round 5, `readPreStrict`). Each world is a single-valued `DecisionEvidence` the policy matcher
 * already understands, and each carries its OWN backstop, recomputed on that world: a tenant rule can match
 * `criticalSignalsPresent: true` as well as false, so pinning an alternate world's backstop to the base's failed
 * one (as rounds 2-4 did) hid a world the pre-strict reader produced (Codex P1, 2026-11-07). That pinned world is
 * still kept beside it wherever the two differ, so no world an earlier round judged is dropped. A malformed
 * `retainedAccusations` or `preStrictReadings` (a durable row, a JSON body) can only ADD worlds, and the policy
 * keeps the most restrictive outcome, so it can never loosen the base answer.
 *
 * Past `MAX_EVIDENCE_WORLDS` combinations the product is NOT enumerated (`truncated`), and neither is a reading
 * set marked `bounded`. The worlds returned are then the base, one world per (family, value) with only that family
 * changed, every pre-strict reading, and the base with its backstop flipped. `evaluatePolicy` bounds the strictest
 * combination instead of taking the strictest of those worlds: a rule counts when each of its conditions holds in
 * SOME world, and the floor is step_up. Every condition reads one field, so a rule that matches in any combination
 * is counted; the bound is never milder than any combination, including the pre-strict one.
 */
export function evidenceWorlds(evidence: DecisionEvidence): { worlds: DecisionEvidence[]; truncated: boolean } {
  const retainedRaw = evidence.retainedAccusations;
  const retained = retainedRaw !== null && typeof retainedRaw === "object" ? retainedRaw : undefined;
  const preStrict = preStrictWorldsOf(evidence.preStrictReadings);
  if (retained === undefined && preStrict === undefined) {
    return { worlds: [evidence], truncated: false };
  }
  const { retainedAccusations: _dropped, preStrictReadings: _readings, ...base } = evidence;
  const axes: [string, unknown[]][] = [];
  for (const key of Object.keys(retained ?? {}).sort()) {
    const values = (retained as Record<string, unknown>)[key];
    if (!Array.isArray(values)) continue;
    const alternates = values.filter((v) => v !== (base as Record<string, unknown>)[key]);
    if (alternates.length > 0) axes.push([key, alternates]);
  }
  let size = 1;
  for (const [, alts] of axes) {
    size *= alts.length + 1;
    if (size > MAX_EVIDENCE_WORLDS) break;
  }
  const truncated = size > MAX_EVIDENCE_WORLDS;
  let worlds: Record<string, unknown>[] = [base];
  if (truncated) {
    for (const [key, alts] of axes) for (const v of alts) worlds.push({ ...base, [key]: v });
  } else {
    for (const [key, alts] of axes) {
      worlds = worlds.flatMap((w) => [w, ...alts.map((v) => ({ ...w, [key]: v }))]);
    }
  }
  const judged: DecisionEvidence[] = [base as DecisionEvidence];
  for (const world of worlds.slice(1)) {
    const own = deriveCriticalSignalsPresent(world as unknown as DecisionEvidence);
    judged.push({ ...world, criticalSignalsPresent: own } as unknown as DecisionEvidence);
    if (own && !base.criticalSignalsPresent) judged.push({ ...world, criticalSignalsPresent: false } as unknown as DecisionEvidence);
  }
  for (const fields of preStrict?.worlds ?? []) {
    const world = { ...base, ...fields } as DecisionEvidence;
    judged.push({ ...world, criticalSignalsPresent: deriveCriticalSignalsPresent(world) });
  }
  const bounded = truncated || preStrict?.bounded === true;
  // In a combination the backstop can differ from every single-family world's; the bound must see both values.
  if (bounded) judged.push({ ...(base as DecisionEvidence), criticalSignalsPresent: !base.criticalSignalsPresent });
  return { worlds: judged, truncated: bounded };
}

/**
 * The kept pre-strict readings, read defensively: they may come from a durable row or a JSON body. An entry that
 * is not a plain object is ignored, and a backstop or nested list inside one is dropped (the backstop is always
 * recomputed), so a malformed value can only add worlds the policy judges, never change the base.
 */
function preStrictWorldsOf(value: unknown): { worlds: Record<string, unknown>[]; bounded: boolean } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const list = Array.isArray(record["worlds"]) ? (record["worlds"] as unknown[]) : [];
  const worlds: Record<string, unknown>[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(entry as Record<string, unknown>)) {
      if (key === "criticalSignalsPresent" || key === "retainedAccusations" || key === "preStrictReadings") continue;
      fields[key] = field;
    }
    worlds.push(fields);
  }
  const bounded = record["bounded"] === true;
  return worlds.length === 0 && !bounded ? undefined : { worlds, bounded };
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
    dockEvidenceFreshness !== "unknown" &&
    // DR-065: a dock-family reading that was EMITTED but could not be read is not
    // evidence either, so the backstop holds for a custom rule set that carries no
    // `*-unreadable` rule. Silence ("unknown") is deliberately not listed — the same
    // deployment-shape reasoning as "missing" above.
    !DOCK_FAMILY_FIELDS.some((field) => evidence[field] === "unreadable")
  );
}

/** DR-065: the six dock-family evidence fields that can read `"unreadable"`. */
export const DOCK_FAMILY_FIELDS = [
  "custodyState",
  "dockChargeState",
  "batteryHealth",
  "tamperState",
  "dockState",
  "badgeBinding",
] as const satisfies readonly (keyof DecisionEvidence)[];

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
> & Pick<EvidenceSnapshot, "coreNormalizationVersion" | "digestAlg">;

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
    // Same conditional-spread migration: an unmarked (pre-fix) row's body is byte-identical.
    ...(fields.digestAlg === undefined ? {} : { digestAlg: fields.digestAlg }),
  });
}

/** The pre-fix digest: FNV-1a 64 over the LOW BYTE of each UTF-16 code unit. Verifies rows
 *  minted before `digestAlg` existed and nothing else — never used to mint. */
function legacyLowByteDigest(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash ^ BigInt(input.charCodeAt(i) & 0xff)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
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
    digestAlg: DIGEST_ALG,
  };
  return {
    id,
    ...fields,
    digest: digest(snapshotDigestBody(fields)),
  };
}

/** Recompute a snapshot digest to confirm it has not been altered. */
export function verifySnapshot(snapshot: EvidenceSnapshot): boolean {
  const fn =
    snapshot.digestAlg === undefined ? legacyLowByteDigest
    : snapshot.digestAlg === DIGEST_ALG ? digest
    : null; // an algorithm this build does not know verifies false — fail closed
  return fn !== null && fn(snapshotDigestBody(snapshot)) === snapshot.digest;
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

type LatestByCategory = Map<NormalizedSignal["category"], CategoryReading> & {
  /**
   * Set on a PRE-STRICT grouping only (round 5, `readPreStrict`): the reader that placed its stamps. The readers
   * then fold as mainline's did (no accusation tiers in `readEnum`, the age ladder in `readFreshness`) and age a
   * posture reading with this reader, so the reading is the one mainline produced on that modelled host.
   */
  preStrict?: { readonly instantOf: (observedAt: string) => number };
};

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
function groupLatest(signals: NormalizedSignal[], preStrictInstant?: (observedAt: string) => number): LatestByCategory {
  const map: LatestByCategory = new Map();
  // A PRE-STRICT grouping (`readPreStrict`) places every stamp where `Date.parse` placed it for one modelled host,
  // and the readers then fold exactly as mainline's did.
  if (preStrictInstant !== undefined) map.preStrict = { instantOf: preStrictInstant };
  const at = new Map<NormalizedSignal["category"], number>();
  for (const signal of signals) {
    let reading = map.get(signal.category);
    if (!reading) {
      reading = { tied: [], illegible: [] };
      map.set(signal.category, reading);
    }
    const observed = (preStrictInstant ?? parseObservedInstant)(signal.observedAt);
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
  worse: readonly (readonly T[])[] = [],
): number {
  if (value === undefined) return 1;
  if (good.includes(value)) return 0;
  // A family may name its accusing members in TIERS, least to most severe. Members of one tier are treated
  // alike by the shipped rules, so they TIE (the first arrival stands, as before): collapsing them to the
  // later-listed member would discard a distinction a tenant's own active policy may draw. A member in a
  // higher tier outranks every member of a lower tier and of an unlisted accusation, so two DIFFERENT
  // accusations (an older "suspected" against a later "confirmed" whose stamp cannot be ordered) resolve to
  // the worse one whatever order they arrived in, instead of tying at 2 and letting the ordered one stand.
  const tier = worse.findIndex((members) => members.includes(value));
  return tier < 0 ? 2 : 2 + (tier + 1) / 10;
}

function resolveWorst<T extends string | boolean>(
  reading: CategoryReading | undefined,
  parse: (value: NormalizedSignal["value"]) => T | undefined,
  good: readonly T[],
  worse: readonly (readonly T[])[] = [],
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
    if (severityOf(candidate, good, worse) > severityOf(ordered, good, worse)) {
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
    if (severityOf(candidate, good, worse) > severityOf(worst, good, worse)) {
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
// DR-043. Only the POSITIVE wire states are readable members — the same two
// attach.ts's normalizer accepts. A wire "unknown" is deliberately NOT a member: it
// parses to "no answer" (severity 1), so a same-instant `removed` + `unknown` pair
// resolves to `removed` whatever order it arrived in. Were "unknown" a member it
// would tie `removed` at severity 2 and array order would pick restrict vs step_up.
const ATTACH_READABLE = ["attached", "removed"] as const;
const CREDENTIAL_STRENGTHS = ["strong", "legacy_125khz"] as const;

/** The dock-family categories whose age the dock connector stamps. */
const DOCK_CATEGORIES = [
  "custody_state",
  "charge_state",
  "battery_health",
  "tamper_state",
  "dock_state",
  "badge_binding",
  // DR-043: the dock stamps attach_state. enrollment_strength and
  // credential_read_method are NOT dock-family — the identity/reader planes emit
  // them — so their age is not dock evidence and is deliberately not folded here.
  "attach_state",
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
  // Every family below lists ALL its accusing members in TIERS, least to most severe by the outcome of the
  // shipped rule that matches them. Members the rules treat alike share a tier and TIE (the first arrival
  // stands); only members the rules separate are ordered. `proof:evidence-observedat-tz` derives each outcome
  // from SHARED_DEVICE_RULES_V1 and fails if a tier mixes outcomes, tiers do not strictly rise, or an accusing
  // member is missing. The orders follow the SHIPPED rules, not a tenant's active policy.
  custody: { members: CUSTODY_STATES, good: ["checked_in", "checked_out"], worse: [["overdue", "exception", "maintenance"]] },
  charge: { members: CHARGE_STATES, good: ["charging", "charged"], worse: [["low", "not_present"], ["critical"]] },
  batteryHealth: { members: BATTERY_HEALTH_STATES, good: ["healthy"], worse: [["degraded"], ["failing"]] },
  // `worse` orders the accusing members the shipped rule set separates by outcome: a confirmed tamper
  // denies (TAMPER_CONFIRMED) and a suspected one restricts (TAMPER_SUSPECTED).
  tamper: { members: TAMPER_STATES, good: ["none"], worse: [["sensor_unavailable"], ["suspected"], ["confirmed"]] },
  dock: { members: DOCK_STATES, good: ["occupied", "empty", "reserved"], worse: [["offline"], ["faulted"]] },
  baseline: { members: BASELINE_STATES, good: ["aligned"], worse: [["partial", "not_assessed"], ["drifted"]] },
  benchmarkSelection: { members: BENCHMARK_SELECTION_STATES, good: ["confirmed"] },
  shiftContext: { members: SHIFT_CONTEXT_STATES, good: ["confirmed"] },
  // A forced badge removal denies (BADGE_FORCED_REMOVAL) and a plain removal restricts (BADGE_REMOVED).
  badge: { members: BADGE_STATES, good: ["present"], worse: [["absent"], ["removed"], ["forced"]] },
  managementHealth: { members: MANAGEMENT_HEALTH_STATES, good: ["healthy"], worse: [["degraded"], ["broken"]] },
  localAuthority: { members: LOCAL_AUTHORITY_STATES, good: ["verified"] },
  attach: { members: ATTACH_READABLE, good: ["attached"] },
  // ENROLLMENT IS INVERTED ON PURPOSE, and it is the DR-043 fix over PR #753. The
  // only rule that reads this field is credential-downgrade, and there STRONG
  // enrollment is the ACCUSING half: it is what turns a legacy read into a deny. So
  // the member that vouches (no downgrade is possible) is `legacy_125khz`, and
  // `strong` must be the one that survives `resolveWorst`. #753 declared
  // `good: ["strong"]`, which (a) resolved a same-instant strong+legacy pair to
  // legacy and ALLOWED the downgrade, and (b) floored a lone strong reading with an
  // illegible stamp to "unknown" and ALLOWED it. Both are pinned in the core proof.
  enrollment: { members: CREDENTIAL_STRENGTHS, good: ["legacy_125khz"] },
  // The read method is the ordinary direction: a legacy read is the accusation.
  readMethod: { members: CREDENTIAL_STRENGTHS, good: ["strong"] },
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
  // DR-065: "unreadable" is the dock-family field value for an emitted reading
  // nothing could be read from — likewise not a member any signal expresses.
  for (const silence of ["unknown", "unverified", "unreadable"]) {
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

/**
 * Worst-wins for the POSTURE freshness reading, ordered by what the shipped rules DO with each value, not by
 * age: `missing` and `unknown` restrict (POSTURE_MISSING) while `stale` and `expired` only step up
 * (POSTURE_STALE). The age ladder above puts stale above unknown, so an older parseable `stale` outranked a
 * newer `unknown` whose stamp could not be ordered and a restrict became a step-up. The dock-wide freshness
 * keeps the age ladder: nothing shipped rules on it per value.
 */
const POSTURE_SEVERITY: Record<Freshness, number> = {
  fresh: 0,
  stale: 1,
  expired: 2,
  missing: 3,
  unknown: 4,
};
function worsePosture(a: Freshness, b: Freshness): Freshness {
  return POSTURE_SEVERITY[a] >= POSTURE_SEVERITY[b] ? a : b;
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
  return readDockFamily(latestByCategory, "custody_state", EVIDENCE_VALUE_DOMAINS.custody);
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
  return readDockFamily(latestByCategory, "badge_binding", EVIDENCE_VALUE_DOMAINS.badge);
}

function readManagementHealth(latestByCategory: LatestByCategory): ManagementHealthState {
  return readEnum(latestByCategory, "device_management_health", EVIDENCE_VALUE_DOMAINS.managementHealth) ?? "unknown";
}

function readLocalAuthority(latestByCategory: LatestByCategory): LocalAuthorityGrantState {
  return readEnum(latestByCategory, "local_authority", EVIDENCE_VALUE_DOMAINS.localAuthority) ?? "unverified";
}

function readCharge(latestByCategory: LatestByCategory): ChargeState {
  return readDockFamily(latestByCategory, "charge_state", EVIDENCE_VALUE_DOMAINS.charge);
}

function readBatteryHealth(latestByCategory: LatestByCategory): BatteryHealthState {
  return readDockFamily(latestByCategory, "battery_health", EVIDENCE_VALUE_DOMAINS.batteryHealth);
}

function readTamper(latestByCategory: LatestByCategory): TamperState {
  return readDockFamily(latestByCategory, "tamper_state", EVIDENCE_VALUE_DOMAINS.tamper);
}

function readDock(latestByCategory: LatestByCategory): DockState {
  return readDockFamily(latestByCategory, "dock_state", EVIDENCE_VALUE_DOMAINS.dock);
}

/**
 * DR-065 (PROPOSED) dock-family reader. `readEnum` answers `undefined` for BOTH "no
 * reading" and "a reading is present but out-of-domain / only a floored good value".
 * Before DR-065 the six dock-family readers folded both to `"unknown"`, which no v1
 * rule matches — so a fresh `tamper_state: "garbled"` (or a badge binding the reader
 * could not parse) ALLOWED, while the identical shape on the DR-043 credential
 * fields stepped up. Silence stays `"unknown"` (day-one-quiet: a tenant with no dock
 * hardware is not stepped up); an EMITTED reading nothing could be read from is
 * `"unreadable"`, which the v1 `*-unreadable` rules step up. Same `.has()` split as
 * `readPresentOrNotApplicable` below, keeping the families' existing silence value.
 */
function readDockFamily<T extends string>(
  latestByCategory: LatestByCategory,
  category: (typeof DOCK_CATEGORIES)[number],
  domain: { readonly members: readonly T[]; readonly good: readonly T[] },
): T | "unknown" | "unreadable" {
  return readEnum(latestByCategory, category, domain) ?? (latestByCategory.has(category) ? "unreadable" : "unknown");
}

/**
 * DR-043 readers. `readEnum` answers `undefined` for BOTH "no reading" and "a reading
 * is present but out-of-domain / only a floored good value", and the two must not
 * collapse: silence is `not_applicable` (no such credential in play — day-one-quiet),
 * while a present-but-unreadable reading is `unknown`, which raises. `latestByCategory`
 * is a Map, so `.has()` tells them apart.
 */
function readPresentOrNotApplicable<T extends string>(
  latestByCategory: LatestByCategory,
  category: NormalizedSignal["category"],
  domain: { readonly members: readonly T[]; readonly good: readonly T[] },
): T | "unknown" | "not_applicable" {
  return readEnum(latestByCategory, category, domain) ?? (latestByCategory.has(category) ? "unknown" : "not_applicable");
}

function readEnum<T extends string>(
  latestByCategory: LatestByCategory,
  category: NormalizedSignal["category"],
  domain: { readonly members: readonly T[]; readonly good: readonly T[]; readonly worse?: readonly (readonly T[])[] },
): T | undefined {
  return resolveWorst(
    latestByCategory.get(category),
    (value) =>
      typeof value === "string" && (domain.members as readonly string[]).includes(value)
        ? (value as T)
        : undefined,
    domain.good,
    // The accusation tiers are this change's; the pre-strict reading folds without them, as mainline does.
    latestByCategory.preStrict === undefined ? domain.worse : [],
  );
}

/**
 * The posture answer's own freshness, and it must tell three states apart, not
 * two: NO posture answer at all is "missing"; an answer that exists but whose
 * `observedAt` nothing can order is present-but-illegible; an orderable answer is
 * whatever it says.
 *
 * The illegible case resolves WORST-WINS on the rule-aligned POSTURE_SEVERITY
 * order (missing/unknown restrict, above stale/expired, which step up): a sole
 * illegible reading is floored at "unknown", so an illegible "fresh", "stale" or
 * "expired" reads "unknown" (it may not vouch, and "unknown" is the harsher
 * shipped outcome). Mixed with a parseable sibling, the parseable one is the
 * answer unless the illegible one is worse on that order.
 */
function readFreshness(latestByCategory: LatestByCategory, nowIso?: string): Freshness {
  const reading = latestByCategory.get("posture_freshness");
  if (!reading) {
    return "missing";
  }
  // DR-059: the age of the reading itself, at the decision instant. A stamp the
  // clock cannot place (unparseable, or in the future) classifies as "unknown",
  // which only tightens.
  const instantOf = latestByCategory.preStrict?.instantOf ?? parseObservedInstant;
  const aged = (signal: NormalizedSignal): Freshness =>
    nowIso === undefined ? "fresh" : classifyFreshness(signal.observedAt, nowIso, FRESH_WINDOW_HOURS, STALE_WINDOW_HOURS, instantOf);
  // The pre-strict reading folds on mainline's age ladder; the strict one on the rule-aligned order.
  const worse = latestByCategory.preStrict === undefined ? worsePosture : worseFreshness;
  // The posture reading states its freshness in its VALUE, not in the `freshness`
  // field, but the out-of-union rule is the same one `asFreshness` applies.
  let ordered = reading.ordered ? worse(asFreshness(reading.ordered.value), aged(reading.ordered)) : undefined;
  // A same-instant twin folds worst-wins with no floor (eighth-round finding).
  for (const signal of reading.tied) {
    ordered = worse(ordered ?? "fresh", worse(asFreshness(signal.value), aged(signal)));
  }
  if (reading.illegible.length === 0) {
    return ordered ?? "unknown";
  }
  // Worst-wins across ALL the illegible peers, not just the first (finding F-1).
  let worst = ordered ?? "unknown";
  for (const signal of reading.illegible) {
    worst = worse(worst, asFreshness(signal.value));
  }
  return worst;
}
