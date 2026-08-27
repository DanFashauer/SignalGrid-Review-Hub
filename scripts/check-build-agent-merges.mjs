// check-build-agent-merges.mjs — builder != reviewer, as a checked FACT.
//
//   node scripts/check-build-agent-merges.mjs             # gate the merge ledger
//   node scripts/check-build-agent-merges.mjs --self-test # prove the gate can fail
//
// WHY THIS EXISTS. The Definition of Done's core is that a role never certifies its
// own work: the nightly build agent builds a branch, and a DIFFERENT session (the
// steward cycle) reviews and merges it. The autonomous-merge design leans on that
// separation entirely. An adversarial verification found the separation is worthless
// if it is only a prompt promise — the git author is identical for every Claude
// session and a Claude-Session commit trailer is author-controlled, so nothing in the
// commit proves who built vs who merged. So every autonomous merge appends a row to
// artifacts/build-agent/merged.jsonl, and this gate holds those rows to the invariant:
// the builder session and the reviewer/merger session are different, and the builder
// was the nightly trigger.
//
// EMPTY IS NOT FAIL-OPEN. Before the loop's first merge the ledger does not exist or
// is empty; there is genuinely nothing to check, and passing is correct — the gate
// makes no claim that a merge happened, only that every recorded merge is honest. A
// malformed row, a missing field, builder==reviewer, or the wrong nightly trigger is
// FATAL.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "artifacts/build-agent/merged.jsonl";

// The nightly build agent's trigger id (docs/agent/scheduled-routines.json). A merge
// whose builderTriggerId is anything else was not built by the sanctioned builder.
export const NIGHTLY_TRIGGER_ID = "trig_01WaoZcckmBjv5Pqs8hGNhFS";
const SESSION_RE = /^(session|cse)_[A-Za-z0-9]+$/;
const REQUIRED = ["prNumber", "branch", "headSha", "builderSessionId", "builderTriggerId", "reviewerSessionId", "mergedAt"];

/** Pure audit over the ledger text (one JSON object per non-blank line). */
export function auditMergeLedger(text) {
  const problems = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let rows = 0;
  for (const [i, line] of lines.entries()) {
    let row;
    try { row = JSON.parse(line); } catch { problems.push(`line ${i + 1}: not valid JSON`); continue; }
    rows += 1;
    const where = `merge of PR #${row.prNumber ?? "?"} (line ${i + 1})`;
    for (const k of REQUIRED) if (row[k] === undefined || row[k] === null || row[k] === "") problems.push(`${where}: missing field \`${k}\``);
    if (row.builderSessionId && row.reviewerSessionId && row.builderSessionId === row.reviewerSessionId) {
      problems.push(`${where}: builderSessionId === reviewerSessionId — a session merged its own build (builder must never be reviewer)`);
    }
    if (row.builderSessionId && !SESSION_RE.test(row.builderSessionId)) problems.push(`${where}: builderSessionId is not a session id`);
    if (row.reviewerSessionId && !SESSION_RE.test(row.reviewerSessionId)) problems.push(`${where}: reviewerSessionId is not a session id`);
    if (row.builderTriggerId && row.builderTriggerId !== NIGHTLY_TRIGGER_ID) {
      problems.push(`${where}: builderTriggerId ${row.builderTriggerId} is not the nightly build agent (${NIGHTLY_TRIGGER_ID})`);
    }
  }
  return { rows, problems };
}

function run() {
  const path = join(repo, LEDGER);
  if (!existsSync(path)) {
    console.log(`Merge ledger ${LEDGER} not present yet — no autonomous merge has been recorded. Nothing to check.`);
    return;
  }
  const { rows, problems } = auditMergeLedger(readFileSync(path, "utf8"));
  console.log(`Merge ledger — ${rows} recorded autonomous merge(s).`);
  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} problem(s) — builder!=reviewer or nightly-trigger provenance is broken:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("Every recorded merge was built and reviewed by different sessions, built by the nightly agent.");
}

function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  const B = "session_builderAAA", R = "cse_reviewerBBB";
  const good = { prNumber: 5, branch: "claude/build-agent-x", headSha: "abc1234", builderSessionId: B, builderTriggerId: NIGHTLY_TRIGGER_ID, reviewerSessionId: R, mergedAt: "2026-08-26T00:00:00Z" };
  const j = (o) => JSON.stringify(o);

  t("a well-formed row with distinct builder/reviewer passes", auditMergeLedger(j(good)).problems.length === 0);
  t("builder == reviewer FAILS", auditMergeLedger(j({ ...good, reviewerSessionId: B })).problems.some((p) => p.includes("own build")));
  t("wrong builderTriggerId FAILS", auditMergeLedger(j({ ...good, builderTriggerId: "trig_someoneelse" })).problems.some((p) => p.includes("not the nightly")));
  t("missing a required field FAILS", auditMergeLedger(j({ ...good, headSha: "" })).problems.some((p) => p.includes("headSha")));
  t("a non-session builder id FAILS", auditMergeLedger(j({ ...good, builderSessionId: "nope" })).problems.some((p) => p.includes("not a session id")));
  t("malformed JSON FAILS", auditMergeLedger("{not json").problems.some((p) => p.includes("not valid JSON")));
  t("an empty ledger is clean (nothing merged yet is not a violation)", auditMergeLedger("").problems.length === 0 && auditMergeLedger("").rows === 0);
  t("multiple good rows pass and are counted", auditMergeLedger(`${j(good)}\n${j({ ...good, prNumber: 6 })}`).rows === 2 && auditMergeLedger(`${j(good)}\n${j({ ...good, prNumber: 6 })}`).problems.length === 0);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();
else run();
