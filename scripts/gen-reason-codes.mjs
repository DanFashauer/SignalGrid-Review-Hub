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
// EXPORTED so a self-test cannot assert against a code shape this parser could
// never produce: the first near-collision vector written against this gate was
// "TRUST-ESTABLISHED", and a hyphen is outside this character class — the gate was
// being self-tested on a string it can never see.
export const CODE_LIT = /"([A-Z][A-Z0-9_]{4,})"/g;

export function runTruthDump() {
  // The workspace's OWN tsx, by absolute path — not `npx tsx`, which resolves
  // opportunistically (local .bin, then PATH, then a network install) and
  // stopped resolving at all after a lockfile change altered hoisting. The
  // scripts package declares tsx, so this path exists on every lane that ran
  // `pnpm install`, and nothing is fetched at gate time.
  const tsx = new URL("./node_modules/.bin/tsx", import.meta.url).pathname;
  const out = execFileSync(tsx, ["scripts/src/dump-reason-truth.ts"], { encoding: "utf8" });
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

/** The FIXTURE SIMULATOR's own reason-code vocabulary (2026-09-02, verdict-core
 *  finding V4). `lib/signalgrid-simulator/src/decisionEngine.ts` is a separate
 *  engine from the launch core: it emits codes the catalog above never named, and
 *  `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is a byte-faithful
 *  port of it (CLAUDE.md golden rule 1), so its vocabulary is what an iOS reader
 *  sees. Parsed with the SAME balanced-paren technique as the core emit set — the
 *  ternary emit shape at decisionEngine.ts:260 has two literals in one push, and a
 *  literal-after-paren parser would have missed both.
 *
 *  NOTHING here edits or imports the engine; it is read as text. */
export const SIMULATOR_ENGINE = "lib/signalgrid-simulator/src/decisionEngine.ts";

export function parseSimulatorVocabulary(coreCodes) {
  const src = readFileSync(SIMULATOR_ENGINE, "utf8");
  const codes = new Set();
  const problems = [];
  for (const m of src.matchAll(/reasonCodes\.(?:push|add|unshift)\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
      i += 1;
    }
    const args = src.slice(m.index + m[0].length, i - 1);
    const lits = [...args.matchAll(CODE_LIT)].map((x) => x[1]);
    for (const c of lits) codes.add(c);
    if (lits.length === 0 || args.includes("`") || /"\s*\+|\+\s*"/.test(args)) {
      const line = src.slice(0, m.index).split("\n").length;
      problems.push(`${SIMULATOR_ENGINE}:${line} constructs a simulator reason code non-literally (${args.trim().slice(0, 60)}…)`);
    }
  }
  const all = [...codes].sort();
  const core = new Set(coreCodes);
  // Two codes that differ ONLY by punctuation, case or underscore are one code
  // wearing two spellings across two engines — the live pair is
  // DEVICE_NON_COMPLIANT (simulator) vs DEVICE_NONCOMPLIANT (core). Derived, so a
  // second one cannot appear quietly.
  const normalize = (code) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNormalizedCore = new Map(coreCodes.map((c) => [normalize(c), c]));
  const nearCollisions = [];
  for (const code of all) {
    const twin = byNormalizedCore.get(normalize(code));
    if (twin && twin !== code) nearCollisions.push({ simulator: code, core: twin });
  }
  return {
    codes: all,
    shared: all.filter((c) => core.has(c)),
    simulatorOnly: all.filter((c) => !core.has(c)),
    nearCollisions,
    problems,
  };
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
  const simulator = parseSimulatorVocabulary(rows.map((r) => r.code));
  return { rows, problems: [...problems, ...simulator.problems], contradictions, simulator };
}

function table(rows) {
  const out = ["| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |", "|---|---|---|---|---|---|"];
  for (const r of rows) {
    const worker =
      r.worker ??
      (r.verdicts.includes("allow") && r.cls === null
        ? "*(an allow carries no resolution step)*"
        : "*(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)*");
    out.push(`| \`${r.code}\` | ${r.verdicts} | ${r.cls ?? "*(none)*"} | ${worker} | ${r.operator ?? "—"} | ${r.fixture ? `\`${r.fixture.slice(0, 60)}\`` : "—"} |`);
  }
  return out.join("\n");
}

export function buildMarkdown(catalog) {
  const { rows, simulator } = catalog;
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
planner has no step to offer for such a code, and since 2026-09-02 it says so
instead of staying quiet (see the note below).

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

${gapCount} of ${rows.length} codes have no resolution descriptor, so
\`buildResolutionPlan\` has no STEP to offer for them. What changed on
2026-09-02 (verdict-core finding V9) is that it no longer stays quiet about it.

Before: a descriptor-less code was skipped and left no trace, so a DENY carrying
only such codes came back with \`path: "self_service"\` — the wrong word for a
block nobody can clear. (\`autoResolvable\` was already false in that case, because
it requires at least one step; the role-lens review's phrasing that it reported
"self-service AND auto-resolvable" was half right, and the half that was wrong is
corrected here rather than repeated.)

Now: the plan carries \`unresolvedCodes: string[]\` — the codes on a non-allow
decision that have no descriptor — and while that list is non-empty the plan is
\`path: "escalation"\`, \`autoResolvable: false\`, and \`summaryForOperator\` names
the codes. A code contributed by a rule whose own outcome was \`allow\`
(\`TRUST_ESTABLISHED\` rides along on most restrict/step-up decisions) is an
affirmative finding, not an unanswered block, and is excluded — derived from the
decision's own \`matchedRules\`, not from a list anyone maintains. The exclusion is
keyed on the CONTRIBUTING RULE, not on the code's spelling: reason codes are not
unique to a rule, so one allow rule sharing a code with a deny rule would otherwise
have disappeared the deny's own unanswerable block. Both pinned by
\`pnpm run proof:signalgrid-core\`.

Host apps should still render the VERDICT as the primary signal: a plan with
unresolved codes tells the worker a person is needed, not what to do.

## Published fields with no in-repo reader (REPORTED, measured 2026-09-02)

Four fields are serialized onto \`/v1\` responses and read by nothing in this
repository. That is not a defect — a published contract may legitimately have no
in-repo consumer — but it means NO in-repo test constrains their content, so a
change to any of them breaks only the host app that depends on it. Stated so a
host-app developer knows which fields are unexercised here.

Measured, not assumed, with (results quoted after each field):

\`\`\`
grep -rn "\\b<field>\\b" --include=*.ts --include=*.tsx --include=*.mjs --include=*.swift \\
  lib scripts artifacts native tests tools site | grep -v node_modules
\`\`\`

| Field | Declared | Minted | In-repo reader |
|---|---|---|---|
| \`SignalGridDecision.confidence\` (simulator) | \`lib/signalgrid-simulator/src/types.ts:150\` | \`lib/signalgrid-simulator/src/decisionEngine.ts:292\` | none — \`scripts/src/signalgrid-grid-proof.ts:988\` COPIES it into an output object and asserts nothing about it |
| \`ResolutionPlan.summaryForOperator\` | \`lib/signalgrid-core/src/types.ts\` | \`lib/signalgrid-core/src/resolution.ts\` | one, added 2026-09-02: \`scripts/src/signalgrid-core-proof.ts\` asserts it NAMES an unresolved reason code. Nothing reads the rest of the sentence |
| \`ResolutionSimulation.projectedReasonCodes\` | \`lib/signalgrid-core/src/types.ts\` | \`lib/signalgrid-core/src/resolution.ts\` | none — declaration and mint site only |
| \`ResolutionStep.clears\` | \`lib/signalgrid-core/src/types.ts\` | \`lib/signalgrid-core/src/resolution.ts\` | none — every other \`clears\` match in the tree is unrelated prose |

REPORTED, not gated: this is a measurement with a date on it, not an invariant. A
reader added tomorrow does not fail anything; re-run the command above rather than
trusting this table's age.

## Simulator vocabulary — a DIFFERENT engine's codes, catalogued so nobody reads them as the core's

The tables above are the **launch decision core** (\`lib/signalgrid-core\`). The
**fixture simulator** — \`${SIMULATOR_ENGINE}\` — is a second, separate engine.
It emits its own ${simulator.codes.length} reason codes. ${simulator.shared.length} of them the core also emits
(${simulator.shared.map((c) => `\`${c}\``).join(", ")}); the other ${simulator.simulatorOnly.length}
appear nowhere above. The list is parsed from that file's emit sites by this
generator, not maintained by hand. Several of them name **deferred** families
(custody, dock, location) — the simulator is a fixture harness, so it models
families the launch profile does not serve.

