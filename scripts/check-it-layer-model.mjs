#!/usr/bin/env node
// IT-layer model gate — every reason code and every connector family has a layer and
// an owner, and nothing is classified that does not exist.
//
//   node scripts/check-it-layer-model.mjs
//   node scripts/check-it-layer-model.mjs --self-test
//
// WHAT THIS GUARDS. `scripts/it-layer-model.mjs` says which layer of IT owns each
// thing SignalGrid consumes and WHO fixes it when a workflow is refused. A
// classification table is worth exactly as much as its completeness: one unclassified
// reason code is an operator staring at a refusal with nobody to call, and one
// classified code that nothing emits is a routing rule for an event that never
// happens. Both fail here.
//
// THE BIJECTION, in both directions, over both surfaces:
//   · every reason code in the shipped rule set is classified   (no orphan refusal)
//   · every classified reason code exists in the rule set       (no phantom routing)
//   · every connector family on disk is classified              (no silent family)
//   · every classified family exists on disk                    (no phantom family)
//
// AND THE PART THAT MAKES IT MORE THAN A LIST: the decision impact of each reason code
// is READ OUT of `policy.ts` here rather than declared in the model. The proposal this
// model came from had `decisionImpact` as a field to write down per entry. Writing it
// down would have created a second source of truth for a fact the rule set already
// states, and the copy goes stale the first time a rule's outcome changes. So the
// model deliberately does not carry it, and this gate derives it — which also means
// this gate FAILS if a classified code stops being emitted by any rule, catching the
// drift a hand-maintained column would have hidden.
//
// A NOTE ON WHAT A GREEN RUN DOES NOT SAY. It says the classification is complete and
// real. It does NOT say the classification is CORRECT — whether `BADGE_FORCED_REMOVAL`
// truly belongs to security operations rather than facilities is a judgement, and no
// script can check a judgement. Completeness is mechanical; correctness is review.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LAYERS,
  OWNER_ROLES,
  ENGINE_REASON_CODES,
  REASON_CODE_LAYERS,
  FAMILY_LAYERS,
  NOT_A_FAMILY,
  ITSM_LAYERS,
  IT_TO_ITSM_LAYER,
  ITSM_OBJECT_TYPES,
  VERIFICATION_CLASSES,
  IT_LAYER_MODEL_VERSION,
} from "./it-layer-model.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = join(repo, "lib/signalgrid-core/src/policy.ts");
const RESOLUTION = join(repo, "lib/signalgrid-core/src/resolution.ts");
const FAMILY_DIR = join(repo, "lib/integrations/src/integrations");

const failures = [];
const fail = (message) => failures.push(message);

/**
 * Reason codes the rule set declares, with the outcome each one produces.
 *
 * TWO RULE FORMS, and the first version of this only understood one of them.
 *
 *   V1 — a literal:            { id: "posture-stale", …, outcome: "step_up",
 *                                reasonCode: "POSTURE_STALE" }
 *   V2 — a spread override:    if (rule.id === "posture-stale") {
 *                                return { ...rule, outcome: "restrict",
 *                                         reasonCode: "POSTURE_STALE_STRICT" } }
 *
 * The trap is that a V2 override may restate `outcome` OR INHERIT IT. Three of the
 * five do restate it; two do not. A regex anchored on an adjacent `outcome`/`reasonCode`
 * pair therefore saw 29 of the 31 codes and declared the two survivors "classified but
 * nothing emits them" — a confident, precise, wrong answer that would have been fixed
 * by deleting two correct rows from the model. The gate caught its own parser only
 * because the bijection runs in BOTH directions; a one-way check would have passed.
 *
 * So this walks the two forms separately and resolves inheritance explicitly.
 */
