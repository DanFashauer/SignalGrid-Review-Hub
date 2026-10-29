#!/usr/bin/env node
// estate-queue.mjs — the local brain's estate consumer: read every open PR, give each
// ONE next action, and carry out only the two actions that cannot lose work.
//
//   node scripts/mac/estate-queue.mjs plan [--json]          # read-only; the queue
//   node scripts/mac/estate-queue.mjs execute [--max N] [--cursor-file F]
//                                                            # act on at most N safe items (default 3),
//                                                            # starting after the PR number kept in F
//   node scripts/mac/estate-queue.mjs --self-test
//
// WHY THIS EXISTS. The owner's cleanup directive (2026-10-23, restated 2026-10-29 on
// #1546) gave the Mac brain the estate: 73 open PRs, 7 issues, ~250 branches. The
// estate plan (docs/agent/ESTATE_PLAN_20261023.md) MEASURED it once; nothing CONSUMED
// it, so the queue was displayed and never worked. This script is the consumer the
// lane tick runs (scripts/mac/lane-tick.sh, at most hourly).
//
// ACTIONS, one per PR, decided by classify() — a pure function, fail-closed:
//   keep        the standing mailbox (#439) or a PR labelled `standing`; never touched
//   unknown     a field could not be read; NO action (an unread state never acts)
//   superseded  every commit on the head is already on SignalGrid_Alpha → EXECUTED:
//               one comment saying so, then the PR is closed (the branch is kept;
//               deletion is branch-prune.yml's job, not this script's)
//   refresh     behind mainline, no conflict, not a bot's PR → EXECUTED: GitHub's
//               update-branch (a merge of mainline, never a rebase), pinned to the
//               head sha this run read
//   fix         conflicted, or a required check failed → the builder's queue
//   land-ready  clean, gating check green on the head, no open thread, not draft, and
//               no DECISION_PATH/OWNER_RESERVED file → a lane lands it under DR-037
//               (preflight + breadth on the head first). This script NEVER merges.
//   owner       touches DECISION_PATH or OWNER_RESERVED, or a dependency bump → owner
//   wait        checks still running, or a draft
//   stale       behind mainline with no real commit in STALE_DAYS; reported, not refreshed
//
// Every executed action re-reads the PR first and acts only if the head sha and the
// action are unchanged. Requires an authenticated `gh` (REST only, like gh-pr.mjs).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { classifyDiff } from "../check-owner-gated-surfaces.mjs";

const REPO = process.env.SIGNALGRID_REPO ?? "DanFashauer/SignalGrid-Review-Hub";
const BASE = "SignalGrid_Alpha";
const GATING = "Typecheck, build, and proof scaffold";
const KEEP_NUMBERS = new Set([439]);
const BOTS = new Set(["dependabot[bot]", "renovate[bot]"]);
const EXECUTABLE = new Set(["superseded", "refresh"]);
/** Surfaces a lane never self-merges (landing-under-dr-037, condition 5; the forward-build
 *  routine's NEVER list) beyond classifyDiff's two owner-gated categories. */
// Matched by NAME anywhere in the path, not by a retyped file list, so a gate's ceiling
// file or proof (docs/agent/launch-claims-*-ceiling.json, scripts/src/launch-profile-proof.ts)
// cannot read autonomous just because nobody added it here. Over-matching only escalates.
const NEVER_LAND = [
  /(^|\/)DECISION_RECORDS\.md$/,
  /launch[-_]?(claims|profile)/i,
  /publication[-_]?boundary/i,
  /(^|\/)ratchet-read\.mjs$/,
];
/** A behind PR untouched this long is left alone: refreshing an abandoned branch every
 *  hour spends CI and never makes it landable. */
const STALE_DAYS = 14;

