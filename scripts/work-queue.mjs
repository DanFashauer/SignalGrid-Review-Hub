#!/usr/bin/env node
// work-queue.mjs — ONE queue every lane claims from, so no two lanes build the same task.
//
//   node scripts/work-queue.mjs list [--json]
//   node scripts/work-queue.mjs claim --lane <lane> [--task <id>] [--model <m>] [--lease-min N]
//   node scripts/work-queue.mjs update --lane <lane> --task <id> --state <state> [--pr N] [--model <m>]
//   node scripts/work-queue.mjs --self-test
//
// WHY THIS EXISTS. The owner's /goal (2026-10-29): "the second brain [should have] a
// queue system to hand off instead of everyone trying [to] do the same tasks at once".
// Before this, each lane claimed work its own way — a `mac/build-row-*` branch, an HTML
// marker in an issue comment, `job-state.mjs` inside one Mac process — and none of them
// was atomic ACROSS machines. Two lanes could, and did, read "unclaimed" at once.
// Proposal and division of work: issue #1546 (cloud lane builds this file; the Mac brain
// and Codex wire their builders to claim/update through it).
//
// THE CLAIM is a git ref `refs/queue/claims/<task-id>` on the Hub, the one place every
// lane (Mac brain, Codex, cloud Claude) can reach:
//   - creating it is atomic: the second creator gets HTTP 422 and moves on;
//   - every change (renew, hand off, record a review, finish) is a NEW commit whose
//     parent is the current tip, written with a fast-forward-only update — a
//     compare-and-swap: a lane that lost the race fails and never overwrites;
//   - nothing is ever deleted; a finished claim stays as the record.
// Claim refs live outside refs/heads, so the branch estate the owner is pruning does not
// grow. The commit message carries the state as one JSON line; the commit's tree is the
// mainline tree it was claimed against (no file content of its own).
//
// LIFECYCLE (the owner's flow): queued → claimed → built → pr → review-codex and
// review-claude (independent, each in its own system) → merged → done. Only the holder
// lane moves a claim, except that `codex` may record review-codex and `cloud-claude`
// review-claude on any claim. `released` hands a task back to the queue.
//
// FAIL-CLOSED: claims that cannot be read refuse every claim (an unread claim might be
// someone else's); a malformed claim body is treated as held, never as free.
//
// PRIVACY: a task carries an id, a kind, public repo paths and a source. Nothing from
// the private Obsidian vault is ever written here; the vault feeds the LOCAL builder only.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = process.env.SIGNALGRID_REPO ?? "DanFashauer/SignalGrid-Review-Hub";
const BASE = "SignalGrid_Alpha";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLAIM_PREFIX = "queue/claims/";
export const LANES = new Set(["mac-brain", "codex", "cloud-claude", "owner"]);
export const STATES = new Set(["claimed", "built", "pr", "review-codex", "review-claude", "merged", "done", "released"]);
const FINAL = new Set(["merged", "done"]);
const REVIEWER = { "review-codex": "codex", "review-claude": "cloud-claude" };
const DEFAULT_LEASE_MIN = 120;

/** A task id as a ref-safe name. Two different ids must never map to one ref. */
export function refName(taskId) {
  // ":" maps to "--", so an id that already holds "--" could collide with another; refuse it.
  if (typeof taskId !== "string" || !/^[a-z][a-z0-9-]*:[A-Za-z0-9._:-]+$/.test(taskId) || taskId.length > 200 || taskId.includes("--")) {
    throw new TypeError(`invalid task id: ${JSON.stringify(taskId)}`);
  }
  return CLAIM_PREFIX + taskId.replace(/:/g, "--");
}

export function parseClaim(message) {
  try {
    const c = JSON.parse(String(message).split("\n")[0]);
    if (c?.v !== 1 || !LANES.has(c.lane) || !STATES.has(c.state) || typeof c.task !== "string") return null;
    return c;
  } catch { return null; }
}

