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
import { spawnSync } from "node:child_process";
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
export function auditSimRequests(requests, results, commitExists = null, shallow = true) {
  const problems = [];
  const pending = [];
  const superseded = [];
  const reported = [];
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
    // A request that does not say WHEN it was queued cannot be reported as
    // overdue: "PENDING" read the same on day one and day twenty-four (ninth
    // audit round, 2026-09-06). Required, parseable, and not in the future.
    const asked = Date.parse(req.requestedAt ?? "");
    if (!req.requestedAt || Number.isNaN(asked)) {
      problems.push(`request ${req.__fileId}: no parseable requestedAt — a request with no queue instant can never be reported overdue`);
    } else if (asked > Date.now() + 5 * 60 * 1000) {
      problems.push(`request ${req.__fileId}: requestedAt ${req.requestedAt} is in the future`);
    }
  }
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
    } else if (commitExists) {
      // PRESENT is not RESOLVABLE. One committed result named a commit this
      // repository has never held (2026-08-23-headwind-first-capture: da1ee232…,
      // found by the ninth audit round) while every sibling resolved — a green
      // run whose code cannot be identified, which is exactly what the sentence
      // above forbids. FATAL on a full clone; on a shallow clone a miss cannot be
      // told from an old commit, so it is REPORTED, never silent, never green.
      // A commit is NOT required to be an ancestor of HEAD: mac/* branch work is
      // legitimate; it only has to exist.
      const sha = String(res.provenance.commit);
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
        problems.push(`result ${res.__fileId}: provenance.commit "${sha}" is not a commit hash`);
      } else if (!commitExists(sha)) {
        const line = `result ${res.__fileId}: provenance.commit ${sha.slice(0, 12)} does not resolve in this repository — the code that produced it cannot be identified`;
        if (shallow) reported.push(`${line} (shallow clone: a miss cannot be told from an unfetched commit — REPORTED, not fatal)`);
        else problems.push(line);
      }
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
    if (!resById.has(req.id) && !supersededIds.has(req.id)) {
      const asked = Date.parse(req.requestedAt ?? "");
      const age = Number.isNaN(asked) ? "age unknown" : `${Math.max(0, Math.floor((Date.now() - asked) / 86_400_000))} day(s) old`;
      pending.push(`${req.id} → every run still queued (no result yet; ${age})`);
    }
  }

  return { problems, pending, superseded, reported };
}

// ── A document must not still call a request pending after its result passed ──
//
// WHY (2026-09-06). docs/lab/LAB_001_CLOUD_REHEARSAL.md named request
// 2026-08-31-lab001-step1-real-posture and said "real-hardware evidence NOT
// minted … When that lands, LAB_001 Step 1 is done for real" four days after the
// Mac ran it (result: passed, exit 0). This gate already knows which requests are
// closed; a document that names a closed request in the same PARAGRAPH as a
// pending phrase is a stale promise. Unit is the paragraph — a blank-line block,
// OR a list item (a backlog of 40 bullets with no blank lines between them is 40
// paragraphs, not one: the first cut read docs/BUILD_BACKLOG.md's whole list as
// a single block and paired an id in one bullet with "not yet" in another) —
// because the id and the phrase were three lines apart. Carve-out: a paragraph
// that dates itself ("as of YYYY-MM-DD") is a record of the moment and passes —
// the honest form anyway. NOT covered: whether the result's content is correct.
export const PENDING_PHRASE_RE = /\bNOT minted\b|\bnot yet\b|\bpending\b|\bwhen (?:that|it) lands\b|\bonce (?:that|it) lands\b|\bwill (?:mint|land|run)\b/i;
const AS_OF_RE = /\bas of \d{4}-\d{2}-\d{2}\b/i;
const passedIds = (results) =>
  new Set(results.filter((r) => (r.runs ?? []).length > 0 && (r.runs ?? []).every((x) => GREEN_STATUSES.includes(x.status))).map((r) => r.requestId));

