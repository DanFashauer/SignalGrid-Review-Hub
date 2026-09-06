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
//
// THREE RULES ADDED 2026-09-06, each because the gate printed a green headline
// over a lane that was not running:
//
//   1. UNDECLARED RETIREMENT (FATAL). `live-sync-loop-keeper` was declared
//      ALWAYS-ON on 2026-07-27 and produced zero firing evidence for its whole
//      41-day life — `git log --all -- artifacts/agent-heartbeats/live-sync-loop-keeper.json`
//      returned nothing — while this gate reported it, and exited 0. A lane that
//      has NEVER ONCE fired is not an asleep lane; it is a retirement nobody
//      declared, and "asleep" is the reading that let it sit. So: never fired,
//      no `status`, and authorized more than NEVER_FIRED_FATAL_HOURS ago is
//      FATAL. Two honest escapes, both of which say the true thing out loud:
//        · `status: "retired"` — the trigger is off (nightly-build-agent's shape).
//        · `status: "awaiting-activation"` — declared, authorized, and not yet
//          installed. It needs `awaitingReason` and `awaitingSince`, is REPORTED
//          rather than fatal, and goes FATAL once `awaitingSince` is more than
//          AWAITING_FATAL_DAYS old: "waiting" is a state with a shelf life, and
//          a permanent one is the same undeclared retirement wearing a label.
//      A routine whose FIRST fire is still inside its cadence tolerance is
//      untouched by all of this — that case is young, not absent.
//      `status: "active"` is NOT an escape: a declaration is not evidence, and a
//      row that asserts it is running while nothing has ever run is the exact
//      claim this rule exists to disbelieve.
//
//   2. LAUNCHD TRIGGER PARITY (FATAL). Two fields — `trigger` and `binding` —
//      were read by nothing. For the four `trig_*` account triggers that is
//      unavoidable and the header above says so. But `mac-lane-tick`'s trigger
//      names a launchd label AND the installer that creates it, and both halves
//      are in this tree: for any `trigger` beginning `launchd:`, the label must
//      equal `LABEL=` in the installer the trigger names, and `cron` must imply
//      exactly the installer's `INTERVAL_SECONDS`. Deliberately NOT extended to
//      `trig_*`: this tree cannot read the account scheduler, and a gate that
//      reports a permanent expected condition is one everyone learns to scroll
//      past. A parse that finds neither field is FATAL, not skipped — "could not
//      read the installer" is not "the installer agrees".
//
//   3. TOLERANCE vs CADENCE (FATAL). `mac-lane-steward-duty-cycle` moved from a
//      4-hourly to an hourly cron on 2026-09-05 and kept its 4h tolerance, so
//      three consecutive missed fires were silent — on the very routine whose
//      job is escalating another routine's absence. The bound:
//
//          cadenceToleranceHours <= max(3 x cron interval, 3h)
//
//      THREE MISSED FIRES is the multiple: two is inside the ordinary jitter of
//      a laptop that closed its lid, four is a working day of silence. The 3h
//      FLOOR is there because a sub-hourly cadence would otherwise demand a
//      tolerance no real host can hold — `mac-lane-tick` runs every 30 minutes
//      on a Mac that sleeps, and a 1.5h bound on it would report a lane that is
//      simply lunch-hour asleep. A flaky gate gets switched off, so the floor is
//      part of the rule rather than an exception to it. Hourly cron: 3h passes,
//      4h fails. A cron shape this gate cannot parse is FATAL — an unreadable
//      cadence cannot bound anything, and skipping it is the fail-open direction.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REGISTRY = "docs/agent/scheduled-routines.json";
const HEARTBEATS_DIR = "artifacts/agent-heartbeats";
const ROSTER = "docs/agent/org-roster.json";

/** A heartbeat may run a few minutes ahead of this clock (two hosts); further is a broken clock. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Never fired for longer than this, with no status, is an undeclared retirement (rule 1). */
export const NEVER_FIRED_FATAL_HOURS = 168; // seven days

/** `awaiting-activation` older than this stops being a wait and becomes a retirement (rule 1). */
export const AWAITING_FATAL_DAYS = 30;