**GATED:** that this list is complete, that it parses, and that no simulator code
collides with a core code by punctuation/case/underscore alone
(\`scripts/check-reason-codes.mjs\`). **REPORTED, not gated:** everything about what
these codes MEAN. No \`/v1\` route emits them — they are not part of the published
API vocabulary, and a host app must not build against them as if they were.

They are also not renameable at will: \`native/ios/EnterpriseShell/Services/DecisionEngine.swift\`
is a byte-faithful port of the simulator engine (CLAUDE.md golden rule 1), so the
iOS app's reason codes ARE these spellings. Aligning them with the core's would
break the parity the port exists to prove.

The ${simulator.simulatorOnly.length} the core never emits — none of them a launch
surface, and the custody/dock/location ones name **deferred** families:
${simulator.simulatorOnly.map((c) => `- \`${c}\` — simulator/iOS only`).join("\n")}

${
    simulator.nearCollisions.length === 0
      ? "No simulator code differs from a core code by punctuation, case or underscore alone."
      : `**Near-collisions found (${simulator.nearCollisions.length}) — one concept, two spellings, two engines:**\n\n` +
        simulator.nearCollisions
          .map((n) => `- \`${n.simulator}\` (simulator/iOS) vs \`${n.core}\` (core) — the gate carries a NAMED exemption for this pair or fails on it; see \`scripts/check-reason-codes.mjs\`.`)
          .join("\n")
  }

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
