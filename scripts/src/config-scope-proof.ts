// Connector config-store scoping proof — OFFLINE and deterministic.
//
// WHAT THIS GUARDS. `uem/store.ts` and `nac/store.ts` keyed their entry on a flat
// constant — `"uem:config"`, `"nac:config"` — in a repository where every other
// persisted reader is keyed on `(id, tenant_id)` and gated by `proof:isolation-scope`.
//
// SAY THE SEVERITY HONESTLY, since the temptation is to inflate it: NOTHING CALLED
// THESE FUNCTIONS. No tenant's connector selection was ever readable by another,
// because no code path ever read one. This is a latent trap, not a live exposure, and
// the fix is cheap precisely because there were no callers to migrate — `tenantId`
// could be made a REQUIRED leading parameter rather than an optional one nobody passes.
//
// THE HALF THAT IS EASY TO MISS. Scoping the Redis key alone fixes nothing for any
// deployment without REDIS_URL set — which is the documented default of this whole
// package — because the fallback behind it was a module-level singleton shared by
// every tenant in the process. Both layers are exercised below; the in-memory layer is
// the one that actually runs here, and it is the one that would have leaked.
//
// NO REDIS IS CONTACTED. REDIS_URL is asserted unset rather than assumed, so a proof
// that silently exercised only half the code would fail rather than pass quietly.

import { nac, storeScope, uem } from "@workspace/integrations";

const { assertTenantIdForKey, isValidTenantIdForKey, scopedConfigKey, TenantScopeError } = storeScope;

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};
/** True when `fn` throws a TenantScopeError specifically — not merely "throws".
 *  A TypeError from a typo would otherwise pass every refusal assertion here. */
const refuses = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch (e) { return e instanceof TenantScopeError; }
};

console.log("Config-scope proof — one tenant's connector selection is not another's\n");

// ── 0. THE PROOF RUNS WHERE IT CLAIMS TO ─────────────────────────────────────
check("REDIS_URL is unset, so the IN-MEMORY path is the one under test",
  !process.env["REDIS_URL"]);

// ── 1. THE ALLOWLIST ─────────────────────────────────────────────────────────
{
  // Non-vacuity first. A validator that refuses everything passes every refusal
  // assertion below and is useless; these are the shapes real tenant ids take.
  const ACCEPTED = [
    "tenant_atlas",              // the repo's own seeded convention
    "tenant-atlas",
    "contoso.onmicrosoft.com",   // domain-shaped, which is why "." is permitted
    "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", // an Entra-style GUID
    "A",
    "a".repeat(128),             // exactly at the cap
  ];
  check("every realistic tenant id shape is ACCEPTED — the rule is not refuse-everything",
    ACCEPTED.every((t) => isValidTenantIdForKey(t)));
  check("...and each is returned VERBATIM, never normalized",
    ACCEPTED.every((t) => assertTenantIdForKey(t) === t));

  // The empty id is the headline case: it yields "nac:config:" — one shared bucket for
  // every caller that forgot to pass an id, i.e. the original defect reintroduced.
  check('the EMPTY id is refused — it would rebuild the shared bucket as "nac:config:"',
    refuses(() => assertTenantIdForKey("")));

  const REFUSED: Array<readonly [string, unknown]> = [
    ["the key separator, which collides ACROSS stores", "config:x"],
    ["a leading separator", ":x"],
    ["a Redis glob star", "*"],
    ["a glob star inside an otherwise-valid id", "tenant_*"],
    ["a glob question mark", "tenant_?"],
    ["a glob class open", "tenant_[a]"],
    ["a leading space", " tenant_atlas"],
    ["a trailing space", "tenant_atlas "],
    ["an interior space", "tenant atlas"],
    ["a newline (an unanchored regex would accept this)", "tenant_atlas\nevil"],
    // Pinned because it is language-specific: in Python `$` matches BEFORE a trailing
    // newline, so the identical regex there would accept this. JavaScript's `$` without
    // the `m` flag matches only at end-of-input, and that difference is load-bearing.
    ["a TRAILING newline", "tenant_atlas\n"],
    ["a tab", "tenant\tatlas"],
    ["a NUL", "tenant\0atlas"],
    ["non-ASCII, where NFC/NFD would reintroduce a many-to-one map", "tenant_café"],
    ["a slash", "tenant/atlas"],
    ["one character over the cap", "a".repeat(129)],
    ["a lone dot", "."],
    ["a double dot", ".."],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an object", { toString: () => "tenant_atlas" }],
  ];
  for (const [why, value] of REFUSED) {
    check(`refused: ${why}`, refuses(() => assertTenantIdForKey(value)));
  }
  check("isValidTenantIdForKey agrees with the assertion on every case above",
    REFUSED.every(([, v]) => !isValidTenantIdForKey(v)));
}