/** cadenceToleranceHours ceiling = max(MULTIPLE x interval, FLOOR) — see rule 3 above. */
export const TOLERANCE_MULTIPLE = 3;
export const TOLERANCE_FLOOR_HOURS = 3;

/** The statuses this registry knows. `active` is a declaration, never an escape from rule 1. */
export const KNOWN_STATUSES = ["active", "retired", "awaiting-activation"];

/**
 * Pure: the interval a 5-field cron implies, in hours, or null when this gate cannot
 * read the shape. Null is FATAL at the call site, never a skip — a cadence nobody can
 * read cannot bound a tolerance, and "unparseable" reading as "fine" is fail-open.
 *
 * Handles the shapes this registry actually uses and refuses the rest by design:
 *   `*\/30 * * * *` -> 0.5   `24 * * * *` -> 1   `0 13 * * *` -> 24   `0 9 * * 1` -> 168
 */
export function cronIntervalHours(cron) {
  if (typeof cron !== "string") return null;
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  const step = (field) => (/^\*\/(\d+)$/.test(field) ? Number(/^\*\/(\d+)$/.exec(field)[1]) : null);
  const fixed = (field) => /^\d+$/.test(field);
  const minStep = step(min);
  const hourStep = step(hour);
  if (min === "*" && hour === "*") return 1 / 60;
  if (minStep !== null && hour === "*") return minStep > 0 ? minStep / 60 : null;
  if (fixed(min) && hour === "*") return 1;
  if (fixed(min) && hourStep !== null) return hourStep > 0 ? hourStep : null;
  if (fixed(min) && fixed(hour)) {
    if (dom === "*" && mon === "*" && dow === "*") return 24;
    if (dom === "*" && mon === "*" && /^[0-7](-[0-7])?$/.test(dow)) return 168;
    return null;
  }
  return null;
}

/** Pure: the widest tolerance a cadence of `intervalHours` may declare. */
export function toleranceCeilingHours(intervalHours) {
  return Math.max(TOLERANCE_MULTIPLE * intervalHours, TOLERANCE_FLOOR_HOURS);
}

