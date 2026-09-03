#!/usr/bin/env node
// Preflight↔CI parity — a gate that runs only locally is not a gate.
//
// scripts/preflight.mjs is described as "a complete mirror of the CI jobs that
// need NOTHING BUT NODE", and its header asks that the two lists be kept "in
// lockstep". But it only ever worried about ONE direction:
//
//     "a proof that runs in CI but not here would let a red build pass preflight"
//
// The reverse gap is worse, and it is the one that had actually opened. FIVE
// preflight gates ran in no workflow at all:
//
//   scripts/check-doc-orphans.mjs
//   scripts/check-pagination-truncation.mjs
//   proof:absent-collection
//   scripts/check-decision-port-parity.mjs
//   proof:dual-control
//
// Three of those were added recently and never wired up, which is the honest
// reason this check exists: guards against silent drift were left where they
// could not fail a pull request.
//
// The first version of this file said SEVEN and named `review-invariants.mjs` as
// the worst offender. That was WRONG, and the way it was wrong is the point:
// CI ran it as `pnpm run review:invariants`, an npm-script ALIAS, while the check
// searched for the script PATH. Colons are not hyphens, so the substring never
// matched and a gate that had been running all along was reported as running
// nowhere. Same for `check-proof-counts.mjs`. See `wired()` below.
//
// A guard that runs in preflight but not in CI does not fail a pull request. So
// the drift it exists to catch lands on the branch unchallenged, while the guard
// keeps reporting green to whoever runs it locally afterwards — it does not even
// leave a red mark to find later. It is the same shape as every other defect this
// repo keeps finding: something that reports success while not doing its job.
//
// This closes it in the direction that was missing: every command preflight runs
// must be referenced by SOME workflow. Being referenced is a weaker claim than
// being run on every PR (a workflow may be scheduled, or gated by paths), but it
// is the strongest claim checkable without executing GitHub's workflow semantics,
// and it catches the real failure — a gate nobody wired up at all.
//
//   node scripts/check-preflight-ci-parity.mjs

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIRRORED, NOT_A_GATE, classifyCiJobs } from "./lib/ci-jobs.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = join(repo, ".github/workflows");

// Gates that intentionally run ONLY locally. DELIBERATELY EMPTY, and asserted so
// below: every entry here is a gate that cannot fail a pull request, so the honest
// default is that there are none. The staleness loop over this map therefore
// asserts nothing today — that is correct, not an oversight, and the assertion
// after this map states the reason rather than leaving an empty loop to read as a
// forgotten TODO. Add an entry (with the reason it cannot run in CI) only when a
// gate genuinely cannot, and the loop will start guarding it.
const LOCAL_ONLY = new Map([
  // ["some:gate", "why it cannot run in CI"],
]);
// The reason the map is empty, made checkable: if it is EVER non-empty, every
// entry must carry a non-empty reason. This keeps "empty on purpose" honest
// without pretending there is a local-only gate when there is not.
for (const [gate, reason] of LOCAL_ONLY) {
  if (!reason || !String(reason).trim()) {
    console.error(`  ✗ LOCAL_ONLY entry "${gate}" has no reason — a silent exemption is the thing this gate forbids.`);
    process.exit(1);
  }
}

const preflight = readFileSync(join(repo, "scripts/preflight.mjs"), "utf8");

// A workflow may invoke a gate by its PATH (`node scripts/x.mjs`) or through an
// npm-script ALIAS (`pnpm run review:invariants`). Matching only the path was the
// first version's bug, and it produced a false positive with real consequences:
// it reported `review-invariants.mjs` — the repo's automated second reviewer — as
// running nowhere, when CI had been running it as `pnpm run review:invariants`
// all along. Colons are not hyphens, and a substring search cannot know that.
//
// So resolve package.json's scripts into path -> [alias] and accept either form.
// The lesson is the one this whole file is about: a checker that cannot see a
// gate is indistinguishable from a gate that is not there, and it will happily
// invent work.
const pkgScripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts ?? {};
const aliasesFor = new Map();
for (const [name, cmd] of Object.entries(pkgScripts)) {
  const m = /scripts\/([a-z0-9-]+\.mjs)/.exec(cmd ?? "");
  if (!m) continue;
  const list = aliasesFor.get(m[1]) ?? [];
  list.push(name);
  aliasesFor.set(m[1], list);
}

