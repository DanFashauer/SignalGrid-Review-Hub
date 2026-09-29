// objective-loop — the owner's agentic loop, over ONE declared objective (DR-056).
//
//   node scripts/objective-loop.mjs --json               derive and print; write nothing
//   node scripts/objective-loop.mjs --write              derive; rewrite docs/agent/objective-state.json
//                                                        ONLY when the decision changed; queue at most one
//                                                        sim request the tick can actually run
//   node scripts/objective-loop.mjs --write --deliver    …and mail the cloud ONCE per NEW escalation id
//   node scripts/objective-loop.mjs --check              the contract gate over the committed state
//   node scripts/objective-loop.mjs --self-test          prove every clause can fail (both directions)
//
// THE DIAGRAM, IN THIS TREE (owner-directed 2026-09-24):
//   Objective ........... docs/agent/objective.json — declared, one at a time (values only; the
//                         criterion ID SET, each SCOPE and the owner-attestation TOKEN live HERE,
//                         in scripts/** = SAFETY_MACHINERY, so weakening the json reads `broken`).
//   Orchestration ....... this file: probes → evaluate() → rank() → state + (maybe) one request.
//   Shared task state ... docs/agent/objective-state.json — ONE file, generated, rewritten whole
//                         only when the DECISION changes (content-addressed on the decision alone).
//   Agents + tools ...... the Mac tick (scripts/mac/lane-tick.sh) runs a queued request through
//                         scripts/mac/run-requests.mjs; role tasks are consumed by the cloud's
//                         forward-build-cycle (docs/agent/scheduled-routines.json).
//   Evaluate ............ evaluate(): each criterion met | unmet | unknown; unknown is NEVER met.
//   Replan .............. rank(): the ranked queue a human already committed to, resolved to real
//                         executors; an unmet machine criterion becomes ONE runnable request.
//   Goal met → Outcome .. only when EVERY criterion is met — and one is the owner's to attest.
//
// FAIL-CLOSED (golden rule 2), applied to the loop's own decision path:
//   · the verdict is an enum with TIGHTENING checked first: broken > escalate > replan > goal_met;
//     a green can never be reached by falling through;
//   · a probe that could not run, a file that is absent, a parse that failed → `unknown` → escalate;
//   · goal_met is unreachable from data alone: `owner-real-in-hand` needs a decision record whose
//     own section text carries ATTESTATION_TOKEN (declared here), and docs/DECISION_RECORDS.md is
//     SAFETY_MACHINERY by name — no lane can type its way to "goal met";
//   · a task nobody can run is unrepresentable: a row whose roles all resolve to `lane` (nobody)
//     goes to needsExecutor[], never tasks[]; a request the unattended tick cannot satisfy
//     (a declared env var it does not carry) ESCALATES with the fix named and is never queued;
//   · no clock on the decision path: `nowIso` is an argument; the ONE sampling line is marked and
//     --self-test greps this file to prove nothing else samples a clock;
//   · no silent stall (DR-054): escalate/broken must name what it is stalled on, and a NEW
//     escalation id is mailed to the cloud once (--deliver), not every tick and not never.
//
// WHAT THIS IS NOT: not a second readiness figure (DR-036's stays what it is, read as a permission),
// not a model (no LLM is called; a model may propose by editing the prose the ranker reads), not
// a second Mac routine (it is a step inside the pulse that already fires), not a merger (its output
// rides the tick PR; DR-037 decides), and not the decision core (lib/*, /v1, native ports untouched).
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditBacklogOwnership, parseRows, rosterIds, statusText } from "./check-backlog-ownership.mjs";
import { SIM_OPERATIONS } from "./lib/sim-operations.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(HERE), "..");
const OBJECTIVE_REL = "docs/agent/objective.json";
const STATE_REL = "docs/agent/objective-state.json";
const PLAN_REL = "docs/COMPANY_BUILD_PLAN.md";
const ROSTER_REL = "docs/agent/org-roster.json";
const RECORDS_REL = "docs/DECISION_RECORDS.md";
const ROUTINES_REL = "docs/agent/scheduled-routines.json";
const REQ_DIR_REL = "artifacts/sim-requests";
const RES_DIR_REL = "artifacts/sim-results";
const EVIDENCE_REL = "artifacts/live-evidence/mac-run.json";
/** The tick's liveness record, delivered straight to mainline by lane-deliver at least every ~25 min:
 *  the FRESHNESS WITNESS every reader bounds on (the state itself is rewritten only on a decision). */
const HEARTBEAT_REL = "artifacts/agent-heartbeats/mac-lane-tick.json";
/** What this machine last DELIVERED (decision address + mailed escalation ids). Lives under the
 *  gitignored node_modules/ like the tick's own heartbeat stamps, so it survives the tick returning
 *  its worktree to origin/SignalGrid_Alpha — the tracked state file does not. The tick's failure arm
 *  removes it, so a delivery that never reached origin is re-delivered on the next tick. */
const STAMP_REL = "node_modules/.sg-objective-loop-last.json";

// ── Declared in CODE, on purpose (scripts/** is SAFETY_MACHINERY) ────────────────────────
/** The one objective this loop evaluates. Swapping it is a decision record + a PR to this line. */
export const OBJECTIVE_ID = "dr-033-core-product";
/** The criterion id set and scopes. objective.json must carry EXACTLY these, or the verdict is `broken`. */
export const CRITERIA = Object.freeze([
  { id: "readiness-floor", scope: "machine" },
  { id: "evidence-fresh", scope: "machine" },
  { id: "plan-owned", scope: "machine" },
  { id: "owner-real-in-hand", scope: "owner" },
]);
/** The literal the attesting decision record's OWN section text must carry. "DR-033" is not it —
 *  DR-033's text already contains "DR-033", so a bare id check would be satisfiable by pointing at it. */
export const ATTESTATION_TOKEN = `attests: ${OBJECTIVE_ID} is real in hand`;
/** Unmet machine criterion → the ONE sim-operation that clears it, and the artifact that operation
 *  writes and the criterion reads. --self-test proves the op exists and its argv is the writer. */
export const TASK_TABLE = Object.freeze({
  "evidence-fresh": { op: "evidence", clears: EVIDENCE_REL },
});
export const TOP_N = 3;
export const STALLED_TOP_DAYS = 7;
/** An OPEN plan row is ranked only while its latest `re-measured YYYY-MM-DD` stamp is at most this
 *  old. Six of the six rows the loop ranked on 2026-09-25 turned out to be finished work still
 *  reading open (BUILD_BACKLOG, "Stamp every open Global-backlog row"): a row nobody has measured
 *  against the tree recently is an UNKNOWN input, and unknown tightens — ranked from nothing, named. */
export const MEASURE_WINDOW_DAYS = 14;
export const REQUEST_PREFIX = "objective-loop-";
export const VERDICTS = Object.freeze(["broken", "escalate", "replan", "goal_met"]);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const canonical = (v) => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
/** Age in hours — and an instant that cannot be parsed is INFINITELY old, never fresh (NaN would
 *  compare false against every bound and read as "not yet stale": the fail-open the NaN gate hunts). */
const hoursBetween = (a, b) => {
  const from = Date.parse(a), to = Date.parse(b);
  return Number.isFinite(from) && Number.isFinite(to) ? (to - from) / 36e5 : Infinity;
};
const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
/** Same shape as check-backlog-ownership.mjs's private matcher — a role id as a whole word. */
/** The latest `re-measured YYYY-MM-DD` stamp in a row (case-insensitive, `remeasured` accepted), read
 *  with quoted and code spans removed — a quoted stamp is being discussed, not asserted, which is
 *  statusText's rule for status markers. null when the row carries none. Pure. */
export function rowMeasuredAt(text) {
  const dates = [...statusText(text ?? "").matchAll(/re-?measured\s+(\d{4}-\d{2}-\d{2})/gi)].map((m) => m[1]);
  return dates.length > 0 ? dates.sort().pop() : null;
}
export const roleNameRe = (id) => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);

// ── The pure core ─────────────────────────────────────────────────────────────────────────

/**
 * Validate the declared objective against what this file declares. Returns a list of problems;
 * empty means the objective is usable. Pure.
 */
