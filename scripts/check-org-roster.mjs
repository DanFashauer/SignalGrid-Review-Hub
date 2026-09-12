// check-org-roster.mjs — a role nobody has ever run is an org chart of ghosts.
//
//   node scripts/check-org-roster.mjs              # report + gate
//   node scripts/check-org-roster.mjs --self-test  # prove the gate can fail
//
// This repository found `tenant:admin` declared in the permission union,
// granted to a role, and required by NOTHING — a control that reads as
// protection and isn't. An org chart has exactly the same failure mode: a
// roster of thirty impressive titles, most of which never do any work, reads
// as capability the company does not have.
//
// So the roster is machine-readable (`docs/agent/org-roster.json`), the human
// document (`docs/ORG_CHART.md`) must agree with it, and the count of roles
// that have NEVER been activated is printed on every run.
//
// The split, and it is the same one every sibling gate uses:
//   FATAL     — incoherence, which is wrong on any day: a malformed entry, a
//               duplicate id, a role in the registry that the chart never
//               names, or a role the chart names that the registry lacks.
//               Drift between the two is the defect that makes both untrusted.
//   REPORTED  — how many roles have never been activated, and which. That is
//               a fact about where the company IS, not a defect: a role can
//               legitimately wait for its trigger. It is printed, never
//               silent, so "we have a compliance analyst" can never be said
//               without "who has never run" being visible beside it.
//
// THE CLOCK, added 2026-09-12 (org self-evaluation: "the roster has no clock,
// so a role's nextAction can sit done or stale for weeks unnoticed"). Every
// role now carries `nextActionDate` (ISO date, the day that nextAction was
// SET — not today's date, unless it really was set today). REPORTED, never
// fatal, same split as activation: a nextAction can legitimately be a few
// days old, so this names which are old rather than failing the build over
// an age nobody has decided is too much.
//
// DATE SOURCE, REVISED 2026-09-12 (Codex finding on dd027dd3): the first cut
// used the roster file's own latest commit date as "as of", reasoning that a
// wall-clock read would make two runs against the IDENTICAL commit disagree.
// That reasoning solved the wrong problem — it also meant a nextAction never
// ages at all while nobody happens to edit the roster, which is exactly the
// silent-staleness failure this clock exists to catch. The live REPORT now
// defaults to TODAY (`resolveAsOfDate` below: `--as-of YYYY-MM-DD`, then
// `SIGNALGRID_AS_OF`, then the process clock's UTC calendar date), and prints
// which of the three it used. This is a `Date.now()`-shaped read, so it is
// worth being explicit about why it does not need the discipline golden rule
// 2 puts on decision paths: (a) `scripts/review-invariants.mjs`'s determinism
// scan derives its scope from `lib/*/src/` (`determinismScope()`) — this file
// lives under `scripts/`, outside that scope, so review:invariants does not
// bind it and never has; (b) this section is REPORTED, never FATAL — a wrong
// "today" cannot fail a build, only mis-date one line of a report, so it is
// not a decision path in the sense golden rule 2 means. The SELF-TEST never
// touches the process clock: every fixture below passes a literal ISO string
// for asOfIso straight to `auditOrgRoster`, so the suite stays deterministic
// regardless of when or where it runs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = "docs/agent/org-roster.json";
const CHART = "docs/ORG_CHART.md";

const REQUIRED = ["id", "division", "title", "charter", "trigger", "executor", "nextAction"];

