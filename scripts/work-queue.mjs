#!/usr/bin/env node
// work-queue.mjs — ONE queue every lane claims from, so no two lanes build the same task.
//
//   node scripts/work-queue.mjs list [--json]
//   node scripts/work-queue.mjs claim  --lane <lane> [--task <id>] [--model <m>] [--lease-min N]
//                                      → prints {task, token}; keep the token, it is the holder's proof
//   node scripts/work-queue.mjs move   --lane <lane> --token <t> --task <id> --state <s> [--pr N --head <sha>]
//   node scripts/work-queue.mjs review --lane codex|cloud-claude --task <id> --pr N --head <sha>
//   node scripts/work-queue.mjs recover --lane owner --task <id> --witness "<what was checked>"   (annotates; never frees)
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
//   date (no client clock is written).
// - ONE claim per PR (`pr:N`), whatever the action: a fix and a refresh of the same
//   branch are the same lock. The action is metadata on the claim. A `done` claim is final
//   for its action at its head; a NEW head or a NEW action opens a fresh cycle, which
//   fast-forwards on top of the old record.
//
// A LEASE NEVER FREES A CLAIM. An expired lease only marks the claim STALE in `list`:
// the old run may still be working, or a request it sent may still land, so elapsed time
// is not evidence that it stopped. A claim is freed ONLY by its holder releasing it with
// the token. The owner's `recover` records on a STALE claim what a person checked, but
// frees nothing: a typed note is not proof that the old attempt ended, and until a trusted
// recovery check exists (one that verifies the exact attempt and its process/provider
// outcome) a dead holder's task stays held and is listed for a person. The lease runs from the holder's own
// last claim/move commit (`leaseFrom` when a review has written on top), so a review
// never makes a dead holder look alive.
//
// LIFECYCLE (the owner's flow), enforced as a transition table:
//   claimed → built → pr → merged → done        (any of the first three → released;
//                                                 owner `recover` annotates only)
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

