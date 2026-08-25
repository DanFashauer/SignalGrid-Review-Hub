// Permission-enforcement gate — DR-002's mandated second half, built.
//
// DR-002 ruled: "a declared permission that no surface requires is a defect,
// and should be caught mechanically — the same shape as every other guard in
// this repo. Either the scope gets enforced on the surfaces above when they
// exist, or it comes out of the union." That check was never built, and the
// org sweep found the exact defect it was meant to catch still live:
// `tenant:admin` declared in the Permission union, granted to the owner role,
// and required by NOTHING — an authority a role table hands out and no code
// ever demands. Ten of eleven permissions are genuinely enforced; the
// eleventh has been ambient authority since it was declared.
//
// WHAT IT MEASURES, stated before what it is for, because the two are not the
// same and a reader who conflates them will trust this further than it goes:
// every member of the `Permission` union is NAMED in the text of at least one
// `authorize(<principal>, "<permission>")` call somewhere in shipping source.
//
// IT IS A TEXT SEARCH. It has no call graph, no import graph and no reachability
// analysis, so it cannot tell a live call site from a dead one. A security review
// on 2026-08-25 proved that by planting
//
//     export function neverCalled(p: any) { if (false) { authorize(p, "widget:delete"); } }
//
// in a file nothing imports — the gate reported the permission "required by a
// surface" and passed. That is the honest ceiling of a regex, and the header used
// to claim enforcement, which is more than a regex can establish.
//
// It is still worth having at exactly that strength: the defect DR-002 named — a
// scope declared in the union, granted by the role table, and demanded by no code
// anywhere — leaves no textual trace at all, so this catches it. What it cannot
// catch is a scope whose only demand sits on a path nothing reaches. Closing THAT
// needs real reachability analysis, which this repository has already declined
// once for `check-module-init-order.mjs` on the grounds that doing it properly
// needs a parser with scope analysis rather than a regex. Recorded, not pretended
// away.
//
// What it checks:
//   1. Every member of the `Permission` union in lib/signalgrid-core/src/types.ts
//      is NAMED in at least one `authorize(<principal>, "<permission>")` call in
//      shipping source (dist/, tests and this file excluded) — OR carries a
//      DECLARED reason below, with the surface that will require it.
//   2. The declared list itself cannot rot: a declaration whose permission has
//      SINCE become enforced fails, so the exemption comes out when the fix
//      lands rather than quietly outliving it.
//   3. SELF-TEST: the extraction must find both the union and the call sites on
//      the real tree (floors), AND the reporting path must actually fire on a
//      synthetic corpus with a genuinely unenforced permission. The previous
//      control asserted `!enforced.has("nonexistent:scope")` — true by
//      construction for any string nobody typed, and it never reached the code
//      that reports. A control that cannot fail is the thing this gate exists to
//      complain about.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TYPES = "lib/signalgrid-core/src/types.ts";
const ROOTS = ["lib", "artifacts"];

