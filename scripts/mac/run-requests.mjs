// run-requests.mjs — execute the simulation runs the cloud lane asked for.
//
//   pnpm run sim:run-requests              # run every PENDING request
//   pnpm run sim:run-requests --id <id>    # run one request by id
//   pnpm run sim:run-requests --plan       # print what would run, run nothing
//   pnpm run sim:run-requests --rerun      # include requests that already have a result
//
// THE LOOP THIS CLOSES. The cloud lane cannot execute anything on the owner's
// Mac, and the Mac lane cannot be reached by CI. Before this, the coordination
// bus was prose: a message saying "please run the harness", and a human
// remembering to. Prose leaves no artifact, so an unrun simulation and a passing
// one looked identical from the cloud side — the unearned affirmative, one layer
// out from the code it usually describes.
//
// Now the cloud writes a REQUEST (artifacts/sim-requests/<id>.json) naming
// operations from a fixed allowlist, and this runner writes a RESULT
// (artifacts/sim-results/<id>.json) recording what actually executed, on what
// machine, at what commit. A request with no result is PENDING and the gate says
// so on every run; it never reads as green.
//
// SAFETY. A request names KEYS, never commands. `scripts/lib/sim-operations.mjs`
// maps a key to argv, and nothing outside that map can be executed here. An
// operation this machine cannot honestly run is REFUSED and recorded as refused
// — never silently downgraded to a weaker run reported under the stronger name.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SIM_OPERATIONS, OPERATION_KEYS, EXECUTED_STATUSES } from "../lib/sim-operations.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// SIGNALGRID_SIM_REQUEST_DIR: proof-harness override so the platform-refusal
// property can be observed against a SYNTHETIC request. proof:sim-requests
// used to assert refusals against whatever real requests happened to be
// pending — which went vacuous-then-red the moment the Mac completed the last
// pending request that contained a macOS-only operation (2026-08-18). The
// property under test is the runner's behavior, not the queue's contents, so
// the proof supplies its own fixture queue. Results still land in the real
// RES_DIR only on a real run; --plan writes nothing either way.
const REQ_DIR = process.env.SIGNALGRID_SIM_REQUEST_DIR
  ? resolve(process.env.SIGNALGRID_SIM_REQUEST_DIR)
  : join(repo, "artifacts/sim-requests");
const RES_DIR = join(repo, "artifacts/sim-results");

const argv = process.argv.slice(2);
const plan = argv.includes("--plan");
const rerun = argv.includes("--rerun");
const idFlag = argv.indexOf("--id");
const onlyId = idFlag >= 0 ? argv[idFlag + 1] : null;
// `--id` with no value silently disabled every filter and ran EVERYTHING —
// including the container and credential-backed lanes. A typo must not widen
// the blast radius of a command meant to narrow it.
if (idFlag >= 0 && (onlyId === undefined || onlyId.startsWith("--"))) {
  console.error("--id needs a request id, e.g. --id 2026-08-12-post-merge-baseline");
  process.exit(2);
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const listJson = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

/** Capture the machine this ran on. Provenance is the whole point of a result:
 *  "the proofs passed" means nothing without "on what, at which commit". */
function provenance() {
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const sw = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" });
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    macosVersion: sw.status === 0 ? sw.stdout.trim() : null,
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    // A dirty tree is not a failure, but a result minted from uncommitted code
    // cannot be reproduced from the commit it names — so it is recorded.
    workingTreeClean: git(["status", "--porcelain"]) === "",
  };
}

/** Strip anything machine- or credential-shaped from captured output BEFORE it is
 *  written to a file the owner is told to commit to a PUBLIC repository.
 *
 *  The tail of a failing command is the most useful thing in a result and the most
 *  dangerous: it carries home directories, usernames, configured endpoint URLs,
 *  and occasionally a token a tool echoed back. AGENTS.md forbids exactly that
 *  ("no secrets, credentials, tenant IDs, customer data, PHI, PII, or
 *  environment-specific private values"), and a diagnostic tail is not an
 *  exception to it. Redaction is deliberately BLUNT — over-redacting costs a
 *  round trip, under-redacting is permanent once pushed. */
