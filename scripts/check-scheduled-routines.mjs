#!/usr/bin/env node
// Scheduled-routine registry gate (ai-ops next-work; NIST AI RMF's "explicitly
// defined human roles for AI oversight", made executable). Every always-on
// agent lane must be DECLARED — cadence, the human who authorized it, its
// write scope, its escalation boundary, and where its firing evidence lands —
// and the declaration must cohere with the evidence.
//
// WHAT THIS HONESTLY DOES NOT DO: read the live account scheduler. It gates
// the committed declaration (docs/agent/scheduled-routines.json) and the
// heartbeat artifacts (artifacts/agent-heartbeats/); the registry records the
// date it was transcribed from the live scheduler, and re-transcription is a
// manual act by the operating session.
//
// The reported/fatal split follows check-sim-requests and check-lane-messages:
//   FATAL   — incoherence: a routine with no authorizer, no write scope, or an
//             undeclared-missing heartbeat path; a heartbeat file with no
//             registry entry; an org-roster `producedByRoutine` naming an id
//             the registry lacks.
//   REPORTED, exit 0 — a heartbeat older than the declared cadence tolerance,
//             or a declared routine that has not yet written its first
//             heartbeat: the lanes are not always awake, but silence is never
//             silent.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REGISTRY = "docs/agent/scheduled-routines.json";
const HEARTBEATS_DIR = "artifacts/agent-heartbeats";
const ROSTER = "docs/agent/org-roster.json";

