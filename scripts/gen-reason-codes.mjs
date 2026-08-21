#!/usr/bin/env node
// Generate docs/REASON_CODES.md — the reason-code catalog for the Assist gate.
// The vocabulary IS the product surface (embedded-UX law: the host app renders
// the worker's message from the verdict + reason codes), so this catalog is
// generated, never hand-written — and after the assurance review proved the
// first regex version wrong three ways (mis-paired verdicts, spread-inherited
// outcomes collapsing to "—", a module partition that put five draft-only
// rules under a route that cannot emit them), the ground truth now comes from
// THE ENGINE: scripts/src/dump-reason-truth.ts imports the exported rule
// tables, enumerates the seeded control plane's ACTIVE policy versions, and
// lists the resolution descriptors. This file formats what the engine says.
//
//   node scripts/gen-reason-codes.mjs          # regenerate the catalog
//
// scripts/check-reason-codes.mjs holds the committed file to BYTE EQUALITY
// with a fresh generation (plus the OpenAPI list) — hand-edits of any cell
// fail, not just code-name drift.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FILES = {
  "lib/signalgrid-core/src/decision.ts": "decision",
  "lib/signalgrid-core/src/policy.ts": "policy",
  "lib/signalgrid-core/src/continuity.ts": "continuity",
  "lib/signalgrid-core/src/resolution.ts": "resolution",
};
const CODE_LIT = /"([A-Z][A-Z0-9_]{4,})"/g;

export function runTruthDump() {
  const out = execFileSync("npx", ["tsx", "scripts/src/dump-reason-truth.ts"], { encoding: "utf8" });
  return JSON.parse(out);
}

/** Emit sites + parse problems. Every ALL_CAPS string literal anywhere inside
 *  a reasonCodes.push(...)/.add(...) argument list counts (the ternary shape
 *  at continuity.ts:282 hid two real codes from the literal-after-paren
 *  version); an argument list with NO literal — a named constant, template
 *  literal, or concatenation — is a PARSE PROBLEM the gate fails on, because
 *  a code built at runtime is a code no catalog can promise. */
export function parseEmitSet() {
  const codes = new Map(); // code -> {files:Set}
  const problems = [];
  const add = (code, file) => {
    if (!codes.has(code)) codes.set(code, { files: new Set() });
    codes.get(code).files.add(FILES[file]);
  };
  for (const file of Object.keys(FILES)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/reasonCode:\s*"([A-Z][A-Z0-9_]{4,})"/g)) add(m[1], file);
    for (const m of src.matchAll(/reasonCodes\.(?:push|add|unshift)\(/g)) {
      // balanced-paren argument extraction
      let i = m.index + m[0].length, depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") depth -= 1;
        i += 1;
      }
      const args = src.slice(m.index + m[0].length, i - 1);
      const lits = [...args.matchAll(CODE_LIT)].map((x) => x[1]);
      for (const c of lits) add(c, file);
      // The ONE sanctioned non-literal: policy.ts pushes rule.reasonCode
      // verbatim — the tenant-authored open set the catalog documents by
      // name. Everything else non-literal is a code no catalog can promise.
      if (args.trim() === "rule.reasonCode") continue;
      if (lits.length === 0 || args.includes("`") || /"\s*\+|\+\s*"/.test(args)) {
        const line = src.slice(0, m.index).split("\n").length;
        problems.push(`${file}:${line} constructs a reason code non-literally (${args.trim().slice(0, 60)}…) — a runtime-built code is a code no catalog can promise; use literals`);
      }
    }
    if (file.endsWith("resolution.ts")) {
      const d = /DESCRIPTORS[^=]*=\s*{([\s\S]*?)\n};/.exec(src);
      if (d) for (const k of d[1].matchAll(/\n  ([A-Z][A-Z0-9_]{4,}):\s*{/g)) add(k[1], file);
    }
  }
  return { codes, problems };
}

/** Worker/operator text — the one thing not exported (static strings in
 *  DESCRIPTORS). Regex here is safe: fields are plain quoted strings. */
