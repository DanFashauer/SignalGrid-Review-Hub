// The FAIL-CLOSED runner: resolve each checklist item to a status from the probe
// results the caller supplies, and aggregate worst-status-wins.
//
// Probes are INJECTED, not performed here — this package is pure and deterministic,
// so it does no I/O and reads no clock. A probe runner (a script, a CI job) executes
// the real checks and hands this function a map of probeKey → result. The runner's
// central discipline: a probe that did not run, returned a malformed result, or
// threw resolves to `unknown`, and `unknown` is never `healthy`. A green check must
// be positively earned.

import {
  deepFreeze,
  STATUS_RANK,
  AUDIT_LAYERS,
  type AuditLayer,
  type CheckStatus,
  type CheckedItem,
  type ChecklistItem,
  type SelfAuditReport,
} from "./types";

/** A raw probe result the caller supplies for a probeKey. Deliberately permissive
 *  in shape so a malformed one can be detected and failed closed rather than
 *  trusted: anything that is not a well-formed result becomes `unknown`. */
export interface ProbeResult {
  status: CheckStatus;
  detail?: string;
}

const VALID_STATUSES = new Set<CheckStatus>(["healthy", "drifted", "broken", "unknown"]);

/** Own-property, type-checked read of a probe result. A result that is absent,
 *  not a plain object, or carries an unrecognized status is treated as `unknown`
 *  with a reason — never coerced toward healthy. */
function resolveStatus(raw: unknown): { status: CheckStatus; detail: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "unknown", detail: "no probe result supplied (fail-closed)" };
  }
  const rec = raw as Record<string, unknown>;
  const status = Object.prototype.hasOwnProperty.call(rec, "status") ? rec.status : undefined;
  if (typeof status !== "string" || !VALID_STATUSES.has(status as CheckStatus)) {
    return { status: "unknown", detail: "probe returned an unrecognized status (fail-closed)" };
  }
  const detailRaw = Object.prototype.hasOwnProperty.call(rec, "detail") ? rec.detail : undefined;
  const detail = typeof detailRaw === "string" ? detailRaw : "";
  return { status: status as CheckStatus, detail };
}

function worst(a: CheckStatus, b: CheckStatus): CheckStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/**
 * Run the checklist against a map of probe results.
 *
 * Deterministic and pure. For each item, look up `probeKey` in `probeResults`; a
 * missing or malformed result is `unknown` (fail-closed). Returns items in the
 * checklist's given order (the caller derives it sorted), the worst-status-wins
 * `overall`, per-status `counts`, and per-layer worst status. Deep-frozen.
 *
 * A `coverage:*` probe (the self-awareness gap items) that the caller does not
 * supply resolves to `unknown` — but a coverage gap is a real deficiency, so the
 * caller's probe runner is expected to report those `broken`. Either way the gap
 * is visible: `unknown` is not healthy.
 */
export function runAudit(
  checklist: readonly ChecklistItem[],
  probeResults: Readonly<Record<string, ProbeResult | undefined>>,
): SelfAuditReport {
  const items: CheckedItem[] = checklist.map((item) => {
    const raw = Object.prototype.hasOwnProperty.call(probeResults, item.probeKey)
      ? probeResults[item.probeKey]
      : undefined;
    const { status, detail } = resolveStatus(raw);
    return deepFreeze({ item, status, detail });
  });

  const counts: Record<CheckStatus, number> = { healthy: 0, drifted: 0, unknown: 0, broken: 0 };
  for (const ci of items) counts[ci.status] += 1;

  // Per-layer worst status. A green check must be POSITIVELY EARNED (see the module
  // header): the three FUNCTIONAL layers with no items were not checked at all, so they
  // are `unknown` (never a vacuous `healthy` — "nothing checked" is not "all clear").
  // The `meta` layer is the one exception: the coverage-gap machinery runs on EVERY
  // audit, so an empty meta layer genuinely means "no meta-level problems found", which
  // is healthy, not unverified. Functional layers seed `unknown` and the first item
  // REPLACES the seed (worst(unknown, healthy) would wrongly stay unknown).
  const byLayer: Record<AuditLayer, CheckStatus> = {
    backend: "unknown",
    frontend: "unknown",
    api_integration: "unknown",
    meta: "healthy",
  };
  const layerSeen: Record<AuditLayer, boolean> = {
    backend: false,
    frontend: false,
    api_integration: false,
    meta: false,
  };
  for (const ci of items) {
    const layer = ci.item.layer;
    byLayer[layer] = layerSeen[layer] ? worst(byLayer[layer], ci.status) : ci.status;
    layerSeen[layer] = true;
  }

  // Overall folds the per-layer statuses rather than the raw items, so an unchecked
  // FUNCTIONAL layer (unknown) makes the whole audit `unknown` — an audit that verified
  // nothing (or left a whole layer unverified) can never read `healthy`. Folding items
  // directly, as before, missed the empty case entirely and reported a false all-clear.
  let overall: CheckStatus = "healthy";
  for (const layer of AUDIT_LAYERS) overall = worst(overall, byLayer[layer]);

  return deepFreeze({
    items,
    overall,
    counts: Object.freeze({ ...counts }),
    byLayer: Object.freeze({ ...byLayer }),
  });
}

export { AUDIT_LAYERS };
