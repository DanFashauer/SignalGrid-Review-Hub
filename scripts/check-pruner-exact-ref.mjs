// Exercise the real CLI with a closed synthetic GitHub API, never real refs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/is-main.mjs";

const SYNTHETIC_API = String.raw`
// Synthetic transport only. Never forwards a request or reads real credentials.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const OLD = "1".repeat(40), NEW = "2".repeat(40), ZERO = "0".repeat(40);
const branch = "mac/cas-fixture", prefix = "/repos/FixtureOwner/FixtureRepo";
const state = { currentTip: OLD, archiveTip: null, calls: [], validCASRequest: false, recoveryWrittenBeforeMutation: false };
const moved = process.env.SG_CAS_SCENARIO === "moved";
const forced = process.env.SG_CAS_FLOW === "forced";
if (process.env.GH_TOKEN !== "SYNTHETIC_CAS_TEST_TOKEN" ||
    process.env.GITHUB_REPOSITORY !== "FixtureOwner/FixtureRepo") throw new Error("Synthetic fixture identity required");
process.on("exit", () => writeFileSync(process.env.SG_CAS_STATE, JSON.stringify(state) + "\n", { flag: "wx", mode: 0o600 }));
const reply = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const recordRecoveryBeforeMutation = () => {
  const path = process.env.GITHUB_STEP_SUMMARY;
  const summary = existsSync(path) ? readFileSync(path, "utf8") : "";
  state.recoveryWrittenBeforeMutation = summary.includes("### Restore any of these") &&
    summary.includes(forced ? "archive/" + branch : OLD);
};
globalThis.fetch = async (raw, init = {}) => {
  const url = new URL(raw), path = decodeURIComponent(url.pathname), method = init.method ?? "GET";
  if (url.origin !== "https://api.github.com") throw new Error("No external origin is available in this fixture");
  const body = init.body ? JSON.parse(init.body) : null;
  state.calls.push({ method, path, body });
  if (method === "GET" && path === prefix) return reply({ default_branch: "SignalGrid_Alpha", node_id: "R_SYNTHETIC_FIXTURE" });
  if (method === "GET" && path === prefix + "/branches") return reply([{ name: branch, commit: { sha: OLD }, protected: false }]);
  if (method === "GET" && path === prefix + "/pulls") return reply(forced ? [] : [{ state: "closed", merged_at: "2026-01-01T00:00:00Z", number: 1, head: { sha: OLD } }]);
  if (method === "GET" && path.startsWith(prefix + "/compare/")) return reply({ status: "diverged", ahead_by: 1, behind_by: 1 });
  if (method === "POST" && path === prefix + "/git/refs") {
    if (body.ref !== "refs/tags/archive/" + branch || body.sha !== OLD) throw new Error("Archive fixture contract differs");
    state.archiveTip = OLD; return reply({ ref: body.ref, object: { sha: OLD } }, 201);
  }
  if (method === "GET" && path === prefix + "/git/ref/tags/archive/" + branch) return reply({ object: { sha: state.archiveTip } });
  if (method === "DELETE" && path === prefix + "/git/refs/heads/" + branch) {
    recordRecoveryBeforeMutation();
    if (moved) state.currentTip = NEW;
    state.currentTip = null; return reply(null, 204);
  }
  if (method === "POST" && path === "/graphql") {
    recordRecoveryBeforeMutation();
    const input = body?.variables?.input, changes = input?.refUpdates;
    state.validCASRequest = input?.repositoryId === "R_SYNTHETIC_FIXTURE" &&
      Array.isArray(changes) && changes.length === 1 && changes[0].name === "refs/heads/" + branch &&
      changes[0].beforeOid === OLD && changes[0].afterOid === ZERO && changes[0].force === false;
    if (!state.validCASRequest) return reply({ errors: [{ message: "Invalid exact-tip fixture request" }], data: { updateRefs: null } });
    if (moved) state.currentTip = NEW;
    if (state.currentTip !== changes[0].beforeOid) return reply({ errors: [{ message: "beforeOid differs from current reference" }], data: { updateRefs: null } });
    state.currentTip = null; return reply({ data: { updateRefs: { clientMutationId: input.clientMutationId ?? null } } });
  }
  throw new Error("Unexpected synthetic API operation: " + method + " " + path);
};
`;