const nullOr = (v, ok) => v === undefined || v === null || ok(v);
const validReview = (rv) => rv && typeof rv === "object" && Number.isSafeInteger(rv.pr) && SHA.test(rv.headSha ?? "");
/** The stored claim, validated EXACTLY; anything else is held evidence, never normalised. */
export function parseClaim(message, taskId) {
  try {
    const c = JSON.parse(String(message).split("\n")[0]);
    if (c?.v !== 2 || c.task !== taskId || !LANES.has(c.lane) || !Object.hasOwn(TRANSITIONS, c.state) || !/^[0-9a-f]{64}$/.test(c.holder ?? "")) return null;
    if (!Number.isInteger(c.leaseMin) || c.leaseMin < LEASE_MIN.min || c.leaseMin > LEASE_MIN.max) return null;
    if (!nullOr(c.action, (a) => typeof a === "string" && /^[a-z-]{1,40}$/.test(a))) return null;
    if (!nullOr(c.model, (m) => typeof m === "string" && m.length <= 80)) return null;
    if (!nullOr(c.pr, Number.isSafeInteger) || !nullOr(c.headSha, (h) => SHA.test(h)) || !nullOr(c.leaseFrom, (h) => SHA.test(h))) return null;
    if (c.state === "pr" && !(Number.isSafeInteger(c.pr) && SHA.test(c.headSha ?? ""))) return null;
    if (!nullOr(c.reviews, (rv) => typeof rv === "object" && !Array.isArray(rv) && Object.entries(rv).every(([k, v]) => REVIEW_LANES.has(k) && validReview(v)))) return null;
    if (!nullOr(c.recoveryNote, (x) => typeof x === "object" && typeof x.witness === "string" && x.witness.length > 0 && x.witness.length <= 200)) return null;
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

/** PR tasks are keyed by the PR alone: neither a push nor a changed estate action may
 *  mint a second, independent lock on the same branch. The action rides as metadata. */
export function tasksFromEstate(items) {
  const pri = { "land-ready": 70, fix: 50, refresh: 30, superseded: 20 };
  return items
    .filter((i) => Object.hasOwn(pri, i.action) && Number.isSafeInteger(i.number))
    .map((i) => ({ id: `pr:${i.number}`, action: i.action, kind: `pr-${i.action}`, priority: pri[i.action], source: `PR #${i.number}`, headSha: SHA.test(i.headSha ?? "") ? i.headSha : null, title: String(i.title ?? i.why ?? "").slice(0, 120), suggestedLane: i.action === "land-ready" ? "cloud-claude" : "mac-brain" }));
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
  if (!existsSync(estate)) {
    console.error("work-queue: WARNING estate source scripts/mac/estate-queue.mjs is absent in this checkout; PR tasks are NOT listed (raised hands only)");
  } else {
    try { const m = await import(pathToFileURL(estate).href); tasks.push(...tasksFromEstate(m.plan())); }
    catch (e) { console.error(`work-queue: WARNING estate source failed (${String(e.message ?? e).slice(0, 120)}); PR tasks are NOT listed`); }
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
/** Free for `task`: no claim, released, or a DONE claim for an older head or another
 *  action. Never because time passed: an expired lease is stale, not free. */
function isFree(r, task = null) {
  if (r.held) return false;
  if (!r.claim) return true;
  if (r.claim.state === "released") return true;
  if (r.claim.state !== "done") return false;
  const newHead = task?.headSha && r.claim.headSha && task.headSha !== r.claim.headSha;
  const newAction = task?.action && r.claim.action && task.action !== r.claim.action;
  return Boolean(newHead || newAction);
}
const isStale = (r, now) => Boolean(r.claim) && !FINAL.has(r.claim.state) && r.claim.state !== "released" && expired(r, now);

export function readQueue(tasks, forge, now = Date.now()) {
  const out = [];
  for (const t of tasks) {
    let r;
    try { r = readOne(t.id, forge); } catch { return null; }
    out.push({ ...t, claim: r.claim, held: r.held, free: isFree(r, t), stale: isStale(r, now), claimSha: r.sha, claimedAt: r.date });
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
    if (!isFree(r, t)) continue;
    base ??= forge.mainline();
    // Claiming a RELEASED task that already had a PR carries the PR, head and reviews: an
    // open PR must not be orphaned. A done claim starts a fresh cycle.
    const carry = r.claim?.state === "released" && Number.isSafeInteger(r.claim.pr);
    // The PR is kept; the head is the one the task NOW names, and reviews of any other
    // head are dropped, so a handoff can never satisfy the same-head review gate with
    // evidence about a head nobody reviewed.
    const head = carry ? (t.headSha ?? r.claim.headSha ?? null) : (t.headSha ?? null);
    const inherit = carry
      ? { state: "claimed", pr: r.claim.pr, headSha: head, reviews: head === r.claim.headSha ? (r.claim.reviews ?? {}) : {} }
      : { state: "claimed", pr: null, headSha: head, reviews: {} };
    const body = { v: 2, task: t.id, action: t.action ?? null, lane, holder: hash(token), model, leaseMin: lease, ...inherit };
    // Never write a claim this file would itself refuse to read: it would hold the task for good.
    if (parseClaim(JSON.stringify(body), t.id) === null) return { ok: false, why: "the claim would be invalid as stored (check --model ≤80 chars and the task's fields); nothing written" };
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
  if (parseClaim(JSON.stringify(next), id) === null) return { ok: false, why: "the update would be invalid as stored; nothing written" };
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
  // An expired lease does not fence the holder out: nobody else can take a stale claim,
  // so the holder may still finish, renew, or release it.
  if (!(TRANSITIONS[r.claim.state] ?? []).includes(state)) return { ok: false, why: `${r.claim.state} → ${state} is not an allowed move` };
  const next = { ...r.claim, state };
  delete next.leaseFrom; // this move is the holder's own write: the lease restarts here
  delete next.recoveryNote;
  if (state === "pr") {
    const p = pr ?? r.claim.pr, h = headSha ?? r.claim.headSha;
    if (!Number.isSafeInteger(p) || !SHA.test(h ?? "")) return { ok: false, why: "pr needs --pr N and --head <40-char sha>" };
    const bound = /^pr:(\d+)$/.exec(taskId);
    if (bound && Number(bound[1]) !== p) return { ok: false, why: `task ${taskId} is PR #${bound[1]}; it cannot record PR #${p}` };
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

/** The owner annotates a STALE claim with what a person checked. It frees nothing: the
 *  claim stays held, with the same holder and state, until the holder releases it. A note
 *  is not a trusted witness that the old attempt ended, so it never authorises a new one. */
export function recover({ lane, taskId, witness, now = Date.now(), forge = ghForge }) {
  if (lane !== "owner") return { ok: false, why: "only the owner annotates a stale claim" };
  if (!validTaskId(taskId) || typeof witness !== "string" || !witness.trim() || witness.length > 200) return { ok: false, why: "recover needs --task and --witness \"<what was checked>\" (1–200 chars)" };
  let r; try { r = readOne(taskId, forge); } catch { return { ok: false, why: "could not read the claim" }; }
  if (!r.claim) return { ok: false, why: r.held ? "claim unreadable or for another task; held (fix the record by hand)" : `task ${taskId} is not claimed` };
  if (r.claim.state === "merged") {
    // The merge already happened (both reviews on the head were required to record it);
    // `done` is bookkeeping and replays nothing, so the owner may finalise an abandoned one.
    const fin = { ...r.claim, state: "done", leaseFrom: r.claim.leaseFrom ?? r.sha, recoveryNote: { witness: witness.trim(), state: "merged" } };
    const w = write(taskId, r, fin, forge);
    return w.ok ? { ...w, note: "finalised a merged claim as done; nothing was re-run" } : w;
  }
  if (FINAL.has(r.claim.state) || r.claim.state === "released") return { ok: false, why: `nothing to recover (state ${r.claim.state})` };
  if (!isStale(r, now)) return { ok: false, why: "the claim's lease has not expired; only its holder can act on it" };
  // leaseFrom is kept: the note is not the holder's write and must not renew the lease.
  const next = { ...r.claim, leaseFrom: r.claim.leaseFrom ?? r.sha, recoveryNote: { witness: witness.trim(), state: r.claim.state } };
  const w = write(taskId, r, next, forge);
  return w.ok ? { ...w, note: "annotated; the claim is still held until its holder releases it" } : w;
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
    f.clock += 11 * 60000;
    const late = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: f.clock, forge: f });
    const q = readQueue(T, f, f.clock).find((t) => t.id === "hand:x");
    const notOwner = recover({ lane: "codex", taskId: "hand:x", witness: "looked", forge: f });
    const noWitness = recover({ lane: "owner", taskId: "hand:x", witness: " ", forge: f });
    const rec = recover({ lane: "owner", taskId: "hand:x", witness: "mac-brain process gone; no PR opened", now: f.clock, forge: f });
    const after = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: f.clock, forge: f });
    const q2 = readQueue(T, f, f.clock).find((t) => t.id === "hand:x");
    check("elapsed time never frees a claim, and neither does an owner note: STALE and annotated is still held",
      !early.ok && !late.ok && q.stale && !q.free && !notOwner.ok && !noWitness.ok && rec.ok && rec.claim.recoveryNote.state === "claimed" && rec.claim.lane === "mac-brain" && !after.ok && q2.stale && !q2.free);
  }
  {
    // Codex's counterexample: an UNEXPIRED live claim, an owner note with unverified text.
    const f = mk();
    claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 60, now: f.clock, forge: f });
    const rec = recover({ lane: "owner", taskId: "hand:x", witness: "unverified text", now: f.clock + 60000, forge: f });
    const take = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: f.clock + 60000, forge: f });
    check("an unexpired claim cannot be recovered, and a codex claim of it is refused", !rec.ok && !take.ok && tip(f, "hand:x").lane === "mac-brain");
  }
  {
    const f = mk();
    const c0 = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 5, now: f.clock, forge: f });
    move({ lane: "mac-brain", token: c0.token, taskId: "hand:x", state: "released", now: f.clock, forge: f });
    const later = f.clock + 6 * 60000;
    const oldTip = f.refs.get(refName("hand:x")); const oldMsg = f.commits.get(oldTip).message; const oldAt = f.commits.get(oldTip).at;
    claim({ tasks: T, lane: "codex", taskId: "hand:x", now: later, forge: f });
    const realRead = f.read; f.read = (name) => (name === refName("hand:x") ? { sha: oldTip, message: oldMsg, date: new Date(oldAt).toISOString() } : realRead(name));
    const second = claim({ tasks: T, lane: "cloud-claude", taskId: "hand:x", now: later, forge: f });
    f.read = realRead;
    check("a takeover race after a release: a taker that read the OLD tip is refused; nothing overwritten", !second.ok && tip(f, "hand:x").lane === "codex");
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
    const early = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 6 * 60000, forge: f });
    recover({ lane: "owner", taskId: "hand:x", witness: "PR #7 open, builder gone", now: now + 6 * 60000, forge: f });
    const noted = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 6 * 60000, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "released", now: now + 6 * 60000, forge: f });
    const t = claim({ tasks: T, lane: "codex", taskId: "hand:x", now: now + 6 * 60000, forge: f });
    const stale = move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "built", now: now + 6 * 60000, forge: f });
    const back = move({ lane: "codex", token: t.token, taskId: "hand:x", state: "pr", now: now + 6 * 60000, forge: f });
    check("a released PR-stage claim, claimed again, keeps the PR, head and reviews; a note alone frees nothing; the old holder is fenced out",
      !early.ok && !noted.ok && t.ok && t.claim.pr === 7 && t.claim.headSha === H && t.claim.reviews.codex?.headSha === H && !stale.ok && back.ok && back.claim.pr === 7);
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
    // A moving clock: holder claims at t0 with a 5-minute lease and dies; reviews at t+4
    // must NOT make it look alive: at t+6 it reads STALE (and is still not free).
    const f = mk(); const t0 = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", leaseMin: 5, now: t0, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "pr", pr: 9, headSha: H, now: t0, forge: f });
    f.clock = t0 + 4 * 60000; review({ lane: "codex", taskId: "hand:x", pr: 9, headSha: H, forge: f });
    f.clock = t0 + 4.5 * 60000; review({ lane: "codex", taskId: "hand:x", pr: 9, headSha: H, forge: f });
    f.clock = t0 + 6 * 60000;
    const take = claim({ tasks: T, lane: "cloud-claude", taskId: "hand:x", now: f.clock, forge: f });
    const q = readQueue(T, f, f.clock).find((t) => t.id === "hand:x");
    check("reviews never renew the holder's lease (moving clock): stale at t+6, still held", q.stale && !q.free && !take.ok);
  }
  {
    // A recurring PR task: done at head H; the estate later asks for the same action at H2.
    const f = mk(); const now = f.clock;
    const PT = tasksFromEstate([{ number: 10, action: "refresh", headSha: H }]);
    const c = claim({ tasks: PT, lane: "mac-brain", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:10", state: "pr", pr: 10, headSha: H, now, forge: f });
    review({ lane: "codex", taskId: "pr:10", pr: 10, headSha: H, forge: f });
    review({ lane: "cloud-claude", taskId: "pr:10", pr: 10, headSha: H, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:10", state: "merged", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:10", state: "done", now, forge: f });
    const sameHead = claim({ tasks: PT, lane: "codex", now, forge: f });
    const newHead = claim({ tasks: [{ ...PT[0], headSha: H2 }], lane: "codex", now, forge: f });
    check("a done PR task is final at its head, but a NEW head starts a fresh cycle (record kept)",
      !sameHead.ok && newHead.ok && newHead.claim.state === "claimed" && newHead.claim.headSha === H2 && Object.keys(newHead.claim.reviews).length === 0 && f.commits.get(f.refs.get(refName("pr:10"))).parent !== null);
  }
  {
    // Cross-action: a live fix claim on PR 77 must hold a refresh of the same PR and head.
    const f = mk(); const now = f.clock;
    const fix = claim({ tasks: tasksFromEstate([{ number: 77, action: "fix", headSha: H }]), lane: "mac-brain", now, forge: f });
    const refresh = claim({ tasks: tasksFromEstate([{ number: 77, action: "refresh", headSha: H }]), lane: "cloud-claude", now, forge: f });
    move({ lane: "mac-brain", token: fix.token, taskId: "pr:77", state: "released", now, forge: f });
    const afterRelease = claim({ tasks: tasksFromEstate([{ number: 77, action: "refresh", headSha: H }]), lane: "cloud-claude", now, forge: f });
    const viaDone = mk();
    const c2 = claim({ tasks: tasksFromEstate([{ number: 78, action: "fix", headSha: H }]), lane: "mac-brain", now, forge: viaDone });
    move({ lane: "mac-brain", token: c2.token, taskId: "pr:78", state: "pr", pr: 78, headSha: H, now, forge: viaDone });
    review({ lane: "codex", taskId: "pr:78", pr: 78, headSha: H, forge: viaDone });
    review({ lane: "cloud-claude", taskId: "pr:78", pr: 78, headSha: H, forge: viaDone });
    move({ lane: "mac-brain", token: c2.token, taskId: "pr:78", state: "merged", now, forge: viaDone });
    move({ lane: "mac-brain", token: c2.token, taskId: "pr:78", state: "done", now, forge: viaDone });
    const sameAction = claim({ tasks: tasksFromEstate([{ number: 78, action: "fix", headSha: H }]), lane: "codex", now, forge: viaDone });
    const nextAction = claim({ tasks: tasksFromEstate([{ number: 78, action: "land-ready", headSha: H }]), lane: "codex", now, forge: viaDone });
    check("one lock per PR: a live claim for one action holds every other action on that PR; a DONE action at the same head frees only a different action",
      !sameAction.ok && nextAction.ok && nextAction.claim.action === "land-ready" &&
      fix.ok && fix.claim.action === "fix" && !refresh.ok && afterRelease.ok && afterRelease.claim.action === "refresh");
  }
  {
    // Malformed STORED claims are held evidence, never free and never normalised.
    const base = { v: 2, task: "hand:x", lane: "codex", holder: "0".repeat(64), state: "claimed" };
    const bad = [{ leaseMin: -1 }, { leaseMin: 0 }, { leaseMin: 7.5 }, { leaseMin: 721 }, { leaseMin: 5, pr: "7" }, { leaseMin: 5, headSha: "zz" },
      { leaseMin: 5, state: "pr" }, { leaseMin: 5, reviews: { mallory: { pr: 1, headSha: H } } }, { leaseMin: 5, leaseFrom: "x" }, { leaseMin: 5, action: 3 }];
    const held = bad.map((extra) => {
      const f = mk(); const sha = "9".repeat(40);
      f.refs.set(refName("hand:x"), sha);
      f.commits.set(sha, { message: JSON.stringify({ ...base, ...extra }), parent: null, at: f.clock });
      const q = readQueue(T, f, f.clock).find((t) => t.id === "hand:x");
      return q.held && !q.free && !claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now: f.clock, forge: f }).ok;
    });
    check("a stored claim with leaseMin -1/0/7.5/721 or a malformed pr/head/review/leaseFrom/action is held, not free", held.every(Boolean));
  }
  {
    // Codex P1: released at H with reviews, PR advanced to H2; the next claim takes H2 and drops H's reviews.
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: tasksFromEstate([{ number: 40, action: "fix", headSha: H }]), lane: "mac-brain", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:40", state: "pr", pr: 40, headSha: H, now, forge: f });
    review({ lane: "codex", taskId: "pr:40", pr: 40, headSha: H, forge: f });
    review({ lane: "cloud-claude", taskId: "pr:40", pr: 40, headSha: H, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "pr:40", state: "released", now, forge: f });
    const t = claim({ tasks: tasksFromEstate([{ number: 40, action: "fix", headSha: H2 }]), lane: "codex", now, forge: f });
    move({ lane: "codex", token: t.token, taskId: "pr:40", state: "pr", now, forge: f });
    const merged = move({ lane: "codex", token: t.token, taskId: "pr:40", state: "merged", now, forge: f });
    check("a reclaimed released PR task takes the NEW head and drops reviews of the old one; merged is refused",
      t.ok && t.claim.pr === 40 && t.claim.headSha === H2 && Object.keys(t.claim.reviews).length === 0 && !merged.ok);
  }
  {
    // Codex P2: invalid metadata is refused before the lock is taken.
    const f = mk();
    const bad = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", model: "m".repeat(81), now: f.clock, forge: f });
    const good = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", model: "m".repeat(80), now: f.clock, forge: f });
    check("a claim the reader would refuse is never written (model >80 chars); nothing is locked", !bad.ok && f.calls.create === 1 && good.ok);
  }
  {
    // Codex P2: a pr:N task cannot record another PR's number.
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: tasksFromEstate([{ number: 1, action: "fix", headSha: H }]), lane: "mac-brain", now, forge: f });
    const wrong = move({ lane: "mac-brain", token: c.token, taskId: "pr:1", state: "pr", pr: 2, headSha: H, now, forge: f });
    const right = move({ lane: "mac-brain", token: c.token, taskId: "pr:1", state: "pr", pr: 1, headSha: H, now, forge: f });
    check("a pr:N task records only PR #N", !wrong.ok && right.ok);
  }
  {
    // Codex P2: holder lost after merged; the owner may finalise to done (nothing re-run).
    const f = mk(); const now = f.clock;
    const c = claim({ tasks: T, lane: "mac-brain", taskId: "hand:x", now, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "pr", pr: 5, headSha: H, now, forge: f });
    review({ lane: "codex", taskId: "hand:x", pr: 5, headSha: H, forge: f });
    review({ lane: "cloud-claude", taskId: "hand:x", pr: 5, headSha: H, forge: f });
    move({ lane: "mac-brain", token: c.token, taskId: "hand:x", state: "merged", now, forge: f });
    const notOwner = recover({ lane: "codex", taskId: "hand:x", witness: "PR #5 merged", now, forge: f });
    const fin = recover({ lane: "owner", taskId: "hand:x", witness: "PR #5 merged at H", now, forge: f });
    check("an abandoned merged claim is finalised to done by the owner only; holder and PR kept",
      !notOwner.ok && fin.ok && fin.claim.state === "done" && fin.claim.lane === "mac-brain" && fin.claim.pr === 5);
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
  check("estate PR task ids do not change when the PR's head or its action changes",
    tasksFromEstate([{ number: 3, action: "fix", headSha: H }])[0].id === tasksFromEstate([{ number: 3, action: "refresh", headSha: H2 }])[0].id);
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
  if (cmd === "recover") {
    const r = recover({ lane, taskId: arg(argv, "--task"), witness: arg(argv, "--witness"), now: Date.now() });
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
    for (const t of q) console.log(`${t.held ? "held(unreadable)" : t.claim ? `${t.claim.state}@${t.claim.lane}${t.stale ? " (STALE: held; only the holder's release frees it)" : ""}` : "free"}\t${t.priority}\t${t.id}\t${t.title ?? ""}`);
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
