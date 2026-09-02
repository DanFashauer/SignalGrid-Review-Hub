// Decision vocabulary gate — one name for the decision transaction, and one
// spelling for the verdict it carries.
//
//   node scripts/check-decision-vocabulary.mjs
//   node scripts/check-decision-vocabulary.mjs --list        show the allowlist and why
//   node scripts/check-decision-vocabulary.mjs --self-test   prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// docs/PURPOSE.md makes the Decision Envelope the atomic product object: one
// primitive shared by the engine, the API, the UI, the audit trail and the demo.
// That only holds if there is exactly ONE first-party name for it.
//
// The repo had already drifted to five (SignalGridDecision, DecisionResult,
// DecisionRecord, DecisionEnvelope, plus generated Decision), which is how a
// codebase ends up with several renderings of the same idea and no shared
// primitive. Prose cannot hold that line; a gate can.
//
// WHAT IT DOES *NOT* DO
// ---------------------
// It does not force a breaking rename. Generated artifacts and published
// contracts are explicitly allowlisted and must never be "cleaned up" — the
// predictable way to turn a vocabulary tidy-up into a contract break. Legacy
// first-party names survive as documented compatibility aliases while they are
// migrated. What the gate blocks is a NEW transaction-level decision noun
// entering the tree, which is the only thing that actually causes the drift.
//
//   DecisionOutcome = the verdict     (allow · step_up · restrict · deny)
//   DecisionEnvelope = the transaction (the whole thing)
//
// THE VERDICT SPELLING — a second, DERIVED check (added 2026-09-02)
// -----------------------------------------------------------------
// The same drift that produced five nouns produced two spellings of one rung.
// Measured, not remembered:
//
//   `step_up`  the ENGINE's verdict — VALID_OUTCOMES in
//              lib/signalgrid-core/src/policy.ts and the DecisionOutcome union
//              in lib/signalgrid-core/src/types.ts — and the spelling of all
//              SEVEN outcome enums in the /v1 launch surface
//              (lib/api-spec/v1-openapi.yaml).
//   `step-up`  the spelling of the named `DecisionOutcome` schema in the OLDER
//              published /api contract (lib/api-spec/openapi.yaml, info.version
//              0.2.0), which the generated clients lib/api-zod and
//              lib/api-client-react carry verbatim.
//
// GATED: the engine's vocabulary and the /v1 published enums must be EXACTLY
// equal. Those two are one surface described twice; a difference between them
// is a contract break, never a preference.
//
// REPORTED, never gated: the 0.2.0 /api spelling. It is a published contract
// with generated consumers, and this file's own doctrine (above) is that such
// artifacts are never "cleaned up" — that is how a tidy-up becomes a break.
// The report exists so the divergence stays VISIBLE instead of being rediscovered
// as a bug. Reword nothing on either side to make this comment come out even.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Names that look like they describe a decision TRANSACTION. Deliberately
// shaped, not a blanket /Decision\w+/ — DecisionRequest and DecisionSeriesPoint
// are legitimately different objects and must not be swept up.
const TRANSACTION_SHAPE =
  /\b(?:Trust|SignalGrid)?Decision(?:Envelope|Record|Result|Object|Transaction|Payload|Bundle|Package|Entry|Snapshot|Doc|Blob)?\b/g;

// Every permitted name, with the reason it is permitted. An entry without a
// reason is how an allowlist quietly becomes a rubber stamp.
const ALLOW = {
  DecisionEnvelope: "CANONICAL — the complete decision transaction.",
  DecisionOutcome: "CANONICAL — the verdict enum (allow · step_up · restrict · deny).",

  // Generated / published contract. Never rename: doing so breaks consumers.
  Decision: "GENERATED — lib/api-zod published contract. Do not rename.",
  DecisionRequest: "GENERATED — published contract; a request, not the transaction.",
  DecisionMetadata: "GENERATED — published contract.",
  DecisionRequestMetadata: "GENERATED — published contract.",
  DecisionRequestIntegrationContext: "GENERATED — published contract.",
  DecisionSeriesPoint: "GENERATED — a time-series point, not the transaction.",

  // Legacy first-party aliases, migrating to DecisionEnvelope. Bounded, listed,
  // and expected to shrink. They may not grow.
  SignalGridDecision:
    "LEGACY ALIAS — simulator core + review app. Migrate to DecisionEnvelope.",
  DecisionResult:
    "LEGACY ALIAS — iOS EnterpriseShell. Byte-faithful port surface; migrate with the TS engine, never independently.",
  DecisionRecord:
    "LEGACY ALIAS — reliability/SLO + control-plane. Migrate to DecisionEnvelope.",
};

