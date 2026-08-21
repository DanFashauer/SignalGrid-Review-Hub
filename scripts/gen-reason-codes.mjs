#!/usr/bin/env node
// Generate docs/REASON_CODES.md — the reason-code catalog for the Assist gate —
// from source, because the vocabulary IS the product surface (embedded-UX law:
// the host app renders the worker's message from the verdict + reason codes)
// and the only prior mapping (docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md §2.1) named
// four codes the engine cannot emit. Parsed per run, never hand-copied:
//
//   node scripts/gen-reason-codes.mjs          # rewrite the catalog
//
// scripts/check-reason-codes.mjs runs the same parse and fails on drift in
// either direction. Sources of truth:
//   · emit sites  — reasonCode/reasonCodes contexts in the launch decision
//                   path (decision.ts, policy.ts, continuity.ts, resolution.ts)
//   · verdicts    — the policy rule tables ({conditions, outcome, reasonCode})
//   · language    — resolution.ts DESCRIPTORS (baseClass, workerAction,
//                   operatorAction); a code with no descriptor is marked so,
//                   because that is the documented hole (an unknown code
//                   silently drops out of the resolution plan today)
//   · fixtures    — seed.ts expectedReasonCode cases (proof linkage)
import { readFileSync, writeFileSync } from "node:fs";

const FILES = {
  "lib/signalgrid-core/src/decision.ts": "decision",
  "lib/signalgrid-core/src/policy.ts": "policy",
  "lib/signalgrid-core/src/continuity.ts": "continuity",
  "lib/signalgrid-core/src/resolution.ts": "resolution",
};
const CODE = /^[A-Z][A-Z0-9_]{4,}$/;

