#!/usr/bin/env node
/**
 * The mutation sweep is sharded across CI runners. This gate proves the sharder
 * PARTITIONS the registry — every target lands in exactly one shard, for every
 * shard count the lane might plausibly use.
 *
 * WHY THIS IS A GATE AND NOT A COMMENT. A sharder that drops a target does not
 * fail; it reports success over work it never did. That is the precise failure
 * the mutation guard exists to catch, and putting it in the SCHEDULER would put
 * it somewhere the mutation guard cannot see. The sweep takes forty minutes, so
 * nobody re-runs it to check the split; this runs in milliseconds because
 * `mutationsFor` parses text and executes no proof.
 *
 * Balance is REPORTED, never gated. The spread depends on how lumpy the registry
 * happens to be, and a threshold on it would fail the build for a defensible
 * distribution — a flaky gate gets switched off, and this one is worth keeping.
 */
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TARGETS, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, journalWrite, journalRestore, journalStale, journalClear, journalDir, journalLive, sweepAlive, processCommand, installRestore, classifyRun } from "./mutation-guard.mjs";

let passed = 0;
const failures = [];
const check = (name, ok) => { if (ok) { passed += 1; console.log(`  ok — ${name}`); } else { failures.push(name); console.error(`  FAIL — ${name}`); } };

console.log("Mutation sharding — the split must lose nothing\n");

for (const n of [1, 2, 3, 4, 8, TARGETS.length, TARGETS.length + 3]) {
  const seen = [];
  for (let i = 0; i < n; i += 1) seen.push(...shardTargets(TARGETS, i, n).map((t) => t.proof));
  const unique = new Set(seen);
  check(`N=${n}: every target appears, exactly once (${seen.length} placements, ${unique.size} distinct)`,
    seen.length === TARGETS.length && unique.size === TARGETS.length);
}

// DETERMINISM IS LOAD-BEARING and easy to miss. Each shard runs in its own CI job
// on its own runner, and each computes the partition independently from the same
// registry — nothing communicates the split between them. If two runners disagreed
// about which targets belong to shard 2, some targets would be swept twice and
// others never, and the lane would still report every job green. The agreement is
// implicit, so it is asserted here rather than assumed.
//
// WHAT THIS DOES AND DOES NOT PROVE. It compares repeated computations over the
// same registry, so it catches genuine nondeterminism — a `Math.random`, a clock,
// an environment read — which is the class that would actually desynchronise two
// runners, and the class this repository forbids in decided paths anyway. It does
// NOT prove order-independence, because it cannot: every shard reads the same
// TARGETS from the same commit, so input order is a constant across the matrix and
// order-independence is not a property correctness needs here. Stated because a
// check named "determinism" invites being read as proving more than it does.
for (const n of [3, 4]) {
  const once = shardTargets(TARGETS, 1, n).map((t) => t.proof).join("|");
  const again = shardTargets(TARGETS, 1, n).map((t) => t.proof).join("|");
  const third = shardTargets([...TARGETS], 1, n).map((t) => t.proof).join("|");
  check(`N=${n}: shard 1 is identical across independent computations, in order`,
    once === again && once === third);
}

// Falsification: the guard must reject shard arguments that cannot describe a partition.
for (const [i, n] of [[0, 0], [2, 2], [-1, 3], [1.5, 3]]) {
  let threw = false;
  try { shardTargets(TARGETS, i, n); } catch { threw = true; }
  check(`rejects --shard=${i}/${n} rather than silently sweeping a subset`, threw);
}