const SCAN = ["lib", "artifacts", "native", "scripts"];
// This file names an unlisted noun on purpose (the self-test fixture), so it
// must not scan itself — a gate that fails on its own test data is unusable.
const SELF = "scripts/check-decision-vocabulary.mjs";
const SKIP = /(^|\/)(node_modules|dist|build|generated|__pycache__)(\/|$)/;
const CODE = /\.(ts|tsx|swift|kt|mjs)$/;

// ── verdict spelling: derivation ────────────────────────────────────────────
// Nothing below is hand-listed. The engine's vocabulary is read out of
// policy.ts and the published vocabulary out of the spec, so a rung added or
// renamed on either side is picked up without editing this file.

const ENGINE_SRC = "lib/signalgrid-core/src/policy.ts";
const V1_SPEC = "lib/api-spec/v1-openapi.yaml";
const LEGACY_SPEC = "lib/api-spec/openapi.yaml";
// Floors. A derivation that has drifted finds nothing and would otherwise report
// "0 mismatches" — green about nothing. Both floors are MEASURED against the tree
// as it stands: `VALID_OUTCOMES` holds four rungs, and lib/api-spec/v1-openapi.yaml
// publishes SEVEN outcome-shaped enums. The v1 floor read 1 until 2026-09-02 while
// this comment already claimed it was "what the tree holds today" — so six of the
// seven enums could have been renamed out of recognition and the gate would still
// have compared the surviving one and passed. A floor set below the measurement is
// not a floor; it is a comment. Raise these when the tree grows, never lower them
// to make a run go green.
const ENGINE_FLOOR = 4;
const V1_ENUM_FLOOR = 7;

/** The engine's verdict vocabulary, read out of `VALID_OUTCOMES` in policy.ts. */
function engineOutcomes(src) {
  const m = /const VALID_OUTCOMES\s*=\s*new Set<[^>]*>\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/** Every outcome-shaped enum in an OpenAPI document, flow style AND block style.
 *  "Outcome-shaped" = names both `allow` and `deny`; that is what distinguishes a
 *  verdict enum from the many other enums in these specs. */
function outcomeEnums(yaml) {
  const found = [];
  for (const m of yaml.matchAll(/enum:\s*\[([^\]]*)\]/g)) {
    found.push(m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  }
  for (const m of yaml.matchAll(/enum:\s*\n((?:[ \t]*-[ \t]*\S+[ \t]*\n)+)/g)) {
    found.push(m[1].trim().split("\n").map((s) => s.replace(/^[ \t]*-[ \t]*/, "").trim()).filter(Boolean));
  }
  return found.filter((members) => members.includes("allow") && members.includes("deny"));
}

const key = (members) => [...members].sort().join(" · ");

/** Edit the REAL /v1 document so that all but `keep` of its outcome-shaped enums
 *  stop being recognisable as verdicts (`allow` -> `permit`, which keeps the YAML
 *  valid and the enum present). Used only by --self-test, and deliberately a
 *  mutation of the live spec rather than a hand-written look-alike: the point is
 *  to drive THIS file's derivation, not a fixture that agrees with it. */
function blindAllButN(yaml, keep) {
  const spans = [];
  const record = (m, members) => {
    if (members.includes("allow") && members.includes("deny")) spans.push([m.index, m.index + m[0].length]);
  };
  for (const m of yaml.matchAll(/enum:\s*\[([^\]]*)\]/g)) {
    record(m, m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  }
  for (const m of yaml.matchAll(/enum:\s*\n((?:[ \t]*-[ \t]*\S+[ \t]*\n)+)/g)) {
    record(m, m[1].trim().split("\n").map((x) => x.replace(/^[ \t]*-[ \t]*/, "").trim()).filter(Boolean));
  }
  spans.sort((a, b) => a[0] - b[0]);
  let out = yaml;
  for (const [start, end] of spans.slice(0, Math.max(0, spans.length - keep)).reverse()) {
    out = out.slice(0, start) + out.slice(start, end).replace(/\ballow\b/g, "permit") + out.slice(end);
  }
  return out;
}

/** Returns { problems[], notes[] }. `read` is injected so --self-test can drive
 *  the REAL derivation against a planted document rather than a look-alike. */
function verdictSpelling(read) {
  const problems = [];
  const notes = [];

  const engine = engineOutcomes(read(ENGINE_SRC) ?? "");
  if (!engine || engine.length < ENGINE_FLOOR) {
    problems.push(
      `could not derive VALID_OUTCOMES from ${ENGINE_SRC} — found ${engine ? engine.length : 0}, ` +
        `floor ${ENGINE_FLOOR}. The parse has drifted, so this check proves nothing and refuses to pass.`,
    );
    return { problems, notes };
  }

  const v1Enums = outcomeEnums(read(V1_SPEC) ?? "");
  if (v1Enums.length < V1_ENUM_FLOOR) {
    problems.push(
      `found ${v1Enums.length} outcome-shaped enum(s) in ${V1_SPEC} — floor ${V1_ENUM_FLOOR}. ` +
        `The spec parse has drifted; a scan that finds nothing is green about nothing.`,
    );
    return { problems, notes };
  }

  const engineKey = key(engine);
  const mismatched = v1Enums.filter((members) => key(members) !== engineKey);
  for (const members of mismatched) {
    problems.push(
      `${V1_SPEC} publishes the verdict enum as [${members.join(", ")}] but the engine ` +
        `(${ENGINE_SRC}) emits [${engine.join(", ")}]. One surface, two spellings.`,
    );
  }
  notes.push(`engine + /v1 agree on ${engine.join(" · ")} across ${v1Enums.length} published enum site(s)`);

  // REPORTED, never gated — see the header. A published contract is not a defect.
  //
  // But an ABSENT report is not the same as "no divergence", and this block used to
  // conflate them: `read(LEGACY_SPEC) ?? ""` turned an unreadable or moved spec into
  // an empty document, which yields zero outcome enums, which yields no note at all.
  // The REPORTED line simply vanished, and a reader who knows the divergence exists
  // would have read its silence as "the divergence is gone". Say which happened.
  const legacyRaw = read(LEGACY_SPEC);
  if (legacyRaw == null) {
    notes.push(
      `REPORTED (not gated): legacy 0.2.0 spec unreadable — divergence NOT assessed ` +
        `(${LEGACY_SPEC} could not be read). This is the absence of a measurement, not a clean result.`,
    );
  } else {
    const legacyEnums = outcomeEnums(legacyRaw);
    const legacyDivergent = legacyEnums.filter((m) => key(m) !== engineKey);
    if (legacyEnums.length === 0) {
      notes.push(
        `REPORTED (not gated): legacy 0.2.0 spec unreadable — divergence NOT assessed ` +
          `(${LEGACY_SPEC} was read but holds no outcome-shaped enum; the parse or the spec moved).`,
      );
    } else if (legacyDivergent.length > 0) {
      notes.push(
        `REPORTED (not gated): ${LEGACY_SPEC} — the published 0.2.0 /api contract — spells ` +
          `${legacyDivergent.length} outcome enum(s) [${legacyDivergent[0].join(", ")}]. Its generated ` +
          `clients (lib/api-zod, lib/api-client-react) carry that spelling deliberately; do not "fix" it.`,
      );
    } else {
      notes.push(
        `REPORTED (not gated): ${LEGACY_SPEC} — the published 0.2.0 /api contract — now agrees ` +
          `with the engine across ${legacyEnums.length} outcome enum(s).`,
      );
    }
  }
  return { problems, notes };
}

const readRepoFile = (rel) => {
  try {
    return readFileSync(resolve(repo, rel), "utf8");
  } catch {
    return null;
  }
};

function trackedFiles() {
  // Tracked AND untracked-but-not-ignored, so a NEW file is checked before it is
  // ever staged. A tracked-only scan misses it until commit — the same defect
  // scripts/review-invariants.mjs documents having been bitten by.
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...SCAN],
    { cwd: repo, encoding: "utf8" },
  )
    .split("\n")
    .filter((f) => f && CODE.test(f) && !SKIP.test(f) && f !== SELF);
}