// Each STEPS entry is `cmd: ["node", "scripts/x.mjs"]` or `["pnpm", "run", "x"]`.
// Reduce both to the identifying token a workflow would have to mention.
//
// THE `--self-test` FLAG IS PRESERVED, not dropped. A gate is registered TWICE in
// preflight — the real run and its `--self-test` — and dropping the flag collapsed
// both to one token, so a workflow that ran only the real gate credited the
// self-test step too, even though CI never executed it. The token now carries
// ` --self-test` so a self-test step is only satisfied by a workflow that actually
// runs `--self-test`. CI already registers every self-test step this way.
function gatesIn(source) {
  const out = [];
  for (const m of source.matchAll(/cmd:\s*\[([^\]]+)\]/g)) {
    const parts = m[1].replace(/["']/g, "").split(",").map((s) => s.trim());
    const suffix = parts.includes("--self-test") ? " --self-test" : "";
    if (parts[0] === "node" && parts[1]) out.push(parts[1] + suffix);
    else if (parts[0] === "pnpm" && parts[1] === "run" && parts[2]) out.push(parts[2] + suffix);
    else if (parts[0] === "bash") {
      // A `bash -c "…"` gate used to be dropped here while the comment claimed the
      // workflow scan caught it "via the script names it invokes" — it did not: a
      // gate with no key was simply never compared, so a bash-registered gate could
      // vanish from CI with this checker green (backlog row 10's third defect).
      // Reduce it to its pnpm-run / script tokens; a bash gate that yields NO
      // extractable token fails the parity check loudly instead of being skipped.
      const inner = m[1];
      const keys = [
        ...[...inner.matchAll(/pnpm run ([a-z0-9:_-]+)/g)].map((x) => x[1]),
        ...[...inner.matchAll(/scripts\/[a-z0-9./_-]+\.(?:mjs|sh)/g)].map((x) => x[0]),
      ];
      if (keys.length === 0) out.push(`__UNPARSEABLE_BASH_GATE__:${inner.slice(0, 60)}`);
      else out.push(...keys);
    }
  }
  return out;
}
const gates = gatesIn(preflight);

// The breadth lane's gates (scripts/verify-breadth.mjs) are held to the SAME
// rule — a proof that runs only on a developer's machine is not a gate — but
// CI invokes the lane as one step (`pnpm run verify:breadth`), so each of its
// gates is wired exactly when the RUNNER is. Checked, not assumed: if no
// workflow references the runner, every breadth gate reports unwired below.
const breadthSource = readFileSync(join(repo, "scripts/verify-breadth.mjs"), "utf8");
const breadthGates = new Set(gatesIn(breadthSource));
gates.push(...breadthGates);

const workflows = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));
const blob = workflows.map((f) => readFileSync(join(WORKFLOW_DIR, f), "utf8")).join("\n");

if (gates.length === 0) {
  console.error(
    "✗ parsed no gates out of scripts/preflight.mjs — the STEPS shape changed, so this\n" +
      "  check is no longer reading it and therefore no longer checking anything.",
  );
  process.exit(1);
}

let problems = 0;
const localOnlyHit = [];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// YAML comments must not count as invocations. A workflow that merely NAMES a gate
// in a `# comment` was credited by the old `blob.includes(gate)`, so a gate could
// be de-registered in CI while this check stayed green — the same defect
// check-gate-census.mjs fixed with run-position matching. `#` opens a comment at
// line start or after whitespace (standard YAML), and the gate invocations here
// never depend on a literal `#`, so truncating there is safe for matching.
export function stripYamlComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

// Does `text` INVOKE this head in a run position? Ported from check-gate-census's
// invokesByName and widened to the path form preflight uses. `head` is a script
// path (`scripts/x.mjs`) or an npm-script name (`review:invariants`).
function invokes(head, wantsSelfTest, text) {
  const g = escapeRe(head);
  if (head.includes("/")) {
    const base = head.endsWith(".mjs")
      ? String.raw`node\s+${g}` // node scripts/x.mjs
      : String.raw`(?:^|\s)${g}`; // a .sh or other path, run directly
    if (wantsSelfTest) return new RegExp(`${base}(?:\\s+--?[\\w=-]+)*\\s+--self-test\\b`).test(text);
    return new RegExp(`${base}(?!\\s+--self-test)(?![\\w./-])`).test(text);
  }
  // npm-script name: `pnpm|npm|$PNPM run <name>`, flags allowed, run position only.
  const run = String.raw`(?:\$PNPM|pnpm|npm)(?:\s+--?[\w-]+(?:=\S+)?)*\s+run\s+(?:--?[\w-]+\s+)*${g}(?![\w:-])`;
  if (wantsSelfTest) return new RegExp(`${run}(?:\\s+--)?\\s+--self-test\\b`).test(text);
  return new RegExp(`${run}(?!(?:\\s+--)?\\s+--self-test)`).test(text);
}

/** Pure: is `gate` invoked (not merely mentioned) in the workflow text, by path
 *  or by any npm-script alias? Exported so the self-test drives it directly. */
export function gateWiredIn(gate, rawWorkflowText, aliasMap = new Map()) {
  const text = stripYamlComments(rawWorkflowText);
  const wantsSelfTest = / --self-test$/.test(gate);
  const head = gate.replace(/ --self-test$/, "");
  if (invokes(head, wantsSelfTest, text)) return true;
  if (head.includes("/")) {
    const file = head.split("/").pop();
    for (const alias of aliasMap.get(file) ?? []) {
      if (invokes(alias, wantsSelfTest, text)) return true;
    }
  }
  return false;
}