// ── tasks: derived from what the repo already measures ──────────────────────
export function tasksFromHands(hands) {
  const out = [];
  for (const h of hands) {
    if (h?.status !== "open" || typeof h.id !== "string") continue;
    const who = String(h.whoCanUnblock ?? "");
    // Owner-only hands are not lane work; they are listed for the owner elsewhere.
    if (/^owner$/i.test(who)) continue;
    out.push({ id: `hand:${h.id}`, kind: "raised-hand", priority: 60, scope: [], source: `artifacts/raised-hands/${h.id}.json`, title: String(h.doing ?? "").slice(0, 120), suggestedLane: /mac/i.test(who) ? "mac-brain" : /cloud/i.test(who) ? "cloud-claude" : null });
  }
  return out;
}

export function tasksFromEstate(items) {
  const pri = { fix: 50, refresh: 30, superseded: 20, "land-ready": 70 };
  return items
    .filter((i) => i.action in pri && Number.isSafeInteger(i.number) && /^[0-9a-f]{40}$/.test(i.headSha ?? ""))
    .map((i) => ({ id: `pr:${i.number}:${i.action}:${i.headSha.slice(0, 12)}`, kind: `pr-${i.action}`, priority: pri[i.action], scope: [], source: `PR #${i.number}`, title: String(i.title ?? i.why ?? "").slice(0, 120), suggestedLane: i.action === "land-ready" ? "cloud-claude" : "mac-brain" }));
}

export function orderTasks(tasks) {
  const seen = new Set();
  return tasks.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function loadHands() {
  const dir = join(ROOT, "artifacts", "raised-hands");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; }
  }).filter(Boolean);
}

async function loadTasks() {
  const tasks = tasksFromHands(loadHands());
  const estate = join(ROOT, "scripts", "mac", "estate-queue.mjs");
  if (existsSync(estate)) {
    try { const m = await import(pathToFileURL(estate).href); tasks.push(...tasksFromEstate(m.plan())); }
    catch (e) { console.error(`work-queue: estate source skipped (${String(e.message ?? e).slice(0, 120)})`); }
  }
  return orderTasks(tasks);
}

