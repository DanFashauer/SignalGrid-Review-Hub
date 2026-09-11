// Custody-ledger RECONCILIATION — does the checkout ledger agree with the dock bay about
// this device, and may THIS requester take it?
//
// THE TWO ROWS THIS EXISTS FOR (docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md):
// "Custody integrity: a returned device still checked out to a prior holder / 'unpaired'
// but occupying a slot" and "Per-user checkout cap (a hard limit silently blocking a
// clinician when a prior return did not clear)". The runbooks' single most-cited
// operational pain is a custody-state CONTRADICTION across planes: the ledger (the
// checkout / MAM system) says one thing, the dock bay sees another, and the clinician
// meets it as a mystery beep. This module grades that contradiction as a checkout
// decision with a legible reason — the fabric surfaces it, a person reconciles it.
//
// WHY THIS IS A DIFFERENT SURFACE FROM evaluateCustodyPosture. That evaluator grades
// where the device physically IS (RTLS zone, fix age, dwell, badge dwell) against its
// checkout. This one grades what the LEDGER SAYS against what the BAY SEES, plus the
// requester's own checkout cap — the states a support tech reconciles by hand when
// "the dock won't release it". Both are read-only readings of already-resolved facts;
// nothing here clears a record, releases a bay, or changes a cap.
//
// FAIL-CLOSED (golden rule 2). The one grant (`none`, ready for check-out) requires
// POSITIVE confirmation of every axis: the ledger is CLEAR of this device with no holder
// named, the device is SEATED in its bay and PAIRED to it, the requester is UNDER cap,
// and the report parsed clean. A device the ledger still assigns to someone while it
// sits in a bay (the phantom) is a HOLD (`step_up`, a person clears the stale record) —
// as is a cap that is hit ONLY because a prior return never cleared, and any ledger that
// contradicts itself. An UNPAIRED device in a bay, a device genuinely out with another
// holder, and a cap genuinely reached are CONTAINED (`restrict`). A device the ledger
// calls clear while the bay is EMPTY is unaccounted for — a custody breach, `escalate`,
// the same rung the physical-custody evaluator uses for a device that left the area.
// The one advisory (`monitor`): the requester already holds this device and it is not in
// the bay — nothing to hand out, nothing wrong. ANY unknown axis holds. No clock, no
// randomness: a pure function of the supplied state.

/** What the checkout ledger says about this device. `returned` and `no record` both
 *  normalize to `clear`: neither assigns the device to anyone. */
export type LedgerState = "checked_out" | "clear" | "unknown";
/** Whom the ledger names as holder, RELATIVE to the person now requesting. */
export type LedgerHolder = "requester" | "other" | "none" | "unknown";
/** What the dock bay sees. */
export type SlotState = "seated" | "absent" | "unknown";
/** Whether the device is paired (assigned) to the bay it occupies / belongs to. */
export type PairingState = "paired" | "unpaired" | "unknown";
/** The requester's cap, DERIVED by the normalizer from the counts (never asserted):
 *  `cap_stale` = at or over cap only because of returns that never cleared. */
export type CapState = "under_cap" | "cap_stale" | "cap_reached" | "unknown";
/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type CustodyLedgerReportIntegrity = "clean" | "malformed";

/** Raw reconciliation report about one device and one requester (loosely typed — any
 *  slot may hold a number, a boolean, an error string, or nothing). */
export interface CustodyLedgerReportRaw {
  ledger_state?: unknown; // checked_out | returned | none
  ledger_holder?: unknown; // requester | other | none
  slot_state?: unknown; // seated | absent
  pairing?: unknown; // paired | unpaired
  open_checkouts?: unknown; // the requester's open checkout count (integer >= 0)
  checkout_cap?: unknown; // the tenant's per-user cap (integer >= 1)
  stale_returns?: unknown; // of those open checkouts, how many are physically docked (integer <= open)
  [k: string]: unknown;
}

