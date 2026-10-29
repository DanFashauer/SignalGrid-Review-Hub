#!/usr/bin/env node
// work-queue.mjs — ONE queue every lane claims from, so no two lanes build the same task.
//
//   node scripts/work-queue.mjs list [--json]
//   node scripts/work-queue.mjs claim  --lane <lane> [--task <id>] [--model <m>] [--lease-min N]
//                                      → prints {task, token}; keep the token, it is the holder's proof
//   node scripts/work-queue.mjs move   --lane <lane> --token <t> --task <id> --state <s> [--pr N --head <sha>]
//   node scripts/work-queue.mjs review --lane codex|cloud-claude --task <id> --pr N --head <sha>
//   node scripts/work-queue.mjs --self-test
//
// WHY THIS EXISTS. The owner's /goal (2026-10-29): "the second brain [should have] a
// queue system to hand off instead of everyone trying [to] do the same tasks at once".
// Before this, each lane claimed work its own way — a `mac/build-row-*` branch, an HTML
// marker in an issue comment, `job-state.mjs` inside one Mac process — and none of them
// was atomic ACROSS machines. Proposal and division of work: issue #1546 (the cloud lane
// builds this file; the Mac brain and Codex wire their builders to it).
//
// THE CLAIM is a git ref on the Hub, the one place every lane can reach:
//   refs/queue/claims/<hex of the task id>   (hex: reversible, always a valid ref name)
// - Creating it is atomic: the second creator gets HTTP 422 and moves on.
// - Every later change is a NEW commit whose parent is the current tip, written with a
//   fast-forward-only update: a compare-and-swap. A lane that lost the race fails and
//   never overwrites. Nothing is ever deleted. Claim refs sit outside refs/heads, so the
//   branch estate does not grow.
// - The commit message is the claim, as one JSON line. Its time is the SERVER's commit
//   date (no client clock is written). The lease runs from the holder's own last
//   claim/move commit (`leaseFrom` when a review has written on top), so a review never
//   keeps a dead holder's lease alive.
// - A PR task id is stable (pr:N:action). A `done` claim is final at its head; when the
//   same PR needs the same action at a NEW head, the task is free again and the new
//   claim fast-forwards on top of the old record.
//
// LIFECYCLE (the owner's flow), enforced as a transition table:
//   claimed → built → pr → merged → done        (any of the first three → released)
//   pr needs --pr and --head; merged needs BOTH reviews recorded against that same PR and
//   head; done only follows merged; released hands the task back to the queue.
//   A review is recorded by its own lane (codex / cloud-claude) only while the claim is at
//   `pr`, bound to {pr, head}; it changes nothing else on the claim.
//
// TRUST MODEL, stated rather than implied: lanes are processes the owner runs. `--lane`
// is self-declared. The holder TOKEN (random, only its hash is stored) proves continuity
// — that a move comes from the run that claimed — not identity. A review's "independence"
// rests on each system using its own credentials; this file records which lane said it
// reviewed which head, and refuses `merged` without both.
//
// FAIL-CLOSED: a claim that cannot be read refuses the claim; a malformed claim, or one
// whose body names a different task, is held, never free. Only a 422 counts as a lost
// race; any other forge error stops the run after re-reading what actually happened.
//
// PRIVACY: a task carries an id, a kind and a source; a claim carries lane, model, state,
// PR number and head sha. Nothing from the private Obsidian vault is ever written here.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = process.env.SIGNALGRID_REPO ?? "DanFashauer/SignalGrid-Review-Hub";
const BASE = "SignalGrid_Alpha";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLAIM_PREFIX = "queue/claims/";
export const LANES = new Set(["mac-brain", "codex", "cloud-claude", "owner"]);
const REVIEW_LANES = new Set(["codex", "cloud-claude"]);
/** Holder moves: from → allowed next states (a state to itself is a renew). */
export const TRANSITIONS = {
  claimed: ["claimed", "built", "pr", "released"],
  built: ["built", "pr", "released"],
  pr: ["pr", "merged", "released"],
  merged: ["done"],
  done: [],
  released: [],
};
const FINAL = new Set(["merged", "done"]);
export const LEASE_MIN = { min: 5, max: 720, default: 120 };
const SHA = /^[0-9a-f]{40}$/;

