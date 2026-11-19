// Docs↔proof count guard.
//
// The docs advertise how many checks each proof runs — e.g. "`pnpm run
// proof:pacs-access` (68 checks)". Those numbers are evidence, and evidence that
// silently drifts is worse than no evidence: a reader trusts a number that is no
// longer true. Every time a proof gains an assertion, its documented count must move
// with it.
//
// This scans docs/ for that pattern, runs each referenced proof, and fails if any
// documented count disagrees with the count the proof actually reports. It is the
// same discipline as the Postman/OpenAPI drift check, applied to proof evidence.
//
//   node scripts/check-proof-counts.mjs              # the gate
//   node scripts/check-proof-counts.mjs --self-test  # prove the gate can fail
//
// NON-VACUITY FLOOR, added 2026-09-02. The old code exited 0 with "nothing to
// verify" the moment the claim regex matched zero — so a docs reformat from
// "(N checks" to "(N assertions" would silence this gate entirely and it would
// report success over a docset it had stopped reading. That is the exact shape
// this repository keeps finding: a scan that scans nothing and calls it green.
// The floor is far below the real count (58 unique proofs at the time of
// writing) and exists only to catch a parser that has stopped matching.

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "docs");

// Matches: `proof:<name>` (<N> checks   — tolerating an optional backtick/paren.
const PATTERN = /proof:([a-z0-9-]+)`?\s*\((\d+)\s+checks/g;

// Far below the ~58 unique documented proofs today; a count under this means the
// scan is broken, not that the docs stopped documenting proof counts.
const CLAIM_FLOOR = 20;

// The per-proof bound, unchanged; named so the failure diagnostic can report it.
const PROOF_CEILING_MS = 120_000;

/** Parse "(N checks)" claims from a corpus of `[relPath, text]` docs. Pure so
 *  the self-test can feed it synthetic input without touching the filesystem. */
export function parseClaims(docs) {
  const claims = new Map(); // proofName -> { count, files:Set }
  const disagreements = [];
  for (const [file, text] of docs) {
    for (const m of text.matchAll(PATTERN)) {
      const [, name, count] = m;
      const existing = claims.get(name);
      if (existing && existing.count !== Number(count)) {
        disagreements.push(`proof:${name} is documented as both ${existing.count} and ${count} checks`);
      }
      if (!existing) claims.set(name, { count: Number(count), files: new Set([file]) });
      else existing.files.add(file);
    }
  }
  return { claims, disagreements };
}

// When a proof prints no summary line the gate fails, and the reason must survive the outer preflight's
// 25-line tail capture: the child's exit status, signal, error code, elapsed time and the end of its output
// (#2387: a macOS run reported only "could not read a summary line", so the cause could not be told apart
// from a timeout, a startup error or an assertion). Bounded on purpose: at most TAIL_LINES lines of at most
// TAIL_WIDTH characters each, so one failing proof cannot push the verdict out of the capture.
const TAIL_LINES = 10;
const TAIL_WIDTH = 200;

/** Describe a child run that produced no summary line. Pure: takes spawnSync's result and the elapsed time. */
export function describeChildFailure(run, elapsedMs, ceilingMs) {
  const code = run?.error?.code ?? null;
  const timedOut = code === "ETIMEDOUT";
  const output = `${run?.stdout ?? ""}${run?.stderr ?? ""}`;
  const lines = output.split(/\r?\n/).filter((l) => l.trim() !== "");
  const tail = lines.slice(-TAIL_LINES).map((l) => (l.length > TAIL_WIDTH ? `${l.slice(0, TAIL_WIDTH)}…` : l));
  const head =
    `    child: status=${run?.status ?? "null"} signal=${run?.signal ?? "null"} error=${code ?? "none"}` +
    ` elapsed=${Math.round(elapsedMs)}ms ceiling=${ceilingMs}ms${timedOut ? " (TIMED OUT at the ceiling)" : ""}`;
  const body = tail.length
    ? [`    last ${tail.length} of ${lines.length} output line(s):`, ...tail.map((l) => `      | ${l}`)]
    : ["    the child printed no output"];
  return [head, ...body];
}

/** One line naming a no-summary child's outcome, for the final recap. */
export function childOutcome(run, elapsedMs, ceilingMs) {
  const code = run?.error?.code ?? null;
  const line = `no summary line; status=${run?.status ?? "null"} signal=${run?.signal ?? "null"} error=${code ?? "none"}` +
    ` elapsed=${Math.round(elapsedMs)}ms${code === "ETIMEDOUT" ? ` (TIMED OUT at the ${ceilingMs}ms ceiling)` : ""}`;
  return line.length > TAIL_WIDTH ? `${line.slice(0, TAIL_WIDTH)}…` : line;
}

// Per-proof detail blocks can push each other out of preflight's 25-line capture when more than one proof
// fails (Root on e4b54aa6). The run therefore ENDS with a recap that always fits: one line per fault, naming
// the proof and its outcome, at most RECAP_MAX of them plus an explicit omission count, then the verdict.
const RECAP_MAX = 10;

/** The closing lines of a failed run: a bounded fault recap, a blank line and the verdict. */
export function finalReport(faults) {
  const shown = faults.slice(0, RECAP_MAX);
  const lines = [`Proof-count faults (${faults.length}), each detailed above:`, ...shown.map((f) => `  ✗ proof:${f.name} — ${f.outcome}`)];
  if (faults.length > shown.length) lines.push(`  … and ${faults.length - shown.length} more fault(s) not listed here (see above)`);
  return [...lines, "", `Proof-count check FAILED: ${faults.length} proof(s) failed the count check.`];
}

/** What preflight keeps of a failed step: stdout then stderr, trimmed, last 25 lines (scripts/preflight.mjs). */
export function preflightTail(stdout, stderr) {
  return `${stdout}${stderr}`.trimEnd().split("\n").slice(-25);
}

function readDocs() {
  // RECURSIVE on purpose (D3): moved docs stay inside guard scope.
  return readdirSync(docsDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, readFileSync(join(docsDir, f), "utf8")]);
}

function selfTest() {
  const checks = [];

  // The pattern must extract a documented count.
  const good = parseClaims([["a.md", "`pnpm run proof:pacs-access` (68 checks)"]]);
  checks.push(["the pattern extracts a documented count", good.claims.get("pacs-access")?.count === 68]);

  // A reformat away from the word "checks" must match NOTHING — which is exactly
  // why the floor exists: silence must read as broken, not as green.
  const reworded = parseClaims([["a.md", "`pnpm run proof:pacs-access` (68 assertions)"]]);
  checks.push(["a '(N assertions)' reformat matches nothing", reworded.claims.size === 0]);

  // Two docs disagreeing is caught.
  const clash = parseClaims([
    ["a.md", "proof:x (10 checks)"],
    ["b.md", "proof:x (11 checks)"],
  ]);
  checks.push(["docs disagreeing on a count is flagged", clash.disagreements.length === 1]);

  // THE FLOOR CAN FAIL: a below-floor claim count is fatal. Zero claims — the
  // silenced-gate case — is below the floor and therefore RED.
  checks.push(["zero documented claims is below the floor (RED)", 0 < CLAIM_FLOOR]);
  checks.push([`the floor is a real bar (${CLAIM_FLOOR} > 0)`, CLAIM_FLOOR > 0]);

  // A proof with no summary line is described, not just counted: status, signal, error code, elapsed time and a
  // bounded output tail (#2387). Each synthetic case below has no summary, so it stays a failure.
  const SUMMARY = /summary=(pass|fail) \((\d+)\/(\d+)\)/;
  const timeout = { status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stdout: "  ok — a\n  ok — b\n", stderr: "" };
  const t = describeChildFailure(timeout, 120004, 120000);
  checks.push(["a timed-out child is reported as a timeout with its signal and elapsed time",
    t[0].includes("signal=SIGTERM") && t[0].includes("error=ETIMEDOUT") && t[0].includes("TIMED OUT") && t[0].includes("elapsed=120004ms") &&
    t.some((l) => l.includes("ok — b")) && !SUMMARY.test(`${timeout.stdout}`)]);
  const crash = { status: 1, signal: null, error: undefined, stdout: "", stderr: "Error: Cannot find module 'x'\n    at load\n" };
  const c = describeChildFailure(crash, 812, 120000);
  checks.push(["a child that exits 1 with no summary keeps its status and the end of stderr",
    c[0].includes("status=1") && c[0].includes("error=none") && !c[0].includes("TIMED OUT") && c.some((l) => l.includes("Cannot find module"))]);
  const enoent = { status: null, signal: null, error: { code: "ENOENT" }, stdout: null, stderr: null };
  const e = describeChildFailure(enoent, 3, 120000);
  checks.push(["a child that could not start reports its error code and says it printed nothing",
    e[0].includes("error=ENOENT") && e.includes("    the child printed no output")]);
  const flood = { status: 1, signal: null, stdout: Array.from({ length: 500 }, (_, i) => `line ${i} ${"x".repeat(400)}`).join("\n"), stderr: "" };
  const f = describeChildFailure(flood, 5, 120000);
  checks.push([`a flooding child is bounded to ${TAIL_LINES} tail lines of at most ${TAIL_WIDTH} characters (plus the ellipsis)`,
    f.length === 2 + TAIL_LINES && f.slice(2).every((l) => l.length <= "      | ".length + TAIL_WIDTH + 1) && f[f.length - 1].includes("line 499")]);
  // THROUGH THE REAL CAPTURE: build the gate's stdout and stderr exactly as the main loop emits them and keep
  // what preflight keeps. Every fault's proof name and outcome must survive, whatever came before the recap.
  const okLines = Array.from({ length: 63 }, (_, i) => `  ✓ proof:p${i} — 10 checks, matches docs`).join("\n") + "\n";
  const tenLine = { status: 1, signal: null, stdout: Array.from({ length: 30 }, (_, i) => `  ok — step ${i}`).join("\n"), stderr: "" };
  const detail = (name, run) => [`✗ proof:${name} — could not read a summary line (did the proof fail to run?)`, ...describeChildFailure(run, 9000, 120000)];
  const emit = (blocks, faultList) => [...blocks.flat(), "", ...finalReport(faultList)].join("\n") + "\n";
  const survives = (tail, faultList) => faultList.slice(0, RECAP_MAX).every((f) => tail.includes(`  ✗ proof:${f.name} — ${f.outcome}`)) &&
    tail[tail.length - 1].startsWith(`Proof-count check FAILED: ${faultList.length} proof(s)`);
  const twoFaults = [{ name: "alpha", outcome: childOutcome(timeout, 120004, 120000) }, { name: "beta", outcome: childOutcome(tenLine, 9000, 120000) }];
  const twoTail = preflightTail(okLines, emit([detail("alpha", timeout), detail("beta", tenLine)], twoFaults));
  checks.push(["two no-summary failures: both proof names and outcomes survive preflight's 25-line capture", survives(twoTail, twoFaults) &&
    twoTail.some((l) => l.includes("proof:alpha — no summary line") && l.includes("TIMED OUT"))]);
  const mism = Array.from({ length: 13 }, (_, i) => ({ name: `m${i}`, outcome: `docs say 10 checks, proof reports 11` }));
  const mixFaults = [{ name: "alpha", outcome: childOutcome(timeout, 120004, 120000) }, ...mism];
  const mixTail = preflightTail(okLines, emit([detail("alpha", timeout), ...mism.map((m) => [`✗ proof:${m.name} — docs say 10 checks, proof reports 11 (update: a.md)`])], mixFaults));
  checks.push(["a no-summary failure followed by 13 count mismatches keeps the first fault named, with an explicit omission count",
    survives(mixTail, mixFaults) && mixTail.some((l) => l.includes("proof:alpha — no summary line")) && mixTail.some((l) => l.includes("… and 4 more fault(s)"))]);
  checks.push(["the recap and verdict alone always fit the capture", finalReport(Array.from({ length: 99 }, (_, i) => ({ name: `x${i}`, outcome: "o" }))).length <= 25]);
  // WIRING: the gate's own no-summary branch prints this diagnostic; a helper nobody calls proves nothing.
  const own = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const branch = own.slice(own.lastIndexOf("could not read a summary line (did the proof fail to run?)"));
  checks.push(["the no-summary branch prints describeChildFailure before counting the failure",
    /^[^\n]*\n\s*for \(const line of describeChildFailure\(run, elapsed, PROOF_CEILING_MS\)\) console\.error\(line\);\n\s*faults\.push\(\{ name, outcome: childOutcome\(run, elapsed, PROOF_CEILING_MS\) \}\);/.test(branch)]);
  checks.push(["a failed run ends with finalReport (the recap and the verdict are the last lines it prints)",
    /if \(faults\.length > 0\) \{\n\s*console\.error\(""\);\n\s*for \(const line of finalReport\(faults\)\) console\.error\(line\);\n\s*process\.exit\(1\);\n\}/.test(own)]);

  // LIVE: the real docset must clear the floor, or the parser has drifted.
  const live = parseClaims(readDocs());
  checks.push([`LIVE: the real docset has ${live.claims.size} documented proof counts (floor ${CLAIM_FLOOR})`, live.claims.size >= CLAIM_FLOOR]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const { claims, disagreements } = parseClaims(readDocs());
for (const d of disagreements) {
  console.error(`✗ docs disagree with each other: ${d}`);
  process.exitCode = 1;
}

if (claims.size < CLAIM_FLOOR) {
  console.error(
    `✗ Proof-count check: only ${claims.size} documented "(N checks)" claim(s) found (floor ${CLAIM_FLOOR}).\n` +
      "  The scan is broken, not the repo — a docs reformat away from the word \"checks\" would\n" +
      "  otherwise silence this gate. Fix the pattern or restore the documented counts.",
  );
  process.exit(1);
}

const faults = [];
for (const [name, { count, files }] of [...claims].sort()) {
  const started = performance.now();
  const run = spawnSync("pnpm", ["run", `proof:${name}`], {
    cwd: repoRoot,
    encoding: "utf8",
    // Proofs are offline and fast; a generous per-proof ceiling still bounds the gate.
    timeout: PROOF_CEILING_MS,
  });
  const elapsed = performance.now() - started;
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = output.match(/summary=(pass|fail) \((\d+)\/(\d+)\)/);
  if (!summary) {
    console.error(`✗ proof:${name} — could not read a summary line (did the proof fail to run?)`);
    for (const line of describeChildFailure(run, elapsed, PROOF_CEILING_MS)) console.error(line);
    faults.push({ name, outcome: childOutcome(run, elapsed, PROOF_CEILING_MS) });
    continue;
  }
  const [, verdict, passed, total] = summary;
  if (verdict !== "pass") {
    console.error(`✗ proof:${name} — proof itself is failing (${passed}/${total})`);
    faults.push({ name, outcome: `proof itself is failing (${passed}/${total})` });
    continue;
  }
  if (Number(total) !== count) {
    console.error(
      `✗ proof:${name} — docs say ${count} checks, proof reports ${total}` +
        ` (update: ${[...files].join(", ")})`,
    );
    faults.push({ name, outcome: `docs say ${count} checks, proof reports ${total}` });
  } else {
    console.log(`  ✓ proof:${name} — ${total} checks, matches docs`);
  }
}

if (faults.length > 0) {
  console.error("");
  for (const line of finalReport(faults)) console.error(line);
  process.exit(1);
}
console.log(`\nProof-count check passed — all ${claims.size} documented counts match their proofs.`);