/** True when a workflow invokes this gate by path OR by any npm-script alias —
 *  or, for a breadth-lane gate, when the lane runner itself is wired. */
const breadthRunnerWired = blob.includes("verify:breadth") || blob.includes("verify-breadth.mjs");
function wired(gate) {
  if (breadthGates.has(gate) && breadthRunnerWired) return true;
  return gateWiredIn(gate, blob, aliasesFor);
}

// ── self-test: a mention is not a run, and a --self-test step needs its own run ─
function selfTest() {
  const checks = [];
  const aliasMap = new Map([["review-invariants.mjs", ["review:invariants"]]]);

  checks.push(["a gate named only in a YAML comment is NOT credited", gateWiredIn("scripts/check-x.mjs", "steps:\n  # runs scripts/check-x.mjs by hand\n") === false]);
  checks.push(["a real `node` run is credited", gateWiredIn("scripts/check-x.mjs", "  - run: node scripts/check-x.mjs\n") === true]);
  checks.push(["a real run with a trailing YAML comment is still credited", gateWiredIn("scripts/check-x.mjs", "  - run: node scripts/check-x.mjs  # nightly\n") === true]);
  checks.push(["a plain run does not credit a separately-registered --self-test step", gateWiredIn("scripts/check-x.mjs --self-test", "  - run: node scripts/check-x.mjs\n") === false]);
  checks.push(["a --self-test run credits the --self-test step", gateWiredIn("scripts/check-x.mjs --self-test", "  - run: node scripts/check-x.mjs --self-test\n") === true]);
  checks.push(["a lone --self-test run does not credit the plain gate", gateWiredIn("scripts/check-x.mjs", "  - run: node scripts/check-x.mjs --self-test\n") === false]);
  checks.push(["a path gate run via its pnpm alias is credited", gateWiredIn("scripts/review-invariants.mjs", "  - run: pnpm run review:invariants\n", aliasMap) === true]);
  checks.push(["a shorter gate name does not borrow a longer one's invocation", gateWiredIn("proof:live", "  - run: pnpm run proof:live-fleet\n") === false]);

  checks.push([`LIVE: ${gates.length} preflight gate token(s) parsed`, gates.length > 0]);

  const failed = checks.filter(([, k]) => !k);
  for (const [n, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

for (const gate of gates) {
  if (wired(gate)) continue;
  if (LOCAL_ONLY.has(gate)) {
    localOnlyHit.push(gate);
    continue;
  }
  console.error(
    `  ✗ ${gate}: runs in preflight but is referenced by NO workflow — it cannot fail a pull request.\n` +
      `      Wire it into .github/workflows/, or add it to LOCAL_ONLY in this file WITH A REASON.`,
  );
  problems += 1;
}

// A stale exemption is its own failure: it quietly re-permits the gap it was
// granted for, and reads as intentional forever after.
for (const [gate, reason] of LOCAL_ONLY) {
  if (wired(gate)) {
    console.error(`  ✗ ${gate}: listed as local-only ("${reason}") but IS now in a workflow — remove the exemption`);
    problems += 1;
  } else if (!gates.includes(gate)) {
    console.error(`  ✗ ${gate}: listed as local-only but is no longer a preflight gate — remove the exemption`);
    problems += 1;
  }
}

// ── The other direction: preflight's own "not covered" disclaimer ────────────
//
// That footer is the most load-bearing line the harness prints — it is read at the
// moment someone decides to push. It is now DERIVED (scripts/lib/ci-jobs.mjs) rather
// than a hardcoded three, but a derived list still depends on a hand-written
// classification, and a classification that outlives its job silently shrinks the
// disclaimer. Same rule as LOCAL_ONLY above: a stale exemption re-permits the gap it
// was granted for and reads as intentional ever after.
const { jobs: ciJobs, uncovered: ciUncovered, stale: ciStale } = classifyCiJobs();
for (const id of ciStale) {
  console.error(
    `  ✗ ${id}: classified in scripts/lib/ci-jobs.mjs but NO workflow defines it any more — ` +
      `delete the entry. Leaving it silently shortens preflight's "not covered" list.`,
  );
  problems += 1;
}
console.log(
  `CI job coverage: ${ciJobs.length} jobs, ${MIRRORED.size} mirrored by preflight, ` +
    `${NOT_A_GATE.size} not a gate, ${ciUncovered.length} reported as uncovered`,
);

console.log(
  `preflight↔CI parity: ${gates.length} preflight gates, ${workflows.length} workflow files, ` +
    `${localOnlyHit.length} declared local-only, ${problems} unwired`,
);

if (problems > 0) {
  console.error(
    "\nPreflight↔CI parity FAILED.\n" +
      "A gate that runs only on a developer's machine does not block anything. It reports\n" +
      "green locally while the drift it guards against sits on the branch.",
  );
  process.exit(1);
}
console.log("Preflight↔CI parity passed — every preflight gate is wired into a workflow.");