/** FROZEN like the domain lists: this is the allowlist `hasUnrecognizedKey` reads, and a
 *  JavaScript caller that pushed a key onto it would turn an unrecognized assertion into a
 *  clean one (in-house review finding on the sibling surfaces). */
export const CUSTODY_LEDGER_REPORT_KEYS = Object.freeze([
  "ledger_state",
  "ledger_holder",
  "slot_state",
  "pairing",
  "open_checkouts",
  "checkout_cap",
  "stale_returns",
] as const);

/** The NORMALIZED domain of each axis — every declared member, `unknown` included. The
 *  evaluator holds any value outside these (a JavaScript caller, a cast, a deserialized
 *  object), whatever else fired: the exhaustive sweep walks these members, so a value
 *  they do not contain is one no proof has ever graded. FROZEN at runtime: `readonly` is
 *  a compile-time promise only. */
export const LEDGER_STATE_DOMAIN: readonly LedgerState[] = Object.freeze(["checked_out", "clear", "unknown"]);
export const LEDGER_HOLDER_DOMAIN: readonly LedgerHolder[] = Object.freeze(["requester", "other", "none", "unknown"]);
export const SLOT_STATE_DOMAIN: readonly SlotState[] = Object.freeze(["seated", "absent", "unknown"]);
export const PAIRING_DOMAIN: readonly PairingState[] = Object.freeze(["paired", "unpaired", "unknown"]);
export const CAP_STATE_DOMAIN: readonly CapState[] = Object.freeze(["under_cap", "cap_stale", "cap_reached", "unknown"]);
export const CUSTODY_LEDGER_INTEGRITY_DOMAIN: readonly CustodyLedgerReportIntegrity[] = Object.freeze(["clean", "malformed"]);

export interface NormalizedCustodyLedger {
  readonly sourceSystem: "rtls-custody";
  readonly deviceRef: string;
  readonly requesterRef: string;
  readonly ledgerState: LedgerState;
  readonly ledgerHolder: LedgerHolder;
  readonly slotState: SlotState;
  readonly pairing: PairingState;
  readonly capState: CapState;
  readonly reportIntegrity: CustodyLedgerReportIntegrity;
}

export type CustodyLedgerPosture =
  | "custody_clear" // ready — the one grant
  | "stale_return" // ledger still assigns a device that is back in its bay (the phantom)
  | "held_elsewhere" // genuinely out with another holder
  | "already_held" // out with the requester — advisory
  | "unaccounted" // ledger clear, bay empty — nobody has it
  | "unpaired" // in a bay it is not paired to, or unpaired altogether
  | "cap_reached" // the requester's cap is genuinely reached
  | "cap_blocked_stale" // the cap is hit only by returns that never cleared
  | "ledger_inconsistent" // the ledger contradicts itself
  | "custody_unverified" // some axis could not be read
  | "unverified"; // malformed report

/** All members are on the unified action ladder used by posture-composition. */
export type CustodyLedgerAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type CustodyLedgerReasonCode =
  | "CUSTODY_CLEAR"
  | "CUSTODY_STALE_RETURN_OTHER"
  | "CUSTODY_STALE_RETURN_OWN"
  | "CUSTODY_HELD_BY_OTHER"
  | "CUSTODY_ALREADY_HELD"
  | "CUSTODY_DEVICE_UNACCOUNTED"
  | "CUSTODY_UNPAIRED_IN_SLOT"
  | "CUSTODY_UNPAIRED_DEVICE"
  | "CUSTODY_CAP_REACHED"
  | "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"
  | "CUSTODY_LEDGER_INCONSISTENT"
  | "CUSTODY_STATE_UNKNOWN"
  | "CUSTODY_REPORT_MALFORMED";

