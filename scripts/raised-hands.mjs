// raised-hands.mjs — a stuck agent that says nothing looks exactly like a busy one.
//
//   pnpm run hands                                   # everything stuck, grouped by who can clear it
//   pnpm run hand:raise -- --doing "…" --blocked "…" --need "…" --who owner|"mac lane"|"cloud lane" [--domain d] [--covers mail:<id>]
//   pnpm run hand:take -- <id>   ·   pnpm run hand:clear -- <id> "what unblocked it"   (scripts/raise-hand.mjs)
//   node scripts/raised-hands.mjs --check            # the gate (preflight: fatal)
//   node scripts/raised-hands.mjs --check --warn     # CI's form: stalls warn, integrity still fails
//   node scripts/raised-hands.mjs --coherence        # schema only (lane-deliver's gate)
//   node scripts/raised-hands.mjs --markdown [--github]   # the owner's issue body
//   node scripts/raised-hands.mjs --self-test
//
// WHY (owner, 2026-09-23): "All agents will never raise their hand when they get
// stuck." Measured the same day: the steward read the wrong mailbox file for a day
// and reported "0 mail" while four Mac messages waited 15-26h; five cloud→mac
// messages sat unread two days; a classifier block and a scanner false positive
// each stopped a PR and reached the owner only because a session happened to be
// talking to him. Every stall signal in the tree (lane mail, sim requests, routine
// heartbeats) was REPORTED to a console nobody is required to read, and
// docs/STATUS.md could read all-green over a stuck org
// (docs/agent/ORG_SELF_EVALUATION_2026-09-12.md found the prose BLOCKED ON line
// stale within minutes of being written).
//
// TWO HALVES.
//   1. A HAND is one record in artifacts/raised-hands/<id>.json, written by
//      scripts/raise-hand.mjs (the Mac lane's #1014 ledger, merged 2026-09-23): what
//      the raiser was doing, what blocked it, what it needs, who can unblock it —
//      DR-054's four. scripts/check-raised-hands.mjs routes each to an org-roster role,
//      the owner, a lane or a tool, or names it a capability GAP; this file groups by
//      that route. One file per hand, so two lanes raising at once never conflict.
//   2. The system raises hands FOR agents that do not: mail unread past 24h, a sim
//      request pending past 48h, an active routine's heartbeat past its declared
//      tolerance, backlog rows the objective loop cannot rank because no dedicated
//      executor exists (needsExecutor[], past 48h, one aggregated hand), an
//      objective-loop escalation only the owner can clear (escalations[] with
//      clears: owner, past 48h, one hand each), and (with --github) a PR red or
//      idle-and-green too long, or the weekly Mac-lane run red. These are AUTO
//      hands, derived on every run, never stored.
//
// THE GATE (--check) fails when an auto hand is past its HARD limit (3× its soft
// limit) and no open raised hand `covers` it — silence past the limit is the
// defect; an explicit hand saying who must act is the cure, and costs one command.
// Raised hands past their own limit are OVERDUE: reported loudly, pushed to the
// owner's issue, never fatal — a gate cannot make a person act, only make the wait
// impossible to miss. Incoherent rows are fatal.
//
// --warn (CI only, DR-054 §5, 2026-09-24). A stall is somebody else's clock: in CI a
// Mac quiet for 9h turned mainline and every PR red until the next push. Under --warn
// the stalls print as `WARN (would fail locally):` and do not fail; the register's
// OWN integrity (an unreadable hand, a route naming a missing agent or skill, a sim
// gate that printed nothing) still exits 1. Local preflight runs without --warn.
//
// STALLS ARE MEASURED AT ORIGIN'S TIP (DR-054, B54b). The heartbeat, mailbox, sim-request and
// objective files are read from a throwaway checkout of origin/SignalGrid_Alpha, never from the
// branch tree: a branch 239 commits behind mainline carries 14h-old heartbeat files, and a worker
// on it raised a false "mac-lane-tick silent 14.4h" hand. The output says which source it read.
// When that ref does not exist the run FAILS CLOSED (exit 1): an unknown stall state never reads
// as "no stall". CI fetches the ref before this runs.
//
// A STALE HAND IS A FAILURE. A hand that `covers` an auto-stall (mail:/sim:/heartbeat:/…) that is
// no longer measured as stuck fails --check with the exact `hand:clear` command, instead of
// merging silently and staying open until someone clears it by hand. A hand that covers no auto
// stall (an owner-only decision) is exempt, and the output says so.
//
// UNKNOWN IS NEVER FRESH. An unparseable instant ages as infinitely old, exactly as
// check-lane-messages treats an unparseable sentAt.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = process.env.SIGNALGRID_LANE_REPO
  ? resolve(process.env.SIGNALGRID_LANE_REPO)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LEDGER_DIR = "artifacts/raised-hands";
export const ROUTING_FILE = "docs/agent/hand-routing.json";
/** Group order on the owner's page: him first, then the lanes, then roles, tools and gaps. */
export const GROUP_ORDER = ["owner", "cloud", "mac", "role", "tool", "gap"];
const H = 3_600_000;
/** The sim gate printed nothing: our own loader failed, not a clock — fatal even under --warn. */
export const SIM_UNREADABLE = "UNREADABLE-check-sim-requests-printed-nothing";

/** Soft limit per source: past it the hand is on the list; past HARD_MULTIPLE× it the gate fails unless covered. */
export const SOFT_LIMIT_H = { mail: 24, sim: 48, heartbeat: null /* the routine's own cadenceToleranceHours */, "pr-red": 24, "pr-idle": 48, "executor-gap": 48, "objective-owner": 48, "mac-lane-red": 1 };
export const HARD_MULTIPLE = 3;
/** Every auto-hand kind, plus the two routes every explicit hand falls into. Each needs a responder. */
export const AUTO_KINDS = Object.keys(SOFT_LIMIT_H);
export const REQUIRED_ROUTES = [...AUTO_KINDS, "owner", "capability-gap"];
/** A lane hand nobody has taken (`hand:take`) for this long is reported as unanswered. */
export const UNTAKEN_LIMIT_H = 2;
/** How long a RAISED hand may stay open before it is OVERDUE on the owner's issue. */
export const RAISED_LIMIT_H = { owner: 48, cloud: 24, mac: 48, role: 48, tool: 48, gap: 24 };

const age = (iso, nowMs) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / H) : Infinity; // unknown is never fresh
};
export const fmtAge = (h) => (!Number.isFinite(h) ? "unknown age" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

// ── the explicit ledger (artifacts/raised-hands/*.json) ──────────────────────
export function loadLedger(root = repo) {
  const dir = join(root, LEDGER_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    try { return { ...JSON.parse(readFileSync(join(dir, f), "utf8")), __file: f }; }
    catch (e) { return { __file: f, __unreadable: e instanceof Error ? e.message : String(e) }; } // never dropped
  });
}

/** Coherence problems — every one fatal. Pure, for the self-test. */
export function auditHands(records) {
  const problems = [];
  const seen = new Set();
  for (const h of records) {
    const id = h.id ?? h.__file;
    if (h.__unreadable) { problems.push(`raised hand ${h.__file}: does not parse (${h.__unreadable}) — an unreadable blocker is a lost one`); continue; }
    if (!h.id || `${h.id}.json` !== h.__file) problems.push(`raised hand ${h.__file}: id "${h.id}" does not match its filename`);
    if (seen.has(h.id)) problems.push(`raised hand ${id}: duplicate id`);
    seen.add(h.id);
    for (const [f, why] of [["doing", "what the raiser was doing"], ["blockedBy", "what blocked it"], ["need", "what unblocks it"]]) if (!String(h[f] ?? "").trim()) problems.push(`raised hand ${id}: no ${f} — DR-054 needs ${why}`);
    if (!Number.isFinite(Date.parse(String(h.raisedAt ?? "")))) problems.push(`raised hand ${id}: raisedAt is not an ISO instant`);
    if (h.covers !== undefined && !(Array.isArray(h.covers) && h.covers.every((c) => typeof c === "string" && /^[a-z-]+:.+/.test(c)))) problems.push(`raised hand ${id}: covers must be a list of auto-hand ids like "mail:<message-id>"`);
    if (h.takenBy !== undefined && (!String(h.takenBy).trim() || !Number.isFinite(Date.parse(String(h.takenAt ?? ""))))) problems.push(`raised hand ${id}: takenBy needs a name and an ISO takenAt`);
    if (h.status === "resolved") {
      if (!String(h.resolution ?? "").trim()) problems.push(`raised hand ${id}: resolved with no resolution — "done" without what was done is not evidence`);
      if (!Number.isFinite(Date.parse(String(h.resolvedAt ?? "")))) problems.push(`raised hand ${id}: resolved with no ISO resolvedAt`);
    } else if (h.status !== "open") problems.push(`raised hand ${id}: status "${h.status}" is not open or resolved`);
  }
  return problems;
}

