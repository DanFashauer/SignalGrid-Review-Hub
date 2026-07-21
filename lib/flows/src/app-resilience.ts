// Application resilience — keep clinical staff working when a cloud app wobbles.
//
// Hospitals run on a suite of applications (EHR, BCMA, HIS, comms, drug
// reference…). When a vendor cloud app has an UNPLANNED outage, a PLANNED
// maintenance window, or just degrades, the technology becomes the bottleneck and
// device fatigue spikes — staff get stuck instead of caring for patients. This
// module turns an app's availability into a resilience decision: work normally,
// proceed-but-watch, fall over to a prepared downtime path, or (fail-safe) surface
// that there is no safe way to proceed — never pretend a down app is fine.
//
// PHI safety is non-negotiable: a downtime fallback for an app that handles
// regulated data is only offered when its DR safety nets are configured (the same
// break-glass principle as `user_override_on_downtime` in flows). Without them,
// the posture is BLOCKED, not an unsafe PHI workaround.
//
// Pure and deterministic. Availability is an INPUT (obtained like any signal — see
// signal-sourcing); nothing here calls a vendor.

export type AppAvailability =
  | "available"
  | "degraded"
  | "planned_maintenance"
  | "unplanned_outage"
  | "unknown";

/** An integrated application and its current availability + resilience config. */
export interface AppService {
  id: string;
  /** Human name, e.g. "EHR", "BCMA", "HIS". */
  name: string;
  availability: AppAvailability;
  /** Whether a prepared downtime / DR fallback path exists for this app. */
  hasFallback: boolean;
  /** Whether this app handles regulated data (PHI/PII) — its fallback needs safety nets. */
  handlesPhi: boolean;
  /** DR safety nets configured for the fallback (e.g. reconciliation, witness). Empty = none. */
  safetyNets?: string[];
}

export type ResilienceMode =
  | "normal" // app available — work normally
  | "degraded_monitor" // app degraded / availability unverified — proceed, watch
  | "downtime_fallback" // app down/maintenance + a ready (and, for PHI, safety-netted) fallback
  | "blocked_no_fallback"; // app down and NO safe way to proceed — surfaced, not hidden

export interface ResiliencePosture {
  appId: string;
  name: string;
  availability: AppAvailability;
  mode: ResilienceMode;
  /** True when staff can keep working — normally, degraded, or via a ready fallback. */
  canProceed: boolean;
  /** For a PHI app on a downtime fallback, the DR safety nets that must hold. */
  requiredSafetyNets: string[];
  reason: string;
}

/**
 * Resolve one app's resilience posture from its availability + fallback config.
 *
 * Fail-safe rules:
 *  - `available` → normal.
 *  - `degraded` or `unknown` → degraded_monitor (proceed but flagged). Unknown is
 *    NEVER silently treated as available; it is surfaced as unverified. Staff are
 *    not blocked on uncertainty (blocking care is its own harm), but nothing
 *    pretends the app is confirmed healthy.
 *  - `planned_maintenance` / `unplanned_outage` → a downtime_fallback ONLY when a
 *    fallback exists AND (the app is non-PHI OR its DR safety nets are configured).
 *    Otherwise blocked_no_fallback — an outage with no safe path is reported, never
 *    dressed up as "fine". A PHI app is NEVER put on a fallback without safety nets.
 */
export function resolveAppResilience(app: AppService): ResiliencePosture {
  // Blank/whitespace entries are not real safety nets — trim and drop them so a
  // net of `[""]` can never unlock a PHI fallback.
  const nets = (app.safetyNets ?? []).map((s) => s.trim()).filter(Boolean);
  // Fail-safe on the PHI flag: treat an app as regulated UNLESS it is explicitly
  // marked non-PHI. A missing/undefined handlesPhi (untyped JSON) must not skip
  // the safety-net gate.
  const isPhi = app.handlesPhi !== false;
  const base = { appId: app.id, name: app.name, availability: app.availability };

  if (app.availability === "available") {
    return { ...base, mode: "normal", canProceed: true, requiredSafetyNets: [], reason: `${app.name} is available — working normally.` };
  }
  if (app.availability === "degraded") {
    return { ...base, mode: "degraded_monitor", canProceed: true, requiredSafetyNets: [], reason: `${app.name} is degraded — proceeding while the Grid watches it.` };
  }

  // A downtime fallback path is reached ONLY by the two explicit down states.
  if (app.availability === "planned_maintenance" || app.availability === "unplanned_outage") {
    const kind = app.availability === "planned_maintenance" ? "in a maintenance window" : "in an unplanned outage";
    if (!app.hasFallback) {
      return { ...base, mode: "blocked_no_fallback", canProceed: false, requiredSafetyNets: [], reason: `${app.name} is ${kind} and no fallback is prepared — no safe way to proceed. Escalate; do not improvise.` };
    }
    if (isPhi && nets.length === 0) {
      // Fail-safe: never run a PHI downtime workaround without its DR safety nets.
      return { ...base, mode: "blocked_no_fallback", canProceed: false, requiredSafetyNets: [], reason: `${app.name} is ${kind}; a fallback exists but this app handles regulated data and no DR safety nets are configured — blocked until they are.` };
    }
    return { ...base, mode: "downtime_fallback", canProceed: true, requiredSafetyNets: isPhi ? nets : [], reason: `${app.name} is ${kind} — on its prepared downtime fallback${isPhi ? ` (safety nets: ${nets.join(", ")})` : ""}.` };
  }

  // `unknown` — and, fail-safe, ANY unrecognized/undefined availability — proceed
  // but flagged. It is NEVER treated as `available`/`normal`, and it never reaches
  // the downtime_fallback default, so an unrecognized state can't be reported
  // workable-by-default.
  return { ...base, mode: "degraded_monitor", canProceed: true, requiredSafetyNets: [], reason: `${app.name} availability is unverified (${String(app.availability)}) — proceeding, flagged (never assumed healthy).` };
}

export interface FleetResilience {
  apps: ResiliencePosture[];
  total: number;
  normal: number;
  degraded: number;
  onFallback: number;
  blocked: number;
  /** Apps staff can keep working on (normal + degraded + fallback). */
  workable: number;
  /** True only if EVERY app has a safe path (nothing blocked). */
  allWorkable: boolean;
}

/** Roll up the resilience of a whole app suite — how much of it staff can still use. */
export function fleetResilience(apps: readonly AppService[]): FleetResilience {
  const postures = apps.map(resolveAppResilience);
  const count = (m: ResilienceMode): number => postures.filter((p) => p.mode === m).length;
  const normal = count("normal");
  const degraded = count("degraded_monitor");
  const onFallback = count("downtime_fallback");
  const blocked = count("blocked_no_fallback");
  return {
    apps: postures,
    total: postures.length,
    normal,
    degraded,
    onFallback,
    blocked,
    workable: normal + degraded + onFallback,
    allWorkable: blocked === 0 && postures.length > 0,
  };
}
