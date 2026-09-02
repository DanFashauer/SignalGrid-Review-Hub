// Simulation-request loop proof — the cloud can ask, only the Mac can answer,
// and an unrun simulation can never read as a passing one.
//
// The loop this guards exists because the cloud lane and the Mac lane cannot
// reach each other: CI has no Mac, and the Mac is not always awake. Before it,
// "did the harness run on real hardware?" was answered by memory. Memory reports
// the same thing whether the run happened or not, which is the unearned
// affirmative this repository keeps finding in code — here it was in the
// process.
//
// Three properties are pinned, each against the failure it prevents:
//   1. A request may name only allowlisted OPERATION KEYS, and the runner maps
//      keys to argv itself — so a request cannot carry a command. This is the
//      security property: request files are authored by one lane and executed on
//      another lane's machine, with that machine's filesystem and credentials.
//   2. An operation this machine cannot honestly run is REFUSED and recorded as
//      refused, never substituted with a weaker run reported under the stronger
//      name. Verified live: this proof runs on Linux, where every macOS-only
//      operation must refuse.
//   3. An asked-for run with no result row is PENDING and reported — never
//      counted green, and never silently dropped.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs modules, no types by design (same as the other gates)
import { SIM_OPERATIONS, OPERATION_KEYS, RUN_STATUSES, GREEN_STATUSES } from "../lib/sim-operations.mjs";
// @ts-expect-error — see above
import { auditSimRequests } from "../check-sim-requests.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REQ_DIR = join(repo, "artifacts/sim-requests");
const RES_DIR = join(repo, "artifacts/sim-results");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Simulation-request loop proof");