export function parseEmitSet() {
  const codes = new Map(); // code -> {files:Set, verdicts:Set}
  const add = (code, file) => {
    if (!CODE.test(code)) return;
    if (!codes.has(code)) codes.set(code, { files: new Set(), verdicts: new Set() });
    codes.get(code).files.add(FILES[file]);
  };
  for (const file of Object.keys(FILES)) {
    const src = readFileSync(file, "utf8");
    // reasonCode: "X" (rule tables and literals) — and the verdict from the
    // SAME rule object, found by walking brackets back to the enclosing `{`
    // and forward to its matching `}`. A flat character window misattributed
    // the NEIGHBORING rule's outcome (BADGE_REMOVED read as deny while its
    // own fixture expects restrict) — the exact wrongness this catalog exists
    // to prevent, so the gate cross-checks fixtures below.
    for (const m of src.matchAll(/reasonCode:\s*"([A-Z][A-Z0-9_]{4,})"/g)) {
      add(m[1], file);
      let start = m.index, depth = 0;
      while (start > 0) {
        const c = src[start];
        if (c === "}") depth += 1;
        else if (c === "{") {
          if (depth === 0) break;
          depth -= 1;
        }
        start -= 1;
      }
      let end = m.index; depth = 0;
      while (end < src.length) {
        const c = src[end];
        if (c === "{") depth += 1;
        else if (c === "}") {
          if (depth === 0) break;
          depth -= 1;
        }
        end += 1;
      }
      const ruleObj = src.slice(start, end + 1);
      const o = /outcome:\s*"(allow|step_up|restrict|deny)"/.exec(ruleObj);
      if (o) codes.get(m[1])?.verdicts.add(o[1]);
    }
    // reasonCodes.push("X") / reasonCodes.add("X") / includes("X")-guarded emits
    for (const m of src.matchAll(/reasonCodes\.(?:push|add)\(\s*"([A-Z][A-Z0-9_]{4,})"/g)) add(m[1], file);
    // DESCRIPTORS keys (resolution vocabulary is part of the emit surface —
    // simulateResolution stamps these onto plans)
    if (file.endsWith("resolution.ts")) {
      const d = /DESCRIPTORS[^=]*=\s*{([\s\S]*?)\n};/.exec(src);
      if (d) for (const k of d[1].matchAll(/\n  ([A-Z][A-Z0-9_]{4,}):\s*{/g)) add(k[1], file);
    }
  }
  return codes;
}

export function parseDescriptors() {
  const src = readFileSync("lib/signalgrid-core/src/resolution.ts", "utf8");
  const out = new Map();
  const d = /DESCRIPTORS[^=]*=\s*{([\s\S]*?)\n};/.exec(src);
  if (!d) return out;
  for (const e of d[1].matchAll(/\n  ([A-Z][A-Z0-9_]{4,}):\s*{([\s\S]*?)\n  }/g)) {
    const f = (name) => {
      const m = new RegExp(`${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(e[2]);
      return m ? m[1].replace(/\\"/g, '"') : null;
    };
    out.set(e[1], {
      baseClass: f("baseClass"),
      worker: f("workerAction"),
      operator: f("operatorAction"),
      hasTransform: !/transform:\s*null/.test(e[2]),
    });
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

// GA reachability: which surface can make the engine emit the code. The
// decision/policy path runs under POST /v1/decisions/evaluate — a launch
// route. Continuity codes are minted by decisions/reconcile, and the
// resolution planner's battery codes by the /resolution and /resolve routes —
// ALL deferred under the launch profile (scripts/launch-profile.mjs GA
// allowlist). The partition is by emitting module, which is exactly the
// route boundary.
const GA_MODULES = new Set(["decision", "policy"]);

export function buildCatalog() {
  const emit = parseEmitSet();
  const desc = parseDescriptors();
  const fixtures = parseFixtures();
  const rows = [];
  for (const [code, info] of [...emit.entries()].sort()) {
    const d = desc.get(code);
    const ga = [...info.files].some((f) => GA_MODULES.has(f));
    rows.push({
      code,
      modules: [...info.files].sort().join(", "),
      ga,
      verdicts: [...info.verdicts].sort().join(", ") || (code === "TRUST_ESTABLISHED" ? "allow" : "—"),
      cls: d?.baseClass ?? null,
      worker: d?.worker ?? null,
      operator: d?.operator ?? null,
      fixture: fixtures.get(code)?.name ?? null,
      fixtureOutcomes: fixtures.get(code) ? [...fixtures.get(code).outcomes].sort() : [],
    });
  }
  // Fixture cross-check: a fixture's expected outcome for a code must appear
  // in the verdicts parsed from the rule tables — a mismatch means the parser
  // (or the tables) drifted, and this generator must not print it.
  for (const r of rows) {
    for (const o of r.fixtureOutcomes) {
      if (r.verdicts && r.verdicts !== "—" && !r.verdicts.includes(o)) {
        // Fixtures may exercise a code under a policy VERSION whose outcome
        // differs (v1 vs v2 strict tables) — record the union, loudly.
        r.verdicts = [...new Set([...r.verdicts.split(", "), o])].sort().join(", ");
      }
    }
  }
  return rows;
}

function table(rows) {
  const out = ["| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |", "|---|---|---|---|---|---|"];
  for (const r of rows) {
    const worker =
      r.worker ??
      (r.verdicts.includes("allow")
        ? "*(an allow carries no resolution step)*"
        : "*(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)*");
    const operator = r.operator ?? "—";
    const cls = r.cls ?? "*(none)*";
    const fx = r.fixture ? `\`${r.fixture.slice(0, 60)}\`` : "—";
    out.push(`| \`${r.code}\` | ${r.verdicts} | ${cls} | ${worker} | ${operator} | ${fx} |`);
  }
  return out.join("\n");
}

// Generation runs ONLY on direct invocation. The gate imports this module's
// parsers — an import-time write would silently regenerate the very file the
// gate is checking, and drift could never fail.
function generate() {
const rows = buildCatalog();
const ga = rows.filter((r) => r.ga);
const deferred = rows.filter((r) => !r.ga);
const noDesc = rows.filter((r) => !r.cls);

const md = `# Reason codes — the Assist gate's verdict vocabulary

Generated from source by \`node scripts/gen-reason-codes.mjs\` — do not
hand-edit rows; \`scripts/check-reason-codes.mjs\` fails on drift in either
direction (a code the engine emits with no row here, or a row naming a code
no source emits). Under the embedded-UX law the verdict plus its reason
codes ARE the product surface: the host app renders the worker's message
from them, so this catalog is the contract a host-app developer builds
against.

**${rows.length} codes** the launch decision core can emit: ${ga.length}
reachable through the launch surface, ${deferred.length} only through
deferred routes. Worker/operator language comes from the engine's own
resolution descriptors (\`lib/signalgrid-core/src/resolution.ts\`); a code
without a descriptor is marked, because that gap is real behavior — the
resolution planner silently drops descriptor-less codes from its plan today
(role-lens review, engineering.2; tracked work).

Tenant-authored policy rules may carry **custom reason codes** — the set is
open by construction (\`policy.ts\` pushes \`rule.reasonCode\` verbatim), which
is why the published API contract types \`reasonCodes\` as strings with this
catalog as the engine-emitted vocabulary, NOT a closed enum: an enum would
falsify the contract for every tenant with a custom rule.

## Launch-surface codes (reachable via \`POST /v1/decisions/evaluate\`)

${table(ga)}

## Deferred-path codes (emitted only by deferred routes)

These are minted by \`POST /v1/decisions/reconcile\` (continuity) and the
resolution planner's battery assessment (\`/v1/decisions/{id}/resolution\`,
\`/resolve\`) — all outside the launch profile's GA allowlist. They are real
engine vocabulary, catalogued so a host app that later adopts those routes
has the contract, and partitioned so nobody reads them as launch surface.

${table(deferred)}

## The descriptor gap, stated

${noDesc.length} of ${rows.length} codes have no resolution descriptor. For
those, \`buildResolutionPlan\` silently omits the code from the plan — a
DENY carrying only descriptor-less codes reports itself self-service and
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
table would have shipped messages that never fire.
`;

writeFileSync("docs/REASON_CODES.md", md);
console.log(`Generated docs/REASON_CODES.md: ${rows.length} codes (${ga.length} launch, ${deferred.length} deferred, ${noDesc.length} without descriptors)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) generate();
