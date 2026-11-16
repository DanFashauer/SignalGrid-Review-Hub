/**
 * SignalGrid Local Brain: the route runner. It is the execution link between the brain's
 * queue and the four-pass route.
 *
 * The local brain owns the work and the queue (owner decision, 2026-11-15). This module takes
 * the brain's top eligible task (task-selector.mjs), resolves its route (scripts/lib/task-route.mjs,
 * DR-047 as data) and walks one JobState (job-state.mjs) through the passes:
 *
 *   pass 1  local LLM: intake, scoped plan, first implementation
 *   pass 2  a local session, Claude or Codex: review the first artifact
 *   pass 3  the OTHER local session: run the real checks (must return a verification)
 *   pass 4  handed to the cloud lane for the final review and landing
 *
 * Fail-closed. Each of these stops the run with a HAND (DR-054). None is skipped, guessed,
 * or folded into a later pass:
 *  - no route, a pending tier, a refused lane, or a missing pass 1;
 *  - no executor for a lane, or an executor that throws or answers malformed;
 *  - a pass that reports a different model or effort than its route asked for (no silent downgrade);
 *  - a review (pass 2) that returns no findings list (an empty list is allowed; a missing one is not);
 *  - a pass 3 whose proof the brain's own policy (proof-policy.mjs assessProof) does not pass:
 *    exit 0, tests > 0, every test passed, no failures, no skips, changed files inside the task's
 *    scope. The runner never bypasses that policy. A proof with no changed files (a read-only kind)
 *    is refused with its own reason until the policy has an explicit read-only path, and a kind
 *    known to be read-only (log-scan) is refused before any job or executor starts (#2176);
 *  - a pass 3 or pass 4 that reports a head other than the one it was given: the validated
 *    artifact and the handed-off artifact must be the reviewed one, never a silent substitute;
 *  - a pass 3 whose answers list is not a list of {id, disposition} rows, or whose open findings
 *    are not a list of {id} rows.
 * The review's findings are forwarded to pass 3 (which must answer each one) and to the cloud
 * hand-off, together with any findings pass 3 leaves open.
 * The job is left INTERRUPTED with the reason recorded, so a later run can resume it.
 *
 * Executors are injected: each is `(request) => result`. commandExecutor() below turns a command
 * into one (JSON in on stdin, JSON out on stdout). The commands are the Mac's to configure
 * (route-runner.config.json, which never lives in the tree). With no executor for a lane, the run
 * refuses; it never runs a default.
 *
 * Deterministic: no clock, no randomness. Times and ids come from the queue and the executors.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { selectEligible } from "./task-selector.mjs";
import JobState from "./job-state.mjs";
import { assessProof } from "./proof-policy.mjs";
import { resolveRoute, loadRoutingTable } from "../../lib/task-route.mjs";
import { isMainModule } from "../../lib/is-main.mjs";

const READ_ONLY_KINDS = new Set(["log-scan"]);
const hand = (why, need, extra = {}) => ({ status: "hand", why, need, whoCanUnblock: extra.who ?? "mac lane", ...extra });

const CLOUD_PROVIDERS = new Set(["claude", "codex"]);

/**
 * What a pass must have done, from its route entry. A local Codex lane names no model (it picks
 * its own). The cloud final pass may run on either provider, so its receipt must NAME the provider:
 * a Claude reviewer must report the route's claudeModel, a Codex reviewer keeps its own model
 * choice, and a missing or unknown provider is refused, never read as a waiver.
 */
function expectation(pass, result) {
  if (pass.pass === 4) return { effort: pass.effort, model: result?.provider === "claude" ? pass.claudeModel ?? null : null };
  return { effort: pass.effort ?? null, model: pass.model ?? null };
}

const isRow = (f) => f !== null && typeof f === "object" && !Array.isArray(f) && typeof f.id === "string" && f.id.length > 0;