// EXECUTOR — what actually runs when this role is called.
//
//   agent:<name>  a dispatchable subagent, `.claude/agents/<name>.md`
//   skill:<name>  a skill the lane loads,  `.claude/skills/<name>/SKILL.md`
//   lane          nothing dedicated; the main lane adopts the role as a lens
//
// Added 2026-08-24. `docs/ORG_CHART.md` opened with "Each is an agent whose job
// is to be the deepest skill the company has in one thing" while the registry
// and the chart between them contained not one reference to `.claude/` — forty
// one roles, twelve agent definitions, and no edge from any role to any of them.
// The sentence was not checkable, and it was not true.
//
// The split here is the same one the activation count uses, for the same reason:
//   FATAL     — a role with no executor, a malformed one, or one naming an agent
//               or skill that does not exist on disk. That last case is the one
//               that bites: an executor is a pointer, and a pointer outlives the
//               file it points at. This repo has already had to repoint a
//               charter after the script under it was deleted.
//   REPORTED  — how many roles have a DEDICATED executor versus how many are the
//               main lane wearing a different hat. Printing it is the whole
//               honesty of the field. A roster where forty of forty one say
//               `lane` is a true roster and a thin company, and the number says
//               which one this is on any given day.
const EXECUTOR_FORM = /^(?:lane|agent:[a-z0-9][a-z0-9-]*|skill:[a-z0-9][a-z0-9-]*)$/;
// NOTE: the self-test below uses "marketing" as its example of an UNKNOWN division.
// A go-to-market division must therefore never be named `marketing` — doing so would
// quietly convert that negative control into a passing case, and the gate would stop
// proving it can fail. Named `go-to-market` for exactly that reason.
const DIVISIONS = new Set(["engineering", "signal-domain", "company", "go-to-market"]);

const STALE_AFTER_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Exactly four digits, a literal hyphen, two digits, a literal hyphen, two
// digits — `2026-9-3` or `2026-09-3` must not pass the SHAPE check, let alone
// the calendar-date check below.
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True iff `iso` is both shaped like `YYYY-MM-DD` AND a real calendar date.
 * `Date.parse`/`new Date(string)` alone is not enough — both silently roll
 * an out-of-range date forward (`2026-09-31` becomes October 1st), which
 * would let a typo'd date pass as a VALID, merely-different one instead of
 * landing in the unparseable bucket. Caught here by round-tripping through
 * `Date.UTC` and checking the constructed date's own components still say
 * what the string said — the same "does the round trip agree" shape the
 * freshness gate's NaN check already uses elsewhere in this repo, extended
 * to the case Date.parse accepts but silently reinterprets.
 */
export function isRealCalendarDate(iso) {
  if (typeof iso !== "string" || !ISO_DATE_SHAPE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ms)) return false;
  const rt = new Date(ms);
  return rt.getUTCFullYear() === y && rt.getUTCMonth() === m - 1 && rt.getUTCDate() === d;
}

/**
 * Pure day-count between two ISO date strings (asOf - dated). Returns null
 * when either side is not a real calendar date, rather than NaN, so a
 * malformed OR out-of-range `nextActionDate` (`2026-09-31`, `2026-2-3`) is
 * REPORTED as unparseable instead of silently sorting as "not stale" (NaN
 * comparisons are always false), "infinitely stale", or — the sharper trap —
 * a VALID but WRONG date (`2026-09-31` rolling forward into October) reading
 * as merely a few days off. The freshness gate's NaN-date silent pass is
 * exactly the defect class this repo already found once (qa-engineer's
 * produced note, 2026-08-19); this gate does not repeat it, and does not
 * repeat its softer cousin either.
 */
export function daysStale(datedIso, asOfIso) {
  if (!isRealCalendarDate(datedIso) || !isRealCalendarDate(asOfIso)) return null;
  const dated = Date.parse(datedIso);
  const asOf = Date.parse(asOfIso);
  return Math.round((asOf - dated) / MS_PER_DAY);
}

/**
 * Which roles' nextActionDate is more than STALE_AFTER_DAYS before asOfIso.
 * Pure and testable: asOfIso is passed in, never read from the clock here.
 * Three buckets, all REPORTED and none fatal:
 *   stale     — has a nextActionDate, and it is more than 7 days old.
 *   unparseable — has a nextActionDate that does not parse as a date; an
 *               unreadable clock is not the same claim as a fresh one.
 *   noClock   — has a nextAction but no nextActionDate at all yet.
 */