export function objectiveProblems(objective) {
  const p = [];
  if (!objective || typeof objective !== "object") return ["objective.json is absent or not an object"];
  if (objective.schemaVersion !== 1) p.push(`objective.schemaVersion must be 1 (got ${JSON.stringify(objective.schemaVersion)})`);
  if (objective.id !== OBJECTIVE_ID) p.push(`objective.id must be "${OBJECTIVE_ID}" (the loop is declared for that objective; got ${JSON.stringify(objective.id)})`);
  const crit = Array.isArray(objective.criteria) ? objective.criteria : [];
  const want = CRITERIA.map((c) => `${c.id}:${c.scope}`).join(",");
  const got = crit.map((c) => `${c?.id}:${c?.scope}`).join(",");
  if (want !== got) p.push(`objective.criteria must be exactly [${want}] in that order (got [${got}]) — the id set and scopes are declared in scripts/objective-loop.mjs, not in the json`);
  if (!CRITERIA.some((c) => c.scope === "owner")) p.push("the declared CRITERIA carry no owner-scoped criterion — goal_met would be reachable from data alone");
  if (objective.attestedIn !== null && typeof objective.attestedIn !== "string") p.push("objective.attestedIn must be null or a decision-record id string");
  for (const c of crit) if (c && typeof c.escalationAsk !== "string") p.push(`criterion ${c?.id}: escalationAsk must be a string`);
  return p;
}

