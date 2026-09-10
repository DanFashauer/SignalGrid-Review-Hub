// Brain-cycle orchestrator spine — the deterministic decision+report step (DR-032, Slice 1).
//
//   node scripts/brain-cycle.mjs --board <dir>        # decide over an audit board, write decision.json
//   node scripts/brain-cycle.mjs --board <dir> --skip-freshness   # (testing only) skip STEP 0
//   node scripts/brain-cycle.mjs --self-test          # board I/O + decide integration, fixture board
//
// WHAT THIS IS (and is NOT). This is the DETERMINISTIC heart the daily self-session calls,
// and ONLY that. It runs STEP 0 (brain freshness), loads the blackboard the swarm wrote
// (one <lens>.<lane>.json per lens + a _manifest.json naming the EXPECTED lenses),
// deterministically decides via scripts/brain-cycle-decide.mjs, and writes decision.json.
//
// It does NOT dispatch the lens agents (only a Claude session can spawn LLM lenses — a
// node script cannot) and it does NOT open the PR (only the session has gh + the writer
// agent). Slice 2 wires the session's live dispatch and the gauntlet-then-auto-open around
// this spine. Scoping the LLM + PR steps to the session, and the decision to pure code, is
// the fail-closed doctrine (golden rule 2): the brain PICKS with code, it does not judge
// with a model.
//
// EXIT CODES: 0 = a winner was written to decision.json and NOTHING else is pending;
// 10 = quiet (open nothing); 20 = HARD NO (a lens did not run / bad manifest / stale surface);
// 30 = escalate, no winner (owner-gated/fileless/tie); 40 = a winner was written AND a SEPARATE
// route needs escalation (read decision.json for both — never infer "clean winner" from the code);
// 1 = error (stale brain, unreadable board, bad manifest, or decision.json could not be persisted).
// Non-zero-but-expected (10/20/30/40) let the caller branch without treating "quiet" as a crash.
// The exit code is a SUMMARY; decision.json is authoritative — a caller that acts must read it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decide } from "./brain-cycle-decide.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(repoRoot, "docs", "agent", "brain-cycle-config.json");

function loadConfig() {
  try {
    const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { vetoLenses: c.vetoLenses, minConfidence: c.minConfidence };
  } catch {
    return {}; // decide() falls back to its own DEFAULT_CONFIG (fail-closed defaults)
  }
}

