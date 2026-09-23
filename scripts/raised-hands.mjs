// raised-hands.mjs — a stuck agent that says nothing looks exactly like a busy one.
//
//   pnpm run hands                                   # everything stuck, grouped by who can clear it
//   pnpm run hand:raise -- --clears owner --what "…" --needs "…" [--where "PR #1"] [--covers mail:<id>]
//   pnpm run hand:clear -- <id> --resolution "what unblocked it"
//   node scripts/raised-hands.mjs --check            # the gate (preflight + CI)
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
//   1. A HAND is a row in docs/agent/RAISED_HANDS.json: what is stuck, what one
//      thing unblocks it, who can clear it (owner | cloud | mac), since when. Any
//      agent writes one the moment it is stuck — twice-failed, permission- or
//      classifier-denied, owner-gated, or waiting on the other lane.
//   2. The system raises hands FOR agents that do not: mail unread past 24h, a sim
//      request pending past 48h, an active routine's heartbeat past its declared
//      tolerance, and (with --github) a PR red or idle-and-green too long. These
//      are AUTO hands, derived on every run, never stored.
//
// THE GATE (--check) fails when an auto hand is past its HARD limit (3× its soft
// limit) and no open raised hand `covers` it — silence past the limit is the
// defect; an explicit hand saying who must act is the cure, and costs one command.
// Raised hands past their own limit are OVERDUE: reported loudly, pushed to the
// owner's issue, never fatal — a gate cannot make a person act, only make the wait
// impossible to miss. Incoherent rows are fatal.
//
// UNKNOWN IS NEVER FRESH. An unparseable instant ages as infinitely old, exactly as
// check-lane-messages treats an unparseable sentAt.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = process.env.SIGNALGRID_LANE_REPO
  ? resolve(process.env.SIGNALGRID_LANE_REPO)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const HANDS_FILE = "docs/agent/RAISED_HANDS.json";
export const ROUTING_FILE = "docs/agent/hand-routing.json";
export const CLEARERS = ["owner", "cloud", "mac"];
const H = 3_600_000;

/** Soft limit per source: past it the hand is on the list; past HARD_MULTIPLE× it the gate fails unless covered. */
export const SOFT_LIMIT_H = { mail: 24, sim: 48, heartbeat: null /* the routine's own cadenceToleranceHours */, "pr-red": 24, "pr-idle": 48 };
export const HARD_MULTIPLE = 3;
/** Every auto-hand kind, plus the two routes every explicit hand falls into. Each needs a responder. */
export const AUTO_KINDS = Object.keys(SOFT_LIMIT_H);
export const REQUIRED_ROUTES = [...AUTO_KINDS, "owner", "capability-gap"];
/** A lane hand nobody has taken (`hand:take`) for this long is reported as unanswered. */
export const UNTAKEN_LIMIT_H = 2;
/** How long a RAISED hand may stay open before it is OVERDUE on the owner's issue. */
export const RAISED_LIMIT_H = { owner: 48, cloud: 24, mac: 48 };