/** Which group a hand sits in, from check-raised-hands.mjs's route. */
export function groupOf(h, route) {
  if (route.kind === "human") return { group: "owner", label: "owner" };
  if (route.kind === "lane") {
    const who = String(h.whoCanUnblock ?? "").toLowerCase();
    const origin = String(h.origin ?? "").toLowerCase();
    const l = who.includes("mac") ? "mac" : who.includes("cloud") ? "cloud" : origin.includes("mac") ? "cloud" : "mac"; // "the other lane"
    return { group: l, label: l };
  }
  if (route.kind === "tool") return { group: "tool", label: route.owner };
  if (route.kind === "role") return { group: "role", label: route.owner };
  return { group: "gap", label: "GAP — no agent or skill owns this" };
}

// ── routing: every stall kind has somebody who answers it ────────────────────
/** Pure: `exists(kind, name)` says whether an agent or skill of that name is in the tree. */
export function auditRouting(routing, exists) {
  const problems = [];
  const routes = routing?.routes ?? {};
  for (const k of REQUIRED_ROUTES) if (!routes[k]) problems.push(`hand-routing: no route for "${k}" — a stall of that kind would be detected and answered by nobody`);
  for (const [k, r] of Object.entries(routes)) {
    const who = [r.responder, ...(r.alternates ?? [])];
    if (!r.responder) problems.push(`hand-routing: route "${k}" names no responder`);
    for (const w of who) {
      if (w?.agent && !exists("agent", w.agent)) problems.push(`hand-routing: route "${k}" names agent "${w.agent}", which is not in .claude/agents`);
      if (w && !w.agent && !w.lane && !w.owner) problems.push(`hand-routing: route "${k}" has a responder that is not an agent, a lane or the owner`);
    }
    for (const sk of r.skills ?? []) if (!exists("skill", sk)) problems.push(`hand-routing: route "${k}" names skill "${sk}", which is not in .claude/skills`);
    if (!String(r.action ?? "").trim()) problems.push(`hand-routing: route "${k}" has no action — a responder with no instruction is a name, not an answer`);
  }
  return problems;
}

// ── the auto hands: stalls nobody raised ─────────────────────────────────────
/** Pure: every input injected, so the self-test drives this exact path. */
export function autoHands({ messages = [], acks = [], simPending = [], routines = [], heartbeats = {}, prs = [], objective = null, macLane = null }, nowMs = Date.now()) {
  const out = [];
  const acked = new Set(acks.map((a) => a.messageId));
  const withdrawn = new Set(messages.flatMap((m) => (m.supersedes === undefined || m.supersedes === null ? [] : [].concat(m.supersedes).map(String))));
  for (const m of messages) {
    if (acked.has(m.id) || withdrawn.has(m.id)) continue;
    const h = age(m.sentAt ?? m.__addedAt, nowMs);
    if (h > SOFT_LIMIT_H.mail) out.push({ id: `mail:${m.id}`, clears: m.to, ageH: h, softH: SOFT_LIMIT_H.mail, what: `${m.from}→${m.to} mail unread: "${m.subject}"`, needs: `the ${m.to} lane reads and acks it (pnpm run lane:inbox)` });
  }
  for (const p of simPending) {
    const h = Number.isFinite(p.ageDays) ? p.ageDays * 24 : Infinity;
    if (h > SOFT_LIMIT_H.sim) out.push({ id: `sim:${p.id}`, clears: "mac", ageH: h, softH: SOFT_LIMIT_H.sim, what: `sim request not run: ${p.id}`, needs: "the Mac runs it (pnpm run sim:run-requests)" });
  }
  for (const r of routines) {
    if (r.status !== "active" || !r.heartbeatPath || !(r.cadenceToleranceHours > 0)) continue;
    const raw = heartbeats[r.heartbeatPath];
    let firedAt;
    try { firedAt = raw === undefined ? undefined : JSON.parse(raw).firedAt; } catch { firedAt = undefined; }
    const h = age(firedAt, nowMs);
    if (h > r.cadenceToleranceHours) out.push({ id: `heartbeat:${r.id}`, clears: r.id.startsWith("mac-lane-tick") || r.trigger?.startsWith?.("launchd:") ? "mac" : "cloud", ageH: h, softH: r.cadenceToleranceHours, what: `routine ${r.id} silent ${fmtAge(h)} (tolerance ${r.cadenceToleranceHours}h)`, needs: raw === undefined ? "its first heartbeat" : "the routine fires again, or its lane says why it cannot" });
  }
  for (const pr of prs) {
    const h = age(pr.updatedAt, nowMs);
    if (pr.state === "nocheck" && h > SOFT_LIMIT_H["pr-red"]) out.push({ id: `pr-red:${pr.number}`, clears: pr.lane, ageH: h, softH: SOFT_LIMIT_H["pr-red"], what: `PR #${pr.number} has NO gating check result, untouched ${fmtAge(h)}: ${pr.title}`, needs: "find why CI never reported (conflict, workflow skipped, renamed job) and get it to run", where: pr.url });
    else if (pr.state === "red" && h > SOFT_LIMIT_H["pr-red"]) out.push({ id: `pr-red:${pr.number}`, clears: pr.lane, ageH: h, softH: SOFT_LIMIT_H["pr-red"], what: `PR #${pr.number} red, untouched ${fmtAge(h)}: ${pr.title}`, needs: "a fix pushed, or the blocker stated on the PR", where: pr.url });
    else if (pr.state === "conflict" && h > SOFT_LIMIT_H["pr-red"]) out.push({ id: `pr-red:${pr.number}`, clears: pr.lane, ageH: h, softH: SOFT_LIMIT_H["pr-red"], what: `PR #${pr.number} conflicted, untouched ${fmtAge(h)}: ${pr.title}`, needs: "merge the base in and regenerate", where: pr.url });
    else if (pr.state === "green" && h > SOFT_LIMIT_H["pr-idle"]) out.push({ id: `pr-idle:${pr.number}`, clears: "owner", ageH: h, softH: SOFT_LIMIT_H["pr-idle"], what: `PR #${pr.number} green and idle ${fmtAge(h)}: ${pr.title}`, needs: "merge or close", where: pr.url });
  }
  // THE EXECUTOR GAP (DR-056 → DR-054). The objective loop ranks the backlog by role, and a
  // row whose every role resolves to "lane" (nothing dedicated) or dangles goes to
  // needsExecutor[] — work the brain has named and nobody is built to do. Those rows sat in
  // docs/agent/objective-state.json with no hand raised. ONE aggregated hand, aged from the
  // loop's own derivedAt (rewritten only when the decision changes, so it holds while the rows
  // persist), routed to the blocker-dispatcher. Only a WITNESSED state counts (readVerdict:
  // the tick heartbeat is fresh and names this verdict) — an unwitnessed state's rows are not
  // known to be current, and a silent tick is already the heartbeat hand above.
  if (objective?.witnessed && Array.isArray(objective.needsExecutor) && objective.needsExecutor.length > 0) {
    const h = age(objective.derivedAt, nowMs);
    const rows = objective.needsExecutor.map((n) => n.rowId).join(", ");
    if (h > SOFT_LIMIT_H["executor-gap"]) out.push({ id: "executor-gap:objective-state", clears: "cloud", ageH: h, softH: SOFT_LIMIT_H["executor-gap"], what: `${objective.needsExecutor.length} backlog row(s) the objective loop cannot rank — every named role resolves to "lane" or dangles: rows ${rows}`, needs: "a dedicated executor (agent or skill) for the role, or the row re-owned by a role that has one — the blocker-dispatcher decides which (docs/agent/hand-routing.json executor-gap)" });
  }
  // OWNER-SCOPED ESCALATIONS. objective-loop mails each NEW escalation once to the other lane (the
  // cloud, from the Mac tick), whoever clears it: an owner ask therefore never reaches the owner,
  // and one already in the committed state when delivery began was never mailed at all — it sat in
  // objective-state.json. One hand per escalation, aged from its own `since` (the loop carries it
  // across ticks), witnessed states only, as above.
  if (objective?.witnessed) {
    for (const e of objective.escalations ?? []) {
      if (e?.clears !== "owner") continue;
      const h = age(e.since, nowMs);
      if (h > SOFT_LIMIT_H["objective-owner"]) out.push({ id: `objective-owner:${e.id}`, clears: "owner", ageH: h, softH: SOFT_LIMIT_H["objective-owner"], what: e.asks, needs: "the owner decides; the loop re-derives" });
    }
  }
  // THE WEEKLY MAC-LANE RUN (.github/workflows/mac-lane.yml, --github only). A red run of the full
  // suite on macOS raised nothing: it was one red row in the Actions tab. Only a run that FAILED
  // counts — success is green, and cancelled is concurrency replacing a same-SHA duplicate. The
  // hand is per run id, so it clears itself when the next run completes.
  if (macLane && ["failure", "timed_out", "startup_failure"].includes(macLane.conclusion)) {
    const h = age(macLane.updatedAt, nowMs);
    if (h > SOFT_LIMIT_H["mac-lane-red"]) out.push({ id: `mac-lane-red:${macLane.id}`, clears: "mac", ageH: h, softH: SOFT_LIMIT_H["mac-lane-red"], what: `the weekly Mac-lane run ${macLane.id} ended ${macLane.conclusion}, ${fmtAge(h)} ago`, needs: "the Mac lane reads the run, reproduces it with ./validate-sim-macos.sh, and fixes it or states the blocker", where: macLane.url });
  }
  return out;
}

