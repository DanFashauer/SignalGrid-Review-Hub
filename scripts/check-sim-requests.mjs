// check-sim-requests.mjs — the cloud↔local simulation loop stays honest.
//
//   node scripts/check-sim-requests.mjs              # report + gate
//   node scripts/check-sim-requests.mjs --self-test  # prove the gate can fail
//
// WHAT IT ENFORCES, and the reason each clause exists:
//
//  1. Every request names only ALLOWLISTED operations, and its id matches its
//     filename. A request naming an operation the runner cannot map is a request
//     that would sit pending forever with nothing saying why.
//  2. Every result binds to a request that exists, and reports rows ONLY for
//     operations that request asked for. A result carrying an extra green row is
//     the unearned affirmative in its purest form: evidence for work nobody
//     asked for and nobody can trace.
//  3. A result may not claim `passed` for an operation whose request row is
//     absent, and a status outside the closed set is rejected outright.
//  4. **An unrun request is PENDING and REPORTED — never green, never silent.**
//     This is the whole point of the gate rather than a convention. Pending is
//     not a failure: the owner's Mac is not always at hand, and blocking CI on
//     hardware CI cannot reach would be the dishonesty running the other way.
//     So pending is loud and non-fatal, and only incoherence fails the build.
//
// NOTHING HERE READS A CLOCK. Freshness is a separate question answered by
// `check-live-sync.mjs` against the evidence artifact; this gate answers
// "do the request and result files agree", which has no time in it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SIM_OPERATIONS, OPERATION_KEYS, RUN_STATUSES, GREEN_STATUSES, EXECUTED_STATUSES } from "./lib/sim-operations.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQ_DIR = join(repo, "artifacts/sim-requests");
const RES_DIR = join(repo, "artifacts/sim-results");

const listJson = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

/** Pure over the two directories' PARSED contents, so the self-test can drive it
 *  with synthetic input and prove the same code path fails. */
