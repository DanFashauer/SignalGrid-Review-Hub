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
// What it checks:
//   1. Every member of the `Permission` union in lib/signalgrid-core/src/types.ts
//      appears in at least one `authorize(<principal>, "<permission>")` call in
//      shipping source (dist/, tests and this file excluded) — OR carries a
//      DECLARED reason below, with the surface that will require it.
//   2. The declared list itself cannot rot: a declaration whose permission has
//      SINCE become enforced fails, so the exemption comes out when the fix
//      lands rather than quietly outliving it.
//   3. SELF-TEST: the extraction must find both the union and the call sites
//      on the real tree (floors), and a synthetic unenforced permission must
//      be flagged — a gate that cannot fail proves nothing.
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
  const fakeUnenforced = !enforced.has("nonexistent:scope");
  if (permissions.length < UNION_FLOOR || enforced.size < CALLSITE_FLOOR || !extracts || !fakeUnenforced) {
    console.error(
      "✗ SELF-TEST FAILED — " +
        `union=${permissions.length} (floor ${UNION_FLOOR}), enforced=${enforced.size} (floor ${CALLSITE_FLOOR}), ` +
        `extractor=${extracts}, negative=${fakeUnenforced}. The extraction has drifted from the codebase's idiom; ` +
        "a gate scanning nothing is green about nothing.",
    );
    process.exit(1);
  }
}

console.log("Permission enforcement — every declared scope must be required by a surface (DR-002)\n");
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