function checkReceipt(pass, result, task, findings, headIn) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "answered nothing usable";
  if (result.ok !== true) return `reported failure: ${typeof result.why === "string" ? result.why : "no reason given"}`;
  if (typeof result.head !== "string" || !/^[0-9a-f]{40}$/.test(result.head)) return "did not report a full 40-character head";
  if ((pass.pass === 3 || pass.pass === 4) && result.head !== headIn) {
    return `reported head ${result.head}, but was given ${headIn} (pass ${pass.pass} must not change the artifact it was handed)`;
  }
  if (pass.pass === 4 && !CLOUD_PROVIDERS.has(result.provider)) return `named no known cloud provider (got ${JSON.stringify(result.provider)}; claude or codex)`;
  if (pass.pass === 4 && result.provider === "claude" && !pass.claudeModel) return "has a claude provider but the route names no claudeModel";
  const want = expectation(pass, result);
  if (want.effort && result.effort !== want.effort) return `ran at effort ${JSON.stringify(result.effort)}, route asked for ${want.effort}`;
  if (want.model && result.model !== want.model) return `ran on ${JSON.stringify(result.model)}, route asked for ${want.model}`;
  if (pass.pass === 2 && (!Array.isArray(result.findings) || !result.findings.every((f) => f && typeof f.id === "string" && f.id.length > 0))) {
    return "returned no findings list (each finding needs an id; an empty list means none)";
  }
  if (pass.pass === 3) {
    if (result.proof && typeof result.proof === "object" && Array.isArray(result.proof.changedFiles) && result.proof.changedFiles.length === 0) {
      return "pass 3 proof changed no files: a read-only kind has no proof-policy path yet, so it is refused, not waived";
    }
    if (assessProof(result.proof, task.scope) !== "review") {
      return "pass 3 proof did not pass the brain's proof policy (exit 0, tests > 0, all passed, no fail, no skip, changed files in scope)";
    }
    if (!Array.isArray(result.findingsAnswered) || !result.findingsAnswered.every((f) => isRow(f) && typeof f.disposition === "string" && f.disposition.trim().length > 0)) {
      return "findingsAnswered must be a list of {id, disposition} rows (an empty list when the review found nothing)";
    }
    const answered = new Set(result.findingsAnswered.map((f) => f.id));
    const missing = findings.filter((f) => !answered.has(f.id)).map((f) => f.id);
    if (missing.length) return `pass 3 did not answer review finding(s) ${missing.join(", ")}`;
    if (result.openFindings !== undefined && (!Array.isArray(result.openFindings) || !result.openFindings.every(isRow))) return "openFindings must be a list of {id} rows";
  }
  if (pass.pass === 4 && (typeof result.deliveredRef !== "string" || !result.deliveredRef.trim())) return "the cloud hand-off named no delivered ref";
  return null;
}

/**
 * Run the brain's next task through its route.
 * @returns {{status:"idle"} | {status:"handed-to-cloud", task, route, job} | {status:"hand", why, need, whoCanUnblock, task?, route?, job?}}
 */