const age = (iso, nowMs) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / H) : Infinity; // unknown is never fresh
};
export const fmtAge = (h) => (!Number.isFinite(h) ? "unknown age" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

// ── the explicit register ────────────────────────────────────────────────────
export function loadHands(root = repo) {
  const p = join(root, HANDS_FILE);
  if (!existsSync(p)) return { schemaVersion: 1, hands: [] };
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Schema problems — every one fatal. Pure, for the self-test. */
export function auditHands(doc) {
  const problems = [];
  if (!doc || !Array.isArray(doc.hands)) return ["RAISED_HANDS.json has no `hands` array"];
  const seen = new Set();
  for (const h of doc.hands) {
    const id = h?.id ?? "(no id)";
    if (!h?.id || !/^[a-z0-9][a-z0-9-]*$/.test(h.id)) problems.push(`hand ${id}: id must be lower-kebab-case`);
    if (seen.has(h?.id)) problems.push(`hand ${id}: duplicate id`);
    seen.add(h?.id);
    for (const f of ["raisedBy", "what", "needs"]) if (!String(h?.[f] ?? "").trim()) problems.push(`hand ${id}: no ${f} — a hand that does not say ${f === "needs" ? "what unblocks it" : f === "what" ? "what is stuck" : "who raised it"} cannot be acted on`);
    if (!CLEARERS.includes(h?.clears)) problems.push(`hand ${id}: clears "${h?.clears}" is not one of ${CLEARERS.join(", ")}`);
    if (!Number.isFinite(Date.parse(String(h?.raisedAt ?? "")))) problems.push(`hand ${id}: raisedAt is not an ISO instant`);
    if (h?.covers !== undefined && !(Array.isArray(h.covers) && h.covers.every((c) => typeof c === "string" && /^[a-z-]+:.+/.test(c)))) problems.push(`hand ${id}: covers must be a list of auto-hand ids like "mail:<message-id>"`);
    if (h?.assignedTo !== undefined && (!String(h.assignedTo).trim() || !Number.isFinite(Date.parse(String(h.takenAt ?? ""))))) problems.push(`hand ${id}: assignedTo needs a name and an ISO takenAt`);
    if (h?.status === "cleared") {
      if (!String(h.resolution ?? "").trim()) problems.push(`hand ${id}: cleared with no resolution — "done" without what was done is not evidence`);
      if (!Number.isFinite(Date.parse(String(h.clearedAt ?? "")))) problems.push(`hand ${id}: cleared with no ISO clearedAt`);
    } else if (h?.status !== "open") problems.push(`hand ${id}: status "${h?.status}" is not open or cleared`);
  }
  return problems;
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
export function autoHands({ messages = [], acks = [], simPending = [], routines = [], heartbeats = {}, prs = [] }, nowMs = Date.now()) {
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
  return out;
}

/** The whole picture: open raised hands (with OVERDUE) + auto hands (with covered/uncovered). */
export function evaluate(doc, autos, nowMs = Date.now()) {
  const open = (doc.hands ?? []).filter((h) => h.status === "open").map((h) => {
    const ageH = age(h.raisedAt, nowMs);
    return { ...h, ageH, overdue: ageH > (RAISED_LIMIT_H[h.clears] ?? 24) };
  });
  const covered = new Set(open.flatMap((h) => h.covers ?? []));
  const auto = autos.map((a) => ({ ...a, covered: covered.has(a.id), hard: a.ageH > a.softH * HARD_MULTIPLE }));
  const fatal = auto.filter((a) => a.hard && !a.covered).map((a) => `${a.id}: ${a.what} — ${fmtAge(a.ageH)}, past the ${a.softH * HARD_MULTIPLE}h limit and NO hand raised. Act, or: pnpm run hand:raise -- --clears ${a.clears} --covers ${a.id} --what "…" --needs "…"`);
  const staleCovers = [...covered].filter((c) => !autos.some((a) => a.id === c)).map((c) => `a hand covers ${c}, which is no longer stuck — clear that hand`);
  // THE MONITOR ON HAND-RAISING ITSELF (owner, 2026-09-23: "build something that
  // monitors the raise your hand function"). Two numbers: how much stuck work the
  // system had to find because no agent said so, and how many lane hands nobody
  // has picked up. Both are on the owner's page, every hour.
  const health = {
    systemFound: auto.filter((a) => !a.covered).length,
    agentRaised: open.length,
    untaken: open.filter((h) => h.clears !== "owner" && !h.assignedTo && h.ageH > UNTAKEN_LIMIT_H).map((h) => h.id),
  };
  return { open, auto, fatal, staleCovers, health };
}

// ── rendering ────────────────────────────────────────────────────────────────
const WHO = { owner: "Needs you (Dan)", cloud: "Needs the cloud lane", mac: "Needs the Mac lane" };
export function render({ open, auto }, { markdown = false, prsChecked = false } = {}) {
  const rows = [
    ...open.map((h) => ({ clears: h.clears, ageH: h.ageH, text: `${h.overdue ? "OVERDUE " : ""}${h.what} — needs: ${h.needs}${h.where ? ` — ${h.where}` : ""} (raised by ${h.raisedBy}${h.assignedTo ? `; taken by ${h.assignedTo}` : ""}; \`${h.id}\`)` })),
    ...auto.filter((a) => !a.covered).map((a) => ({ clears: a.clears, ageH: a.ageH, text: `${a.hard ? "PAST LIMIT " : ""}${a.what} — needs: ${a.needs}${a.where ? ` — ${a.where}` : ""} (auto; nobody raised a hand; \`${a.id}\`)` })),
  ];
  const lines = [];
  const total = rows.length;
  lines.push(markdown ? `# Raised hands — ${total} open` : `Raised hands — ${total} open${prsChecked ? "" : " (PRs NOT CHECKED here — the hourly issue job checks them)"}`);
  if (markdown) lines.push("", `Oldest first. Anything marked OVERDUE or PAST LIMIT has waited too long.${prsChecked ? "" : " PRs were NOT checked on this run."}`);
  for (const who of CLEARERS) {
    const mine = rows.filter((r) => r.clears === who).sort((a, b) => b.ageH - a.ageH);
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
async function loadInputs({ github = false } = {}) {
  const { loadMessages, loadAcks } = await import(pathToFileURL(join(repo, "scripts/lane-message.mjs")).href);
  const { load: loadRoutines } = await import(pathToFileURL(join(repo, "scripts/check-scheduled-routines.mjs")).href);
  const { registry, heartbeats } = loadRoutines(repo);
  // Sim pending is read from the gate's own output so "pending" means exactly what
  // the sim-request gate says it means — one definition, not two.
  const sim = spawnSync("node", [join(repo, "scripts/check-sim-requests.mjs")], { cwd: repo, encoding: "utf8" });
  const simPending = [];
  // A sim gate that printed nothing is not a sim loop with nothing pending: say so,
  // aged as unknown (never fresh), so the stuck list cannot go quiet by crashing.
  if (!/Simulation request loop —/.test(sim.stdout ?? "")) simPending.push({ id: "UNREADABLE-check-sim-requests-printed-nothing", ageDays: NaN });
  for (const line of (sim.stdout ?? "").split("\n")) {
    const m = /^\s+· (\S+) → (.*)$/.exec(line);
    if (!m || !/still queued|NOT run/.test(m[2])) continue;
    const d = /(\d+) day\(s\) old/.exec(m[2]);
    simPending.push({ id: m[1], ageDays: d ? Number(d[1]) : NaN });
  }
  const prs = github ? await loadPrs() : [];
  return { messages: loadMessages(), acks: loadAcks(), simPending, routines: registry.routines ?? [], heartbeats, prs };
}

const GATING_CHECK = "Typecheck, build, and proof scaffold";
async function loadPrs() {
  const token = process.env.GITHUB_TOKEN;
  const slug = process.env.GITHUB_REPOSITORY;
  if (!token || !slug) throw new Error("--github needs GITHUB_TOKEN and GITHUB_REPOSITORY — refusing to report PRs as checked when they were not");
  const api = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${slug}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
    return r.json();
  };
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

// ── writers ──────────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function save(doc) {
  const problems = auditHands(doc);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  writeFileSync(join(repo, HANDS_FILE), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}
function raise() {
  const doc = loadHands();
  const what = arg("--what");
  const now = new Date();
  const slug = String(what ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const id = arg("--id") ?? `${now.toISOString().slice(0, 10)}-${slug}`;
  const covers = process.argv.flatMap((a, i) => (a === "--covers" ? [process.argv[i + 1]] : []));
  const hand = { id, raisedAt: now.toISOString(), raisedBy: arg("--by") ?? process.env.SIGNALGRID_LANE ?? (process.platform === "darwin" ? "mac" : "cloud"), clears: arg("--clears"), what, needs: arg("--needs"), status: "open" };
  if (arg("--where")) hand.where = arg("--where");
  if (covers.length > 0) hand.covers = covers;
  doc.hands.push(hand);
  save(doc);
  console.log(`raised ${id} — ${HANDS_FILE}`);
}
function take() {
  const doc = loadHands();
  const id = process.argv.slice(process.argv.indexOf("take") + 1).find((a) => a !== "--");
  const hand = doc.hands.find((h) => h.id === id && h.status === "open");
  if (!hand) { console.error(`no open hand "${id}"`); process.exit(1); }
  Object.assign(hand, { assignedTo: arg("--by") ?? process.env.SIGNALGRID_LANE ?? (process.platform === "darwin" ? "mac" : "cloud"), takenAt: new Date().toISOString() });
  save(doc);
  console.log(`taken ${id} by ${hand.assignedTo}`);
}
function clear() {
  const doc = loadHands();
  const id = process.argv.slice(process.argv.indexOf("clear") + 1).find((a) => a !== "--"); // `pnpm run hand:clear -- <id>` may pass the "--" through
  const hand = doc.hands.find((h) => h.id === id);
  if (!hand) { console.error(`no hand "${id}"`); process.exit(1); }
  Object.assign(hand, { status: "cleared", clearedAt: new Date().toISOString(), clearedBy: arg("--by") ?? process.env.SIGNALGRID_LANE ?? (process.platform === "darwin" ? "mac" : "cloud"), resolution: arg("--resolution") });
  save(doc);
  console.log(`cleared ${id}`);
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  const T = Date.parse("2026-09-23T12:00:00Z");
  const ago = (h) => new Date(T - h * H).toISOString();
  const checks = [];
  const hand = (x = {}) => ({ id: "h1", raisedAt: ago(1), raisedBy: "cloud", clears: "owner", what: "w", needs: "n", status: "open", ...x });

  checks.push(["a well-formed hand is coherent", auditHands({ hands: [hand()] }).length === 0]);
  checks.push(["a hand with no `needs` is fatal — it cannot be acted on", auditHands({ hands: [hand({ needs: " " })] }).some((p) => p.includes("no needs"))]);
  checks.push(["an unknown clearer is fatal", auditHands({ hands: [hand({ clears: "someone" })] }).some((p) => p.includes("clears"))]);
  checks.push(["an unparseable raisedAt is fatal", auditHands({ hands: [hand({ raisedAt: "soon" })] }).some((p) => p.includes("raisedAt"))]);
  checks.push(["a cleared hand with no resolution is fatal", auditHands({ hands: [hand({ status: "cleared", clearedAt: ago(0) })] }).some((p) => p.includes("no resolution"))]);
  checks.push(["duplicate ids are fatal", auditHands({ hands: [hand(), hand()] }).some((p) => p.includes("duplicate"))]);

  const msg = (h, extra = {}) => ({ id: "m1", from: "cloud", to: "mac", subject: "s", sentAt: ago(h), ...extra });
  let a = autoHands({ messages: [msg(10)] }, T);
  checks.push(["mail unread 10h is not a hand yet", a.length === 0]);
  a = autoHands({ messages: [msg(30)] }, T);
  checks.push(["mail unread 30h is an AUTO hand for the addressee", a.length === 1 && a[0].id === "mail:m1" && a[0].clears === "mac"]);
  checks.push(["…acked mail is not", autoHands({ messages: [msg(30)], acks: [{ messageId: "m1" }] }, T).length === 0]);
  checks.push(["…superseded mail is not", autoHands({ messages: [msg(30), { id: "m2", from: "cloud", to: "mac", subject: "s", sentAt: ago(1), supersedes: "m1" }] }, T).length === 0]);
  checks.push(["UNKNOWN IS NEVER FRESH — mail with no instant at all is a hand", autoHands({ messages: [msg(0, { sentAt: undefined })] }, T).length === 1]);

  let e = evaluate({ hands: [] }, autoHands({ messages: [msg(80)] }, T), T);
  checks.push(["mail silent past 3×24h with NO hand raised FAILS the gate", e.fatal.length === 1 && e.fatal[0].startsWith("mail:m1")]);
  e = evaluate({ hands: [hand({ clears: "mac", covers: ["mail:m1"] })] }, autoHands({ messages: [msg(80)] }, T), T);
  checks.push(["…and one raised hand covering it clears the gate (the cure is to say so)", e.fatal.length === 0 && e.auto[0].covered]);
  e = evaluate({ hands: [hand({ status: "cleared", clearedAt: ago(0), resolution: "r", covers: ["mail:m1"] })] }, autoHands({ messages: [msg(80)] }, T), T);
  checks.push(["…but a CLEARED hand covers nothing", e.fatal.length === 1]);
  e = evaluate({ hands: [hand({ raisedAt: ago(60) })] }, [], T);
  checks.push(["an owner hand open 60h is OVERDUE, and overdue is not fatal", e.open[0].overdue && e.fatal.length === 0]);
  e = evaluate({ hands: [hand({ covers: ["mail:gone"] })] }, [], T);
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

  const text = render(evaluate({ hands: [hand()] }, autoHands({ messages: [msg(30)] }, T), T), { markdown: true, prsChecked: true });
  checks.push(["the owner's page groups by who clears it and names both kinds", text.includes("## Needs you (Dan) — 1") && text.includes("## Needs the Mac lane — 1") && text.includes("(auto; nobody raised a hand")]);
  checks.push(["a run that did not check PRs SAYS so", render(evaluate({ hands: [] }, [], T), { markdown: true }).includes("PRs were NOT checked")]);

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
  e = evaluate({ hands: [hand({ clears: "cloud", raisedAt: ago(3) })] }, autoHands({ messages: [msg(30)] }, T), T);
  checks.push(["health counts what the SYSTEM found with no hand raised", e.health.systemFound === 1 && e.health.agentRaised === 1]);
  checks.push(["health names a lane hand nobody has taken for 2h+", e.health.untaken.join() === "h1"]);
  e = evaluate({ hands: [hand({ clears: "cloud", raisedAt: ago(3), assignedTo: "hand-dispatcher", takenAt: ago(1) })] }, [], T);
  checks.push(["…and a taken hand is not untaken", e.health.untaken.length === 0]);
  checks.push(["an owner hand is never 'untaken' — only the owner can take it", evaluate({ hands: [hand({ raisedAt: ago(5) })] }, [], T).health.untaken.length === 0]);
  checks.push(["assignedTo with no takenAt is incoherent", auditHands({ hands: [hand({ assignedTo: "x" })] }).some((p) => p.includes("takenAt"))]);
  checks.push(["the owner's page carries the health line", render(evaluate({ hands: [] }, [], T), { markdown: true }).includes("Hand-raising health:")]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// ── main ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  if (argv[0] === "raise") { raise(); process.exit(0); }
  if (argv[0] === "clear") { clear(); process.exit(0); }
  if (argv[0] === "take") { take(); process.exit(0); }
  const doc = loadHands();
  const exists = (kind, name) => existsSync(join(repo, kind === "agent" ? `.claude/agents/${name}.md` : `.claude/skills/${name}/SKILL.md`));
  const routingPath = join(repo, ROUTING_FILE);
  const problems = [...auditHands(doc), ...(existsSync(routingPath) ? auditRouting(JSON.parse(readFileSync(routingPath, "utf8")), exists) : [`${ROUTING_FILE} is missing — no stall kind has a responder`])];
  if (argv.includes("--coherence")) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.log(problems.length === 0 ? "Raised hands register is coherent." : `Raised hands register FAILED: ${problems.length} problem(s).`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  const github = argv.includes("--github");
  const view = evaluate(doc, autoHands(await loadInputs({ github })));
  if (argv.includes("--markdown")) {
    console.log(render(view, { markdown: true, prsChecked: github }));
    const ids = [...view.open.map((h) => h.id), ...view.auto.filter((a) => !a.covered).map((a) => a.id)].sort();
    console.log(`\n<!-- hand-ids: ${ids.join(",")} -->`);
    process.exit(0);
  }
  console.log(render(view, { prsChecked: github }));
  for (const s of view.staleCovers) console.log(`  · REPORTED: ${s}`);
  if (argv.includes("--check")) {
    const fatal = [...problems, ...view.fatal];
    if (fatal.length > 0) {
      console.error(`\nRaised hands check FAILED: ${fatal.length} problem(s).`);
      for (const f of fatal) console.error(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log("\nRaised hands check passed — nothing is stuck past its limit without a hand raised.");
  }
}
