// run-gate-mutants.mjs — reproduce a gate's mutant tally.
//
//   node scripts/run-gate-mutants.mjs <gate>        e.g. check-verdict-tone-source | check-ungated-fetch
//
// WHY. "N of M mutants turn the self-test red" is a claim about a run, and a claim a reviewer cannot repeat is a
// number typed into a body. The mutants live in scripts/lib/gate-mutants/<gate>.json as {name, find, replace}: each
// is applied ALONE to a copy of the gate (find must occur exactly once, so a refactor that moves the anchor fails
// loudly instead of silently testing nothing) and the copy's --self-test is run.
//
// A VERDICT IS READ FROM THE SELF-TEST'S OWN TALLY, NEVER FROM ITS ABSENCE. The child's stdout goes to a FILE (a pipe
// can be cut off when the child exits with output still buffered), and the last line must be
// `self-test passed (N/N)` or `self-test FAILED (N/M)`:
//   red     exit 1 and a FAILED tally with N < M — the self-test saw the mutant and said so;
//   LIVE    exit 0 and a passed tally — the mutant survived;
//   BROKEN  anything else (a crash, a syntax error, no tally): the mutant is invalid, and a mutant that is killed only
//           by crashing proves nothing about the self-test. It fails the run exactly like a survivor.
// The run also refuses a dirty tree (a tally over uncommitted edits cannot be reproduced from a SHA), prints HEAD, and
// removes its scratch copy on exit, SIGINT, SIGTERM and SIGHUP. The gate itself is never modified.

import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const gate = process.argv[2];
if (!gate || !/^[a-z0-9-]+$/.test(gate)) {
  console.error("usage: node scripts/run-gate-mutants.mjs <gate-name>");
  process.exit(2);
}
const copy = resolve(here, `.mutant-${gate}.mjs`);
const outDir = mkdtempSync(join(tmpdir(), "gate-mutants-"));
const cleanup = () => { rmSync(copy, { force: true }); rmSync(outDir, { recursive: true, force: true }); };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); process.exit(130); });

let dirty;
try {
  dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim();
  console.log(`HEAD ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim()}`);
} catch (e) {
  console.error(`✗ cannot read the git state (${e.message}) — a tally has to be tied to a commit.`);
  process.exit(2);
}
if (dirty) {
  console.error(`✗ the working tree is not clean — commit or stash first, so this tally can be reproduced from the SHA above:\n${dirty.split("\n").slice(0, 8).join("\n")}`);
  process.exit(2);
}

let mutants;
let original;
try {
  mutants = JSON.parse(readFileSync(join(here, "lib", "gate-mutants", `${gate}.json`), "utf8"));
  original = readFileSync(join(here, `${gate}.mjs`), "utf8");
} catch (e) {
  console.error(`✗ cannot read the gate or its mutant list: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(mutants) || mutants.length === 0) {
  console.error("✗ the mutant list is empty — a tally over nothing proves nothing.");
  process.exit(2);
}

/** Run a copy's self-test with stdout/stderr in a file; resolve { status, tally } where tally is the parsed last line or null. */
function selfTest(file, tag) {
  return new Promise((resolveRun) => {
    const outFile = join(outDir, `${tag}.out`);
    const fd = openSync(outFile, "w");
    const child = spawn(process.execPath, [file, "--self-test"], { stdio: ["ignore", fd, fd] });
    child.on("close", (status) => {
      closeSync(fd);
      const last = readFileSync(outFile, "utf8").trim().split("\n").filter((l) => l.trim()).at(-1) ?? "";
      const m = /^self-test (passed|FAILED) \((\d+)\/(\d+)\)$/.exec(last);
      resolveRun({ status, line: last, tally: m ? { ok: m[1] === "passed", n: Number(m[2]), total: Number(m[3]) } : null });
    });
  });
}

const base = await selfTest(join(here, `${gate}.mjs`), "baseline");
if (base.status !== 0 || !base.tally?.ok || base.tally.n !== base.tally.total) {
  console.error(`✗ the unmutated gate's self-test is not green (${base.line || `exit ${base.status}`}) — refusing to tally mutants against a red baseline.`);
  process.exit(1);
}
console.log(`baseline: ${base.line}`);

let red = 0;
const live = [], broken = [], anchors = [];
for (const [i, m] of mutants.entries()) {
  const count = original.split(m.find).length - 1;
  if (count !== 1) { anchors.push(`${m.name} (anchor occurs ${count} times)`); console.log(`ANCHOR ${m.name} (${count})`); continue; }
  writeFileSync(copy, original.replace(m.find, () => m.replace));
  const r = await selfTest(copy, `m${i}`);
  if (r.status === 0 && r.tally?.ok) { live.push(m.name); console.log(`LIVE   ${m.name} — ${r.line}`); }
  else if (r.status === 1 && r.tally && !r.tally.ok && r.tally.n < r.tally.total) { red++; console.log(`red    ${m.name} — ${r.line}`); }
  else { broken.push(m.name); console.log(`BROKEN ${m.name} — ${r.line || `exit ${r.status}, no tally`}`); }
}
const fails = [...live.map((n) => `LIVE: ${n}`), ...broken.map((n) => `BROKEN: ${n}`), ...anchors.map((n) => `ANCHOR: ${n}`)];
console.log(`\n${gate}: ${red} of ${mutants.length} mutants red${fails.length ? `; ${fails.join("; ")}` : ""}`);
process.exit(fails.length === 0 && red === mutants.length ? 0 : 1);