if (process.argv.includes("--list")) {
  console.log("\nPermitted decision-transaction vocabulary:\n");
  for (const [name, why] of Object.entries(ALLOW)) {
    console.log(`  ${name.padEnd(34)} ${why}`);
  }
  console.log("\nAnything else matching the transaction shape is a new noun and fails.\n");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  const results = [];

  // 1. A new transaction noun must be caught.
  const sample = "export interface DecisionPayload { subject: string }";
  const found = [...sample.matchAll(TRANSACTION_SHAPE)].map((m) => m[0]);
  results.push([
    "an unlisted transaction noun (DecisionPayload) is detected",
    found.some((n) => !(n in ALLOW)),
  ]);

  // 2. The spelling check passes on the REAL tree as it stands. If this fails,
  //    either the tree diverged or the derivation did — both are worth knowing
  //    before the planted cases below are believed.
  const live = verdictSpelling(readRepoFile);
  results.push(["the live tree's engine and /v1 verdict spellings agree", live.problems.length === 0]);

  // 3. A DIVERGENT published spelling must be caught. The real derivation runs;
  //    only the document it reads is planted.
  const planted = (rel) =>
    rel === V1_SPEC
      ? "        outcome: { type: string, enum: [allow, step-up, restrict, deny] }\n"
      : readRepoFile(rel);
  results.push([
    "a /v1 enum that spells the rung `step-up` while the engine emits `step_up` is caught",
    verdictSpelling(planted).problems.length > 0,
  ]);

  // 4. A derivation that finds NOTHING must fail rather than report zero
  //    mismatches — the floors, exercised.
  const blindEngine = (rel) => (rel === ENGINE_SRC ? "// the const was renamed\n" : readRepoFile(rel));
  results.push([
    "an engine vocabulary that no longer parses trips the floor instead of passing",
    verdictSpelling(blindEngine).problems.length > 0,
  ]);
  const blindSpec = (rel) => (rel === V1_SPEC ? "openapi: 3.1.0\n" : readRepoFile(rel));
  results.push([
    "a spec with zero outcome enums trips the floor instead of passing",
    verdictSpelling(blindSpec).problems.length > 0,
  ]);

  // 4b. THE FLOOR ITSELF, at the value that matters. "Zero enums" above trips any
  //     floor >= 1 and therefore proved nothing about V1_ENUM_FLOOR being right.
  //     This plants the real defect the floor exists to catch: six of the seven
  //     published enums renamed out of recognition, ONE left agreeing with the
  //     engine. Under the old floor of 1 that combination passed.
  const liveV1 = readRepoFile(V1_SPEC) ?? "";
  const sixBlinded = blindAllButN(liveV1, 1);
  results.push([
    "the plant is real: blinding leaves exactly 1 of the live spec's outcome enums",
    outcomeEnums(liveV1).length === V1_ENUM_FLOOR && outcomeEnums(sixBlinded).length === 1,
  ]);
  const partlyBlind = (rel) => (rel === V1_SPEC ? sixBlinded : readRepoFile(rel));
  results.push([
    `6 of the ${V1_ENUM_FLOOR} /v1 outcome enums made unrecognisable trips the floor`,
    verdictSpelling(partlyBlind).problems.length > 0,
  ]);

  // 5. The legacy 0.2.0 spec is REPORTED, and its ABSENCE must be reported too —
  //    `read(LEGACY_SPEC) ?? ""` used to make an unreadable spec look like a clean
  //    one by deleting the line entirely.
  const noLegacy = (rel) => (rel === LEGACY_SPEC ? null : readRepoFile(rel));
  const absent = verdictSpelling(noLegacy);
  const UNREADABLE = /legacy 0\.2\.0 spec unreadable — divergence NOT assessed/;
  results.push([
    "an unreadable legacy 0.2.0 spec is REPORTED as not-assessed, not silently dropped",
    absent.problems.length === 0 && absent.notes.some((n) => UNREADABLE.test(n)),
  ]);
  results.push([
    "the live tree reports the real 0.2.0 divergence, NOT the not-assessed note",
    live.notes.some((n) => /0\.2\.0 \/api contract/.test(n)) && !live.notes.some((n) => UNREADABLE.test(n)),
  ]);

  let ok = true;
  for (const [name, passed] of results) {
    console.log(`${passed ? "PASS" : "FAIL"}  self-test — ${name}`);
    if (!passed) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

const offenders = new Map();
for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(resolve(repo, file), "utf8");
  } catch {
    continue;
  }
  for (const m of text.matchAll(TRANSACTION_SHAPE)) {
    const name = m[0];
    if (name in ALLOW) continue;
    if (!offenders.has(name)) offenders.set(name, new Set());
    offenders.get(name).add(file);
  }
}