export function auditNextActionClock(roles, asOfIso) {
  const stale = [];
  const unparseable = [];
  const noClock = [];
  if (typeof asOfIso !== "string" || asOfIso.trim() === "") {
    return { stale, unparseable, noClock };
  }
  for (const role of roles) {
    const id = typeof role?.id === "string" ? role.id : "(no id)";
    if (typeof role?.nextAction !== "string" || role.nextAction.trim() === "") continue;
    if (typeof role?.nextActionDate !== "string" || role.nextActionDate.trim() === "") {
      noClock.push({ id });
      continue;
    }
    const age = daysStale(role.nextActionDate, asOfIso);
    if (age === null) {
      unparseable.push({ id, nextActionDate: role.nextActionDate });
    } else if (age > STALE_AFTER_DAYS) {
      stale.push({ id, nextActionDate: role.nextActionDate, days: age });
    }
  }
  return { stale, unparseable, noClock };
}

/**
 * Pure audit so the verdict is testable without a filesystem.
 * roster: the parsed JSON; chartText: the markdown, or null if absent.
 * asOfIso: optional — the date nextActionDate staleness is measured against
 * (see THE CLOCK above). Omitted entirely, the staleness report is empty
 * rather than guessed; the CLI always supplies it.
 */
export function auditOrgRoster(roster, chartText, known = null, asOfIso = null) {
  const problems = [];
  const byExecutor = new Map();
  const unactivated = [];
  const activated = [];

  const emptyClock = { stale: [], unparseable: [], noClock: [] };
  const roles = Array.isArray(roster?.roles) ? roster.roles : null;
  if (roles === null) {
    problems.push(`${ROSTER}: no \`roles\` array — the registry is unreadable`);
    return { problems, unactivated, activated, byExecutor, clock: emptyClock };
  }
  if (roles.length === 0) {
    problems.push(`${ROSTER}: the roster is empty — an org chart with no roles is not a chart`);
    return { problems, unactivated, activated, byExecutor, clock: emptyClock };
  }
  const clock = auditNextActionClock(roles, asOfIso);

  const seen = new Set();
  for (const role of roles) {
    const id = typeof role?.id === "string" ? role.id : "(no id)";
    for (const field of REQUIRED) {
      if (typeof role?.[field] !== "string" || role[field].trim() === "") {
        problems.push(`${ROSTER}: role \`${id}\` is missing \`${field}\` — a role without one is a title, not a job`);
      }
    }
    if (typeof role?.executor === "string" && role.executor.trim() !== "") {
      if (!EXECUTOR_FORM.test(role.executor)) {
        problems.push(`${ROSTER}: role \`${id}\` has malformed \`executor\` \`${role.executor}\` — expected \`lane\`, \`agent:<name>\` or \`skill:<name>\``);
      } else if (known !== null && role.executor !== "lane" && !known.has(role.executor)) {
        problems.push(`${ROSTER}: role \`${id}\` names executor \`${role.executor}\`, which does not exist on disk — a role pointing at a deleted agent reads as staffed and is not`);
      }
    }
    if (role?.division !== undefined && !DIVISIONS.has(role.division)) {
      problems.push(`${ROSTER}: role \`${id}\` has unknown division \`${role.division}\``);
    }
    if (seen.has(id)) problems.push(`${ROSTER}: duplicate role id \`${id}\``);
    seen.add(id);

    // An activated role must say what it produced — otherwise "activated" is
    // the unearned affirmative with a date on it.
    if (role?.activated != null && (typeof role.produced !== "string" || role.produced.trim() === "")) {
      problems.push(`${ROSTER}: role \`${id}\` claims activation on ${role.activated} but records nothing it produced`);
    }
    if (typeof role?.executor === "string") {
      byExecutor.set(role.executor, (byExecutor.get(role.executor) ?? 0) + 1);
    }

    // EVERY role owes a nextAction — see REQUIRED above, which is where the
    // missing-field failure is raised. It used to be asked of COLD roles only,
    // on the reasoning that a cold role must say what would make it real. That
    // reasoning does not stop at activation: on 2026-08-24, eleven of the
    // sixteen activated roles carried none, so running once emptied a role's
    // queue and "activated" quietly came to mean "finished, forever". A role
    // with nothing next is the same fossil as a title nobody runs, one shift
    // later. A role genuinely dormant says so IN the field.
    if (role?.activated == null) {
      const pri = Number.isInteger(role?.priority) ? role.priority : 9;
      unactivated.push({ id, division: role?.division ?? "?", priority: pri, nextAction: role?.nextAction ?? "(none)" });
    } else activated.push(`${id} (${role.activated})`);
  }

  if (chartText === null) {
    problems.push(`${CHART} does not exist — the registry has no human half to disagree with`);
    return { problems, unactivated, activated, byExecutor, clock };
  }
  for (const role of roles) {
    if (typeof role?.id === "string" && !chartText.includes(role.id)) {
      problems.push(`${CHART} never names \`${role.id}\` — registry and chart have drifted`);
    }
  }
  return { problems, unactivated, activated, byExecutor, clock };
}

