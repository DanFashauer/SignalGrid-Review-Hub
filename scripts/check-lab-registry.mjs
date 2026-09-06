#!/usr/bin/env node
// Open-source lab registry gate. The owner's 30-repo research index lives in
// two halves — docs/agent/open-source-lab-registry.json (machine) and
// docs/OPEN_SOURCE_LAB_REGISTRY.md (human) — and two halves of anything drift
// unless a gate reads both. This one does, plus the disk, because the registry
// makes exactly the kind of claim this repo's doctrine polices: "deployedInLab"
// is a present-tense statement that scripts/run-live-lanes.sh starts the
// service TODAY, and a deployment claim whose evidence path is not on disk is
// a false claim with a citation.
//
// Everything here is FATAL — unlike check-lane-messages, there is no "other
// machine may be asleep" excuse for a registry: it is a committed document,
// and an incoherent committed document is wrong right now, not eventually.
//   ✗ an entry missing classification, licence, or role
//   ✗ a classification outside the declared enum
//   ✗ deployedInLab true with no deployedEvidence
//   ✗ a caution-family licence (GPL/AGPL/SSPL/Sustainable Use/custom) whose
//     entry does not carry licenceCaution: true — the never-rule ("no code
//     reuse before licence review") is only findable if the flag is on the row
//   ✗ the md table naming a repo the json lacks, or vice versa
//   ✗ deployedInLab true but the evidence path does not exist on disk
// v2 (second owner research report, 2026-08-21) — the org match:
//   ✗ ownerRole missing, or naming a role docs/agent/org-roster.json does not
//     carry — an owner the org chart cannot produce is no owner at all
//   ✗ priorityTier outside P0/P1/P2
//   ✗ credentialClass or lastReviewed missing
//   ✗ mutationsAllowed anything but false without a decisionRecord naming the
//     approval-gate ratification (DR-008: no mutation without a gated record)
//   ✗ ownerRanked neither a number nor null-with-a-report-basis (unranked
//     rows arrived with the report; silence about rank is still forbidden)
// v3 (2026-09-06) — the record's OWN instant:
//   · REPORTED for every cited execution record: how old it is. A capture minted
//     once and never re-run reads identically to one minted this morning; nothing
//     anywhere read `capturedAt` until this.
//   ✗ an evidence file dated in the FUTURE (a clock contradiction)
//   ✗ an evidence file older than the bound THE ENTRY ITSELF DECLARES
//     (`evidenceMaxAgeDays`) — declared per entry so a lane that legitimately runs
//     monthly declares a month, and an entry that declares nothing is REPORTED and
//     never gated. An entry may name a non-standard instant field with
//     `evidenceInstantField` (glpi.json records provenance.fixtureTimestamp — a
//     shape-discovery capture, not a wall-clock run).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {fileURLToPath, pathToFileURL } from "node:url";
import { GREEN_STATUSES } from "./lib/sim-operations.mjs";

const REGISTRY = "docs/agent/open-source-lab-registry.json";
const HUMAN_HALF = "docs/OPEN_SOURCE_LAB_REGISTRY.md";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CLASSIFICATIONS = new Set([
  "LAB_SOURCE",
  "PRODUCTION_CONNECTOR_TARGET",
  "OPEN_STANDARD",
  "REFERENCE_ARCHITECTURE",
  "INTERNAL_COMPANY_TOOL",
  "DEFERRED_RESEARCH",
]);

// The caution families. "GPL" deliberately also catches AGPL/LGPL; the last
// two alternatives catch the non-SPDX shapes this registry actually holds
// (SigmaHQ's Detection Rule License, n8n's Sustainable Use License) plus any
// future entry honest enough to label itself custom or LicenseRef-.
/** The two artifact families that exist ONLY as the residue of something running. */
const EXECUTION_RECORD = /^artifacts\/(sim-results|live-captures)\//;

const CAUTION_FAMILY = /GPL|SSPL|sustainable use|detection rule|custom|LicenseRef-/i;

/**
 * Repo names out of the md's table rows: backticked owner/name tokens on lines
 * that start with "|". Restricted to table lines so a prose mention of a repo
 * (or a backticked file path — those carry an extension) cannot desynchronize
 * the cross-check.
 */