export interface CustodyLedgerVerdict {
  readonly deviceRef: string;
  readonly requesterRef: string;
  readonly posture: CustodyLedgerPosture;
  readonly reasonCode: CustodyLedgerReasonCode;
  readonly recommendedAction: CustodyLedgerAction;
  /** Affirmative bad facts that contain or escalate (unpaired, held by another, unaccounted, cap reached). */
  readonly criticalFindings: string[];
  /** Ledger-versus-bay and ledger-versus-cap CONTRADICTIONS — the runbooks' phantoms. Each
   *  is a hold: a person reconciles it; the fabric never clears a record on its own. */
  readonly contradictions: string[];
  /** Axes whose state could not be determined. Any of these forecloses the grant. */
  readonly unknownSignals: string[];
  /** True ONLY for the grant: the device is in its bay, clear, paired, and this requester
   *  is under cap. Unlike the device-prep surface, the one advisory here (`monitor`,
   *  already held) is NOT ready: the device is not in the bay, so there is nothing to
   *  hand out. */
  readonly readyForCheckout: boolean;
}

const ACTION_SEVERITY: Record<CustodyLedgerAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

interface Candidate {
  posture: CustodyLedgerPosture;
  action: CustodyLedgerAction;
  reason: CustodyLedgerReasonCode;
}

/**
 * Grade one device against one requester. Pure and deterministic.
 *
 * Worst-concern-wins on the unified ladder; on a tie the FIRST concern pushed wins, so
 * the order below is the precedence: report integrity, then pairing, then the ledger
 * against the bay, then the requester's cap. Each branch carries its own reason so a
 * fixture can falsify it on its own.
 */