export function auditScheduledRoutines(registry, heartbeats, rosterText, listHeads = defaultListHeads) {
  const fatal = [];
  const reported = [];
  const routines = registry?.routines;
  if (!Array.isArray(routines)) return { fatal: [`${REGISTRY} carries no routines array`], reported };
  if (!registry.transcribedFrom) {
    fatal.push("the registry does not record when it was transcribed from the live scheduler — an undated transcription is a guess");
  }
  const ids = new Set();
  for (const r of routines) {
    const name = r.id ?? "<no id>";
    if (!r.id) fatal.push("a routine has no id");
    else if (ids.has(r.id)) fatal.push(`duplicate routine id ${r.id}`);
    else ids.add(r.id);
    if (!r.cron) fatal.push(`${name}: no cadence declared`);
    if (!r.authorizedBy) fatal.push(`${name}: no authorizing human — consent is never inferred, and a lane nobody authorized does not run`);
    if (!r.authorizationEvidence) fatal.push(`${name}: authorization has no evidence basis`);
    if (!r.writeScope) fatal.push(`${name}: no write scope — an agent lane with unstated write access is unbounded by definition`);
    if (!r.escalationBoundary) fatal.push(`${name}: no escalation boundary`);
    // A retired routine is a DECLARED shape, not a deleted row: the trigger is
    // disabled on the account, and the registry keeps the row with the date,
    // the human who retired it and the reason, so the history of what ran
    // against this repository never has a hole in it. A retired routine is
    // exempt from cadence reporting (it is supposed to be silent) — but a
    // heartbeat newer than its retirement date means the trigger fired anyway,
    // and that is FATAL: a disabled lane that still runs is worse than one that
    // was never declared.
    if (r.status !== undefined && r.status !== "active" && r.status !== "retired") {
      fatal.push(`${name}: status "${r.status}" is not a shape this registry knows (active | retired)`);
    }
    const retired = r.status === "retired";
    let retiredAt = NaN;
    if (retired) {
      retiredAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(r.retiredAt ?? "") ? Date.parse(r.retiredAt) : NaN;
      if (Number.isNaN(retiredAt)) fatal.push(`${name}: retired with no ISO retiredAt instant (YYYY-MM-DDTHH:MMZ) — an undated retirement cannot be checked against a later fire, and a date without a time would need slack a sub-daily cadence could fire inside`);
      else if (retiredAt > Date.now()) fatal.push(`${name}: retiredAt ${r.retiredAt} is in the future — a retirement that has not happened yet is not a retirement`);
      if (!r.retiredBy) fatal.push(`${name}: retired with no retiring party named`);
      if (!r.retiredReason || r.retiredReason.length < 40) fatal.push(`${name}: retired with no reason a reviewer can weigh (40+ characters)`);
      // A row that never wrote heartbeats cannot be caught firing through a
      // heartbeat, so it must name the evidence its own write scope leaves
      // (a branch glob on origin) and this gate looks there. A lister that
      // cannot answer is fatal: "could not look" is not "nothing there".
      if (r.heartbeatPath === null) {
        const glob = r.retiredEvidence?.branchGlob;
        if (!glob) {
          fatal.push(`${name}: retired with a null heartbeat and no retiredEvidence.branchGlob — with no heartbeat, the branches its write scope names are the only place a post-retirement fire could show, and this row names none`);
        } else {
          let heads;
          try {
            heads = listHeads(glob);
          } catch (e) {
            fatal.push(`${name}: could not list origin heads for ${glob} (${e.message}) — this gate refuses to call a retired lane silent when it could not look`);
          }
          if (Array.isArray(heads) && heads.length > 0) {
            fatal.push(`${name}: declared retired at ${r.retiredAt} but origin still carries ${heads.length} head(s) matching ${glob}: ${heads.join(", ")} — either the lane fired after retirement or its branches were never cleaned; delete them or un-retire the row`);
          }
        }
      }
    }
    if (r.heartbeatPath === undefined) {
      fatal.push(`${name}: heartbeat path is silently absent — declare a path, or null WITH a reason`);
    } else if (r.heartbeatPath === null) {
      if (!r.heartbeatPathReason) fatal.push(`${name}: heartbeat path is null with no reason — an undocumented gap is a gap twice over`);
    } else {
      const hb = heartbeats[r.heartbeatPath];
      if (hb === undefined) {
        reported.push(`${name}: no heartbeat written yet at ${r.heartbeatPath} — declared but not yet evidenced firing (the next fire writes the first)`);
      } else {
        let parsed;
        try {
          parsed = JSON.parse(hb);
        } catch {
          fatal.push(`${name}: heartbeat at ${r.heartbeatPath} does not parse`);
        }
        if (parsed) {
          const at = Date.parse(parsed.firedAt ?? "");
          if (Number.isNaN(at)) {
            fatal.push(`${name}: heartbeat carries no parseable firedAt — 'ran at some point' is not evidence`);
          } else if (retired) {
            if (!Number.isNaN(retiredAt) && at > retiredAt) {
              fatal.push(`${name}: declared retired at ${r.retiredAt} but its heartbeat fired at ${parsed.firedAt} — the trigger is still running; disable it on the account or un-retire the row`);
            }
          } else if (r.cadenceToleranceHours != null) {
            const ageH = (Date.now() - at) / 3_600_000;
            if (ageH > r.cadenceToleranceHours) {
              reported.push(`${name}: heartbeat is ${ageH.toFixed(1)}h old, beyond its ${r.cadenceToleranceHours}h tolerance — the lane may be asleep (REPORTED, never silent)`);
            }
          }
        }
      }
    }
  }
  // Every heartbeat must belong to a declared routine — an undeclared lane
  // leaving evidence is the exact thing this registry exists to prevent.
  for (const path of Object.keys(heartbeats)) {
    const owned = routines.some((r) => r.heartbeatPath === path);
    if (!owned) fatal.push(`heartbeat ${path} belongs to NO declared routine — an undeclared always-on lane is running`);
  }
  // Roster cross-check: a roster row attributing output to a routine id the
  // registry lacks is a phantom attribution.
  if (rosterText) {
    for (const m of rosterText.matchAll(/"producedByRoutine":\s*"([a-z0-9-]+)"/g)) {
      if (!ids.has(m[1])) fatal.push(`org-roster attributes output to routine "${m[1]}", which the registry does not declare`);
    }
  }
  return { fatal, reported };
}