/**
 * Every executor that could be dispatched, DERIVED from disk rather than listed
 * here. A hand-kept list of agents is the fossil the roster itself just failed
 * on, one directory over.
 */
export function discoverExecutors(root) {
  const found = new Set();
  const agents = join(root, ".claude/agents");
  if (existsSync(agents)) {
    for (const f of readdirSync(agents)) {
      if (f.endsWith(".md")) found.add(`agent:${f.slice(0, -3)}`);
    }
  }
  const skills = join(root, ".claude/skills");
  if (existsSync(skills)) {
    for (const d of readdirSync(skills, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(skills, d.name, "SKILL.md"))) found.add(`skill:${d.name}`);
    }
  }
  return found;
}

/**
 * "As of" for the live NEXT-ACTION CLOCK report — see the revised DATE SOURCE
 * comment at the top of this file. Priority order, first match wins:
 *   1. `--as-of YYYY-MM-DD` (or `--as-of=YYYY-MM-DD`) on the command line.
 *   2. `SIGNALGRID_AS_OF` in the environment.
 *   3. Today's UTC calendar date, from the process clock.
 * Returns `{ value, source }` — the CLI always prints `source`, so a run's
 * staleness report can be re-derived from what "today" meant at the time.
 * `value` is NOT validated as a real calendar date here; `auditNextActionClock`
 * already treats an unparseable/out-of-range asOfIso as "no report" via
 * `daysStale`'s guard, which is the correct fail-closed shape for a bad
 * override without duplicating the calendar check in two places.
 */
export function resolveAsOfDate({ argv = [], env = {} } = {}) {
  const eqFlag = argv.find((a) => typeof a === "string" && a.startsWith("--as-of="));
  if (eqFlag) return { value: eqFlag.slice("--as-of=".length), source: "--as-of flag" };
  const flagIndex = argv.indexOf("--as-of");
  if (flagIndex !== -1 && typeof argv[flagIndex + 1] === "string") {
    return { value: argv[flagIndex + 1], source: "--as-of flag" };
  }
  if (typeof env.SIGNALGRID_AS_OF === "string" && env.SIGNALGRID_AS_OF.trim() !== "") {
    return { value: env.SIGNALGRID_AS_OF.trim(), source: "SIGNALGRID_AS_OF env" };
  }
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return { value: `${y}-${m}-${d}`, source: "today (process clock, UTC calendar date)" };
}