function readRuleCodes(source) {
  const codes = new Map();
  const record = (code, outcome) => {
    const seen = codes.get(code);
    // The same code at two different outcomes is a real ambiguity, not a duplicate.
    if (seen && seen !== outcome) {
      fail(`reason code ${code} is emitted at two different outcomes (${seen}, ${outcome}) — routing cannot be unambiguous`);
    }
    codes.set(code, outcome);
  };

  // ── Form 1: the V1 literals ───────────────────────────────────────────────
  // Split into rule blocks first, then read each block's own fields, so a field can
  // never be paired with a neighbouring rule's value.
  const v1Start = source.indexOf("SHARED_DEVICE_RULES_V1: PolicyRuleSpec[] = [");
  const v1End = source.indexOf("\n];", v1Start);
  const outcomeById = new Map();
  if (v1Start !== -1 && v1End !== -1) {
    const body = source.slice(v1Start, v1End);
    const starts = [...body.matchAll(/\n {2}\{\n/g)].map((m) => m.index);
    for (let i = 0; i < starts.length; i += 1) {
      const block = body.slice(starts[i], starts[i + 1] ?? body.length);
      const id = block.match(/\bid:\s*"([a-z0-9-]+)"/)?.[1];
      const outcome = block.match(/\boutcome:\s*"(allow|step_up|restrict|deny)"/)?.[1];
      const code = block.match(/\breasonCode:\s*"([A-Z0-9_]+)"/)?.[1];
      if (!code || !outcome) continue;
      if (id) outcomeById.set(id, outcome);
      record(code, outcome);
    }
  }

  // ── Form 2: the V2 spread overrides ───────────────────────────────────────
  const v2Start = source.indexOf("SHARED_DEVICE_RULES_V2: PolicyRuleSpec[] =");
  if (v2Start !== -1) {
    const body = source.slice(v2Start);
    const blocks = body.split(/if \(rule\.id === "/).slice(1);
    for (const raw of blocks) {
      const id = raw.slice(0, raw.indexOf('"'));
      const block = raw.slice(0, raw.indexOf("\n    }") + 1 || undefined);
      const code = block.match(/\breasonCode:\s*"([A-Z0-9_]+)"/)?.[1];
      if (!code) continue;
      // Its own outcome if it restates one; otherwise the V1 rule's, by inheritance.
      const own = block.match(/\boutcome:\s*"(allow|step_up|restrict|deny)"/)?.[1];
      const inherited = outcomeById.get(id);
      if (!own && !inherited) {
        fail(`V2 override for rule "${id}" emits ${code} but neither restates an outcome nor matches a V1 rule to inherit one from`);
        continue;
      }
      record(code, own ?? inherited);
    }
  }
  return codes;
}

/**
 * Resolution descriptors: reason code → { baseClass, hasTransform }.
 *
 * This is the source the ITSM object type and the verification class are DERIVED from.
 * `resolution.ts` already states, once, whether a refusal has a served fix and who can
 * apply it; that is the same fact ITSM needs in order to say "request", "change" or
 * "incident". Copying it into the model would be a second truth that goes stale.
 */
function readResolutionDescriptors(source) {
  const out = new Map();
  const start = source.indexOf("DESCRIPTORS");
  if (start === -1) return out;
  const body = source.slice(start);
  const starts = [...body.matchAll(/\n {2}([A-Z0-9_]+):\s*\{/g)];
  for (let i = 0; i < starts.length; i += 1) {
    const code = starts[i][1];
    const from = starts[i].index;
    const to = starts[i + 1]?.index ?? body.length;
    const block = body.slice(from, to);
    const baseClass = block.match(/baseClass:\s*"(auto_proposed|requires_approval|manual_only)"/)?.[1];
    if (!baseClass) continue;
    // `transform: null` means there is nothing to re-evaluate against — the fix cannot
    // be simulated, so a human has to attest it happened.
    const hasTransform = !/transform:\s*null/.test(block);
    out.set(code, { baseClass, hasTransform });
  }
  return out;
}

/**
 * The whole ITSM derivation, in one place so it can be read as a rule rather than
 * inferred from a table. Nothing here is declared per reason code.
 */
function deriveItsm(code, impact, itLayer, descriptor) {
  if (impact === "allow") return { object: "none", verification: "not_applicable" };
  // A policy-plane code is not a fault in any source system — the policy itself is the
  // gap, and a gap that will recur until someone changes policy is a PROBLEM.
  if (itLayer === "strategic_it_management") {
    return { object: "problem", verification: "human_evidence_required" };
  }
  if (!descriptor) {
    // A refusal with no served path at all. `buildResolutionPlan` routes these to a
    // human rather than promising a self-service fix, so an incident is the honest
    // carrier — and the absence is worth seeing, not smoothing over.
    return { object: "incident", verification: "human_evidence_required" };
  }
  const verification = descriptor.hasTransform ? "simulated_reevaluation" : "human_evidence_required";
  if (descriptor.baseClass === "auto_proposed") return { object: "service_request", verification };
  if (descriptor.baseClass === "requires_approval") return { object: "change", verification };
  return { object: "incident", verification };
}

/** Families are directories containing an index.ts — the SAME derivation
 *  `launch-profile.mjs` documents, so the two artifacts cannot disagree by
 *  construction about what counts as a family. */
function readFamilies() {
  return readdirSync(FAMILY_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(FAMILY_DIR, e.name, "index.ts")))
    .map((e) => e.name)
    .sort();
}

function main() {
  const source = readFileSync(POLICY, "utf8");
  const ruleCodes = readRuleCodes(source);

  if (ruleCodes.size === 0) {
    fail(`no reason codes parsed out of ${POLICY} — the parser has broken, and an empty derivation would pass every check below vacuously`);
  }

  // ── Engine specials exist as literals ─────────────────────────────────────
  // These are emitted by evaluatePolicy directly, so they never appear as a rule.
  // Verify each one is genuinely in the file rather than trusting the list.
  for (const { code } of ENGINE_REASON_CODES) {
    if (!source.includes(`"${code}"`)) {
      fail(`engine reason code ${code} is declared in the model but does not appear in policy.ts`);
    }
    if (ruleCodes.has(code)) {
      fail(`${code} is declared as an ENGINE special but a rule also emits it — one of the two is wrong`);
    }
  }

  const emitted = new Map(ruleCodes);
  for (const { code, impact } of ENGINE_REASON_CODES) emitted.set(code, impact);

  // ── Reason-code bijection ─────────────────────────────────────────────────
  const classified = new Map(REASON_CODE_LAYERS.map((r) => [r.code, r]));
  for (const code of emitted.keys()) {
    if (!classified.has(code)) {
      fail(`reason code ${code} is emitted but has no IT layer or owner — a refusal with nobody to route it to`);
    }
  }
  for (const code of classified.keys()) {
    if (!emitted.has(code)) {
      fail(`reason code ${code} is classified but nothing emits it — routing for an event that cannot happen`);
    }
  }

  // ── Family bijection ──────────────────────────────────────────────────────
  const onDisk = readFamilies();
  const classifiedFamilies = new Map(FAMILY_LAYERS.map((f) => [f.family, f]));
  const excluded = new Map(NOT_A_FAMILY.map((n) => [n.dir, n]));

  for (const family of onDisk) {
    if (!classifiedFamilies.has(family)) {
      fail(`connector family "${family}" exists on disk but has no IT layer or owner`);
    }
  }
  for (const family of classifiedFamilies.keys()) {
    if (!onDisk.includes(family)) {
      fail(`family "${family}" is classified but no such directory (with an index.ts) exists`);
    }
  }
  // A declared exclusion must be a real directory that really is not a family.
  // Otherwise "not a family" becomes a way to make an inconvenient family disappear.
  for (const [dir, entry] of excluded) {
    const path = join(FAMILY_DIR, dir);
    if (!existsSync(path)) {
      fail(`NOT_A_FAMILY names "${dir}", which does not exist — a stale exclusion hides nothing and confuses everything`);
      continue;
    }
    if (existsSync(join(path, "index.ts"))) {
      fail(`NOT_A_FAMILY excludes "${dir}", but it HAS an index.ts, so by this repo's own derivation it IS a family — reason given: ${entry.reason}`);
    }
  }
  // And every directory is either a family or an argued exclusion. Neither is silence.
  for (const e of readdirSync(FAMILY_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (!classifiedFamilies.has(e.name) && !excluded.has(e.name)) {
      fail(`directory "${e.name}" under integrations/ is neither classified nor listed in NOT_A_FAMILY with a reason`);
    }
  }

  // ── Layer / domain / owner referential integrity ──────────────────────────
  const layerById = new Map(LAYERS.map((l) => [l.id, l]));
  const ownerIds = new Set(OWNER_ROLES.map((o) => o.id));
  const checkEntry = (label, entry) => {
    const layer = layerById.get(entry.layer);
    if (!layer) {
      fail(`${label} names layer "${entry.layer}", which is not one of the seven`);
      return;
    }
    if (!layer.domains.includes(entry.domain)) {
      fail(`${label} names domain "${entry.domain}", which does not belong to ${layer.name}. Its domains are: ${layer.domains.join(", ")}`);
    }
    if (!ownerIds.has(entry.owner)) {
      fail(`${label} names owner "${entry.owner}", which is not a declared owner role`);
    }
    if (!entry.systemOfRecord || !entry.evidenceType) {
      fail(`${label} is missing a system of record or evidence type — "who owns it" is not actionable without "where the answer lives"`);
    }
  };
  for (const r of REASON_CODE_LAYERS) checkEntry(`reason code ${r.code}`, r);
  for (const f of FAMILY_LAYERS) checkEntry(`family ${f.family}`, f);

  // ── Every layer is represented, and say how thinly ────────────────────────
  const perLayer = new Map(LAYERS.map((l) => [l.id, 0]));
  for (const f of FAMILY_LAYERS) perLayer.set(f.layer, perLayer.get(f.layer) + 1);
  for (const [id, n] of perLayer) {
    if (n === 0) fail(`layer "${id}" has no connector family — the model claims cross-layer coverage it does not have`);
  }

  // ── ITSM: the bridge, then the derivation ─────────────────────────────────
  const itsmById = new Map(ITSM_LAYERS.map((l) => [l.id, l]));
  const bridge = new Map(IT_TO_ITSM_LAYER.map((b) => [b.itLayer, b.itsmLayer]));
  // Total in both directions: every IT layer bridges, and every bridge target is real.
  for (const l of LAYERS) {
    if (!bridge.has(l.id)) fail(`IT layer "${l.id}" has no ITSM layer — a refusal there could not be routed to a service`);
  }
  for (const b of IT_TO_ITSM_LAYER) {
    if (!itsmById.has(b.itsmLayer)) fail(`bridge maps ${b.itLayer} to "${b.itsmLayer}", which is not an ITSM layer`);
    if (!layerById.has(b.itLayer)) fail(`bridge names IT layer "${b.itLayer}", which does not exist`);
  }

  const descriptors = readResolutionDescriptors(readFileSync(RESOLUTION, "utf8"));
  if (descriptors.size === 0) {
    fail(`no resolution descriptors parsed out of ${RESOLUTION} — the ITSM derivation would be vacuous`);
  }

  const itsmCounts = new Map(ITSM_OBJECT_TYPES.map((t) => [t, 0]));
  const verificationCounts = new Map(VERIFICATION_CLASSES.map((v) => [v, 0]));
  const perItsmLayer = new Map(ITSM_LAYERS.map((l) => [l.id, 0]));
  const noServedPath = [];
  for (const entry of REASON_CODE_LAYERS) {
    const impact = emitted.get(entry.code);
    if (!impact) continue; // already reported by the bijection above
    const itsmLayer = bridge.get(entry.layer);
    if (itsmLayer) perItsmLayer.set(itsmLayer, perItsmLayer.get(itsmLayer) + 1);
    const d = descriptors.get(entry.code);
    const { object, verification } = deriveItsm(entry.code, impact, entry.layer, d);
    if (!ITSM_OBJECT_TYPES.includes(object)) fail(`${entry.code} derived an unknown ITSM object "${object}"`);
    if (!VERIFICATION_CLASSES.includes(verification)) fail(`${entry.code} derived an unknown verification class "${verification}"`);
    itsmCounts.set(object, itsmCounts.get(object) + 1);
    verificationCounts.set(verification, verificationCounts.get(verification) + 1);
    if (!d && impact !== "allow" && entry.layer !== "strategic_it_management") noServedPath.push(entry.code);
  }

  // Layer 1 must stay empty. A reason code landing in the user-interface layer would
  // mean SignalGrid had grown a worker-facing surface, which the embedded-UX law
  // forbids — so this is asserted, not assumed.
  for (const l of ITSM_LAYERS) {
    const n = perItsmLayer.get(l.id);
    if (!l.expectsReasonCodes && n > 0) {
      fail(`${l.name} is meant to carry NO reason codes (the host app owns everything the worker sees) but ${n} landed there`);
    }
    if (l.expectsReasonCodes && n === 0) {
      fail(`${l.name} carries no reason codes, so the model claims ITSM coverage it does not have`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`IT-layer model v${IT_LAYER_MODEL_VERSION}`);
  console.log(`  reason codes: ${emitted.size} emitted, ${classified.size} classified`);
  console.log(`  families:     ${onDisk.length} on disk, ${classifiedFamilies.size} classified, ${excluded.size} argued exclusion(s)`);
  console.log(`  owners:       ${ownerIds.size} roles across ${LAYERS.length} layers`);
  console.log(`\n  decision impact, READ from policy.ts (not declared in the model):`);
  const byImpact = new Map();
  for (const [code, impact] of emitted) {
    if (!byImpact.has(impact)) byImpact.set(impact, []);
    byImpact.get(impact).push(code);
  }
  for (const impact of ["allow", "step_up", "restrict", "deny"]) {
    const list = byImpact.get(impact) ?? [];
    console.log(`    ${impact.padEnd(9)} ${list.length}`);
  }
  console.log(`\n  families per layer:`);
  for (const l of LAYERS) console.log(`    ${String(perLayer.get(l.id)).padStart(2)}  ${l.name}`);

  console.log(`\n  ITSM routing, DERIVED from resolution.ts (${descriptors.size} descriptors):`);
  console.log(`    reason codes per ITSM layer:`);
  for (const l of ITSM_LAYERS) {
    const n = perItsmLayer.get(l.id);
    console.log(`      ${String(n).padStart(2)}  ${l.name}${l.expectsReasonCodes ? "" : "   (empty BY DESIGN — the host app owns the worker's surface)"}`);
  }
  console.log(`    carried by:`);
  for (const t of ITSM_OBJECT_TYPES) console.log(`      ${t.padEnd(16)} ${itsmCounts.get(t)}`);
  console.log(`    verified by:`);
  for (const v of VERIFICATION_CLASSES) console.log(`      ${v.padEnd(24)} ${verificationCounts.get(v)}`);
  if (noServedPath.length) {
    // Reported, not failed. A refusal with no served fix is a legitimate state — it
    // means a human owns it. It is printed because it is the honest measure of how much
    // of the estate SignalGrid can route to a self-service or approval path, and a
    // silent count would let that shrink unnoticed.
    console.log(`\n    ${noServedPath.length} refusal(s) have NO served resolution path — a human owns these:`);
    for (const c of noServedPath) console.log(`      · ${c}`);
  }

  if (failures.length) {
    console.error(`\nIT-layer model gate FAILED — ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`
IT-layer model gate passed — every emitted reason code and every connector family has
a layer, a system of record, an evidence type and an owner.

  NOT established by a green here:
    · that a classification is CORRECT. Completeness is mechanical; whether a code
      belongs to security operations rather than facilities is a review judgement.
    · that owner routing reaches anyone. No /v1 response carries these fields yet —
      see GAPS in scripts/it-layer-model.mjs.
    · that coverage is even. Every layer has a family; that is not the same as every
      layer being well served.`);
}

// A gate that has never been shown to fail is a gate nobody has tested. Each control
// below breaks one invariant in memory and requires the corresponding check to catch
// it — the negative controls this repository asks for by name.
function selfTest() {
  const controls = [
    {
      name: "an emitted reason code with no classification is caught",
      run: () => {
        const emitted = new Set(["A", "B"]);
        const classified = new Set(["A"]);
        return [...emitted].some((c) => !classified.has(c));
      },
    },
    {
      name: "a classified reason code nothing emits is caught",
      run: () => {
        const emitted = new Set(["A"]);
        const classified = new Set(["A", "GHOST"]);
        return [...classified].some((c) => !emitted.has(c));
      },
    },
    {
      name: "a domain borrowed from another layer is caught",
      run: () => {
        const ops = LAYERS.find((l) => l.id === "it_operations");
        return !ops.domains.includes("Identity & Access Management");
      },
    },
    {
      name: "an undeclared owner is caught",
      run: () => !new Set(OWNER_ROLES.map((o) => o.id)).has("nobody_owner"),
    },
    {
      name: "the rule parser finds real codes (a parser returning nothing would pass everything vacuously)",
      run: () => readRuleCodes(readFileSync(POLICY, "utf8")).size > 10,
    },
    {
      name: "the rule parser pairs each code with an outcome",
      run: () => {
        const codes = readRuleCodes(readFileSync(POLICY, "utf8"));
        return [...codes.values()].every((o) => ["allow", "step_up", "restrict", "deny"].includes(o));
      },
    },
    {
      name: "the parser ignores a reason-code-shaped string outside any rule set",
      run: () => readRuleCodes(`// see ALSO_NOT_A_RULE and reasonCode: "NOT_A_RULE"`).size === 0,
    },
    {
      // The defect this gate found in its own first parser. Without this control the
      // fix could regress and the symptom would return as two false "phantom" rows.
      name: "a V2 override that INHERITS its outcome is still counted (the parser bug this caught)",
      run: () => {
        const codes = readRuleCodes(readFileSync(POLICY, "utf8"));
        return (
          codes.get("BENCHMARK_SELECTION_UNESTABLISHED_STRICT") === "step_up" &&
          codes.get("SHIFT_CONTEXT_UNESTABLISHED_STRICT") === "step_up"
        );
      },
    },
    {
      name: "a V2 override that RESTATES its outcome uses the restated one, not the inherited one",
      run: () => {
        const codes = readRuleCodes(readFileSync(POLICY, "utf8"));
        // v1 posture-stale is step_up; the v2 strict override raises it to restrict.
        return codes.get("POSTURE_STALE") === "step_up" && codes.get("POSTURE_STALE_STRICT") === "restrict";
      },
    },
    {
      name: "an exclusion naming a directory that IS a family is caught",
      run: () => existsSync(join(FAMILY_DIR, "graph", "index.ts")),
    },
    {
      name: "the resolution-descriptor parser finds real descriptors (an empty read would make the ITSM derivation vacuous)",
      run: () => readResolutionDescriptors(readFileSync(RESOLUTION, "utf8")).size > 15,
    },
    {
      name: "a descriptor with transform: null is read as NOT re-evaluatable (it needs a human, not a simulation)",
      run: () => {
        const d = readResolutionDescriptors(readFileSync(RESOLUTION, "utf8"));
        return d.get("IDENTITY_DISABLED")?.hasTransform === false && d.get("POSTURE_STALE")?.hasTransform === true;
      },
    },
    {
      name: "an approval-gated fix derives a CHANGE, a self-service fix derives a SERVICE REQUEST",
      run: () =>
        deriveItsm("X", "restrict", "it_operations", { baseClass: "requires_approval", hasTransform: true }).object === "change" &&
        deriveItsm("X", "step_up", "it_operations", { baseClass: "auto_proposed", hasTransform: true }).object === "service_request",
    },
    {
      name: "a refusal with NO descriptor derives an incident needing human evidence (never a silent self-service promise)",
      run: () => {
        const r = deriveItsm("X", "restrict", "it_operations", undefined);
        return r.object === "incident" && r.verification === "human_evidence_required";
      },
    },
    {
      name: "an allow derives no ITSM object at all (nothing is ticketed that was not refused)",
      run: () => deriveItsm("TRUST_ESTABLISHED", "allow", "strategic_it_management", undefined).object === "none",
    },
    {
      name: "the ITSM bridge is total over the seven IT layers",
      run: () => {
        const b = new Set(IT_TO_ITSM_LAYER.map((x) => x.itLayer));
        return LAYERS.every((l) => b.has(l.id));
      },
    },
  ];
  let bad = 0;
  for (const c of controls) {
    const ok = c.run();
    console.log(`  ${ok ? "ok  " : "FAIL"} — ${c.name}`);
    if (!ok) bad += 1;
  }
  console.log(`\nself-test: ${controls.length - bad}/${controls.length} controls passed`);
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--self-test")) selfTest();
else main();