// ── The mutators must still fire on the shapes they exist to catch ────────────
//
// The sharder above proves no TARGET is dropped. This proves no MUTATOR is
// silently neutered — the other way the sweep can report success over work it
// never did. A one-character narrowing of an operand regex (`(.+)` → `([^)]+)`)
// stops mutating every function-call guard operand, and because the full sweep
// is scheduled/post-merge, no per-PR check would notice: the drop reads as
// "skipped", never SURVIVOR. So each mutator is asserted to fire on a
// representative guard-line shape, through the SAME `lineMutations` the sweep
// uses. The fixture that matters most is a `&&`/`||` operand carrying a `)` — the
// exact multi-term shape (`isFinite(x) &&`, `!contradictory(cand) &&`) two named
// findings were built to catch and the exact shape the narrowing kills.
const MUTATOR_FIXTURES = [
  { line: `  if (isFinite(expiry) && report.ok) {`, expect: ["cond-false"] },
  { line: `  } else if (tier !== "prod") {`, expect: ["else-if-false"] },
  { line: `  } else if (!contradictory) {`, expect: ["else-if-false", "else-if-true"] },
  { line: `    isFinite(expiry) &&`, expect: ["conjunct-true"] },
  { line: `    !contradictory(cand) &&`, expect: ["conjunct-true"] },
  { line: `    report.credentialRef.length > 0 ||`, expect: ["disjunct-false"] },
  { line: `    zone === expectedZone ||`, expect: ["disjunct-false"] },
  { line: `    return false;`, expect: ["return-flip"] },
  { line: `    return true;`, expect: ["return-flip"] },
  { line: `  const remaining = budget - spent;`, expect: [] },
  // The brace-less mutator is OPT-IN per target (`oneLine: true`), so the same
  // guard line is asserted twice: it fires when the target opted in, and it
  // stays silent when it did not — a target that never opted in is never swept
  // by it, and the census line reports that rather than the sweep pretending.
  { line: `  if (typeof raw !== "string") return null;`, opts: { oneLine: true }, expect: ["oneline-cond-false"] },
  { line: `  if (!isPlainReport(report)) return UNKNOWN; // hostile shape`, opts: { oneLine: true }, expect: ["oneline-cond-false"] },
  { line: `  if (typeof raw !== "string") return null;`, expect: [] },
];
// Non-vacuity: the case set is itself pinned. Deleting fixtures to weaken this
// self-test is the same class of attack it defends against, so a shrunk fixture
// list fails the gate. Also assert every mutator id is exercised by at least one
// fixture, so adding a mutator without a fixture cannot leave it untested.
const FIXTURE_FLOOR = 13;
check(`mutator self-test is non-vacuous (${MUTATOR_FIXTURES.length} fixtures, floor ${FIXTURE_FLOOR})`,
  MUTATOR_FIXTURES.length >= FIXTURE_FLOOR);
const exercised = new Set(MUTATOR_FIXTURES.flatMap((f) => f.expect));
check(`every mutator id is exercised by a fixture (${exercised.size}/${MUTATORS.length})`,
  MUTATORS.every((m) => exercised.has(m.id)));
for (const f of MUTATOR_FIXTURES) {
  const got = lineMutations(f.line, f.opts ?? {}).map((x) => x.mutator).sort();
  const want = [...f.expect].sort();
  check(`mutators fire on \`${f.line.trim()}\`${f.opts?.oneLine ? " (oneLine opt-in)" : ""} → [${want.join(", ") || "none"}]`,
    got.length === want.length && got.every((id, i) => id === want[i]));
}

// ── The hand-registered safety-critical targets must stay in the registry ─────
//
// `check-guard-registries.mjs` only requires the GRANT-SAFETY population to be in
// TARGETS; these four are registered by hand and sit outside it, so dropping one
// (e.g. `continuity.ts`, whose reconcileDecisions can emit `allow`) escapes that
// gate and shrinks the sweep by one safety-critical file with every per-PR check
// still green. Pin them by name.
const PINNED_PROOFS = ["proof:verdict-attestation", "proof:decision-continuity", "proof:pim-activation", "proof:dual-control"];
const present = new Set(TARGETS.map((t) => t.proof));
for (const p of PINNED_PROOFS) {
  check(`hand-registered safety-critical target present: ${p}`, present.has(p));
}