// ── the forge (REST through gh), injectable for the self-test ────────────────
function gh(args, input) {
  const r = spawnSync("gh", ["api", ...args], { encoding: "utf8", input, maxBuffer: 64 << 20 });
  if (r.status !== 0) {
    const e = new Error(`gh api ${args[0]}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    e.status = /HTTP (\d{3})/.exec(r.stderr ?? "")?.[1] ? Number(/HTTP (\d{3})/.exec(r.stderr)[1]) : null;
    throw e;
  }
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

export const ghForge = {
  mainline: () => {
    const c = gh([`repos/${REPO}/commits/${BASE}`]);
    return { sha: c.sha, tree: c.commit.tree.sha };
  },
  /** Every claim as {name, sha, message}; null if any part cannot be read. */
  claims: () => {
    let refs;
    // No trailing slash: the session proxy refuses it ("could not be canonicalized"), and the
    // prefix match is narrowed to the exact namespace below instead.
    try { refs = gh([`repos/${REPO}/git/matching-refs/${CLAIM_PREFIX.replace(/\/$/, "")}`]); } catch { return null; }
    if (!Array.isArray(refs)) return null;
    refs = refs.filter((r) => typeof r?.ref === "string" && r.ref.startsWith(`refs/${CLAIM_PREFIX}`));
    const out = [];
    for (const r of refs) {
      try { out.push({ name: r.ref.replace(/^refs\//, ""), sha: r.object.sha, message: gh([`repos/${REPO}/git/commits/${r.object.sha}`]).message }); }
      catch { return null; }
    }
    return out;
  },
  commit: (message, tree, parent) => gh([`repos/${REPO}/git/commits`, "-X", "POST", "--input", "-"], JSON.stringify({ message, tree, parents: [parent] })).sha,
  createRef: (name, sha) => gh([`repos/${REPO}/git/refs`, "-X", "POST", "--input", "-"], JSON.stringify({ ref: `refs/${name}`, sha })),
  /** Fast-forward only: GitHub refuses a non-fast-forward when force is false. */
  fastForward: (name, sha) => gh([`repos/${REPO}/git/refs/${name}`, "-X", "PATCH", "--input", "-"], JSON.stringify({ sha, force: false })),
};

// ── the queue ────────────────────────────────────────────────────────────────
export function readQueue(tasks, forge) {
  const raw = forge.claims();
  if (raw === null) return null;
  const byName = new Map(raw.map((c) => [c.name, c]));
  return tasks.map((t) => {
    const c = byName.get(refName(t.id));
    if (!c) return { ...t, claim: null };
    const body = parseClaim(c.message);
    // A claim we cannot parse is someone's; never free.
    return { ...t, claim: body ?? { state: "unreadable", lane: null, leaseUntil: Infinity }, claimSha: c.sha };
  });
}

const isFree = (q, now) => !q.claim || q.claim.state === "released" ||
  (!FINAL.has(q.claim.state) && q.claim.state !== "unreadable" && Number.isFinite(Date.parse(q.claim.leaseUntil)) && Date.parse(q.claim.leaseUntil) <= now);

/**
 * Claim one task for `lane`. Returns { ok, task, why }. A lost race (422 on create, or a
 * refused fast-forward on takeover) moves on to the next free task; it never overwrites.
 */
export function claim({ tasks, lane, taskId = null, model = null, leaseMin = DEFAULT_LEASE_MIN, now = Date.now(), forge = ghForge }) {
  if (!LANES.has(lane)) return { ok: false, why: `unknown lane ${lane}` };
  const queue = readQueue(tasks, forge);
  if (queue === null) return { ok: false, why: "could not read the claims; not claiming (an unread claim may be someone else's)" };
  const candidates = queue.filter((q) => (taskId ? q.id === taskId : true) && isFree(q, now));
  if (!candidates.length) return { ok: false, why: taskId ? `task ${taskId} is held or unknown` : "nothing free in the queue" };
  const base = forge.mainline();
  for (const q of candidates) {
    const body = { v: 1, task: q.id, lane, model, state: "claimed", leaseUntil: new Date(now + leaseMin * 60000).toISOString(), at: new Date(now).toISOString(), pr: null };
    const name = refName(q.id);
    try {
      if (!q.claim) {
        const sha = forge.commit(JSON.stringify(body), base.tree, base.sha);
        forge.createRef(name, sha); // 422 if another lane created it first
      } else {
        const sha = forge.commit(JSON.stringify(body), base.tree, q.claimSha);
        forge.fastForward(name, sha); // refused if the claim moved since we read it
      }
      return { ok: true, task: q, claim: body };
    } catch (e) {
      continue; // lost the race for this one; try the next free task
    }
  }
  return { ok: false, why: "every free task was taken by another lane while claiming" };
}

/** Move a claim to a new state. Only its holder may, except the two independent reviews. */
export function update({ tasks, lane, taskId, state, pr = null, model = null, leaseMin = DEFAULT_LEASE_MIN, now = Date.now(), forge = ghForge }) {
  if (!LANES.has(lane) || !STATES.has(state) || state === "claimed") return { ok: false, why: "bad lane or state" };
  const queue = readQueue(tasks, forge);
  if (queue === null) return { ok: false, why: "could not read the claims" };
  const q = queue.find((x) => x.id === taskId);
  if (!q?.claim) return { ok: false, why: `task ${taskId} is not claimed` };
  if (q.claim.state === "unreadable") return { ok: false, why: "claim unreadable; not moving it" };
  if (FINAL.has(q.claim.state)) return { ok: false, why: `task ${taskId} is already ${q.claim.state}` };
  const reviewer = REVIEWER[state];
  if (reviewer ? lane !== reviewer : lane !== q.claim.lane) {
    return { ok: false, why: reviewer ? `only ${reviewer} records ${state}` : `held by ${q.claim.lane}, not ${lane}` };
  }
  const reviews = { ...(q.claim.reviews ?? {}) };
  if (reviewer) reviews[reviewer] = { at: new Date(now).toISOString(), model };
  if ((state === "merged") && !(reviews.codex && reviews["cloud-claude"])) {
    return { ok: false, why: "merged needs both independent reviews recorded (review-codex and review-claude)" };
  }
  // A review is recorded beside the state; it does not move the holder's state.
  const next = { ...q.claim, state: reviewer ? q.claim.state : state, reviews,
    pr: pr ?? q.claim.pr, at: new Date(now).toISOString(),
    leaseUntil: state === "released" ? new Date(now).toISOString() : new Date(now + leaseMin * 60000).toISOString() };
  const base = forge.mainline();
  try {
    forge.fastForward(refName(taskId), forge.commit(JSON.stringify(next), base.tree, q.claimSha));
  } catch (e) {
    return { ok: false, why: `claim moved while updating (${String(e.message ?? e).slice(0, 80)}); re-read and retry` };
  }
  return { ok: true, claim: next };
}

// ── self-test with an in-memory forge that enforces create-once and fast-forward ──
function selfTest() {
  const mk = () => {
    const commits = new Map(); const refs = new Map(); let n = 0;
    const f = {
      calls: { create: 0, ff: 0 },
      mainline: () => ({ sha: "m".repeat(40), tree: "t".repeat(40) }),
      claims: () => (f.unreadable ? null : [...refs].map(([name, sha]) => ({ name, sha, message: commits.get(sha).message }))),
      commit: (message, tree, parent) => { const sha = String(++n).padStart(40, "0"); commits.set(sha, { message, parent }); return sha; },
      createRef: (name, sha) => { f.calls.create++; if (refs.has(name)) { const e = new Error("422 Reference already exists"); e.status = 422; throw e; } refs.set(name, sha); },
      fastForward: (name, sha) => { f.calls.ff++; const cur = refs.get(name); if (commits.get(sha)?.parent !== cur) throw new Error("422 not a fast forward"); refs.set(name, sha); },
      refs, commits,
    };
    return f;
  };
  const T = orderTasks([
    { id: "pr:10:fix:aaaaaaaaaaaa", kind: "pr-fix", priority: 50, scope: [] },
    { id: "hand:x", kind: "raised-hand", priority: 60, scope: [] },
    { id: "pr:11:refresh:bbbbbbbbbbbb", kind: "pr-refresh", priority: 30, scope: [] },
  ]);
  const res = [];
  const check = (name, ok) => { res.push(ok); if (!ok) console.error(`FAIL: ${name}`); };
  const now = Date.parse("2026-10-29T20:00:00Z");
  {
    const f = mk();
    const a = claim({ tasks: T, lane: "mac-brain", now, forge: f });
    const b = claim({ tasks: T, lane: "codex", now, forge: f });
    check("two lanes never get the same task; highest priority first", a.ok && b.ok && a.task.id === "hand:x" && b.task.id === "pr:10:fix:aaaaaaaaaaaa");
  }
  {
    // A race: both lanes read the queue empty, then both create. The second gets 422.
    const f = mk();
    const stale = readQueue(T, f);
    claim({ tasks: T, lane: "mac-brain", now, forge: f });
    const realClaims = f.claims; f.claims = () => stale.filter((q) => q.claim).map(() => null).filter(Boolean); // the second lane's stale view: nothing claimed
    const b = claim({ tasks: T, lane: "codex", now, forge: f });
    f.claims = realClaims;
    check("a create race: the loser gets 422 and takes the NEXT task, not the same one", b.ok && b.task.id !== "hand:x" && f.refs.size === 2);
  }
  {
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 10, now, forge: f });
    const early = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 5 * 60000, forge: f });
    const late = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 11 * 60000, forge: f });
    check("an unexpired lease holds; an expired one is taken over by fast-forward", !early.ok && late.ok);
  }
  {
    // Two takeovers from the same read: the second is not a fast-forward and fails.
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 1, now, forge: f });
    const later = now + 2 * 60000;
    const stale = readQueue(T, f);
    claim({ tasks: T, lane: "codex", taskId: "hand:x", now: later, forge: f });
    const realClaims = f.claims; f.claims = () => stale.filter((q) => q.claim).map((q) => ({ name: refName(q.id), sha: q.claimSha, message: JSON.stringify(q.claim) }));
    const second = claim({ tasks: T, lane: "cloud-claude", taskId: "hand:x", now: later, forge: f });
    f.claims = realClaims;
    check("a takeover race: the second takeover is refused (compare-and-swap), nothing overwritten", !second.ok && parseClaim(f.commits.get(f.refs.get(refName("hand:x"))).message).lane === "codex");
  }
  {
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now, forge: f });
    const intruder = update({ tasks: T, lane: "codex", taskId: "hand:x", state: "pr", pr: 5, now, forge: f });
    const own = update({ tasks: T, lane: "mac-brain", taskId: "hand:x", state: "pr", pr: 5, now, forge: f });
    const early = update({ tasks: T, lane: "mac-brain", taskId: "hand:x", state: "merged", now, forge: f });
    const rc = update({ tasks: T, lane: "codex", taskId: "hand:x", state: "review-codex", now, forge: f });
    const wrongReviewer = update({ tasks: T, lane: "mac-brain", taskId: "hand:x", state: "review-claude", now, forge: f });
    const rl = update({ tasks: T, lane: "cloud-claude", taskId: "hand:x", state: "review-claude", now, forge: f });
    const merged = update({ tasks: T, lane: "mac-brain", taskId: "hand:x", state: "merged", now, forge: f });
    const reclaim = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 999 * 60000, forge: f });
    check("only the holder moves a claim; each review only by its own system; merged needs both reviews; merged is final",
      !intruder.ok && own.ok && !early.ok && rc.ok && !wrongReviewer.ok && rl.ok && merged.ok && !reclaim.ok && merged.claim.pr === 5);
  }
  {
    const f = mk(); f.unreadable = true;
    check("unreadable claims refuse every claim", !claim({ tasks: T, lane: "mac-brain", now, forge: f }).ok && f.calls.create === 0);
  }
  {
    const f = mk();
    f.refs.set(refName("hand:x"), "garbage".padEnd(40, "0")); f.commits.set("garbage".padEnd(40, "0"), { message: "not json", parent: null });
    const c = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 1e9, forge: f });
    check("a malformed claim body is held, never free", !c.ok);
  }
  {
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now, forge: f });
    const rel = update({ tasks: T, lane: "mac-brain", taskId: "hand:x", state: "released", now, forge: f });
    const again = claim({ tasks: T, lane: "codex", taskId: "hand:x", now, forge: f });
    check("released hands the task back to the queue at once", rel.ok && again.ok);
  }
  let bad = 0;
  for (const id of ["../x", "hand:", "pr:1 2", "HAND:x", "a".repeat(250), "hand:a--b"]) { try { refName(id); } catch { bad++; } }
  check("unsafe or colliding task ids are refused", bad === 6 && refName("pr:5:fix:abc") === "queue/claims/pr--5--fix--abc");
  check("tasks from hands skip owner-only and resolved hands", tasksFromHands([
    { id: "a", status: "open", whoCanUnblock: "mac lane", doing: "x" },
    { id: "b", status: "open", whoCanUnblock: "owner" },
    { id: "c", status: "resolved", whoCanUnblock: "cloud lane" },
  ]).map((t) => `${t.id}:${t.suggestedLane}`).join() === "hand:a:mac-brain");
  const pass = res.filter(Boolean).length;
  console.log(`work-queue self-test: ${pass}/${res.length} passed`);
  return pass === res.length;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }

async function main(argv) {
  if (argv.includes("--self-test")) return selfTest() ? 0 : 1;
  const cmd = argv[0] ?? "list";
  const tasks = await loadTasks();
  if (cmd === "list") {
    const q = readQueue(tasks, ghForge);
    if (q === null) { console.error("work-queue: could not read the claims"); return 1; }
    if (argv.includes("--json")) { console.log(JSON.stringify(q, null, 2)); return 0; }
    for (const t of q) console.log(`${t.claim ? `${t.claim.state}@${t.claim.lane}` : "free"}\t${t.priority}\t${t.id}\t${t.title ?? ""}`);
    console.error(`work-queue: ${q.length} task(s), ${q.filter((t) => !t.claim).length} free`);
    return 0;
  }
  const lane = arg(argv, "--lane");
  if (cmd === "claim") {
    const r = claim({ tasks, lane, taskId: arg(argv, "--task"), model: arg(argv, "--model"), leaseMin: Number(arg(argv, "--lease-min") ?? DEFAULT_LEASE_MIN) });
    console.log(JSON.stringify(r.ok ? { ok: true, task: r.task.id, claim: r.claim } : r));
    return r.ok ? 0 : 3;
  }
  if (cmd === "update") {
    const pr = arg(argv, "--pr");
    const r = update({ tasks, lane, taskId: arg(argv, "--task"), state: arg(argv, "--state"), pr: pr ? Number(pr) : null, model: arg(argv, "--model") });
    console.log(JSON.stringify(r));
    return r.ok ? 0 : 3;
  }
  console.error("use: list | claim | update | --self-test");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2)).then((c) => process.exit(c));