function redactLine(line) {
  return line
    .replace(/\/(?:Users|home)\/[^/\s:]+/g, "/$&/".slice(1, 2) === "" ? "<HOME>" : "<HOME>")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "<URL>")
    .replace(/\b(?:sk|pk|ghp|gho|sgk|xox[abpr])[-_][A-Za-z0-9_-]{8,}/g, "<REDACTED-TOKEN>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "<REDACTED-JWT>")
    .replace(/\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/g, "<REDACTED-BLOB>")
    .replace(/\b(\w*(?:secret|password|token|api[_-]?key|credential)\w*)\s*[:=]\s*\S+/gi, "$1=<REDACTED>");
}

/** Run one allowlisted operation. Returns a result row; never throws. */
function runOperation(key) {
  const op = SIM_OPERATIONS[key];
  if (!op) {
    // Unreachable via a gated request, kept because the runner must not depend
    // on the gate having run first.
    return { operation: key, status: "refused_missing_prerequisite", detail: `unknown operation key (known: ${OPERATION_KEYS.join(", ")})` };
  }
  if (op.platform === "macos" && process.platform !== "darwin") {
    return {
      operation: key,
      status: "refused_platform",
      detail: `requires macOS; this machine is ${process.platform}. NOT substituted with a weaker run.`,
    };
  }
  if (plan) return { operation: key, status: "skipped_by_operator", detail: "--plan: not executed" };

  const started = Date.now();
  const r = spawnSync(op.argv[0], op.argv.slice(1), {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const durationMs = Date.now() - started;

  if (r.error) {
    return {
      operation: key,
      status: "refused_missing_prerequisite",
      detail: `could not launch: ${r.error.message}${op.needs ? ` (needs: ${op.needs})` : ""}`,
      durationMs,
    };
  }
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Keep the tail rather than the whole log: enough to diagnose, small enough to
  // commit. The summary lines every harness here prints live at the end.
  const tail = out.trimEnd().split("\n").slice(-25).map(redactLine);
  // Exit 3 is this repo's "nothing failed, but something did not run" code
  // (scripts/run-live-lanes.sh). Mapping it to `failed` would cry wolf; mapping
  // it to `passed` — which is what happened before — closes a request green over
  // lanes that never started.
  const status = r.status === 0 ? "passed" : r.status === 3 ? "refused_missing_prerequisite" : "failed";
  return {
    operation: key,
    status,
    detail: r.status === 3 ? "the command reported SKIPPED lanes: nothing failed, but something did not run" : undefined,
    exitCode: r.status,
    durationMs,
    tail,
  };
}

function main() {
  const requestFiles = listJson(REQ_DIR);
  if (requestFiles.length === 0) {
    console.log("No requests in artifacts/sim-requests — nothing to run.");
    return 0;
  }

  // "Has a result file" is NOT "is finished". A result whose rows are refusals or
  // skips leaves the work owed — the gate says so on every run — so the runner
  // must be willing to pick it up again, or the documented command can never
  // complete work the checker keeps reporting as pending.
  const settledIds = new Set();
  for (const f of listJson(RES_DIR)) {
    const id = f.replace(/\.json$/, "");
    try {
      const res = readJson(join(RES_DIR, f));
      const req = readJson(join(REQ_DIR, f));
      const answered = (req.runs ?? []).every((k) =>
        (res.runs ?? []).some((r) => r.operation === k && EXECUTED_STATUSES.includes(r.status)));
      if (answered) settledIds.add(id);
    } catch {
      // An unreadable or orphaned result is not evidence of anything; the gate
      // reports it separately. Treat it as unsettled so the work can be redone.
    }
  }
  const doneIds = settledIds;
  let ran = 0;
  let considered = 0;
  let anyFailed = false;

  for (const file of requestFiles) {
    const id = file.replace(/\.json$/, "");
    if (onlyId && id !== onlyId) continue;
    if (!rerun && !onlyId && doneIds.has(id)) continue;

    const req = readJson(join(REQ_DIR, file));
    // A superseded request is retired work: the checker validates the two-way
    // link and reports it on every run; the runner must not re-execute it.
    // Named explicitly here so retirement is visible in the run log too.
    if (req.supersededBy && !onlyId) {
      console.log(`\n== request ${id} == superseded by ${req.supersededBy} — not run`);
      continue;
    }
    considered += 1;
    console.log(`\n== request ${id} ==`);
    console.log(`   ${req.reason ?? "(no reason recorded)"}`);
    console.log(`   runs: ${req.runs.join(", ")}`);

    // Sampled BEFORE the first operation runs, and deliberately so. An operation
    // is EXPECTED to write into the tree — the iOS phase of `everything` drops
    // native/ios/build/, `evidence` mints artifacts/live-evidence/mac-run.json —
    // so sampling afterwards measured the runner's own output and stamped
    // workingTreeClean:false on a tree that was clean when the work started.
    // The field answers "what code produced this result", which is the state at
    // launch; reading it after the runs answered a question nobody asked.
    const prov = provenance();

    const runs = [];
    for (const key of req.runs) {
      const op = SIM_OPERATIONS[key];
      console.log(`\n-- ${key}${op ? ` — ${op.what}` : ""}`);
      const row = runOperation(key);
      const mark = row.status === "passed" ? "PASS" : row.status === "failed" ? "FAIL" : row.status.toUpperCase();
      console.log(`   ${mark}${row.durationMs != null ? ` (${Math.round(row.durationMs / 1000)}s)` : ""}${row.detail ? ` — ${row.detail}` : ""}`);
      if (row.status === "failed") anyFailed = true;
      runs.push(row);
    }

    if (plan) {
      console.log("\n--plan: no result written.");
      continue;
    }

    mkdirSync(RES_DIR, { recursive: true });
    const result = {
      schemaVersion: 1,
      requestId: id,
      // Supplied by the RUNNER as data. Nothing in the gate or the proof reads a
      // clock — the same rule the decision core lives under.
      completedAt: new Date().toISOString(),
      provenance: prov,
      runs,
    };
    writeFileSync(join(RES_DIR, `${id}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`\nwrote artifacts/sim-results/${id}.json`);
    ran += 1;
  }

  if (considered === 0) {
    // Never exit silently. The first version printed nothing at all when every
    // request already had a result AND --plan was set, so a caller capturing the
    // output could not tell "nothing to do" from "the runner never started".
    console.log(
      `\nNothing to do: ${requestFiles.length} request(s), all already have a result.` +
      "\n  --rerun    run them again" +
      "\n  --id <id>  run one regardless",
    );
  } else if (ran === 0 && !plan) {
    console.log("\nEvery request already has a result. Use --rerun to run them again.");
  } else if (!plan) {
    console.log(`\nRan ${ran} request(s). Commit artifacts/sim-results/ and push so the cloud lane can read them:`);
    console.log("  git add artifacts/sim-results && git commit -m 'sim results' && git push");
  }
  // A failing simulation is a real signal, and this exits non-zero on it — but
  // the RESULT is still written first, because a failure the cloud lane can read
  // is worth more than a clean exit code.
  return anyFailed ? 1 : 0;
}

// `process.exitCode`, NOT `process.exit()`. Node's stdout is asynchronous when it
// is a pipe rather than a TTY, and `process.exit()` tears the process down before
// the buffer drains — so running this by hand printed a full report while any
// caller that CAPTURED its output got silence. Every refusal this runner exists to
// announce was in that dropped buffer. Setting the code and returning lets Node
// flush and exit on its own.
process.exitCode = main();