// ── Wave 5 (2026-10-01): six families joined the brace-less sweep ─────────────
// Their registered files held no one-line `if (...) return` guard when they joined, so
// joining added 0 mutations and 0 survivors — the opt-in is a ratchet for the NEXT
// brace-less guard added there. Pin it so the flag cannot be dropped quietly.
for (const p of ["ot-posture", "token-binding", "carrier-reachability", "credential-exposure", "data-protection", "identity-risk"]) {
  check(`brace-less sweep: proof:${p} stays opted in (oneLine: true)`, TARGETS.find((t) => t.proof === `proof:${p}`)?.oneLine === true);
}

// The three connector files round-1 review found unswept must STAY registered: the proofs pin their
// guards, but only the registration makes the sweep notice if a pin is ever lost.
for (const [proof, file] of [
  ["proof:carrier-reachability", "lib/integrations/src/integrations/carrier/reachability-connector.ts"],
  ["proof:ot-posture", "lib/integrations/src/integrations/ot-posture/ot-connector.ts"],
  ["proof:token-binding", "lib/integrations/src/integrations/token-binding/token-binding-connector.ts"],
]) {
  check(`${proof} keeps its connector registered: ${file.split("/").pop()}`, TARGETS.find((t) => t.proof === proof)?.files.includes(file) === true);
}

// The decision ladder the carrier proof imports (evaluateReachability) was registered under no
// entry until 2026-10-01, so its mutations were never swept. Dropping the line must go red.
check("proof:carrier-reachability keeps its decision ladder registered: evaluate.ts",
  TARGETS.find((t) => t.proof === "proof:carrier-reachability")?.files.includes("lib/integrations/src/integrations/carrier/evaluate.ts") === true);

