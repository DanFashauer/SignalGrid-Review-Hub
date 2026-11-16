// @workspace/signal-discovery — the discovery + auto-onboarding tool.
//
// Tells administrators WHAT SIGNALS the system has detected from their connected
// sources, and whether each is one the Grid already uses. If a detected signal
// isn't recognized, the Grid ONBOARDS IT AUTOMATICALLY when the source exposes an
// API/connector to pull it from; otherwise it's flagged for an admin to wire.
// The more sources/APIs a business opens, the more the Grid can see and use.
//
// Classification (evaluated / candidate / novel) reuses @workspace/signal-radar,
// the single source of truth for what the Grid recognises. Pure, deterministic,
// public-safe: "onboarding" produces a record, it does not call a real source.

import { classifyCategory, type SignalClass } from "@workspace/signal-radar";

/** Lifecycle of a signal from first sight to active use (and eventual retirement). */
export type SignalLifecycle = "discovered" | "proposed" | "onboarded" | "active" | "deprecated";

/** A connected source the Grid pulls signals from. */
export interface DiscoverySource {
  id: string;
  name: string;
  /** Can the Grid pull from this source automatically (an API/connector exists)? */
  hasApi: boolean;
  /** How the Grid would ingest it. */
  pullMethod: "api" | "connector" | "manual";
}

/** A raw signal type observed coming from a source. */
export interface ObservedSignal {
  category: string;
  sourceId: string;
}

/** A discovered signal, classified and staged in its lifecycle. */
export interface DiscoveredSignal {
  category: string;
  sourceId: string;
  sourceName: string;
  /** evaluated (already used) | candidate (roadmap) | novel (unrecognised). */
  class: SignalClass;
  lifecycle: SignalLifecycle;
  /** True when the Grid can onboard it automatically (unrecognised + source has an API). */
  autoOnboardable: boolean;
  /** The recommended next step, in plain language. */
  recommendation: string;
}

/**
 * Discover signals: classify each observed signal and stage it. An `evaluated`
 * category is already active; a `candidate`/`novel` one is `proposed`, and is
 * auto-onboardable when its source exposes an API/connector. Deterministic;
 * duplicates (same category+source) collapse to one entry.
 */
export function discover(observed: ObservedSignal[], sources: DiscoverySource[]): DiscoveredSignal[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: DiscoveredSignal[] = [];

  for (const o of observed) {
    // The SAME normalisation radar applies (trim, "(empty)" for nothing): the dedupe
    // key used to be the raw string while the classifier trimmed it, so " x", "x"
    // and "x " were three detections and three "recognized" — the looks-covered count
    // inflated by whitespace. Key, classify and emit the one normalised value.
    const category = String(o.category ?? "").trim() || "(empty)";
    const key = `${o.sourceId}:${category}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const source = sourceById.get(o.sourceId);
    const sourceName = source?.name ?? o.sourceId;
    const cls = classifyCategory(category);

    if (cls === "evaluated") {
      out.push({
        category, sourceId: o.sourceId, sourceName, class: cls,
        lifecycle: "active", autoOnboardable: false,
        recommendation: "Already an active grid signal — no action needed.",
      });
      continue;
    }
    const canPull = !!source && source.hasApi;
    out.push({
      category, sourceId: o.sourceId, sourceName, class: cls,
      lifecycle: "proposed",
      autoOnboardable: canPull,
      recommendation: canPull
        ? `Auto-onboard from ${sourceName} via ${source!.pullMethod} — ${cls === "candidate" ? "a known candidate signal" : "a newly detected signal"}.`
        : `Needs an admin: ${sourceName} has no API/connector to pull "${category}" automatically — wire it manually.`,
    });
  }
  // Stable order: unrecognised-but-actionable first, then by source + category —
  // in CODEPOINT order, not `localeCompare`, whose collation follows the process
  // locale; source ids and categories are tenant-supplied, so non-ASCII is reachable.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) =>
    Number(b.autoOnboardable) - Number(a.autoOnboardable) ||
    cmp(a.sourceId, b.sourceId) ||
    cmp(a.category, b.category));
}

export interface OnboardingResult {
  /** Auto-added (lifecycle → onboarded) because the source has an API. */
  onboarded: DiscoveredSignal[];
  /** Proposed, awaiting an admin (no API / manual source). */
  needsAdmin: DiscoveredSignal[];
  /** Already active — nothing to do. */
  alreadyActive: DiscoveredSignal[];
}

/**
 * Plan onboarding: auto-onboard the signals whose source exposes an API (advance
 * their lifecycle to `onboarded`), leave the rest as admin proposals, and pass
 * active signals through untouched. Auto-onboarding is SIMULATED — it produces
 * the record the Grid would create; it does not call the source.
 */
export function planOnboarding(discovered: DiscoveredSignal[]): OnboardingResult {
  const onboarded: DiscoveredSignal[] = [];
  const needsAdmin: DiscoveredSignal[] = [];
  const alreadyActive: DiscoveredSignal[] = [];
  for (const d of discovered) {
    if (d.class === "evaluated") alreadyActive.push(d);
    // Strictly `true`: this is an exported entry point, and a truthy non-boolean
    // (the string "false", an object) used to auto-onboard a signal nobody could
    // pull. Anything but a literal true waits for an admin.
    else if (d.autoOnboardable === true) onboarded.push({ ...d, lifecycle: "onboarded" });
    else needsAdmin.push(d);
  }
  return { onboarded, needsAdmin, alreadyActive };
}

export interface DiscoverySummary {
  /** Sources CONFIGURED. Not the same as sources heard from — see sourcesObserved. */
  sources: number;
  /** Sources that actually contributed at least one detection. A configured source
   *  that is down, credential-less or silent is counted in `sources` and NOT here,
   *  so silence is visible instead of reading as a healthy source with nothing new. */
  sourcesObserved: number;
  detected: number;
  recognized: number;
  candidate: number;
  novel: number;
  autoOnboardable: number;
  needsAdmin: number;
}

/** A one-glance summary of a discovery run (for the admin surface). */
export function discoverySummary(discovered: DiscoveredSignal[], sources: DiscoverySource[]): DiscoverySummary {
  return {
    sources: sources.length,
    sourcesObserved: new Set(discovered.map((d) => d.sourceId)).size,
    detected: discovered.length,
    recognized: discovered.filter((d) => d.class === "evaluated").length,
    candidate: discovered.filter((d) => d.class === "candidate").length,
    novel: discovered.filter((d) => d.class === "novel").length,
    autoOnboardable: discovered.filter((d) => d.autoOnboardable).length,
    needsAdmin: discovered.filter((d) => d.class !== "evaluated" && !d.autoOnboardable).length,
  };
}

// ── fixture ────────────────────────────────────────────────────────────────────

export { DEMO_SOURCES, DEMO_OBSERVED } from "./fixture";