export function auditSimRequests(requests, results) {
  const problems = [];
  const pending = [];
  const superseded = [];
  const reqById = new Map(requests.map((r) => [r.id, r]));

  // ── Supersession ──────────────────────────────────────────────────────────
  // A request whose SCOPING proved wrong cannot be amended in place — its
  // committed results are bound to the runs it originally named, and this
  // gate rightly rejects a result reporting work its (rewritten) request
  // never asked for. The honest mechanism: the AUTHOR writes a successor
  // request and links the two. Rules, all enforced:
  //   · the successor must exist, and must name its predecessor back
  //     (`supersedes`), so a one-sided pointer cannot quietly retire work;
  //   · a superseded request stops counting as pending, but is REPORTED on
  //     every run — retirement is visible forever, never silent;
  //   · its existing results stay bound to its original runs, untouched.
  const supersededIds = new Set();
  for (const req of requests) {
    if (!req.supersededBy) continue;
    if (req.supersededBy === req.id) {
      problems.push(`request ${req.__fileId}: supersededBy points at itself`);
      continue;
    }
    const successor = reqById.get(req.supersededBy);
    if (!successor) {
      problems.push(`request ${req.__fileId}: supersededBy "${req.supersededBy}" names a request that does not exist`);
      continue;
    }
    if (successor.supersedes !== req.id) {
      problems.push(
        `request ${req.__fileId}: successor "${req.supersededBy}" does not name it back (its supersedes field is "${successor.supersedes ?? "absent"}") — a one-sided pointer cannot retire a request`,
      );
      continue;
    }
    // The successor must itself be ACTIVE. Without this, two requests naming
    // each other retire BOTH — zero pending, zero problems, and no runnable
    // work left anywhere: the unearned affirmative again, via a cycle. A
    // chain therefore points every predecessor at the FINAL active request.
    if (successor.supersededBy) {
      problems.push(
        `request ${req.__fileId}: successor "${req.supersededBy}" is itself superseded — a retired request cannot retire another; point supersededBy at the ACTIVE end of the chain`,
      );
      continue;
    }
    supersededIds.add(req.id);
    superseded.push(`${req.id} → superseded by ${req.supersededBy}`);
  }

  for (const req of requests) {
    if (req.id !== req.__fileId) {
      problems.push(`request ${req.__fileId}: id field "${req.id}" does not match its filename`);
    }
    if (!Array.isArray(req.runs) || req.runs.length === 0) {
      problems.push(`request ${req.__fileId}: no runs listed`);
      continue;
    }
    for (const key of req.runs) {
      if (!SIM_OPERATIONS[key]) {
        problems.push(`request ${req.__fileId}: unknown operation "${key}" (known: ${OPERATION_KEYS.join(", ")})`);
      }
    }
    if (!req.reason || String(req.reason).trim() === "") {
      problems.push(`request ${req.__fileId}: no reason recorded — a request nobody can justify later is noise`);
    }
  }

  const resById = new Map(results.map((r) => [r.requestId, r]));
  for (const res of results) {
    const req = reqById.get(res.requestId);
    if (!req) {
      problems.push(`result ${res.__fileId}: names request "${res.requestId}", which does not exist`);
      continue;
    }
    const asked = new Set(req.runs);
    for (const row of res.runs ?? []) {
      if (!RUN_STATUSES.includes(row.status)) {
        problems.push(`result ${res.__fileId}: run "${row.operation}" has status "${row.status}" outside the closed set (${RUN_STATUSES.join(", ")})`);
      }
      if (!asked.has(row.operation)) {
        problems.push(`result ${res.__fileId}: reports "${row.operation}", which its request never asked for`);
      }
    }
    // A macOS-only operation cannot have PASSED on something that is not a Mac.
    // Without this, a corrupted or hand-authored result closes a hardware-bound
    // request green — the one thing the whole loop exists to make impossible.
    for (const row of res.runs ?? []) {
      const op = SIM_OPERATIONS[row.operation];
      if (!op || !GREEN_STATUSES.includes(row.status)) continue;
      const platform = res.provenance?.platform;
      if (op.platform === "macos" && platform !== "darwin") {
        problems.push(
          `result ${res.__fileId}: "${row.operation}" is macOS-only but is recorded as ${row.status} with provenance.platform="${platform ?? "absent"}"`,
        );
      }
    }
    if (!res.provenance || !res.provenance.commit) {
      problems.push(`result ${res.__fileId}: no provenance.commit — a result that cannot name the code it ran against is not evidence`);
    }
    // An operation is ANSWERED only when it actually executed — `passed` or
    // `failed`. Everything else is still owed.
    //
    // THIS CLAUSE WAS THE LOOP'S OWN HOLE, and it was found by using it. A stray
    // run on Linux wrote a result whose every row was `refused_platform`. The
    // earlier version asked only "is there a row for this operation?", so that
    // result closed the request out: no problems, nothing pending, a request the
    // Mac had never touched reading as done. That is precisely the unearned
    // affirmative this loop was built to prevent, arriving through the back door
    // of the loop itself — a refusal is an honest record of an ATTEMPT, never
    // evidence that the work happened.
    if (!supersededIds.has(req.id)) {
      for (const key of req.runs) {
        const row = (res.runs ?? []).find((r) => r.operation === key);
        if (!row) {
          pending.push(`${res.requestId} → ${key} (result exists but this operation has no row: NOT run)`);
        } else if (!EXECUTED_STATUSES.includes(row.status)) {
          pending.push(
            `${res.requestId} → ${key} (${row.status} on ${res.provenance?.platform ?? "unknown platform"}: attempted, NOT run — still needs a machine that can)`,
          );
        }
      }
    }
  }

  for (const req of requests) {
    if (!resById.has(req.id) && !supersededIds.has(req.id)) pending.push(`${req.id} → every run still queued (no result yet)`);
  }

  return { problems, pending, superseded };
}

function loadDir(dir) {
  return listJson(dir).map((f) => {
    const parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
    parsed.__fileId = f.replace(/\.json$/, "");
    return parsed;
  });
}

