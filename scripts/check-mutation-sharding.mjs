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
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as osConstants, tmpdir } from "node:os";
import { join } from "node:path";
import { TARGETS, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, journalWrite, journalRestore, journalStale, journalClear, journalDir, journalLive, sweepAlive, processCommand, installRestore, classifyRun } from "./mutation-guard.mjs";

// A closed stdout/stderr (the parent died, or `| head`) raises EPIPE on the NEXT write, anywhere in this script — including
// after the e2e block. Swallow it for the whole process, so the gate's exit status stays its own pass/fail result instead
// of a crash with a half-printed report. Anything else is re-thrown.
for (const st of [process.stdout, process.stderr]) st.on("error", (e) => { if (e?.code !== "EPIPE") throw e; });

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
// The gate may write the target back only if IT took the lock (so it mutated nothing otherwise) and the
// file really differs from HEAD's bytes. A refused gate must never write: the file may be a live sweep's mutant.
function shouldRestoreTarget(lockHeld, current, original) {
  return lockHeld === true && Buffer.isBuffer(current) && Buffer.isBuffer(original) && !current.equals(original);
}
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
// What the gate does when IT is signalled (SIGINT/SIGTERM/SIGHUP) while the e2e block has the tree: kill its
// sweeps (the SIGKILLed sweep's journal sits in the gate's scratch dir, which nothing else reads), put the target
// back to HEAD's bytes, drop its lock, and exit. Each step is isolated so one failing cannot skip the restore.
function gateShutdown({ killSweeps, restoreTarget, clearLock, cleanup, exit }, code) {
  for (const step of [killSweeps, restoreTarget, clearLock, cleanup]) { try { step(); } catch { /* never skip the next step */ } }
  exit(code);
}
{
  const order = [];
  const steps = { killSweeps: () => { order.push("kill"); throw new Error("boom"); }, restoreTarget: () => order.push("restore"), clearLock: () => order.push("clear"), cleanup: () => order.push("cleanup"), exit: (c) => order.push(`exit${c}`) };
  gateShutdown(steps, 143);
  check("gateShutdown: kills sweeps, restores the target, clears the lock, cleans up, exits — and a failing step never skips the restore", order.join(",") === "kill,restore,clear,cleanup,exit143");
}
function e2ePrecondition({ lockDir, headBytes, workBytes, isRegular = true, isAlive }) {
  if (isRegular !== true) return false; // a symlink or other non-regular file passes a bytes comparison but is not the file git tracks
  // The bytes the gate will treat as "the original" are HEAD's, and the working file must equal them NOW.
  if (lockDir === null || !Buffer.isBuffer(headBytes) || !Buffer.isBuffer(workBytes) || !headBytes.equals(workBytes)) return false;
  if (journalLive(lockDir, isAlive).length > 0) return false;
  return journalStale(lockDir, undefined, isAlive).every((j) => !j.unreadable && j.differing.length === 0);
}
{
  const root = mkdtempSync(join(tmpdir(), "mg-pre-root-"));
  const dir = mkdtempSync(join(tmpdir(), "mg-pre-dir-"));
  try {
    writeFileSync(join(root, "g.ts"), "orig");
    const dead = () => false; const alive = () => true;
    const H = Buffer.from("head bytes");
    check("e2e precondition: clean target, nothing live, nothing stale → may run", e2ePrecondition({ lockDir: dir, headBytes: H, workBytes: H, isAlive: dead }) === true);
    check("e2e precondition: a target that differs from HEAD → refuses (never records mutated bytes as the original)", e2ePrecondition({ lockDir: dir, headBytes: H, workBytes: Buffer.from("a live sweep's mutant"), isAlive: dead }) === false);
    journalWrite(dir, 4242, []);
    check("e2e precondition: a LIVE sweep or gate (its lock marker) → refuses", e2ePrecondition({ lockDir: dir, headBytes: H, workBytes: H, isAlive: alive }) === false);
    journalClear(dir, 4242);
    journalWrite(dir, 4243, [{ file: "../x", original: "y" }]);
    check("e2e precondition: an unrecovered / unreadable dead-sweep journal → refuses", e2ePrecondition({ lockDir: dir, headBytes: H, workBytes: H, isAlive: dead }) === false);
    const O = Buffer.from("orig"); const M = Buffer.from("mutant");
    check("a REFUSED gate never writes the target back (it may hold a live sweep's mutant); one that took the lock restores only a real difference",
      shouldRestoreTarget(false, M, O) === false && shouldRestoreTarget(true, M, O) === true && shouldRestoreTarget(true, O, O) === false);
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

// KNOWN CEILINGS of this block (also in docs/BUILD_BACKLOG.md): the lock is per TMPDIR (a gate and a sweep under
// different TMPDIRs share none — the HEAD-bytes precondition is their only protection); a commit that touches the
// target while the gate runs leaves the working file differing from the NEW HEAD (the gate restores the bytes HEAD
// had at its start; it goes red and the content is in git); a SIGKILL of the gate leaves its marker journal, which the
// next start refuses over and `--restore-stale` applies; originals are restored as UTF-8 text (all registered files
// round-trip; invalid UTF-8 would not) and a CRLF registered file yields 0 mutations (pre-existing).
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
// Every catchable signal that terminates a process by default must run the gate's shutdown — an unhandled one (SIGQUIT,
// SIGUSR2, SIGALRM …) killed the gate with its sweep still mutating the real tree. SIGKILL and SIGSTOP cannot be caught.
const TERMINATING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGUSR2", "SIGALRM", "SIGVTALRM", "SIGPROF", "SIGXCPU", "SIGXFSZ", "SIGPWR"];
async function runE2e({ repo, guard, target, check, signalProc = process, streams = [process.stdout, process.stderr], afterLock = null }) {
  const PROOF = "proof:carrier-reachability";
  // "The original" is what HEAD says, as BYTES — never what the working tree holds at this instant (that
  // could be a live sweep's mutant). The precondition then requires the working file to equal it.
  const headBytes = (() => { const r = spawnSync("git", ["show", `HEAD:${relative(repo, target)}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 && Buffer.isBuffer(r.stdout) ? r.stdout : null; })();
  const original = headBytes === null ? null : headBytes.toString("utf8");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scratch = mkdtempSync(join(resolve(tmpdir()), "mg-e2e-")); // absolute: a relative TMPDIR would resolve per child cwd
  const env = { ...process.env, TMPDIR: scratch };
  const jdir = journalDir(repo, scratch);
  // This block mutates the REAL tree, so it takes the same lock a real sweep takes — in the SHARED journal
  // dir, where a real sweep (or another gate run) would see it — and refuses, touching nothing, unless
  // the target is byte-identical to HEAD, no sweep or gate is live, and no dead sweep left a journal
  // (the target may already be mutated: its current bytes must never be recorded as "the original").
  const lockDir = (() => { try { return journalDir(repo); } catch { return null; } })();
  let lockHeld = false;
  let preconditionOk = false;
  let installed = 0;
  const kids = new Set();
  const live = [];
  const restoreTarget = () => { if (shouldRestoreTarget(lockHeld, readFileSync(target), headBytes)) writeFileSync(target, headBytes); };
  const clearLock = () => { if (lockHeld) journalClear(lockDir, process.pid); };
  const handlers = [];
  const streamHandlers = [];
  try {
    preconditionOk = e2ePrecondition({ lockDir, headBytes, workBytes: readFileSync(target), isRegular: lstatSync(target).isFile() });
    if (preconditionOk) {
      // The lock marker also JOURNALS the target with HEAD's bytes, so even a SIGKILL of the gate leaves a record
      // `--restore-stale` can act on (the sweeps' own journals live in this gate's scratch dir, which nothing else reads).
      journalWrite(lockDir, process.pid, [{ file: relative(repo, target), original: headBytes.toString("utf8") }]);
      lockHeld = true;
      const shutdownWith = (code) => gateShutdown({
        killSweeps: killKids,
        restoreTarget, clearLock, cleanup: () => rmSync(scratch, { recursive: true, force: true }), exit: (c) => signalProc.exit(c),
      }, code);
      for (const sig of TERMINATING_SIGNALS) {
        const num = osConstants.signals[sig];
        if (num === undefined) continue; // not a signal on this platform
        const h = () => shutdownWith(128 + num);
        try { signalProc.on(sig, h); handlers.push([sig, h]); } catch { /* not catchable here */ }
      }
      // An uncaught exception / unhandled rejection must not leave the sweeps running either.
      for (const ev of ["uncaughtException", "unhandledRejection"]) {
        const h = (err) => { console.error(`  gate crashed (${ev}): ${err instanceof Error ? err.message : String(err)}`); shutdownWith(1); };
        signalProc.on(ev, h); handlers.push([ev, h]);
      }
      // A closed stdout/stderr (the gate's parent died, or `| head`) raises EPIPE: ignore it, so the gate runs on to its
      // own restore instead of crashing with its sweep orphaned. Anything else is re-thrown (→ uncaughtException above).
      for (const st of streams) {
        const h = (e) => { if (e?.code !== "EPIPE") throw e; };
        st.on("error", h); streamHandlers.push([st, h]);
      }
      installed = signalProc.listenerCount("SIGTERM");
    }
  } catch { preconditionOk = false; }
  const startSweep = (args = []) => {
    const child = spawn("node", [guard, `--proof=${PROOF}`, ...args], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    track(child);
    const exited = new Promise((r) => child.on("close", (code, signal) => r({ code, signal, out })));
    return { child, exited, output: () => out };
  };
  const waitFor = async (fn, limitMs) => { for (let t = 0; t < limitMs; t += 50) { if (fn()) return true; await sleep(50); } return false; };
  const dirty = () => readFileSync(target, "utf8") !== original;
  const track = (child) => { kids.add(child); child.on("close", () => kids.delete(child)); return child; };
  const startProbe = () => {
    // With the gate holding its lock, a sweep started in the SAME TMPDIR must be refused. Without the marker it
    // would run in the real tree: it is started (and TRACKED, so a signal to the gate kills it too), given a bounded
    // time to refuse, and SIGTERMed if it does not.
    const child = track(spawn("node", [guard, `--proof=${PROOF}`], { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] }));
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const done = new Promise((r) => {
      const t = setTimeout(() => { child.kill("SIGTERM"); }, 20000);
      child.on("close", (code) => { clearTimeout(t); r({ code, out }); });
    });
    return { child, done };
  };
  const probe = () => startProbe().done;
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
  // Kill every sweep this gate started (and their recorded descendants), then WAIT (bounded) until they are dead —
  // the target is restored right after, and a sweep still mid-write could otherwise land a mutant after the restore.
  function killKids() {
    const pids = [];
    for (const c of kids) { for (const r of record(descendants(c.pid))) live.push(r); pids.push(c.pid); try { c.kill("SIGKILL"); } catch { /* gone */ } }
    for (const r of live) killRecorded(r, true);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !pids.every(isDead)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  const isDead = (pid) => {
    // /proc where it exists (a zombie counts as dead); kill(0) elsewhere. ENOENT under /proc means dead ONLY if /proc exists.
    if (existsSync("/proc/self")) { try { return /^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; } }
    try { process.kill(pid, 0); return false; } catch { return true; }
  };
  try {
    if (afterLock) {
      // test hook: instead of the sweeps, run `afterLock` WHILE the lock and handlers are held (throwaway-repo tests only)
      if (preconditionOk) await afterLock({ lockDir, startProbe, track });
    } else if (!preconditionOk) {
      check("end-to-end signal test: precondition (target identical to HEAD; no live sweep or gate; no unrecovered journal) — refused to run and touched nothing", false);
    } else {
      // 1. SIGTERM mid-mutation, with a second sweep refused meanwhile
      const held = await probe();
      check("e2e: while the GATE holds its lock, a real sweep in the same temp dir is REFUSED (exit 1, 'another mutation sweep is running')",
        held.code === 1 && /another mutation sweep is running/.test(held.out));
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
  } catch (err) {
    // An unexpected error (a registered file deleted mid-gate, say) is a NAMED failure, never a crash without a summary.
    check(`e2e: unexpected error — ${err instanceof Error ? err.message : String(err)}`, false);
  } finally {
    // Cleanup never throws past the summary line, and never writes unless this gate took the lock.
    try { killKids(); } catch { /* gone */ }
    try { restoreTarget(); } catch { /* reported by the checks */ }
    for (const r of live) { try { if (!isDead(r.pid)) killRecorded(r, false); } catch { /* gone */ } }
    try { clearLock(); } catch (err) { console.error(`  note: could not remove the gate's lock marker (${err instanceof Error ? err.message : String(err)}); it is a dead-pid journal and the next sweep start clears it`); }
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* scratch only */ }
    // Keep the handlers until the event loop has turned twice: a signal that arrived during the synchronous tail is
    // only DISPATCHED on the next turn, and with the listener already gone it was silently dropped (exit 0, "pass").
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    for (const [sig, h] of handlers) signalProc.removeListener(sig, h);
    for (const [st, h] of streamHandlers) st.removeListener("error", h);
  }
  return { preconditionOk, installed };
}
{
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, "..");
  await runE2e({ repo, guard: join(here, "mutation-guard.mjs"), target: join(repo, "lib/integrations/src/integrations/carrier/evaluate.ts"), check });
}

// ── The e2e call sites, exercised in a THROWAWAY git repo (no sweep is run: the block stops after taking the lock) ──
// These pin what the helper tests cannot: where `original` comes from, who may write the target back, that the
// gate is signal-safe, and that a non-regular file is refused.
{
  const sh = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const mkRepo = () => {
    const r = mkdtempSync(join(tmpdir(), "mg-throwaway-"));
    sh(r, "init", "-q"); sh(r, "config", "user.email", "t@example.invalid"); sh(r, "config", "user.name", "t");
    mkdirSync(join(r, "lib")); writeFileSync(join(r, "lib/t.ts"), "HEAD bytes\n"); sh(r, "add", "-A"); sh(r, "commit", "-q", "-m", "c");
    return r;
  };
  const results = [];
  const quiet = () => {};
  const repos = [];
  try {
    // (a) a target with an uncommitted edit: refused, byte-identical afterwards, no handlers installed
    const dirty = mkRepo(); repos.push(dirty);
    writeFileSync(join(dirty, "lib/t.ts"), "DEV EDIT, uncommitted\n");
    const fakeA = Object.assign(new EventEmitter(), { exit() {} });
    const ra = await runE2e({ repo: dirty, guard: "/nonexistent", target: join(dirty, "lib/t.ts"), check: quiet, signalProc: fakeA, afterLock: async () => {} });
    results.push(["e2e call site: a target with an uncommitted edit is REFUSED, and the edit survives byte-for-byte (original comes from HEAD, the refused path never writes)",
      ra.preconditionOk === false && readFileSync(join(dirty, "lib/t.ts"), "utf8") === "DEV EDIT, uncommitted\n" && fakeA.listenerCount("SIGTERM") === 0]);
    // (b) a symlink to byte-identical content: refused
    const link = mkRepo(); repos.push(link);
    writeFileSync(join(link, "same.bin"), "HEAD bytes\n");
    rmSync(join(link, "lib/t.ts")); symlinkSync(join(link, "same.bin"), join(link, "lib/t.ts"));
    const rb = await runE2e({ repo: link, guard: "/nonexistent", target: join(link, "lib/t.ts"), check: quiet, signalProc: new EventEmitter(), afterLock: async () => {} });
    results.push(["e2e call site: a target replaced by a symlink to identical bytes is REFUSED (not a regular file)", rb.preconditionOk === false]);
    // (c) clean target: the lock marker journals HEAD's bytes; a mutant + SIGTERM while locked is restored from HEAD, exit 143, lock dropped
    const clean = mkRepo(); repos.push(clean);
    const tgt = join(clean, "lib/t.ts");
    let exitedWith = null; let markerJournalsHead = false; let restoredAfterSignal = false; let lockGone = false;
    const fakeC = Object.assign(new EventEmitter(), { exit(c) { exitedWith = c; } });
    const rc = await runE2e({ repo: clean, guard: "/nonexistent", target: tgt, check: quiet, signalProc: fakeC, afterLock: async ({ lockDir }) => {
      const marker = JSON.parse(readFileSync(join(lockDir, `${process.pid}.json`), "utf8"));
      markerJournalsHead = marker.entries.length === 1 && marker.entries[0].original === "HEAD bytes\n" && marker.entries[0].file === "lib/t.ts";
      writeFileSync(tgt, "MUTANT\n");               // a sweep's mutation, left on disk
      fakeC.emit("SIGTERM");                          // the gate is signalled in the window
      restoredAfterSignal = readFileSync(tgt, "utf8") === "HEAD bytes\n";
      lockGone = !existsSync(join(lockDir, `${process.pid}.json`));
    } });
    results.push(["e2e call site: the gate's lock marker JOURNALS the target with HEAD's bytes (a SIGKILLed gate leaves a record --restore-stale can use)", markerJournalsHead]);
    results.push(["e2e call site: SIGTERM to the gate while it holds a mutant restores the target from HEAD, drops the lock and exits 143", rc.preconditionOk === true && restoredAfterSignal && lockGone && exitedWith === 143]);
    results.push(["e2e call site: SIGINT/SIGTERM/SIGHUP handlers are installed once the lock is held, and removed afterwards (no leak)", rc.installed >= 1 && fakeC.listenerCount("SIGTERM") === 0]);
    // (d) the gate's PROBE sweep is tracked: a SIGTERM to the gate while the probe runs kills it, and waits for it to be dead
    const probeRepo = mkRepo(); repos.push(probeRepo);
    const stub = join(probeRepo, "stub-guard.mjs");
    writeFileSync(stub, "setTimeout(() => {}, 60000);\n");
    const isDeadPid = (pid) => { try { if (/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) return true; } catch { return true; } try { process.kill(pid, 0); return false; } catch { return true; } };
    let probePid = null; let probeDeadAtReturn = false; let exitedD = null;
    const fakeD = Object.assign(new EventEmitter(), { exit(c) { exitedD = c; } });
    await runE2e({ repo: probeRepo, guard: stub, target: join(probeRepo, "lib/t.ts"), check: quiet, signalProc: fakeD, afterLock: async ({ startProbe }) => {
      const { child } = startProbe(); probePid = child.pid;
      await new Promise((r) => setTimeout(r, 400));
      fakeD.emit("SIGTERM");
      probeDeadAtReturn = isDeadPid(probePid);
    } });
    results.push(["e2e call site: a SIGTERM to the gate while its PROBE sweep runs kills the probe (it is tracked) and waits for it to be dead before the restore", probePid !== null && probeDeadAtReturn && exitedD === 143]);
    // (e) an unexpected error inside the block: a NAMED failure (no crash), tracked sweeps killed, the target restored from HEAD
    const errRepo = mkRepo(); repos.push(errRepo);
    const seen = []; let sleeperPid = null;
    await runE2e({ repo: errRepo, guard: "/nonexistent", target: join(errRepo, "lib/t.ts"), check: (n, ok) => seen.push([n, ok]), signalProc: new EventEmitter(), afterLock: async ({ track }) => {
      writeFileSync(join(errRepo, "lib/t.ts"), "MUTANT\n");
      const sl = track(spawn("node", ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })); sleeperPid = sl.pid;
      await new Promise((r) => setTimeout(r, 300));
      throw new Error("registered file vanished");
    } });
    await new Promise((r) => setTimeout(r, 100));
    results.push(["e2e call site: an unexpected error is a NAMED failed check (not a crash without a summary), kills the gate's sweeps, and restores the target from HEAD",
      seen.some(([n, ok]) => /unexpected error — registered file vanished/.test(n) && ok === false) && sleeperPid !== null && isDeadPid(sleeperPid) && readFileSync(join(errRepo, "lib/t.ts"), "utf8") === "HEAD bytes\n"]);
    // (f) every other catchable terminating signal runs the same shutdown (SIGQUIT/SIGUSR2/SIGALRM used to kill the gate with its sweep orphaned)
    for (const sig of ["SIGQUIT", "SIGUSR2", "SIGALRM"]) {
      const sigRepo = mkRepo(); repos.push(sigRepo);
      let exitedS = null; const fakeS = Object.assign(new EventEmitter(), { exit(c) { exitedS = c; } });
      let restoredS = false;
      await runE2e({ repo: sigRepo, guard: "/nonexistent", target: join(sigRepo, "lib/t.ts"), check: quiet, signalProc: fakeS, afterLock: async () => {
        writeFileSync(join(sigRepo, "lib/t.ts"), "MUTANT\n"); fakeS.emit(sig); restoredS = readFileSync(join(sigRepo, "lib/t.ts"), "utf8") === "HEAD bytes\n";
      } });
      results.push([`e2e call site: ${sig} to the gate while it holds a mutant restores the target from HEAD and exits ${128 + osConstants.signals[sig]} (an unhandled signal used to orphan the sweep)`, restoredS && exitedS === 128 + osConstants.signals[sig]]);
    }
    // (g) an uncaught exception runs the shutdown too
    const exRepo = mkRepo(); repos.push(exRepo);
    let exitedX = null; let restoredX = false; const fakeX = Object.assign(new EventEmitter(), { exit(c) { exitedX = c; } });
    const origErrX = console.error; console.error = () => {};
    try {
      await runE2e({ repo: exRepo, guard: "/nonexistent", target: join(exRepo, "lib/t.ts"), check: quiet, signalProc: fakeX, afterLock: async () => {
        writeFileSync(join(exRepo, "lib/t.ts"), "MUTANT\n"); fakeX.emit("uncaughtException", new Error("boom")); restoredX = readFileSync(join(exRepo, "lib/t.ts"), "utf8") === "HEAD bytes\n";
      } });
    } finally { console.error = origErrX; }
    results.push(["e2e call site: an uncaught exception while the gate holds a mutant restores the target from HEAD and exits 1", restoredX && exitedX === 1]);
    // (h) a closed stdout (EPIPE) is swallowed — the gate runs on to its own restore instead of crashing with its sweep orphaned
    const pipeRepo = mkRepo(); repos.push(pipeRepo);
    const fakeOut = new EventEmitter(); const seenP = []; let threw = false;
    await runE2e({ repo: pipeRepo, guard: "/nonexistent", target: join(pipeRepo, "lib/t.ts"), check: (n, ok) => seenP.push([n, ok]), signalProc: new EventEmitter(), streams: [fakeOut], afterLock: async () => {
      try { fakeOut.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })); } catch { threw = true; }
    } });
    results.push(["e2e call site: EPIPE on the gate's stdout is swallowed (no crash, the gate runs on and restores)", threw === false && !seenP.some(([, ok]) => ok === false) && fakeOut.listenerCount("error") === 0]);
    // (i) killKids reaches the sweeps' DESCENDANTS, not just the sweeps
    const dRepo = mkRepo(); repos.push(dRepo);
    let parentPid = null; let grandPid = null; let bothDead = false;
    const fakeD2 = Object.assign(new EventEmitter(), { exit() {} });
    await runE2e({ repo: dRepo, guard: "/nonexistent", target: join(dRepo, "lib/t.ts"), check: quiet, signalProc: fakeD2, afterLock: async ({ track }) => {
      const parent = track(spawn("node", ["-e", "const c = require('node:child_process').spawn('node', ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); process.stdout.write(String(c.pid)); setTimeout(() => {}, 60000);"], { stdio: ["ignore", "pipe", "ignore"] }));
      parentPid = parent.pid;
      grandPid = await new Promise((r) => { let b = ""; parent.stdout.on("data", (d) => { b += d; const n = Number.parseInt(b, 10); if (Number.isFinite(n)) r(n); }); });
      fakeD2.emit("SIGTERM");
      bothDead = isDeadPid(parentPid) && isDeadPid(grandPid);
    } });
    results.push(["e2e call site: a signal to the gate kills a sweep's DESCENDANTS as well as the sweep (recorded descendants are killed, and waited for)", parentPid !== null && grandPid !== null && bothDead]);
  } finally {
    for (const r of repos) { try { rmSync(journalDir(r), { recursive: true, force: true }); } catch { /* none */ } try { rmSync(r, { recursive: true, force: true }); } catch { /* scratch */ } }
  }
  for (const [name, ok] of results) check(name, ok);
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
try {
  const weight = (t) => t.files.reduce((n, f) => n + mutationsFor(f).length, 0);
  const loads = Array.from({ length: N }, (_, i) => shardTargets(TARGETS, i, N).reduce((sum, t) => sum + weight(t), 0));
  const totalMutations = TARGETS.reduce((n, t) => n + weight(t), 0);
  // Report the quantity the sharder actually balances on. An earlier version of this
  // line reported FILES per shard while `shardTargets` balanced MUTATIONS — a real
  // number answering a different question than the one the reader would take it for.
  console.log(`\n  balance at N=${N}, by MUTATIONS per shard: ${loads.join(" · ")}`);
  console.log(`  ${TARGETS.length} targets · ${TARGETS.reduce((n, t) => n + t.files.length, 0)} files · ${totalMutations} mutations`);
} catch (err) {
  // Reported, not gated — and never a crash without a summary line (a registered file deleted or unreadable).
  console.log(`\n  balance report unavailable: ${err instanceof Error ? err.message : String(err)}`);
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
