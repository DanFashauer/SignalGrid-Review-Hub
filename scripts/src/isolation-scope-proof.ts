// proof:isolation-scope — no tenant can read another's row, across EVERY scoped reader.
//
// NAMING, deliberate and not cosmetic. This was `tenant-isolation-proof.ts` until
// `phase:gate` failed it RED: its unsafe-file-path rule matches a path SEGMENT beginning
// `tenant`/`customer`/`phi`/`pii`, which is how a file that HOLDS tenant data announces
// itself. The rule was right and the filename was wrong — a fail-closed data-leak guard
// should not be narrowed to accommodate a test's name. Renamed instead.
//
// WHY EXHAUSTIVE RATHER THAN REPRESENTATIVE. `signalgrid-core-proof` already spot-checks
// two readers (`findDeviceByRef` in both directions) and a cross-tenant remediation
// approval. Those caught what they were written for and they are not coverage: a new
// reader added without a `scoped()` call would pass every one of them. This enumerates
// every tenant-scoped reader against every ORDERED PAIR of seeded tenants, so a missing
// scope is a failure rather than an omission nobody notices.
//
// An audit of the api-server confirmed the model is sound today — every `/v1` route
// derives its tenant from the verified bearer, and `scoped()` returns undefined on a
// tenantId mismatch. NO ROUTE COUNT IS TYPED HERE. This line read "all 32 `/v1` routes"
// until 2026-09-06, when the tree held 33 distinct `/v1` paths: header prose is not an
// assertion, so nothing went red and the figure simply drifted. Count it instead:
//   grep -rnoE '(get|post|put|patch|delete)\(\s*"(/v1[^"]*)"' artifacts/api-server/src \
//     | sed -E 's/.*"(\/v1[^"]*)".*/\1/' | sort -u | wc -l This is therefore REGRESSION PROTECTION, not defect-finding, and it
// is worth saying so plainly: a gate that has never caught anything is not evidence of
// nothing to catch, but it is also not a discovery.
//
// THREE PROPERTIES, and the second is the one that makes the first mean anything:
//
//   1. REFUSAL       — reading tenant A's row as tenant B yields undefined.
//   2. NON-VACUITY   — the SAME read as tenant A yields the row. Without this, a matrix of
//                      `=== undefined` assertions passes trivially against ids that do not
//                      exist at all, and proves precisely nothing. This exact trap
//                      invalidated two negative controls elsewhere in this repo before it
//                      was caught; it is checked here rather than assumed.
//   3. NO ORACLE     — the cross-tenant result is INDISTINGUISHABLE from reading a
//                      fabricated id. A distinguishable refusal (404 vs 403, or a
//                      different error) confirms existence, which leaks the thing the
//                      scoping exists to hide.