function selfTest() {
  const checks = [];
  // A COMPLETE role: every later fixture is this one, minus exactly the field
  // under test. Building the negatives by subtraction is deliberate — a fixture
  // assembled field by field drifts out of sync with REQUIRED, and then the
  // negative controls stop being negative without anyone noticing.
  const ok = {
    id: "r1", division: "engineering", title: "T", charter: "C", trigger: "G",
    executor: "lane", nextAction: "the specific next thing", activated: null,
  };
  const chart = (...ids) => ids.join(" ");
  const KNOWN = new Set(["agent:real-agent", "skill:real-skill"]);
  const without = (field) => { const r = { ...ok }; delete r[field]; return r; };

  const cold = { ...ok, priority: 1 };
  let a = auditOrgRoster({ roles: [cold] }, chart("r1"), KNOWN);
  checks.push(["a well-formed unactivated role is clean, and REPORTED as unactivated", a.problems.length === 0 && a.unactivated.length === 1]);

  a = auditOrgRoster({ roles: [without("nextAction")] }, chart("r1"), KNOWN);
  checks.push(["a role with NO nextAction is FATAL — a title is not a job", a.problems.some((p) => p.includes("missing \`nextAction\`"))]);

  a = auditOrgRoster({ roles: [{ ...ok, activated: "2026-08-19", produced: "a thing" }] }, chart("r1"), KNOWN);
  checks.push(["an activated role that says what it produced is clean", a.problems.length === 0 && a.activated.length === 1]);

  a = auditOrgRoster({ roles: [{ ...without("nextAction"), activated: "2026-08-19", produced: "a thing" }] }, chart("r1"), KNOWN);
  checks.push(["an ACTIVATED role with nothing next is FATAL — running once does not empty the queue", a.problems.some((p) => p.includes("missing \`nextAction\`"))]);

  a = auditOrgRoster({ roles: [{ ...ok, activated: "2026-08-19" }] }, chart("r1"), KNOWN);
  checks.push(["an activated role producing NOTHING is FATAL", a.problems.some((p) => p.includes("records nothing it produced"))]);

  a = auditOrgRoster({ roles: [without("executor")] }, chart("r1"), KNOWN);
  checks.push(["a role naming NO executor is FATAL — nobody runs it", a.problems.some((p) => p.includes("missing \`executor\`"))]);

  a = auditOrgRoster({ roles: [{ ...ok, executor: "somebody" }] }, chart("r1"), KNOWN);
  checks.push(["a malformed executor is FATAL", a.problems.some((p) => p.includes("malformed \`executor\`"))]);

  a = auditOrgRoster({ roles: [{ ...ok, executor: "agent:ghost" }] }, chart("r1"), KNOWN);
  checks.push(["an executor naming an agent that is not on disk is FATAL — a pointer outlives its file", a.problems.some((p) => p.includes("does not exist on disk"))]);

  a = auditOrgRoster({ roles: [{ ...ok, executor: "skill:real-skill" }] }, chart("r1"), KNOWN);
  checks.push(["an executor that RESOLVES is clean — the check is not simply refusing everything", a.problems.length === 0]);

  a = auditOrgRoster({ roles: [{ ...ok, executor: "agent:ghost" }] }, chart("r1"), null);
  checks.push(["with no discovered set the pointer is UNCHECKED, not silently passed — the CLI refuses that state", a.problems.length === 0]);

  a = auditOrgRoster({ roles: [{ ...ok, executor: "agent:real-agent" }, { ...ok, id: "r2", executor: "lane" }] }, chart("r1", "r2"), KNOWN);
  checks.push(["the dedicated-versus-lane split is COUNTED, so it can be reported", a.byExecutor.get("agent:real-agent") === 1 && a.byExecutor.get("lane") === 1]);

  a = auditOrgRoster({ roles: [ok] }, chart("someone-else"), KNOWN);
  checks.push(["a role the chart never names is FATAL — registry/chart drift", a.problems.some((p) => p.includes("drifted"))]);

  a = auditOrgRoster({ roles: [{ ...ok, charter: "" }] }, chart("r1"), KNOWN);
  checks.push(["a role with no charter is FATAL — a title is not a job", a.problems.some((p) => p.includes("missing \`charter\`"))]);

  a = auditOrgRoster({ roles: [ok, ok] }, chart("r1"), KNOWN);
  checks.push(["a duplicate role id is FATAL", a.problems.some((p) => p.includes("duplicate role id"))]);

  a = auditOrgRoster({ roles: [{ ...ok, division: "marketing" }] }, chart("r1"), KNOWN);
  checks.push(["an unknown division is FATAL", a.problems.some((p) => p.includes("unknown division"))]);

  a = auditOrgRoster({ roles: [] }, chart(), KNOWN);
  checks.push(["an empty roster is FATAL", a.problems.some((p) => p.includes("not a chart"))]);

  a = auditOrgRoster({ roles: [ok] }, null, KNOWN);
  checks.push(["a missing chart is FATAL", a.problems.some((p) => p.includes("does not exist"))]);

  // The discovery half runs against the real tree: a set that came back empty
  // would make every pointer unresolvable-but-unchecked, which is the vacuous
  // pass this gate exists to refuse.
  const live = discoverExecutors(repo);
  checks.push(["executors are DISCOVERED from disk, not listed in this file", live.size > 0 && live.has("skill:signalgrid")]);

  // ── THE CLOCK: plant an old date and see the report line ──────────────────
  // This is the self-test the task exists to prove: a nextActionDate set more
  // than 7 days before "today" must be REPORTED as stale, and REPORTED only —
  // never added to `problems`, since a role may legitimately go quiet for a
  // week. Every fixture below reuses `ok`, so the negative controls stay in
  // sync with the schema the same way the rest of this file already does.
  {
    const asOf = "2026-09-12";
    const freshRole = { ...ok, id: "fresh", nextActionDate: "2026-09-10" }; // 2 days old
    const staleRole = { ...ok, id: "stale", nextActionDate: "2026-09-01" }; // 11 days old
    const edgeRole = { ...ok, id: "edge", nextActionDate: "2026-09-05" }; // exactly 7 days old
    const noClockRole = { ...ok, id: "noclock" }; // no nextActionDate at all
    const badDateRole = { ...ok, id: "baddate", nextActionDate: "not-a-date" };

    a = auditOrgRoster({ roles: [freshRole] }, chart("fresh"), KNOWN, asOf);
    checks.push(["a nextActionDate inside 7 days is not reported stale, and never fatal", a.problems.length === 0 && a.clock.stale.length === 0]);

    a = auditOrgRoster({ roles: [staleRole] }, chart("stale"), KNOWN, asOf);
    checks.push(["a nextActionDate more than 7 days old is REPORTED stale — the planted case this self-test exists to prove", a.problems.length === 0 && a.clock.stale.length === 1 && a.clock.stale[0].id === "stale" && a.clock.stale[0].days === 11]);

    a = auditOrgRoster({ roles: [edgeRole] }, chart("edge"), KNOWN, asOf);
    checks.push(["exactly 7 days old is NOT yet stale — the bar is MORE than 7", a.clock.stale.length === 0]);

    a = auditOrgRoster({ roles: [noClockRole] }, chart("noclock"), KNOWN, asOf);
    checks.push(["a role with a nextAction but no nextActionDate is REPORTED as having no clock, and never fatal", a.problems.length === 0 && a.clock.noClock.length === 1 && a.clock.stale.length === 0]);

    a = auditOrgRoster({ roles: [badDateRole] }, chart("baddate"), KNOWN, asOf);
    checks.push(["an unparseable nextActionDate is REPORTED as unparseable, not silently treated as fresh or as maximally stale — the freshness gate's NaN-date silent pass, not repeated here", a.problems.length === 0 && a.clock.unparseable.length === 1 && a.clock.stale.length === 0]);

    a = auditOrgRoster({ roles: [staleRole] }, chart("stale"), KNOWN, null);
    checks.push(["with no asOf date supplied, the clock report is empty rather than guessed — the CLI always supplies one", a.clock.stale.length === 0 && a.clock.unparseable.length === 0 && a.clock.noClock.length === 0]);

    checks.push(["daysStale is a plain day count, positive when the date is in the past", daysStale("2026-09-01", "2026-09-12") === 11]);
    checks.push(["daysStale returns null on a bad date rather than NaN, so callers cannot accidentally compare NaN > 7 and get false", daysStale("nonsense", "2026-09-12") === null]);

    // ── Codex finding on dd027dd3: a Date.parse-only check silently ROLLS an
    // out-of-range date forward instead of rejecting it — new Date("2026-09-31")
    // becomes October 1st, so a typo'd date would read as "merely a few days
    // off" instead of landing in the unparseable bucket. Both cases below MUST
    // resolve to null, and the second is the one Date.parse alone accepts.
    checks.push(["2026-09-31 is not a real calendar date (September has 30 days) — it must NOT silently become October 1st", isRealCalendarDate("2026-09-31") === false && daysStale("2026-09-31", "2026-10-05") === null]);
    checks.push(["2026-2-3 fails the SHAPE check (single-digit month) even though Date.parse would accept it", isRealCalendarDate("2026-2-3") === false && daysStale("2026-2-3", "2026-09-12") === null]);
    checks.push(["a role whose nextActionDate is 2026-09-31 is REPORTED unparseable by the audit, not silently stale-or-fresh", auditOrgRoster({ roles: [{ ...ok, id: "badcal", nextActionDate: "2026-09-31" }] }, chart("badcal"), KNOWN, "2026-10-05").clock.unparseable.length === 1]);
    checks.push(["a real calendar date round-trips clean", isRealCalendarDate("2026-09-12") === true]);

    // ── resolveAsOfDate: the CLI's three-tier source, and which it printed.
    checks.push(["--as-of flag (space form) wins over everything", resolveAsOfDate({ argv: ["--as-of", "2026-01-05"], env: { SIGNALGRID_AS_OF: "2026-02-02" } }).value === "2026-01-05" && resolveAsOfDate({ argv: ["--as-of", "2026-01-05"], env: {} }).source === "--as-of flag"]);
    checks.push(["--as-of=VALUE flag (equals form) also wins", resolveAsOfDate({ argv: ["--as-of=2026-03-04"], env: {} }).value === "2026-03-04"]);
    checks.push(["with no flag, SIGNALGRID_AS_OF env wins over the process clock", resolveAsOfDate({ argv: [], env: { SIGNALGRID_AS_OF: "2026-04-05" } }).value === "2026-04-05" && resolveAsOfDate({ argv: [], env: { SIGNALGRID_AS_OF: "2026-04-05" } }).source === "SIGNALGRID_AS_OF env"]);
    checks.push(["with neither flag nor env, the default is today's UTC calendar date and says so", (() => { const r = resolveAsOfDate({ argv: [], env: {} }); return r.source === "today (process clock, UTC calendar date)" && isRealCalendarDate(r.value); })()]);
  }

  const failed = checks.filter(([, k]) => !k);
  for (const [name, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());
if (runAsCli) runGate();

function runGate() {
  const rosterPath = join(repo, ROSTER);
  if (!existsSync(rosterPath)) {
    console.error(`Org roster check FAILED: ${ROSTER} does not exist.`);
    process.exit(1);
  }
  let roster;
  try {
    roster = JSON.parse(readFileSync(rosterPath, "utf8"));
  } catch (err) {
    console.error(`Org roster check FAILED: ${ROSTER} is not valid JSON — ${err.message}`);
    process.exit(1);
  }
  const chartPath = join(repo, CHART);
  const chartText = existsSync(chartPath) ? readFileSync(chartPath, "utf8") : null;
  const known = discoverExecutors(repo);
  if (known.size === 0) {
    // Zero discovered would leave every `agent:`/`skill:` pointer compared
    // against an empty set, and the gate would pass by having nothing to check.
    console.error("Org roster check FAILED: discovered no agents or skills under .claude/ — refusing to check pointers against an empty set.");
    process.exit(1);
  }
  const { value: asOfIso, source: asOfSource } = resolveAsOfDate({ argv: process.argv.slice(2), env: process.env });
  const { problems, unactivated, activated, byExecutor, clock } = auditOrgRoster(roster, chartText, known, asOfIso);

  const total = activated.length + unactivated.length;
  console.log(`Org roster — ${total} role(s): ${activated.length} activated, ${unactivated.length} never yet run`);
  if (unactivated.length > 0) {
    // Ordered by priority so the top of this list IS the next thing to do.
    const byPriority = [...unactivated].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const nextUp = byPriority.filter((u) => u.priority === 1);
    console.log("\n  NEVER ACTIVATED (reported, never fatal — a role may legitimately wait for its trigger):");
    for (const u of byPriority) console.log(`    · [P${u.priority}] ${u.division}/${u.id}`);
    if (nextUp.length > 0) {
      console.log(`\n  CALL THESE NEXT (priority 1 — ${nextUp.length} of ${unactivated.length}):`);
      for (const u of nextUp) console.log(`    · ${u.id}\n        ${u.nextAction}`);
    }
    console.log("\n  Call one with a shift, or delete it. A role nobody runs is a claim nobody keeps.");
  }

  // Who actually runs these. Reported, never fatal — but never silent either,
  // so "we have thirty one specialists" cannot be said without "and this many
  // of them are the same lane wearing a different hat" printed beside it.
  const laneCount = byExecutor.get("lane") ?? 0;
  const dedicated = [...byExecutor.entries()]
    .filter(([e]) => e !== "lane")
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  console.log(`\n  EXECUTORS — ${total - laneCount} role(s) have a dedicated agent or skill, ${laneCount} are the main lane as a lens:`);
  for (const [e, n] of dedicated) console.log(`    · ${e} — ${n} role(s)`);
  if (laneCount > 0) console.log(`    · lane — ${laneCount} role(s), no dedicated executor`);

  // THE CLOCK — reported, never fatal (see the header comment). asOfIso always
  // has a value now (resolveAsOfDate's third tier is the process clock, which
  // cannot fail), but a bad override (--as-of nonsense, or SIGNALGRID_AS_OF set
  // to garbage) must be SAID rather than silently reported as "nothing stale".
  if (!isRealCalendarDate(asOfIso)) {
    console.log(`\n  NEXT-ACTION CLOCK — unavailable: the as-of date \`${asOfIso}\` (source: ${asOfSource}) is not a real calendar date, so staleness cannot be reported this run.`);
  } else {
    const staleSorted = [...clock.stale].sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
    console.log(`\n  NEXT-ACTION CLOCK (as of ${asOfIso}, source: ${asOfSource}) — ${staleSorted.length} role(s) with nextAction older than 7d:`);
    for (const s of staleSorted) console.log(`    · ${s.id} — nextAction older than 7d (set ${s.nextActionDate}, ${s.days}d ago)`);
    if (clock.noClock.length > 0) {
      console.log(`    · NO CLOCK (nextAction has no nextActionDate): ${clock.noClock.map((n) => n.id).join(", ")}`);
    }
    if (clock.unparseable.length > 0) {
      for (const u of clock.unparseable) console.log(`    · ${u.id} — nextActionDate \`${u.nextActionDate}\` is not a valid calendar date`);
    }
    if (staleSorted.length === 0 && clock.noClock.length === 0 && clock.unparseable.length === 0) {
      console.log("    · none — every nextAction was set within the last 7 days.");
    }
  }

  if (problems.length > 0) {
    console.error(`\nOrg roster check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("\nOrg roster check passed — registry and chart agree, and every activation names what it produced.");
}