// ── ids ──────────────────────────────────────────────────────────────────────
// 120 characters → 240 hex: stays inside one ref path component on every filesystem.
export const validTaskId = (id) => typeof id === "string" && id.length <= 120 && /^[a-z][a-z0-9-]*:[!-~]+$/.test(id);
export const refName = (id) => {
  if (!validTaskId(id)) throw new TypeError(`invalid task id: ${JSON.stringify(id)}`);
  return CLAIM_PREFIX + Buffer.from(id, "utf8").toString("hex");
};
export const idOfRef = (name) => Buffer.from(name.slice(CLAIM_PREFIX.length), "hex").toString("utf8");
const hash = (token) => createHash("sha256").update(String(token)).digest("hex");

export function parseClaim(message, taskId) {
  try {
    const c = JSON.parse(String(message).split("\n")[0]);
    if (c?.v !== 2 || c.task !== taskId || !LANES.has(c.lane) || !Object.hasOwn(TRANSITIONS, c.state) || !/^[0-9a-f]{64}$/.test(c.holder ?? "")) return null;
    if (!Number.isFinite(c.leaseMin)) return null;
    return c;
  } catch { return null; }
}

export function clampLease(min) {
  const n = Number(min ?? LEASE_MIN.default);
  if (!Number.isFinite(n)) throw new RangeError("--lease-min must be a number");
  return Math.min(LEASE_MIN.max, Math.max(LEASE_MIN.min, Math.round(n)));
}

// ── tasks: derived from what the repo already measures ──────────────────────
export function tasksFromHands(hands) {
  const out = [];
  for (const h of hands) {
    if (h?.status !== "open" || typeof h.id !== "string") continue;
    const who = String(h.whoCanUnblock ?? "");
    if (/^owner$/i.test(who)) continue; // owner-only hands are not lane work
    out.push({ id: `hand:${h.id}`, kind: "raised-hand", priority: 60, source: `artifacts/raised-hands/${h.id}.json`, title: String(h.doing ?? "").slice(0, 120), suggestedLane: /mac/i.test(who) ? "mac-brain" : /cloud/i.test(who) ? "cloud-claude" : null });
  }
  return out;
}

/** PR tasks are keyed by PR and action only: a push to the PR must not mint a new, free id. */
export function tasksFromEstate(items) {
  const pri = { "land-ready": 70, fix: 50, refresh: 30, superseded: 20 };
  return items
    .filter((i) => i.action in pri && Number.isSafeInteger(i.number))
    .map((i) => ({ id: `pr:${i.number}:${i.action}`, kind: `pr-${i.action}`, priority: pri[i.action], source: `PR #${i.number}`, headSha: SHA.test(i.headSha ?? "") ? i.headSha : null, title: String(i.title ?? i.why ?? "").slice(0, 120), suggestedLane: i.action === "land-ready" ? "cloud-claude" : "mac-brain" }));
}

export function orderTasks(tasks, warn = () => {}) {
  const seen = new Set();
  return tasks
    .filter((t) => { if (!validTaskId(t.id)) { warn(`skipped task with an invalid id: ${JSON.stringify(t.id)}`); return false; } return seen.has(t.id) ? false : seen.add(t.id); })
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
  return orderTasks(tasks, (m) => console.error(`work-queue: ${m}`));
}