// ── 1. the allowlist is a closed, executable-by-construction set ─────────────
const ops = SIM_OPERATIONS as Record<string, { argv: string[]; platform: string; what: string; needs?: string }>;
check(
  "every operation declares argv, a platform and what it does",
  OPERATION_KEYS.every((k: string) => {
    const o = ops[k];
    return Array.isArray(o.argv) && o.argv.length > 0 &&
      (o.platform === "any" || o.platform === "macos") &&
      typeof o.what === "string" && o.what.length > 10;
  }),
);
check(
  "no operation smuggles a shell — argv[0] is a real program, no metacharacters anywhere",
  OPERATION_KEYS.every((k: string) =>
    !/[;&|><`$]/.test(ops[k].argv.join(" ")) && !["sh", "bash", "zsh", "eval"].includes(ops[k].argv[0]),
  ),
);
check("the macOS-only set is exactly the hardware-bound lanes", (() => {
  const macOnly = OPERATION_KEYS.filter((k: string) => ops[k].platform === "macos").sort();
  return JSON.stringify(macOnly) === JSON.stringify(
    ["desktop-window-smoke", "everything", "everything-fast", "everything-no-ios", "evidence", "ios-shell-repair", "proofs-full", "proofs-sim-only"],
  );
})());

// The structural half of the security property: the runner's ONLY spawn takes
// its program from the operation map, and never opts into a shell. A mutation
// that read a command from the request would have to break one of these.
const runnerSrc = readFileSync(join(repo, "scripts/mac/run-requests.mjs"), "utf8");
// Pinned as a PROPERTY over every call site rather than a count of them: a
// count breaks when someone adds an unrelated spawn (it did — the provenance
// helper shells to `git` and `sw_vers`), and a broken check gets relaxed rather
// than understood. What must stay true is that no spawn takes its program from
// anything a request supplied.
const spawnTargets = [...runnerSrc.matchAll(/spawnSync\(\s*([^,]+),/g)].map((m) => m[1].trim());
check(
  "every spawn in the runner takes its program from the operation map or a fixed literal — never from a request field",
  spawnTargets.length === 3 &&
    spawnTargets.every((t) => t === "op.argv[0]" || t === '"git"' || t === '"sw_vers"') &&
    runnerSrc.includes("spawnSync(op.argv[0], op.argv.slice(1)"),
);
check("the runner never enables a shell", !runnerSrc.includes("shell: true"));

// ── 2. refusal, verified live on this machine ────────────────────────────────
// This proof runs on Linux in CI and in the cloud lane. Every macOS-only
// operation must therefore refuse here — and `--plan` is enough to observe it,
// because the platform check runs BEFORE the plan short-circuit. That ordering
// is the property: a machine that cannot run something says so before it says
// anything else.
//
// The refusal is observed against a SYNTHETIC request, not the live queue.
// This assertion originally planned the real artifacts/sim-requests — and went
// red the day the Mac completed the last pending request that contained a
// macOS-only operation (2026-08-18): nothing was left to refuse, so a healthy
// runner failed the proof. The property under test is the RUNNER's behavior;
// tying it to the queue's current contents made the assertion's subject
// disappear out from under it. The runner's SIGNALGRID_SIM_REQUEST_DIR
// override exists for exactly this.
const synthDir = mkdtempSync(join(tmpdir(), "sim-req-proof-"));
writeFileSync(
  join(synthDir, "synthetic-platform-refusal.json"),
  JSON.stringify({
    schemaVersion: 1,
    id: "synthetic-platform-refusal",
    requestedBy: "proof:sim-requests",
    reason: "synthetic fixture: observe the macOS-only platform refusal on a non-Mac",
    runs: ["proofs-full"],
  }),
);
const planRun = spawnSync("node", ["scripts/mac/run-requests.mjs", "--plan"], {
  cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, SIGNALGRID_SIM_REQUEST_DIR: synthDir },
});
rmSync(synthDir, { recursive: true, force: true });
const planOut = `${planRun.stdout ?? ""}${planRun.stderr ?? ""}`;
if (process.platform !== "darwin") {
  check(
    "on a non-Mac, every macOS-only operation in a live request REFUSES by platform",
    planOut.includes("REFUSED_PLATFORM") && planOut.includes("requires macOS"),
  );
  check(
    "…and says explicitly that it did NOT substitute a weaker run",
    planOut.includes("NOT substituted with a weaker run"),
  );
} else {
  check("(on macOS: platform refusal is not exercised here — the Mac can run these)", true);
  check("(on macOS: substitution notice not applicable)", true);
}
check("--plan writes no result file (a plan is not evidence)", !existsSync(join(RES_DIR, "PLAN.json")));

// ── 3. the audit's laws, each against its own failure ────────────────────────
type Req = { id: string; __fileId: string; runs: string[]; reason: string };
const req = (id: string, runs: string[]): Req => ({ id, __fileId: id, runs, reason: "why" });
const res = (id: string, runs: unknown[]) => ({ requestId: id, __fileId: id, runs, provenance: { commit: "abc" } });

const clean = auditSimRequests([req("r", ["preflight"])], [res("r", [{ operation: "preflight", status: "passed" }])]);
check("a coherent pair is clean (the pass is not vacuous)", clean.problems.length === 0 && clean.pending.length === 0);

const unearned = auditSimRequests([req("r", ["preflight"])], [res("r", [{ operation: "api", status: "passed" }])]);
check(
  "THE UNEARNED AFFIRMATIVE: a green row for work nobody requested is refused",
  unearned.problems.some((p: string) => p.includes("never asked for")),
);

const missing = auditSimRequests([req("r", ["preflight", "api"])], [res("r", [{ operation: "preflight", status: "passed" }])]);
check(
  "an operation missing from a COMPLETED result is pending — never read as passed",
  missing.pending.some((p: string) => p.includes("NOT run")) && missing.problems.length === 0,
);
check(
  "…and a wholly unrun request is pending too, without failing the build (CI has no Mac; blocking on one would be the opposite dishonesty)",
  (() => {
    const a = auditSimRequests([req("r", ["preflight"])], []);
    return a.pending.length === 1 && a.problems.length === 0;
  })(),
);

// The defect the loop shipped with, found by using it: a stray Linux run wrote a
// result whose every row was `refused_platform`, and the gate read "has a row" as
// "answered" — closing out a request the Mac had never touched. A refusal is an
// honest record of an ATTEMPT; it is never evidence the work happened.
const refusedOnly = auditSimRequests(
  [req("r", ["everything"])],
  [{ requestId: "r", __fileId: "r", runs: [{ operation: "everything", status: "refused_platform" }], provenance: { commit: "abc", platform: "linux" } }],
);
check(
  "A REFUSAL NEVER CLOSES A REQUEST — an all-refused result stays pending, and says which machine could not run it",
  refusedOnly.pending.some((p: string) => p.includes("attempted, NOT run")) && refusedOnly.problems.length === 0,
);

const ghost = auditSimRequests([], [res("ghost", [{ operation: "preflight", status: "passed" }])]);
check("a result naming no existing request is refused", ghost.problems.some((p: string) => p.includes("does not exist")));

const badStatus = auditSimRequests([req("r", ["preflight"])], [res("r", [{ operation: "preflight", status: "mostly-fine" }])]);
check("a status outside the closed set is refused", badStatus.problems.some((p: string) => p.includes("outside the closed set")));

const noProv = auditSimRequests([req("r", ["preflight"])], [{ requestId: "r", __fileId: "r", runs: [], provenance: {} }]);
check("a result that cannot name the commit it ran against is refused", noProv.problems.some((p: string) => p.includes("provenance.commit")));

check(
  "'passed' is the ONLY status the loop reads as green — refusals and skips never count",
  GREEN_STATUSES.length === 1 && GREEN_STATUSES[0] === "passed" &&
    RUN_STATUSES.filter((s: string) => s !== "passed").length === 4,
);

// ── 4. the committed requests are themselves coherent ────────────────────────
const load = (dir: string) =>
  (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []).map((f) => {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
    p.__fileId = f.replace(/\.json$/, "");
    return p;
  });
const live = auditSimRequests(load(REQ_DIR), load(RES_DIR));
check("the committed request/result set has no incoherence", live.problems.length === 0);
check("at least one request is committed (the loop is live, not theoretical)", load(REQ_DIR).length > 0);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
console.log(`figures=operations=${OPERATION_KEYS.length},statuses=${RUN_STATUSES.length}`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