/** The section of DECISION_RECORDS.md headed `## <id> `, or null. Pure over the text. */
export function recordSection(text, id) {
  if (typeof text !== "string" || typeof id !== "string" || !/^DR-\d+$/.test(id)) return null;
  const parts = text.split(/\n## (?=DR-\d+)/);
  for (const chunk of parts.slice(1)) if (chunk.startsWith(`${id} `) || chunk.startsWith(`${id}\n`)) return chunk;
  return null;
}

/**
 * evaluate({objective, probes, nowIso}) → { criteria[], unmet[], unknown[], verdict, probeErrors[] }
 * probes: { readiness: object|null, plan: {problems[],open[],partial[],closed[]}|null,
 *           decisionRecords: string|null, errors: string[] }
 * Pure: no clock (nowIso unused here but declared for symmetry with rank), no I/O, no model.
 */
export function evaluate({ objective, probes }) {
  const problems = objectiveProblems(objective);
  const probeErrors = [...(probes?.errors ?? [])];
  const out = { criteria: [], unmet: [], unknown: [], verdict: "broken", probeErrors, objectiveProblems: problems };
  if (problems.length > 0) return out;

  const r = probes?.readiness ?? null;
  const plan = probes?.plan ?? null;
  const records = probes?.decisionRecords ?? null;
  for (const decl of CRITERIA) {
    const c = { id: decl.id, scope: decl.scope, state: "unknown", measured: null, source: null };
    if (decl.id === "readiness-floor") {
      c.source = "scripts/check-readiness-figure.mjs --json (headline, floor)";
      if (r && Number.isFinite(r.headline) && Number.isFinite(r.floor)) {
        c.measured = { headline: r.headline, floor: r.floor };
        c.state = r.headline >= r.floor ? "met" : "unmet";
      }
    } else if (decl.id === "evidence-fresh") {
      c.source = "scripts/check-readiness-figure.mjs --json (.details.evidence)";
      const e = r?.details?.evidence;
      if (e && Number.isFinite(e.pct)) {
        c.measured = { pct: e.pct, reason: typeof e.reason === "string" ? e.reason : null };
        c.state = e.pct === 100 ? "met" : "unmet";
      }
    } else if (decl.id === "plan-owned") {
      c.source = `auditBacklogOwnership(${PLAN_REL}, org-roster ids)`;
      if (plan && Array.isArray(plan.problems) && Array.isArray(plan.open)) {
        c.measured = { problems: plan.problems.length, open: plan.open.length, partial: plan.partial?.length ?? 0, closed: plan.closed?.length ?? 0 };
        c.state = plan.problems.length === 0 ? "met" : "unmet";
      }
    } else if (decl.id === "owner-real-in-hand") {
      c.source = `${RECORDS_REL} section named by objective.attestedIn, carrying the attestation token`;
      const at = objective.attestedIn;
      if (at === null) {
        c.measured = { attestedIn: null };
        c.state = "unmet";
      } else if (typeof records === "string") {
        const section = recordSection(records, at);
        c.measured = { attestedIn: at, sectionFound: section !== null, tokenFound: section !== null && section.includes(ATTESTATION_TOKEN) };
        // A pointer at a record that does not carry the token is UNKNOWN, not met and not
        // silently unmet: someone typed an attestation the record does not make.
        c.state = c.measured.tokenFound ? "met" : "unknown";
      }
    }
    if (c.state === "unknown") probeErrors.push(`criterion ${c.id}: its probe returned nothing usable — UNKNOWN, counted unmet`);
    out.criteria.push(c);
    if (c.state === "unmet") out.unmet.push(c.id);
    if (c.state === "unknown") out.unknown.push(c.id);
  }
  const ownerUnmet = out.criteria.some((c) => c.scope === "owner" && c.state !== "met");
  const machineUnmet = out.criteria.some((c) => c.scope === "machine" && c.state === "unmet");
  // Tightening first. A green is never reached by falling through.
  out.verdict = out.unknown.length > 0 || ownerUnmet ? "escalate" : machineUnmet ? "replan" : "goal_met";
  return out;
}

/** Parse one ranked-queue row into { id, title, roles[] } — head line first, whole text as fallback. Pure. */
export function parseQueueRow(row, roleIds) {
  const head = (row.text ?? "").split("\n")[0];
  const title = (head.match(/^\d[\w-]*\.\s+\*\*(.+?)\*\*/) || [, ""])[1].trim();
  const inHead = roleIds.filter((id) => roleNameRe(id).test(head));
  const positioned = (inHead.length > 0 ? inHead : roleIds.filter((id) => roleNameRe(id).test(row.text ?? "")))
    .map((id) => ({ id, at: (inHead.length > 0 ? head : row.text).search(roleNameRe(id)) }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.id);
  return { id: row.id, title, roles: positioned };
}

/**
 * rank({rows, openIds, roster, roleIds, evaluation, priorState, envKeys, nowIso})
 *   → { tasks[], needsExecutor[], escalations[], queue[] }
 * Pure. Document order IS the ranking (the human-committed "Blocking items first" order); this
 * function resolves executors and closes the code edge, it never re-judges priority.
 */
export function rank({ rows = [], openIds = [], roster = {}, roleIds = [], evaluation, priorState = null, envKeys = new Set(), nowIso, simOps = SIM_OPERATIONS, table = TASK_TABLE, objective = null }) {
  const tasks = [], needsExecutor = [], unmeasured = [], escalations = [], queue = [];
  const priorSince = new Map((priorState?.escalations ?? []).map((e) => [e.id, e.since]));
  const priorFirst = new Map((priorState?.tasks ?? []).map((t) => [t.rowId, t.firstRankedAt]));
  const esc = (id, clears, asks) => escalations.push({ id, clears, asks, since: isIso(priorSince.get(id)) ? priorSince.get(id) : nowIso });

  const open = new Set(openIds);
  for (const row of rows) {
    if (!open.has(row.id)) continue;
    const q = parseQueueRow(row, roleIds);
    // Stamp first: a row nobody measured against the tree within the window is not ranked, whoever owns it.
    const measuredAt = rowMeasuredAt(row.text);
    const ageH = measuredAt === null ? Infinity : hoursBetween(measuredAt, nowIso);
    if (measuredAt === null || ageH < 0 || ageH > MEASURE_WINDOW_DAYS * 24) {
      unmeasured.push({ rowId: q.id, title: q.title, measuredAt, reason: measuredAt === null ? "no re-measured stamp" : ageH < 0 ? `stamp ${measuredAt} is in the future` : `stamp ${measuredAt} is older than ${MEASURE_WINDOW_DAYS} days` });
      continue;
    }
    const resolved = q.roles.map((id) => ({ role: id, executor: roster[id] ?? null }));
    const real = resolved.find((x) => typeof x.executor === "string" && x.executor !== "lane" && x.executor.length > 0);
    if (!real) {
      needsExecutor.push({ rowId: q.id, title: q.title, roles: q.roles, reason: q.roles.length === 0 ? "the row names no roster role" : `every named role resolves to "lane" (nothing dedicated) or dangles: ${resolved.map((x) => `${x.role}→${x.executor ?? "∅"}`).join(", ")}` });
      continue;
    }
    if (tasks.length < TOP_N) {
      tasks.push({ rank: tasks.length + 1, rowId: q.id, title: q.title, role: real.role, executor: real.executor, kind: "role", source: { path: PLAN_REL, section: "Global backlog" }, firstRankedAt: isIso(priorFirst.get(q.id)) ? priorFirst.get(q.id) : nowIso });
    }
  }
  if (unmeasured.length > 0) {
    esc("plan-rows-unmeasured", "cloud", `${unmeasured.length} open row(s) in ${PLAN_REL} carry no \`re-measured YYYY-MM-DD\` stamp within ${MEASURE_WINDOW_DAYS} days and were ranked from nothing — a row nobody measured against the tree is an unknown input: ${unmeasured.map((u) => u.rowId).join(", ")}. Measure each against the tree; close it, or restamp it with what was measured`);
  }
  if (tasks[0] && priorState?.tasks?.[0]?.rowId === tasks[0].rowId && hoursBetween(tasks[0].firstRankedAt, nowIso) > STALLED_TOP_DAYS * 24) {
    esc("stalled-top-task", "cloud", `row ${tasks[0].rowId} ("${tasks[0].title}") has been ranked #1 for over ${STALLED_TOP_DAYS} days with no change in ${PLAN_REL} — build it, re-rank it, or record why it waits`);
  }

  // Unmet MACHINE criteria → at most ONE runnable request; anything the tick cannot run escalates.
  for (const c of evaluation?.criteria ?? []) {
    if (c.scope === "owner") { if (c.state !== "met") esc(c.id, "owner", objective?.criteria?.find((x) => x?.id === c.id)?.escalationAsk ?? `owner decision needed on ${c.id}`); continue; }
    if (c.state === "unknown") { esc(`probe-${c.id}-unknown`, "mac", `the probe behind ${c.id} returned nothing usable — fix the probe or its input on the Mac`); continue; }
    if (c.state !== "unmet") continue;
    const entry = table[c.id];
    if (!entry) { esc(`${c.id}-no-clearing-op`, "mac", objective?.criteria?.find((x) => x?.id === c.id)?.escalationAsk ?? `${c.id} is unmet and no sim-operation clears it`); continue; }
    const op = simOps[entry.op];
    if (!op) { esc(`${c.id}-op-missing`, "mac", `TASK_TABLE names sim-operation "${entry.op}" which scripts/lib/sim-operations.mjs does not declare`); continue; }
    if (op.needs !== undefined && !Array.isArray(op.needsEnv)) { esc(`${c.id}-op-needs-unstructured`, "mac", `sim-operation "${entry.op}" declares a prose \`needs\` with no structured \`needsEnv\` — the loop cannot tell whether the tick can run it, so it does not queue it (fail-closed)`); continue; }
    const missing = (op.needsEnv ?? []).filter((k) => !envKeys.has(k));
    if (missing.length > 0) { esc(`${c.id}-op-unrunnable`, "mac", `sim-operation "${entry.op}" needs ${missing.join(", ")} in the tick's environment and the tick does not carry it — export it in scripts/mac/lane-tick.sh (guarded on the sibling checkout existing); not queued, because a request nobody can service sits PENDING forever`); continue; }
    if (queue.length === 0) queue.push({ criterionId: c.id, op: entry.op, clears: entry.clears, id: `${REQUEST_PREFIX}${c.id}-${String(nowIso).slice(0, 10)}` });
  }
  return { tasks, needsExecutor, unmeasured, escalations, queue };
}

/** The decision, and nothing else — what the content address covers. Pure. */
export function decisionAddress(state) {
  return sha256(canonical({
    objectiveId: state.objectiveId, objectiveSha: state.objectiveSha, verdict: state.verdict, staleAfterHours: state.staleAfterHours,
    criteria: (state.criteria ?? []).map((c) => ({ id: c.id, state: c.state })),
    unmet: state.unmet ?? [], tasks: (state.tasks ?? []).map((t) => ({ rowId: t.rowId, role: t.role, executor: t.executor })),
    needsExecutor: (state.needsExecutor ?? []).map((n) => n.rowId),
    // Only when present: a state derived before the field existed keeps the address it was written with.
    ...(Array.isArray(state.unmeasured) && state.unmeasured.length > 0 ? { unmeasured: state.unmeasured.map((u) => u.rowId) } : {}),
    escalations: (state.escalations ?? []).map((e) => ({ id: e.id, clears: e.clears })),
    queue: (state.queue ?? []).map((q) => q.id),
  }));
}

/** Finalize: the non-vacuity and no-silent-stall rules, applied AFTER rank. Pure. */
export function finalize(evaluation, ranked) {
  let verdict = evaluation.verdict;
  const reasons = [];
  if (verdict !== "goal_met" && ranked.tasks.length === 0 && ranked.needsExecutor.length === 0 && (ranked.unmeasured?.length ?? 0) === 0 && evaluation.probeErrors.length === 0) {
    reasons.push("no task, no unresolvable row, no unmeasured row and no probe error — an evaluator that produced no work and no reason is broken, whatever the plan said");
    verdict = "broken";
  }
  if ((verdict === "escalate" || verdict === "broken") && ranked.escalations.length === 0 && evaluation.probeErrors.length === 0 && reasons.length === 0) {
    reasons.push("escalate with nothing to escalate — a stall must name what it is stalled on (DR-054)");
    verdict = "broken";
  }
  if (verdict === "replan" && ranked.tasks.length === 0) {
    reasons.push("replan with no ranked task is a contradiction");
    verdict = "broken";
  }
  return { verdict, brokenReasons: [...evaluation.objectiveProblems, ...reasons] };
}

/**
 * How a READER must treat a committed state. The state file is rewritten only when the DECISION
 * changes (quiet by design), so its own instant cannot say whether the Mac is still deriving it.
 * The FRESHNESS WITNESS is the tick's heartbeat — delivered to mainline at least every ~25 min while
 * the tick runs, and carrying the loop's verdict in its result string since DR-056. A state is
 * current only when that witness is within the state's bound AND names the same verdict; anything
 * else (no heartbeat, a stale one, one naming a different verdict, an unparseable instant) reads
 * `unknown` — never the recorded verdict. Pure.
 */
export function readVerdict(state, { heartbeat = null, nowIso } = {}) {
  if (!state || typeof state !== "object" || !VERDICTS.includes(state.verdict)) return { verdict: "unknown", reason: "state absent or malformed" };
  if (!Number.isFinite(state.staleAfterHours) || state.staleAfterHours <= 0) return { verdict: "unknown", reason: "state carries no usable staleAfterHours" };
  if (!heartbeat || typeof heartbeat !== "object") return { verdict: "unknown", reason: "no tick heartbeat to witness the state — the Mac may not be deriving it" };
  const age = hoursBetween(heartbeat.firedAt, nowIso);
  if (age > state.staleAfterHours) return { verdict: "unknown", reason: `the tick heartbeat is ${Number.isFinite(age) ? age.toFixed(1) + "h" : "unparseably"} old, past the ${state.staleAfterHours}h bound — treat as unknown` };
  if (typeof heartbeat.result !== "string" || !heartbeat.result.includes(`objective: ${state.verdict}`)) return { verdict: "unknown", reason: `the tick heartbeat does not name verdict "${state.verdict}" — this state is not what the Mac is deriving` };
  return { verdict: state.verdict, reason: null };
}

// ── The impure collector ──────────────────────────────────────────────────────────────────
function readJson(rel, errors, what) {
  try { return JSON.parse(readFileSync(join(ROOT, rel), "utf8")); }
  catch (e) { errors.push(`${what}: ${rel} unreadable/unparseable (${e.message.split("\n")[0]}) — UNKNOWN`); return null; }
}
function readText(rel, errors, what) {
  try { return readFileSync(join(ROOT, rel), "utf8"); }
  catch (e) { errors.push(`${what}: ${rel} unreadable (${e.message.split("\n")[0]}) — UNKNOWN`); return null; }
}
function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, out: (r.stdout ?? "").trim() };
}
function loadDir(rel) {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    try { return { __file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }; } catch { return { __file: f, __bad: true }; }
  });
}

