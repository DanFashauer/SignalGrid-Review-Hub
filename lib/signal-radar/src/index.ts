// @workspace/signal-radar — "watch the edges of the grid."
//
// The grid evaluates a fixed set of signal categories today. Real deployments
// stream many more signals than the core decides on — and new signal sources
// appear over time. Signal Radar watches incoming signals and classifies each:
//
//   evaluated — a category the decision core already uses in a verdict
//   candidate — a known roadmap category (observed, not yet a decision input)
//   novel     — never catalogued: a genuinely new signal to consider bringing
//               into the grid. These raise a first-seen alert.
//
// It is deterministic and pure (no Date.now / Math.random): a monitoring +
// discovery layer that tells you what the grid is NOT yet paying attention to.

import type { SignalCategory } from "@workspace/signalgrid-core";

/**
 * The categories the decision core evaluates today. Kept in lockstep with the
 * core's `SignalCategory` union by the compile-time assertion below: if the core
 * adds or removes an evaluated category (i.e. a new signal is brought into the
 * grid), this file must be updated or the build fails — an intentional
 * catalog-drift tripwire.
 */
export const EVALUATED_CATEGORIES = [
  "identity_state",
  "device_compliance",
  "device_management",
  "device_encryption",
  "os_support",
  "posture_freshness",
  "custody_state",
  "charge_state",
  "battery_health",
  "tamper_state",
  "dock_state",
  "security_baseline",
  "benchmark_selection",
  "shift_context",
  "badge_binding",
  "device_management_health",
  "local_authority",
] as const;

// Compile-time guard: EVALUATED_CATEGORIES must exactly equal SignalCategory.
type Evaluated = (typeof EVALUATED_CATEGORIES)[number];
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// If this line errors, the core's SignalCategory changed — update the list.
const _catalogInSync: AssertEqual<Evaluated, SignalCategory> = true;
void _catalogInSync;

/**
 * Known candidate categories — roadmap signal sources that a deployment may
 * already emit but that the core does not yet decide on. Seen candidates are
 * surfaced (so you can prioritise them) but do not raise a "novel" alert.
 */
export const CANDIDATE_CATEGORIES = [
  "network_posture",
  "cellular_posture",
  "session_context",
  "shift_context",
  "location_presence",
  "rtls_location",
  "operational_siem",
  "operational_itsm",
  "nurse_call",
  "environment_state",
] as const;

export type SignalClass = "evaluated" | "candidate" | "novel";

const EVALUATED = new Set<string>(EVALUATED_CATEGORIES);
const CANDIDATE = new Set<string>(CANDIDATE_CATEGORIES);

/** Classify a single category string. Unknown, non-empty categories are novel. */
export function classifyCategory(category: string): SignalClass {
  const c = category.trim();
  if (EVALUATED.has(c)) return "evaluated";
  if (CANDIDATE.has(c)) return "candidate";
  return "novel";
}

export interface IncomingSignal {
  category: string;
  sourceReference?: string;
  observedAt?: string;
}

export interface RadarObservation {
  category: string;
  signalClass: SignalClass;
  count: number;
  firstSeenRef?: string;
  /** Set for novel categories (and first-seen candidates): a monitor alert. */
  alert?: string;
}

export interface RadarReport {
  observations: RadarObservation[];
  /** Novel categories — new signals to consider bringing into the grid. */
  novel: RadarObservation[];
  /** Known candidate categories that were observed. */
  candidates: RadarObservation[];
  alerts: string[];
  summary: string;
}

/**
 * Scan a batch of incoming signals and report what the grid is / isn't paying
 * attention to. Deterministic: observations are sorted by category so the same
 * input always yields the same report. Never throws — malformed categories are
 * treated as novel.
 */
export function scanSignals(signals: IncomingSignal[]): RadarReport {
  const byCategory = new Map<string, RadarObservation>();

  for (const sig of signals) {
    const category = String(sig?.category ?? "").trim() || "(empty)";
    const signalClass = classifyCategory(category);
    const existing = byCategory.get(category);
    if (existing) {
      existing.count += 1;
    } else {
      const obs: RadarObservation = { category, signalClass, count: 1, firstSeenRef: sig?.sourceReference };
      if (signalClass === "novel") {
        obs.alert = `New signal type "${category}" detected — not catalogued in the grid. Consider evaluating it.`;
      } else if (signalClass === "candidate") {
        obs.alert = `Candidate signal "${category}" observed — roadmap category, not yet a decision input.`;
      }
      byCategory.set(category, obs);
    }
  }

  const observations = [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category));
  const novel = observations.filter((o) => o.signalClass === "novel");
  const candidates = observations.filter((o) => o.signalClass === "candidate");
  const alerts = observations.filter((o) => o.alert).map((o) => o.alert as string);

  const summary =
    novel.length > 0
      ? `${novel.length} novel signal type(s) detected (${novel.map((o) => o.category).join(", ")}) — not yet in the grid.`
      : candidates.length > 0
        ? `No novel signals; ${candidates.length} candidate category(ies) observed.`
        : "All observed signals are already evaluated by the grid.";

  return { observations, novel, candidates, alerts, summary };
}

/** The full catalog: what the grid evaluates today and what's on the radar. */
export function signalCatalog(): { evaluated: string[]; candidate: string[] } {
  return { evaluated: [...EVALUATED_CATEGORIES], candidate: [...CANDIDATE_CATEGORIES] };
}
