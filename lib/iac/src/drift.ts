// @workspace/iac — drift detection: declared desired vs observed fleet state.
//
// Drift is the whole promise of GitOps ("eliminate configuration drift"), made
// runtime-aware: a divergence between what Git declares and what the fleet
// actually is becomes a signal the decision fabric and self-audit can consume,
// not just a report. Worst-status-wins, fail-closed.

import {
  deepFreeze,
  DRIFT_RANK,
  DRIFT_STATUSES,
  IacError,
  RESOURCE_KIND_ORDER,
  type CheckStatusLike,
  type DesiredState,
  type DriftFinding,
  type DriftReport,
  type DriftStatus,
  type FieldChange,
  type ObservedState,
  type ProbeResultLike,
  type ResourceKind,
} from "./types";
import { assertSpec, isKind, parseDesiredState } from "./plan";

function worst(a: DriftStatus, b: DriftStatus): DriftStatus {
  return DRIFT_RANK[a] >= DRIFT_RANK[b] ? a : b;
}

function diffSpec(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): FieldChange[] {
  const fields = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of [...fields].sort()) {
    const b = Object.prototype.hasOwnProperty.call(before, field) ? before[field] : null;
    const a = Object.prototype.hasOwnProperty.call(after, field) ? after[field] : null;
    if (b !== a) changes.push({ field, before: b, after: a });
  }
  return changes;
}

/**
 * Compare declared desired state to observed fleet state.
 * - declared + observed, equal specs → in_sync
 * - declared + observed, differing   → drifted (with the field changes)
 * - declared, not observed           → missing (worst: the control isn't there at all)
 * - observed, not declared           → unmanaged (present but ungoverned)
 */
export function detectDrift(desired: DesiredState, observed: ObservedState): DriftReport {
  const validated = parseDesiredState(desired);
  if (observed === null || typeof observed !== "object" || !Array.isArray(observed.resources)) {
    throw new IacError("malformed_input", "Observed state must have a resources array.");
  }

  // Keep the kind/id intact alongside the spec so the unmanaged branch never has
  // to reconstruct them by string-splitting the composite key.
  const observedByKey = new Map<
    string,
    { kind: ResourceKind; id: string; spec: Readonly<Record<string, string>> }
  >();
  for (const o of observed.resources) {
    // Validate observed input exactly as strictly as the desired side: an
    // unknown kind or malformed spec is REFUSED, not silently classified as
    // `unmanaged`.
    if (!isKind(o.kind)) {
      throw new IacError("unknown_kind", `Unknown observed resource kind: ${String(o.kind)}.`);
    }
    if (typeof o.id !== "string" || o.id.trim().length === 0) {
      throw new IacError("malformed_input", `Observed resource of kind ${o.kind} has an empty id.`);
    }
    observedByKey.set(`${o.kind} ${o.id}`, {
      kind: o.kind,
      id: o.id,
      spec: assertSpec(o.kind, o.id, o.spec),
    });
  }

  const findings: DriftFinding[] = [];
  const declaredKeys = new Set<string>();

  for (const r of validated.resources) {
    const key = `${r.kind} ${r.id}`;
    declaredKeys.add(key);
    const obs = observedByKey.get(key);
    if (obs === undefined) {
      findings.push({
        kind: r.kind,
        id: r.id,
        status: "missing",
        detail: "Declared but not present on the fleet.",
        changes: diffSpec({}, r.spec),
      });
      continue;
    }
    const changes = diffSpec(obs.spec, r.spec);
    if (changes.length === 0) {
      findings.push({ kind: r.kind, id: r.id, status: "in_sync", detail: "Matches the declared configuration.", changes: [] });
    } else {
      findings.push({
        kind: r.kind,
        id: r.id,
        status: "drifted",
        detail: `Diverged from the declared configuration in ${changes.length} field(s).`,
        changes,
      });
    }
  }

  for (const [key, obs] of observedByKey) {
    if (declaredKeys.has(key)) continue;
    findings.push({
      kind: obs.kind,
      id: obs.id,
      status: "unmanaged",
      detail: "Present on the fleet but not declared in Git.",
      changes: diffSpec(obs.spec, {}),
    });
  }

  const sorted = [...findings].sort((x, y) => {
    const ko = (RESOURCE_KIND_ORDER[x.kind] ?? 99) - (RESOURCE_KIND_ORDER[y.kind] ?? 99);
    if (ko !== 0) return ko;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });

  const counts = DRIFT_STATUSES.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {} as Record<DriftStatus, number>);
  // NOTHING DECLARED is not "everything matches". A desired state with zero
  // resources is indistinguishable from one that failed to load, and the old
  // `overall = "in_sync"` starting value made the empty/empty case a clean bill
  // of health with an empty probe set — self-audit saw zero probes rather than
  // one unknown. The `unknown` rung existed in the type and was producible by
  // nothing. It is produced here: one finding, so counts, summary and the probe
  // projection all carry it.
  if (validated.resources.length === 0) {
    sorted.push({
      kind: "config_profile",
      id: "(declared state)",
      status: "unknown",
      detail:
        "No resources are declared: the desired state is empty or failed to load, so the fleet cannot be compared against it.",
      changes: [],
    });
  }

  let overall: DriftStatus = "in_sync";
  for (const f of sorted) {
    counts[f.status] += 1;
    overall = worst(overall, f.status);
  }

  return deepFreeze({ findings: sorted, overall, counts });
}

/** Map a drift status to the self-audit CheckStatus vocabulary. `missing` is a
 *  broken control; `unmanaged`/`drifted` are drift; `unknown` stays unknown. */
function toCheckStatus(s: DriftStatus): CheckStatusLike {
  switch (s) {
    case "in_sync":
      return "healthy";
    case "drifted":
    case "unmanaged":
      return "drifted";
    case "missing":
      return "broken";
    case "unknown":
      return "unknown";
    default:
      // Fail closed: an unrecognized status is treated as unknown, never healthy.
      return "unknown";
  }
}

/** Project a drift report into self-audit-compatible probe results, keyed
 *  `iac:<kind>:<id>`. Structurally compatible with self-audit's ProbeResult so
 *  the drift detector can feed the self-aware checklist without a hard import. */
export function toProbeResults(report: DriftReport): Record<string, ProbeResultLike> {
  const out: Record<string, ProbeResultLike> = {};
  for (const f of report.findings) {
    out[`iac:${f.kind}:${f.id}`] = { status: toCheckStatus(f.status), detail: f.detail };
  }
  return deepFreeze(out);
}