export function collect() {
  const errors = [];
  const objective = readJson(OBJECTIVE_REL, errors, "objective");
  const objectiveSha = existsSync(join(ROOT, OBJECTIVE_REL)) ? sha256(readFileSync(join(ROOT, OBJECTIVE_REL))) : null;
  let readiness = null;
  try {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/check-readiness-figure.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const last = out.split("\n").filter((l) => l.trim()).pop();
    readiness = JSON.parse(last);
  } catch (e) { errors.push(`readiness: check-readiness-figure.mjs --json did not yield JSON (${e.message.split("\n")[0]}) — UNKNOWN`); }
  const roleIds = rosterIds(ROOT);
  const rosterJson = readJson(ROSTER_REL, errors, "roster");
  const roster = Object.fromEntries((rosterJson?.roles ?? []).map((r) => [r?.id, r?.executor]));
  const rosterSha = existsSync(join(ROOT, ROSTER_REL)) ? sha256(readFileSync(join(ROOT, ROSTER_REL))) : null;
  const planText = readText(PLAN_REL, errors, "plan");
  let plan = null, rows = [];
  if (planText !== null) {
    if (roleIds.length === 0) errors.push("roster: zero role ids — ownership cannot be audited — UNKNOWN");
    else { plan = auditBacklogOwnership(planText, roleIds); rows = parseRows(planText); }
  }
  const decisionRecords = readText(RECORDS_REL, errors, "decision records");
  const requests = loadDir(REQ_DIR_REL), results = loadDir(RES_DIR_REL);
  const resultIds = new Set(results.map((r) => r.requestId).filter(Boolean));
  const pending = requests.filter((r) => !r.__bad && r.id && !resultIds.has(r.id)).map((r) => r.id);
  const routines = readJson(ROUTINES_REL, [], "routines");
  const tickRow = routines?.routines?.find?.((r) => r?.id === "mac-lane-tick");
  const staleAfterHours = Number.isFinite(tickRow?.cadenceToleranceHours) ? tickRow.cadenceToleranceHours : 3;
  const heartbeat = readJson(HEARTBEAT_REL, [], "heartbeat");
  let priorState = null;
  try { priorState = JSON.parse(readFileSync(join(ROOT, STATE_REL), "utf8")); } catch { priorState = null; }
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  const nowIso = new Date().toISOString(); // clock: the ONE sampling line (--self-test greps for it)
  return {
    objective, objectiveSha, roster, rosterSha, roleIds, rows, priorState, nowIso, staleAfterHours, heartbeat,
    probes: { readiness, plan, decisionRecords, errors },
    report: { pendingSimRequests: pending, badRequestFiles: requests.filter((r) => r.__bad).map((r) => r.__file) },
    git: { head: head.status === 0 ? head.out : null, workingTreeCleanAtEntry: status.status === 0 ? status.out === "" : null },
    envKeys: new Set(Object.keys(process.env)),
  };
}

/** One full derivation over collected inputs. Deterministic given `c`. */
export function derive(c) {
  const evaluation = evaluate({ objective: c.objective, probes: c.probes });
  const ranked = evaluation.verdict === "broken"
    ? { tasks: [], needsExecutor: [], escalations: [], queue: [] }
    : rank({ rows: c.rows, openIds: c.probes.plan?.open ?? [], roster: c.roster, roleIds: c.roleIds, evaluation, priorState: c.priorState, envKeys: c.envKeys, nowIso: c.nowIso, objective: c.objective });
  const fin = finalize(evaluation, ranked);
  const state = {
    schemaVersion: 1,
    $comment: `GENERATED by scripts/objective-loop.mjs --write (DR-056). Never hand-edit; the loop rewrites it whole when the DECISION changes. This is the company's shared task state — not docs/agent/LOOP.md (the session ritual) and not \`pnpm run loop:state\` (the tool seams). A reader older than staleAfterHours must treat verdict as unknown.`,
    objectiveId: c.objective?.id ?? null, objectiveSha: c.objectiveSha, rosterSha: c.rosterSha,
    verdict: fin.verdict, brokenReasons: fin.brokenReasons,
    criteria: evaluation.criteria, unmet: evaluation.unmet, unknown: evaluation.unknown,
    tasks: ranked.tasks, needsExecutor: ranked.needsExecutor, unmeasured: ranked.unmeasured, escalations: ranked.escalations, queue: ranked.queue,
    probeErrors: evaluation.probeErrors,
    report: { ...c.report, needsExecutorCount: ranked.needsExecutor.length, unmeasuredCount: ranked.unmeasured.length, openRows: c.probes.plan?.open?.length ?? null },
    staleAfterHours: c.staleAfterHours,
    derivedAt: c.nowIso, derivedAtCommit: c.git.head, workingTreeCleanAtEntry: c.git.workingTreeCleanAtEntry,
  };
  state.decisionAddress = decisionAddress(state);
  return state;
}