/** Pure: the launchd label and the installer path a `launchd:` trigger names. */
export function parseLaunchdTrigger(trigger) {
  const label = /^launchd:([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trigger ?? "")?.[1];
  const installer = /installed by ([A-Za-z0-9._/-]+\.sh)/.exec(trigger ?? "")?.[1];
  return { label, installer };
}

/** Pure: `LABEL=` and `INTERVAL_SECONDS=` as the installer shell script declares them. */
export function parseInstaller(text) {
  const l = /^LABEL=(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/m.exec(text ?? "");
  const i = /^INTERVAL_SECONDS=(\d+)\s*$/m.exec(text ?? "");
  return {
    label: l ? (l[1] ?? l[2] ?? l[3]) : undefined,
    intervalSeconds: i ? Number(i[1]) : undefined,
  };
}

export function auditScheduledRoutines(registry, heartbeats, rosterText, listHeads = defaultListHeads, readInstaller = defaultReadInstaller) {
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
    if (r.status !== undefined && !KNOWN_STATUSES.includes(r.status)) {
      fatal.push(`${name}: status "${r.status}" is not a shape this registry knows (${KNOWN_STATUSES.join(" | ")})`);
    }
    const retired = r.status === "retired";
    const awaiting = r.status === "awaiting-activation";
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
    // `awaiting-activation` is the honest escape from rule 1, and it earns that by
    // saying WHY and SINCE WHEN. A day-precision awaitingSince is enough (unlike
    // retiredAt, which must be an instant because a later fire is compared against
    // it); this one is only ever read as an age against a 30-day bound.
    let awaitingDays = NaN;
    if (awaiting) {
      if (!r.awaitingReason || r.awaitingReason.length < 40) {
        fatal.push(`${name}: awaiting-activation with no awaitingReason a reviewer can weigh (40+ characters) — "waiting" with no stated blocker is indistinguishable from a routine nobody looked at`);
      }
      const since = Date.parse(r.awaitingSince ?? "");
      if (!Number.isFinite(since)) {
        fatal.push(`${name}: awaiting-activation with no parseable awaitingSince — an undated wait can never age out, which is the whole point of the bound`);
      } else if (since > Date.now() + FUTURE_SKEW_MS) {
        fatal.push(`${name}: awaitingSince ${r.awaitingSince} is in the FUTURE — a wait that has not started yet is not a wait`);
      } else {
        awaitingDays = (Date.now() - since) / 86_400_000;
        if (awaitingDays > AWAITING_FATAL_DAYS) {
          fatal.push(`${name}: awaiting-activation since ${r.awaitingSince} — ${awaitingDays.toFixed(1)} days, past the ${AWAITING_FATAL_DAYS}-day bound. A wait this long is an undeclared retirement wearing a label: install it, or retire the row with evidence.`);
        } else {
          reported.push(`${name}: awaiting-activation since ${r.awaitingSince} (${awaitingDays.toFixed(1)}d of ${AWAITING_FATAL_DAYS}) — ${r.awaitingReason}`);
        }
      }
    }

    // ── Rule 3: the tolerance must be bounded by the cadence it claims to watch ──
    // Skipped only where there is nothing to compare: a retired row (silent by
    // design, and nightly-build-agent declares `cadenceToleranceHours: null`).
    if (!retired && Number.isFinite(r.cadenceToleranceHours) && r.cadenceToleranceHours > 0) {
      const interval = cronIntervalHours(r.cron);
      if (interval === null) {
        fatal.push(`${name}: cron "${r.cron}" is a shape this gate cannot parse, so its ${r.cadenceToleranceHours}h tolerance is bounded by nothing — an unreadable cadence reading as acceptable is the fail-open direction. Teach cronIntervalHours the shape, or state a cadence it knows.`);
      } else {
        const ceiling = toleranceCeilingHours(interval);
        if (r.cadenceToleranceHours > ceiling) {
          fatal.push(`${name}: cron "${r.cron}" fires every ${interval < 1 ? `${Math.round(interval * 60)}min` : `${interval}h`}, but cadenceToleranceHours is ${r.cadenceToleranceHours} — above the ${ceiling}h ceiling (max(${TOLERANCE_MULTIPLE}x interval, ${TOLERANCE_FLOOR_HOURS}h)). ${Math.floor(r.cadenceToleranceHours / interval)} consecutive missed fires would be silent. Move the tolerance with the cadence.`);
        }
      }
    }

    // ── Rule 2: a launchd trigger names two things this tree can read ────────────
    if (typeof r.trigger === "string" && r.trigger.startsWith("launchd:")) {
      const { label, installer } = parseLaunchdTrigger(r.trigger);
      if (!label) {
        fatal.push(`${name}: trigger begins "launchd:" but names no label — nothing to hold the installer against`);
      } else if (!installer) {
        fatal.push(`${name}: launchd trigger ${label} names no installer script ("installed by scripts/<path>.sh") — the label is then a claim about a machine this tree cannot check`);
      } else {
        let text;
        try {
          text = readInstaller(installer);
        } catch (e) {
          fatal.push(`${name}: launchd trigger names ${installer}, which this gate could not read (${e.message}) — could not look is not agrees`);
        }
        if (typeof text === "string") {
          const got = parseInstaller(text);
          if (got.label === undefined) {
            fatal.push(`${name}: ${installer} declares no LABEL= this gate can parse — the field was renamed and the parity check is guarding nothing`);
          } else if (got.label !== label) {
            fatal.push(`${name}: trigger declares launchd label "${label}" but ${installer} installs "${got.label}" — the registry names a job that is not the one being installed`);
          }
          if (got.intervalSeconds === undefined) {
            fatal.push(`${name}: ${installer} declares no INTERVAL_SECONDS= this gate can parse — the cadence half of the parity check is guarding nothing`);
          } else {
            const interval = cronIntervalHours(r.cron);
            if (interval === null) {
              fatal.push(`${name}: cron "${r.cron}" cannot be read, so it cannot be compared against ${installer}'s INTERVAL_SECONDS=${got.intervalSeconds}`);
            } else if (Math.round(interval * 3600) !== got.intervalSeconds) {
              fatal.push(`${name}: cron "${r.cron}" implies ${Math.round(interval * 3600)}s but ${installer} installs INTERVAL_SECONDS=${got.intervalSeconds} — the registry's cadence and the machine's cadence disagree`);
            }
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
        // A routine that has NEVER fired was permanently exempt from the only
        // clock in this gate: cadenceToleranceHours was consulted only in the
        // else branch, and the absent case was described as young ("the next
        // fire writes the first") rather than measured. The Mac tick (tolerance
        // 3h) sat absent for a day with a human carrying the escalation the gate
        // could not raise (artifacts/lane-messages read, 2026-09-06). The clock
        // for a routine with no heartbeat is its authorization instant — the
        // same skip-on-absent shape the sibling at the tolerance check already
        // names. Staleness stays REPORTED; an unreadable baseline is FATAL.
        if (retired) {
          reported.push(`${name}: retired, no heartbeat at ${r.heartbeatPath} — consistent with never having fired`);
        } else if (awaiting) {
          reported.push(`${name}: awaiting activation, no heartbeat at ${r.heartbeatPath} — consistent with a trigger that is not installed yet`);
        } else if (!(Number.isFinite(r.cadenceToleranceHours) && r.cadenceToleranceHours > 0)) {
          fatal.push(`${name}: active routine with no heartbeat and no positive cadenceToleranceHours — without a bound, "never fired" can never become "overdue"`);
        } else {
          const since = Date.parse(r.authorizedOn ?? "");
          if (!Number.isFinite(since)) {
            fatal.push(`${name}: no heartbeat at ${r.heartbeatPath} and no parseable authorizedOn — with neither instant, "not yet" is unmeasurable and would read as fresh forever`);
          } else {
            const ageH = (Date.now() - since) / 3_600_000;
            if (ageH > NEVER_FIRED_FATAL_HOURS && ageH > r.cadenceToleranceHours) {
              // Rule 1. Both bounds must be passed: the 168h absolute floor AND the
              // routine's own tolerance, so a first fire still inside its declared
              // window is never called an undeclared retirement.
              fatal.push(
                `${name}: UNDECLARED RETIREMENT — authorized ${(ageH / 24).toFixed(1)} days ago (${r.authorizedOn}) and has NEVER fired: ` +
                  `no heartbeat has ever existed at ${r.heartbeatPath}. Past ${NEVER_FIRED_FATAL_HOURS}h this is not an asleep lane, it is a ` +
                  `retirement nobody declared, and the registry calls it ALWAYS-ON. Declare the truth: "status": "retired" with ` +
                  `retiredAt/retiredBy/retiredReason, or "status": "awaiting-activation" with awaitingReason and awaitingSince — ` +
                  `or make the trigger fire and let it write its first heartbeat.`,
              );
            } else if (ageH > r.cadenceToleranceHours) {
              reported.push(`${name}: NEVER fired — authorized ${ageH.toFixed(1)}h ago, tolerance ${r.cadenceToleranceHours}h, no heartbeat at ${r.heartbeatPath} (REPORTED, never silent: the lane is not running)`);
            } else {
              reported.push(`${name}: no heartbeat written yet at ${r.heartbeatPath} — authorized ${ageH.toFixed(1)}h ago, inside its ${r.cadenceToleranceHours}h tolerance (the next fire writes the first)`);
            }
          }
        }
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
          } else if (at > Date.now() + FUTURE_SKEW_MS) {
            // A future firedAt yielded a NEGATIVE age below, which is never
            // "beyond tolerance" — a clock-skewed or hand-edited heartbeat read as
            // fresh forever (ninth audit round, 2026-09-06). The file already refused a
            // future retiredAt; the same rule now holds the instant that matters.
            fatal.push(`${name}: heartbeat firedAt ${parsed.firedAt} is in the FUTURE — a clock that cannot be trusted cannot prove freshness`);
          } else if (awaiting) {
            // Symmetric with the retired rule: the declaration says this lane has
            // never started, and a heartbeat is evidence that it has. The good news
            // still has to be recorded — drop the status rather than leave the row
            // asserting a wait that ended.
            fatal.push(`${name}: declared awaiting-activation but its heartbeat fired at ${parsed.firedAt} — the lane IS running; remove the awaiting-activation status (a stale "not yet" is a false statement about a live lane)`);
          } else if (retired) {
            // Fail-closed spelling: an unparseable retirement instant does not
            // skip the comparison (that would be the skip-on-unknown shape), it
            // fails it — on top of the "no ISO retiredAt" fatal already raised.
            if (!Number.isFinite(retiredAt) || at > retiredAt) {
              fatal.push(`${name}: declared retired at ${r.retiredAt} but its heartbeat fired at ${parsed.firedAt} — the trigger is still running, or the retirement instant is unreadable; disable it on the account or un-retire the row`);
            }
          } else if (!(Number.isFinite(r.cadenceToleranceHours) && r.cadenceToleranceHours > 0)) {
            // Skipping the staleness check when the tolerance is absent made a new
            // active routine permanently exempt from the only clock in this gate.
            // Staleness itself stays REPORTED; the missing bound is FATAL.
            fatal.push(`${name}: active routine with a heartbeat but no positive cadenceToleranceHours — without a bound its staleness can never be measured`);
          } else {
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

/** Installer text from the repo tree; throws when the named script is not there to read. */
function defaultReadInstaller(rel) {
  return readFileSync(rel, "utf8");
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
  const futureHb = { "artifacts/agent-heartbeats/a.json": JSON.stringify({ firedAt: new Date(Date.now() + 3_600_000).toISOString(), result: "quiet" }) };
  r = auditScheduledRoutines(good, futureHb, "");
  checks.push(["a heartbeat fired in the FUTURE is FATAL — a negative age must not read as fresh", r.fatal.some((x) => x.includes("in the FUTURE"))]);
  const staleHb400 = { "artifacts/agent-heartbeats/a.json": JSON.stringify({ firedAt: new Date(Date.now() - 400 * 3_600_000).toISOString(), result: "quiet" }) };
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cadenceToleranceHours: undefined }, good.routines[1]] }, staleHb400, "");
  checks.push(["an active routine with NO cadence tolerance is FATAL — it was silently exempt from the staleness clock", r.fatal.some((x) => x.includes("no positive cadenceToleranceHours"))]);
  r = auditScheduledRoutines(good, staleHb400, "");
  checks.push(["with a tolerance, staleness is REPORTED, not fatal (the control that keeps the gate honest)", r.fatal.length === 0 && r.reported.some((x) => x.includes("beyond its"))]);
  r = auditScheduledRoutines(good, { ...freshHb, "artifacts/agent-heartbeats/ghost.json": JSON.stringify({ firedAt: new Date().toISOString() }) }, "");
  checks.push(["a heartbeat with no registry entry is FATAL — an undeclared lane is running", r.fatal.some((x) => x.includes("ghost"))]);
  r = auditScheduledRoutines(good, freshHb, '{"producedByRoutine": "unknown-routine"}');
  checks.push(["a roster attribution to an unknown routine id is FATAL", r.fatal.some((x) => x.includes("unknown-routine"))]);
  const staleHb = { "artifacts/agent-heartbeats/a.json": JSON.stringify({ firedAt: "2026-08-01T00:00:00Z" }) };
  r = auditScheduledRoutines(good, staleHb, "");
  checks.push(["a stale heartbeat is REPORTED and exits 0", r.fatal.length === 0 && r.reported.some((x) => x.includes("beyond its"))]);
  r = auditScheduledRoutines({ transcribedFrom: "x", routines: [] }, {}, "");
  checks.push(["an empty registry with no heartbeats is clean", r.fatal.length === 0 && r.reported.length === 0]);
  // Never fired: the routine's authorization instant is its clock.
  const dayAgo = new Date(Date.now() - 26 * 3_600_000).toISOString().slice(0, 10);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cadenceToleranceHours: 3, authorizedOn: dayAgo }, good.routines[1]] }, {}, "");
  checks.push(["a routine authorized 26h ago with a 3h tolerance and NO heartbeat is REPORTED as never fired — not 'not yet'", r.fatal.length === 0 && r.reported.some((x) => x.includes("NEVER fired"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cadenceToleranceHours: 50, authorizedOn: new Date().toISOString().slice(0, 10) }, good.routines[1]] }, {}, "");
  checks.push(["…one authorized today inside a 50h tolerance is still 'the next fire writes the first' (the honest young case)", r.fatal.length === 0 && r.reported.some((x) => x.includes("inside its 50h tolerance")) && !r.reported.some((x) => x.includes("NEVER fired"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cadenceToleranceHours: 3, authorizedOn: undefined }, good.routines[1]] }, {}, "");
  checks.push(["…and one with no heartbeat AND no authorizedOn is FATAL — with neither instant it would read as fresh forever", r.fatal.some((x) => x.includes("no parseable authorizedOn"))]);
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

  // ── Rule 1: undeclared retirement, and the two honest escapes ─────────────────
  const noStatusNeverFired = (days, tol = 3) => ({
    ...good,
    routines: [{ ...good.routines[0], cadenceToleranceHours: tol, authorizedOn: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) }, good.routines[1]],
  });
  r = auditScheduledRoutines(noStatusNeverFired(41), {}, "");
  checks.push(["A ROUTINE THAT HAS NEVER FIRED IN 41 DAYS, WITH NO STATUS, IS FATAL — the live-sync-loop-keeper shape", r.fatal.some((x) => x.includes("UNDECLARED RETIREMENT"))]);
  r = auditScheduledRoutines(noStatusNeverFired(6), {}, "");
  checks.push(["…but at 6 days it is still only REPORTED — the 168h bound is a bound, not a mood", r.fatal.length === 0 && r.reported.some((x) => x.includes("NEVER fired"))]);
  // A WEEKLY cron is the only cadence whose tolerance may legitimately exceed the
  // 168h floor (ceiling 504h under rule 3), so it is the honest way to test that
  // rule 1 defers to a first fire still inside its own window.
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cron: "0 9 * * 1", cadenceToleranceHours: 400, authorizedOn: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) }, good.routines[1]] }, {}, "");
  checks.push(["…and one whose FIRST FIRE IS STILL INSIDE ITS TOLERANCE is untouched past 168h — young is not absent", r.fatal.length === 0 && !r.reported.some((x) => x.includes("NEVER fired"))]);
  r = auditScheduledRoutines({ ...noStatusNeverFired(41), routines: [{ ...noStatusNeverFired(41).routines[0], status: "active" }, good.routines[1]] }, {}, "");
  checks.push(['…and `status: "active"` is NOT an escape — a declaration is not evidence', r.fatal.some((x) => x.includes("UNDECLARED RETIREMENT"))]);
  const retiredEscape = { ...noStatusNeverFired(41).routines[0], status: "retired", retiredAt: "2026-09-01T12:00Z", retiredBy: "Owner", retiredReason: "the trigger fired daily for 41 days and never once reached the tree, because a fresh session has no push path" };
  r = auditScheduledRoutines({ ...good, routines: [retiredEscape, good.routines[1]] }, {}, "", noHeads);
  checks.push(["ESCAPE ONE: the same routine marked retired with evidence is clean", r.fatal.length === 0]);
  const awaiting = { ...noStatusNeverFired(41).routines[0], status: "awaiting-activation", awaitingReason: "the launchd agent is not installed on the owner's Mac yet; escalated once, awaiting one command", awaitingSince: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) };
  r = auditScheduledRoutines({ ...good, routines: [awaiting, good.routines[1]] }, {}, "");
  checks.push(["ESCAPE TWO: awaiting-activation with a reason and a date is REPORTED, never fatal", r.fatal.length === 0 && r.reported.some((x) => x.includes("awaiting-activation since"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...awaiting, awaitingSince: new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10) }, good.routines[1]] }, {}, "");
  checks.push([`…and FATAL once awaitingSince is past ${AWAITING_FATAL_DAYS} days — a permanent wait is the same undeclared retirement`, r.fatal.some((x) => x.includes(`past the ${AWAITING_FATAL_DAYS}-day bound`))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...awaiting, awaitingReason: "not installed" }, good.routines[1]] }, {}, "");
  checks.push(["…awaiting-activation with a reason too short to weigh is FATAL", r.fatal.some((x) => x.includes("awaitingReason a reviewer can weigh"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...awaiting, awaitingSince: undefined }, good.routines[1]] }, {}, "");
  checks.push(["…and with no awaitingSince it is FATAL — an undated wait can never age out", r.fatal.some((x) => x.includes("no parseable awaitingSince"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...awaiting, awaitingSince: "2999-01-01" }, good.routines[1]] }, {}, "");
  checks.push(["…and an awaitingSince in the FUTURE is FATAL", r.fatal.some((x) => x.includes("in the FUTURE"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...awaiting, heartbeatPath: "artifacts/agent-heartbeats/a.json" }, good.routines[1]] }, freshHb, "");
  checks.push(["…and one declared awaiting-activation whose heartbeat HAS fired is FATAL — the wait ended and the row still claims it", r.fatal.some((x) => x.includes("the lane IS running"))]);

  // ── Rule 3: tolerance bounded by the cadence ──────────────────────────────────
  checks.push([
    "cron intervals parse: */30 -> 0.5h, hourly -> 1h, daily -> 24h, weekly -> 168h, every-minute -> 1min",
    cronIntervalHours("*/30 * * * *") === 0.5 && cronIntervalHours("24 * * * *") === 1 &&
      cronIntervalHours("0 13 * * *") === 24 && cronIntervalHours("0 9 * * 1") === 168 &&
      cronIntervalHours("*/6 * * *") === null && cronIntervalHours("* * * * *") === 1 / 60 &&
      cronIntervalHours("0 */4 * * *") === 4,
  ]);
  checks.push([
    "…and a shape this gate cannot read returns null, never a guess",
    cronIntervalHours("@daily") === null && cronIntervalHours("H/5 * * * *") === null && cronIntervalHours(undefined) === null,
  ]);
  checks.push([
    `the ceiling is max(${TOLERANCE_MULTIPLE}x interval, ${TOLERANCE_FLOOR_HOURS}h): hourly -> 3h, 30-min -> 3h (the floor), daily -> 72h`,
    toleranceCeilingHours(1) === 3 && toleranceCeilingHours(0.5) === 3 && toleranceCeilingHours(24) === 72,
  ]);
  const hourly = (tol) => ({ ...good, routines: [{ ...good.routines[0], cron: "24 * * * *", cadenceToleranceHours: tol }, good.routines[1]] });
  r = auditScheduledRoutines(hourly(4), freshHb, "");
  checks.push(["A 4h TOLERANCE ON AN HOURLY CRON IS FATAL — three missed fires were silent on the steward itself", r.fatal.some((x) => x.includes("above the 3h ceiling"))]);
  r = auditScheduledRoutines(hourly(3), freshHb, "");
  checks.push(["…and 3h on the same hourly cron passes — the bound is the bound, in both directions", r.fatal.length === 0]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cron: "*/30 * * * *", cadenceToleranceHours: 3 }, good.routines[1]] }, freshHb, "");
  checks.push(["…and a 30-minute cadence may declare 3h — the floor exists so a sleeping Mac is not a flaky gate", r.fatal.length === 0]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cron: "@hourly" }, good.routines[1]] }, freshHb, "");
  checks.push(["…and an UNPARSEABLE cron with a tolerance is FATAL, not skipped — unreadable must not read as fine", r.fatal.some((x) => x.includes("cannot parse"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], cron: "0 13 * * *", cadenceToleranceHours: 50 }, good.routines[1]] }, freshHb, "");
  checks.push(["…a daily cron with a 50h tolerance passes (72h ceiling) — the live registry's own shape", r.fatal.length === 0]);

  // ── Rule 2: launchd trigger parity ────────────────────────────────────────────
  const INSTALLER = 'LABEL="com.signalgrid.lane-tick"\nINTERVAL_SECONDS=1800\n';
  const tick = { ...good.routines[0], id: "t", cron: "*/30 * * * *", cadenceToleranceHours: 3, trigger: "launchd:com.signalgrid.lane-tick (installed by scripts/mac/install-launchd.sh on the owner's Mac)", heartbeatPath: "artifacts/agent-heartbeats/a.json" };
  const readOK = () => INSTALLER;
  checks.push([
    "the trigger parser reads the label and the installer it names",
    parseLaunchdTrigger(tick.trigger).label === "com.signalgrid.lane-tick" && parseLaunchdTrigger(tick.trigger).installer === "scripts/mac/install-launchd.sh",
  ]);
  checks.push([
    "the installer parser reads LABEL= and INTERVAL_SECONDS=",
    parseInstaller(INSTALLER).label === "com.signalgrid.lane-tick" && parseInstaller(INSTALLER).intervalSeconds === 1800,
  ]);
  checks.push(["…and finds neither in a script that declares neither — undefined, never a default", parseInstaller("set -u\n").label === undefined && parseInstaller("set -u\n").intervalSeconds === undefined]);
  r = auditScheduledRoutines({ ...good, routines: [tick, good.routines[1]] }, freshHb, "", noHeads, readOK);
  checks.push(["a launchd trigger whose label and interval both match its installer is clean", r.fatal.length === 0]);
  r = auditScheduledRoutines({ ...good, routines: [tick, good.routines[1]] }, freshHb, "", noHeads, () => 'LABEL="com.signalgrid.lane-tock"\nINTERVAL_SECONDS=1800\n');
  checks.push(["A RELABELLED INSTALLER IS FATAL — the registry would name a job nobody installs", r.fatal.some((x) => x.includes("installs \"com.signalgrid.lane-tock\""))]);
  r = auditScheduledRoutines({ ...good, routines: [tick, good.routines[1]] }, freshHb, "", noHeads, () => 'LABEL="com.signalgrid.lane-tick"\nINTERVAL_SECONDS=3600\n');
  checks.push(["A CHANGED INTERVAL_SECONDS IS FATAL — */30 does not mean 3600s", r.fatal.some((x) => x.includes("implies 1800s but"))]);
  r = auditScheduledRoutines({ ...good, routines: [tick, good.routines[1]] }, freshHb, "", noHeads, () => "set -u\n");
  checks.push(["…an installer declaring neither field is FATAL twice — a parity check that parsed nothing is guarding nothing", r.fatal.filter((x) => x.includes("guarding nothing")).length === 2]);
  r = auditScheduledRoutines({ ...good, routines: [tick, good.routines[1]] }, freshHb, "", noHeads, () => { throw new Error("ENOENT"); });
  checks.push(["…and an installer this gate cannot read is FATAL — could not look is not agrees", r.fatal.some((x) => x.includes("could not read"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...tick, trigger: "launchd:com.signalgrid.lane-tick" }, good.routines[1]] }, freshHb, "", noHeads, readOK);
  checks.push(["…a launchd trigger naming no installer is FATAL — an unverifiable label", r.fatal.some((x) => x.includes("names no installer"))]);
  r = auditScheduledRoutines({ ...good, routines: [{ ...good.routines[0], trigger: "trig_01XqdtQrmMEtUXTS7pCDr8GS" }, good.routines[1]] }, freshHb, "", noHeads, () => { throw new Error("must not be called"); });
  checks.push(["…and a trig_* account trigger is deliberately NOT checked — this tree cannot read the account scheduler", r.fatal.length === 0]);

  // ── The live registry, read as the gate reads it ──────────────────────────────
  checks.push([
    "the live registry parses and declares at least three routines — a self-test over an empty registry proves nothing",
    (() => {
      try {
        const live = JSON.parse(readFileSync(REGISTRY, "utf8"));
        return Array.isArray(live.routines) && live.routines.length >= 3 &&
          live.routines.every((x) => typeof x.cron === "string") &&
          live.routines.filter((x) => x.status !== "retired").every((x) => cronIntervalHours(x.cron) !== null);
      } catch { return false; }
    })(),
  ]);
  checks.push([
    "…and the launchd trigger it declares resolves to an installer this gate can actually parse (the live floor for rule 2)",
    (() => {
      try {
        const live = JSON.parse(readFileSync(REGISTRY, "utf8"));
        const rows = live.routines.filter((x) => typeof x.trigger === "string" && x.trigger.startsWith("launchd:"));
        if (rows.length === 0) return false;
        return rows.every((x) => {
          const { installer } = parseLaunchdTrigger(x.trigger);
          const got = parseInstaller(readFileSync(installer, "utf8"));
          return got.label !== undefined && got.intervalSeconds !== undefined;
        });
      } catch { return false; }
    })(),
  ]);

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