export function evaluateCustodyLedger(s: NormalizedCustodyLedger): CustodyLedgerVerdict {
  const criticalFindings: string[] = [];
  const contradictions: string[] = [];
  const unknownSignals: string[] = [];
  const candidates: Candidate[] = [];

  // Defence in depth: a report we could not fully parse is never a grant.
  if (s.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "CUSTODY_REPORT_MALFORMED" });
  }

  // ── pairing ─────────────────────────────────────────────────────────────────────
  // An unpaired device is not a device to hand out, wherever it is. In a bay it is the
  // runbooks' "unpaired but occupying a slot" — named separately so the console can say so.
  if (s.pairing === "unpaired") {
    if (s.slotState === "seated") {
      criticalFindings.push("unpaired_in_slot");
      candidates.push({ posture: "unpaired", action: "restrict", reason: "CUSTODY_UNPAIRED_IN_SLOT" });
    } else {
      criticalFindings.push("unpaired");
      candidates.push({ posture: "unpaired", action: "restrict", reason: "CUSTODY_UNPAIRED_DEVICE" });
    }
  } else if (s.pairing === "unknown") {
    unknownSignals.push("pairing");
    candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
  }

  // ── the ledger against the bay ──────────────────────────────────────────────────
  if (s.ledgerState === "checked_out") {
    if (s.slotState === "seated") {
      // The device is physically back and the ledger never cleared — the phantom.
      if (s.ledgerHolder === "other") {
        contradictions.push("stale_return_other");
        candidates.push({ posture: "stale_return", action: "step_up", reason: "CUSTODY_STALE_RETURN_OTHER" });
      } else if (s.ledgerHolder === "requester") {
        contradictions.push("stale_return_own");
        candidates.push({ posture: "stale_return", action: "step_up", reason: "CUSTODY_STALE_RETURN_OWN" });
      } else if (s.ledgerHolder === "none") {
        contradictions.push("checked_out_without_holder");
        candidates.push({ posture: "ledger_inconsistent", action: "step_up", reason: "CUSTODY_LEDGER_INCONSISTENT" });
      } else {
        unknownSignals.push("ledger_holder");
        candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
      }
    } else if (s.slotState === "absent") {
      if (s.ledgerHolder === "other") {
        criticalFindings.push("held_by_other");
        candidates.push({ posture: "held_elsewhere", action: "restrict", reason: "CUSTODY_HELD_BY_OTHER" });
      } else if (s.ledgerHolder === "requester") {
        // Consistent and benign: already in the requester's custody, nothing in the bay.
        candidates.push({ posture: "already_held", action: "monitor", reason: "CUSTODY_ALREADY_HELD" });
      } else if (s.ledgerHolder === "none") {
        contradictions.push("checked_out_without_holder");
        candidates.push({ posture: "ledger_inconsistent", action: "step_up", reason: "CUSTODY_LEDGER_INCONSISTENT" });
      } else {
        unknownSignals.push("ledger_holder");
        candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
      }
    } else {
      unknownSignals.push("slot_state");
      candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
    }
  } else if (s.ledgerState === "clear") {
    // A clear ledger that still names a holder contradicts itself.
    if (s.ledgerHolder === "other" || s.ledgerHolder === "requester") {
      contradictions.push("clear_with_holder");
      candidates.push({ posture: "ledger_inconsistent", action: "step_up", reason: "CUSTODY_LEDGER_INCONSISTENT" });
    } else if (s.ledgerHolder === "unknown") {
      unknownSignals.push("ledger_holder");
      candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
    }
    if (s.slotState === "absent") {
      // Nobody has it and it is not in its bay: a custody breach, not a checkout question.
      criticalFindings.push("unaccounted");
      candidates.push({ posture: "unaccounted", action: "escalate", reason: "CUSTODY_DEVICE_UNACCOUNTED" });
    } else if (s.slotState === "unknown") {
      unknownSignals.push("slot_state");
      candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
    }
  } else {
    unknownSignals.push("ledger_state");
    candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
    if (s.slotState === "unknown") {
      unknownSignals.push("slot_state");
    }
  }

  // ── the requester's cap ─────────────────────────────────────────────────────────
  if (s.capState === "cap_reached") {
    criticalFindings.push("cap_reached");
    candidates.push({ posture: "cap_reached", action: "restrict", reason: "CUSTODY_CAP_REACHED" });
  } else if (s.capState === "cap_stale") {
    // The cap is hit ONLY because prior returns never cleared: the mystery beep, named.
    contradictions.push("cap_blocked_by_stale_return");
    candidates.push({ posture: "cap_blocked_stale", action: "step_up", reason: "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN" });
  } else if (s.capState === "unknown") {
    unknownSignals.push("cap_state");
    candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
  }

  // Every axis must be a value this evaluator KNOWS. The branches above cover every
  // declared union member and the proof's exhaustive sweep pins the grant over those —
  // but a value OUTSIDE the union (a JavaScript caller, a cast, a deserialized object)
  // matches no branch, and the seed below would grant on it. The check does not depend
  // on whether another candidate fired (the sibling surfaces' review finding): any axis
  // outside its domain is held, whatever else fired — after an advisory the hold outranks
  // it; after another hold or a containment the earlier concern keeps its own reason.
  const inDomain =
    (LEDGER_STATE_DOMAIN as readonly string[]).includes(s.ledgerState) &&
    (LEDGER_HOLDER_DOMAIN as readonly string[]).includes(s.ledgerHolder) &&
    (SLOT_STATE_DOMAIN as readonly string[]).includes(s.slotState) &&
    (PAIRING_DOMAIN as readonly string[]).includes(s.pairing) &&
    (CAP_STATE_DOMAIN as readonly string[]).includes(s.capState) &&
    (CUSTODY_LEDGER_INTEGRITY_DOMAIN as readonly string[]).includes(s.reportIntegrity);
  if (!inDomain) {
    unknownSignals.push("state_out_of_domain");
    candidates.push({ posture: "custody_unverified", action: "step_up", reason: "CUSTODY_STATE_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired: ledger clear with no
  // holder, seated, paired, under cap, clean parse.
  const seed: Candidate = { posture: "custody_clear", action: "none", reason: "CUSTODY_CLEAR" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    deviceRef: s.deviceRef,
    requesterRef: s.requesterRef,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    contradictions,
    unknownSignals,
    // Ready = the grant and nothing else. The advisory (already held) is a device that is
    // not in the bay; an advisory here is not a hand-out.
    readyForCheckout: winner.action === "none",
  };
}

// ── normalization ───────────────────────────────────────────────────────────────

/**
 * Read one enum-valued slot off the wire. The asymmetry is the point:
 *  - ABSENT (undefined/null)            → `unknown`, and the report stays clean (silence);
 *  - a STRING outside the vocabulary    → `unknown` (an out-of-vocabulary vendor value
 *                                          is not evidence of anything);
 *  - PRESENT but NOT A STRING           → `unknown` AND the report is `malformed` (an
 *                                          assertion was made that we could not read).
 */
function readEnum<T extends string>(value: unknown, vocab: readonly T[], integrity: { malformed: boolean }): T | "unknown" {
  if (value === undefined || value === null) {
    return "unknown";
  }
  if (typeof value !== "string") {
    integrity.malformed = true;
    return "unknown";
  }
  const v = value.trim().toLowerCase();
  const hit = vocab.find((member) => member === v);
  if (hit === undefined) {
    return "unknown";
  }
  return hit;
}

/**
 * Read one COUNT off the wire. ABSENT is silence (`null`, report clean); a present value
 * that is not a non-negative safe integer — a string, a float, a negative, NaN, Infinity,
 * a boolean — is an assertion we could not read: `null` AND malformed. Never coerced.
 */
function readCount(value: unknown, integrity: { malformed: boolean }): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    integrity.malformed = true;
    return null;
  }
  return value;
}