/** The whole picture: open raised hands (with OVERDUE) + auto hands (with covered/uncovered). */
export function evaluate(records, autos, nowMs = Date.now(), route = () => ({ kind: "gap" }), measured = AUTO_KINDS) {
  const open = records.filter((h) => !h.__unreadable && h.status !== "resolved").map((h) => {
    const ageH = age(h.raisedAt, nowMs);
    const { group, label } = groupOf(h, route(h));
    return { ...h, ageH, group, label, overdue: ageH > (RAISED_LIMIT_H[group] ?? 24) };
  });
  const covered = new Set(open.flatMap((h) => h.covers ?? []));
  const auto = autos.map((a) => ({ ...a, covered: covered.has(a.id), hard: a.ageH > a.softH * HARD_MULTIPLE }));
  const fatal = auto.filter((a) => a.hard && !a.covered).map((a) => `${a.id}: ${a.what} — ${fmtAge(a.ageH)}, past the ${a.softH * HARD_MULTIPLE}h limit and NO hand raised. Act, or: pnpm run hand:raise -- --who ${a.clears === "owner" ? "owner" : `"${a.clears} lane"`} --covers ${a.id} --doing "…" --blocked "…" --need "…"`);
  const staleCovers = [...covered].filter((c) => !autos.some((a) => a.id === c)).map((c) => `a hand covers ${c}, which is no longer stuck — clear that hand`);
  const stale = staleHands(open, autos, measured);
  // THE MONITOR ON HAND-RAISING ITSELF (owner, 2026-09-23: "build something that
  // monitors the raise your hand function"). Two numbers: how much stuck work the
  // system had to find because no agent said so, and how many lane hands nobody
  // has picked up. Both are on the owner's page, every hour.
  const health = {
    systemFound: auto.filter((a) => !a.covered).length,
    agentRaised: open.length,
    untaken: open.filter((h) => h.group !== "owner" && !h.takenBy && h.ageH > UNTAKEN_LIMIT_H).map((h) => h.id),
  };
  return { open, auto, fatal, staleCovers, stale, health };
}

/** Pure: split the open hands by what their `covers` point at. A cover whose auto-stall kind was
 *  MEASURED this run and is no longer stuck makes the hand stale (fatal); a kind this run could not
 *  measure (PR checks without --github, an unwitnessed objective state) is reported, never failed;
 *  a hand covering nothing auto is an owner-only decision and exempt. */
export function staleHands(open, autos, measured = AUTO_KINDS) {
  const fatal = [], unknown = [], unmeasured = [], exempt = [];
  for (const h of open) {
    const covers = Array.isArray(h.covers) ? h.covers.filter((c) => typeof c === "string") : [];
    if (covers.length === 0) { exempt.push(h.id); continue; } // check-raised-hands.mjs owns a malformed `covers`
    for (const c of covers) {
      const kind = c.split(":")[0];
      // An unrecognised kind (a typo, or a kind with no detector) is NOT an owner decision: it would
      // switch the stale check off for that hand. Unknown fails.
      if (!AUTO_KINDS.includes(kind)) { unknown.push(`hand ${h.id} covers "${c}", whose kind "${kind}" is not an auto-stall kind (${AUTO_KINDS.join(", ")}) — fix the --covers id, or drop it if this hand covers no measured stall`); continue; }
      if (autos.some((a) => a.id === c)) continue;
      if (!measured.includes(kind)) { unmeasured.push(`${h.id} covers ${c} (kind not measured on this run)`); continue; }
      // A hand younger than its stall's soft limit cannot be judged stale: the stall only enters the
      // auto list past that limit, so an early hand on a real stall would otherwise fail the moment
      // it is raised. (heartbeat's limit is per-routine and unknown here; it has no grace.)
      if (Number.isFinite(h.ageH) && h.ageH <= (SOFT_LIMIT_H[kind] ?? 0)) continue;
      fatal.push(`hand ${h.id} covers ${c}, whose stall is no longer measured — the hand is stale. Clear it: pnpm run hand:clear -- ${h.id} "<what unblocked it>"`);
    }
  }
  return { fatal, unknown, unmeasured, exempt };
}