function runCases(subject, root, prefix, preload) {
  const OLD = "1".repeat(40), NEW = "2".repeat(40), cases = [];
  for (const flow of ["normal", "forced"]) for (const scenario of ["same", "moved"]) {
    const label = flow + "-" + scenario, home = join(root, prefix + "-" + label);
    mkdirSync(home, { mode: 0o700 });
    const statePath = join(home, "state.json");
    const child = spawnSync(process.execPath, ["--import", preload, subject], {
      cwd: home, encoding: "utf8", timeout: 30000, maxBuffer: 1 << 20,
      env: { PATH: dirname(process.execPath) + ":/usr/bin:/bin", HOME: home, TMPDIR: home,
        GH_TOKEN: "SYNTHETIC_CAS_TEST_TOKEN", GITHUB_REPOSITORY: "FixtureOwner/FixtureRepo", APPLY: "true",
        FORCE_BRANCHES: flow === "forced" ? "mac/cas-fixture" : "",
        GITHUB_STEP_SUMMARY: join(home, "summary.md"),
        SG_CAS_SCENARIO: scenario, SG_CAS_FLOW: flow, SG_CAS_STATE: statePath },
    });
    if (child.error || child.signal || !Number.isInteger(child.status)) {
      throw new Error("Fixture child did not close normally: " + prefix + "-" + label);
    }
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const selectedOutcome = scenario === "moved"
      ? state.currentTip === NEW && child.status === 1
      : state.currentTip === null && child.status === 0;
    const archiveCorrect = flow === "forced" ? state.archiveTip === OLD : state.archiveTip === null;
    const summary = readFileSync(join(home, "summary.md"), "utf8");
    const recoveryBeforeDelete = state.recoveryWrittenBeforeMutation === true &&
      summary.includes("### Restore any of these") && summary.includes(flow === "forced" ? "archive/mac/cas-fixture" : OLD);
    cases.push({ label, passed: selectedOutcome && archiveCorrect && recoveryBeforeDelete,
      validCASRequest: state.validCASRequest, status: child.status,
      diagnostic: child.stderr?.slice(-500) ?? "" });
  }
  return cases;
}

function main() {
  const subject = realpathSync(process.argv[2] ?? fileURLToPath(new URL("./prune-merged-branches.mjs", import.meta.url)));
  const scratch = mkdtempSync(join(tmpdir(), "sg-pruner-ref-"));
  try {
    const preload = join(scratch, "synthetic-pruner-api.mjs");
    writeFileSync(preload, SYNTHETIC_API, { flag: "wx", mode: 0o600 });
    const cases = runCases(subject, scratch, "current", preload);
    const failed = cases.filter(c => !c.passed || !c.validCASRequest);
    if (failed.length) throw new Error("Actual pruner exact-tip regression: " + JSON.stringify(failed));
    // The gate must also reject the old behavior in BOTH mutation sites.
    const source = readFileSync(subject, "utf8");
    const calls = /await deleteExactHeadRef\(([df])\.name, \1\.sha\);/g;
    let changed = 0;
    const mutant = source.replace(calls, (_match, variable) => {
      changed++;
      return 'await api("/repos/" + OWNER + "/" + REPO + "/git/refs/heads/" + encodeRefPath(' +
        variable + '.name), { method: "DELETE" });';
    });
    if (changed !== 2) throw new Error("Both pruner deletion sites must be mutation-tested");
    const mutantPath = join(scratch, "name-only-deleter.mjs");
    writeFileSync(mutantPath, mutant, { flag: "wx", mode: 0o600 });
    const oldCases = runCases(mutantPath, scratch, "name-only", preload);
    const rejected = oldCases.filter(c => !c.passed).map(c => c.label);
    if (JSON.stringify(rejected) !== JSON.stringify(["normal-moved", "forced-moved"])) {
      throw new Error("Regression gate did not reject exactly both concurrent name-only deletions");
    }
    console.log("PASS branch-prune exact-tip regression: 4 real CLI cases; 2 obsolete deletion mutants caught");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
if (isMainModule(process.argv[1], import.meta.url)) {
  try { main(); }
  catch (error) { console.error("FAIL branch-prune exact-tip regression:", error.message); process.exitCode = 1; }
}