// ── Emit: content-addressed write, one request, one mail per NEW escalation ───────────────
function requestAlreadyQueued(criterionId) {
  // Dedup against work that is OUTSTANDING, never against history: a request that already has a
  // result is done, and the criterion may decay again next week. The mark must survive the tick
  // worktree returning to origin/SignalGrid_Alpha, so look in the working tree, on mainline, and
  // on every unmerged mac/tick-* head. Any outstanding request for this criterion = already queued.
  const prefix = `${REQUEST_PREFIX}${criterionId}-`;
  const localResults = new Set(loadDir(RES_DIR_REL).map((r) => r.requestId).filter(Boolean));
  for (const f of existsSync(join(ROOT, REQ_DIR_REL)) ? readdirSync(join(ROOT, REQ_DIR_REL)) : []) {
    if (f.startsWith(prefix) && f.endsWith(".json") && !localResults.has(f.slice(0, -5))) return `working tree (${f})`;
  }
  const refs = ["origin/SignalGrid_Alpha", ...git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/mac/tick-*"]).out.split("\n").filter(Boolean)];
  for (const ref of refs) {
    const listed = git(["ls-tree", "--name-only", ref, `${REQ_DIR_REL}/`]).out.split("\n").map((l) => l.split("/").pop()).filter((f) => f && f.startsWith(prefix) && f.endsWith(".json"));
    for (const f of listed) {
      const id = f.slice(0, -5);
      const done = localResults.has(id) || git(["cat-file", "-e", `${ref}:${RES_DIR_REL}/${id}.json`]).status === 0;
      if (!done) return `${ref} (${f})`;
    }
  }
  return null;
}

function emit(state, { write, deliver }) {
  const prior = (() => { try { return JSON.parse(readFileSync(join(ROOT, STATE_REL), "utf8")); } catch { return null; } })();
  const stamp = (() => { try { return JSON.parse(readFileSync(join(ROOT, STAMP_REL), "utf8")); } catch { return null; } })();
  // "Changed" against BOTH the tracked state (what mainline knows) and the delivery stamp (what this
  // machine already pushed on an unmerged tick branch): the tick returns its worktree to mainline
  // after every push, so the tracked copy alone would re-cut a branch every five minutes.
  const changed = prior?.decisionAddress !== state.decisionAddress && stamp?.decisionAddress !== state.decisionAddress;
  const delivered = new Set([...(prior?.escalations ?? []).map((e) => e.id), ...(stamp?.deliveredEscalations ?? [])]);
  const lines = [];
  const wrote = [];
  if (write && changed) {
    writeFileSync(join(ROOT, STATE_REL), JSON.stringify(state, null, 2) + "\n");
    wrote.push(STATE_REL);
  }
  if (write) {
    for (const q of state.queue) {
      const where = requestAlreadyQueued(q.criterionId);
      if (where) { q.queuedAs = where; lines.push(`request ${q.id} already queued (${where}) — not re-queued`); continue; }
      const rel = `${REQ_DIR_REL}/${q.id}.json`;
      mkdirSync(join(ROOT, REQ_DIR_REL), { recursive: true });
      writeFileSync(join(ROOT, rel), JSON.stringify({
        schemaVersion: 1, id: q.id, requestedAt: state.derivedAt, requestedBy: "objective-loop (Mac tick, DR-056)",
        reason: `Criterion ${q.criterionId} is unmet; sim-operation "${q.op}" writes ${q.clears}, which that criterion reads. Queued by scripts/objective-loop.mjs, not by a person.`,
        runs: [q.op],
        notes: ["A refusal or a skip never closes this request; the loop re-derives after the result lands."],
      }, null, 2) + "\n");
      q.queuedAs = "this tick";
      wrote.push(rel);
      lines.push(`queued ${rel}`);
    }
    if (state.queue.some((q) => q.queuedAs) && changed) writeFileSync(join(ROOT, STATE_REL), JSON.stringify(state, null, 2) + "\n");
  }
  if (deliver) {
    for (const e of state.escalations) {
      if (delivered.has(e.id)) continue;
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/lane-deliver.mjs"), "send", `objective-loop: ${e.id} — needs ${e.clears}`, `${e.asks}\n\n(Raised by scripts/objective-loop.mjs on the Mac tick, DR-056. Verdict ${state.verdict}; state ${STATE_REL} @ ${state.derivedAtCommit ?? "?"}. Sent once, on the first tick this escalation appeared; it stays in the state file until cleared.)`], { cwd: ROOT, encoding: "utf8" });
      lines.push(r.status === 0 ? `mailed new escalation ${e.id}` : `WARN could not mail escalation ${e.id} (lane-deliver exit ${r.status})`);
      if (r.status === 0) delivered.add(e.id);
    }
  }
  if (write) {
    try {
      mkdirSync(dirname(join(ROOT, STAMP_REL)), { recursive: true });
      writeFileSync(join(ROOT, STAMP_REL), JSON.stringify({ decisionAddress: state.decisionAddress, deliveredEscalations: [...delivered], at: state.derivedAt }) + "\n");
    } catch (e) { lines.push(`WARN could not write the delivery stamp ${STAMP_REL} (${e.message.split("\n")[0]}) — the next tick may re-deliver`); }
  }
  const met = state.criteria.filter((c) => c.state === "met").length;
  lines.unshift(`objective-loop: ${state.verdict} — ${met}/${state.criteria.length} criteria met; next: ${state.tasks[0]?.title ?? "none"}; escalations: ${state.escalations.map((e) => e.id).join(", ") || "none"}; ${write ? (changed ? "state written" : "quiet (decision unchanged)") : "dry run"}`);
  return { lines, wrote, changed };
}

// ── --check: the contract gate over the committed state (three-state provenance) ──────────
export function checkState(state, { objectiveShaNow, rosterShaNow, headIsAncestor, nowIso, registryToleranceNow = null, heartbeat = null }) {
  const fatal = [], reported = [];
  if (!state || typeof state !== "object") return { fatal: [`${STATE_REL} absent or unparseable`], reported };
  if (state.schemaVersion !== 1) fatal.push("schemaVersion must be 1");
  if (!VERDICTS.includes(state.verdict)) fatal.push(`verdict must be one of ${VERDICTS.join("|")}`);
  for (const k of ["criteria", "unmet", "tasks", "needsExecutor", "escalations", "queue", "probeErrors"]) if (!Array.isArray(state[k])) fatal.push(`${k} must be an array`);
  if (fatal.length) return { fatal, reported };
  const ids = state.criteria.map((c) => c.id).join(",");
  if (ids !== CRITERIA.map((c) => c.id).join(",")) fatal.push(`criteria ids [${ids}] differ from the declared set — state derived against another objective`);
  for (const c of state.criteria) if (!["met", "unmet", "unknown"].includes(c.state)) fatal.push(`criterion ${c.id}: state ${JSON.stringify(c.state)} is not met|unmet|unknown`);
  for (const e of state.escalations) if (!["mac", "cloud", "owner"].includes(e.clears)) fatal.push(`escalation ${e.id}: clears must be mac|cloud|owner`);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) fatal.push(`the gate's own instant ${JSON.stringify(nowIso)} is unparseable — no date can be judged`);
  for (const d of [state.derivedAt, ...state.escalations.map((e) => e.since), ...state.tasks.map((t) => t.firstRankedAt)]) {
    const ms = Date.parse(d);
    if (!Number.isFinite(ms)) fatal.push(`date ${JSON.stringify(d)} is not parseable ISO`);
    else if (Number.isFinite(nowMs) && ms > nowMs + 5 * 60e3) fatal.push(`date ${d} is in the future`);
  }
  const unmeasured = Array.isArray(state.unmeasured) ? state.unmeasured : []; // absent on a state derived before the field existed
  if (state.verdict === "replan" && state.tasks.length === 0) fatal.push("verdict replan with no task is a contradiction");
  if (state.verdict !== "goal_met" && state.tasks.length === 0 && state.needsExecutor.length === 0 && unmeasured.length === 0 && state.probeErrors.length === 0) fatal.push("no task, no unresolvable row, no unmeasured row, no probe error — a broken resolver, never a finished company");
  if (unmeasured.length > 0) reported.push(`${unmeasured.length} open plan row(s) ranked from nothing — no re-measured stamp within ${MEASURE_WINDOW_DAYS} days: ${unmeasured.map((u) => u.rowId).join(", ")}`);
  if ((state.verdict === "escalate" || state.verdict === "broken") && state.escalations.length === 0 && state.probeErrors.length === 0 && !(state.brokenReasons?.length > 0)) fatal.push("a stall that names nothing it is stalled on (DR-054)");
  if (decisionAddress(state) !== state.decisionAddress) fatal.push("decisionAddress does not match the decision content — the file was hand-edited");
  const objectiveMoved = objectiveShaNow !== state.objectiveSha;
  const rosterMoved = rosterShaNow !== state.rosterSha;
  if (objectiveMoved) reported.push("objective.json changed since this state was derived — STALE, a reader treats the verdict as unknown until the Mac re-derives");
  if (rosterMoved) reported.push("org-roster.json changed since this state was derived — executor claims are STALE (reported, not fatal)");
  else for (const t of state.tasks) if (!t.executor || t.executor === "lane") fatal.push(`ranked task row ${t.rowId} has no real executor (${t.executor ?? "∅"})`);
  if (headIsAncestor === null) reported.push("provenance: shallow clone or no git — derivedAtCommit ancestry cannot be judged (REPORTED, not fatal; fatal on a full clone)");
  else if (headIsAncestor === false) fatal.push(`derivedAtCommit ${state.derivedAtCommit} is not an ancestor of HEAD`);
  if (!Number.isFinite(state.staleAfterHours) || state.staleAfterHours <= 0) fatal.push("staleAfterHours must be a positive number");
  else if (Number.isFinite(registryToleranceNow) && registryToleranceNow !== state.staleAfterHours) reported.push(`staleAfterHours ${state.staleAfterHours} differs from the mac-lane-tick row's cadenceToleranceHours ${registryToleranceNow} — STALE, re-derive`);
  const rv = readVerdict(state, { heartbeat, nowIso });
  if (rv.verdict === "unknown") reported.push(`STALE: ${rv.reason}`);
  return { fatal, reported };
}

function runCheck() {
  let state = null;
  try { state = JSON.parse(readFileSync(join(ROOT, STATE_REL), "utf8")); } catch { state = null; }
  const objectiveShaNow = existsSync(join(ROOT, OBJECTIVE_REL)) ? sha256(readFileSync(join(ROOT, OBJECTIVE_REL))) : null;
  const rosterShaNow = existsSync(join(ROOT, ROSTER_REL)) ? sha256(readFileSync(join(ROOT, ROSTER_REL))) : null;
  const hasGit = git(["rev-parse", "--git-dir"]).status === 0;
  const shallow = git(["rev-parse", "--is-shallow-repository"]).out === "true";
  let headIsAncestor = null;
  if (hasGit && !shallow && state?.derivedAtCommit) headIsAncestor = git(["merge-base", "--is-ancestor", state.derivedAtCommit, "HEAD"]).status === 0;
  const nowIso = new Date().toISOString(); // clock: the gate's own instant (age reporting), not the decision path
  const routines = readJson(ROUTINES_REL, [], "routines");
  const registryToleranceNow = routines?.routines?.find?.((r) => r?.id === "mac-lane-tick")?.cadenceToleranceHours ?? null;
  const heartbeat = readJson(HEARTBEAT_REL, [], "heartbeat");
  const { fatal, reported } = checkState(state, { objectiveShaNow, rosterShaNow, headIsAncestor, nowIso, registryToleranceNow, heartbeat });
  console.log(`objective-loop --check over ${STATE_REL}`);
  for (const r of reported) console.log(`  REPORTED — ${r}`);
  for (const f of fatal) console.log(`  ✗ ${f}`);
  if (state) console.log(`  verdict ${state.verdict}; ${state.tasks.length} task(s), ${state.needsExecutor.length} need an executor, ${(state.unmeasured ?? []).length} unmeasured, ${state.escalations.length} escalation(s); decided ${hoursBetween(state.derivedAt, nowIso).toFixed(1)}h ago; reader verdict: ${readVerdict(state, { heartbeat, nowIso }).verdict}`);
  console.log(fatal.length ? `objective-loop --check FAILED: ${fatal.length} problem(s).` : "objective-loop --check passed — the committed state is well-formed, derived against the declared objective, every ranked task has a real executor, and nothing stalls silently.");
  return fatal.length ? 1 : 0;
}