function selfTest() {
  const checks = [];
  const req = (id, runs, reason = "why") => ({ id, __fileId: id, runs, reason });
  const res = (id, runs) => ({ requestId: id, __fileId: id, runs, provenance: { commit: "abc" } });

  // A coherent pair is clean.
  let a = auditSimRequests([req("r1", ["preflight"])], [res("r1", [{ operation: "preflight", status: "passed" }])]);
  checks.push(["a coherent request/result pair passes", a.problems.length === 0 && a.pending.length === 0]);

  // Every failure mode the gate exists for.
  a = auditSimRequests([req("r1", ["not-an-operation"])], []);
  checks.push(["an unknown operation is caught", a.problems.some((p) => p.includes("unknown operation"))]);

  a = auditSimRequests([], [res("ghost", [{ operation: "preflight", status: "passed" }])]);
  checks.push(["a result with no request is caught", a.problems.some((p) => p.includes("does not exist"))]);

  a = auditSimRequests([req("r1", ["preflight"])], [res("r1", [{ operation: "api", status: "passed" }])]);
  checks.push(["a result reporting work nobody asked for is caught", a.problems.some((p) => p.includes("never asked for"))]);

  a = auditSimRequests([req("r1", ["preflight"])], [res("r1", [{ operation: "preflight", status: "green-ish" }])]);
  checks.push(["a status outside the closed set is caught", a.problems.some((p) => p.includes("outside the closed set"))]);

  a = auditSimRequests([req("r1", ["preflight", "api"])], [res("r1", [{ operation: "preflight", status: "passed" }])]);
  checks.push([
    "an operation MISSING from a completed result is reported pending, not passed",
    a.pending.some((p) => p.includes("NOT run")) && a.problems.length === 0,
  ]);

  a = auditSimRequests([req("r1", ["preflight"])], []);
  checks.push(["a request with no result at all is pending, not a failure", a.pending.length === 1 && a.problems.length === 0]);

  // The hole this gate shipped with, now a permanent control.
  a = auditSimRequests(
    [req("r1", ["everything"])],
    [{ requestId: "r1", __fileId: "r1", runs: [{ operation: "everything", status: "refused_platform" }], provenance: { commit: "abc", platform: "linux" } }],
  );
  checks.push([
    "A REFUSAL DOES NOT CLOSE A REQUEST: an all-refused result stays pending, never answered",
    a.pending.some((p) => p.includes("attempted, NOT run")) && a.problems.length === 0,
  ]);

  a = auditSimRequests([req("r1", ["preflight"])], [{ requestId: "r1", __fileId: "r1", runs: [], provenance: {} }]);
  checks.push(["a result with no provenance commit is caught", a.problems.some((p) => p.includes("provenance.commit"))]);

  // Supersession: retirement must be two-sided, visible, and never silent.
  const sup = (id, runs, extra) => ({ id, __fileId: id, runs, reason: "why", ...extra });
  a = auditSimRequests(
    [sup("old", ["everything"], { supersededBy: "new" }), sup("new", ["preflight"], { supersedes: "old" })],
    [res("new", [{ operation: "preflight", status: "passed" }])],
  );
  checks.push([
    "a properly superseded request stops pending AND is reported as superseded",
    a.problems.length === 0 && a.pending.length === 0 && a.superseded.length === 1,
  ]);
  a = auditSimRequests([sup("old", ["everything"], { supersededBy: "missing" })], []);
  checks.push(["supersededBy naming a nonexistent successor is caught", a.problems.some((p) => p.includes("does not exist")) && a.pending.length === 1]);
  a = auditSimRequests([sup("old", ["everything"], { supersededBy: "new" }), sup("new", ["preflight"], {})], []);
  checks.push(["a one-sided supersession pointer is caught and the old request stays pending", a.problems.some((p) => p.includes("name it back")) && a.pending.some((p) => p.startsWith("old"))]);

  a = auditSimRequests(
    [sup("a", ["preflight"], { supersededBy: "b", supersedes: "b" }), sup("b", ["preflight"], { supersededBy: "a", supersedes: "a" })],
    [],
  );
  checks.push([
    "a supersession CYCLE retires nothing: both refused, both still pending",
    a.problems.length === 2 && a.pending.length === 2 && a.superseded.length === 0,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const requests = loadDir(REQ_DIR);
const results = loadDir(RES_DIR);
const { problems, pending, superseded } = auditSimRequests(requests, results);

console.log(`Simulation request loop — ${requests.length} request(s), ${results.length} result(s)`);
const greenRuns = results.flatMap((r) => (r.runs ?? []).filter((x) => GREEN_STATUSES.includes(x.status)));
console.log(`  operations that actually ran clean: ${greenRuns.length}`);

if (superseded.length > 0) {
  console.log(`\n  SUPERSEDED — retired by a successor request (reported forever, never silent):`);
  for (const line of superseded) console.log(`    · ${line}`);
}

if (pending.length > 0) {
  console.log(`\n  PENDING — asked for, not yet run (reported, never counted as green):`);
  for (const p of pending) console.log(`    · ${p}`);
  console.log(`  Run them on the Mac:  pnpm run sim:run-requests`);
}

if (problems.length > 0) {
  console.error(`\nSimulation request loop FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nA request and its result have to describe the same work, or neither is evidence.");
  process.exit(1);
}

console.log(`\nSimulation request loop passed — every result binds to a request it was asked for.`);