export function runNext({ tasks, scope, table, repo, head, executors, reviewLane = "local-claude", localLlmAvailable = true, unavailableTiers = [] }) {
  const eligible = selectEligible(tasks, scope);
  if (eligible.length === 0) return { status: "idle" };
  const task = eligible[0];
  if (typeof head !== "string" || !/^[0-9a-f]{40}$/.test(head)) return hand("no full starting head", "the 40-character commit the task starts from", { task: task.id });
  const route = resolveRoute(table, task.kind, { reviewLane, localLlmAvailable, unavailableTiers });
  if (route.gap) return hand(`no route for kind ${JSON.stringify(task.kind)}`, `the capability-gap route: ${route.route ?? "fallback"}`, { task: task.id, route, who: "cloud lane" });
  if (route.pending) return hand(`route pending: ${route.why ?? "tier unavailable"}`, "the tier to come back; work waits, never runs lower", { task: task.id, route });
  if (route.refused) return hand(`route refused: ${route.why}`, "a supported lane configuration", { task: task.id, route });
  if (route.complete !== true) return hand("pass 1 is missing: no local LLM build available", "the local LLM running (Bonsai)", { task: task.id, route });
  // A read-only kind changes no files, so pass 3's proof would be refused after three passes of
  // work (#2176). Refuse it here, before any job is claimed or any executor runs.
  if (READ_ONLY_KINDS.has(task.kind)) return hand(`read-only ${task.kind} has no proof-policy path yet`, "an explicit read-only proof path in proof-policy.mjs", { task: task.id, route });

  const job = new JobState(task.id, repo, route.passes[0].lane, head);
  job.claim(route.passes[0].lane, job.getVersion());
  let current = head;
  let reviewFindings = [];
  let answered = [];
  let openFindings = [];
  for (const pass of route.passes) {
    const lane = pass.lane;
    if (job.assignedWorkerId !== lane) job.handoff(lane, job.getVersion(), job.assignedWorkerId);
    const run = executors?.[lane];
    const stop = (why) => {
      const reason = `pass ${pass.pass} on ${lane} ${why}`;
      job.interrupt(reason, job.getVersion(), lane);
      return hand(reason, `a working ${lane} executor`, { task: task.id, route, job: job.snapshot() });
    };
    if (typeof run !== "function") return stop("has no executor configured");
    let result;
    try {
      result = run({ task, pass, head: current, role: route.role, skills: route.skills, validators: route.validators, ownerGated: route.ownerGated,
        reviewFindings: pass.pass >= 3 ? reviewFindings : undefined,
        findingsAnswered: pass.pass === 4 ? answered : undefined,
        openFindings: pass.pass === 4 ? openFindings : undefined });
    } catch (e) {
      return stop(`threw: ${e?.message ?? String(e)}`);
    }
    const bad = checkReceipt(pass, result, task, reviewFindings, current);
    if (bad) return stop(bad);
    const receipt = { pass: pass.pass, lane, tier: pass.tier ?? null, provider: pass.pass === 4 ? result.provider : null, model: result.model ?? null, effort: result.effort ?? null, headIn: current, headOut: result.head };
    if (pass.pass === 2) {
      reviewFindings = result.findings.map((f) => ({ ...f }));
      job.checkpoint({ type: "pass", details: { ...receipt, findings: reviewFindings } }, job.getVersion(), lane);
    } else if (pass.pass === 3) {
      answered = result.findingsAnswered.map((f) => ({ id: f.id, disposition: f.disposition }));
      openFindings = Array.isArray(result.openFindings) ? result.openFindings.map((f) => ({ ...f })) : [];
      job.checkpoint({ type: "pass", details: { ...receipt, findingsAnswered: answered, openFindings, proof: result.proof } }, job.getVersion(), lane);
      const verification = { command: result.proof.command, exitCode: result.proof.exitCode, passed: result.proof.pass };
      // Keep every reported counter for JobState and downstream readback; do not
      // turn contradictory original evidence into a smaller green summary.
      for (const key of ["tests", "pass", "fail", "failed", "errors", "skipped", "cancelled", "todo"]) {
        if (Object.hasOwn(result.proof, key)) verification[key] = result.proof[key];
      }
      job.checkpoint({ type: "verification", details: verification }, job.getVersion(), lane);
    } else if (pass.pass === 4) {
      job.checkpoint({ type: "cloud-handoff", details: { ...receipt, deliveredRef: result.deliveredRef, ownerGated: route.ownerGated === true, reviewFindings, findingsAnswered: answered, openFindings } }, job.getVersion(), lane);
    } else {
      job.checkpoint({ type: "pass", details: receipt }, job.getVersion(), lane);
    }
    current = result.head;
  }
  // The job stays ASSIGNED to cloud-final: the cloud lane completes it after its final review,
  // with its own verification (JobState refuses completion without one).
  return { status: "handed-to-cloud", task: task.id, route, job: job.snapshot() };
}

/** An executor that runs `argv` with the request as JSON on stdin and parses its JSON stdout. */
export function commandExecutor(argv, { timeoutMs = 4 * 60 * 60 * 1000 } = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string" && a.length > 0)) {
    throw new TypeError("an executor command must be a non-empty array of strings");
  }
  return (request) => {
    const r = spawnSync(argv[0], argv.slice(1), { input: JSON.stringify(request), encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    if (r.error) throw new Error(`could not run ${argv[0]}: ${r.error.message}`);
    if (r.status !== 0) return { ok: false, why: `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}` };
    try { return JSON.parse(r.stdout); } catch { return { ok: false, why: "stdout was not JSON" }; }
  };
}

/** Executors from a config object: { "local-llm": [argv...], "local-claude": [...], "local-codex": [...], "cloud-final": [...] }. */
export function executorsFromConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new TypeError("the route-runner config must be an object of lane -> argv");
  const out = Object.create(null);
  for (const [lane, argv] of Object.entries(config)) out[lane] = commandExecutor(argv);
  return out;
}

// CLI: node scripts/mac/local-brain/route-runner.mjs --tasks <queue.json> --scope <path> --repo <owner/name> --head <sha> --config <route-runner.config.json> [--review-lane local-codex] [--no-local-llm]
// Prints the result as JSON. Exit 0 idle or handed-to-cloud, 3 hand (the caller raises it with hand:raise).
if (isMainModule(process.argv[1], import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const need = ["--tasks", "--scope", "--repo", "--head", "--config"].filter((n) => !arg(n));
  if (need.length) { console.error(`route-runner: missing ${need.join(", ")}`); process.exit(2); }
  const result = runNext({
    tasks: JSON.parse(readFileSync(arg("--tasks"), "utf8")),
    scope: arg("--scope"),
    table: loadRoutingTable(),
    repo: arg("--repo"),
    head: arg("--head"),
    executors: executorsFromConfig(JSON.parse(readFileSync(arg("--config"), "utf8"))),
    reviewLane: arg("--review-lane") ?? "local-claude",
    localLlmAvailable: !process.argv.includes("--no-local-llm"),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "hand" ? 3 : 0);
}