if (offenders.size) {
  console.error(
    `FAIL  ${offenders.size} decision-transaction noun(s) outside the allowlist:\n`,
  );
  for (const [name, files] of offenders) {
    console.error(`    ${name}`);
    for (const f of [...files].slice(0, 4)) console.error(`      ${f}`);
    if (files.size > 4) console.error(`      … and ${files.size - 4} more`);
  }
  console.error(`
docs/PURPOSE.md: DecisionEnvelope is the sole canonical first-party term for the
complete decision transaction. Use it, or add a documented compatibility alias
to the allowlist in this file with the reason it must exist.
`);
  process.exit(1);
}

// ── verdict spelling ────────────────────────────────────────────────────────
const spelling = verdictSpelling(readRepoFile);
if (spelling.problems.length > 0) {
  console.error(`FAIL  verdict spelling — ${spelling.problems.length} problem(s):\n`);
  for (const p of spelling.problems) console.error(`    ${p}`);
  console.error(`
The engine's verdict vocabulary and the /v1 published enums describe ONE surface.
Change them together, or say plainly which one moved and why. The 0.2.0 /api
contract's separate spelling is REPORTED here, never gated — it has generated
consumers and is not a defect to be tidied.
`);
  process.exit(1);
}

const legacy = Object.entries(ALLOW).filter(([, w]) => w.startsWith("LEGACY"));
console.log(
  `PASS  decision vocabulary — ${Object.keys(ALLOW).length} permitted names, ` +
    `${legacy.length} legacy alias(es) pending migration, 0 new nouns.`,
);
for (const n of spelling.notes) console.log(`      ${n}`);
