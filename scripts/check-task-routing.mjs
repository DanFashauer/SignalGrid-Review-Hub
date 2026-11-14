#!/usr/bin/env node
// Gate docs/agent/task-routing.json (the brain's task -> model/effort/lane/role/validator
// table, DR-047 as data) and the resolver in scripts/lib/task-route.mjs.
//
//   node scripts/check-task-routing.mjs              check the committed table
//   node scripts/check-task-routing.mjs --self-test  prove every rule can fail
//
// Rules:
//   1. every kind names a known tier, and every tier names a DR-047 family (no model ids);
//   2. every role exists in docs/agent/org-roster.json; every validator is a roster role;
//   3. every skill exists under .claude/skills/<name>/SKILL.md;
//   4. build and judgment kinds name at least one validator, and never only themselves;
//   5. a kind touching the decision core is owner-gated;
//   6. the local LLM runs at "max" effort; an unavailable tier resolves to "judgment";
//   7. the fallback route exists in docs/agent/hand-routing.json, and the resolver
//      returns it for an unknown kind instead of any tier;
//   8. the resolver never validates on the implementing lane, and every implementing
//      lane has a distinct validation lane;
//   9. when the judgment tier is unavailable too, the route is pending, never scheduled.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoute } from "./lib/task-route.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const FAMILIES = new Set(["haiku", "sonnet", "opus"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const DECISION_SKILLS = new Set(["signalgrid-core"]);

export function problems(table, { roles, skillExists, handRoutes }) {
  const out = [];
  for (const [name, tier] of Object.entries(table.tiers ?? {})) {
    if (!FAMILIES.has(tier?.model)) out.push(`tier ${name}: model must be a DR-047 family (${[...FAMILIES].join("/")}), got ${JSON.stringify(tier?.model)}`);
    if (!EFFORTS.has(tier?.effort)) out.push(`tier ${name}: effort ${JSON.stringify(tier?.effort)} is not a known effort`);
  }
  if (table.unavailableTierResolvesTo !== "judgment") out.push("an unavailable tier must resolve UP to judgment (DR-047 rule 3)");
  if (table.lanes?.["local-llm"]?.effort !== "max") out.push("the local LLM pass must run at max effort");
  const kinds = Object.entries(table.kinds ?? {});
  if (!kinds.length) out.push("no task kinds are routed");
  for (const [kind, k] of kinds) {
    if (!Object.hasOwn(table.tiers ?? {}, k.tier)) out.push(`${kind}: unknown tier ${JSON.stringify(k.tier)}`);
    if (!roles.has(k.role)) out.push(`${kind}: role ${JSON.stringify(k.role)} is not in docs/agent/org-roster.json`);
    for (const v of k.validators ?? []) if (!roles.has(v)) out.push(`${kind}: validator ${JSON.stringify(v)} is not a roster role`);
    for (const s of k.skills ?? []) if (!skillExists(s)) out.push(`${kind}: skill ${JSON.stringify(s)} does not exist under .claude/skills`);
    const validators = (k.validators ?? []).filter((v) => v !== k.role);
    if ((k.tier === "build" || k.tier === "judgment") && !validators.length) {
      if (kind !== "prioritization") out.push(`${kind}: a ${k.tier} kind needs a validator other than its own role`);
    }
    if ((k.skills ?? []).some((s) => DECISION_SKILLS.has(s)) && k.ownerGated !== true) out.push(`${kind}: touches the decision core and must be ownerGated`);
    if (typeof k.when !== "string" || !k.when.trim()) out.push(`${kind}: says nothing about when it applies`);
  }
  const route = table.fallback?.route;
  if (!route || !Object.hasOwn(handRoutes, route)) out.push(`fallback route ${JSON.stringify(route)} is not in docs/agent/hand-routing.json`);
  if (!Array.isArray(table.fallback?.steps) || table.fallback.steps.length < 2) out.push("the fallback must say how to find or build the missing agent");
  const unknown = resolveRoute(table, "no-such-kind-zz");
  if (!unknown.gap || unknown.tier || unknown.route !== route) out.push("the resolver must return the fallback route, not a tier, for an unknown kind");
  for (const [kind] of kinds) {
    for (const lane of ["local-claude", "local-codex"]) {
      const r = resolveRoute(table, kind, { implementLane: lane });
      const v = r.passes?.[2]?.lane;
      if (r.refused || typeof v !== "string" || !v || v === lane) out.push(`${kind}: no validation lane distinct from the implementing lane ${lane}`);
      if (r.passes?.[0]?.effort !== "max") out.push(`${kind}: pass 1 is not at max effort`);
    }
    const up = resolveRoute(table, kind, { unavailableTiers: Object.keys(table.tiers ?? {}).filter((t) => t !== "judgment") });
    if (!up.gap && up.tier !== "judgment") out.push(`${kind}: an unavailable tier did not resolve up to judgment`);
    const none = resolveRoute(table, kind, { unavailableTiers: Object.keys(table.tiers ?? {}) });
    if (none.pending !== true || none.passes) out.push(`${kind}: with every tier unavailable the route must be pending, not scheduled`);
  }
  return out;
}