/** origin heads matching a refs/heads glob, via ls-remote; throws when the remote cannot be asked. */
function defaultListHeads(glob) {
  const r = spawnSync("git", ["ls-remote", "--heads", "origin", `refs/heads/${glob}`], { encoding: "utf8", timeout: 60_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ls-remote exited ${r.status}: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t")[1]?.replace("refs/heads/", "")).filter(Boolean);
}

function load() {
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const heartbeats = {};
  if (existsSync(HEARTBEATS_DIR)) {
    for (const f of readdirSync(HEARTBEATS_DIR)) {
      if (f.endsWith(".json")) heartbeats[join(HEARTBEATS_DIR, f)] = readFileSync(join(HEARTBEATS_DIR, f), "utf8");
    }
  }
  const rosterText = existsSync(ROSTER) ? readFileSync(ROSTER, "utf8") : "";
  return { registry, heartbeats, rosterText };
}

function selfTest() {
  const checks = [];
  const good = {
    transcribedFrom: "live scheduler, 2026-08-21",
    routines: [
      { id: "a", cron: "0 1 * * *", authorizedBy: "Owner", authorizationEvidence: "e", writeScope: "w", escalationBoundary: "b", heartbeatPath: "artifacts/agent-heartbeats/a.json", cadenceToleranceHours: 50 },
      { id: "b", cron: "0 2 * * *", authorizedBy: "Owner", authorizationEvidence: "e", writeScope: "w", escalationBoundary: "b", heartbeatPath: null, heartbeatPathReason: "branch-scoped writer" },
    ],
  };
  const freshHb = { "artifacts/agent-heartbeats/a.json": JSON.stringify({ firedAt: new Date().toISOString(), result: "quiet" }) };
  let r = auditScheduledRoutines(good, freshHb, "");
  checks.push(["a coherent registry with a fresh heartbeat passes clean", r.fatal.length === 0 && r.reported.length === 0]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], authorizedBy: null }] }, freshHb, "");
  checks.push(["a routine with no authorizer is FATAL — consent is never inferred", r.fatal.some((x) => x.includes("no authorizing human"))]);
  r = auditScheduledRoutines(good, { ...freshHb, "artifacts/agent-heartbeats/ghost.json": JSON.stringify({ firedAt: new Date().toISOString() }) }, "");
  checks.push(["a heartbeat with no registry entry is FATAL — an undeclared lane is running", r.fatal.some((x) => x.includes("ghost"))]);
  r = auditScheduledRoutines(good, freshHb, '{"producedByRoutine": "unknown-routine"}');
  checks.push(["a roster attribution to an unknown routine id is FATAL", r.fatal.some((x) => x.includes("unknown-routine"))]);
  const staleHb = { "artifacts/agent-heartbeats/a.json": JSON.stringify({ firedAt: "2026-08-01T00:00:00Z" }) };
  r = auditScheduledRoutines(good, staleHb, "");
  checks.push(["a stale heartbeat is REPORTED and exits 0", r.fatal.length === 0 && r.reported.some((x) => x.includes("beyond its"))]);
  r = auditScheduledRoutines({ transcribedFrom: "x", routines: [] }, {}, "");
  checks.push(["an empty registry with no heartbeats is clean", r.fatal.length === 0 && r.reported.length === 0]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[1], heartbeatPathReason: undefined }] }, {}, "");
  checks.push(["a null heartbeat path WITHOUT a reason is FATAL", r.fatal.some((x) => x.includes("no reason"))]);
  const retiredGood = { ...good.routines[0], id: "c", status: "retired", retiredAt: "2026-09-01T12:00Z", retiredBy: "Owner", retiredReason: "designed before the lane could open pull requests itself; it fired and left nothing behind", heartbeatPath: "artifacts/agent-heartbeats/c.json" };
  const noHeads = () => [];
  const oldHb = { "artifacts/agent-heartbeats/c.json": JSON.stringify({ firedAt: "2026-08-30T14:00:00Z", result: "quiet" }) };
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredGood] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["a retired routine with a date, a human and a reason, whose last heartbeat predates the retirement, is clean", r.fatal.length === 0]);
  checks.push(["…and it is NOT reported stale — retired means silent by design", !r.reported.some((x) => x.startsWith("c:"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredGood] }, { ...freshHb, "artifacts/agent-heartbeats/c.json": JSON.stringify({ firedAt: new Date().toISOString(), result: "acted" }) }, "", noHeads);
  checks.push(["a retired routine whose heartbeat fired AFTER retirement is FATAL — the trigger is still running", r.fatal.some((x) => x.includes("still running"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredGood] }, { ...freshHb, "artifacts/agent-heartbeats/c.json": JSON.stringify({ firedAt: "2026-09-01T12:00:01Z", result: "acted" }) }, "", noHeads);
  checks.push(["…and one that fired ONE SECOND after the retirement instant is FATAL too — there is no slack for a later fire to hide in", r.fatal.some((x) => x.includes("still running"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredGood] }, { ...freshHb, "artifacts/agent-heartbeats/c.json": JSON.stringify({ firedAt: "2026-09-01T11:59:59Z", result: "quiet" }) }, "", noHeads);
  checks.push(["…while one that fired one second BEFORE it is clean — the comparison is the instant itself", !r.fatal.some((x) => x.includes("still running"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredGood, retiredAt: undefined }] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["retired without an ISO instant is FATAL", r.fatal.some((x) => x.includes("no ISO retiredAt"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredGood, retiredAt: "2026-09-01" }] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["a date without a time is FATAL — no slack for a sub-daily cadence to fire inside", r.fatal.some((x) => x.includes("no ISO retiredAt"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredGood, retiredBy: undefined }] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["retired with no retiring party is FATAL", r.fatal.some((x) => x.includes("no retiring party"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredGood, retiredAt: "2999-01-01T00:00Z" }] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["retired on a future date is FATAL", r.fatal.some((x) => x.includes("in the future"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredGood, retiredReason: "gone" }] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["retired with a reason too short to weigh is FATAL", r.fatal.some((x) => x.includes("reason a reviewer can weigh"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredGood, status: "paused" }] }, { ...freshHb, ...oldHb }, "", noHeads);
  checks.push(["an unknown status is FATAL, not read as active", r.fatal.some((x) => x.includes("not a shape"))]);
  const retiredNull = { ...retiredGood, heartbeatPath: null, heartbeatPathReason: "branch-scoped writer", retiredEvidence: { branchGlob: "claude/build-agent-*" } };
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredNull] }, freshHb, "", noHeads);
  checks.push(["a retired null-heartbeat routine whose branch glob has NO heads on origin is clean", r.fatal.length === 0]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredNull] }, freshHb, "", () => ["claude/build-agent-late"]);
  checks.push(["…and one whose glob still has a head on origin is FATAL — the branch is the only evidence it can leave", r.fatal.some((x) => x.includes("still carries"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, retiredNull] }, freshHb, "", () => { throw new Error("no network"); });
  checks.push(["a lister that cannot ask origin is FATAL — could not look is not nothing there", r.fatal.some((x) => x.includes("could not list"))]);
  r = auditScheduledRoutines({ ...good, routines: [...good.routines, { ...retiredNull, retiredEvidence: undefined }] }, freshHb, "", noHeads);
  checks.push(["a retired null-heartbeat routine that names no evidence is FATAL", r.fatal.some((x) => x.includes("no retiredEvidence"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const { registry, heartbeats, rosterText } = load();
  const { fatal, reported } = auditScheduledRoutines(registry, heartbeats, rosterText);
  console.log(`Scheduled-routine registry — ${registry.routines?.length ?? 0} declared lane(s), ${Object.keys(heartbeats).length} heartbeat(s)`);
  for (const r of reported) console.log(`  · REPORTED: ${r}`);
  if (fatal.length > 0) {
    console.error(`Scheduled-routine check FAILED: ${fatal.length} incoherence(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Scheduled-routine check passed — every always-on lane is declared, authorized, scoped, and evidenced (or its gap is stated).");
}
