// The SELF-AWARE half: derive the checklist, and make the checklist know the
// boundaries of its own coverage.
//
// The fabric already keeps a machine-readable inventory of its contracts — the
// live-sync manifest (`artifacts/sync/live-sync-manifest.json`, body dimensions
// like `signalKinds`, `mcpTools`, `proofCounts`). A hand-written checklist that
// drifts from that inventory is exactly the blind spot this package exists to
// prevent: a new contract dimension would ship uncovered and every run would still
// report green. So `deriveChecklist` cross-checks the declared items against the
// manifest's dimensions and SYNTHESIZES a `meta` coverage-gap item for any
// dimension no declared item claims. The checklist reports its own blind spots.

import { deepFreeze, type AuditLayer, type ChecklistItem } from "./types";

/** The manifest body shape this module reads. Only the keys it cross-checks are
 *  named; extra keys are ignored. Deliberately a narrow structural type — the
 *  caller passes the parsed manifest body, this package does no I/O. */
export interface ContractInventory {
  /** The contract dimensions the checklist must cover, each a stable key. In the
   *  real manifest these are `signalKinds`, `signalCategories`, `mcpTools`, etc.
   *  A dimension present here but claimed by no declared item is a coverage gap. */
  dimensions: readonly string[];
}

/** A declared checklist item plus which contract dimensions it claims to cover.
 *  `covers` is how an item asserts "I check this dimension"; a dimension no item
 *  covers becomes a synthesized coverage-gap finding. */
export interface DeclaredItem extends ChecklistItem {
  covers: readonly string[];
}

/** The reserved id prefix for synthesized coverage-gap items. A declared item may
 *  not claim an id in this namespace: it would collide with the gap item for the
 *  same dimension and — in any consumer that keys items by id with first-wins
 *  lookup — MASK the gap the collision was supposed to surface. The namespace is
 *  the engine's; declared items stay out of it. */
const GAP_ID_PREFIX = "coverage-gap-";

function assertDeclaredIdsValid(items: readonly DeclaredItem[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (it.id.startsWith(GAP_ID_PREFIX)) {
      throw new Error(
        `self-audit: declared item id '${it.id}' uses the reserved '${GAP_ID_PREFIX}' prefix, ` +
          `which belongs to synthesized coverage-gap findings.`,
      );
    }
    if (seen.has(it.id)) {
      throw new Error(`self-audit: duplicate checklist item id '${it.id}'`);
    }
    seen.add(it.id);
  }
}

/** Defense in depth: the merged (declared + synthesized) set must have unique ids
 *  too. The reserved-prefix rule already prevents the only way a collision could
 *  arise, but a self-audit whose OWN output carried a duplicate id would be the
 *  exact blind spot this package exists to prevent, so we assert it directly. */
function assertMergedUnique(items: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) {
      throw new Error(`self-audit: derived checklist has a duplicate id '${it.id}'`);
    }
    seen.add(it.id);
  }
}

/**
 * Derive the full checklist from the declared items plus the contract inventory.
 *
 * Deterministic and pure. Returns the declared items UNCHANGED (minus their
 * `covers` bookkeeping) PLUS one synthesized `meta` coverage-gap item per manifest
 * dimension that no declared item covers. Output is sorted by id and deep-frozen,
 * so two runs over identical input are byte-identical.
 *
 * The coverage-gap items are what make the checklist self-aware: they turn "we
 * never looked at this" into a first-class, visible finding instead of silence.
 */
export function deriveChecklist(
  declared: readonly DeclaredItem[],
  inventory: ContractInventory,
): ChecklistItem[] {
  assertDeclaredIdsValid(declared);

  // What the declared items collectively claim to cover.
  const covered = new Set<string>();
  for (const it of declared) {
    for (const dim of it.covers) covered.add(dim);
  }

  // Distinct dimensions the inventory says exist, in deterministic order.
  const inventoryDimensions = [...new Set(inventory.dimensions)].sort();

  // A synthesized finding for every dimension no declared item covers. The probe
  // key is fixed and derivable, and the item is `broken` by construction at audit
  // time because no real probe reports it healthy — a gap is not a pass.
  const gapItems: ChecklistItem[] = inventoryDimensions
    .filter((dim) => !covered.has(dim))
    .map((dim) => ({
      id: `coverage-gap-${dim}`,
      layer: "meta" as AuditLayer,
      description:
        `Contract dimension '${dim}' exists in the live-sync manifest but no checklist ` +
        `item covers it — the self-audit is blind to it until an item is declared.`,
      probeKey: `coverage:${dim}`,
      healable: true,
      remediationHint:
        `Declare a ChecklistItem whose \`covers\` includes '${dim}', with a probe that ` +
        `verifies that dimension's contract (proof/gate/route), then regenerate the checklist.`,
    }));

  // The declared items, stripped of their covers bookkeeping (it is derivation-time
  // only; the runtime checklist item does not carry it).
  const declaredItems: ChecklistItem[] = declared.map((it) => ({
    id: it.id,
    layer: it.layer,
    description: it.description,
    probeKey: it.probeKey,
    healable: it.healable,
    remediationHint: it.remediationHint,
  }));

  const all = [...declaredItems, ...gapItems].sort((a, b) => a.id.localeCompare(b.id));
  assertMergedUnique(all);
  return all.map((it) => deepFreeze(it));
}