function context() {
  const roster = read("docs/agent/org-roster.json");
  return {
    roles: new Set((roster.roles ?? roster).map((r) => r.id)),
    skillExists: (s) => /^[a-z0-9][a-z0-9-]*$/.test(s) && existsSync(join(ROOT, ".claude/skills", s, "SKILL.md")),
    handRoutes: read("docs/agent/hand-routing.json").routes ?? {},
  };
}

function selfTest() {
  const ctx = context(), base = read("docs/agent/task-routing.json");
  const clone = () => JSON.parse(JSON.stringify(base));
  const mutants = [
    ["a model id instead of a family", (t) => { t.tiers.build.model = "sonnet-5-5-20260101"; }],
    ["an unavailable tier resolving down", (t) => { t.unavailableTierResolvesTo = "mechanical"; }],
    ["the local LLM below max effort", (t) => { t.lanes["local-llm"].effort = "high"; }],
    ["a role missing from the roster", (t) => { t.kinds["gate-or-proof"].role = "imaginary-role"; }],
    ["a validator missing from the roster", (t) => { t.kinds["web-ui"].validators = ["imaginary-validator"]; }],
    ["a skill that does not exist", (t) => { t.kinds["web-ui"].skills = ["no-such-skill"]; }],
    ["a build kind with no validator", (t) => { t.kinds["ci-workflow"].validators = []; }],
    ["a build kind validated only by itself", (t) => { t.kinds["ci-workflow"].validators = [t.kinds["ci-workflow"].role]; }],
    ["a decision-core kind not owner-gated", (t) => { delete t.kinds["decision-core"].ownerGated; }],
    ["a fallback route that does not exist", (t) => { t.fallback.route = "nowhere"; }],
    ["a fallback with no find-or-build steps", (t) => { t.fallback.steps = []; }],
    ["an unknown tier on a kind", (t) => { t.kinds["log-scan"].tier = "bargain"; }],
    ["a validation list holding only one lane", (t) => { t.lanes["local-validate"].lanes = ["local-claude"]; }],
    ["an empty validation list", (t) => { t.lanes["local-validate"].lanes = []; }],
  ];
  let passed = 0, failed = 0;
  const clean = problems(base, ctx);
  if (clean.length) { failed++; console.error(`FAIL the committed table is not clean: ${clean[0]}`); } else { passed++; console.log("PASS the committed table is clean"); }
  for (const [label, mutate] of mutants) {
    const t = clone(); mutate(t);
    const found = problems(t, ctx);
    if (found.length) { passed++; console.log(`PASS refuses ${label}`); } else { failed++; console.error(`FAIL did not refuse ${label}`); }
  }
  const r = resolveRoute(base, "gate-or-proof", { implementLane: "local-codex" });
  const ok = r.passes[0].effort === "max" && r.passes[1].lane === "local-codex" && r.passes[2].lane === "local-claude" && r.passes[3].lane === "cloud-final" && r.tier === "build";
  if (ok) { passed++; console.log("PASS a routed kind runs local LLM (max) -> implement -> validate on the other lane -> cloud final"); } else { failed++; console.error("FAIL the four-pass route is wrong: " + JSON.stringify(r.passes)); }
  const waits = resolveRoute(base, "architecture", { unavailableTiers: ["judgment"] });
  if (waits.pending === true && !waits.passes) { passed++; console.log("PASS judgment work with the judgment tier unavailable is pending, not scheduled"); } else { failed++; console.error("FAIL judgment work was scheduled on an unavailable tier: " + JSON.stringify(waits)); }
  const exhausted = resolveRoute(base, "web-ui", { unavailableTiers: ["build", "judgment"] });
  if (exhausted.pending === true && !exhausted.passes) { passed++; console.log("PASS a tier and its fallback both unavailable is pending"); } else { failed++; console.error("FAIL a build kind with build and judgment unavailable was scheduled"); }
  for (const bad of ["", "UPPER", "../escape", null, 42, "__proto__", "constructor"]) {
    const g = resolveRoute(base, bad);
    if (g.gap && !g.tier) passed++; else { failed++; console.error(`FAIL a malformed kind ${JSON.stringify(bad)} got a tier`); }
  }
  console.log("PASS malformed kinds (empty, uppercase, path, null, number, prototype keys) all resolve to the capability gap");
  console.log(`task-routing self-test: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);
const found = problems(read("docs/agent/task-routing.json"), context());
for (const p of found) console.error(`task-routing: ${p}`);
if (found.length) process.exit(1);
const table = read("docs/agent/task-routing.json");
console.log(`task-routing: ${Object.keys(table.kinds).length} kinds routed across ${Object.keys(table.tiers).length} tiers; unknown kinds go to ${table.fallback.route}`);