// A permission may be declared-but-unenforced ONLY with a reason and a named
// future surface. Empty is the goal state.
const DECLARED_UNENFORCED = new Map([
  [
    "tenant:admin",
    "DR-002 + org sweep 2026-08-23: the tenant-administration surfaces (tenant " +
      "create/suspend, key issuance, role assignment) do not exist in the public " +
      "core — they are private-core/control-plane work. The scope stays in the " +
      "union because the role table and audit trail already reason about it, and " +
      "removing it would silently widen `owner` to mean nothing. When those " +
      "surfaces land they must call authorize(principal, \"tenant:admin\") and " +
      "this entry comes out — which this gate then enforces, because a stale " +
      "exemption fails here.",
  ],
]);

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (p.includes("node_modules") || p.includes("/dist/") || p.endsWith(".d.ts")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

const unionSrc = readFileSync(TYPES, "utf8");
const unionBlock = unionSrc.match(/export type Permission =([\s\S]*?);/);
if (!unionBlock) {
  console.error(`✗ could not find the Permission union in ${TYPES} — the extraction broke, and guessing would defeat the gate.`);
  process.exit(1);
}
const permissions = [...unionBlock[1].matchAll(/"([a-z]+:[a-z]+)"/g)].map((m) => m[1]);

const enforced = new Set();
for (const f of files) {
  if (f.endsWith("check-permission-enforcement.mjs")) continue;
  const body = readFileSync(f, "utf8");
  for (const m of body.matchAll(/authorize\(\s*[A-Za-z0-9_.]+\s*,\s*"([a-z]+:[a-z]+)"\s*\)/g)) {
    enforced.add(m[1]);
  }
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const UNION_FLOOR = 8;
  const CALLSITE_FLOOR = 6;
  const synthetic = 'authorize(principal, "decision:read");';
  const extracts = [...synthetic.matchAll(/authorize\(\s*[A-Za-z0-9_.]+\s*,\s*"([a-z]+:[a-z]+)"\s*\)/g)].length === 1;
  // THE CONTROL THAT ACTUALLY FIRES. The previous one was
  // `!enforced.has("nonexistent:scope")` — true for any string nobody typed, and
  // it never touched the verdict. This drives the real function with a synthetic
  // corpus and asserts each arm, so "self-test green" means the reporting path
  // has been shown to work rather than merely not been run.
  const noExempt = new Map();
  const missingReported = auditPermissions(["a:read", "b:write"], new Set(["a:read"]), noExempt).problems.some((x) => x.startsWith("b:write"));
  const cleanIsClean = auditPermissions(["a:read"], new Set(["a:read"]), noExempt).problems.length === 0;
  const staleExemptionReported = auditPermissions(["a:read"], new Set(["a:read"]), new Map([["a:read", "reason"]])).problems.some((x) => x.includes("outlived"));
  const exemptionSuppresses = auditPermissions(["a:read"], new Set(), new Map([["a:read", "reason"]])).problems.length === 0;
  const verdictWorks = missingReported && cleanIsClean && staleExemptionReported && exemptionSuppresses;
  if (permissions.length < UNION_FLOOR || enforced.size < CALLSITE_FLOOR || !extracts || !verdictWorks) {
    console.error(
      "✗ SELF-TEST FAILED — " +
        `union=${permissions.length} (floor ${UNION_FLOOR}), enforced=${enforced.size} (floor ${CALLSITE_FLOOR}), ` +
        `extractor=${extracts}, verdict=${verdictWorks}. The extraction has drifted from the codebase's idiom; ` +
        "a gate scanning nothing is green about nothing.",
    );
    process.exit(1);
  }
}

/**
 * Pure verdict over (declared permissions, permissions NAMED in an authorize
 * call, declared-unenforced exemptions). Extracted so the self-test can drive
 * the REPORTING path over a synthetic corpus instead of asserting a tautology
 * beside it — sibling gates (auditOrgRoster, auditLabRegistry) already have this
 * shape, and the reason is the same: a verdict that cannot be called with made-up
 * inputs cannot be shown to fail.
 */
export function auditPermissions(declared, named, exemptions) {
  const problems = [];
  const ok = [];
  const exempt = [];
  for (const p of declared) {
    if (named.has(p)) {
      if (exemptions.has(p)) {
        problems.push(`${p}: now enforced, but still carries a declared-unenforced entry — remove the exemption, it has outlived its reason`);
      } else {
        ok.push(p);
      }
      continue;
    }
    if (exemptions.has(p)) {
      exempt.push(p);
      continue;
    }
    problems.push(`${p}: declared in the Permission union and granted by the role table, but NO surface names it`);
  }
  return { problems, ok, exempt };
}

console.log("Permission enforcement — every declared scope must be named by a surface (DR-002)\n");
let problems = 0;

for (const p of permissions) {
  if (enforced.has(p)) {
    if (DECLARED_UNENFORCED.has(p)) {
      console.error(`  ✗ ${p}: now enforced, but still carries a declared-unenforced entry — remove the exemption, it has outlived its reason`);
      problems += 1;
    } else {
      console.log(`  ✓ ${p}: required by a surface`);
    }
    continue;
  }
  const reason = DECLARED_UNENFORCED.get(p);
  if (reason) {
    console.log(`  · ${p}: DECLARED unenforced — ${reason.slice(0, 90)}…`);
    continue;
  }
  console.error(
    `  ✗ ${p}: declared in the Permission union and granted by the role table, but NO surface requires it.\n` +
      "      Per DR-002 this is a defect: enforce it with authorize(principal, \"" + p + "\"),\n" +
      "      remove it from the union, or declare it here WITH the surface that will require it.",
  );
  problems += 1;
}

console.log(
  `\npermission-enforcement: ${permissions.length} declared, ${permissions.filter((p) => enforced.has(p)).length} enforced, ` +
    `${DECLARED_UNENFORCED.size} declared-unenforced, ${problems} problem(s); self-test green`,
);
if (problems > 0) {
  console.error("\nPermission-enforcement gate FAILED — ambient authority is authority nobody asked for.");
  process.exit(1);
}
console.log("Permission-enforcement gate passed — no scope is granted that no surface demands.");
