#!/usr/bin/env node
// sim-result provenance — a green attestation whose commit names nothing cannot be checked.
//
// `artifacts/sim-results/*.json` are records of an execution on the Mac lane, and the
// only thing that ties one to the code it measured is `provenance.commit`. The runner
// samples the LOCAL HEAD before the runs (CLAUDE.md, "provenance is the product"), so a
// squash-land can drop that sha from shared history — `2026-09-02-ios-shell-repair.json`
// stamped 0c7f53a2, which `git cat-file -e` could not resolve on Alpha. The file still
// read as a green run of "the code", against a commit nobody could ever look at.
//
// This gate asks three checkable things of every result, and nothing else:
//
//   1. `provenance.commit` is a full 40-hex sha.          FATAL if not.
//   2. If the sha RESOLVES here, it is an ancestor of HEAD. FATAL if not — a sha that
//      resolves and is not in this history belongs to another branch, which is a
//      different claim from the one the file makes.
//   3. Every evidence file the result CITES exists,        FATAL if missing,
//      and none of them has a LATER last-touch commit than the result JSON itself —
//      evidence that landed after the record is evidence the record's provenance
//      never covered.
//
// REPORTED, never fatal: a sha this checkout cannot resolve. CI clones shallow
// (`--depth`), and a cross-lane sha that has not landed yet is a fact about the clone,
// not about the file. A gate that goes red on every shallow runner gets switched off.
//
// `--require-history` turns the two REPORTED shallow-clone cases (an unresolvable sha, an
// unknown last-touch time) into FATAL ones, and refuses to run at all on a shallow clone
// (fail closed: the flag is a claim about the checkout, so the checkout is asked). Run it
// where history is full: the CI validation job deepens first, then runs this; local preflight
// and the Mac full-clone lanes run the plain form, which still reports.
//
// NOT IN SCOPE, deliberately: throughput, latency, durations and any other number in
// the `runs` array. Those move with the machine; binding them here would make this a
// flaky gate over measurements it has no way to reproduce.
//
//   node scripts/check-sim-result-provenance.mjs
//   node scripts/check-sim-result-provenance.mjs --require-history
//   node scripts/check-sim-result-provenance.mjs --self-test
import { readdirSync, readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS_DIR = "artifacts/sim-results";

/** The scan is broken, not the tree, if it finds fewer results than this. */
const MIN_RESULTS = 5;

/**
 * Evidence directories that legitimately carry a LATER last-touch commit than the
 * result JSON that cites them, each with the reason, checked by name. A pattern here
 * would absorb the next unrelated case silently.
 *
 * Only one exists, and it is history rather than a defect: the result landed on
 * mainline in 7b80a646 ("ios-shell-repair: re-mint evidence on mainline") and its
 * screenshots/logs arrived ~3.4h later inside 35fac302 ("Land iOS SwiftUI Phase 3
 * (ActiveSession) — Mac lane (#412)"), a separate PR from the same lane and the same
 * run. Both are on Alpha and both are readable; what is not true is that the JSON's
 * provenance covered them. Recorded rather than rewritten — the commits cannot be
 * un-split now, and pretending otherwise is the dishonesty this gate exists against.
 */
export const EVIDENCE_LATER_OK = new Map([
  [
    "artifacts/sim-results/ios-shell-repair-2026-09-03",
    "evidence landed in 35fac302 (#412), 3.4h after the result commit 7b80a646; same lane, same run, both on Alpha",
  ],
]);

const SHA_RE = /^[0-9a-f]{40}$/;

/** Pure. Evidence paths a result JSON cites: `artifacts/sim-results/<dir>/<file>`,
 *  where `<dir>` is a directory (a sibling result JSON is not evidence). Returns the
 *  distinct paths in first-seen order — the scan reads the raw TEXT, because the paths
 *  live inside `runs[].tail` strings rather than in a field of their own. */
export function citedEvidencePaths(jsonText) {
  const out = [];
  for (const m of jsonText.matchAll(/artifacts\/sim-results\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/g)) {
    const p = `artifacts/sim-results/${m[1]}/${m[2]}`;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Pure core, so the self-test can drive every verdict without a git repository.
 *
 * `facts` is what the live run measures:
 *   { file, commit, resolves, isAncestor, jsonCommitTime, evidence: [{ path, exists, commitTime }] }
 * Returns { fatal: [...], reported: [...] }.
 */
export function verdictFor(facts, laterOk = EVIDENCE_LATER_OK, { requireHistory = false } = {}) {
  const fatal = [];
  const reported = [];
  const where = facts.file;

  if (!facts.commit) fatal.push(`${where}: provenance.commit is missing — the record names no code at all`);
  else if (!SHA_RE.test(facts.commit)) fatal.push(`${where}: provenance.commit "${facts.commit}" is not a 40-hex sha`);
  else if (!facts.resolves && requireHistory) {
    fatal.push(`${where}: ${facts.commit} does not resolve, and --require-history says this checkout holds full history — a sha nobody can look at attests to nothing`);
  } else if (!facts.resolves) {
    reported.push(`${where}: ${facts.commit} does not resolve in this checkout (shallow clone, or a cross-lane sha that has not landed)`);
  } else if (!facts.isAncestor) {
    fatal.push(`${where}: ${facts.commit} resolves but is NOT an ancestor of HEAD — it belongs to another history, so this result attests to code this branch does not carry`);
  }

  for (const e of facts.evidence ?? []) {
    if (!e.exists) {
      fatal.push(`${where}: cites evidence ${e.path}, which is not in the tree — an unreadable attestation`);
      continue;
    }
    const dir = e.path.slice(0, e.path.lastIndexOf("/"));
    if (e.commitTime === null || facts.jsonCommitTime === null) {
      if (requireHistory) {
        fatal.push(`${where}: last-touch commit unknown for ${e.path} or for the result itself, and --require-history says history is full — freshness cannot be shown`);
        continue;
      }
      reported.push(`${where}: last-touch commit unknown for ${e.path} or for the result itself (shallow clone) — freshness not checked`);
      continue;
    }
    if (e.commitTime > facts.jsonCommitTime) {
      if (laterOk.has(dir)) continue;
      fatal.push(
        `${where}: evidence ${e.path} was last touched AFTER the result was committed ` +
          `(${e.commitTime} > ${facts.jsonCommitTime}) — the provenance sampled at launch cannot cover it`,
      );
    }
  }
  return { fatal, reported };
}

// ── live run ────────────────────────────────────────────────────────────────
const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
const commitTime = (path) => {
  const r = git("log", "-1", "--format=%ct", "--", path);
  const t = Number.parseInt((r.stdout ?? "").trim(), 10);
  return Number.isFinite(t) ? t : null;
};

function liveFacts() {
  const dir = join(repo, RESULTS_DIR);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    const rel = `${RESULTS_DIR}/${f}`;
    const text = readFileSync(join(dir, f), "utf8");
    let commit = null;
    try {
      commit = JSON.parse(text)?.provenance?.commit ?? null;
    } catch {
      commit = null;
    }
    const resolves = Boolean(commit) && git("cat-file", "-e", `${commit}^{commit}`).status === 0;
    const isAncestor = resolves && git("merge-base", "--is-ancestor", commit, "HEAD").status === 0;
    const evidence = citedEvidencePaths(text)
      .filter((p) => p !== rel)
      .map((p) => {
        const exists = existsSync(join(repo, p));
        return { path: p, exists, commitTime: exists ? commitTime(p) : null };
      });
    return { file: rel, commit, resolves, isAncestor, jsonCommitTime: commitTime(rel), evidence };
  });
}

/**
 * End-to-end: a scratch git repository holding a copy of this script and six result JSONs,
 * one given a 40-hex sha that exists nowhere. Without the flag the gate exits 0 (it
 * REPORTS); under --require-history it exits 1; a shallow scratch clone under the flag also
 * exits 1, because "full history" is a claim the gate checks rather than assumes.
 */
function scratchCloneChecks(ok) {
  const root = mkdtempSync(join(tmpdir(), "prov-selftest-"));
  const run = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: "utf8" });
  const g = (cwd, ...args) => run(cwd, "git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args]);
  try {
    const src = join(root, "src");
    mkdirSync(join(src, "scripts"), { recursive: true });
    mkdirSync(join(src, RESULTS_DIR), { recursive: true });
    copyFileSync(fileURLToPath(import.meta.url), join(src, "scripts", "check-sim-result-provenance.mjs"));
    g(src, "init", "-q");
    writeFileSync(join(src, "root.txt"), "root\n");
    g(src, "add", "-A");
    g(src, "commit", "-q", "-m", "root");
    writeFileSync(join(src, "seed.txt"), "seed\n");
    g(src, "add", "-A");
    g(src, "commit", "-q", "-m", "seed");
    const head = g(src, "rev-parse", "HEAD").stdout.trim();
    for (let i = 0; i < MIN_RESULTS + 1; i += 1) {
      writeFileSync(join(src, RESULTS_DIR, `r${i}.json`), JSON.stringify({ provenance: { commit: head } }));
    }
    g(src, "add", "-A");
    g(src, "commit", "-q", "-m", "results");
    const gate = (cwd, ...flags) => run(cwd, "node", [join(cwd, "scripts", "check-sim-result-provenance.mjs"), ...flags]).status;

    const cleanDefault = gate(src);
    const cleanFlag = gate(src, "--require-history");
    writeFileSync(join(src, RESULTS_DIR, "r0.json"), JSON.stringify({ provenance: { commit: "b".repeat(40) } }));
    g(src, "add", "-A");
    g(src, "commit", "-q", "-m", "ghost sha");
    const ghostDefault = gate(src);
    const ghostFlag = gate(src, "--require-history");

    // A depth-2 clone of the CLEAN tree: every cited sha still resolves, so the only thing
    // that can turn this red is the shallow refusal itself.
    g(src, "reset", "-q", "--hard", "HEAD~1");
    const shallow = join(root, "shallow");
    g(root, "clone", "-q", "--depth", "2", `file://${src}`, shallow);
    const shallowDefault = gate(shallow);
    const shallowFlag = gate(shallow, "--require-history");
    return [
      ok("scratch clone: a full, clean tree passes with and without --require-history", cleanDefault === 0 && cleanFlag === 0),
      ok("scratch clone: an unresolvable 40-hex sha exits 0 without the flag (reported)", ghostDefault === 0),
      ok("scratch clone: the same sha exits 1 under --require-history", ghostFlag === 1),
      ok("scratch clone: --require-history on a SHALLOW clone exits 1 (full history is checked, not assumed)", shallowDefault === 0 && shallowFlag === 1),
    ];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function selfTest() {
  const ok = (name, cond) => ({ name, cond });
  const base = {
    file: "x.json",
    commit: "a".repeat(40),
    resolves: true,
    isAncestor: true,
    jsonCommitTime: 100,
    evidence: [],
  };
  const laterOk = new Map([["artifacts/sim-results/waived", "declared for the self-test"]]);
  const checks = [
    ok("a clean record is clean", verdictFor(base).fatal.length === 0 && verdictFor(base).reported.length === 0),
    ok("a missing commit is FATAL", verdictFor({ ...base, commit: null }).fatal.length === 1),
    ok("a short sha is FATAL", verdictFor({ ...base, commit: "0c7f53a2" }).fatal.length === 1),
    ok(
      "an unresolvable sha is REPORTED, never fatal (shallow clones are not defects)",
      (() => {
        const v = verdictFor({ ...base, resolves: false, isAncestor: false });
        return v.fatal.length === 0 && v.reported.length === 1;
      })(),
    ),
    ok(
      "--require-history: an unresolvable sha is FATAL (history is full where this runs)",
      (() => {
        const v = verdictFor({ ...base, resolves: false, isAncestor: false }, laterOk, { requireHistory: true });
        return v.fatal.length === 1 && v.reported.length === 0;
      })(),
    ),
    ok(
      "--require-history: an unknown last-touch time is FATAL, not reported",
      (() => {
        const ev = [{ path: "artifacts/sim-results/d/a.png", exists: true, commitTime: null }];
        return (
          verdictFor({ ...base, evidence: ev }, laterOk, { requireHistory: true }).fatal.length === 1 &&
          verdictFor({ ...base, evidence: ev }, laterOk).fatal.length === 0
        );
      })(),
    ),
    ok(
      "--require-history changes nothing for a clean, resolvable record",
      (() => {
        const v = verdictFor(base, laterOk, { requireHistory: true });
        return v.fatal.length === 0 && v.reported.length === 0;
      })(),
    ),
    ok("a resolvable NON-ancestor sha is FATAL", verdictFor({ ...base, isAncestor: false }).fatal.length === 1),
    ok(
      "a cited evidence file that is not in the tree is FATAL",
      verdictFor({ ...base, evidence: [{ path: "artifacts/sim-results/d/a.png", exists: false, commitTime: null }] }).fatal.length === 1,
    ),
    ok(
      "evidence touched AFTER the result is FATAL",
      verdictFor({ ...base, evidence: [{ path: "artifacts/sim-results/d/a.png", exists: true, commitTime: 101 }] }).fatal.length === 1,
    ),
    ok(
      "evidence touched BEFORE or WITH the result is clean",
      verdictFor({ ...base, evidence: [{ path: "artifacts/sim-results/d/a.png", exists: true, commitTime: 100 }] }).fatal.length === 0,
    ),
    ok(
      "a DECLARED later-evidence directory is waived, and only that directory",
      verdictFor({ ...base, evidence: [{ path: "artifacts/sim-results/waived/a.png", exists: true, commitTime: 101 }] }, laterOk).fatal.length === 0 &&
        verdictFor({ ...base, evidence: [{ path: "artifacts/sim-results/other/a.png", exists: true, commitTime: 101 }] }, laterOk).fatal.length === 1,
    ),
    ok(
      "an unknown last-touch time is REPORTED, never fatal",
      verdictFor({ ...base, evidence: [{ path: "artifacts/sim-results/d/a.png", exists: true, commitTime: null }] }).reported.length === 1,
    ),
    ok(
      "evidence paths are lifted out of the tail strings, and a sibling result JSON is not one",
      (() => {
        const found = citedEvidencePaths('{"t":["log: artifacts/sim-results/run-1/02-build.log","artifacts/sim-results/2026-01-01-x.json"]}');
        return found.length === 1 && found[0] === "artifacts/sim-results/run-1/02-build.log";
      })(),
    ),
    ok(
      "every declared waiver carries a reason",
      [...EVIDENCE_LATER_OK.values()].every((r) => typeof r === "string" && r.trim().length > 0),
    ),
  ];
  checks.push(...scratchCloneChecks(ok));
  let bad = 0;
  for (const c of checks) {
    console.log(`  ${c.cond ? "ok" : "FAIL"} — ${c.name}`);
    if (!c.cond) bad += 1;
  }
  console.log(`\nself-test: ${checks.length - bad}/${checks.length}`);
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

const requireHistory = process.argv.includes("--require-history");
if (requireHistory && git("rev-parse", "--is-shallow-repository").stdout.trim() !== "false") {
  console.error("sim-result provenance: --require-history on a shallow (or unreadable) checkout — deepen it first (git fetch --unshallow); refusing to report a clean run over history it cannot see.");
  process.exit(1);
}
const facts = liveFacts();
console.log(`sim-result provenance — ${facts.length} result(s) under ${RESULTS_DIR}\n`);
if (facts.length < MIN_RESULTS) {
  console.error(`  ✗ only ${facts.length} result JSON(s) found — the scan is broken, not the tree (floor ${MIN_RESULTS}).`);
  process.exit(1);
}

const fatal = [];
const reported = [];
for (const f of facts) {
  const v = verdictFor(f, EVIDENCE_LATER_OK, { requireHistory });
  fatal.push(...v.fatal);
  reported.push(...v.reported);
  const evi = f.evidence.length;
  console.log(`  ${v.fatal.length === 0 ? "ok" : "✗ "} ${f.file}  ${f.commit ? f.commit.slice(0, 8) : "no-commit"}  ${f.resolves ? (f.isAncestor ? "ancestor" : "NOT-ANCESTOR") : "unresolved"}  evidence=${evi}`);
}

if (reported.length > 0) {
  console.log(`\nREPORTED (never fatal) — ${reported.length}:`);
  for (const r of reported) console.log(`  · ${r}`);
}

if (fatal.length > 0) {
  console.error(`\nsim-result provenance FAILED — ${fatal.length} finding(s):\n`);
  for (const f of fatal) console.error(`  ✗ ${f}`);
  console.error(
    "\nA result JSON is an attestation. Re-mint it at a commit this history carries, commit the\n" +
      "evidence it cites in the SAME change, or — if the split is history that cannot be undone —\n" +
      "declare the directory in EVIDENCE_LATER_OK with the reason a reader can check.",
  );
  process.exit(1);
}
console.log(`\nsim-result provenance holds — every result names a checkable commit and cites evidence no newer than itself.`);