// ── the tip: stalls are measured from origin/SignalGrid_Alpha, not the branch tree ──────────
export const TIP_REF = "origin/SignalGrid_Alpha";
export class TipMissing extends Error {}
const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" });
/** A throwaway detached checkout of the tip. Throws TipMissing (fail closed) when the ref is absent. */
export function openTip(cwd = repo, ref = TIP_REF) {
  const sha = git(cwd, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
  if (sha.status !== 0) throw new TipMissing(`${ref} does not exist in this checkout — stalls cannot be measured, and an unknown stall state never reads as "no stall". Fetch it: git fetch origin SignalGrid_Alpha`);
  const root = mkdtempSync(join(realpathSync(tmpdir()), "raised-hands-tip-"));
  const wt = git(cwd, ["worktree", "add", "--detach", "--force", root, ref]);
  if (wt.status !== 0) { rmSync(root, { recursive: true, force: true }); throw new TipMissing(`could not check out ${ref}: ${wt.stderr.trim()}`); }
  const date = git(cwd, ["log", "-1", "--format=%cI", ref]).stdout.trim();
  return { root, sha: sha.stdout.trim(), ref, date, close() { git(cwd, ["worktree", "remove", "--force", root]); rmSync(root, { recursive: true, force: true }); git(cwd, ["worktree", "prune"]); } };
}

/** Pure: the --check verdict. `problems` are integrity (always fatal); `stalls` are
 *  view.fatal — other people's clocks, fatal unless `warn`. */
export function checkOutcome(problems, stalls, { warn = false } = {}) {
  const own = stalls.filter((f) => f.startsWith(`sim:${SIM_UNREADABLE}:`));
  const fatal = [...problems, ...own, ...(warn ? [] : stalls.filter((f) => !own.includes(f)))];
  const warned = warn ? stalls.filter((f) => !own.includes(f)) : [];
  return { code: fatal.length > 0 ? 1 : 0, fatal, warned };
}

// ── rendering ────────────────────────────────────────────────────────────────
const WHO = { owner: "Needs you (Dan)", cloud: "Needs the cloud lane", mac: "Needs the Mac lane", role: "Routed to a role", tool: "Needs a tool", gap: "Capability GAP — the blocker-dispatcher must route or create" };
export function render({ open, auto }, { markdown = false, prsChecked = false } = {}) {
  const rows = [
    ...open.map((h) => ({ group: h.group, ageH: h.ageH, text: `${h.overdue ? "OVERDUE " : ""}${h.group === "role" || h.group === "tool" ? `[${h.label}] ` : ""}${h.doing} — blocked by: ${h.blockedBy} — needs: ${h.need}${h.where ? ` — ${h.where}` : ""} (raised by ${h.origin ?? "?"}${h.takenBy ? `; taken by ${h.takenBy}` : ""}; \`${h.id}\`)` })),
    ...auto.filter((a) => !a.covered).map((a) => ({ group: a.clears, ageH: a.ageH, text: `${a.hard ? "PAST LIMIT " : ""}${a.what} — needs: ${a.needs}${a.where ? ` — ${a.where}` : ""} (auto; nobody raised a hand; \`${a.id}\`)` })),
  ];
  const lines = [];
  const total = rows.length;
  lines.push(markdown ? `# Raised hands — ${total} open` : `Raised hands — ${total} open${prsChecked ? "" : " (PRs and the weekly Mac-lane run NOT CHECKED here — the hourly issue job checks them)"}`);
  if (markdown) lines.push("", `Oldest first. Anything marked OVERDUE or PAST LIMIT has waited too long.${prsChecked ? "" : " PRs and the weekly Mac-lane run were NOT checked on this run."}`);
  for (const who of GROUP_ORDER) {
    const mine = rows.filter((r) => r.group === who).sort((a, b) => b.ageH - a.ageH);
    if (mine.length === 0) continue;
    lines.push("", markdown ? `## ${WHO[who]} — ${mine.length}` : `  ${WHO[who]} — ${mine.length}`);
    for (const r of mine) lines.push(markdown ? `- **${fmtAge(r.ageH)}** ${r.text}` : `    · [${fmtAge(r.ageH)}] ${r.text}`);
  }
  if (total === 0) lines.push("", markdown ? "Nobody is stuck." : "  nobody is stuck");
  const hh = arguments[0].health;
  if (hh) {
    const note = `Hand-raising health: ${hh.agentRaised} raised by an agent, ${hh.systemFound} found by the system with no hand raised${hh.untaken.length ? `, ${hh.untaken.length} lane hand(s) nobody has taken for ${UNTAKEN_LIMIT_H}h+ (${hh.untaken.join(", ")})` : ""}.`;
    lines.push("", markdown ? `_${note}_` : `  ${note}`);
  }
  return lines.join("\n");
}

// ── loaders (the real tree) ──────────────────────────────────────────────────
async function loadInputs({ github = false, root = repo } = {}) {
  process.env.SIGNALGRID_LANE_REPO = root; // lane-message.mjs reads the mailbox from here, at import
  const { loadMessages, loadAcks } = await import(pathToFileURL(join(repo, "scripts/lane-message.mjs")).href);
  const { load: loadRoutines } = await import(pathToFileURL(join(repo, "scripts/check-scheduled-routines.mjs")).href);
  const { registry, heartbeats } = loadRoutines(root);
  // Sim pending is read from the gate's own output so "pending" means exactly what
  // the sim-request gate says it means — one definition, not two.
  const sim = spawnSync("node", [join(root, "scripts/check-sim-requests.mjs")], { cwd: root, encoding: "utf8" });
  const simPending = [];
  // A sim gate that printed nothing is not a sim loop with nothing pending: say so,
  // aged as unknown (never fresh), so the stuck list cannot go quiet by crashing.
  if (!/Simulation request loop —/.test(sim.stdout ?? "")) simPending.push({ id: SIM_UNREADABLE, ageDays: NaN });
  for (const line of (sim.stdout ?? "").split("\n")) {
    const m = /^\s+· (\S+) → (.*)$/.exec(line);
    if (!m || !/still queued|NOT run/.test(m[2])) continue;
    const d = /(\d+) day\(s\) old/.exec(m[2]);
    simPending.push({ id: m[1], ageDays: d ? Number(d[1]) : NaN });
  }
  const api = github ? githubApi() : null; // --check without --github never needs a token
  const prs = github ? await loadPrs(api) : [];
  const macLane = github ? await loadMacLane(api) : null;
  // The objective state, witnessed by the tick heartbeat (DR-056 reader rule). Absent or
  // malformed is NOT a stall here — `objective-loop.mjs --check` (preflight + CI) owns that.
  let objective = null;
  try {
    const state = JSON.parse(readFileSync(join(root, "docs/agent/objective-state.json"), "utf8"));
    const { readVerdict } = await import(pathToFileURL(join(repo, "scripts/objective-loop.mjs")).href);
    const hbRaw = heartbeats["artifacts/agent-heartbeats/mac-lane-tick.json"];
    let heartbeat = null;
    try { heartbeat = hbRaw === undefined ? null : JSON.parse(hbRaw); } catch { heartbeat = null; }
    objective = { needsExecutor: state.needsExecutor ?? [], escalations: state.escalations ?? [], derivedAt: state.derivedAt, witnessed: readVerdict(state, { heartbeat, nowIso: new Date().toISOString() }).verdict !== "unknown" };
  } catch { objective = null; }
  return { messages: loadMessages(), acks: loadAcks(), simPending, routines: registry.routines ?? [], heartbeats, prs, objective, macLane };
}

const GATING_CHECK = "Typecheck, build, and proof scaffold";
function githubApi() {
  const token = process.env.GITHUB_TOKEN;
  const slug = process.env.GITHUB_REPOSITORY;
  if (!token || !slug) throw new Error("--github needs GITHUB_TOKEN and GITHUB_REPOSITORY — refusing to report PRs as checked when they were not");
  return async (path) => {
    const r = await fetch(`https://api.github.com/repos/${slug}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
    return r.json();
  };
}

/** The newest run whose outcome is KNOWN, from a newest-first list of completed runs: a cancelled
 *  run (a manual cancel, or concurrency killing a same-SHA duplicate) and a skipped one say nothing
 *  about the suite, so they must not hide the red run behind them — an unknown outcome loosens the
 *  answer. Null when the list holds no decisive run. */
export const latestDecisiveRun = (runs) => {
  const r = (runs ?? []).find((x) => !["cancelled", "skipped"].includes(x?.conclusion));
  return r ? { id: r.id, conclusion: r.conclusion, url: r.html_url, updatedAt: r.updated_at } : null;
};

/** The latest decisive COMPLETED weekly Mac-lane run on mainline, or null when there is none.
 *  A failed fetch throws (like loadPrs): a run we could not read is not a green one.
 *  ponytail: a green `sim_only` workflow_dispatch run is the newest run and hides a red full-suite
 *  one — the runs API cannot tell them apart because mac-lane.yml sets no `run-name`. Upgrade:
 *  a `run-name` carrying `sim_only`, which this loader then skips. */
async function loadMacLane(api) {
  const { workflow_runs: runs } = await api("/actions/workflows/mac-lane.yml/runs?branch=SignalGrid_Alpha&status=completed&per_page=10");
  return latestDecisiveRun(runs);
}

async function loadPrs(api) {
  const mailbox = JSON.parse(readFileSync(join(repo, "docs/agent/lane-mailbox.json"), "utf8")).pr;
  const list = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/pulls?state=open&per_page=100&page=${page}`);
    list.push(...batch);
    if (batch.length < 100) break;
  }
  const prs = [];
  for (const p of list) {
    if (p.number === mailbox || p.draft) continue; // the mailbox PR is open by design; a draft is not asking for anything yet
    const full = await api(`/pulls/${p.number}`);
    const runs = await api(`/commits/${p.head.sha}/check-runs?check_name=${encodeURIComponent(GATING_CHECK)}`);
    const run = runs.check_runs?.[0];
    // NO gating check-run at all is not "still running": it is either a PR CI never
    // reached, or GATING_CHECK no longer matches the job name — both read as red,
    // never as a quiet pending (below, a rename that blanks EVERY PR throws).
    const state = full.mergeable_state === "dirty" ? "conflict" : !run ? "nocheck" : run.conclusion === "failure" ? "red" : run.conclusion === "success" ? "green" : "pending";
    const ref = p.head?.ref ?? "";
    const lane = ref.startsWith("mac/") ? "mac" : "cloud"; // claude/*, lane/cloud-*, dependabot/* are the cloud lane's to drive
    prs.push({ number: p.number, title: p.title, url: p.html_url, updatedAt: p.updated_at, state, lane });
  }
  if (prs.length >= 3 && prs.every((p) => p.state === "nocheck")) {
    throw new Error(`no open PR carries a "${GATING_CHECK}" check-run — the job was renamed or CI is not running; fix GATING_CHECK in scripts/raised-hands.mjs rather than report every PR as quiet`);
  }
  return prs;
}

// ── self-test ────────────────────────────────────────────────────────────────
async function selfTest() {
  const T = Date.parse("2026-09-23T12:00:00Z");
  const ago = (h) => new Date(T - h * H).toISOString();
  const checks = [];
  const hand = (x = {}) => ({ id: "h1", __file: "h1.json", raisedAt: ago(1), origin: "cloud", doing: "d", blockedBy: "b", need: "n", whoCanUnblock: "owner", status: "open", ...x });
  const route = (h) => (String(h.whoCanUnblock).startsWith("owner") ? { kind: "human" } : String(h.whoCanUnblock).includes("lane") ? { kind: "lane" } : { kind: "gap" });

  checks.push(["a well-formed hand is coherent", auditHands([hand()]).length === 0]);
  checks.push(["a hand with no `need` is fatal — it cannot be acted on", auditHands([hand({ need: " " })]).some((p) => p.includes("no need"))]);
  checks.push(["an UNREADABLE ledger file is fatal — never dropped", auditHands([{ __file: "x.json", __unreadable: "bad json" }]).some((p) => p.includes("does not parse"))]);
  checks.push(["an id that disagrees with its filename is fatal", auditHands([hand({ __file: "other.json" })]).some((p) => p.includes("filename"))]);
  checks.push(["an unparseable raisedAt is fatal", auditHands([hand({ raisedAt: "soon" })]).some((p) => p.includes("raisedAt"))]);
  checks.push(["a resolved hand with no resolution is fatal", auditHands([hand({ status: "resolved", resolvedAt: ago(0) })]).some((p) => p.includes("no resolution"))]);
  checks.push(["duplicate ids are fatal", auditHands([hand(), hand()]).some((p) => p.includes("duplicate"))]);
  checks.push(["'the other lane' raised by the Mac is the cloud's", groupOf(hand({ whoCanUnblock: "the other lane", origin: "mac-lane" }), { kind: "lane" }).group === "cloud"]);

  const msg = (h, extra = {}) => ({ id: "m1", from: "cloud", to: "mac", subject: "s", sentAt: ago(h), ...extra });
  let a = autoHands({ messages: [msg(10)] }, T);
  checks.push(["mail unread 10h is not a hand yet", a.length === 0]);
  a = autoHands({ messages: [msg(30)] }, T);
  checks.push(["mail unread 30h is an AUTO hand for the addressee", a.length === 1 && a[0].id === "mail:m1" && a[0].clears === "mac"]);
  checks.push(["…acked mail is not", autoHands({ messages: [msg(30)], acks: [{ messageId: "m1" }] }, T).length === 0]);
  checks.push(["…superseded mail is not", autoHands({ messages: [msg(30), { id: "m2", from: "cloud", to: "mac", subject: "s", sentAt: ago(1), supersedes: "m1" }] }, T).length === 0]);
  checks.push(["UNKNOWN IS NEVER FRESH — mail with no instant at all is a hand", autoHands({ messages: [msg(0, { sentAt: undefined })] }, T).length === 1]);

  let e = evaluate([], autoHands({ messages: [msg(80)] }, T), T, route);
  checks.push(["mail silent past 3×24h with NO hand raised FAILS the gate", e.fatal.length === 1 && e.fatal[0].startsWith("mail:m1")]);
  e = evaluate([hand({ whoCanUnblock: "mac lane", covers: ["mail:m1"] })], autoHands({ messages: [msg(80)] }, T), T, route);
  checks.push(["…and one raised hand covering it clears the gate (the cure is to say so)", e.fatal.length === 0 && e.auto[0].covered]);
  e = evaluate([hand({ status: "resolved", resolvedAt: ago(0), resolution: "r", covers: ["mail:m1"] })], autoHands({ messages: [msg(80)] }, T), T, route);
  checks.push(["…but a CLEARED hand covers nothing", e.fatal.length === 1]);
  e = evaluate([hand({ raisedAt: ago(60) })], [], T, route);
  checks.push(["an owner hand open 60h is OVERDUE, and overdue is not fatal", e.open[0].overdue && e.fatal.length === 0]);
  e = evaluate([hand({ covers: ["mail:gone"] })], [], T, route);
  checks.push(["a hand covering a stall that resolved is reported for clearing", e.staleCovers.length === 1]);

  a = autoHands({ simPending: [{ id: "r1", ageDays: 3 }, { id: "r2", ageDays: NaN }, { id: "r3", ageDays: 1 }] }, T);
  checks.push(["sim pending 3d and of unknown age are hands; 1d is not", a.map((x) => x.id).join() === "sim:r1,sim:r2"]);

  const routine = { id: "r", status: "active", heartbeatPath: "hb/r.json", cadenceToleranceHours: 3 };
  checks.push(["a heartbeat past tolerance is a hand", autoHands({ routines: [routine], heartbeats: { "hb/r.json": JSON.stringify({ firedAt: ago(5) }) } }, T).length === 1]);
  checks.push(["…within tolerance is not", autoHands({ routines: [routine], heartbeats: { "hb/r.json": JSON.stringify({ firedAt: ago(1) }) } }, T).length === 0]);
  checks.push(["…a MISSING heartbeat is a hand (absent is never fresh)", autoHands({ routines: [routine], heartbeats: {} }, T).length === 1]);
  checks.push(["…a retired routine is not", autoHands({ routines: [{ ...routine, status: "retired" }], heartbeats: {} }, T).length === 0]);

  const pr = (state, h) => ({ number: 7, title: "t", url: "u", updatedAt: ago(h), state, lane: "cloud" });
  checks.push(["a PR red 30h is the lane's hand", autoHands({ prs: [pr("red", 30)] }, T)[0]?.clears === "cloud"]);
  checks.push(["a PR green and idle 50h is the OWNER's hand", autoHands({ prs: [pr("green", 50)] }, T)[0]?.clears === "owner"]);
  checks.push(["a PR pending CI is nobody's hand", autoHands({ prs: [pr("pending", 90)] }, T).length === 0]);
  checks.push(["a PR with NO gating check-run at all is a hand, never a quiet pending", autoHands({ prs: [pr("nocheck", 30)] }, T)[0]?.id === "pr-red:7"]);
  // the bridge from check-sim-requests.mjs's real output: every pending shape carries an age
  const simLine = (tail) => /(\d+) day\(s\) old/.test(tail);
  checks.push(["every sim pending shape the sim gate prints carries an age (a missing age reads as infinitely old)", ["api (result exists but this operation has no row: NOT run; 0 day(s) old)", "api (refused_platform on linux: attempted, NOT run — still needs a machine that can; 2 day(s) old)", "every run still queued (no result yet; 1 day(s) old)"].every(simLine)]);

  const text = render(evaluate([hand()], autoHands({ messages: [msg(30)] }, T), T, route), { markdown: true, prsChecked: true });
  checks.push(["the owner's page groups by who clears it and names both kinds", text.includes("## Needs you (Dan) — 1") && text.includes("## Needs the Mac lane — 1") && text.includes("(auto; nobody raised a hand")]);
  checks.push(["a run that did not check PRs or the Mac-lane run SAYS so", render(evaluate([], [], T, route), { markdown: true }).includes("PRs and the weekly Mac-lane run were NOT checked")]);

  // routing
  const allExist = () => true;
  const full = { routes: Object.fromEntries(REQUIRED_ROUTES.map((k) => [k, { responder: { owner: true }, action: "a" }])) };
  checks.push(["a routing table covering every kind is clean", auditRouting(full, allExist).length === 0]);
  const { sim: _dropped, ...partial } = full.routes;
  checks.push(["a stall kind with NO route is fatal — it would be detected and answered by nobody", auditRouting({ routes: partial }, allExist).some((p) => p.includes('"sim"'))]);
  checks.push(["a route naming an agent that does not exist is fatal", auditRouting({ routes: { ...full.routes, "pr-red": { responder: { agent: "ghost" }, action: "a" } } }, (k, n) => n !== "ghost").some((p) => p.includes("ghost"))]);
  checks.push(["a route naming a skill that does not exist is fatal", auditRouting({ routes: { ...full.routes, owner: { responder: { owner: true }, skills: ["nope"], action: "a" } } }, (k, n) => n !== "nope").some((p) => p.includes("nope"))]);
  checks.push(["a route with no action is fatal", auditRouting({ routes: { ...full.routes, mail: { responder: { lane: "addressee" }, action: " " } } }, allExist).some((p) => p.includes("no action"))]);
  // the monitor on hand-raising itself
  e = evaluate([hand({ whoCanUnblock: "cloud lane", raisedAt: ago(3) })], autoHands({ messages: [msg(30)] }, T), T, route);
  checks.push(["health counts what the SYSTEM found with no hand raised", e.health.systemFound === 1 && e.health.agentRaised === 1]);
  checks.push(["health names a lane hand nobody has taken for 2h+", e.health.untaken.join() === "h1"]);
  e = evaluate([hand({ whoCanUnblock: "cloud lane", raisedAt: ago(3), takenBy: "blocker-dispatcher", takenAt: ago(1) })], [], T, route);
  checks.push(["…and a taken hand is not untaken", e.health.untaken.length === 0]);
  checks.push(["an owner hand is never 'untaken' — only the owner can take it", evaluate([hand({ raisedAt: ago(5) })], [], T, route).health.untaken.length === 0]);
  checks.push(["takenBy with no takenAt is incoherent", auditHands([hand({ takenBy: "x" })]).some((p) => p.includes("takenAt"))]);
  checks.push(["the owner's page carries the health line", render(evaluate([], [], T, route), { markdown: true }).includes("Hand-raising health:")]);
  // --warn: lenient on other people's clocks, never on the register's own integrity
  const stall = evaluate([], autoHands({ messages: [msg(80)] }, T), T, route).fatal;
  const broken = auditHands([{ __file: "x.json", __unreadable: "bad json" }]);
  const noSim = evaluate([], autoHands({ simPending: [{ id: SIM_UNREADABLE, ageDays: NaN }] }, T), T, route).fatal;
  checks.push(["a stalled auto hand exits 1 by default", stall.length === 1 && checkOutcome([], stall).code === 1]);
  checks.push(["…and exits 0 under --warn, still printed as a warning", checkOutcome([], stall, { warn: true }).code === 0 && checkOutcome([], stall, { warn: true }).warned.length === 1]);
  checks.push(["an integrity failure exits 1 by default", broken.length === 1 && checkOutcome(broken, []).code === 1]);
  checks.push(["…and exits 1 under --warn too", checkOutcome(broken, [], { warn: true }).code === 1]);
  checks.push(["a sim gate that printed nothing exits 1 under --warn (our loader, not a clock)", noSim.length === 1 && checkOutcome([], noSim, { warn: true }).code === 1]);
  checks.push(["…and a route naming a missing agent exits 1 under --warn", checkOutcome(auditRouting({ routes: { ...full.routes, mail: { responder: { agent: "ghost" }, action: "a" } } }, (k, n) => n !== "ghost"), stall, { warn: true }).code === 1]);

  // the executor gap (DR-056 → DR-054): one aggregated hand, only from a witnessed state
  const gap = (over = {}) => ({ needsExecutor: [{ rowId: "19", title: "t", roles: ["sre"] }, { rowId: "22", title: "u", roles: ["finance-fundraising"] }], derivedAt: ago(60), witnessed: true, ...over });
  a = autoHands({ objective: gap() }, T);
  checks.push(["needsExecutor rows standing 60h in a WITNESSED state are ONE aggregated cloud hand naming the rows", a.length === 1 && a[0].id === "executor-gap:objective-state" && a[0].clears === "cloud" && a[0].what.includes("rows 19, 22")]);
  checks.push(["…the same rows in an UNWITNESSED state are not (the rows are not known to be current; a silent tick is the heartbeat hand)", autoHands({ objective: gap({ witnessed: false }) }, T).length === 0]);
  checks.push(["…rows standing 10h are not a hand yet", autoHands({ objective: gap({ derivedAt: ago(10) }) }, T).length === 0]);
  checks.push(["…and no rows is no hand", autoHands({ objective: gap({ needsExecutor: [] }) }, T).length === 0]);
  checks.push(["…a witnessed state with NO derivedAt ages as unknown (never fresh) — a hand", autoHands({ objective: gap({ derivedAt: undefined }) }, T).length === 1]);
  checks.push(["executor-gap is a REQUIRED route — a routing table without it is fatal", REQUIRED_ROUTES.includes("executor-gap") && auditRouting({ routes: Object.fromEntries(REQUIRED_ROUTES.filter((k) => k !== "executor-gap").map((k) => [k, { responder: { owner: true }, action: "a" }])) }, allExist).some((p) => p.includes('"executor-gap"'))]);

  // owner-scoped objective escalations: the loop's `clears: owner` asks reach the owner's page
  const esc = (over = {}) => ({ escalations: [{ id: "rows-awaiting-owner", clears: "owner", asks: "decide", since: ago(50) }], witnessed: true, ...over });
  a = autoHands({ objective: esc() }, T);
  checks.push(["a WITNESSED owner escalation standing 50h is ONE owner hand, aged from `since`", a.length === 1 && a[0].id === "objective-owner:rows-awaiting-owner" && a[0].clears === "owner" && a[0].what === "decide" && Math.round(a[0].ageH) === 50]);
  checks.push(["…the same escalation in an UNWITNESSED state is not", autoHands({ objective: esc({ witnessed: false }) }, T).length === 0]);
  checks.push(["…a `clears: cloud` or `mac` escalation is not an owner hand", autoHands({ objective: esc({ escalations: [{ id: "a", clears: "cloud", since: ago(50) }, { id: "b", clears: "mac", since: ago(50) }] }) }, T).length === 0]);
  checks.push(["…standing 10h is not a hand yet", autoHands({ objective: esc({ escalations: [{ id: "a", clears: "owner", since: ago(10) }] }) }, T).length === 0]);
  checks.push(["…with no `since` it ages as unknown (never fresh) — a hand", autoHands({ objective: esc({ escalations: [{ id: "a", clears: "owner" }] }) }, T).length === 1]);
  checks.push(["…two owner escalations are two hands", autoHands({ objective: esc({ escalations: [{ id: "a", clears: "owner", since: ago(50) }, { id: "b", clears: "owner", since: ago(60) }] }) }, T).length === 2]);
  e = evaluate([], autoHands({ objective: esc({ escalations: [{ id: "a", clears: "owner", since: ago(150) }] }) }, T), T, route);
  checks.push(["…standing past 3×48h with NO hand raised FAILS the gate", e.fatal.length === 1 && e.fatal[0].startsWith("objective-owner:a") && e.fatal[0].includes("--who owner")]);
  e = evaluate([hand({ covers: ["objective-owner:a"] })], autoHands({ objective: esc({ escalations: [{ id: "a", clears: "owner", since: ago(150) }] }) }, T), T, route);
  checks.push(["…and one raised owner hand covering it clears the gate", e.fatal.length === 0 && e.auto[0]?.covered === true]);

  // a red weekly Mac-lane run (.github/workflows/mac-lane.yml): only under --github, only a real failure
  const ml = (conclusion, h = 2) => ({ macLane: { conclusion, id: 7, updatedAt: ago(h), url: "u" } });
  a = autoHands(ml("failure"), T);
  checks.push(["a Mac-lane run that FAILED 2h ago is ONE Mac hand naming the run", a.length === 1 && a[0].id === "mac-lane-red:7" && a[0].clears === "mac" && a[0].where === "u"]);
  checks.push(["…timed_out and startup_failure are hands too", autoHands(ml("timed_out"), T).length === 1 && autoHands(ml("startup_failure"), T).length === 1]);
  checks.push(["…success and cancelled are not (concurrency cancels same-SHA duplicates)", autoHands(ml("success"), T).length === 0 && autoHands(ml("cancelled"), T).length === 0]);
  checks.push(["…a conclusion we do not know is not a hand either (only a named failure is red)", autoHands(ml("skipped"), T).length === 0 && autoHands(ml(null), T).length === 0 && autoHands({ macLane: null }, T).length === 0]);
  checks.push(["…failed 30 minutes ago is not a hand yet", autoHands(ml("failure", 0.5), T).length === 0]);
  checks.push(["…an unparseable updatedAt ages as unknown (never fresh) — a hand", autoHands({ macLane: { conclusion: "failure", id: 7, updatedAt: "soon" } }, T).length === 1]);
  // which run the loader reads: past the cancelled/skipped ones, to the newest with a known outcome
  const run = (conclusion, id) => ({ id, conclusion, html_url: `u${id}`, updated_at: `t${id}` });
  checks.push(["a raw API-shaped run maps to id, conclusion, url and updatedAt", JSON.stringify(latestDecisiveRun([run("failure", 5)])) === JSON.stringify({ id: 5, conclusion: "failure", url: "u5", updatedAt: "t5" })]);
  checks.push(["…a cancelled or skipped run newer than a failed one does not hide it", latestDecisiveRun([run("cancelled", 9), run("skipped", 8), run("failure", 7)])?.id === 7]);
  checks.push(["…a success newer than a failure IS the answer (the red one is superseded)", latestDecisiveRun([run("success", 9), run("failure", 7)])?.conclusion === "success"]);
  checks.push(["…no runs, or only cancelled ones, is null", latestDecisiveRun([]) === null && latestDecisiveRun(undefined) === null && latestDecisiveRun([run("cancelled", 1)]) === null]);
  // routing: the new kinds are REQUIRED, so a detector cannot ship without an answerer
  for (const k of ["objective-owner", "mac-lane-red"]) checks.push([`${k} is a REQUIRED route — a routing table without it is fatal`, REQUIRED_ROUTES.includes(k) && auditRouting({ routes: Object.fromEntries(REQUIRED_ROUTES.filter((r) => r !== k).map((r) => [r, { responder: { owner: true }, action: "a" }])) }, allExist).some((p) => p.includes(`"${k}"`))]);

  // (b) a stale hand: covers an auto-stall that is no longer measured -> fatal, with the clear command
  const openOf = (hs, autos, measured) => evaluate(hs, autos, T, route, measured);
  const old = (x = {}) => hand({ raisedAt: ago(100), ...x }); // past every soft limit, so no grace
  e = openOf([old({ covers: ["mail:gone"] })], []);
  checks.push(["a hand covering a stall that no longer exists is FATAL, with the exact clear command", e.stale.fatal.length === 1 && e.stale.fatal[0].includes('pnpm run hand:clear -- h1 "<what unblocked it>"') && checkOutcome(e.stale.fatal, []).code === 1]);
  checks.push(["…and under --warn it is a WARN (CI), not a failure: a lane's clock must not turn every branch red", checkOutcome([], e.stale.fatal, { warn: true }).code === 0 && checkOutcome([], e.stale.fatal, { warn: true }).warned.length === 1]);
  e = openOf([hand({ covers: ["mail:gone"], raisedAt: ago(10) })], []);
  checks.push(["…a hand younger than the stall's soft limit is not stale yet (an early hand on a real stall must not fail on arrival)", e.stale.fatal.length === 0]);
  e = openOf([old({ whoCanUnblock: "mac lane", covers: ["mail:m1"] })], autoHands({ messages: [msg(80)] }, T));
  checks.push(["…a hand covering a LIVE stall is not stale", e.stale.fatal.length === 0]);
  e = openOf([hand()], []);
  checks.push(["…an owner/lane-decision hand (covers nothing) is exempt, and listed as exempt", e.stale.fatal.length === 0 && e.stale.exempt.join() === "h1"]);
  e = openOf([old({ covers: ["mial:typo"] })], []);
  checks.push(["…a cover whose kind is NOT an auto-stall kind (a typo) FAILS as unknown, never exempt", e.stale.unknown.length === 1 && e.stale.exempt.length === 0 && checkOutcome(e.stale.unknown, [], { warn: true }).code === 1]);
  e = evaluate([old({ covers: ["pr-red:9"] })], [], T, route, ["mail", "sim", "heartbeat"]);
  checks.push(["…a cover of a kind this run did not measure (PRs without --github) is reported, never failed", e.stale.fatal.length === 0 && e.stale.unmeasured.length === 1]);
  e = openOf([old({ status: "resolved", resolvedAt: ago(0), resolution: "r", covers: ["mail:gone"] })], []);
  checks.push(["…a RESOLVED hand is not stale (it is already cleared)", e.stale.fatal.length === 0]);
  checks.push(["…a `covers` that is a string does not crash the rule (check-raised-hands names it)", (() => { try { return staleHands([{ id: "h", covers: "mail:abc", ageH: 99 }], []).exempt.length === 1; } catch { return false; } })()]);

  // (c) stalls are measured at the tip, not the branch tree
  const plant = async (workHb, tipHb) => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "rh-plant-"));
    const hbPath = "artifacts/agent-heartbeats/x.json";
    const g = (...a) => { const r = git(dir, a); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r; };
    try {
      g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
      mkdirSync(join(dir, "docs/agent"), { recursive: true }); mkdirSync(join(dir, "artifacts/agent-heartbeats"), { recursive: true });
      writeFileSync(join(dir, "docs/agent/scheduled-routines.json"), JSON.stringify({ routines: [{ id: "x-tick", status: "active", heartbeatPath: hbPath, cadenceToleranceHours: 3 }] }));
      writeFileSync(join(dir, hbPath), JSON.stringify({ firedAt: tipHb }));
      g("add", "-A"); g("commit", "-qm", "tip"); g("update-ref", "refs/remotes/origin/SignalGrid_Alpha", "HEAD");
      writeFileSync(join(dir, hbPath), JSON.stringify({ firedAt: workHb })); // the branch tree's copy, uncommitted
      const tip = openTip(dir);
      try {
        const { load } = await import(pathToFileURL(join(repo, "scripts/check-scheduled-routines.mjs")).href);
        const { registry, heartbeats } = load(tip.root);
        return autoHands({ routines: registry.routines, heartbeats }, T).length;
      } finally { tip.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  checks.push(["a STALE heartbeat in the branch tree with a FRESH one at the tip raises NO hand", (await plant(ago(20), ago(1))) === 0]);
  checks.push(["…the inverse (fresh in the branch tree, stale at the tip) raises a hand", (await plant(ago(1), ago(20))) === 1]);
  const bare = mkdtempSync(join(realpathSync(tmpdir()), "rh-bare-"));
  try { git(bare, ["init", "-q"]); let missing = false; try { openTip(bare); } catch (x) { missing = x instanceof TipMissing && x.message.includes("does not exist"); } checks.push(["a MISSING origin ref fails closed (TipMissing), never reads as no-stall", missing]); }
  finally { rmSync(bare, { recursive: true, force: true }); }

  // main() end to end: a temp git repo holding a copy of the scripts, run as the real CLI. The cases
  // above call openTip/evaluate directly and never see main's wiring (the TipMissing exit, the tip root,
  // the stale rule reaching checkOutcome, the printed source line).
  const e2e = mkdtempSync(join(realpathSync(tmpdir()), "rh-e2e-"));
  try {
    const g2 = (...a) => { const r = git(e2e, a); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
    g2("init", "-q"); g2("config", "user.email", "t@t"); g2("config", "user.name", "t");
    cpSync(join(repo, "scripts"), join(e2e, "scripts"), { recursive: true });
    cpSync(join(repo, ".claude"), join(e2e, ".claude"), { recursive: true });
    mkdirSync(join(e2e, "docs/agent"), { recursive: true }); mkdirSync(join(e2e, "artifacts/agent-heartbeats"), { recursive: true }); mkdirSync(join(e2e, LEDGER_DIR), { recursive: true });
    for (const f of ["org-roster.json", "hand-routing.json"]) cpSync(join(repo, "docs/agent", f), join(e2e, "docs/agent", f));
    writeFileSync(join(e2e, "docs/agent/scheduled-routines.json"), JSON.stringify({ routines: [{ id: "x-tick", status: "active", heartbeatPath: "artifacts/agent-heartbeats/x.json", cadenceToleranceHours: 3 }] }));
    const hbFile = join(e2e, "artifacts/agent-heartbeats/x.json");
    const hb = (hAgo) => writeFileSync(hbFile, JSON.stringify({ firedAt: new Date(Date.now() - hAgo * H).toISOString() }));
    const commit = (msg) => { g2("add", "-A"); g2("commit", "-qm", msg, "--allow-empty"); return g2("rev-parse", "HEAD"); };
    const main2 = (...a) => spawnSync("node", [join(e2e, "scripts/raised-hands.mjs"), "--check", ...a], { cwd: e2e, encoding: "utf8", env: { ...process.env, SIGNALGRID_LANE_REPO: e2e } });
    hb(1);
    const freshTip = commit("tip: fresh heartbeat");
    let r = main2();
    checks.push(["e2e: with NO origin ref the run FAILS CLOSED (rc 1, says so), even under --warn", r.status === 1 && r.stderr.includes("FAILED CLOSED") && !r.stderr.includes("TypeError") && main2("--warn").status === 1]);
    g2("update-ref", "refs/remotes/origin/SignalGrid_Alpha", freshTip);
    r = main2();
    checks.push(["e2e: a fresh tip is clean (rc 0) and the output names the ref and its sha", r.status === 0 && r.stdout.includes(`Stalls measured at origin/SignalGrid_Alpha @ ${freshTip.slice(0, 8)}`)]);
    hb(30); commit("branch: a STALE heartbeat committed at the branch HEAD (the B19 shape)");
    r = main2();
    checks.push(["e2e: a stale heartbeat COMMITTED at the branch HEAD, fresh at the tip, raises no hand (rc 0)", r.status === 0 && !r.stdout.includes("x-tick silent")]);
    g2("update-ref", "refs/remotes/origin/SignalGrid_Alpha", g2("rev-parse", "HEAD"));
    r = main2();
    checks.push(["e2e: the inverse — stale at the tip — is a stall that FAILS (rc 1)", r.status === 1 && r.stderr.includes("heartbeat:x-tick")]);
    checks.push(["e2e: …and under --warn it is a WARN (rc 0)", main2("--warn").status === 0]);
    hb(1); commit("tip: fresh again"); g2("update-ref", "refs/remotes/origin/SignalGrid_Alpha", g2("rev-parse", "HEAD"));
    const handBody = (id, extra = {}) => JSON.stringify({ id, raisedAt: new Date(Date.now() - 100 * H).toISOString(), origin: "cloud", doing: "d", blockedBy: "b", need: "n", whoCanUnblock: "owner", status: "open", ...extra });
    writeFileSync(join(e2e, LEDGER_DIR, "zz-stale.json"), handBody("zz-stale", { covers: ["heartbeat:x-tick"] }));
    r = main2();
    checks.push(["e2e: a hand covering a stall that is gone FAILS the run (rc 1) and prints the clear command", r.status === 1 && r.stderr.includes('pnpm run hand:clear -- zz-stale "<what unblocked it>"')]);
    checks.push(["e2e: …and under --warn exits 0 (CI: a lane's clock must not turn every branch red)", main2("--warn").status === 0]);
    writeFileSync(join(e2e, LEDGER_DIR, "zz-stale.json"), handBody("zz-stale", { covers: ["mial:typo"] }));
    checks.push(["e2e: a hand with a typo'd cover kind FAILS even under --warn (rc 1)", main2("--warn").status === 1]);
    rmSync(join(e2e, LEDGER_DIR, "zz-stale.json"));
    // a hand only the TIP carries must cover a stall the (older) branch tree reports
    hb(30); commit("branch: stale");
    const staleTip = g2("rev-parse", "HEAD");
    writeFileSync(join(e2e, LEDGER_DIR, "zz-tipcover.json"), handBody("zz-tipcover", { covers: ["heartbeat:x-tick"] }));
    commit("tip: stale heartbeat AND the hand covering it"); g2("update-ref", "refs/remotes/origin/SignalGrid_Alpha", g2("rev-parse", "HEAD"));
    g2("checkout", "-q", "--detach", staleTip); // the branch tree predates the hand
    r = main2();
    checks.push(["e2e: a stall covered by a hand that only the TIP carries is covered (no 'raise a duplicate')", r.status === 0 && !r.stderr.includes("NO hand raised")]);
  } finally { rmSync(e2e, { recursive: true, force: true }); }

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// ── main ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(await selfTest());
  const records = loadLedger();
  const exists = (kind, name) => existsSync(join(repo, kind === "agent" ? `.claude/agents/${name}.md` : `.claude/skills/${name}/SKILL.md`));
  const routingPath = join(repo, ROUTING_FILE);
  const problems = [...auditHands(records), ...(existsSync(routingPath) ? auditRouting(JSON.parse(readFileSync(routingPath, "utf8")), exists) : [`${ROUTING_FILE} is missing — no stall kind has a responder`])];
  if (argv.includes("--coherence")) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.log(problems.length === 0 ? "Raised hands register is coherent." : `Raised hands register FAILED: ${problems.length} problem(s).`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  const github = argv.includes("--github");
  const { routeHand } = await import(pathToFileURL(join(repo, "scripts/check-raised-hands.mjs")).href);
  let roleIds = new Set();
  try { const r = JSON.parse(readFileSync(join(repo, "docs/agent/org-roster.json"), "utf8")); roleIds = new Set((Array.isArray(r) ? r : r.roles ?? []).map((x) => x.id)); } catch { /* an unreadable roster routes every domain hand to GAP — loud, never quiet */ }
  let tip;
  try { tip = openTip(); } catch (e) {
    if (!(e instanceof TipMissing)) throw e;
    console.error(`Raised hands FAILED CLOSED: ${e.message}`);
    process.exit(1);
  }
  let inputs, tipRecords = [];
  try { inputs = await loadInputs({ github, root: tip.root }); tipRecords = loadLedger(tip.root); } finally { tip.close(); }
  // Hands are read from the branch tree AND the tip: a branch older than a mainline hand would
  // otherwise report its stall as "NO hand raised" and be told to raise a duplicate. The branch's
  // copy of a hand wins (it may have cleared it); the schema audit still reads the branch only.
  const branchIds = new Set(records.map((r) => r.id ?? r.__file));
  const allHands = [...records, ...tipRecords.filter((r) => !r.__unreadable && !branchIds.has(r.id))];
  const measuredKinds = [...AUTO_KINDS.filter((k) => !["pr-red", "pr-idle", "mac-lane-red", "executor-gap", "objective-owner"].includes(k)),
    ...(github ? ["pr-red", "pr-idle", "mac-lane-red"] : []), ...(inputs.objective?.witnessed ? ["executor-gap", "objective-owner"] : [])];
  const view = evaluate(allHands, autoHands(inputs), Date.now(), (h) => routeHand(h, roleIds), measuredKinds);
  if (!argv.includes("--markdown")) console.log(`Stalls measured at ${tip.ref} @ ${tip.sha.slice(0, 8)}, committed ${tip.date || "(date unknown)"} (the local ref: only as fresh as its last fetch; this branch's own tree is not read for stalls)\n`);
  if (argv.includes("--markdown")) {
    console.log(render(view, { markdown: true, prsChecked: github }));
    const ids = [...view.open.map((h) => h.id), ...view.auto.filter((a) => !a.covered).map((a) => a.id)].sort();
    console.log(`\n<!-- hand-ids: ${ids.join(",")} -->`);
    process.exit(0);
  }
  console.log(render(view, { prsChecked: github }));
  for (const s of view.staleCovers) console.log(`  · REPORTED: ${s}`);
  for (const u of view.stale.unmeasured) console.log(`  · NOT CHECKED: ${u}`);
  if (view.stale.exempt.length) console.log(`  · EXEMPT from the stale-hand rule (cover no auto-stall — owner or lane decisions, not measurable): ${view.stale.exempt.join(", ")}`);
  if (argv.includes("--check")) {
    const { code, fatal, warned } = checkOutcome([...problems, ...view.stale.unknown], [...view.fatal, ...view.stale.fatal], { warn: argv.includes("--warn") });
    for (const w of warned) console.log(`  WARN (would fail locally): ${w}`);
    if (code !== 0) {
      console.error(`\nRaised hands check FAILED: ${fatal.length} problem(s).`);
      for (const f of fatal) console.error(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log(warned.length
      ? `\nRaised hands check passed in --warn mode — ${warned.length} stall(s) past the limit WARNED above (fatal in local preflight); the register itself is coherent.`
      : "\nRaised hands check passed — nothing is stuck past its limit without a hand raised.");
  }
}