// Read a board directory: every <lens>.<lane>.json is a lens record; _manifest.json names
// the expected lenses. A malformed lens file is treated as ran:false (fail-closed — an
// unreadable audit is a NO, never a silent pass). A MISSING, unparsable, or empty _manifest.json
// is a HARD fail (throw): with no trustworthy expected-lens set the whole board is untrustworthy,
// and defaulting `expected` to [] would silently disarm decide()'s "a reviewer that did not
// run = NO" anchor (an empty expected set requires no reviewer at all). The throw propagates to
// run()'s catch and exits 1. decide() ALSO fails closed on an empty expected set — belt and braces.
export function readBoard(dir) {
  if (!existsSync(dir)) throw new Error(`board directory not found: ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const manifestPath = join(dir, "_manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`board has no _manifest.json (cannot know which lenses were expected): ${dir}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { throw new Error(`_manifest.json is unparsable (fail-closed): ${e.message}`); }
  const expected = Array.isArray(manifest.expected) ? manifest.expected : [];
  if (expected.length === 0) throw new Error("_manifest.json names no expected lenses (a board that requires no reviewer is a NO)");
  const lenses = [];
  for (const f of files) {
    if (f === "_manifest.json" || f === "decision.json") continue;
    try {
      lenses.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      // a lens file that will not parse is an audit that did not really post
      lenses.push({ lens: f.replace(/\.json$/, ""), ran: false, verdict: "UNVERIFIED", findings: [] });
    }
  }
  return { lenses, expected };
}

function freshnessOk() {
  try {
    execFileSync("node", [join(repoRoot, "scripts", "check-brain-freshness.mjs")], { cwd: repoRoot, stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).map((b) => b.toString()).join("\n").trim();
    return { ok: false, detail: out };
  }
}

function outcomeExit(decision) {
  if (decision.hardNo) return 20;
  if (decision.winner && decision.escalate) return 40; // winner AND a separate escalation — read decision.json
  if (decision.winner) return 0;
  if (decision.escalate) return 30;
  return 10; // quiet
}

function run(argv) {
  const boardArg = argv[argv.indexOf("--board") + 1];
  if (!argv.includes("--board") || !boardArg) {
    console.error("brain-cycle: --board <dir> is required (the audit blackboard the session's lenses wrote).");
    process.exit(1);
  }
  // STEP 0 — a brain behind mainline audits the wrong code. Refuse, fail-closed.
  if (!argv.includes("--skip-freshness")) {
    const fresh = freshnessOk();
    if (!fresh.ok) {
      console.error("brain-cycle: STEP 0 FAILED — stale/unverifiable brain, did not audit:\n" + fresh.detail);
      process.exit(1);
    }
  }
  const board = resolve(repoRoot, boardArg);
  let loaded;
  try { loaded = readBoard(board); } catch (e) { console.error("brain-cycle: " + e.message); process.exit(1); }

  const decision = decide({ lenses: loaded.lenses, expected: loaded.expected, config: loadConfig() });
  const decisionOut = {
    decidedFor: board,
    winner: decision.winner ? decision.winner.key : null,
    winnerFiles: decision.winner ? decision.winner.files : [],
    hardNo: decision.hardNo,
    escalate: decision.escalate,
    reason: decision.reason,
    ranked: decision.ranked.map((r) => ({ key: r.key, files: r.files, lenses: r.byLens })),
  };
  // Persist the decision. A write failure is FATAL: exit 0 means "a winner was written to
  // decision.json", so a decided-but-unpersisted run must not report success (disk full,
  // read-only mount). Report the failure and exit 1 rather than swallowing it.
  try {
    writeFileSync(join(board, "decision.json"), JSON.stringify(decisionOut, null, 2) + "\n");
  } catch (e) {
    console.error(`brain-cycle: decided (${decision.reason}) but could NOT persist decision.json: ${e.message}`);
    process.exit(1);
  }
  console.log(`brain-cycle decision: ${decision.reason}`);
  process.exit(outcomeExit(decision));
}

function selfTest() {
  // Build a fixture board in a temp dir and prove readBoard + decide integrate and that
  // decision.json is written. Uses --skip-freshness semantics by calling the pieces directly.
  const os = { tmp: process.env.TMPDIR || "/tmp" };
  const dir = join(os.tmp, `brain-cycle-selftest-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const write = (name, obj) => writeFileSync(join(dir, name), JSON.stringify(obj));

  let fail = 0;
  const check = (n, c) => { if (!c) { console.error("SELF-TEST FAIL:", n); fail = 1; } };

  // Fixture: two lenses confirm an autonomous route; expected set names BOTH veto lenses and
  // all of them ran (the expected set must include security-reviewer + fail-closed-auditor).
  write("_manifest.json", { expected: ["code-reviewer", "signalgrid-reviewer", "security-reviewer", "fail-closed-auditor"] });
  const conf = (file) => ({ file, category: "correctness", verdict: "CONFIRMED", confidence: 0.9, proposedRoute: "fix-fossil" });
  write("code-reviewer.cloud.json", { lens: "code-reviewer", ran: true, verdict: "WARNING", findings: [conf("docs/GLOSSARY.md")] });
  write("signalgrid-reviewer.cloud.json", { lens: "signalgrid-reviewer", ran: true, verdict: "WARNING", findings: [conf("docs/GLOSSARY.md")] });
  write("security-reviewer.cloud.json", { lens: "security-reviewer", ran: true, verdict: "APPROVE", findings: [] });
  write("fail-closed-auditor.cloud.json", { lens: "fail-closed-auditor", ran: true, verdict: "APPROVE", findings: [] });

  const b1 = readBoard(dir);
  check("readBoard finds 4 lenses + expected set", b1.lenses.length === 4 && b1.expected.length === 4);
  const d1 = decide({ lenses: b1.lenses, expected: b1.expected, config: loadConfig() });
  check("fixture board picks the autonomous winner", d1.winner && d1.winner.key === "fix-fossil");

  // A malformed lens file is read as ran:false → HARD NO.
  writeFileSync(join(dir, "code-reviewer.cloud.json"), "{ this is not json");
  const b2 = readBoard(dir);
  const malformed = b2.lenses.find((l) => l.lens === "code-reviewer.cloud" || l.lens === "code-reviewer");
  check("a malformed lens file reads as ran:false", malformed && malformed.ran === false);
  const d2 = decide({ lenses: b2.lenses, expected: b2.expected, config: loadConfig() });
  // expected names code-reviewer; the malformed file is keyed code-reviewer.cloud, so
  // code-reviewer is now absent from the board → HARD NO. Either way it must not pick a winner.
  check("a board with a broken expected lens opens nothing", d2.winner === null);

  // A MISSING _manifest.json is a fail-closed throw (not a silent expected=[] that disarms the anchor).
  writeFileSync(join(dir, "code-reviewer.cloud.json"), JSON.stringify({ lens: "code-reviewer", ran: true, verdict: "WARNING", findings: [conf("docs/GLOSSARY.md")] }));
  rmSync(join(dir, "_manifest.json"), { force: true });
  let threwMissing = false;
  try { readBoard(dir); } catch { threwMissing = true; }
  check("readBoard throws on a missing _manifest.json", threwMissing);

  // An EMPTY expected set (manifest present but names nothing) is also a fail-closed throw.
  write("_manifest.json", { expected: [] });
  let threwEmpty = false;
  try { readBoard(dir); } catch { threwEmpty = true; }
  check("readBoard throws on an empty expected set", threwEmpty);

  // An UNPARSABLE _manifest.json is a fail-closed throw.
  writeFileSync(join(dir, "_manifest.json"), "{ not json");
  let threwBad = false;
  try { readBoard(dir); } catch { threwBad = true; }
  check("readBoard throws on an unparsable _manifest.json", threwBad);

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (fail) return 1;
  console.log("brain-cycle spine self-test: readBoard + decide integrate, malformed=ran:false, broken-expected=no-winner, missing/empty/unparsable-manifest=throw — green");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  run(process.argv.slice(2));
}