export function reposInMarkdown(mdText) {
  const repos = new Set();
  for (const line of mdText.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const m of line.matchAll(/`([A-Za-z0-9][\w.-]*\/[\w.-]+)`/g)) {
      if (!/\.(json|md|mjs|js|ts|sh|ya?ml)$/i.test(m[1])) repos.add(m[1]);
    }
  }
  return repos;
}

/**
 * Pure audit. `pathExists` is injected so the self-test can prove the
 * evidence-on-disk check fires without needing a missing file to exist.
 */
const PRIORITY_TIERS = new Set(["P0", "P1", "P2"]);

/** Fields an execution record may use to record its own instant. An entry may name a
 *  different one with `evidenceInstantField` (dotted paths supported). */
const INSTANT_FIELDS = ["capturedAt", "completedAt", "recordedAt", "ranAt", "startedAt", "generatedAt", "provenance.capturedAt", "provenance.completedAt", "provenance.sampledAt", "provenance.recordedAt", "provenance.ranAt"];

const readPath = (doc, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), doc);

/** Milliseconds since epoch of the record's own instant, or null when it records none. */
export function evidenceInstantMs(doc, declaredField) {
  const fields = declaredField ? [declaredField] : INSTANT_FIELDS;
  for (const f of fields) {
    const v = readPath(doc, f);
    if (typeof v === "string") {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Age in days of the cited record against `nowMs`, or null when it records no instant. */
export function evidenceAgeDays(doc, declaredField, nowMs) {
  const ms = evidenceInstantMs(doc, declaredField);
  return ms === null ? null : (nowMs - ms) / 86400000;
}

/**
 * Does the cited execution record actually record an execution? `readJson` is
 * injected (null when unreadable) so the self-test can drive every shape.
 * A sim-result must carry at least one run row with a GREEN status; a
 * live-capture must carry a non-empty `probes` or `devices` array. An optional
 * per-entry `evidenceMarker` must appear in the file's text — a fleet claim
 * cannot be closed by a result that never mentions fleet.
 */
export function evidenceRecordsARun(path, doc, marker) {
  if (!doc || typeof doc !== "object") return "does not parse as a JSON object";
  if (/^artifacts\/sim-results\//.test(path)) {
    const runs = Array.isArray(doc.runs) ? doc.runs : [];
    if (!runs.some((r) => GREEN_STATUSES.includes(r?.status))) return "has no run row with a green status — a refusal or a skip is an attempt, not a deployment";
  } else if (/^artifacts\/live-captures\//.test(path)) {
    const probes = Array.isArray(doc.probes) ? doc.probes : Array.isArray(doc.devices) ? doc.devices : [];
    if (probes.length === 0) return "has no probes/devices — a capture of nothing is not a deployment";
  }
  if (marker) {
    const text = JSON.stringify(doc);
    if (!text.includes(marker)) return `never mentions evidenceMarker "${marker}"`;
  }
  return null;
}

export function auditLabRegistry(registry, mdText, pathExists, rosterRoles, readJson = () => null, nowMs = Date.now()) {
  const fatal = [];
  const reports = [];
  const entries = registry?.entries;
  if (!Array.isArray(entries)) return { fatal: [`${REGISTRY} carries no entries array`], reports: [] };
  if (!registry.transcribedFrom) {
    fatal.push("the registry does not record when it was transcribed from the owner's research — an undated transcription is a guess");
  }
  if (!registry.rule?.boundary || !registry.rule?.neverRule) {
    fatal.push("the registry does not state the boundary rule and the never-rule — the index without its rule is just a list of links");
  }
  const jsonRepos = new Set();
  for (const e of entries) {
    const name = e.repo ?? "<no repo>";
    if (!e.repo) fatal.push("an entry has no repo");
    else if (jsonRepos.has(e.repo)) fatal.push(`duplicate entry for ${e.repo}`);
    else jsonRepos.add(e.repo);
    if (!e.classification) fatal.push(`${name}: no classification`);
    else if (!CLASSIFICATIONS.has(e.classification)) {
      fatal.push(`${name}: classification "${e.classification}" is outside the declared enum`);
    }
    if (!e.licence) fatal.push(`${name}: no licence — an unlicensed dependency is an unreviewable one`);
    if (!e.role) fatal.push(`${name}: no role — a repo nobody can say the purpose of does not belong in the index`);
    if (typeof e.ownerRanked !== "number" && !(e.ownerRanked === null && /research report/i.test(e.basis ?? ""))) {
      fatal.push(`${name}: ownerRanked must be a number, or null with a basis naming the research report that brought the row in unranked`);
    }
    if (!e.ownerRole) {
      fatal.push(`${name}: no ownerRole — a repo the org chart cannot produce an owner for is unowned`);
    } else if (rosterRoles && !rosterRoles.has(e.ownerRole)) {
      fatal.push(`${name}: ownerRole "${e.ownerRole}" does not exist in docs/agent/org-roster.json — phantom ownership`);
    }
    if (!PRIORITY_TIERS.has(e.priorityTier)) fatal.push(`${name}: priorityTier must be P0, P1 or P2`);
    if (!e.credentialClass) fatal.push(`${name}: no credentialClass — the least-privilege posture must be stated per relationship`);
    if (!e.lastReviewed || Number.isNaN(Date.parse(e.lastReviewed))) fatal.push(`${name}: lastReviewed missing or unparseable`);
    if (e.mutationsAllowed !== false && !e.decisionRecord) {
      fatal.push(`${name}: mutationsAllowed is not false and no decisionRecord names the approval-gate ratification — DR-008 forbids mutation without one`);
    }
    if (e.deployedInLab === true) {
      if (!e.deployedEvidence) {
        fatal.push(`${name}: deployedInLab with no deployedEvidence — "it runs" without a citation is exactly the claim this repo forbids`);
      } else if (!pathExists(e.deployedEvidence)) {
        fatal.push(`${name}: deployedEvidence ${e.deployedEvidence} does not exist on disk — the deployment claim cites nothing`);
      } else if (!EXECUTION_RECORD.test(e.deployedEvidence)) {
        // A LAUNCHER IS NOT A RUN, and existing-on-disk could never tell them apart.
        //
        // Four of the six deployedInLab entries cited `scripts/run-live-lanes.sh`:
        // the script that CAN stand these services up. It exists, so the check above
        // passed, and would pass forever for every entry whether or not anything ever
        // ran — the deployment claim was resting on the deployability of the tooling.
        // All four claims happened to be true (each traced to a recorded PASS), which
        // is exactly why nobody noticed: the citation was wrong while the fact was
        // right, and only the fact was ever checked.
        //
        // `configured != emitted` is this repo's own first evidence distinction. An
        // execution record — a committed sim-result or live-capture — is the artifact
        // that can carry it, because it exists only if something ran.
        fatal.push(
          `${name}: deployedEvidence ${e.deployedEvidence} is not an execution record — ` +
            "a launcher proves the service is DEPLOYABLE, never that it was deployed. " +
            "Cite artifacts/sim-results/… or artifacts/live-captures/… instead.",
        );
      } else {
        // Existing on disk with the right prefix says the RIGHT KIND of file exists;
        // it says nothing about what is in it. A result whose every row is
        // refused_platform, or a capture with `probes: []`, closed a deployedInLab
        // claim — the hole check-sim-requests.mjs documents fixing in ITS domain, and
        // its fix stopped at that gate's edge (ninth audit round, 2026-09-06).
        const doc = readJson(e.deployedEvidence);
        const why = evidenceRecordsARun(e.deployedEvidence, doc, e.evidenceMarker);
        if (why) fatal.push(`${name}: deployedEvidence ${e.deployedEvidence} ${why}`);
        // THE RECORD'S OWN INSTANT, read at last. `capturedAt` was minted by the live
        // lanes and consulted by nothing, so a capture from two months ago vouched for a
        // deployment claim exactly as loudly as one minted this morning. REPORTED always;
        // FATAL only past the bound the entry itself declares, and on a future instant.
        const ageDays = evidenceAgeDays(doc, e.evidenceInstantField, nowMs);
        const bound = typeof e.evidenceMaxAgeDays === "number" ? e.evidenceMaxAgeDays : null;
        if (ageDays === null) {
          reports.push(`${name}: ${e.deployedEvidence} records no instant of its own (looked for ${e.evidenceInstantField ?? INSTANT_FIELDS.join("/")}) — age UNKNOWN`);
        } else {
          reports.push(`${name}: ${e.deployedEvidence} is ${ageDays.toFixed(1)}d old${bound === null ? " (no evidenceMaxAgeDays declared — REPORTED, not gated)" : ` (bound ${bound}d)`}`);
          if (ageDays < 0) {
            fatal.push(`${name}: deployedEvidence ${e.deployedEvidence} is dated in the FUTURE (${(-ageDays).toFixed(1)}d ahead) — a clock contradiction, not evidence`);
          } else if (bound !== null && ageDays > bound) {
            fatal.push(`${name}: deployedEvidence ${e.deployedEvidence} is ${ageDays.toFixed(1)}d old, past the ${bound}d bound this entry declares — re-run the lane or widen evidenceMaxAgeDays deliberately`);
          }
        }
      }
    }
    if (e.licence && CAUTION_FAMILY.test(e.licence) && e.licenceCaution !== true) {
      fatal.push(`${name}: licence "${e.licence}" is a caution family (GPL/AGPL/SSPL/SUL/custom) but licenceCaution is not true`);
    }
  }
  // Both halves, both directions. A repo in one half only is how a registry
  // stops being one — two documents in this repo have already disagreed about
  // what exists (see check:absence's history); this pair never gets to.
  const mdRepos = reposInMarkdown(mdText ?? "");
  for (const r of jsonRepos) {
    if (!mdRepos.has(r)) fatal.push(`${r} is in the json but not in the md table — the human half is missing a row`);
  }
  for (const r of mdRepos) {
    if (!jsonRepos.has(r)) fatal.push(`${r} is in the md table but not in the json — the machine half is missing an entry`);
  }
  return { fatal, reports };
}

function selfTest() {
  const checks = [];
  const mdFor = (repos) =>
    ["| Rank | Repo |", "| ---: | --- |", ...repos.map((r, i) => `| ${i + 1} | \`${r}\` |`)].join("\n");
  const good = {
    transcribedFrom: "owner research directive, 2026-08-21",
    rule: { boundary: "adapter → evidence → policy → verdict", neverRule: "no code reuse before licence review" },
    entries: [
      { repo: "a/one", ownerRanked: 1, classification: "LAB_SOURCE", licence: "Apache-2.0", licenceCaution: false, role: "r", deployedInLab: true, deployedEvidence: "artifacts/sim-results/fixture-run.json", ownerRole: "endpoint-uem-domain", priorityTier: "P0", credentialClass: "read_only", mutationsAllowed: false, lastReviewed: "2026-08-21" },
      { repo: "b/two", ownerRanked: 2, classification: "DEFERRED_RESEARCH", licence: "AGPL-3.0", licenceCaution: true, role: "r", deployedInLab: false, deployedEvidence: null, ownerRole: "secops-domain", priorityTier: "P2", credentialClass: "lab_isolated", mutationsAllowed: false, lastReviewed: "2026-08-21" },
    ],
  };
  const onDisk = () => true;
  const greenDoc = { runs: [{ operation: "live-lanes", status: "passed" }], probes: [{ id: 1 }] };
  const readGreen = () => greenDoc;
  const roster = new Set(["endpoint-uem-domain", "secops-domain"]);
  let r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk, roster, readGreen);
  checks.push(["a coherent registry with a matching md table passes clean", r.fatal.length === 0]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], licence: undefined }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["an entry with no licence is FATAL", r.fatal.some((x) => x.includes("no licence"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], classification: "COOL_REPO" }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["a classification outside the enum is FATAL", r.fatal.some((x) => x.includes("outside the declared enum"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], deployedEvidence: null }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["deployedInLab without evidence is FATAL — 'it runs' needs a citation", r.fatal.some((x) => x.includes("no deployedEvidence"))]);

  // Added 2026-08-25 with its own negative control. Four real entries cited
  // `scripts/run-live-lanes.sh` — a launcher, which exists on disk forever and so
  // satisfied the existence check above for any entry, whether or not anything ever
  // ran. All four claims happened to be TRUE, which is exactly why it went
  // unnoticed: the citation was wrong while the fact was right, and only the fact
  // was ever checked.
  r = auditLabRegistry(
    { ...good, entries: [{ ...good.entries[0], deployedEvidence: "scripts/run-live-lanes.sh" }] },
    mdFor(["a/one"]), onDisk, roster,
  );
  checks.push(["a LAUNCHER as deployedEvidence is FATAL — deployable is not deployed", r.fatal.some((x) => x.includes("not an execution record"))]);

  // The positive control beside it, so the rule cannot pass by rejecting everything:
  // a live-capture is an execution record too, not only a sim-result.
  r = auditLabRegistry(
    { ...good, entries: [{ ...good.entries[0], deployedEvidence: "artifacts/live-captures/glpi.json" }] },
    mdFor(["a/one"]), onDisk, roster, readGreen,
  );
  checks.push(["a live-capture IS an execution record — both families accepted", !r.fatal.some((x) => x.includes("not an execution record"))]);

  // Ninth round: the record has to RECORD something.
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk, roster, () => ({ runs: [{ operation: "everything", status: "refused_platform" }] }));
  checks.push(["a sim-result whose only row is a refusal does NOT close a deployment claim", r.fatal.some((x) => x.includes("no run row with a green status"))]);
  r = auditLabRegistry(
    { ...good, entries: [{ ...good.entries[0], deployedEvidence: "artifacts/live-captures/glpi.json" }] },
    mdFor(["a/one"]), onDisk, roster, () => ({ probes: [] }),
  );
  checks.push(["a live-capture with no probes does NOT close a deployment claim", r.fatal.some((x) => x.includes("no probes/devices"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk, roster, () => null);
  checks.push(["an unreadable evidence file is FATAL, never a skip", r.fatal.some((x) => x.includes("does not parse"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], evidenceMarker: "wazuh" }, good.entries[1]] }, mdFor(["a/one", "b/two"]), onDisk, roster, readGreen);
  checks.push(["an evidenceMarker the file never mentions is FATAL — a fleet result cannot vouch for wazuh", r.fatal.some((x) => x.includes("never mentions evidenceMarker"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], evidenceMarker: "live-lanes" }, good.entries[1]] }, mdFor(["a/one", "b/two"]), onDisk, roster, readGreen);
  checks.push(["an evidenceMarker the file does mention passes (positive control)", !r.fatal.some((x) => x.includes("evidenceMarker"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[1], licenceCaution: false }] }, mdFor(["b/two"]), onDisk, roster);
  checks.push(["an AGPL licence without licenceCaution is FATAL", r.fatal.some((x) => x.includes("caution family"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[1], licence: "Sustainable Use License", licenceCaution: false }] }, mdFor(["b/two"]), onDisk, roster);
  checks.push(["a Sustainable Use licence without caution is FATAL — custom families count", r.fatal.some((x) => x.includes("caution family"))]);
  r = auditLabRegistry(good, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["a json repo missing from the md table is FATAL", r.fatal.some((x) => x.includes("not in the md table"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two", "c/three"]), onDisk, roster);
  checks.push(["an md-table repo missing from the json is FATAL", r.fatal.some((x) => x.includes("not in the json"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), () => false, roster);
  checks.push(["deployedEvidence absent from disk is FATAL — the claim cites nothing", r.fatal.some((x) => x.includes("does not exist on disk"))]);
  // v3: the record's own instant. NOW is fixed so these cannot rot.
  const NOW = Date.parse("2026-09-06T00:00:00.000Z");
  const aged = (days) => () => ({ runs: [{ operation: "everything", status: "passed" }], capturedAt: new Date(NOW - days * 86400000).toISOString() });
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], evidenceMaxAgeDays: 30 }, good.entries[1]] }, mdFor(["a/one", "b/two"]), onDisk, roster, aged(200), NOW);
  checks.push(["evidence older than the bound the ENTRY declares is FATAL", r.fatal.some((x) => x.includes("past the 30d bound"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], evidenceMaxAgeDays: 30 }, good.entries[1]] }, mdFor(["a/one", "b/two"]), onDisk, roster, aged(2), NOW);
  checks.push(["evidence inside the declared bound is not fatal (positive control)", !r.fatal.some((x) => x.includes("bound"))]);
  checks.push(["...and its age is REPORTED either way", r.reports.some((x) => x.includes("2.0d old (bound 30d)"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk, roster, aged(400), NOW);
  checks.push(["an entry declaring NO bound is REPORTED, never gated — a monthly lane is not a defect", !r.fatal.some((x) => x.includes("bound")) && r.reports.some((x) => x.includes("REPORTED, not gated"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk, roster, aged(-5), NOW);
  checks.push(["evidence dated in the FUTURE is FATAL — a clock contradiction is not freshness", r.fatal.some((x) => x.includes("dated in the FUTURE"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk, roster, readGreen, NOW);
  checks.push(["a record with no instant at all is REPORTED as unknown, not silently fresh", r.reports.some((x) => x.includes("age UNKNOWN"))]);
  r = auditLabRegistry(
    { ...good, entries: [{ ...good.entries[0], evidenceInstantField: "provenance.fixtureTimestamp", evidenceMaxAgeDays: 30 }, good.entries[1]] },
    mdFor(["a/one", "b/two"]), onDisk, roster,
    () => ({ runs: [{ operation: "everything", status: "passed" }], provenance: { fixtureTimestamp: new Date(NOW - 400 * 86400000).toISOString() } }), NOW,
  );
  checks.push(["an entry may NAME the field that stands in for a wall-clock instant, and it is then read", r.fatal.some((x) => x.includes("past the 30d bound"))]);
  // Parser controls: a backticked file path in a table row, or a repo named
  // only in prose, must not enter the cross-check.
  const mdWithNoise = `${mdFor(["a/one", "b/two"])}\n| gate | \`scripts/check-lab-registry.mjs\` |\n\nSee also \`c/prose-only\` in passing.`;
  r = auditLabRegistry(good, mdWithNoise, onDisk, roster, readGreen);
  checks.push(["file paths and prose mentions do not desynchronize the halves", r.fatal.length === 0]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], ownerRole: "made-up-role" }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["an ownerRole the org roster does not carry is FATAL — phantom ownership", r.fatal.some((x) => x.includes("does not exist in docs/agent/org-roster.json"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], priorityTier: "P9" }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["a priority tier outside P0/P1/P2 is FATAL", r.fatal.some((x) => x.includes("priorityTier"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], mutationsAllowed: true }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["mutationsAllowed true without a decisionRecord is FATAL — DR-008", r.fatal.some((x) => x.includes("DR-008"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], ownerRanked: null, basis: "recorded from owner research report 2026-08-21" }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["null ownerRanked WITH a report basis is coherent — unranked arrivals are allowed", r.fatal.length === 0]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], ownerRanked: null, basis: "just because" }] }, mdFor(["a/one"]), onDisk, roster, readGreen);
  checks.push(["null ownerRanked WITHOUT a report basis is FATAL", r.fatal.some((x) => x.includes("ownerRanked"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Exact-entry guard, not a basename suffix match: an unrelated entry script
// that merely IMPORTS this module must never trigger the gate (an adversarial
// review proved the suffix form fires for an entry named like this file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const registry = JSON.parse(readFileSync(join(repoRoot, REGISTRY), "utf8"));
  const mdText = readFileSync(join(repoRoot, HUMAN_HALF), "utf8");
  const roster = JSON.parse(readFileSync(join(repoRoot, "docs/agent/org-roster.json"), "utf8"));
  const rosterRoles = new Set((roster.roles ?? roster).map((r) => r.id ?? r.roleId ?? r.name));
  const readJson = (p) => {
    try { return JSON.parse(readFileSync(join(repoRoot, p), "utf8")); } catch { return null; }
  };
  const { fatal, reports } = auditLabRegistry(registry, mdText, (p) => existsSync(join(repoRoot, p)), rosterRoles, readJson);
  for (const line of reports) console.log(`  · evidence age (REPORTED): ${line}`);
  const deployed = registry.entries?.filter((e) => e.deployedInLab === true).length ?? 0;
  console.log(`Open-source lab registry — ${registry.entries?.length ?? 0} entr(ies), ${deployed} deployed-in-lab`);
  if (fatal.length > 0) {
    console.error(`Lab-registry check FAILED: ${fatal.length} incoherence(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Lab-registry check passed — both halves agree, every classification is in the enum, every deployment claim cites evidence that exists.");
}