export function parseDescriptorText() {
  const src = readFileSync("lib/signalgrid-core/src/resolution.ts", "utf8");
  const out = new Map();
  const d = /DESCRIPTORS[^=]*=\s*{([\s\S]*?)\n};/.exec(src);
  if (!d) return out;
  for (const e of d[1].matchAll(/\n  ([A-Z][A-Z0-9_]{4,}):\s*{([\s\S]*?)\n  }/g)) {
    const f = (name) => {
      const m = new RegExp(`${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(e[2]);
      return m ? m[1].replace(/\\"/g, '"') : null;
    };
    out.set(e[1], { worker: f("workerAction"), operator: f("operatorAction") });
  }
  return out;
}

export function parseFixtures() {
  const src = readFileSync("lib/signalgrid-core/src/seed.ts", "utf8");
  const out = new Map(); // code -> {name, outcomes:Set}
  for (const m of src.matchAll(
    /name:\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,400}?expectedOutcome:\s*"(allow|step_up|restrict|deny)"[\s\S]{0,200}?expectedReasonCode:\s*"([A-Z][A-Z0-9_]{4,})"/g,
  )) {
    if (!out.has(m[3])) out.set(m[3], { name: m[1], outcomes: new Set() });
    out.get(m[3]).outcomes.add(m[2]);
  }
  return out;
}

// Engine-level push sites (not rule-table entries): their verdict is what the
// emitting code path does, cited — never guessed from a text window.
const ENGINE_PUSH = {
  NO_RULE_MATCHED_DEFAULT_STEP_UP: { verdicts: "step_up", cite: "policy.ts fail-closed default when no rule matches" },
  ALLOW_SUPPRESSED_DEGRADED_EVIDENCE: { verdicts: "step_up", cite: "policy.ts guardrail — a matched allow is suppressed to step_up on degraded evidence" },
  // Verified by executing reconcileDecisions (assurance review, 2026-08-21):
  // an offline standing bound exceeded — or unstated — steps the decision up.
  // Pinned independently by scripts/src/decision-continuity-proof.ts:223,228.
  OFFLINE_STANDING_AGE_UNSTATED: { verdicts: "step_up", cite: "continuity.ts standing-bound check, engine-executed" },
  OFFLINE_STANDING_BOUND_EXCEEDED: { verdicts: "step_up", cite: "continuity.ts standing-bound check, engine-executed" },
};

export function buildCatalog(truth = runTruthDump()) {
  const { codes, problems } = parseEmitSet();
  const text = parseDescriptorText();
  const fixtures = parseFixtures();
  const descByCode = new Map(truth.descriptors.map((d) => [d.reasonCode, d]));
  const active = new Set(truth.activeCodes);
  const draftOnly = new Set(truth.draftOnlyCodes);
  const contradictions = [];
  const rows = [];
  for (const [code, info] of [...codes.entries()].sort()) {
    const ro = truth.ruleOutcomes[code];
    let verdicts;
    if (ro) {
      const parts = [];
      if (ro.v1) parts.push(ro.v1 === ro.v2 || !ro.v2 ? ro.v1 : `${ro.v1} (v1)`);
      if (ro.v2 && ro.v2 !== ro.v1) parts.push(`${ro.v2} (v2 draft)`);
      verdicts = parts.join(", ");
    } else if (ENGINE_PUSH[code]) {
      verdicts = ENGINE_PUSH[code].verdicts;
    } else if (code === "TRUST_ESTABLISHED") {
      verdicts = "allow";
    } else {
      verdicts = "—";
    }
    // Fixture cross-check BEFORE any repair: a fixture expecting an outcome
    // the rule tables (any version) and engine pushes cannot produce is a
    // genuine contradiction and FAILS generation — never silently unioned.
    const fx = fixtures.get(code);
    if (fx) {
      for (const o of fx.outcomes) {
        const known = new Set([ro?.v1, ro?.v2, ENGINE_PUSH[code]?.verdicts, code === "TRUST_ESTABLISHED" ? "allow" : null].filter(Boolean));
        if (known.size > 0 && !known.has(o)) {
          contradictions.push(`fixture "${fx.name.slice(0, 60)}" expects ${o} for ${code}, but the rule tables/engine produce ${[...known].join("/")}`);
        }
      }
    }
    const d = descByCode.get(code);
    // Section = which ROUTE can surface the code, not which file holds it:
    // active-policy rules and evaluate-path engine pushes are launch; the v2
    // draft rules are test-route-only; continuity/resolution emissions ride
    // deferred routes even when their verdict is engine-verified.
    const evaluatePath = info.files.has("policy") || info.files.has("decision");
    let section;
    if (active.has(code) || (ENGINE_PUSH[code] && evaluatePath)) section = "launch";
    else if (draftOnly.has(code)) section = "draft";
    else section = "deferred";
    // rule codes in NO seeded version but in the tables? (defensive)
    if (ro && !active.has(code) && !draftOnly.has(code)) section = "deferred";
    rows.push({
      code,
      modules: [...info.files].sort().join(", "),
      section,
      verdicts,
      cls: d?.baseClass ?? null,
      worker: text.get(code)?.worker ?? null,
      operator: text.get(code)?.operator ?? null,
      fixture: fx?.name ?? null,
    });
  }
  return { rows, problems, contradictions };
}

function table(rows) {
  const out = ["| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |", "|---|---|---|---|---|---|"];
  for (const r of rows) {
    const worker =
      r.worker ??
      (r.verdicts.includes("allow") && r.cls === null
        ? "*(an allow carries no resolution step)*"
        : "*(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)*");
    out.push(`| \`${r.code}\` | ${r.verdicts} | ${r.cls ?? "*(none)*"} | ${worker} | ${r.operator ?? "—"} | ${r.fixture ? `\`${r.fixture.slice(0, 60)}\`` : "—"} |`);
  }
  return out.join("\n");
}

export function buildMarkdown(catalog) {
  const { rows } = catalog;
  const launch = rows.filter((r) => r.section === "launch");
  const draft = rows.filter((r) => r.section === "draft");
  const deferred = rows.filter((r) => r.section === "deferred");
  const noDesc = rows.filter((r) => !r.cls && !(r.verdicts.includes("allow") && r.cls === null && r.worker === null));
  const gapCount = rows.filter((r) => !r.cls).length;

  return `# Reason codes — the Assist gate's verdict vocabulary

Generated from the ENGINE by \`node scripts/gen-reason-codes.mjs\` (rule
tables, seeded active policy versions and resolution descriptors are read at
runtime via \`scripts/src/dump-reason-truth.ts\`; only the descriptor prose is
read from source text). Do not edit ANY cell by hand:
\`scripts/check-reason-codes.mjs\` requires byte equality with a fresh
generation, so every column is protected, not just the code names.

Under the embedded-UX law the verdict plus its reason codes ARE the product
surface: the host app renders the worker's message from them, so this catalog
is the contract a host-app developer builds against.

**${rows.length} codes** the decision core can emit: ${launch.length} reachable
through the launch evaluate surface, ${draft.length} only via the draft-policy
test route, ${deferred.length} only through deferred routes. Worker/operator
language comes from the engine's own resolution descriptors; a code without a
descriptor is marked, because that gap is real behavior — the resolution
planner silently drops descriptor-less codes from its plan today (role-lens
review, engineering.2; tracked work).

Tenant-authored policy rules may carry **custom reason codes** — the set is
open by construction (\`policy.ts\` pushes \`rule.reasonCode\` verbatim), which
is why the published API contract types \`reasonCodes\` as strings with this
catalog as the engine-emitted vocabulary, NOT a closed enum: an enum would
falsify the contract for every tenant with a custom rule.

## Launch-surface codes (an ACTIVE seeded policy or an engine-level push — reachable via \`POST /v1/decisions/evaluate\`)

${table(launch)}

## Draft-policy codes (v2 strict rules — reachable ONLY via \`GET /v1/policies/{id}/tests?versionId=…\`, a launch route; \`evaluate\` resolves the active version and cannot emit these)

The v2 strict rule set is seeded as a **draft** in every tenant, and both
routes that could activate it are deferred under the launch profile — so
these codes surface exclusively through the policy-test route, never on a
live decision.

${table(draft)}

## Deferred-path codes (emitted only by deferred routes)

Minted by \`POST /v1/decisions/reconcile\` (continuity) and the resolution
planner's battery assessment (\`/v1/decisions/{id}/resolution\`, \`/resolve\`) —
all outside the launch profile's GA allowlist. Catalogued so a host app that
later adopts those routes has the contract, and partitioned so nobody reads
them as launch surface.

${table(deferred)}

## The descriptor gap, stated

${gapCount} of ${rows.length} codes have no resolution descriptor. For the
non-allow ones, \`buildResolutionPlan\` silently omits the code from the plan —
a DENY carrying only descriptor-less codes reports itself self-service and
auto-resolvable (executed counterexample in the role-lens review,
engineering.2). Until that is fixed, host apps must render the VERDICT as
the primary signal and treat the resolution plan as advisory.

## History

The previous mapping (\`docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md\` §2.1/§2.2,
now corrected) named four codes the engine has never emitted —
DEVICE_POSTURE_STALE, IDENTITY_UNVERIFIED, WRONG_BAY_OR_CUSTODY,
CRITICAL_ON_UNTRUSTED_DEVICE — absence corroborated four ways per code via
\`pnpm run check:absence\` (the real counterparts are \`POSTURE_STALE\` and
\`CRITICAL_WORKFLOW_UNTRUSTED_DEVICE\`). A design partner implementing that
table would have shipped messages that never fire. The first generated
version of THIS catalog then under-counted by two (a ternary emit shape the
parser missed — OFFLINE_STANDING_AGE_UNSTATED and
OFFLINE_STANDING_BOUND_EXCEEDED) and mis-partitioned the five \`*_STRICT\`
draft codes as evaluate-reachable; the org's assurance review caught both,
and the generator now reads the engine instead of regexing near it.
`;
}

function generate() {
  const catalog = buildCatalog();
  if (catalog.problems.length || catalog.contradictions.length) {
    for (const p of [...catalog.problems, ...catalog.contradictions]) console.error(`  ✗ ${p}`);
    console.error("Refusing to generate from a tree with parse problems or fixture contradictions.");
    process.exit(1);
  }
  writeFileSync("docs/REASON_CODES.md", buildMarkdown(catalog));
  const { rows } = catalog;
  console.log(
    `Generated docs/REASON_CODES.md: ${rows.length} codes (${rows.filter((r) => r.section === "launch").length} launch, ${rows.filter((r) => r.section === "draft").length} draft-route, ${rows.filter((r) => r.section === "deferred").length} deferred)`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) generate();