/** One PR's facts → one action. Any missing fact is `unknown`, which never acts. */
export function classify(pr) {
  if (!pr || !Number.isSafeInteger(pr.number)) return { action: "unknown", why: "no PR number" };
  if (KEEP_NUMBERS.has(pr.number) || (pr.labels ?? []).includes("standing")) {
    return { action: "keep", why: "standing PR" };
  }
  const need = ["user", "headSha", "mergeableState", "compareStatus", "gating", "unresolvedThreads", "files"];
  const missing = need.filter((k) => pr[k] === undefined || pr[k] === null);
  if (missing.length) return { action: "unknown", why: `unread: ${missing.join(", ")}` };
  if (!/^[0-9a-f]{40}$/.test(pr.headSha)) return { action: "unknown", why: "head sha not a full sha" };

  if (pr.compareStatus === "identical" || pr.compareStatus === "behind") {
    return { action: "superseded", why: `head ${pr.headSha.slice(0, 8)} is already on ${BASE}` };
  }
  if (pr.compareStatus !== "ahead" && pr.compareStatus !== "diverged") {
    return { action: "unknown", why: `compare status ${pr.compareStatus}` };
  }
  if (BOTS.has(pr.user)) return { action: "owner", why: "dependency bump (dependabot queue is the owner's)" };
  if (!Number.isFinite(pr.ageDays)) return { action: "unknown", why: "unread: ageDays" };

  const cats = new Set(classifyDiff(pr.files).matched.map((m) => m.category));
  const reserved = pr.files.filter((f) => NEVER_LAND.some((re) => re.test(String(f).replace(/^\.\//, ""))));
  if (reserved.length) cats.add("OWNER_RESERVED");
  const ownerGated = cats.has("DECISION_PATH") || cats.has("OWNER_RESERVED");

  switch (pr.mergeableState) {
    case "dirty":
      return { action: "fix", why: "conflicts with mainline" };
    case "unknown":
      return { action: "unknown", why: "GitHub has not computed mergeability" };
    default:
      break;
  }
  if (pr.gating === "failure") return { action: "fix", why: "gating check failed on the head" };
  // Refresh only after draft and a failed gate are ruled out: a draft may be a branch
  // another lane is still pushing to, and a merge commit under it makes that push
  // non-fast-forward (force-push is forbidden).
  if (pr.mergeableState === "behind") {
    if (pr.draft) return { action: "wait", why: "draft (behind mainline; not refreshed)" };
    if (pr.ageDays > STALE_DAYS) return { action: "stale", why: `behind mainline and idle ${Math.floor(pr.ageDays)} days; not refreshed` };
    return { action: "refresh", why: "behind mainline, no conflict" };
  }
  if (pr.gating !== "success") return { action: "wait", why: `gating check ${pr.gating}` };
  if (pr.draft) return { action: "wait", why: "draft" };
  if (pr.unresolvedThreads > 0) return { action: "fix", why: `${pr.unresolvedThreads} unresolved thread(s)` };
  if (ownerGated) return { action: "owner", why: `touches ${[...cats].filter((c) => c !== "SAFETY_MACHINERY").join("+")}` };
  if (pr.mergeableState !== "clean") return { action: "fix", why: `mergeable state ${pr.mergeableState}` };
  return { action: "land-ready", why: cats.has("SAFETY_MACHINERY") ? "SAFETY_MACHINERY, all gates green" : "autonomous, all gates green" };
}

// ── forge reads (REST through gh) ────────────────────────────────────────────
function gh(args, input) {
  const r = spawnSync("gh", ["api", ...args], { encoding: "utf8", input, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`gh api ${args.join(" ")}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const tryGh = (args) => { try { return gh(args); } catch { return null; } };

function gatingOf(sha) {
  const runs = tryGh([`repos/${REPO}/commits/${sha}/check-runs?per_page=100`]);
  if (!runs || !Array.isArray(runs.check_runs)) return null;
  // A second page could hold a failing gating run; an unread page is an unread fact.
  if (runs.total_count > runs.check_runs.length) return null;
  const mine = runs.check_runs.filter((c) => c.name === GATING);
  if (!mine.length) return "missing";
  if (mine.some((c) => c.status !== "completed")) return "pending";
  return mine.every((c) => c.conclusion === "success") ? "success" : "failure";
}

function unresolvedOf(number) {
  const t = tryGh([`repos/${REPO}/pulls/${number}/ccr/review_threads`]);
  // The cloud proxy's route names the field `resolved`; a thread with none of the three
  // readings counts as unresolved (fail-closed).
  if (Array.isArray(t)) return t.filter((x) => (x.resolved ?? x.isResolved ?? x.is_resolved) !== true).length;
  // Outside the cloud proxy there is no ccr route; GraphQL is the only exact source.
  const q = `query{repository(owner:"${REPO.split("/")[0]}",name:"${REPO.split("/")[1]}"){pullRequest(number:${number}){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}}}}`;
  const g = tryGh(["graphql", "-f", `query=${q}`]);
  const rt = g?.data?.repository?.pullRequest?.reviewThreads;
  if (!rt || rt.pageInfo?.hasNextPage !== false || !Array.isArray(rt.nodes)) return null;
  return rt.nodes.filter((n) => !n.isResolved).length;
}

/** Days since the newest NON-merge commit unique to the head. A refresh (a merge of
 *  mainline) is not work, so refreshing never makes an abandoned branch look active. */
function workAgeDays(cmp) {
  if (!Array.isArray(cmp?.commits) || cmp.commits.length === 0) return null;
  if (Number.isSafeInteger(cmp.total_commits) && cmp.total_commits > cmp.commits.length) return null;
  const dates = cmp.commits
    .filter((c) => Array.isArray(c.parents) && c.parents.length < 2)
    .map((c) => Date.parse(c.commit?.committer?.date ?? ""))
    .filter(Number.isFinite);
  return dates.length ? (Date.now() - Math.max(...dates)) / 86400000 : null;
}

export function readPr(number) {
  const p = tryGh([`repos/${REPO}/pulls/${number}`]);
  if (!p || p.state !== "open") return { number, state: p?.state ?? null };
  const cmp = tryGh([`repos/${REPO}/compare/${BASE}...${p.head.sha}`]);
  const files = tryGh([`repos/${REPO}/pulls/${number}/files?per_page=100`]);
  return {
    number,
    state: "open",
    title: p.title,
    user: p.user?.login ?? null,
    draft: p.draft === true,
    labels: (p.labels ?? []).map((l) => l.name),
    headRef: p.head.ref,
    headSha: p.head.sha,
    mergeableState: p.mergeable_state ?? null,
    compareStatus: cmp?.status ?? null,
    gating: gatingOf(p.head.sha),
    unresolvedThreads: unresolvedOf(number),
    ageDays: workAgeDays(cmp),
    // 100 files is the page; a PR with more is judged on the first page plus a sentinel
    // that classifyDiff treats as owner-gated, so a long diff can never read autonomous.
    // A rename is judged on BOTH paths: moving an owner-gated file away is touching it.
    files: Array.isArray(files)
      ? [...files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)), ...(files.length >= 100 ? ["docs/DECISION_RECORDS.md"] : [])]
      : null,
  };
}

export function plan() {
  const open = gh([`repos/${REPO}/pulls?state=open&per_page=100&base=${BASE}`]);
  if (!Array.isArray(open) || open.length >= 100) throw new Error("open-PR list missing or at the 100 page cap; refusing a partial queue");
  return open
    .map((p) => p.number)
    .sort((a, b) => a - b)
    .map((n) => { const pr = readPr(n); return { ...pr, ...classify(pr) }; });
}

/** The forge, as the executor sees it. Injectable so the self-test can lose responses
 *  and move heads mid-action without touching GitHub. */
export const ghForge = {
  readPr,
  comments: (n) => {
    const c = tryGh([`repos/${REPO}/issues/${n}/comments?per_page=100`]);
    // A full page may hide an older marker; an unread page is an unread fact.
    return Array.isArray(c) && c.length < 100 ? c.map((x) => String(x.body ?? "")) : null;
  },
  comment: (n, body) => gh([`repos/${REPO}/issues/${n}/comments`, "-X", "POST", "--input", "-"], JSON.stringify({ body })),
  close: (n) => gh([`repos/${REPO}/pulls/${n}`, "-X", "PATCH", "-f", "state=closed"]),
  reopen: (n) => gh([`repos/${REPO}/pulls/${n}`, "-X", "PATCH", "-f", "state=open"]),
  updateBranch: (n, sha) => gh([`repos/${REPO}/pulls/${n}/update-branch`, "-X", "PUT", "-f", `expected_head_sha=${sha}`]),
  contained: (sha) => {
    const c = tryGh([`repos/${REPO}/compare/${BASE}...${sha}`]);
    return c?.status === "identical" || c?.status === "behind" ? true : c ? false : null;
  },
};

/** The durable attempt record. It lives ON the PR (a comment), not on this machine, so a
 *  lost local state, a restart or a second Mac cannot make the same mutation look new. */
export const attemptMarker = (action, sha) => `<!-- estate-queue:attempt action=${action} head=${sha} -->`;

/**
 * One item. Returns { number, attempted, done, why|did, failed? }. `attempted` is true from
 * the moment a write MAY have reached GitHub (the marker included), and it is what the
 * budget counts; a lost response is an attempt, never a free retry.
 */
export function act(item, forge = ghForge) {
  const base = { number: item.number, attempted: false, done: false };
  const fresh = forge.readPr(item.number);
  const now = classify(fresh);
  if (fresh.headSha !== item.headSha || now.action !== item.action) {
    return { ...base, why: `changed since the plan (now ${now.action})` };
  }
  const marker = attemptMarker(item.action, item.headSha);
  const bodies = forge.comments(item.number);
  if (!Array.isArray(bodies)) return { ...base, why: "could not read the PR's comments; not acting" };
  if (bodies.some((b) => b.includes(marker))) {
    return { ...base, why: "already attempted at this head; read-only until the head moves" };
  }
  const text = item.action === "superseded"
    ? `The local brain's estate queue (scripts/mac/estate-queue.mjs) is closing this PR: every commit on its head as read, \`${item.headSha}\`, is already on \`${BASE}\`. The branch is kept (branch pruning is branch-prune.yml's job). If new commits arrive the PR is reopened.`
    : `The local brain's estate queue (scripts/mac/estate-queue.mjs) is merging \`${BASE}\` into this branch (head as read: \`${item.headSha}\`), because it was behind with no conflict. A merge, never a rebase.`;
  try { forge.comment(item.number, `${marker}\n${text}`); } catch (e) {
    // The marker may or may not exist now. No mutation is sent this run either way.
    return { ...base, attempted: true, why: `attempt record uncertain (${String(e.message ?? e).slice(0, 80)}); no write sent` };
  }
  const uncertain = (e) => ({ ...base, attempted: true, why: `write outcome uncertain (${String(e.message ?? e).slice(0, 80)}); recorded, read-only at this head` });
  if (item.action === "refresh") {
    try { forge.updateBranch(item.number, item.headSha); } catch (e) { return uncertain(e); }
    return { ...base, attempted: true, done: true, did: "merged mainline into the branch" };
  }
  if (item.action === "superseded") {
    try { forge.close(item.number); } catch (e) { return uncertain(e); }
    // The close is not conditional on the head, so read it back: a push that landed between
    // the read and the close must not stay closed as "superseded".
    const after = forge.readPr(item.number);
    if (after?.headSha === item.headSha) return { ...base, attempted: true, done: true, did: "closed (superseded)" };
    if (after?.headSha && forge.contained(after.headSha) === true) {
      return { ...base, attempted: true, done: true, did: `closed (superseded; head moved to ${after.headSha.slice(0, 8)}, also on ${BASE})` };
    }
    try { forge.reopen(item.number); } catch (e) {
      return { ...base, attempted: true, failed: true, why: `head moved during the close and the REOPEN FAILED (${String(e.message ?? e).slice(0, 80)}): a person must reopen #${item.number}` };
    }
    return { ...base, attempted: true, why: "head moved during the close; reopened" };
  }
  return { ...base, why: `${item.action} is not executable here` };
}

/** Executable items in rotation order: numbers after `after` first, then wrap. Without
 *  this the lowest-numbered few take the whole budget every run while mainline keeps
 *  moving, and the rest of the estate never gets a turn. */
export function rotate(items, after) {
  const ex = items.filter((i) => EXECUTABLE.has(i.action)).sort((a, b) => a.number - b.number);
  if (!Number.isSafeInteger(after)) return ex;
  return [...ex.filter((i) => i.number > after), ...ex.filter((i) => i.number <= after)];
}

export function execute(items, max, after = null, forge = ghForge) {
  const out = [];
  for (const item of rotate(items, after)) {
    // The budget is ATTEMPTS, not successes: a write whose response was lost still spent it.
    if (out.filter((o) => o.attempted).length >= max) break;
    try { out.push(act(item, forge)); } catch (e) {
      // An unexpected throw cannot prove nothing was sent; count it as an attempt.
      out.push({ number: item.number, attempted: true, done: false, failed: true, why: String(e.message ?? e) });
    }
  }
  return out;
}

export function summarize(items, done = []) {
  const count = {};
  for (const i of items) count[i.action] = (count[i.action] ?? 0) + 1;
  const parts = Object.keys(count).sort().map((k) => `${k}=${count[k]}`);
  const acted = done.filter((d) => d.done).length;
  const tried = done.filter((d) => d.attempted).length;
  return `estate: ${items.length} open (${parts.join(" ")})${done.length ? `; acted ${acted}, attempted ${tried}, considered ${done.length}` : ""}`;
}

// ── self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  const sha = "a".repeat(40);
  const base = { number: 7, user: "DanFashauer", headSha: sha, mergeableState: "clean", compareStatus: "ahead",
    gating: "success", unresolvedThreads: 0, files: ["docs/agent/NOTE.md"], draft: false, labels: [], ageDays: 1 };
  const cases = [
    [{ ...base }, "land-ready"],
    [{ ...base, number: 439 }, "keep"],
    [{ ...base, labels: ["standing"] }, "keep"],
    [{ ...base, gating: null }, "unknown"],
    [{ ...base, unresolvedThreads: null }, "unknown"],
    [{ ...base, files: null }, "unknown"],
    [{ ...base, headSha: "abc" }, "unknown"],
    [{ ...base, compareStatus: "weird" }, "unknown"],
    [{ ...base, compareStatus: "behind", mergeableState: "dirty" }, "superseded"],
    [{ ...base, compareStatus: "identical" }, "superseded"],
    [{ ...base, mergeableState: "dirty" }, "fix"],
    [{ ...base, mergeableState: "behind" }, "refresh"],
    [{ ...base, mergeableState: "behind", user: "dependabot[bot]" }, "owner"],
    [{ ...base, mergeableState: "unknown" }, "unknown"],
    [{ ...base, gating: "failure" }, "fix"],
    [{ ...base, gating: "pending" }, "wait"],
    [{ ...base, gating: "missing" }, "wait"],
    [{ ...base, draft: true }, "wait"],
    [{ ...base, unresolvedThreads: 2 }, "fix"],
    [{ ...base, files: ["lib/signalgrid-core/src/policy.ts"] }, "owner"],
    [{ ...base, files: ["docs/DECISION_RECORDS.md"] }, "owner"],
    [{ ...base, files: ["scripts/x.mjs"] }, "land-ready"],
    [{ ...base, files: ["scripts/check-launch-claims.mjs"] }, "owner"],
    [{ ...base, files: ["./docs/PUBLICATION_BOUNDARY.md"] }, "owner"],
    [{ ...base, files: ["docs/agent/launch-claims-docs-ceiling.json"] }, "owner"],
    [{ ...base, files: ["docs/agent/launch-claims-retired-labels-ceiling.json"] }, "owner"],
    [{ ...base, files: ["scripts/src/launch-profile-proof.ts"] }, "owner"],
    [{ ...base, files: ["scripts/lib/ratchet-read.mjs"] }, "owner"],
    [{ ...base, files: ["docs/archive/LP.md", "docs/LAUNCH_PROFILE.md"] }, "owner"],
    [{ ...base, files: ["tools/engine.ts", "lib/signalgrid-core/src/engine.ts"] }, "owner"],
    [{ ...base, mergeableState: "behind", draft: true }, "wait"],
    [{ ...base, mergeableState: "behind", gating: "failure" }, "fix"],
    [{ ...base, mergeableState: "behind", ageDays: 30 }, "stale"],
    [{ ...base, ageDays: null }, "unknown"],
    [{ ...base, mergeableState: "blocked" }, "fix"],
    [{ ...base, mergeableState: "unstable" }, "fix"],
    [null, "unknown"],
  ];
  let pass = 0;
  for (const [pr, want] of cases) {
    const got = classify(pr).action;
    if (got === want) pass++;
    else console.error(`FAIL #${pr?.number}: ${JSON.stringify(pr && { ...pr, files: pr.files })} → ${got}, want ${want}`);
  }
  // Only the two loss-free actions are executable, and execute() never acts on anything else.
  const ex = execute([{ number: 1, action: "land-ready" }, { number: 2, action: "owner" }, { number: 3, action: "fix" }], 3);
  const okEx = ex.length === 0;
  if (!okEx) console.error(`FAIL execute acted on a non-executable action: ${JSON.stringify(ex)}`);
  const q = [5, 9, 2, 7].map((number) => ({ number, action: "refresh" })).concat([{ number: 4, action: "fix" }]);
  const order = (after) => rotate(q, after).map((i) => i.number).join(",");
  const rot = [[null, "2,5,7,9"], [5, "7,9,2,5"], [9, "2,5,7,9"], [1, "2,5,7,9"]];
  let okRot = 0;
  for (const [after, want] of rot) {
    if (order(after) === want) okRot++;
    else console.error(`FAIL rotate after ${after}: ${order(after)}, want ${want}`);
  }
  // Fake forge: comments persist across runs (they are the durable attempt record), and any
  // write can be made to "succeed but lose its response".
  const fsha = (n) => String(n).padStart(40, "c");
  const mkForge = (opts = {}) => {
    const st = { calls: { comment: 0, update: 0, close: 0, reopen: 0 }, comments: {}, heads: {} };
    const pr = (n) => ({ ...base, number: n, headSha: st.heads[n] ?? fsha(n), mergeableState: opts.state ?? "behind",
      compareStatus: opts.compare ?? "ahead" });
    st.forge = {
      readPr: (n) => { const p = pr(n); if (opts.moveAfterClose && st.calls.close) p.headSha = "d".repeat(40); return p; },
      comments: (n) => opts.commentsUnreadable ? null : [...(st.comments[n] ?? [])],
      comment: (n, b) => { st.calls.comment++; if (opts.markerLost) throw new Error("socket hang up"); (st.comments[n] ??= []).push(b); },
      updateBranch: () => { st.calls.update++; if (opts.lose) throw new Error("timeout"); },
      close: () => { st.calls.close++; if (opts.lose) throw new Error("timeout"); },
      reopen: () => { st.calls.reopen++; if (opts.reopenFails) throw new Error("502"); },
      contained: () => opts.movedContained ?? false,
    };
    return st;
  };
  const items7 = [11, 12, 13, 14, 15, 16, 17].map((n) => ({ number: n, action: "refresh", headSha: fsha(n) }));
  const fx = [];
  const check = (name, ok) => { fx.push(ok); if (!ok) console.error(`FAIL forge: ${name}`); };
  {
    const st = mkForge({ lose: true });
    const r1 = execute(items7, 3, null, st.forge);
    check("lost responses still spend the budget (3 writes, not 7)", st.calls.update === 3 && r1.filter((d) => d.attempted).length === 3);
    execute(items7, 3, null, st.forge);
    check("a re-run at the same heads never resends to the first three", st.calls.update === 6 &&
      Object.keys(st.comments).length === 6);
    const r3 = execute(items7.slice(0, 3), 3, null, st.forge);
    check("an attempted head is read-only on every later run", st.calls.update === 6 && r3.every((d) => !d.attempted));
  }
  {
    const st = mkForge({ markerLost: true });
    const r = execute(items7, 3, null, st.forge);
    check("a lost attempt record sends no write and still spends the budget", st.calls.update === 0 && r.filter((d) => d.attempted).length === 3);
  }
  {
    const st = mkForge({ commentsUnreadable: true });
    const r = execute(items7, 3, null, st.forge);
    check("unreadable comments: no write, nothing attempted", st.calls.update === 0 && st.calls.comment === 0 && r.every((d) => !d.attempted));
  }
  const sup = [{ number: 21, action: "superseded", headSha: fsha(21) }];
  {
    const st = mkForge({ compare: "behind", state: "clean", moveAfterClose: true });
    const [d] = execute(sup, 3, null, st.forge);
    check("a head that moved to uncontained work during the close is reopened, not counted done", st.calls.reopen === 1 && !d.done && d.attempted);
  }
  {
    const st = mkForge({ compare: "behind", state: "clean", moveAfterClose: true, movedContained: true });
    const [d] = execute(sup, 3, null, st.forge);
    check("a head that moved to already-merged work stays closed", st.calls.reopen === 0 && d.done);
  }
  {
    const st = mkForge({ compare: "behind", state: "clean", moveAfterClose: true, reopenFails: true });
    const [d] = execute(sup, 3, null, st.forge);
    check("a failed reopen is a loud failure", d.failed === true && !d.done);
  }
  {
    const st = mkForge({ compare: "behind", state: "clean" });
    const [d] = execute(sup, 3, null, st.forge);
    check("a clean close is done, with its record written first", d.done && st.calls.comment === 1 && st.calls.close === 1);
  }
  const okFx = fx.filter(Boolean).length;
  const total = cases.length + 1 + rot.length + fx.length;
  const got = pass + (okEx ? 1 : 0) + okRot + okFx;
  console.log(`estate-queue self-test: ${got}/${total} passed`);
  return got === total;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function main(argv) {
  if (argv.includes("--self-test")) return selfTest() ? 0 : 1;
  const cmd = argv[0] ?? "plan";
  const maxIdx = argv.indexOf("--max");
  const max = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : 3;
  if (!Number.isSafeInteger(max) || max < 0) { console.error("--max must be a non-negative integer"); return 2; }
  let items;
  try { items = plan(); } catch (e) { console.error(`estate: could not read open PRs: ${e.message}`); return 1; }
  if (cmd === "plan") {
    if (argv.includes("--json")) {
      // stdout stays one JSON document; the summary goes to stderr.
      console.log(JSON.stringify(items, null, 2));
      console.error(summarize(items));
    } else {
      for (const i of items) console.log(`#${i.number}\t${i.action}\t${i.why}\t${i.headRef ?? ""}`);
      console.log(summarize(items));
    }
    return 0;
  }
  if (cmd === "execute") {
    // --cursor-file <path>: where the last acted PR number is kept between runs, so the
    // next run starts after it. Unreadable or absent → start from the lowest number.
    const cIdx = argv.indexOf("--cursor-file");
    const cursorFile = cIdx >= 0 ? argv[cIdx + 1] : null;
    let after = null;
    if (cursorFile) { try { const n = Number(readFileSync(cursorFile, "utf8").trim()); if (Number.isSafeInteger(n)) after = n; } catch {} }
    const done = execute(items, max, after);
    const last = done.filter((d) => d.attempted).at(-1);
    if (cursorFile && last) { try { writeFileSync(cursorFile, `${last.number}\n`); } catch (e) { console.error(`WARN could not write ${cursorFile}: ${e.message}`); } }
    for (const d of done) console.log(`#${d.number}\t${d.done ? d.did : `skipped: ${d.why}`}`);
    console.log(summarize(items, done));
    // Failure = a write that may have gone out without a confirmed outcome, or a reopen that
    // failed. A skip (changed, already attempted, unreadable comments) is not a failure.
    return done.some((d) => d.failed || (d.attempted && !d.done)) ? 1 : 0;
  }
  console.error(`unknown command ${cmd}; use plan | execute | --self-test`);
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
