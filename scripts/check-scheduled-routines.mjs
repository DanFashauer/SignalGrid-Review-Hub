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
import { join } from "node:path";

const REGISTRY = "docs/agent/scheduled-routines.json";
const HEARTBEATS_DIR = "artifacts/agent-heartbeats";
const ROSTER = "docs/agent/org-roster.json";

export function auditScheduledRoutines(registry, heartbeats, rosterText) {
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