/** Pure: { [docPath]: text } × results → problems naming doc, paragraph line, request id. */
export function stalePendingProse(docs, results) {
  const closed = passedIds(results);
  const problems = [];
  for (const [doc, text] of Object.entries(docs)) {
    let line = 1;
    for (const para of text.split(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+[.)])\s)/)) {
      const ids = [...closed].filter((id) => para.includes(id));
      if (ids.length > 0 && PENDING_PHRASE_RE.test(para) && !AS_OF_RE.test(para)) {
        const m = para.match(PENDING_PHRASE_RE)[0];
        problems.push(`${doc}:${line}: names request ${ids[0]} (result PASSED) in a paragraph that still says "${m}" — record the completion, or date the sentence ("as of YYYY-MM-DD")`);
      }
      line += para.split("\n").length + 1;
    }
  }
  return problems;
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
  const req = (id, runs, reason = "why") => ({ id, __fileId: id, runs, reason, requestedAt: "2026-09-01T00:00:00Z" });
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

  // Ninth round: every request states when it was queued.
  a = auditSimRequests([{ id: "r1", __fileId: "r1", runs: ["preflight"], reason: "why" }], []);
  checks.push(["a request with no requestedAt is a failure — pending without an age is not reportable", a.problems.some((p) => p.includes("no parseable requestedAt"))]);
  a = auditSimRequests([req("r1", ["preflight"])], []);
  checks.push(["…and a pending request reports its age", a.pending.some((p) => /\d+ day\(s\) old/.test(p))]);

  // Ninth round: a commit that is PRESENT but does not RESOLVE.
  const green = [{ ...res("r1", [{ operation: "preflight", status: "passed" }]), provenance: { commit: "abcdef0123456789" } }];
  a = auditSimRequests([req("r1", ["preflight"])], green, () => false, false);
  checks.push(["on a FULL clone an unresolvable provenance.commit is a failure", a.problems.some((p) => p.includes("does not resolve"))]);
  a = auditSimRequests([req("r1", ["preflight"])], green, () => false, true);
  checks.push(["on a SHALLOW clone it is REPORTED, never fatal and never silent", a.problems.length === 0 && a.reported.some((p) => p.includes("does not resolve"))]);
  a = auditSimRequests([req("r1", ["preflight"])], green, () => true, false);
  checks.push(["a commit that resolves is clean (positive control)", a.problems.length === 0 && a.reported.length === 0]);
  a = auditSimRequests([req("r1", ["preflight"])], [{ ...green[0], provenance: { commit: "not-a-sha" } }], () => true, false);
  checks.push(["a provenance.commit that is not a hash is a failure even when the resolver would say yes", a.problems.some((p) => p.includes("is not a commit hash"))]);

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
  const sup = (id, runs, extra) => ({ id, __fileId: id, runs, reason: "why", requestedAt: "2026-09-01T00:00:00Z", ...extra });
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

  // Stale pending prose: the rehearsal-doc shape, in both directions.
  const passed = [res("2026-08-31-lab001-step1-real-posture", [{ operation: "preflight", status: "passed" }])];
  let sp = stalePendingProse({ "docs/x.md": "`artifacts/sim-requests/2026-08-31-lab001-step1-real-posture.json` asks the Mac\nto run the real half.\nWhen that lands, Step 1 is done for real.\n\nUnrelated paragraph, pending forever." }, passed);
  checks.push(["THE SHIPPED SHAPE: a doc paragraph naming a PASSED request three lines from 'When that lands' is a problem, and the unrelated pending paragraph is not",
    sp.length === 1 && /docs\/x\.md:1: names request 2026-08-31-lab001-step1-real-posture \(result PASSED\).*"When that lands"/.test(sp[0])]);
  sp = stalePendingProse({ "docs/x.md": "As of 2026-09-06 request 2026-08-31-lab001-step1-real-posture ran; this rehearsal preceded it and said NOT minted." }, passed);
  checks.push(["a paragraph that dates itself ('as of YYYY-MM-DD') is a record, not a stale promise", sp.length === 0]);
  sp = stalePendingProse({ "docs/x.md": "Request 2026-08-31-lab001-step1-real-posture: evidence NOT minted yet." }, [res("2026-08-31-lab001-step1-real-posture", [{ operation: "preflight", status: "failed" }])]);
  checks.push(["a request whose result did NOT pass may still be called pending", sp.length === 0]);
  sp = stalePendingProse({ "docs/x.md": "- [x] row one names 2026-08-31-lab001-step1-real-posture and is done\n- [ ] row two is not yet verified" }, passed);
  checks.push(["THE BACKLOG SHAPE: two list items with no blank line between them are two paragraphs — an id in one and 'not yet' in the next do not pair", sp.length === 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const requests = loadDir(REQ_DIR);
const results = loadDir(RES_DIR);
const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
const commitExists = (sha) => git(["cat-file", "-e", `${sha}^{commit}`]).status === 0;
const shallow = git(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
const { problems, pending, superseded, reported } = auditSimRequests(requests, results, commitExists, shallow);
{
  // Every tracked markdown document, scope derived from git — never a hand list.
  const docFiles = git(["ls-files", "--", "*.md", "**/*.md"]).stdout.split("\n").filter(Boolean);
  const docs = Object.fromEntries(docFiles.map((f) => [f, readFileSync(join(repo, f), "utf8")]));
  for (const p of stalePendingProse(docs, results)) problems.push(p);
}

console.log(`Simulation request loop — ${requests.length} request(s), ${results.length} result(s)`);
const greenRuns = results.flatMap((r) => (r.runs ?? []).filter((x) => GREEN_STATUSES.includes(x.status)));
console.log(`  operations that actually ran clean: ${greenRuns.length}`);

if (reported.length > 0) {
  console.log(`\n  REPORTED — provenance this checkout cannot vouch for (never silent, never green):`);
  if (shallow && reported.length > 3) {
    // A depth-1 CI checkout cannot resolve ANY historical commit, so every result
    // lands here; one line with the ids says the same thing as sixteen.
    const ids = reported.map((l) => l.match(/^result ([^:]+):/)?.[1] ?? "?");
    console.log(`    · ${reported.length} result(s) name commits this SHALLOW clone cannot resolve (a full clone would gate them): ${ids.join(", ")}`);
  } else {
    for (const line of reported) console.log(`    · ${line}`);
  }
}

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