// ── The mutation journal: a killed sweep must not leave a broken guard in the tree ─────────────
// Exercised on a scratch directory, through the SAME functions the sweep calls. A journal whose
// restore silently did nothing would read as green here only if the restore check below passed.
{
  const root = mkdtempSync(join(tmpdir(), "mg-journal-root-"));
  const jdir = mkdtempSync(join(tmpdir(), "mg-journal-dir-"));
  try {
    mkdirSync(join(root, "lib"), { recursive: true });
    const file = "lib/guard.ts";
    const original = "if (x) return 1;\n";
    writeFileSync(join(root, file), original);
    journalWrite(jdir, 4242, [{ file, original }]);
    writeFileSync(join(root, file), "if (false) return 1;\n"); // the mutation, never restored
    const stale = journalStale(jdir, root, () => false);
    check("a dead sweep's journal is reported stale, naming the file whose bytes differ",
      stale.length === 1 && stale[0].differing.length === 1 && stale[0].differing[0] === file);
    check("a journal whose sweep is still alive is NOT reported stale", journalStale(jdir, root, () => true).length === 0);
    const restored = journalRestore(jdir, 4242, root);
    check("journalRestore writes the original bytes back and reports the file",
      restored.length === 1 && readFileSync(join(root, file), "utf8") === original);
    check("journalRestore is idempotent and leaves no journal behind", journalRestore(jdir, 4242, root).length === 0 && journalStale(jdir, root, () => false).length === 0);
    writeFileSync(join(jdir, "7.json"), "{not json");
    check("an unreadable journal is stale (fail closed), not ignored", journalStale(jdir, root, () => false).some((j) => j.unreadable));
    let outsideRefused = false;
    journalWrite(jdir, 9, [{ file: "../escape.txt", original: "x" }]);
    try { journalRestore(jdir, 9, root); } catch { outsideRefused = true; }
    check("a journal entry that escapes the repo root is refused, never written", outsideRefused && journalStale(jdir, root, () => false).some((j) => j.pid === 9 && j.unreadable));
    journalClear(jdir, 9);
    const loose = mkdtempSync(join(tmpdir(), "mg-journal-loose-"));
    try { chmodSync(loose, 0o755); let refused = false; try { journalWrite(loose, 1, []); } catch { refused = true; } check("a journal dir open to group/other is refused (insecure temp dir)", refused); } finally { rmSync(loose, { recursive: true, force: true }); }
    journalClear(jdir, 7); journalWrite(jdir, 8, [{ file, original }]); journalClear(jdir, 8);
    check("journalClear removes the journal", journalStale(jdir, root, () => false).length === 0);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(jdir, { recursive: true, force: true }); }
}
// pid reuse: a journal named after THIS process cannot belong to a live sweep (we have written none
// yet), and a bare live pid that is not a mutation-guard is not a live sweep either.
{
  const jdir = mkdtempSync(join(tmpdir(), "mg-journal-pid-"));
  const root = mkdtempSync(join(tmpdir(), "mg-journal-pidroot-"));
  try {
    writeFileSync(join(root, "g.ts"), "mutated");
    journalWrite(jdir, process.pid, [{ file: "g.ts", original: "orig" }]);
    check("a journal named after our own pid is STALE, never 'alive' (pid reuse / pid 1 in a container)",
      journalStale(jdir, root).length === 1 && journalLive(jdir).length === 0);
    check("a live pid that is not a mutation sweep does not count as a live sweep", sweepAlive(process.pid) === false && sweepAlive(1) === false);
    check("a journal whose sweep IS alive blocks a second sweep (journalLive)", journalLive(jdir, () => true).length === 1);
  } finally { rmSync(jdir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
}
check("the own-pid rule holds on its own (not masked by the cmdline test): own pid never counts, a live mutation-guard pid does",
  sweepAlive(process.pid, process.pid, () => "node mutation-guard.mjs") === false
  && sweepAlive(process.pid, -1, () => "node mutation-guard.mjs") === true
  && sweepAlive(process.pid, -1, () => "node something-else.mjs") === false
  && sweepAlive(process.pid, -1, () => { throw new Error("unreadable"); }) === true);
check("process identity is readable WITHOUT /proc (macOS): processCommand falls back to ps", /node/.test(processCommand(process.pid, "/nonexistent-proc-root")));
{
  const here0 = dirname(fileURLToPath(import.meta.url));
  const repo0 = resolve(here0, "..");
  const scratch = mkdtempSync(join(tmpdir(), "mg-jdir-"));
  try {
    let direct = false; let viaLink = false;
    try { journalDir(repo0, here0); } catch { direct = true; }
    symlinkSync(here0, join(scratch, "link"));
    try { journalDir(repo0, join(scratch, "link")); } catch { viaLink = true; }
    check("a TMPDIR inside the repo root is refused — including a SYMLINK that points into it (realpath, not a lexical path)", direct && viaLink);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

// The real handlers, driven deterministically through an injected process (no child process involved).
{
  const root = mkdtempSync(join(tmpdir(), "mg-restore-root-"));
  const jdir = mkdtempSync(join(tmpdir(), "mg-restore-dir-"));
  const origErr = console.error;
  const logged = [];
  console.error = (m) => { logged.push(String(m)); };
  try {
    const mutate = (pid) => { writeFileSync(join(root, "g.ts"), "mutated"); journalWrite(jdir, pid, [{ file: "g.ts", original: "orig" }]); };
    // exit-time restore
    let proc = Object.assign(new EventEmitter(), { exitCode: 0, exit() {} });
    installRestore({ jDir: jdir, pid: 11, proc, root });
    mutate(11); proc.emit("exit");
    check("the EXIT handler restores a still-journalled mutation (exit-time restore)", readFileSync(join(root, "g.ts"), "utf8") === "orig" && !existsSync(join(jdir, "11.json")));
    // signal restore + exit code
    let exited = null;
    proc = Object.assign(new EventEmitter(), { exitCode: 0, exit(c) { exited = c; } });
    installRestore({ jDir: jdir, pid: 12, proc, root });
    mutate(12); proc.emit("SIGTERM");
    check("the SIGTERM handler restores and exits 143", readFileSync(join(root, "g.ts"), "utf8") === "orig" && exited === 143);
    // a FAILED restore is reported as failed, exit 1, once
    exited = null; logged.length = 0;
    proc = Object.assign(new EventEmitter(), { exitCode: 0, exit(c) { exited = c; } });
    installRestore({ jDir: jdir, pid: 13, proc, root });
    mutate(13); chmodSync(jdir, 0o755);
    proc.emit("SIGTERM"); proc.emit("exit");
    chmodSync(jdir, 0o700);
    check("a FAILED restore says RESTORE FAILED (once), exits 1, and leaves the file as it was — never reports success",
      exited === 1 && readFileSync(join(root, "g.ts"), "utf8") === "mutated" && logged.filter((m) => /RESTORE FAILED/.test(m)).length === 1 && !logged.some((m) => /restored from the journal/.test(m)));
  } finally { console.error = origErr; rmSync(root, { recursive: true, force: true }); rmSync(jdir, { recursive: true, force: true }); }
}

// When may the end-to-end block touch the real tree? Only when the target is byte-identical to HEAD, no
// sweep or other gate run is LIVE (journalLive — the gate's own lock is a marker journal too), and no
// dead sweep left a journal behind (the target may already be mutated).
// Kill a recorded process only if it is still the SAME process (pid + start time) — a pid reused since
// we recorded it belongs to someone else.
function killIfSame(r, startOf, kill) {
  if (r.start === "" || startOf(r.pid) !== r.start) return false;
  kill(r.pid);
  return true;
}
{
  let killed = 0;
  const same = killIfSame({ pid: 7, start: "Mon Oct  2 05:00:00 2026" }, () => "Mon Oct  2 05:00:00 2026", () => { killed += 1; });
  const reused = killIfSame({ pid: 7, start: "Mon Oct  2 05:00:00 2026" }, () => "Mon Oct  2 06:30:00 2026", () => { killed += 10; });
  const blind = killIfSame({ pid: 7, start: "" }, () => "", () => { killed += 100; });
  check("killIfSame: the same process is killed; a reused pid (different start time) and an unreadable start are NOT", same === true && reused === false && blind === false && killed === 1);
}
function e2ePrecondition({ lockDir, gitClean, isAlive }) {
  if (!gitClean || lockDir === null) return false;
  if (journalLive(lockDir, isAlive).length > 0) return false;
  return journalStale(lockDir, undefined, isAlive).every((j) => !j.unreadable && j.differing.length === 0);
}
{
  const root = mkdtempSync(join(tmpdir(), "mg-pre-root-"));
  const dir = mkdtempSync(join(tmpdir(), "mg-pre-dir-"));
  try {
    writeFileSync(join(root, "g.ts"), "orig");
    const dead = () => false; const alive = () => true;
    check("e2e precondition: clean target, nothing live, nothing stale → may run", e2ePrecondition({ lockDir: dir, gitClean: true, isAlive: dead }) === true);
    check("e2e precondition: a target that differs from HEAD → refuses (never records mutated bytes as the original)", e2ePrecondition({ lockDir: dir, gitClean: false, isAlive: dead }) === false);
    journalWrite(dir, 4242, []);
    check("e2e precondition: a LIVE sweep or gate (its lock marker) → refuses", e2ePrecondition({ lockDir: dir, gitClean: true, isAlive: alive }) === false);
    journalClear(dir, 4242);
    journalWrite(dir, 4243, [{ file: "../x", original: "y" }]);
    check("e2e precondition: an unrecovered / unreadable dead-sweep journal → refuses", e2ePrecondition({ lockDir: dir, gitClean: true, isAlive: dead }) === false);
    check("a live run of THIS gate counts as a live sweep (it holds the same lock)", sweepAlive(process.pid, -1, () => "node scripts/check-mutation-sharding.mjs") === true);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
}
{
  // A ps that prints something unrecognised must read as UNREADABLE (→ live), never as "some other process" (→ stale, lock cleared).
  const bin = mkdtempSync(join(tmpdir(), "mg-fakeps-"));
  const oldPath = process.env.PATH;
  try {
    writeFileSync(join(bin, "ps"), "#!/bin/sh\necho '  PID TTY garbage-format'\n", { mode: 0o755 });
    process.env.PATH = `${bin}:${oldPath}`;
    let threw = false;
    try { processCommand(process.pid, "/nonexistent-proc-root"); } catch { threw = true; }
    check("a ps printing an unrecognised format is UNREADABLE (processCommand throws), so the sweep counts as live", threw
      && sweepAlive(process.pid, -1, (p) => processCommand(p, "/nonexistent-proc-root")) === true);
  } finally { process.env.PATH = oldPath; rmSync(bin, { recursive: true, force: true }); }
}

// ── END TO END: the real signal path, through the real sweep ──────────────────────────────────
// The helpers above are pure. The defect this PR exists for lives in main(): the signal handlers,
// the journal-BEFORE-write ordering, the async process-group runner, the lock marker and the startup
// stale check. So this drives a LIVE sweep: start it, wait until a mutation is on disk, start a SECOND
// sweep (must be refused), SIGTERM the first, and assert the registered file is byte-identical, the
// journal is gone and the proof's whole process tree died. Then SIGKILL one (no handler can run) and
// assert the NEXT start refuses naming the file, and `--restore-stale` restores it.
//
// ISOLATION: every sweep here runs with a PRIVATE TMPDIR, so this block can neither see nor delete a
// real dead sweep's journal in the shared temp dir (an earlier version `rm -r`'d it — the recovery
// record). It never matches processes by name: it records the sweep's own descendants by pid. The
// target's bytes are saved and written back in `finally`, so a regression cannot leave the tree dirty.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, "..");
  const guard = join(here, "mutation-guard.mjs");
  const PROOF = "proof:carrier-reachability";
  const target = join(repo, "lib/integrations/src/integrations/carrier/evaluate.ts");
  const original = readFileSync(target, "utf8");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scratch = mkdtempSync(join(tmpdir(), "mg-e2e-"));
  const env = { ...process.env, TMPDIR: scratch };
  const jdir = journalDir(repo, scratch);
  // This block mutates the REAL tree, so it takes the same lock a real sweep takes — in the SHARED journal
  // dir, where a real sweep (or another gate run) would see it — and refuses, touching nothing, unless
  // the target is byte-identical to HEAD, no sweep or gate is live, and no dead sweep left a journal
  // (the target may already be mutated: its current bytes must never be recorded as "the original").
  const lockDir = (() => { try { return journalDir(repo); } catch { return null; } })();
  const gitClean = spawnSync("git", ["diff", "--quiet", "HEAD", "--", target], { cwd: repo }).status === 0;
  let lockHeld = false;
  let preconditionOk = false;
  try {
    preconditionOk = e2ePrecondition({ lockDir, gitClean });
    if (preconditionOk) { journalWrite(lockDir, process.pid, []); lockHeld = true; }
  } catch { preconditionOk = false; }
  const startSweep = (args = []) => {
    const child = spawn("node", [guard, `--proof=${PROOF}`, ...args], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const exited = new Promise((r) => child.on("close", (code, signal) => r({ code, signal, out })));
    return { child, exited, output: () => out };
  };
  const waitFor = async (fn, limitMs) => { for (let t = 0; t < limitMs; t += 50) { if (fn()) return true; await sleep(50); } return false; };
  const dirty = () => readFileSync(target, "utf8") !== original;
  const journalFiles = () => (existsSync(jdir) ? readdirSync(jdir).filter((n) => /^\d+\.json$/.test(n)) : []);
  const descendants = (pid) => {
    const r = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    const kids = (r.stdout ?? "").split("\n").map((x) => Number.parseInt(x, 10)).filter(Number.isFinite);
    return kids.flatMap((k) => [k, ...descendants(k)]);
  };
  const startOf = (pid) => (spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? "").trim();
  const record = (pids) => pids.map((pid) => ({ pid, start: startOf(pid) }));
  // Kill only the SAME process we recorded (pid + start time): a pid reused meanwhile is not ours to kill.
  const killRecorded = (r, group) => {
    killIfSame(r, startOf, (pid) => { try { process.kill(group ? -pid : pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } });
  };
  const isDead = (pid) => {
    // /proc where it exists (a zombie counts as dead); kill(0) elsewhere. ENOENT under /proc means dead ONLY if /proc exists.
    if (existsSync("/proc/self")) { try { return /^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; } }
    try { process.kill(pid, 0); return false; } catch { return true; }
  };
  const live = [];
  try {
    if (!preconditionOk) {
      check("end-to-end signal test: precondition (target identical to HEAD; no live sweep or gate; no unrecovered journal) — refused to run and touched nothing", false);
    } else {
      // 1. SIGTERM mid-mutation, with a second sweep refused meanwhile
      const a = startSweep();
      const marker = await waitFor(() => journalFiles().length > 0, 90000);
      // The marker must exist while the target is still CLEAN (the baseline phase), or a second sweep started
      // during the baseline is not refused. Without the marker the journal appears only with the first mutation.
      check("e2e: a started sweep holds the lock during its BASELINE (journal present while the target is still clean)", marker && !dirty());
      const second = startSweep();
      const rs = await second.exited;
      check("e2e: a SECOND sweep is refused while one is running (exit 1, 'another mutation sweep is running')", rs.code === 1 && /another mutation sweep is running/.test(rs.out));
      const dirtied = await waitFor(dirty, 90000);
      check(`e2e: the first sweep put a mutation on disk with its journal beside it (journal-before-write)${dirtied ? "" : ` [sweep output: ${a.output().slice(-300).replace(/\s+/g, " ")}]`}`, dirtied && journalFiles().length > 0);
      const tree = descendants(a.child.pid); live.push(...record(tree));
      check("e2e: the proof's process tree is observable before the signal (pnpm run … children exist)", tree.length > 0);
      const direct = spawnSync("pgrep", ["-P", String(a.child.pid)], { encoding: "utf8" }).stdout.split("\n").map((x) => Number.parseInt(x, 10)).filter(Number.isFinite);
      const leads = (pid) => Number.parseInt(spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).stdout, 10) === pid;
      check("e2e: the proof runs in its OWN process group (detached), so one group kill reaches its whole tree", direct.length > 0 && direct.every(leads));
      a.child.kill("SIGTERM");
      const ra = await a.exited;
      check(`e2e: SIGTERM mid-run exits 143 and restores the registered file byte-for-byte (exit ${ra.code})`,
        ra.code === 143 && !dirty() && /restored from the journal/.test(ra.out));
      check("e2e: no journal (not even the lock marker) is left behind after SIGTERM", journalFiles().length === 0);
      check("e2e: the proof's WHOLE process tree died with the sweep (no orphan left running)", await waitFor(() => tree.every(isDead), 3000));

      // 2. SIGKILL: no handler can run. The next start must refuse, name the file, and --restore-stale must fix it.
      const b = startSweep();
      const dirtied2 = await waitFor(dirty, 90000);
      const tree2 = record(descendants(b.child.pid)); live.push(...tree2);
      b.child.kill("SIGKILL");
      await b.exited;
      for (const r of tree2) killRecorded(r, true);
      check("e2e: SIGKILL leaves the file mutated (no handler can run) — the case the startup check exists for", dirtied2 && dirty());
      const c = spawnSync("node", [guard, `--proof=${PROOF}`], { cwd: repo, env, encoding: "utf8" });
      check("e2e: the next start REFUSES (exit 1) naming the registered file the journal explains",
        c.status === 1 && /REFUSES to start/.test(c.stderr) && /evaluate\.ts differs from the original recorded in journal/.test(c.stderr));
      const d = spawnSync("node", [guard, "--restore-stale", `--proof=${PROOF}`], { cwd: repo, env, encoding: "utf8" });
      check("e2e: --restore-stale restores the file, exits 0 and does NOT run a sweep", d.status === 0 && !dirty() && !/every registered guard is falsifiable/.test(d.stdout));
      const e = spawnSync("node", [guard, "--restore-stale", `--proof=${PROOF}`], { cwd: repo, env, encoding: "utf8" });
      check("e2e: --restore-stale with NOTHING stale also exits 0 without sweeping (it used to fall through into a full sweep)", e.status === 0 && /no stale journal/.test(e.stdout) && !/every registered guard is falsifiable|── proof:/.test(e.stdout));
    }
  } finally {
    if (readFileSync(target, "utf8") !== original) writeFileSync(target, original);
    for (const r of live) { if (!isDead(r.pid)) killRecorded(r, false); }
    if (lockHeld) journalClear(lockDir, process.pid);
    rmSync(scratch, { recursive: true, force: true });
  }
}

check("classifyRun: pass → survivor, fail/no summary → killed, timeout → hung",
  classifyRun(false, "summary=pass (3/3)") === "survivor" && classifyRun(false, "summary=fail (2/3)") === "killed" && classifyRun(false, "") === "killed" && classifyRun(true, "summary=pass (3/3)") === "hung");
check("--restore-stale is a known flag", unknownArgs(["--restore-stale"]).length === 0);

// An unknown argument must be refused, not fall through to a full in-place sweep.
check("unknown flags are refused (--help, a bare -h, a space-separated --proof)", unknownArgs(["--help"]).length === 1 && unknownArgs(["-h"]).length === 1 && unknownArgs(["--proof", "x"]).length === 2);
check("a bare positional is refused (`mutation-guard.mjs proof:ot-posture` used to sweep everything)", unknownArgs(["proof:ot-posture"]).length === 1);
check("an EMPTY --proof= / --shard= is refused (a falsy value used to select every target)", unknownArgs(["--proof="]).length === 1 && unknownArgs(["--shard="]).length === 1);
check("a malformed value is refused: --proof==, --proof==x, --proof=a=b, --shard=1/4/9, --shard==1/4, --shard=a/b", ["--proof==", "--proof==proof:x", "--proof=a=b", "--shard=1/4/9", "--shard==1/4", "--shard=a/b"].every((a) => unknownArgs([a]).length === 1));
check("known flags and pnpm's forwarded bare -- are accepted", unknownArgs(["--", "--proof=proof:x", "--shard=0/4"]).length === 0);

// Reported, not gated.
const N = Number.parseInt(process.env.MUTATION_SHARDS ?? "4", 10);
const weight = (t) => t.files.reduce((n, f) => n + mutationsFor(f).length, 0);
const loads = Array.from({ length: N }, (_, i) => shardTargets(TARGETS, i, N).reduce((sum, t) => sum + weight(t), 0));
const totalMutations = TARGETS.reduce((n, t) => n + weight(t), 0);
// Report the quantity the sharder actually balances on. An earlier version of this
// line reported FILES per shard while `shardTargets` balanced MUTATIONS — a real
// number answering a different question than the one the reader would take it for.
console.log(`\n  balance at N=${N}, by MUTATIONS per shard: ${loads.join(" · ")}`);
console.log(`  ${TARGETS.length} targets · ${TARGETS.reduce((n, t) => n + t.files.length, 0)} files · ${totalMutations} mutations`);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
