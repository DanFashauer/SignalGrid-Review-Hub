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
//   8. passes 2 and 3 run only on the local session lanes, pass 3 never on pass 2's lane;
//      an unsupported lane is refused with no passes;
//   9. when the judgment tier is unavailable too, the route is pending, never scheduled;
//  10. tiers rank upward (judgment = opus at max), so fail-UP is a capability, not a label;
//  11. each pass carries its stage (Bonsai first implementation, local review, real checks,
//      cloud final); a missing local LLM build is a missing pass 1, never a complete route;
//  12. decision-core stays routed and ownerGated whatever its skills say.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_SESSION_LANES, resolveRoute } from "./lib/task-route.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const FAMILIES = new Set(["haiku", "sonnet", "opus"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const DECISION_SKILLS = new Set(["signalgrid-core"]);
// Kinds that are owner-gated by name, whatever their optional skill metadata says.
const OWNER_GATED_KINDS = ["decision-core"];
const FAMILY_RANK = { haiku: 0, sonnet: 1, opus: 2 };
const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };
const TIER_ORDER = ["mechanical", "build", "judgment"];
const STAGES = [
  [1, "local-llm", /first implementation/],
  [2, null, /review/],
  [3, null, /real checks/],
  [4, "cloud-final", /final review/],
];

