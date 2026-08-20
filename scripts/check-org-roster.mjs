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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = "docs/agent/org-roster.json";
const CHART = "docs/ORG_CHART.md";

const REQUIRED = ["id", "division", "title", "charter", "trigger"];
const DIVISIONS = new Set(["engineering", "signal-domain", "company"]);

/**
 * Pure audit so the verdict is testable without a filesystem.
 * roster: the parsed JSON; chartText: the markdown, or null if absent.
 */
export function auditOrgRoster(roster, chartText) {
  const problems = [];
  const unactivated = [];
  const activated = [];

  const roles = Array.isArray(roster?.roles) ? roster.roles : null;
  if (roles === null) {
    problems.push(`${ROSTER}: no \`roles\` array — the registry is unreadable`);
    return { problems, unactivated, activated };
  }
  if (roles.length === 0) {
    problems.push(`${ROSTER}: the roster is empty — an org chart with no roles is not a chart`);
    return { problems, unactivated, activated };
  }

  const seen = new Set();
  for (const role of roles) {
    const id = typeof role?.id === "string" ? role.id : "(no id)";
    for (const field of REQUIRED) {
      if (typeof role?.[field] !== "string" || role[field].trim() === "") {
        problems.push(`${ROSTER}: role \`${id}\` is missing \`${field}\` — a role without one is a title, not a job`);
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
    if (role?.activated == null) {
      // A cold role must say what would make it real. Without this, the roster
      // drifts back into a list of titles: "we have a threat modeller" with no
      // answer to "so what happens next?". The program-manager shift added
      // nextAction + priority to all 21 cold roles on 2026-08-19 precisely so
      // this list stops being a census and starts being a queue.
      if (typeof role?.nextAction !== "string" || role.nextAction.trim() === "") {
        problems.push(`${ROSTER}: cold role \`${id}\` has no \`nextAction\` — a role that cannot say what would activate it is a title, not a job`);
      }
      const pri = Number.isInteger(role?.priority) ? role.priority : 9;
      unactivated.push({ id, division: role?.division ?? "?", priority: pri, nextAction: role?.nextAction ?? "(none)" });
    } else activated.push(`${id} (${role.activated})`);
  }

  if (chartText === null) {
    problems.push(`${CHART} does not exist — the registry has no human half to disagree with`);
    return { problems, unactivated, activated };
  }
  for (const role of roles) {
    if (typeof role?.id === "string" && !chartText.includes(role.id)) {
      problems.push(`${CHART} never names \`${role.id}\` — registry and chart have drifted`);
    }
  }
  return { problems, unactivated, activated };
}

function selfTest() {
  const checks = [];
  const ok = { id: "r1", division: "engineering", title: "T", charter: "C", trigger: "G", activated: null };
  const chart = (...ids) => ids.join(" ");

  const cold = { ...ok, priority: 1, nextAction: "do the specific thing" };
  let a = auditOrgRoster({ roles: [cold] }, chart("r1"));
  checks.push(["a well-formed unactivated role is clean, and REPORTED as unactivated", a.problems.length === 0 && a.unactivated.length === 1]);

  a = auditOrgRoster({ roles: [ok] }, chart("r1"));
  checks.push(["a cold role with NO nextAction is FATAL — a title is not a job", a.problems.some((p) => p.includes("nextAction"))]);

  a = auditOrgRoster({ roles: [{ ...ok, activated: "2026-08-19", produced: "a thing" }] }, chart("r1"));
  checks.push(["an activated role that says what it produced is clean", a.problems.length === 0 && a.activated.length === 1]);

  a = auditOrgRoster({ roles: [{ ...ok, activated: "2026-08-19" }] }, chart("r1"));
  checks.push(["an activated role producing NOTHING is FATAL", a.problems.some((p) => p.includes("records nothing it produced"))]);

  a = auditOrgRoster({ roles: [ok] }, chart("someone-else"));
  checks.push(["a role the chart never names is FATAL — registry/chart drift", a.problems.some((p) => p.includes("drifted"))]);

  a = auditOrgRoster({ roles: [{ ...ok, charter: "" }] }, chart("r1"));
  checks.push(["a role with no charter is FATAL — a title is not a job", a.problems.some((p) => p.includes("missing `charter`"))]);

  a = auditOrgRoster({ roles: [ok, ok] }, chart("r1"));
  checks.push(["a duplicate role id is FATAL", a.problems.some((p) => p.includes("duplicate role id"))]);

  a = auditOrgRoster({ roles: [{ ...ok, division: "marketing" }] }, chart("r1"));
  checks.push(["an unknown division is FATAL", a.problems.some((p) => p.includes("unknown division"))]);

  a = auditOrgRoster({ roles: [] }, chart());
  checks.push(["an empty roster is FATAL", a.problems.some((p) => p.includes("not a chart"))]);

  a = auditOrgRoster({ roles: [ok] }, null);
  checks.push(["a missing chart is FATAL", a.problems.some((p) => p.includes("does not exist"))]);

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
  const { problems, unactivated, activated } = auditOrgRoster(roster, chartText);

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
  if (problems.length > 0) {
    console.error(`\nOrg roster check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("\nOrg roster check passed — registry and chart agree, and every activation names what it produced.");
}
