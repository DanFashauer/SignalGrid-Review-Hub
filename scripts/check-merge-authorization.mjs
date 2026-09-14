// check-merge-authorization.mjs — the machine-encoded lock on the lane's own merge
// button. PR 3 of the auto-merge safe path (PR 1 = check-owner-gated-surfaces DECISION_PATH,
// PR 2 = check-pr-gate-falsification).
//
//   node scripts/check-merge-authorization.mjs --base origin/SignalGrid_Alpha --head <sha> --checks <file.json>
//   node scripts/check-merge-authorization.mjs --self-test
//
// WHY THIS EXISTS, stated plainly because it is a record of a real failure. On
// 2026-09-13 this lane merged PR #719, a change to scripts/check-owner-gated-surfaces.mjs
// — SAFETY_MACHINERY, which docs/agent/CONTINUITY.md makes owner-only and absolute.
// The merge was made in good faith on a reading of DR-037, which is worded permissively
// and contradicts CONTINUITY.md. Four earlier merges (#716, #708, #689, #704) were made
// on the same reading. Every one of them was a sentence of prose bound to nobody.
//
// So the rule stops being prose. Before the lane merges anything of its own, this runs,
// and the two facts it needs are obtained the way facts have to be obtained:
//
//   THE FILE LIST IS DERIVED, NOT SUPPLIED. The CLI runs `git diff --name-only base...head`
//   itself and feeds the result to classifyDiff(). A model cannot shorten the list it is
//   judged on, because it never hands the list over. This is the half that matters: the
//   owner-gated lock depends on it, and #719 was exactly a wrong answer to "what does
//   this diff touch".
//
//   CHECK RESULTS ARE TRANSPORTED, and therefore distrusted. There is no `gh` and no
//   GitHub API from a script here, so check runs arrive as JSON the caller fetched. The
//   authorizer cannot make that JSON true, so it makes it CHECKABLE: every required check
//   must be present by name, and any red or still-running check anywhere refuses.
//
//   THE STALE-GREEN WINDOW IS CLOSED BY THE REMOTE, NOT BY THE PAYLOAD. The shape a
//   rushed merge actually takes is green-on-an-older-commit quoted for the current one.
//   The obvious defence — make each check name the sha it ran on — is not available:
//   this session's GitHub surface returns check runs WITHOUT a head_sha field (verified
//   2026-09-14 against PR #727 on both the list and single-check calls), so requiring it
//   would refuse every real PR and the gate would be switched off within a day. Instead
//   the script reads the branch tip itself with `git ls-remote` and refuses unless it
//   still equals --head. If the branch moved after the checks were read, the answer is
//   stale by construction and this says so. The caller must then pin the merge to that
//   same sha (expectedHeadSha), which GitHub enforces server-side — belt and braces.
//
// POLARITY. Exit 0 means AUTHORIZED and nothing else. Malformed input, a missing field,
// an unrecognised conclusion, a git failure, a thrown exception — every one of them is
// REFUSED. For a merge authorizer that is the only safe direction: refusing to merge
// costs a re-run, merging on a bad reading costs what #719 cost.
//
// WHAT THIS IS NOT. It does not approve; it withholds. A green verdict means no
// mechanical reason to refuse was found — the owner's judgment is still the thing that
// authorizes an owner-gated surface, and this gate's whole job is to make sure the lane
// asks for it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { classifyDiff } from "./check-owner-gated-surfaces.mjs";

// The check that must be green for any self-merge, named exactly as CI names it (DR-037).
// Non-empty by construction: an empty list would authorize on no evidence at all.
export const REQUIRED_CHECKS = ["Typecheck, build, and proof scaffold"];

// A conclusion that is not one of these refuses — including one GitHub adds later that
// this file has never heard of. Unknown never means fine.
const CONCLUSIVE_GREEN = new Set(["success"]);
const CONCLUSIVE_RED = new Set(["failure", "timed_out", "cancelled", "action_required", "stale", "startup_failure"]);
const CONCLUSIVE_NEUTRAL = new Set(["neutral", "skipped"]);

