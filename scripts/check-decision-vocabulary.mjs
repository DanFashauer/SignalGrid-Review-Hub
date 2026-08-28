// Decision vocabulary gate — one name for the decision transaction.
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
//   DecisionOutcome = the verdict     (allow · deny · step-up · hold)
//   DecisionEnvelope = the transaction (the whole thing)

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
  DecisionOutcome: "CANONICAL — the verdict enum (allow · deny · step-up · hold).",

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
  const sample = "export interface DecisionPayload { subject: string }";
  const found = [...sample.matchAll(TRANSACTION_SHAPE)].map((m) => m[0]);
  const caught = found.some((n) => !(n in ALLOW));
  console.log(
    caught
      ? "PASS  self-test — an unlisted transaction noun (DecisionPayload) is detected"
      : "FAIL  self-test — the gate would not catch a new transaction noun",
  );
  process.exit(caught ? 0 : 1);
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

const legacy = Object.entries(ALLOW).filter(([, w]) => w.startsWith("LEGACY"));
console.log(
  `PASS  decision vocabulary — ${Object.keys(ALLOW).length} permitted names, ` +
    `${legacy.length} legacy alias(es) pending migration, 0 new nouns.`,
);