// ── --self-test: every clause driven from the FAILING side ────────────────────────────────
function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, !!ok]);
  const T0 = "2026-09-24T12:00:00.000Z", T1 = "2026-09-25T12:00:00.000Z";
  const goodObjective = () => ({ schemaVersion: 1, id: OBJECTIVE_ID, attestedIn: null, criteria: CRITERIA.map((c) => ({ ...c, escalationAsk: `ask ${c.id}` })) });
  const greenReadiness = { headline: 100, floor: 80, details: { evidence: { pct: 100, reason: "fresh" } } };
  const plan = { problems: [], open: ["5", "6", "12", "7", "8", "9", "10"], partial: [], closed: [] };
  const records = `# Records\n\n## DR-033 — the objective (owner-directed 2026-09-10)\n\nDR-033 says build the core product.\n\n## DR-099 — an attestation (owner, 2026-10-01)\n\nThe owner ${ATTESTATION_TOKEN}.\n`;
  const probes = (o = {}) => ({ readiness: greenReadiness, plan, decisionRecords: records, errors: [], ...o });
  const roleIds = ["mobile-native-engineer", "product-manager", "web-engineer"];
  const roster = { "mobile-native-engineer": "skill:signalgrid-native", "product-manager": "lane", "web-engineer": "skill:signalgrid-core" };
  const rows = [
    { id: "5", text: "5. **Point the badge lane at the real backend** — mobile-native-engineer, days. body. Re-measured 2026-09-20." },
    { id: "6", text: "6. **Groom the queue** — product-manager, days. body re-measured 2026-09-21" },
    { id: "12", text: "12. **Rewrite the site** — product-manager + web-engineer, days. re-measured 2026-08-01, then RE-MEASURED 2026-09-22 body" },
    { id: "7", text: "7. **Old stamp** — web-engineer, days. Re-measured 2026-09-09." },
    { id: "8", text: "8. **No stamp** — web-engineer, days. body" },
    { id: "9", text: "9. **Quoted stamp** — web-engineer, days. \"re-measured 2026-09-23\" is only quoted, and `re-measured 2026-09-23` is code" },
    { id: "10", text: "10. **Future stamp** — web-engineer, days. re-measured 2026-10-01" },
  ];
  const ops = { evidence: { argv: ["node", "scripts/verify-all.mjs", "--require-mcp", "--emit-evidence"], needs: "SIGNALGRID_MCP_PATH pointing at the signalgrid-mcp checkout", needsEnv: ["SIGNALGRID_MCP_PATH"] } };

  // (a) determinism — same inputs, same answer; and the source carries exactly one clock line on the decision path
  const e1 = evaluate({ objective: goodObjective(), probes: probes() }), e2 = evaluate({ objective: goodObjective(), probes: probes() });
  t("determinism: evaluate() is identical across two calls", canonical(e1) === canonical(e2));
  // CODE lines only: comments and the two marked sampling lines are excluded; this line and the
  // next carry the marker too, because a scan that reads its own label is a scan that never fails.
  const src = readFileSync(HERE, "utf8").split("\n") // clock-check
    .filter((l) => !/clock: the ONE sampling line|clock: the gate's own instant|clock-check/.test(l) && !/^\s*\/\//.test(l)) // clock-check
    .map((l) => l.replace(/\/\/.*$/, "")).join("\n"); // clock-check
  t("determinism: no clock or randomness call in any code line outside the two marked sampling lines", !/Date\.now\(|Math\.random\(|new Date\(\)/.test(src)); // clock-check
  const r1 = rank({ rows, openIds: plan.open, roster, roleIds, evaluation: e1, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() });
  const r2 = rank({ rows, openIds: plan.open, roster, roleIds, evaluation: e1, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() });
  t("determinism: rank() is identical across two calls", canonical(r1) === canonical(r2));

  // (b) saturation is NOT goal-met; the owner's attestation is
  t("saturation: every machine criterion met + owner unattested → escalate, never goal_met", e1.verdict === "escalate" && e1.unmet.includes("owner-real-in-hand"));
  const attested = evaluate({ objective: { ...goodObjective(), attestedIn: "DR-099" }, probes: probes() });
  t("attestation: a record whose section carries the token → goal_met", attested.verdict === "goal_met");
  // (c) attestation cannot be typed: pointing at DR-033 (whose text contains "DR-033" but not the token) is unknown, not met
  const typed = evaluate({ objective: { ...goodObjective(), attestedIn: "DR-033" }, probes: probes() });
  t("attestation: a pointer at a record without the token → unknown → escalate (never met)", typed.verdict === "escalate" && typed.unknown.includes("owner-real-in-hand"));
  t("attestation: with the records file unreadable the owner criterion is unknown", evaluate({ objective: { ...goodObjective(), attestedIn: "DR-099" }, probes: probes({ decisionRecords: null }) }).unknown.includes("owner-real-in-hand"));
  // (d) unknown tightens
  const nullR = evaluate({ objective: goodObjective(), probes: probes({ readiness: null }) });
  t("unknown tightens: readiness null → readiness-floor and evidence-fresh unknown → escalate", nullR.verdict === "escalate" && nullR.unknown.includes("readiness-floor") && nullR.unknown.includes("evidence-fresh"));
  t("unknown tightens: a probe error is carried, never dropped", nullR.probeErrors.length >= 2);
  // (e) non-vacuity through the reused audit: a plan with zero rows is a problem, not a met criterion
  const zero = auditBacklogOwnership("# nothing here\n", roleIds);
  t("non-vacuity: auditBacklogOwnership over a plan with no '## Global backlog' reports a problem", zero.problems.some((p) => /ZERO backlog rows/.test(p)));
  t("non-vacuity: that problem makes plan-owned unmet → replan/escalate, never met", evaluate({ objective: goodObjective(), probes: probes({ plan: zero }) }).unmet.includes("plan-owned"));
  // (k) objective validity is declared in code
  t("objective: an EMPTY criteria set is broken, never goal_met", evaluate({ objective: { ...goodObjective(), criteria: [] }, probes: probes() }).verdict === "broken");
  t("objective: the owner criterion re-scoped to machine is broken", evaluate({ objective: { ...goodObjective(), criteria: CRITERIA.map((c) => ({ ...c, scope: "machine", escalationAsk: "x" })) }, probes: probes() }).verdict === "broken");
  t("objective: a different objective id is broken", evaluate({ objective: { ...goodObjective(), id: "something-else" }, probes: probes() }).verdict === "broken");
  t("objective: a missing objective is broken", evaluate({ objective: null, probes: probes() }).verdict === "broken");
  // (f) every task has a real executor; multi-role tiebreak = first real role in the head line
  t("executor: a row whose only role resolves to lane goes to needsExecutor, never tasks", r1.needsExecutor.some((n) => n.rowId === "6") && !r1.tasks.some((x) => x.rowId === "6"));
  t("executor: a row with a real executor is ranked", r1.tasks.some((x) => x.rowId === "5" && x.executor === "skill:signalgrid-native"));
  t("executor: multi-role row — the first REAL role wins (product-manager=lane skipped, web-engineer taken)", r1.tasks.some((x) => x.rowId === "12" && x.role === "web-engineer"));
  const repointed = rank({ rows, openIds: plan.open, roster: { ...roster, "product-manager": "agent:project-manager" }, roleIds, evaluation: e1, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() });
  t("executor: the same lane row re-pointed at a real executor is ranked", repointed.tasks.some((x) => x.rowId === "6"));
  t("order: document order is preserved (5 before 12)", r1.tasks.findIndex((x) => x.rowId === "5") < r1.tasks.findIndex((x) => x.rowId === "12"));
  // (f2) the re-measured stamp: an open row nobody measured within the window is ranked from nothing, and named
  const um = (id) => r1.unmeasured.find((u) => u.rowId === id);
  t("stamp: rowMeasuredAt takes the LATEST of several stamps, whatever the case", rowMeasuredAt(rows[2].text) === "2026-09-22");
  t("stamp: a row stamped 4 days before the instant is ranked", r1.tasks.some((x) => x.rowId === "5") && !um("5"));
  t("stamp: a row stamped 15 days before the instant is NOT ranked and is named with its reason", !r1.tasks.some((x) => x.rowId === "7") && /older than 14 days/.test(um("7")?.reason ?? ""));
  t("stamp: an unstamped open row is NOT ranked and is named", !r1.tasks.some((x) => x.rowId === "8") && um("8")?.reason === "no re-measured stamp" && um("8")?.measuredAt === null);
  t("stamp: a QUOTED or code-span stamp is not a stamp", rowMeasuredAt(rows[5].text) === null && !!um("9"));
  t("stamp: a future-dated stamp is not a stamp", !r1.tasks.some((x) => x.rowId === "10") && /future/.test(um("10")?.reason ?? ""));
  t("stamp: the refused rows raise ONE plan-rows-unmeasured escalation for the cloud naming every refused id", r1.escalations.filter((e) => e.id === "plan-rows-unmeasured").length === 1 && r1.escalations.some((e) => e.id === "plan-rows-unmeasured" && e.clears === "cloud" && ["7", "8", "9", "10"].every((id) => new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(e.asks))));
  t("stamp: a stamp older than the window is excluded even with a real executor — the stamp is checked before the roster", um("7")?.rowId === "7" && roster["web-engineer"] !== "lane");
  const allStale = rank({ rows, openIds: ["7", "8"], roster, roleIds, evaluation: e1, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() });
  t("stamp: with EVERY open row refused, tasks is empty and finalize is not broken — the refused rows are the named reason", allStale.tasks.length === 0 && allStale.unmeasured.length === 2 && finalize({ ...e1, probeErrors: [] }, allStale).verdict === "escalate");
  t("stamp: with no open row at all, finalize is still broken (the unmeasured list does not excuse a vacuous plan)", finalize({ ...e1, probeErrors: [] }, { tasks: [], needsExecutor: [], unmeasured: [], escalations: [], queue: [] }).verdict === "broken");
  t("stamp: the window is declared in code, not read from anywhere", MEASURE_WINDOW_DAYS === 14);
  // (g) TASK_TABLE ops exist and their argv writes what the criterion reads
  for (const [cid, entry] of Object.entries(TASK_TABLE)) {
    const op = SIM_OPERATIONS[entry.op];
    t(`task-table: ${cid} → op "${entry.op}" exists in SIM_OPERATIONS`, !!op);
    t(`task-table: op "${entry.op}" declares structured needsEnv (or no needs)`, !op || op.needs === undefined || Array.isArray(op.needsEnv));
    t(`task-table: op "${entry.op}" argv is the writer of ${entry.clears}`, !!op && op.argv.includes("--emit-evidence") && entry.clears === EVIDENCE_REL);
  }
  t("task-table: is not empty", Object.keys(TASK_TABLE).length > 0);
  // (h) needs blocks the queue; satisfied env queues exactly one
  const staleR = { headline: 0, floor: 80, details: { evidence: { pct: 0, reason: "stale" } } };
  const eStale = evaluate({ objective: goodObjective(), probes: probes({ readiness: staleR }) });
  const noEnv = rank({ rows, openIds: plan.open, roster, roleIds, evaluation: eStale, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() });
  t("needs: evidence unmet + SIGNALGRID_MCP_PATH absent → escalation, NO request queued", noEnv.queue.length === 0 && noEnv.escalations.some((e) => e.id === "evidence-fresh-op-unrunnable" && e.clears === "mac"));
  const withEnv = rank({ rows, openIds: plan.open, roster, roleIds, evaluation: eStale, envKeys: new Set(["SIGNALGRID_MCP_PATH"]), nowIso: T0, simOps: ops, objective: goodObjective() });
  t("needs: with the env present exactly ONE request is queued for evidence-fresh, its id carrying the decision day", withEnv.queue.length === 1 && withEnv.queue[0].op === "evidence" && withEnv.queue[0].id === `${REQUEST_PREFIX}evidence-fresh-${T0.slice(0, 10)}`);
  t("needs: a later decay (a different day) mints a DIFFERENT request id — the edge is not single-shot", rank({ rows, openIds: plan.open, roster, roleIds, evaluation: eStale, envKeys: new Set(["SIGNALGRID_MCP_PATH"]), nowIso: T1, simOps: ops, objective: goodObjective() }).queue[0].id !== withEnv.queue[0].id);
  const proseOnly = rank({ rows, openIds: plan.open, roster, roleIds, evaluation: eStale, envKeys: new Set(["SIGNALGRID_MCP_PATH"]), nowIso: T0, simOps: { evidence: { argv: ops.evidence.argv, needs: "some prose" } }, objective: goodObjective() });
  t("needs: a prose-only `needs` with no needsEnv → escalation, NO request (fail-closed on the unparseable case)", proseOnly.queue.length === 0 && proseOnly.escalations.some((e) => e.id === "evidence-fresh-op-needs-unstructured"));
  t("needs: a TASK_TABLE op missing from SIM_OPERATIONS → escalation", rank({ rows, openIds: plan.open, roster, roleIds, evaluation: eStale, envKeys: new Set(), nowIso: T0, simOps: {}, objective: goodObjective() }).escalations.some((e) => e.id === "evidence-fresh-op-missing"));
  // (j) content-addressing covers the DECISION only
  const mk = (over) => ({ objectiveId: OBJECTIVE_ID, objectiveSha: "o", verdict: "escalate", staleAfterHours: 3, criteria: e1.criteria, unmet: e1.unmet, tasks: r1.tasks, needsExecutor: r1.needsExecutor, escalations: r1.escalations, queue: [], derivedAt: T0, derivedAtCommit: "aaa", workingTreeCleanAtEntry: true, ...over });
  t("address: a moved HEAD, a later derivedAt and a dirty tree do NOT change the decision address", decisionAddress(mk({})) === decisionAddress(mk({ derivedAt: T1, derivedAtCommit: "bbb", workingTreeCleanAtEntry: false })));
  t("address: escalation `since` and task `firstRankedAt` do NOT change the address", decisionAddress(mk({})) === decisionAddress(mk({ escalations: r1.escalations.map((e) => ({ ...e, since: T1 })), tasks: r1.tasks.map((x) => ({ ...x, firstRankedAt: T1 })) })));
  t("address: a changed verdict DOES change the address", decisionAddress(mk({})) !== decisionAddress(mk({ verdict: "replan" })));
  t("address: a changed top task DOES change the address", decisionAddress(mk({})) !== decisionAddress(mk({ tasks: r1.tasks.slice(1) })));
  t("address: a changed staleAfterHours DOES change the address (it is a decision about the decision's lifetime)", decisionAddress(mk({})) !== decisionAddress(mk({ staleAfterHours: 1e9 })));
  t("address: an absent or EMPTY unmeasured list leaves the address as it was (a state derived before the field passes unchanged)", decisionAddress(mk({})) === decisionAddress(mk({ unmeasured: [] })));
  t("address: a changed unmeasured set DOES change the address", decisionAddress(mk({})) !== decisionAddress(mk({ unmeasured: [{ rowId: "8" }] })));
  // (l)/(m) finalize: non-vacuity and no silent stall
  t("finalize: escalate with no task, no needsExecutor and no probe error → broken", finalize({ ...e1, probeErrors: [] }, { tasks: [], needsExecutor: [], escalations: [], queue: [] }).verdict === "broken");
  t("finalize: escalate with nothing to escalate and no probe error → broken", finalize({ ...e1, probeErrors: [] }, { tasks: r1.tasks, needsExecutor: [], escalations: [], queue: [] }).verdict === "broken");
  t("finalize: replan with no task → broken", finalize({ ...eStale, verdict: "replan", probeErrors: [] }, { tasks: [], needsExecutor: r1.needsExecutor, escalations: [], queue: [] }).verdict === "broken");
  t("finalize: a well-formed escalate keeps its verdict", finalize({ ...e1, probeErrors: [] }, r1).verdict === "escalate");
  // (n) stale state tightens for readers
  const st = { verdict: "replan", derivedAt: T0, staleAfterHours: 3 };
  const hbFresh = { firedAt: "2026-09-24T12:30:00.000Z", result: "quiet; objective: replan" };
  const T0h = "2026-09-24T13:00:00.000Z";
  t("reader: a fresh heartbeat naming the same verdict → the recorded verdict", readVerdict(st, { heartbeat: hbFresh, nowIso: T0h }).verdict === "replan");
  t("reader: a heartbeat older than staleAfterHours → unknown, even though the state file is untouched", readVerdict(st, { heartbeat: hbFresh, nowIso: T1 }).verdict === "unknown");
  t("reader: NO heartbeat → unknown", readVerdict(st, { heartbeat: null, nowIso: T0h }).verdict === "unknown");
  t("reader: a fresh heartbeat naming a DIFFERENT verdict → unknown (this state is not what the Mac derives)", readVerdict(st, { heartbeat: { ...hbFresh, result: "quiet; objective: escalate" }, nowIso: T0h }).verdict === "unknown");
  t("reader: an UNPARSEABLE heartbeat instant reads as infinitely old → unknown", readVerdict(st, { heartbeat: { ...hbFresh, firedAt: "not-a-date" }, nowIso: T0h }).verdict === "unknown");
  t("reader: a malformed state reads as unknown", readVerdict({ verdict: "nope" }, { heartbeat: hbFresh, nowIso: T0h }).verdict === "unknown");
  t("reader: a state with no usable staleAfterHours reads as unknown", readVerdict({ verdict: "replan", derivedAt: T0 }, { heartbeat: hbFresh, nowIso: T0h }).verdict === "unknown");
  // stalled top task escalates
  const prior = { tasks: [{ rowId: "5", firstRankedAt: "2026-09-01T00:00:00.000Z" }], escalations: [] };
  t("stall: the same top task for > STALLED_TOP_DAYS raises stalled-top-task", rank({ rows, openIds: plan.open, roster, roleIds, evaluation: e1, priorState: prior, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() }).escalations.some((e) => e.id === "stalled-top-task"));
  t("stall: escalation `since` is carried from the prior state, not re-stamped", rank({ rows, openIds: plan.open, roster, roleIds, evaluation: e1, priorState: { tasks: [], escalations: [{ id: "owner-real-in-hand", since: "2026-09-20T00:00:00.000Z" }] }, envKeys: new Set(), nowIso: T0, simOps: ops, objective: goodObjective() }).escalations.find((e) => e.id === "owner-real-in-hand")?.since === "2026-09-20T00:00:00.000Z");
  // --check gate, both directions
  const good = { schemaVersion: 1, objectiveId: OBJECTIVE_ID, objectiveSha: "o", rosterSha: "r", verdict: "escalate", criteria: e1.criteria, unmet: e1.unmet, unknown: [], tasks: r1.tasks, needsExecutor: r1.needsExecutor, escalations: r1.escalations, queue: [], probeErrors: [], brokenReasons: [], staleAfterHours: 3, derivedAt: T0, derivedAtCommit: "abc" };
  good.decisionAddress = decisionAddress(good);
  const hbGood = { firedAt: "2026-09-24T12:50:00.000Z", result: "quiet; objective: escalate" };
  const chk = (s, o = {}) => checkState(s, { objectiveShaNow: "o", rosterShaNow: "r", headIsAncestor: true, nowIso: "2026-09-24T13:00:00.000Z", registryToleranceNow: 3, heartbeat: hbGood, ...o });
  t("check: a well-formed state passes", chk(good).fatal.length === 0);
  t("check: a hand-edited decision (address mismatch) fails", chk({ ...good, verdict: "goal_met" }).fatal.some((f) => /hand-edited/.test(f)));
  t("check: a ranked task whose executor is lane fails when the roster is unchanged", chk({ ...good, tasks: [{ ...r1.tasks[0], executor: "lane" }], decisionAddress: decisionAddress({ ...good, tasks: [{ ...r1.tasks[0], executor: "lane" }] }) }).fatal.some((f) => /no real executor/.test(f)));
  t("check: the same defect is REPORTED, not fatal, when the roster moved", chk({ ...good, tasks: [{ ...r1.tasks[0], executor: "lane" }], decisionAddress: decisionAddress({ ...good, tasks: [{ ...r1.tasks[0], executor: "lane" }] }) }, { rosterShaNow: "moved" }).fatal.length === 0);
  t("check: ancestry is fatal on a full clone", chk(good, { headIsAncestor: false }).fatal.some((f) => /ancestor/.test(f)));
  t("check: ancestry is REPORTED on a shallow clone", chk(good, { headIsAncestor: null }).fatal.length === 0 && chk(good, { headIsAncestor: null }).reported.some((r) => /shallow/.test(r)));
  t("check: a stale heartbeat is REPORTED as STALE, never fatal (CI cannot re-derive)", chk(good, { nowIso: T1 }).reported.some((r) => /STALE/.test(r)) && chk(good, { nowIso: T1 }).fatal.length === 0);
  t("check: a hand-edited staleAfterHours changes the address → FATAL", chk({ ...good, staleAfterHours: 1e9 }).fatal.some((f) => /hand-edited/.test(f)));
  t("check: staleAfterHours drifting from the registry row is REPORTED", chk(good, { registryToleranceNow: 5 }).reported.some((r) => /cadenceToleranceHours/.test(r)));
  const onlyUnmeasured = { ...good, tasks: [], needsExecutor: [], unmeasured: [{ rowId: "8", title: "No stamp", measuredAt: null, reason: "no re-measured stamp" }] };
  onlyUnmeasured.decisionAddress = decisionAddress(onlyUnmeasured);
  t("check: a state whose only work is refused rows passes, and the refusal is REPORTED with the row ids", chk(onlyUnmeasured).fatal.length === 0 && chk(onlyUnmeasured).reported.some((r) => /ranked from nothing.*\b8\b/.test(r)));
  t("check: the same state with the unmeasured list emptied is FATAL (no task, no row, no reason)", chk({ ...onlyUnmeasured, unmeasured: [], decisionAddress: decisionAddress({ ...onlyUnmeasured, unmeasured: [] }) }).fatal.some((f) => /broken resolver/.test(f)));
  t("check: a non-positive staleAfterHours is FATAL", chk({ ...good, staleAfterHours: 0, decisionAddress: decisionAddress({ ...good, staleAfterHours: 0 }) }).fatal.some((f) => /positive/.test(f)));
  // The attestation token must not be reachable by documentation: no decision-record section on
  // disk may carry it unless objective.json names that section. A record that QUOTES the token to
  // explain the mechanism would satisfy the check — the defect the security lens found on this branch.
  const recordsOnDisk = (() => { try { return readFileSync(join(ROOT, RECORDS_REL), "utf8"); } catch { return null; } })();
  const objOnDisk = (() => { try { return JSON.parse(readFileSync(join(ROOT, OBJECTIVE_REL), "utf8")); } catch { return null; } })();
  const carriers = recordsOnDisk === null ? null : recordsOnDisk.split(/\n## (?=DR-\d+)/).slice(1).filter((c) => c.includes(ATTESTATION_TOKEN)).map((c) => c.split(" ", 1)[0]);
  t("attestation: the token appears in NO decision-record section other than the one objective.attestedIn names (a record that quotes it would satisfy the check)", carriers !== null && carriers.every((id) => id === objOnDisk?.attestedIn));
  t("check: a future date fails", chk({ ...good, derivedAt: "2099-01-01T00:00:00.000Z" }).fatal.some((f) => /future/.test(f)));
  t("check: an escalate that names nothing fails", chk({ ...good, escalations: [], probeErrors: [], decisionAddress: decisionAddress({ ...good, escalations: [] }) }).fatal.some((f) => /DR-054/.test(f)));
  t("check: an unparseable date is fatal, and an unparseable gate instant is fatal too", chk({ ...good, derivedAt: "nope" }).fatal.some((f) => /not parseable/.test(f)) && chk(good, { nowIso: "nope" }).fatal.some((f) => /own instant/.test(f)));
  // floor
  t("self-test floor: at least 40 assertions ran", checks.length >= 40);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nobjective-loop self-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return process.exit(selfTest());
  if (argv.includes("--check")) return process.exit(runCheck());
  const write = argv.includes("--write");
  const deliver = argv.includes("--deliver");
  if (!write && !argv.includes("--json")) {
    console.log("usage: node scripts/objective-loop.mjs --json | --write [--deliver] | --check | --self-test");
    return process.exit(2);
  }
  const c = collect();
  const state = derive(c);
  if (argv.includes("--json") && !write) { console.log(JSON.stringify(state, null, 2)); return process.exit(state.verdict === "broken" ? 1 : 0); }
  const { lines } = emit(state, { write, deliver });
  for (const l of lines) console.log(l);
  if (state.verdict === "broken") for (const r of state.brokenReasons) console.log(`  broken: ${r}`);
  process.exit(state.verdict === "broken" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