export function problems(table, { roles, skillExists, handRoutes }) {
  const out = [];
  for (const [name, tier] of Object.entries(table.tiers ?? {})) {
    if (!FAMILIES.has(tier?.model)) out.push(`tier ${name}: model must be a DR-047 family (${[...FAMILIES].join("/")}), got ${JSON.stringify(tier?.model)}`);
    if (!EFFORTS.has(tier?.effort)) out.push(`tier ${name}: effort ${JSON.stringify(tier?.effort)} is not a known effort`);
  }
  // Fail-UP is a capability claim, not a label: each tier may not rank below the one before
  // it, and judgment must be the top family at the top effort.
  for (const name of TIER_ORDER) if (!Object.hasOwn(table.tiers ?? {}, name)) out.push(`tier ${name} is missing`);
  for (let i = 1; i < TIER_ORDER.length; i++) {
    const lo = table.tiers?.[TIER_ORDER[i - 1]], hi = table.tiers?.[TIER_ORDER[i]];
    if (lo && hi && (FAMILY_RANK[hi.model] < FAMILY_RANK[lo.model] || EFFORT_RANK[hi.effort] < EFFORT_RANK[lo.effort])) out.push(`tier ${TIER_ORDER[i]} ranks below ${TIER_ORDER[i - 1]} (model or effort)`);
  }
  if (table.tiers?.judgment?.model !== "opus" || table.tiers?.judgment?.effort !== "max") out.push("the judgment tier must be the top family (opus) at max effort, or fail-UP is not up");
  if (table.unavailableTierResolvesTo !== "judgment") out.push("an unavailable tier must resolve UP to judgment (DR-047 rule 3)");
  const vlanes = table.lanes?.["local-validate"]?.lanes;
  if (!Array.isArray(vlanes) || vlanes.length !== LOCAL_SESSION_LANES.length || !LOCAL_SESSION_LANES.every((l) => vlanes.includes(l))) out.push(`local-validate.lanes must be exactly the local session lanes (${LOCAL_SESSION_LANES.join(", ")})`);
  for (const gated of OWNER_GATED_KINDS) {
    if (!Object.hasOwn(table.kinds ?? {}, gated)) out.push(`${gated}: this owner-gated kind must stay routed`);
    else if (table.kinds[gated].ownerGated !== true) out.push(`${gated}: must be ownerGated whatever its skills say`);
  }
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
    for (const lane of LOCAL_SESSION_LANES) {
      const r = resolveRoute(table, kind, { reviewLane: lane });
      const v = r.passes?.[2]?.lane;
      if (r.refused || !LOCAL_SESSION_LANES.includes(v) || v === lane) out.push(`${kind}: no supported validation lane distinct from the pass-2 lane ${lane}`);
      if (r.passes?.[0]?.effort !== "max") out.push(`${kind}: pass 1 is not at max effort`);
      for (const [n, want, does] of STAGES) {
        const p = r.passes?.[n - 1];
        if (!p || p.pass !== n || (want && p.lane !== want) || !does.test(p.does ?? "")) out.push(`${kind}: pass ${n} does not carry its stage (${does})`);
      }
    }
    for (const bad of ["cloud-final", "cloud-claude", "local-llm", "", "local-claud", null, 42]) {
      const r = resolveRoute(table, kind, { reviewLane: bad });
      if (!r.refused || r.passes) out.push(`${kind}: an unsupported pass-2 lane ${JSON.stringify(bad)} produced a route`);
    }
    const noBonsai = resolveRoute(table, kind, { localLlmAvailable: false });
    if (noBonsai.complete !== false || noBonsai.passes?.[0]?.missing !== true) out.push(`${kind}: a missing local LLM build is not reported as a missing pass 1`);
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
    ["an unsupported validation lane", (t) => { t.lanes["local-validate"].lanes = ["no-such-lane"]; }],
    ["judgment mapped to haiku/low", (t) => { t.tiers.judgment = { model: "haiku", effort: "low" }; }],
    ["build ranked above judgment", (t) => { t.tiers.build = { model: "opus", effort: "max" }; t.tiers.judgment = { model: "sonnet", effort: "high" }; }],
    ["decision-core with its skill and ownerGated both removed", (t) => { t.kinds["decision-core"].skills = []; delete t.kinds["decision-core"].ownerGated; }],
    ["decision-core removed from the table", (t) => { delete t.kinds["decision-core"]; }],
  ];
  let passed = 0, failed = 0;
  const clean = problems(base, ctx);
  if (clean.length) { failed++; console.error(`FAIL the committed table is not clean: ${clean[0]}`); } else { passed++; console.log("PASS the committed table is clean"); }
  for (const [label, mutate] of mutants) {
    const t = clone(); mutate(t);
    const found = problems(t, ctx);
    if (found.length) { passed++; console.log(`PASS refuses ${label}`); } else { failed++; console.error(`FAIL did not refuse ${label}`); }
  }
  const r = resolveRoute(base, "gate-or-proof", { reviewLane: "local-codex" });
  const ok = r.complete === true && r.passes[0].effort === "max" && /first implementation/.test(r.passes[0].does) && r.passes[1].lane === "local-codex" && /review/.test(r.passes[1].does) && r.passes[2].lane === "local-claude" && /real checks/.test(r.passes[2].does) && r.passes[3].lane === "cloud-final" && r.tier === "build";
  if (ok) { passed++; console.log("PASS a routed kind runs Bonsai (max: intake, plan, first implementation) -> local review -> checks on the other local session -> cloud final"); } else { failed++; console.error("FAIL the four-pass route is wrong: " + JSON.stringify(r.passes)); }
  let laneOk = true;
  for (const bad of ["cloud-final", "cloud-claude", "", "local-claud", null, 42]) { const x = resolveRoute(base, "gate-or-proof", { reviewLane: bad }); if (!x.refused || x.passes) laneOk = false; }
  if (laneOk) { passed++; console.log("PASS an unsupported pass-2 lane (cloud-final, cloud-claude, empty, misspelled, null, number) is refused with no passes"); } else { failed++; console.error("FAIL an unsupported pass-2 lane produced a route"); }
  const nb = resolveRoute(base, "gate-or-proof", { localLlmAvailable: false });
  if (nb.complete === false && nb.passes[0].missing === true) { passed++; console.log("PASS a missing local LLM build is a missing pass 1 and the route is not complete"); } else { failed++; console.error("FAIL a missing Bonsai build was folded into a complete route"); }
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