function refuse(reason, detail) {
  return { authorized: false, reason, detail: detail ?? [] };
}

// Two shas name the same commit when one abbreviates the other. Written because the
// first live run of this gate refused PR #728 against its own branch tip: the caller had
// the 7-char sha the delivery script printed, the remote gave 40, and a plain === called
// an unmoved branch stale. A gate that cries wolf on the ordinary case is a gate someone
// switches off. Both sides are still validated as 7+ hex by the caller, so this cannot
// degenerate into matching on a stub.
function sameCommit(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * The whole decision, as a pure function so the self-test can exercise every refusal
 * without a repository, a network, or a PR.
 *
 * @param {{files: string[], headSha: string, remoteTipSha: string, checks: Array<{name: string, status: string, conclusion: string|null}>}} input
 * @returns {{authorized: boolean, reason: string, detail: string[]}}
 */
export function authorize(input) {
  if (!input || typeof input !== "object") return refuse("input is not an object");

  const { files, headSha, remoteTipSha, checks } = input;

  if (!Array.isArray(files)) return refuse("changed-file list is missing or not an array");
  if (files.length === 0) return refuse("changed-file list is empty — nothing to authorize, and an empty list would classify autonomous");
  if (typeof headSha !== "string" || !/^[0-9a-f]{7,40}$/i.test(headSha)) return refuse("headSha is missing or not a commit sha");
  if (typeof remoteTipSha !== "string" || !/^[0-9a-f]{7,40}$/i.test(remoteTipSha)) return refuse("the remote branch tip could not be read — refusing rather than assuming it has not moved");
  if (!Array.isArray(checks)) return refuse("check-run list is missing or not an array");
  if (checks.length === 0) return refuse("check-run list is empty — no evidence of any gate having run");

  // L1 — the owner-gated lock. This is the one #719 needed and did not have.
  const { tier, matched } = classifyDiff(files);
  if (tier !== "autonomous") {
    const by = [...new Set(matched.map((m) => `${m.category}: ${m.file} (${m.rule})`))];
    return refuse("the diff touches an owner-gated surface — the lane may never merge this, however green", by);
  }

  // L2 — the branch must not have moved since the checks were read. Read from the remote
  // by the CLI, never supplied by whoever wants the merge.
  if (!sameCommit(remoteTipSha, headSha)) {
    return refuse(`the branch tip is now ${remoteTipSha}, not the ${headSha} these checks describe — the green is stale`);
  }

  // L3 — every check must be well-formed and finished.
  for (const c of checks) {
    if (!c || typeof c !== "object") return refuse("a check-run entry is not an object");
    if (typeof c.name !== "string" || !c.name) return refuse("a check-run entry has no name");
    if (c.status !== "completed") return refuse(`check "${c.name}" is still ${c.status ?? "of unknown status"} — the verdict is not in yet`);
    const concl = c.conclusion;
    if (typeof concl !== "string") return refuse(`check "${c.name}" is completed with no conclusion`);
    if (CONCLUSIVE_RED.has(concl)) return refuse(`check "${c.name}" concluded ${concl}`);
    if (!CONCLUSIVE_GREEN.has(concl) && !CONCLUSIVE_NEUTRAL.has(concl)) {
      return refuse(`check "${c.name}" concluded "${concl}", which this gate does not recognise — refusing rather than guessing`);
    }
  }

  // L4 — the named gating check must be present AND green. Neutral/skipped does not count:
  // a required gate that skipped is a gate that did not run.
  const byName = new Map(checks.map((c) => [c.name, c]));
  for (const required of REQUIRED_CHECKS) {
    const c = byName.get(required);
    if (!c) return refuse(`required check "${required}" is absent from the check-run list`);
    if (!CONCLUSIVE_GREEN.has(c.conclusion)) return refuse(`required check "${required}" concluded ${c.conclusion}, not success`);
  }

  return {
    authorized: true,
    reason: `autonomous tier, ${checks.length} check(s) completed, ${REQUIRED_CHECKS.length} required check(s) green, branch tip still ${headSha}`,
    detail: [`pin the merge to this sha: expectedHeadSha=${headSha}`],
  };
}

function changedFiles(base, head) {
  // Three-dot: what THIS branch changed since it diverged, not what mainline moved on to.
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function remoteTip(branch) {
  // Asked of the remote, not of the local clone: a stale fetch is exactly the state in
  // which a moved branch looks unmoved.
  const out = execFileSync("git", ["ls-remote", "origin", `refs/heads/${branch}`], { encoding: "utf8" });
  return out.split(/\s+/)[0] ?? "";
}

function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  const SHA = "335d516ccc8b1589767ffb64fa7df5db2188a17e";
  const OLD = "0000000000000000000000000000000000000001";
  const green = (name) => ({ name, status: "completed", conclusion: "success" });
  const GATE = REQUIRED_CHECKS[0];
  const ok = { files: ["docs/GLOSSARY.md"], headSha: SHA, remoteTipSha: SHA, checks: [green(GATE), green("Secret scan (gitleaks)")] };

  // The gate must be able to say yes, or every refusal below proves nothing.
  t("a clean autonomous diff with the gating check green is AUTHORIZED", authorize(ok).authorized === true);

  // L1 — the owner-gated lock, one case per category, plus the #719 case by name.
  t("a scripts/ change is REFUSED (SAFETY_MACHINERY)",
    authorize({ ...ok, files: ["scripts/mutation-guard.mjs"] }).authorized === false);
  t("the #719 file itself is REFUSED",
    authorize({ ...ok, files: ["scripts/check-owner-gated-surfaces.mjs"] }).authorized === false);
  t("a lib/ change is REFUSED (DECISION_PATH)",
    authorize({ ...ok, files: ["lib/signalgrid-core/src/decision.ts"] }).authorized === false);
  t("LICENSE is REFUSED (OWNER_RESERVED)", authorize({ ...ok, files: ["LICENSE"] }).authorized === false);
  t("one owner-gated file taints an otherwise-clean diff",
    authorize({ ...ok, files: ["docs/GLOSSARY.md", "scripts/preflight.mjs"] }).authorized === false);
  t("a path-shape dodge does not launder scripts/ past the lock",
    authorize({ ...ok, files: ["./scripts/mutation-guard.mjs"] }).authorized === false);
  t("green checks do not rescue an owner-gated diff",
    authorize({ ...ok, files: ["docs/DECISION_RECORDS.md"] }).authorized === false);

  // L2 — the branch must not have moved under the green. This is the stale-green lock.
  t("a branch tip that moved since the checks were read is REFUSED",
    authorize({ ...ok, remoteTipSha: OLD }).authorized === false);
  t("an unreadable branch tip is REFUSED, not assumed unchanged",
    authorize({ ...ok, remoteTipSha: undefined }).authorized === false);
  t("an abbreviated sha still matches its own full branch tip (the #728 false refusal)",
    authorize({ ...ok, headSha: SHA.slice(0, 7) }).authorized === true);
  t("a 7-char sha that is NOT a prefix of the tip is still REFUSED",
    authorize({ ...ok, headSha: "0000000" }).authorized === false);

  // L3 — the check list must be finished and unambiguous.
  t("a still-running check is REFUSED",
    authorize({ ...ok, checks: [{ name: GATE, status: "in_progress", conclusion: null }] }).authorized === false);
  t("a queued check is REFUSED",
    authorize({ ...ok, checks: [{ name: GATE, status: "queued", conclusion: null }] }).authorized === false);
  t("a completed check with no conclusion is REFUSED",
    authorize({ ...ok, checks: [{ name: GATE, status: "completed", conclusion: null }] }).authorized === false);
  t("any red check anywhere is REFUSED, not just a required one",
    authorize({ ...ok, checks: [green(GATE), { name: "Prod stack (Podman)", status: "completed", conclusion: "failure" }] }).authorized === false);
  t("a cancelled check is REFUSED",
    authorize({ ...ok, checks: [green(GATE), { name: "x", status: "completed", conclusion: "cancelled" }] }).authorized === false);
  t("a conclusion this gate has never heard of is REFUSED, not assumed fine",
    authorize({ ...ok, checks: [green(GATE), { name: "x", status: "completed", conclusion: "probably_ok" }] }).authorized === false);
  t("a neutral non-required check does not block",
    authorize({ ...ok, checks: [green(GATE), { name: "x", status: "completed", conclusion: "neutral" }] }).authorized === true);

  // L4 — the gating check must actually be in the list.
  t("the gating check missing from the list is REFUSED",
    authorize({ ...ok, checks: [green("Secret scan (gitleaks)")] }).authorized === false);
  t("the gating check SKIPPED is REFUSED — a gate that did not run is not a green gate",
    authorize({ ...ok, checks: [{ name: GATE, status: "completed", conclusion: "skipped" }] }).authorized === false);

  // Shape refusals — every malformed input refuses rather than throwing or passing.
  t("null input is REFUSED", authorize(null).authorized === false);
  t("no files is REFUSED", authorize({ ...ok, files: undefined }).authorized === false);
  t("an EMPTY file list is REFUSED (it would otherwise classify autonomous)",
    authorize({ ...ok, files: [] }).authorized === false);
  t("an empty check list is REFUSED", authorize({ ...ok, checks: [] }).authorized === false);
  t("a non-sha headSha is REFUSED", authorize({ ...ok, headSha: "HEAD" }).authorized === false);

  // Non-vacuity: the required list has a subject.
  t("REQUIRED_CHECKS is non-empty", REQUIRED_CHECKS.length > 0);

  const failed = checks.filter(([, o]) => !o);
  for (const [name, o] of checks) console.log(`  ${o ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run() {
  const base = arg("--base");
  const head = arg("--head");
  const branch = arg("--branch");
  const checksPath = arg("--checks");

  if (!base || !head || !branch || !checksPath) {
    console.error("usage: node scripts/check-merge-authorization.mjs --base <ref> --head <sha> --branch <pr head branch> --checks <file.json>");
    console.error("       node scripts/check-merge-authorization.mjs --self-test");
    process.exit(1);
  }
  if (!existsSync(checksPath)) {
    console.error(`REFUSED — check-run file not found: ${checksPath}`);
    process.exit(1);
  }

  let verdict;
  try {
    const raw = JSON.parse(readFileSync(checksPath, "utf8"));
    // Accept either a bare array or the GitHub shape { check_runs: [...] }.
    const checks = Array.isArray(raw) ? raw : raw?.check_runs;
    verdict = authorize({
      files: changedFiles(base, head),
      headSha: head,
      remoteTipSha: remoteTip(branch),
      checks,
    });
  } catch (err) {
    // Fail-closed on anything at all: a bad ref, unreadable JSON, a git that is not there.
    console.error(`REFUSED — could not establish the facts: ${err.message}`);
    process.exit(1);
  }

  if (!verdict.authorized) {
    console.error(`REFUSED — ${verdict.reason}`);
    for (const d of verdict.detail) console.error(`    ${d}`);
    console.error("\nHand this PR to the owner. Do not merge it.");
    process.exit(1);
  }
  console.log(`AUTHORIZED — ${verdict.reason}`);
  for (const d of verdict.detail) console.log(`    ${d}`);
  console.log("This withholds a refusal; it is not an approval. The owner still owns anything owner-gated.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else run();
}