/**
 * The cap axis is COMPUTED from the counts, never asserted by the wire. A missing count
 * leaves the axis `unknown` (a count without its cap is uninterpretable — and it raises,
 * because unknown never grants). Counts that contradict each other (a zero cap, more stale
 * returns than open checkouts) are a malformed report. Otherwise: under the cap; at or
 * over it only because of returns that never cleared; or genuinely reached.
 */
function deriveCapState(open: number | null, cap: number | null, stale: number | null, integrity: { malformed: boolean }): CapState {
  if (open === null || cap === null || stale === null) {
    return "unknown";
  }
  if (cap < 1 || stale > open) {
    integrity.malformed = true;
    return "unknown";
  }
  if (open < cap) {
    return "under_cap";
  }
  if (open - stale < cap) {
    return "cap_stale";
  }
  return "cap_reached";
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not read as a confirmation. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? An injected transport returning a string
 *  or an array must fail closed, not throw an untyped TypeError out of the normalizer.
 *  The Object.prototype exclusion is load-bearing: passing Object.prototype itself as
 *  the report would let POLLUTED prototype fields read as own assertions. */
function isPlainReport(report: unknown): report is object {
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this normalizer does not understand? Walks the
 *  PROTOTYPE CHAIN even though value reads are own-only: an inherited assertion, in any
 *  spelling, is still an assertion this report did not make, and this scan is the only
 *  thing that notices it. A symbol key counts; a class instance fails closed.
 *
 *  RECORDED DECISION, not closed (in-house review, the same call the sibling surfaces
 *  made): a Proxy whose `ownKeys` trap UNDER-reports — hides an own key from this scan
 *  while `hasOwnProperty` still sees the recognized ones — reads clean. Nothing reachable
 *  from a JSON wire report is a Proxy; detecting one needs node:util, which lib code the
 *  console bundles cannot import; and every enumeration primitive (Object.keys, JSON,
 *  for-in) goes through the same trap, so there is no second opinion to compare against.
 *  The proof pins the trap that THROWS; the lying trap is named here so the gap is a
 *  decision a reader can see, not a hole nobody wrote down. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      // Braced so the mutation guard can reach each guard (its mutators match `) {`).
      if (depth >= MAX_PROTOTYPE_DEPTH) {
        return true;
      }
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) {
          return true;
        }
        if (!(known as readonly (string | symbol)[]).includes(k)) {
          return true;
        }
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

/** Normalize a raw reconciliation report into the one shape the fabric reads.
 *  An ABSENT report is silence (every axis unknown, integrity clean); a report that is
 *  not a plain object, or that carries any key beyond the recognized seven — own or
 *  inherited — is an assertion we could not read: every axis unknown AND malformed. */
export function normalizeCustodyLedger(
  deviceRef: string,
  requesterRef: string,
  raw: CustodyLedgerReportRaw | null | undefined,
): NormalizedCustodyLedger {
  const integrity = { malformed: false };
  let r: Record<string, unknown> = {};
  if (raw !== undefined && raw !== null) {
    if (!isPlainReport(raw) || hasUnrecognizedKey(raw, CUSTODY_LEDGER_REPORT_KEYS)) {
      integrity.malformed = true;
    } else {
      r = raw as Record<string, unknown>;
    }
  }
  // A recognized OWN key whose read throws (an accessor property, a Proxy `get` trap) is
  // an assertion we could not read: malformed and every axis unknown — never an
  // exception out of the normalizer.
  let fields: Record<string, unknown> = {};
  try {
    fields = {
      ledger_state: ownValue(r, "ledger_state"),
      ledger_holder: ownValue(r, "ledger_holder"),
      slot_state: ownValue(r, "slot_state"),
      pairing: ownValue(r, "pairing"),
      open_checkouts: ownValue(r, "open_checkouts"),
      checkout_cap: ownValue(r, "checkout_cap"),
      stale_returns: ownValue(r, "stale_returns"),
    };
  } catch {
    integrity.malformed = true;
    fields = {};
  }
  const ledgerWire = readEnum<"checked_out" | "returned" | "none">(fields.ledger_state, ["checked_out", "returned", "none"], integrity);
  const open = readCount(fields.open_checkouts, integrity);
  const cap = readCount(fields.checkout_cap, integrity);
  const stale = readCount(fields.stale_returns, integrity);
  return {
    sourceSystem: "rtls-custody",
    deviceRef,
    requesterRef,
    // `returned` and `none` both mean the ledger assigns this device to nobody. The
    // mapping names the CLEAR members explicitly and defaults to unknown: a wire vocabulary
    // member added later without a mapping (lost, in_repair, missing) raises, never reads
    // clear (in-house review finding: the first cut's default arm was the permissive one).
    ledgerState: ledgerWire === "checked_out" ? "checked_out" : ledgerWire === "returned" || ledgerWire === "none" ? "clear" : "unknown",
    ledgerHolder: readEnum<LedgerHolder>(fields.ledger_holder, ["requester", "other", "none"], integrity),
    slotState: readEnum<SlotState>(fields.slot_state, ["seated", "absent"], integrity),
    pairing: readEnum<PairingState>(fields.pairing, ["paired", "unpaired"], integrity),
    capState: deriveCapState(open, cap, stale, integrity),
    reportIntegrity: integrity.malformed ? "malformed" : "clean",
  };
}

// ── the fixture corpus ──────────────────────────────────────────────────────────
//
// NORMALIZED states, one per reconciliation outcome, so the proof can (a) name every
// reachable verdict, (b) flip the sole grant one axis at a time and watch it fall, and
// (c) sweep the full cross-product and pin the grant set by equality. Each fixture
// isolates ONE axis so each evaluator branch is falsified on its own.

const CLEAR: NormalizedCustodyLedger = {
  sourceSystem: "rtls-custody",
  deviceRef: "iphone-shared-01",
  requesterRef: "rn-142",
  ledgerState: "clear",
  ledgerHolder: "none",
  slotState: "seated",
  pairing: "paired",
  capState: "under_cap",
  reportIntegrity: "clean",
};

export const CUSTODY_LEDGER_FIXTURES: Readonly<Record<string, NormalizedCustodyLedger>> = {
  /** The one grant: ledger clear, no holder, seated, paired, requester under cap. */
  "clear": CLEAR,
  /** THE PHANTOM: back in its bay, still assigned to the person who walked away. */
  "stale-return-other": { ...CLEAR, deviceRef: "iphone-shared-02", ledgerState: "checked_out", ledgerHolder: "other" },
  /** The requester's own prior return never cleared and they are badging for it again. */
  "stale-return-own": { ...CLEAR, deviceRef: "iphone-shared-03", ledgerState: "checked_out", ledgerHolder: "requester" },
  /** Genuinely out with someone else: not this device, no contradiction. */
  "held-by-other": { ...CLEAR, deviceRef: "iphone-shared-04", ledgerState: "checked_out", ledgerHolder: "other", slotState: "absent" },
  /** Already in the requester's custody and not in the bay: the one advisory. */
  "already-held": { ...CLEAR, deviceRef: "iphone-shared-05", ledgerState: "checked_out", ledgerHolder: "requester", slotState: "absent" },
  /** Nobody has it and the bay is empty: a custody breach. */
  "unaccounted": { ...CLEAR, deviceRef: "iphone-shared-06", slotState: "absent" },
  /** "Unpaired but occupying a slot." */
  "unpaired-in-slot": { ...CLEAR, deviceRef: "iphone-shared-07", pairing: "unpaired" },
  /** Out with the requester and unpaired: the containment outranks the advisory. */
  "unpaired-absent": { ...CLEAR, deviceRef: "iphone-shared-08", pairing: "unpaired", slotState: "absent", ledgerState: "checked_out", ledgerHolder: "requester" },
  /** The cap is genuinely reached: a hard limit, legibly named. */
  "cap-reached": { ...CLEAR, deviceRef: "iphone-shared-09", capState: "cap_reached" },
  /** The cap is hit ONLY by returns that never cleared: the mystery beep, named. */
  "cap-blocked-stale": { ...CLEAR, deviceRef: "iphone-shared-10", capState: "cap_stale" },
  /** The ledger contradicts itself: clear, yet a holder is named. */
  "clear-with-holder": { ...CLEAR, deviceRef: "iphone-shared-11", ledgerHolder: "other" },
  "checked-out-without-holder": { ...CLEAR, deviceRef: "iphone-shared-12", ledgerState: "checked_out" },
  "ledger-unknown": { ...CLEAR, deviceRef: "iphone-shared-13", ledgerState: "unknown" },
  "holder-unknown": { ...CLEAR, deviceRef: "iphone-shared-14", ledgerHolder: "unknown" },
  "slot-unknown": { ...CLEAR, deviceRef: "iphone-shared-15", slotState: "unknown" },
  "pairing-unknown": { ...CLEAR, deviceRef: "iphone-shared-16", pairing: "unknown" },
  "cap-unknown": { ...CLEAR, deviceRef: "iphone-shared-17", capState: "unknown" },
  /** Every value reads clear, but the report carried an assertion we could not parse. */
  "report-malformed": { ...CLEAR, deviceRef: "iphone-shared-18", reportIntegrity: "malformed" },
  /** Several concerns at once: the unpaired bay is named first, all three are recorded. */
  "worst-of-several": {
    ...CLEAR,
    deviceRef: "iphone-shared-19",
    pairing: "unpaired",
    ledgerState: "checked_out",
    ledgerHolder: "other",
    capState: "cap_reached",
  },
};

/** Evaluate a named fixture; `undefined` for an unknown name (never a fabricated verdict). */
export function evaluateCustodyLedgerFixture(name: string): CustodyLedgerVerdict | undefined {
  const fixture = CUSTODY_LEDGER_FIXTURES[name];
  if (fixture === undefined) {
    return undefined;
  }
  return evaluateCustodyLedger(fixture);
}
