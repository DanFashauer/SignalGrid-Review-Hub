// Signal sourcing — HOW each signal reaches the Grid, and what that costs.
//
// The Grid's coverage is only ever as good as the way the source systems are
// configured. Every signal is obtained by exactly one of four paths, dictated by
// what the target system supports:
//
//   • api            — the system exposes a read API the Grid polls (best).
//   • native         — a supported native/partner integration feeds it (webhook,
//                      SCIM, event stream, first-party connector).
//   • grid_collected — the system offers no usable API/native hook, so SignalGrid
//                      DOES THE LIFTING itself: a collector/agent, log & syslog
//                      ingestion, network/DEX observation, or a derived signal.
//                      Still delivered — at a lower fidelity and higher setup cost.
//   • unavailable    — no API, no native hook, and no way for the Grid to collect
//                      it. The signal cannot be wired here — a real gap, never a
//                      false "we have it".
//
// This is the honest boundary: the outcome depends on the customer's existing
// systems. Where a system integrates, the Grid consumes the signal directly;
// where it does not, the Grid compensates by collecting the signal another way;
// where even that is impossible, the gap is surfaced, not hidden.
//
// Pure and deterministic.

import type { SignalState } from "./index";

export type AcquisitionMethod = "api" | "native" | "grid_collected" | "unavailable";

/** Confidence in a signal given how it was obtained. Separate axis from health. */
export type Fidelity = "high" | "medium" | "low" | "none";

/** One signal's source system and the path by which the Grid obtains it. */
export interface SignalSource {
  /** Matches SignalState.id / Flow.requiredSignals. */
  id: string;
  name: string;
  /** The system the signal comes from (e.g. "Entra ID", "CrowdStrike", "RTLS"). */
  system: string;
  /** How the Grid obtains it, dictated by the system's integration support. */
  method: AcquisitionMethod;
  /**
   * Optional override for a grid_collected signal that is especially thin (a
   * coarse derived proxy) — pins it to "low". API/native are always "high";
   * unavailable is always "none". Ignored for those.
   */
  degraded?: boolean;
}

const BASE_FIDELITY: Record<AcquisitionMethod, Fidelity> = {
  api: "high",
  native: "high",
  grid_collected: "medium",
  unavailable: "none",
};

/** Fidelity of a source's signal. api/native → high; grid-collected → medium (low if degraded); unavailable → none. */
export function fidelityOf(source: SignalSource): Fidelity {
  if (source.method === "grid_collected" && source.degraded === true) return "low";
  // `?? "none"` fails closed on an unknown/undefined method (untyped JSON) —
  // never leak `undefined` as a fidelity.
  return BASE_FIDELITY[source.method] ?? "none";
}

/**
 * Whether this source can be wired at all. An ALLOWLIST on purpose: only a known
 * usable path (api / native / grid_collected) is wireable. Anything else —
 * `unavailable`, or an unknown/legacy/undefined method arriving from untyped JSON
 * — fails closed (not wireable), so the Grid never wires a signal of unknown
 * provenance as if it had it. This mirrors summarizeSourcing, which counts any
 * unknown method as a gap.
 */
export function isWireable(method: AcquisitionMethod): boolean {
  return method === "api" || method === "native" || method === "grid_collected";
}

/** True when the Grid has to do the lifting itself (no API/native hook exists). */
export function gridDoesLifting(method: AcquisitionMethod): boolean {
  return method === "grid_collected";
}

/**
 * Translate each source's acquisition posture into the wired signal states the
 * Grid actually sees. A source with a usable path (api / native / grid_collected)
 * is wired and healthy; an `unavailable` source yields NO state at all, so it
 * reads as missing downstream — fail-safe (the Grid never pretends to have a
 * signal it cannot obtain). Fidelity is deliberately NOT folded into health: a
 * grid-collected signal is present and working, just lower-confidence, and that
 * confidence is surfaced separately (see summarizeSourcing / fidelityOf) so
 * nothing over-trusts a signal the Grid had to synthesize.
 */
export function sourcingToSignalStates(sources: readonly SignalSource[]): SignalState[] {
  const out: SignalState[] = [];
  for (const s of sources) {
    if (isWireable(s.method)) out.push({ id: s.id, status: "healthy" });
  }
  return out;
}

export interface SourcingSummary {
  total: number;
  api: number;
  native: number;
  /** Signals the Grid collects itself (does the lifting). */
  gridCollected: number;
  /** Real gaps — cannot be wired at all. */
  unavailable: number;
  /** api + native + gridCollected — everything the Grid can actually obtain. */
  wireable: number;
  /** api + native — obtained via the source system's own integration surface. */
  vendorIntegrated: number;
}

/** Roll up how the signal set is sourced — how much is vendor-integrated vs. Grid-lifted vs. gap. */
export function summarizeSourcing(sources: readonly SignalSource[]): SourcingSummary {
  let api = 0, native = 0, gridCollected = 0, unavailable = 0;
  for (const s of sources) {
    if (s.method === "api") api += 1;
    else if (s.method === "native") native += 1;
    else if (s.method === "grid_collected") gridCollected += 1;
    else unavailable += 1;
  }
  return {
    total: sources.length,
    api,
    native,
    gridCollected,
    unavailable,
    wireable: api + native + gridCollected,
    vendorIntegrated: api + native,
  };
}