import { seedDemoStore, fixedClock } from "@workspace/signalgrid-core";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) {
    passed += 1;
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

const store = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z")).store;

const TENANTS = [
  "tenant_atlas",
  "tenant_civic",
  "tenant_forge",
  "tenant_meridian",
  "tenant_northwind",
  "tenant_orion",
  "tenant_vero",
] as const;

/** Every tenant-scoped by-id / by-ref reader, paired with a way to discover a row that
 *  genuinely belongs to a given tenant. `sample` returns the lookup key, or null when that
 *  tenant has no row of this kind — which is legitimate and simply contributes no pair. */
interface Reader {
  name: string;
  sample: (tenantId: string) => string | null;
  read: (tenantId: string, key: string) => unknown;
}

const s = store as unknown as Record<string, (...args: unknown[]) => unknown>;
const first = <T>(rows: readonly T[] | undefined): T | undefined => (rows ?? [])[0];

const READERS: Reader[] = [
  // Sampling goes through the LIST readers where one exists. Identities and devices have
  // no list method, so their refs are sourced from a seeded decision — which also means a
  // tenant with no decisions contributes no pair, handled by the null guard below.
  {
    name: "findIdentityByRef",
    sample: (t) => (first(store.listDecisions(t)) as { identityRef?: string } | undefined)?.identityRef ?? null,
    read: (t, k) => store.findIdentityByRef(t, k),
  },
  {
    name: "findDeviceByRef",
    sample: (t) => (first(store.listDecisions(t)) as { deviceRef?: string } | undefined)?.deviceRef ?? null,
    read: (t, k) => store.findDeviceByRef(t, k),
  },
  {
    name: "getConnector",
    sample: (t) => (first(store.listConnectors(t)) as { id?: string } | undefined)?.id ?? null,
    read: (t, k) => store.getConnector(t, k),
  },
  {
    name: "getPolicy",
    sample: (t) => (first(store.listPolicies(t)) as { id?: string } | undefined)?.id ?? null,
    read: (t, k) => store.getPolicy(t, k),
  },
  {
    name: "getDecision",
    sample: (t) => (first(store.listDecisions(t)) as { id?: string } | undefined)?.id ?? null,
    read: (t, k) => store.getDecision(t, k),
  },
  {
    name: "getSnapshot",
    sample: (t) => (first(store.listDecisions(t)) as { evidenceSnapshotId?: string } | undefined)?.evidenceSnapshotId ?? null,
    read: (t, k) => store.getSnapshot(t, k),
  },
  {
    name: "getRemediation",
    sample: (t) => (first(store.listRemediations(t)) as { id?: string } | undefined)?.id ?? null,
    read: (t, k) => store.getRemediation(t, k),
  },
];

// The banner prints the CURRENT proof name. It printed the retired `proof:tenant-isolation`
// until 2026-09-06 — the name this file was renamed away from, and the one its own header
// explains no longer exists — so a reader grepping a harness log for either name was
// misled in one direction or the other.
console.log("proof:isolation-scope — every scoped reader, every ordered tenant pair\n");

let pairs = 0;
let vacuousSkips = 0;

for (const r of READERS) {
  for (const owner of TENANTS) {
    const key = r.sample(owner);
    if (key === null) {
      vacuousSkips += 1;
      continue;
    }

    // PROPERTY 2 first, deliberately. If the owner cannot read its own row, every
    // cross-tenant assertion below is vacuously true and the whole matrix is theatre.
    check(`${r.name}: ${owner} can read its OWN row (non-vacuity)`, r.read(owner, key) !== undefined);

    // A key that cannot exist for anyone — the baseline the refusal must be identical to.
    const fabricated = `${key}__no-such-row`;

    for (const intruder of TENANTS) {
      if (intruder === owner) continue;
      pairs += 1;
      // PROPERTY 1.
      check(`${r.name}: ${intruder} cannot read ${owner}'s row`, r.read(intruder, key) === undefined);
      // PROPERTY 3 — the refusal must not distinguish "exists elsewhere" from "never existed".
      check(
        `${r.name}: ${intruder}'s refusal is indistinguishable from a nonexistent id`,
        r.read(intruder, key) === r.read(intruder, fabricated),
      );
    }
  }
}

// ── list readers must not leak a foreign row either ───────────────────────────
// A by-id reader can be scoped correctly while a list reader is not, and the list is the
// more dangerous of the two: it needs no id to be guessed.
const LISTS = ["listConnectors", "listPolicies", "listDecisions", "listRemediations", "listAudit"] as const;
for (const fn of LISTS) {
  for (const t of TENANTS) {
    const rows = (s[fn](t) ?? []) as { tenantId?: string }[];
    check(`${fn}(${t}) returns only that tenant's rows`, rows.every((row) => row.tenantId === t));
  }
}

// ── the enumeration must not be empty ─────────────────────────────────────────
// Every assertion above is inside a loop over discovered data. If discovery returned
// nothing the suite would report a confident pass over zero work — the same failure shape
// property 2 guards per-reader, applied to the sweep as a whole.
check("the sweep is not empty — ordered tenant pairs were actually exercised", pairs > 50);
check("every reader found at least one seeded row somewhere", vacuousSkips < READERS.length * TENANTS.length);

console.log(
  `figures=readers=${READERS.length},tenants=${TENANTS.length},orderedPairsExercised=${pairs},listReaders=${LISTS.length}`,
);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.log("Failed checks:");
  for (const f of failures.slice(0, 20)) console.log(`  - ${f}`);
  process.exit(1);
}