// ── 2. THE KEY FUNCTION DOES NOT NORMALIZE ───────────────────────────────────
//
// This is the property the whole file exists for. Concatenation is trivially
// injective, which is exactly why it is asserted: the way it stops being injective is
// somebody adding a `.toLowerCase()` or `.trim()` to `scopedConfigKey` later, and
// case-variant ids are what such a change would silently collapse.
{
  // Case variants first: `.toLowerCase()` is the single likeliest "tidy-up" to be added
  // here, and it would merge the first three of these into one bucket.
  const DISTINCT = ["acme", "Acme", "ACME", "acme-1", "acme.1", "acme_1"] as const;
  const keys = DISTINCT.map((t) => scopedConfigKey("nac:config", t));
  check("distinct valid tenant ids give DISTINCT keys — no normalization collapses two tenants into one",
    keys.length === 6 && new Set(keys).size === 6);
  check("the key is exactly prefix + ':' + the id, unaltered",
    scopedConfigKey("nac:config", "Acme") === "nac:config:Acme");
  // A prefix ending in ':' would produce "nac:config::x" and, worse, make two different
  // prefixes able to agree. Refused rather than silently trimmed.
  check("a malformed PREFIX is refused too — the store, not just the tenant, must be well-formed",
    refuses(() => scopedConfigKey("nac:config:", "x")) && refuses(() => scopedConfigKey("", "x")));
}

// ── 3. THE STORES THEMSELVES ─────────────────────────────────────────────────
//
// Generic over the config type so the two stores run the SAME assertions rather than
// two hand-copied sets that can drift — the uem store's ownership axis was found
// under-covered exactly because its checks were a copy of the nac ones minus a case.

interface ScopedConfigStore<C> {
  readonly label: string;
  get(tenantId: string, onFault?: (m: string) => void): Promise<C | null>;
  set(tenantId: string, config: C, onFault?: (m: string) => void): Promise<void>;
  reset(): void;
  readonly a: C;
  readonly b: C;
}

async function exercise<C extends { provider: string; enabled: boolean }>(
  store: ScopedConfigStore<C>,
): Promise<void> {
  const { label } = store;
  const A = "tenant_atlas";
  const B = "tenant_civic";
  const NEVER = "tenant_never_written";

  store.reset();

  // Captured BEFORE anything is written, to compare against later. This is the
  // baseline the no-oracle assertion needs: what absence looks like in an empty store.
  const absenceInEmptyStore = await store.get(NEVER);

  await store.set(A, store.a);
  // REFUSAL. Tenant B must not see the selection tenant A just made.
  check(`${label}: tenant B cannot read the config tenant A just wrote`,
    (await store.get(B)) === null);
  // NON-VACUITY. Without this, the assertion above passes trivially against a store
  // that returns null to everyone — the trap that invalidated two negative controls
  // elsewhere in this repo.
  check(`${label}: tenant A CAN read it — the refusal above is not "returns null to everyone"`,
    (await store.get(A))?.provider === store.a.provider);

  // OVERWRITE. The original defect's live symptom: B's write clobbering A's entry.
  await store.set(B, store.b);
  check(`${label}: B's write does NOT overwrite A's — the original defect's actual symptom`,
    (await store.get(A))?.provider === store.a.provider &&
    (await store.get(B))?.provider === store.b.provider);
  check(`${label}: ...and the two tenants' enabled flags stay independent too`,
    (await store.get(A))?.enabled === true && (await store.get(B))?.enabled === false);

  // NO ORACLE. A tenant that has never been written reads the SAME whether or not
  // other tenants hold data. If a populated neighbour changed the answer, the read
  // would confirm another tenant's existence — the thing scoping exists to hide.
  check(`${label}: an unwritten tenant reads identically whether or not neighbours hold data`,
    absenceInEmptyStore === null && (await store.get(NEVER)) === null);

  // The tenant id is REQUIRED at runtime, not merely in the type. A JS caller, a JSON
  // body, or an `any`-typed handler all reach these with no type checking at all.
  const missingRefused = await (async () => {
    try { await (store.get as unknown as (t: unknown) => Promise<unknown>)(undefined); return false; }
    catch (e) { return e instanceof TenantScopeError; }
  })();
  check(`${label}: a missing tenant id is refused at RUNTIME, not just by the type`, missingRefused);

  const emptyWriteRefused = await (async () => {
    try { await store.set("", store.a); return false; }
    catch (e) { return e instanceof TenantScopeError; }
  })();
  check(`${label}: an EMPTY tenant id is refused on the write path too`, emptyWriteRefused);

  // A refused write must not have landed anywhere. A validator that throws AFTER
  // mutating is a validator that does not validate.
  check(`${label}: the refused write stored NOTHING — validation precedes mutation`,
    (await store.get(A))?.provider === store.a.provider &&
    (await store.get(B))?.provider === store.b.provider);

  // The reset seam clears EVERY tenant. A per-tenant reset would let one proof's
  // writes survive into the next and be read as that test's own.
  store.reset();
  check(`${label}: the test-reset seam clears every tenant, not just the last one`,
    (await store.get(A)) === null && (await store.get(B)) === null);
}

await exercise({
  label: "nac",
  get: nac.getNACConfig,
  set: nac.setNACConfig,
  reset: nac.__resetNacConfigForTests,
  a: { provider: "ise", enabled: true },
  b: { provider: "clearpass", enabled: false },
});

await exercise({
  label: "uem",
  get: uem.getUEMConfig,
  set: uem.setUEMConfig,
  reset: uem.__resetUemConfigForTests,
  a: { provider: "intune", enabled: true },
  b: { provider: "jamf", enabled: false },
});

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