// ── the forge (REST through gh), injectable for the self-test ────────────────
function gh(args, input) {
  const r = spawnSync("gh", ["api", ...args], { encoding: "utf8", input, maxBuffer: 64 << 20 });
  if (r.status !== 0) {
    const m = /HTTP (\d{3})/.exec(r.stderr ?? "");
    const e = new Error(`gh api ${args[0]}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    e.status = m ? Number(m[1]) : null;
    throw e;
  }
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

export const ghForge = {
  mainline: () => { const c = gh([`repos/${REPO}/commits/${BASE}`]); return { sha: c.sha, tree: c.commit.tree.sha }; },
  /** One claim: null if absent; throws if it cannot be read. Only the refs asked for are read. */
  read: (name) => {
    let ref;
    try { ref = gh([`repos/${REPO}/git/ref/${name}`]); } catch (e) { if (e.status === 404) return null; throw e; }
    const c = gh([`repos/${REPO}/git/commits/${ref.object.sha}`]);
    return { sha: ref.object.sha, message: c.message, date: c.committer?.date ?? null };
  },
  /** The server date of one commit (the lease's starting commit, when it is not the tip). */
  commitDate: (sha) => gh([`repos/${REPO}/git/commits/${sha}`]).committer?.date ?? null,
  // No author/committer in the payload: GitHub stamps the commit with ITS time.
  commit: (message, tree, parent) => gh([`repos/${REPO}/git/commits`, "-X", "POST", "--input", "-"], JSON.stringify({ message, tree, parents: [parent] })).sha,
  createRef: (name, sha) => gh([`repos/${REPO}/git/refs`, "-X", "POST", "--input", "-"], JSON.stringify({ ref: `refs/${name}`, sha })),
  fastForward: (name, sha) => gh([`repos/${REPO}/git/refs/${name}`, "-X", "PATCH", "--input", "-"], JSON.stringify({ sha, force: false })),
};

// ── the queue ────────────────────────────────────────────────────────────────
/** {claim, sha, date, held} for one task. held = unreadable or names another task. */
function readOne(id, forge) {
  const raw = forge.read(refName(id)); // may throw: the caller decides
  if (!raw) return { claim: null, sha: null, date: null, leaseDate: null, held: false };
  const claim = parseClaim(raw.message, id);
  // A review writes a new tip but must not renew the holder's lease: the lease runs from
  // the commit named in `leaseFrom` (the holder's last claim/move), not from the tip.
  let leaseDate = raw.date;
  if (claim?.leaseFrom) {
    if (!/^[0-9a-f]{40}$/.test(claim.leaseFrom)) return { claim: null, sha: raw.sha, date: raw.date, leaseDate: null, held: true };
    leaseDate = forge.commitDate(claim.leaseFrom); // may throw
  }
  return { claim, sha: raw.sha, date: raw.date, leaseDate, held: claim === null };
}

function expired(r, now) {
  const t = Date.parse(r.leaseDate ?? "");
  return Number.isFinite(t) && t + r.claim.leaseMin * 60000 <= now;
}
/** Free for `task`: no claim, released, an expired non-final lease, or — for a PR task —
 *  a finished claim on an OLDER head (the same PR needs the same action again). */
function isFree(r, now, task = null) {
  if (r.held) return false;
  if (!r.claim) return true;
  if (r.claim.state === "released") return true;
  if (r.claim.state === "done" && task?.headSha && r.claim.headSha && task.headSha !== r.claim.headSha) return true;
  return !FINAL.has(r.claim.state) && expired(r, now);
}

export function readQueue(tasks, forge, now = Date.now()) {
  const out = [];
  for (const t of tasks) {
    let r;
    try { r = readOne(t.id, forge); } catch { return null; }
    out.push({ ...t, claim: r.claim, held: r.held, free: isFree(r, now, t), claimSha: r.sha, claimedAt: r.date });
  }
  return out;
}

/** After an error that is not a clean 422, find out what actually happened to the ref. */
function settle(id, forge, ourSha) {
  try { return forge.read(refName(id))?.sha === ourSha; } catch { return false; }
}

/**
 * Claim one task. Reads claims lazily in priority order and stops at the first free one.
 * Returns { ok, task, token } — the token is shown once; only its hash is stored.
 */
export function claim({ tasks, lane, taskId = null, model = null, leaseMin, now = Date.now(), forge = ghForge, token = randomBytes(16).toString("hex") }) {
  if (!LANES.has(lane)) return { ok: false, why: `unknown lane ${lane}` };
  let lease; try { lease = clampLease(leaseMin); } catch (e) { return { ok: false, why: e.message }; }
  const list = taskId ? tasks.filter((t) => t.id === taskId) : tasks;
  if (!list.length) return { ok: false, why: taskId ? `unknown task ${taskId}` : "the queue is empty" };
  let base = null;
  for (const t of list) {
    let r;
    try { r = readOne(t.id, forge); } catch { return { ok: false, why: "could not read the claims; not claiming (an unread claim may be someone else's)" }; }
    if (!isFree(r, now, t)) continue;
    base ??= forge.mainline();
    // A takeover inherits the PR, head and reviews: an open PR must not be orphaned.
    const newCycle = r.claim?.state === "done";
    const inherit = r.claim && r.claim.state !== "released" && !newCycle
      ? { state: r.claim.state === "pr" ? "pr" : "claimed", pr: r.claim.pr ?? null, headSha: r.claim.headSha ?? null, reviews: r.claim.reviews ?? {} }
      : { state: "claimed", pr: null, headSha: t.headSha ?? null, reviews: {} };
    const body = { v: 2, task: t.id, lane, holder: hash(token), model, leaseMin: lease, ...inherit };
    let ours = null;
    try {
      ours = forge.commit(JSON.stringify(body), base.tree, r.sha ?? base.sha);
      if (r.sha) forge.fastForward(refName(t.id), ours); else forge.createRef(refName(t.id), ours);
      return { ok: true, task: t, token, claim: body };
    } catch (e) {
      if (ours && settle(t.id, forge, ours)) return { ok: true, task: t, token, claim: body }; // landed; only the response was lost
      if (e.status === 422) continue; // a real lost race: take the next task
      return { ok: false, why: `forge error while claiming ${t.id} (${String(e.message ?? e).slice(0, 120)}); stopped, nothing else claimed` };
    }
  }
  return { ok: false, why: taskId ? `task ${taskId} is held` : "nothing free in the queue" };
}

function write(id, r, next, forge) {
  const base = forge.mainline();
  let ours = null;
  try {
    ours = forge.commit(JSON.stringify(next), base.tree, r.sha);
    forge.fastForward(refName(id), ours);
    return { ok: true, claim: next };
  } catch (e) {
    if (ours && settle(id, forge, ours)) return { ok: true, claim: next };
    return { ok: false, why: e.status === 422 ? "the claim moved since it was read (lost a race); re-read" : `forge error (${String(e.message ?? e).slice(0, 120)})` };
  }
}

/** The holder moves its claim along the transition table. Resolved by ref, not by the task list. */
export function move({ lane, token, taskId, state, pr = null, headSha = null, leaseMin, now = Date.now(), forge = ghForge }) {
  if (!validTaskId(taskId)) return { ok: false, why: "invalid task id" };
  let r; try { r = readOne(taskId, forge); } catch { return { ok: false, why: "could not read the claim" }; }
  if (!r.claim) return { ok: false, why: r.held ? "claim unreadable or for another task; held" : `task ${taskId} is not claimed` };
  if (r.claim.lane !== lane || r.claim.holder !== hash(token)) return { ok: false, why: "not the holder (lane or token does not match)" };
  if (!FINAL.has(r.claim.state) && r.claim.state !== "released" && expired(r, now)) return { ok: false, why: "your lease expired; claim it again" };
  if (!(TRANSITIONS[r.claim.state] ?? []).includes(state)) return { ok: false, why: `${r.claim.state} → ${state} is not an allowed move` };
  const next = { ...r.claim, state };
  delete next.leaseFrom; // this move is the holder's own write: the lease restarts here
  if (state === "pr") {
    const p = pr ?? r.claim.pr, h = headSha ?? r.claim.headSha;
    if (!Number.isSafeInteger(p) || !SHA.test(h ?? "")) return { ok: false, why: "pr needs --pr N and --head <40-char sha>" };
    next.pr = p; next.headSha = h;
  }
  if (state === "merged") {
    const ok = (rv) => rv && rv.pr === r.claim.pr && rv.headSha === r.claim.headSha;
    if (!(ok(r.claim.reviews?.codex) && ok(r.claim.reviews?.["cloud-claude"]))) return { ok: false, why: "merged needs both reviews (codex and cloud-claude) on this PR's current head" };
  }
  if (leaseMin !== undefined) { try { next.leaseMin = clampLease(leaseMin); } catch (e) { return { ok: false, why: e.message }; } }
  return write(taskId, r, next, forge);
}

/** A reviewer records its review of {pr, head}. Changes nothing else; renews no lease. */
export function review({ lane, taskId, pr, headSha, forge = ghForge }) {
  if (!REVIEW_LANES.has(lane)) return { ok: false, why: `only codex or cloud-claude record a review, not ${lane}` };
  if (!validTaskId(taskId) || !Number.isSafeInteger(pr) || !SHA.test(headSha ?? "")) return { ok: false, why: "review needs --task, --pr N and --head <40-char sha>" };
  let r; try { r = readOne(taskId, forge); } catch { return { ok: false, why: "could not read the claim" }; }
  if (!r.claim) return { ok: false, why: "not claimed, or held unreadable" };
  if (r.claim.state !== "pr") return { ok: false, why: `reviews are recorded only at state pr (now ${r.claim.state})` };
  if (r.claim.pr !== pr || r.claim.headSha !== headSha) return { ok: false, why: `the claim is at PR #${r.claim.pr} head ${String(r.claim.headSha).slice(0, 8)}, not the one reviewed` };
  // leaseFrom pins the lease to the holder's last own commit; a review never moves it.
  return write(taskId, r, { ...r.claim, leaseFrom: r.claim.leaseFrom ?? r.sha, reviews: { ...(r.claim.reviews ?? {}), [lane]: { pr, headSha } } }, forge);
}

// ── self-test: an in-memory forge with create-once, fast-forward-only and server time ──
function selfTest() {
  const mk = () => {
    const commits = new Map(), refs = new Map(); let n = 0;
    const f = {
      clock: Date.parse("2026-10-29T20:00:00Z"), calls: { create: 0, ff: 0, read: 0 },
      mainline: () => ({ sha: "m".repeat(40), tree: "t".repeat(40) }),
      read: (name) => {
        f.calls.read++;
        if (f.unreadable) throw Object.assign(new Error("502"), { status: 502 });
        if (f.hide?.has(name)) { f.hide.delete(name); return null; }
        const sha = refs.get(name);
        return sha ? { sha, message: commits.get(sha).message, date: new Date(commits.get(sha).at).toISOString() } : null;
      },
      commit: (message, tree, parent) => { const sha = String(++n).padStart(40, "0"); commits.set(sha, { message, parent, at: f.clock }); return sha; },
      commitDate: (sha) => { const c = commits.get(sha); if (!c) throw Object.assign(new Error("404"), { status: 404 }); return new Date(c.at).toISOString(); },
      createRef: (name, sha) => { f.calls.create++; if (refs.has(name)) throw Object.assign(new Error("422 exists"), { status: 422 }); refs.set(name, sha); if (f.loseResponse) throw Object.assign(new Error("timeout"), { status: null }); },
      fastForward: (name, sha) => { f.calls.ff++; if (commits.get(sha)?.parent !== refs.get(name)) throw Object.assign(new Error("422 not ff"), { status: 422 }); refs.set(name, sha); },
      refs, commits,
    };
    return f;
  };
  const tip = (f, id) => JSON.parse(f.commits.get(f.refs.get(refName(id))).message);
  const H = "a".repeat(40), H2 = "b".repeat(40);
  const T = orderTasks([
    { id: "pr:10:fix", kind: "pr-fix", priority: 50 },
    { id: "hand:x", kind: "raised-hand", priority: 60 },
    { id: "pr:11:refresh", kind: "pr-refresh", priority: 30 },
  ]);
  const res = []; const check = (name, ok) => { res.push(ok); if (!ok) console.error(`FAIL: ${name}`); };
  {
    const f = mk();
    const a = claim({ tasks: T, lane: "mac-brain", now: f.clock, forge: f });
    const b = claim({ tasks: T, lane: "codex", now: f.clock, forge: f });
    check("two lanes never get the same task; highest priority first", a.ok && b.ok && a.task.id === "hand:x" && b.task.id === "pr:10:fix");
  }
  {
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", now: f.clock, forge: f });
    f.hide = new Set([refName("hand:x")]); // the second lane's read misses the first claim
    const b = claim({ tasks: T, lane: "codex", now: f.clock, forge: f });
    check("a create race: the loser gets 422 and takes the NEXT task", b.ok && b.task.id === "pr:10:fix" && f.refs.size === 2);
  }
  {
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 10, now: f.clock, forge: f });
    const early = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: f.clock + 5 * 60000, forge: f });
    const late = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: f.clock + 11 * 60000, forge: f });
    check("an unexpired lease holds; an expired one is taken over", !early.ok && late.ok);
  }
  {
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 5, now: f.clock, forge: f });
    const later = f.clock + 6 * 60000;
    const oldTip = f.refs.get(refName("hand:x")); const oldMsg = f.commits.get(oldTip).message; const oldAt = f.commits.get(oldTip).at;
    claim({ tasks: T, lane: "codex", taskId: "hand:x", now: later, forge: f });
    const realRead = f.read; f.read = (name) => (name === refName("hand:x") ? { sha: oldTip, message: oldMsg, date: new Date(oldAt).toISOString() } : realRead(name));
    const second = claim({ tasks: T, lane: "cloud-claude", taskId: "hand:x", now: later, forge: f });
    f.read = realRead;
    check("a takeover race: a taker that read the OLD tip is refused; nothing overwritten", !second.ok && tip(f, "hand:x").lane === "codex");
  }
  {
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now, forge: f }); const tok = c.token;
    const skip = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "done", now, forge: f });
    const wrongTok = move({ lane: "mac-brain", token: "nope", taskId: "hand:x", state: "built", now, forge: f });
    const prNoHead = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "pr", pr: 5, now, forge: f });
    const prOk = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "pr", pr: 5, headSha: H, now, forge: f });
    const early = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "merged", now, forge: f });
    const rc = review({ lane: "codex", taskId: "hand:x", pr: 5, headSha: H, forge: f });
    const notReviewer = review({ lane: "mac-brain", taskId: "hand:x", pr: 5, headSha: H, forge: f });
    const pushed = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "pr", pr: 5, headSha: H2, now, forge: f });
    const rl = review({ lane: "cloud-claude", taskId: "hand:x", pr: 5, headSha: H2, forge: f });
    const staleReviews = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "merged", now, forge: f });
    const rc2 = review({ lane: "codex", taskId: "hand:x", pr: 5, headSha: H2, forge: f });
    const merged = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "merged", now, forge: f });
    const done = move({ lane: "mac-brain", token: tok, taskId: "hand:x", state: "done", now, forge: f });
    const reclaim = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 1e9, forge: f });
    check("transitions: no skip to done, token required, pr needs a head, merged needs both reviews on the CURRENT head, done follows merged and is final",
      !skip.ok && !wrongTok.ok && !prNoHead.ok && prOk.ok && !early.ok && rc.ok && !notReviewer.ok && pushed.ok && rl.ok && !staleReviews.ok && rc2.ok && merged.ok && done.ok && !reclaim.ok);
  }
  {
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "pr", pr: 5, headSha: H, now, forge: f });
    const before = tip(f, "hand:x");
    const wrongHead = review({ lane: "codex", taskId: "hand:x", pr: 999, headSha: H, forge: f });
    review({ lane: "codex", taskId: "hand:x", pr: 5, headSha: H, forge: f });
    const after = tip(f, "hand:x");
    check("a review changes nothing but the reviews, and must match the claim's PR and head",
      !wrongHead.ok && after.pr === 5 && after.headSha === H && after.leaseMin === before.leaseMin && after.holder === before.holder && after.state === "pr");
  }
  {
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 5, now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "pr", pr: 7, headSha: H, now, forge: f });
    review({ lane: "codex", taskId: "hand:x", pr: 7, headSha: H, forge: f });
    const t = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 6 * 60000, forge: f });
    const stale = move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "built", now: now + 6 * 60000, forge: f });
    check("a takeover of a PR-stage claim keeps the PR, head and reviews; the old holder is fenced out",
      t.ok && t.claim.state === "pr" && t.claim.pr === 7 && t.claim.reviews.codex?.headSha === H && !stale.ok);
  }
  {
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now, forge: f });
    const rel = move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "released", now, forge: f });
    const backToWork = move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "built", now, forge: f });
    const again = claim({ tasks: T, lane: "codex", taskId: "hand:x", now, forge: f });
    check("released hands the task back; the old holder cannot resume it without claiming", rel.ok && !backToWork.ok && again.ok);
  }
  {
    const f = mk(); f.unreadable = true;
    check("unreadable claims refuse every claim", !claim({ tasks: T, lane: "mac-brain", now: f.clock, forge: f }).ok && f.calls.create === 0);
  }
  {
    const f = mk();
    f.refs.set(refName("hand:x"), "9".repeat(40));
    f.commits.set("9".repeat(40), { message: JSON.stringify({ v: 2, task: "hand:OTHER", lane: "codex", holder: "0".repeat(64), state: "released", leaseMin: 5 }), parent: null, at: 0 });
    check("a claim whose body names another task is held, never free", !claim({ tasks: T, lane: "codex", taskId: "hand:x", now: f.clock + 1e9, forge: f }).ok);
  }
  {
    const f = mk(); f.loseResponse = true;
    const c = claim({ tasks: T, lane: "mac-brain", now: f.clock, forge: f });
    check("a create whose response was lost is settled by re-reading: exactly one claim, held by us", c.ok && c.task.id === "hand:x" && f.refs.size === 1);
  }
  {
    const f = mk(); f.createRef = () => { throw Object.assign(new Error("403 forbidden"), { status: 403 }); };
    const c = claim({ tasks: T, lane: "mac-brain", now: f.clock, forge: f });
    check("a non-race forge error stops loudly; it is not reported as a lost race", !c.ok && /forge error/.test(c.why));
  }
  {
    const f = mk();
    const a = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: -5, now: f.clock, forge: f });
    const b = claim({ tasks: T, lane: "mac-brain", taskId: "pr:10:fix", leaseMin: 1e7, now: f.clock, forge: f });
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "pr:11:refresh", leaseMin: "x", now: f.clock, forge: f });
    check("leases are clamped to 5–720 minutes; a non-number is refused", a.claim.leaseMin === 5 && b.claim.leaseMin === 720 && !c.ok);
  }
  {
    // A moving clock: holder claims at t0 with a 5-minute lease and dies; a review at t+4
    // must NOT keep the lease alive, so a takeover at t+6 succeeds.
    const f = mk(); const t0 = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 5, now: t0, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "pr", pr: 9, headSha: H, now: t0, forge: f });
    f.clock = t0 + 4 * 60000; review({ lane: "codex", taskId: "hand:x", pr: 9, headSha: H, forge: f });
    f.clock = t0 + 4.5 * 60000; review({ lane: "codex", taskId: "hand:x", pr: 9, headSha: H, forge: f });
    f.clock = t0 + 6 * 60000;
    const take = claim({ tasks: T, lane: "cloud-claude", taskId: "hand:x", now: f.clock, forge: f });
    check("reviews never renew the holder's lease (moving clock)", take.ok && take.claim.reviews.codex?.headSha === H);
  }
  {
    // A recurring PR task: done at head H; the estate later asks for the same action at H2.
    const f = mk(); const now = f.clock;
    const PT = [{ id: "pr:10:refresh", priority: 30, headSha: H }];
    const c = claim({ tasks: PT, lane: "mac-brain", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:10:refresh", state: "pr", pr: 10, headSha: H, now, forge: f });
    review({ lane: "codex", taskId: "pr:10:refresh", pr: 10, headSha: H, forge: f });
    review({ lane: "cloud-claude", taskId: "pr:10:refresh", pr: 10, headSha: H, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:10:refresh", state: "merged", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:10:refresh", state: "done", now, forge: f });
    const sameHead = claim({ tasks: PT, lane: "codex", now, forge: f });
    const newHead = claim({ tasks: [{ ...PT[0], headSha: H2 }], lane: "codex", now, forge: f });
    check("a done PR task is final at its head, but a NEW head starts a fresh cycle (record kept)",
      !sameHead.ok && newHead.ok && newHead.claim.state === "claimed" && newHead.claim.headSha === H2 && Object.keys(newHead.claim.reviews).length === 0 && f.commits.get(f.refs.get(refName("pr:10:refresh"))).parent !== null);
  }
  check("a hand-written state like toString is rejected, not thrown on",
    parseClaim(JSON.stringify({ v: 2, task: "hand:x", lane: "codex", holder: "0".repeat(64), state: "toString", leaseMin: 5 }), "hand:x") === null);
  {
    const ids = ["hand-:x", "hand:-x", "pr:5:fix", "hand:a/b..c"];
    const names = ids.map(refName);
    const skipped = [];
    const kept = orderTasks([{ id: "hand:ok", priority: 1 }, { id: "hand:has space", priority: 1 }, { id: "../x", priority: 1 }, { id: "hand:" + "y".repeat(130), priority: 1 }], (m) => skipped.push(m));
    check("ids map to refs one-to-one and back; invalid or over-long ids are skipped, not fatal",
      new Set(names).size === ids.length && ids.every((id, i) => idOfRef(names[i]) === id) && kept.length === 1 && skipped.length === 3 && names.every((x) => /^queue\/claims\/[0-9a-f]+$/.test(x)));
  }
  check("estate PR task ids do not change when the PR's head moves",
    tasksFromEstate([{ number: 3, action: "fix", headSha: H }])[0].id === tasksFromEstate([{ number: 3, action: "fix", headSha: H2 }])[0].id);
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
function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const num = (v) => (v === undefined ? null : Number(v));

async function main(argv) {
  if (argv.includes("--self-test")) return selfTest() ? 0 : 1;
  const cmd = argv[0] ?? "list";
  const lane = arg(argv, "--lane");
  if (cmd === "move") {
    const r = move({ lane, token: arg(argv, "--token"), taskId: arg(argv, "--task"), state: arg(argv, "--state"), pr: num(arg(argv, "--pr")), headSha: arg(argv, "--head") ?? null, leaseMin: arg(argv, "--lease-min") });
    console.log(JSON.stringify(r)); return r.ok ? 0 : 3;
  }
  if (cmd === "review") {
    const r = review({ lane, taskId: arg(argv, "--task"), pr: num(arg(argv, "--pr")), headSha: arg(argv, "--head") ?? null });
    console.log(JSON.stringify(r)); return r.ok ? 0 : 3;
  }
  const tasks = await loadTasks();
  if (cmd === "list") {
    const q = readQueue(tasks, ghForge);
    if (q === null) { console.error("work-queue: could not read the claims"); return 1; }
    if (argv.includes("--json")) { console.log(JSON.stringify(q, null, 2)); return 0; }
    for (const t of q) console.log(`${t.held ? "held(unreadable)" : t.claim ? `${t.claim.state}@${t.claim.lane}${t.free ? " (expired)" : ""}` : "free"}\t${t.priority}\t${t.id}\t${t.title ?? ""}`);
    console.error(`work-queue: ${q.length} task(s), ${q.filter((t) => t.free).length} free`);
    return 0;
  }
  if (cmd === "claim") {
    const r = claim({ tasks, lane, taskId: arg(argv, "--task") ?? null, model: arg(argv, "--model") ?? null, leaseMin: arg(argv, "--lease-min") });
    console.log(JSON.stringify(r.ok ? { ok: true, task: r.task.id, token: r.token, claim: r.claim } : r));
    return r.ok ? 0 : 3;
  }
  console.error("use: list | claim | move | review | --self-test");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2)).then((c) => process.exit(c));
