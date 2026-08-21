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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {fileURLToPath, pathToFileURL } from "node:url";

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
export function auditLabRegistry(registry, mdText, pathExists) {
  const fatal = [];
  const entries = registry?.entries;
  if (!Array.isArray(entries)) return { fatal: [`${REGISTRY} carries no entries array`] };
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
    if (typeof e.ownerRanked !== "number") fatal.push(`${name}: no ownerRanked position`);
    if (e.deployedInLab === true) {
      if (!e.deployedEvidence) {
        fatal.push(`${name}: deployedInLab with no deployedEvidence — "it runs" without a citation is exactly the claim this repo forbids`);
      } else if (!pathExists(e.deployedEvidence)) {
        fatal.push(`${name}: deployedEvidence ${e.deployedEvidence} does not exist on disk — the deployment claim cites nothing`);
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
  return { fatal };
}

function selfTest() {
  const checks = [];
  const mdFor = (repos) =>
    ["| Rank | Repo |", "| ---: | --- |", ...repos.map((r, i) => `| ${i + 1} | \`${r}\` |`)].join("\n");
  const good = {
    transcribedFrom: "owner research directive, 2026-08-21",
    rule: { boundary: "adapter → evidence → policy → verdict", neverRule: "no code reuse before licence review" },
    entries: [
      { repo: "a/one", ownerRanked: 1, classification: "LAB_SOURCE", licence: "Apache-2.0", licenceCaution: false, role: "r", deployedInLab: true, deployedEvidence: "scripts/run-live-lanes.sh" },
      { repo: "b/two", ownerRanked: 2, classification: "DEFERRED_RESEARCH", licence: "AGPL-3.0", licenceCaution: true, role: "r", deployedInLab: false, deployedEvidence: null },
    ],
  };
  const onDisk = () => true;
  let r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), onDisk);
  checks.push(["a coherent registry with a matching md table passes clean", r.fatal.length === 0]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], licence: undefined }] }, mdFor(["a/one"]), onDisk);
  checks.push(["an entry with no licence is FATAL", r.fatal.some((x) => x.includes("no licence"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], classification: "COOL_REPO" }] }, mdFor(["a/one"]), onDisk);
  checks.push(["a classification outside the enum is FATAL", r.fatal.some((x) => x.includes("outside the declared enum"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[0], deployedEvidence: null }] }, mdFor(["a/one"]), onDisk);
  checks.push(["deployedInLab without evidence is FATAL — 'it runs' needs a citation", r.fatal.some((x) => x.includes("no deployedEvidence"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[1], licenceCaution: false }] }, mdFor(["b/two"]), onDisk);
  checks.push(["an AGPL licence without licenceCaution is FATAL", r.fatal.some((x) => x.includes("caution family"))]);
  r = auditLabRegistry({ ...good, entries: [{ ...good.entries[1], licence: "Sustainable Use License", licenceCaution: false }] }, mdFor(["b/two"]), onDisk);
  checks.push(["a Sustainable Use licence without caution is FATAL — custom families count", r.fatal.some((x) => x.includes("caution family"))]);
  r = auditLabRegistry(good, mdFor(["a/one"]), onDisk);
  checks.push(["a json repo missing from the md table is FATAL", r.fatal.some((x) => x.includes("not in the md table"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two", "c/three"]), onDisk);
  checks.push(["an md-table repo missing from the json is FATAL", r.fatal.some((x) => x.includes("not in the json"))]);
  r = auditLabRegistry(good, mdFor(["a/one", "b/two"]), () => false);
  checks.push(["deployedEvidence absent from disk is FATAL — the claim cites nothing", r.fatal.some((x) => x.includes("does not exist on disk"))]);
  // Parser controls: a backticked file path in a table row, or a repo named
  // only in prose, must not enter the cross-check.
  const mdWithNoise = `${mdFor(["a/one", "b/two"])}\n| gate | \`scripts/check-lab-registry.mjs\` |\n\nSee also \`c/prose-only\` in passing.`;
  r = auditLabRegistry(good, mdWithNoise, onDisk);
  checks.push(["file paths and prose mentions do not desynchronize the halves", r.fatal.length === 0]);
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
  const { fatal } = auditLabRegistry(registry, mdText, (p) => existsSync(join(repoRoot, p)));
  const deployed = registry.entries?.filter((e) => e.deployedInLab === true).length ?? 0;
  console.log(`Open-source lab registry — ${registry.entries?.length ?? 0} entr(ies), ${deployed} deployed-in-lab`);
  if (fatal.length > 0) {
    console.error(`Lab-registry check FAILED: ${fatal.length} incoherence(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Lab-registry check passed — both halves agree, every classification is in the enum, every deployment claim cites evidence that exists.");
}
