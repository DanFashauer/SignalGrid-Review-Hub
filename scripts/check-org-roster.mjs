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

/**
 * Pure audit so the verdict is testable without a filesystem.
 * roster: the parsed JSON; chartText: the markdown, or null if absent.
 */
export function auditOrgRoster(roster, chartText, known = null) {
  const problems = [];
  const byExecutor = new Map();
  const unactivated = [];
  const activated = [];

  const roles = Array.isArray(roster?.roles) ? roster.roles : null;
  if (roles === null) {
    problems.push(`${ROSTER}: no \`roles\` array — the registry is unreadable`);
    return { problems, unactivated, activated, byExecutor };
  }
  if (roles.length === 0) {
    problems.push(`${ROSTER}: the roster is empty — an org chart with no roles is not a chart`);
    return { problems, unactivated, activated, byExecutor };
  }

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
    return { problems, unactivated, activated, byExecutor };
  }
  for (const role of roles) {
    if (typeof role?.id === "string" && !chartText.includes(role.id)) {
      problems.push(`${CHART} never names \`${role.id}\` — registry and chart have drifted`);
    }
  }
  return { problems, unactivated, activated, byExecutor };
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
  const { problems, unactivated, activated, byExecutor } = auditOrgRoster(roster, chartText, known);

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
  if (problems.length > 0) {
    console.error(`\nOrg roster check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("\nOrg roster check passed — registry and chart agree, and every activation names what it produced.");
}
