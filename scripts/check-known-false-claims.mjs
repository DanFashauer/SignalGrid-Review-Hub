// Known-false-claim registry — every proven-false assertion becomes a permanent test.
//
//   node scripts/check-known-false-claims.mjs              # gate
//   node scripts/check-known-false-claims.mjs --list       # what has been claimed and refuted
//   node scripts/check-known-false-claims.mjs --self-test  # prove the gate can fail
//
// WHY. An AI contributor cannot remember its own mistakes: each session starts clean, so
// the SAME wrong claim can be made indefinitely. A human colleague accumulates judgement;
// a model accumulates nothing. `docs/agent/FALSE_CLAIMS.json` is that memory, and this
// gate is what makes it bite. The registry is not hypothetical — every entry in it was
// actually asserted, in writing, about this repository, and three of them were then
// repeated by later readers who trusted the document over the tree.
//
// TWO WAYS TO FAIL, and the second is the one that matters:
//   1. A REFUTATION NO LONGER HOLDS. The evidence that disproved the claim is gone, so
//      the registry is stale and its entry must be re-examined — never silently deleted,
//      or the lesson goes with it.
//   2. A TRACKED DOCUMENT RE-STATES A CLAIM ALREADY PROVEN FALSE. This is the whole
//      point. An earlier version of this gate promised this check in its header and did
//      not implement it, which is the defect this repository is named for: coverage
//      advertised, not delivered.
//
// RETRACTIONS MAY QUOTE THE CLAIM. Struck-through text and blockquotes are exempt — a
// document correcting itself has to be able to repeat the false sentence verbatim, and
// the corrections in `docs/DELIVERY_GAP_ANALYSIS.md` do exactly that.
//
// This gate is deliberately narrow. It cannot stop a NEW wrong claim. It guarantees only
// that a mistake made once is not made twice — which, for a contributor with no memory,
// is most of the value available.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = join(REPO, "docs/agent/FALSE_CLAIMS.json");

/** Lines a correction may quote. Everything else is the document's own voice. */
export function isRetracted(line) {
  const t = line.trim();
  return t.startsWith(">") || /~~/.test(line);
}

/** Pure: which lines of `text` re-assert `claim`. Drives the gate and the self-test. */
export function reassertionsIn(text, claim) {
  const hits = [];
  const patterns = (claim.denials ?? []).map((d) => new RegExp(d, "i"));
  text.split("\n").forEach((line, i) => {
    if (isRetracted(line)) return;
    if (patterns.some((re) => re.test(line))) hits.push({ line: i + 1, text: line.trim().slice(0, 150) });
  });
  return hits;
}

/** Pure: is a registry entry well-formed? A malformed entry is a silent hole. */
export function validateEntry(c) {
  const problems = [];
  for (const field of ["id", "claimed", "assertedBy", "assertedOn", "whyItHappened"]) {
    if (!c[field] || String(c[field]).trim().length < 3) problems.push(`${c.id ?? "?"}: missing or empty "${field}"`);
  }
  const r = c.refutation;
  if (!r) problems.push(`${c.id}: no refutation`);
  else {
    if (!["path_exists", "file_contains"].includes(r.kind)) problems.push(`${c.id}: unknown refutation kind "${r.kind}"`);
    if (!Array.isArray(r.paths) || r.paths.length === 0) problems.push(`${c.id}: refutation names no evidence paths`);
    if (r.kind === "file_contains" && (!r.file || !r.contains)) problems.push(`${c.id}: file_contains needs "file" and "contains"`);
  }
  if (!Array.isArray(c.denials) || c.denials.length === 0) problems.push(`${c.id}: no denial patterns — nothing would catch a re-assertion`);
  for (const d of c.denials ?? []) {
    try {
      new RegExp(d, "i");
    } catch {
      problems.push(`${c.id}: denial pattern is not a valid regex: ${d}`);
    }
  }
  return problems;
}

export function checkRefutation(c, root = REPO) {
  const r = c.refutation;
  const missing = (r.paths ?? []).filter((p) => !existsSync(join(root, p)));
  if (missing.length) return { ok: false, why: `evidence is GONE: ${missing.join(", ")}` };
  if (r.kind === "file_contains") {
    let text = "";
    try {
      text = readFileSync(join(root, r.file), "utf8");
    } catch {
      return { ok: false, why: `cannot read ${r.file}` };
    }
    if (!text.includes(r.contains)) return { ok: false, why: `${r.file} no longer contains "${r.contains}"` };
  }
  return { ok: true };
}

const trackedDocs = () => {
  try {
    const out = execFileSync("git", ["ls-files", "--", "*.md", "*.markdown"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out ? out.trim().split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
};

function load() {
  if (!existsSync(REGISTRY)) {
    console.error("docs/agent/FALSE_CLAIMS.json is missing — the registry IS the memory.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(REGISTRY, "utf8"));
}

function selfTest() {
  const checks = [];
  const claim = {
    id: "fixture",
    claimed: "a synthetic claim",
    assertedBy: "the self-test",
    assertedOn: "2026-01-01",
    whyItHappened: "it did not; this entry exists only to drive the checks",
    refutation: { kind: "path_exists", paths: ["package.json"] },
    denials: ["android[^.\\n]{0,40}\\babsent\\b"],
  };

  checks.push(["A RE-ASSERTION IS CAUGHT — the check the previous version promised and did not implement", reassertionsIn("Android — ABSENT — nothing there.", claim).length === 1]);
  checks.push(["…struck through, it is allowed — a doc must be able to retract itself", reassertionsIn("~~Android — ABSENT — nothing there.~~", claim).length === 0]);
  checks.push(["…in a correction blockquote, allowed", reassertionsIn("> Android — ABSENT — nothing there.", claim).length === 0]);
  checks.push(["ordinary prose is not caught — this is not a keyword ban", reassertionsIn("The Android app ships a core module.", claim).length === 0]);

  checks.push(["a well-formed entry validates clean", validateEntry(claim).length === 0]);
  checks.push(["an entry with NO denial patterns is rejected — nothing would catch a re-assertion", validateEntry({ ...claim, denials: [] }).length > 0]);
  checks.push(["an entry with no refutation evidence is rejected", validateEntry({ ...claim, refutation: { kind: "path_exists", paths: [] } }).length > 0]);
  checks.push(["an entry that does not say WHY it happened is rejected", validateEntry({ ...claim, whyItHappened: "" }).length > 0]);
  checks.push(["an invalid denial regex is rejected rather than silently never matching", validateEntry({ ...claim, denials: ["("] }).length > 0]);

  checks.push(["a refutation whose evidence exists holds", checkRefutation(claim).ok === true]);
  checks.push(["A REFUTATION WHOSE EVIDENCE VANISHED FAILS", checkRefutation({ ...claim, refutation: { kind: "path_exists", paths: ["native/__no_such_platform__"] } }).ok === false]);
  checks.push([
    "file_contains fails when the file no longer carries the string",
    checkRefutation({ ...claim, refutation: { kind: "file_contains", file: "package.json", contains: "__absolutely_not_in_here__", paths: ["package.json"] } }).ok === false,
  ]);

  const reg = load();
  checks.push(["the live registry is non-empty — a gate over nothing is vacuous", (reg.claims ?? []).length > 0]);
  checks.push(["every live entry is well-formed", (reg.claims ?? []).every((c) => validateEntry(c).length === 0)]);

  // The evidence-log structure reporter. Its first version counted dated HEADINGS,
  // so a section with no claim, command or verdict inflated the number — caught by
  // external review on PR #299. These fixtures keep the distinction it now draws.
  const FULL = [
    "## 2026-08-24 — a real record",
    "Command:  node scripts/x.mjs",
    "Output:   ok",
    "Verdict:  holds",
  ].join("\n");
  const HEADING_ONLY = "## 2026-08-24 — NOT VERIFIED HERE\nsome prose, no fields";
  checks.push(["a record with Command+Output+Verdict COUNTS", evidenceEntries(FULL).complete.length === 1]);
  checks.push(["a dated heading with none of the three fields does NOT count",
    evidenceEntries(HEADING_ONLY).complete.length === 0]);
  checks.push(["...and is REPORTED rather than silently dropped",
    evidenceEntries(HEADING_ONLY).incomplete.length === 1]);
  checks.push(["a record missing only Verdict does not count, and names what is missing",
    evidenceEntries(FULL.replace("Verdict:  holds", "")).incomplete[0]?.missing.join() === "Verdict"]);
  checks.push(["both kinds are separated in one file",
    evidenceEntries(`${FULL}\n\n${HEADING_ONLY}`).complete.length === 1 &&
    evidenceEntries(`${FULL}\n\n${HEADING_ONLY}`).incomplete.length === 1]);
  checks.push(["an empty file yields no entries rather than throwing", evidenceEntries("").complete.length === 0]);
  // The 2026-09-06 detector: a qualified field heading is the field; a different word is not.
  const QUALIFIED = [
    "## 2026-09-04 — a qualified record",
    "Command (adversarial read of the whole surface):",
    "Output (what each property was checked to hold):",
    "Verdict:  **fixed and gated**",
  ].join("\n");
  checks.push(["a record whose fields carry a parenthesized qualifier COUNTS (19 real entries were miscounted before this)",
    evidenceEntries(QUALIFIED).complete.length === 1]);
  checks.push(["…but a DIFFERENT word sharing the prefix is not the field (Commander: is nothing)",
    evidenceEntries(QUALIFIED.replace("Command (", "Commander (")).incomplete[0]?.missing.join() === "Command"]);
  checks.push(["…and the qualifier may not contain a colon of its own (the field ends at the first colon)",
    evidenceField("Output").test("Output (a: b):") === true && evidenceField("Output").test("Output (no terminator") === false]);
  checks.push(["the incomplete-heading ratchet holds at the ceiling", incompleteVerdict(3, 3) === null]);
  checks.push(["…and a RISE above the ceiling is a problem naming the new unverifiable entry",
    (incompleteVerdict(4, 3) ?? "").includes("above the ceiling")]);
  checks.push(["…and a count BELOW the ceiling is ALSO a problem — the ratchet must be lowered, not left as a fossil",
    (incompleteVerdict(2, 3) ?? "").includes("BELOW the ceiling")]);
  checks.push(["LIVE: the committed log sits exactly at the ceiling",
    incompleteVerdict(evidenceEntries(readFileSync(resolve(REPO, "docs/agent/EVIDENCE.md"), "utf8")).incomplete.length) === null]);
  checks.push(["LIVE: the committed evidence log holds at least one complete record",
    evidenceEntries(readFileSync(resolve(REPO, "docs/agent/EVIDENCE.md"), "utf8")).complete.length > 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Guarded on being the entry point: the pure helpers above are imported by tests and by
// other gates, and a module that gates the repository as a side effect of being imported
// makes every consumer's exit code a statement about the wrong thing.

/**
 * Split EVIDENCE.md into COMPLETE evidence records and dated headings that only look
 * like one.
 *
 * WHY THE STRUCTURE IS CHECKED AND NOT JUST THE HEADING. The first version of this
 * reporter counted `^## <date> — ` and nothing else, so it reported 8 entries for a
 * file holding 7 records plus a `## <date> — NOT VERIFIED HERE` section that carries
 * no claim, no command and no verdict. Caught by external review on PR #299, and it
 * is the same defect as the four findings the log was written to record: a
 * measurement that was accurate about a real property (dated headings) and answered a
 * different question than the one asked (complete, reproducible records).
 *
 * A number that cannot tell a reproducible record from any dated heading is worse
 * than no number, because it reads as coverage.
 */
/**
 * The field detector. `^Command:` was the first shape and the only one recognized
 * until 2026-09-06, while the audit-round entries written from 2026-09-04 on head
 * their fields `Command (adversarial read of …):` and `Output (what was checked):` —
 * the same three fields, with the qualifier the template invites. Nineteen of
 * thirty-three dated headings were reported "NOT counted — missing Command/Output"
 * while every one of them carried all three, and the reporter's number read as
 * fourteen reproducible records in a log holding thirty-three. A qualifier in
 * parentheses is still the field; a different word is not (`Commander:` is nothing).
 */
export function evidenceField(name) {
  return new RegExp(`^${name}\\b[^:\\n]*:`, "m");
}

/**
 * The incomplete-heading RATCHET. Reported-only meant a new entry could land
 * without a command or a verdict and change nothing but a line of output nobody
 * reads. The count of headings NOT counted may not rise above this ceiling, and —
 * so the ceiling is a measurement and not a fossil — it may not sit below it
 * either: when an entry is completed, lower the number here in the same change.
 * Measured 2026-09-06 with the detector above: every dated heading in the log
 * carries all three fields, so the ceiling starts at zero and may only be raised
 * by a deliberate edit here — which is the review moment this exists to force.
 */
export const EVIDENCE_INCOMPLETE_CEILING = 0;

/** Pure: null when the count sits exactly at the ceiling, else the problem to raise. */
export function incompleteVerdict(count, ceiling = EVIDENCE_INCOMPLETE_CEILING) {
  if (count > ceiling) {
    return (
      `docs/agent/EVIDENCE.md: ${count} dated heading(s) lack Command/Output/Verdict, above the ceiling of ${ceiling} — ` +
      `a new entry landed without the three fields that make it re-checkable. Complete it; do not raise the ceiling.`
    );
  }
  if (count < ceiling) {
    return (
      `docs/agent/EVIDENCE.md: ${count} incomplete heading(s), BELOW the ceiling of ${ceiling} — lower ` +
      `EVIDENCE_INCOMPLETE_CEILING in scripts/check-known-false-claims.mjs to ${count} so the ratchet keeps the gain.`
    );
  }
  return null;
}

export function evidenceEntries(text) {
  const complete = [];
  const incomplete = [];
  const heads = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2}) — (.*)$/gm)];
  for (let i = 0; i < heads.length; i += 1) {
    const start = heads[i].index + heads[i][0].length;
    const body = text.slice(start, i + 1 < heads.length ? heads[i + 1].index : text.length);
    const missing = ["Command", "Output", "Verdict"].filter((f) => !evidenceField(f).test(body));
    const entry = { date: heads[i][1], title: heads[i][2], missing };
    if (missing.length === 0) complete.push(entry);
    else incomplete.push(entry);
  }
  return { complete, incomplete };
}

const IS_ENTRY = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);

if (IS_ENTRY && argv.includes("--self-test")) process.exit(selfTest());
if (!IS_ENTRY) {
  // exported API only — no side effects
} else {
  runCli();
}

function runCli() {
const registry = load();
const claims = registry.claims ?? [];

if (argv.includes("--list")) {
  console.log(`\nKnown-false claims (${claims.length}) — do not re-assert any of these:\n`);
  for (const c of claims) {
    console.log(`  ${c.id}`);
    console.log(`    claimed:  "${c.claimed}"`);
    console.log(`    by:       ${c.assertedBy} (${c.assertedOn})`);
    console.log(`    cause:    ${c.whyItHappened}`);
    console.log(`    refuted:  ${c.refutation.paths.join(", ")}\n`);
  }
  process.exit(0);
}

const problems = [];
for (const c of claims) problems.push(...validateEntry(c));

console.log(`Known-false-claim registry — ${claims.length} entr(y/ies), re-verified against the tree\n`);

for (const c of claims) {
  const r = checkRefutation(c);
  if (r.ok) console.log(`  ✓ ${c.id.padEnd(26)} still refuted`);
  else {
    console.log(`  ✗ ${c.id.padEnd(26)} ${r.why}`);
    problems.push(
      `${c.id}: the refutation no longer holds — ${r.why}. The claim "${c.claimed}" was false on ${c.assertedOn}. ` +
        `If the tree genuinely changed, update this entry deliberately; do not delete it, or the lesson is lost.`,
    );
  }
}

const docs = trackedDocs();
let reassertions = 0;
for (const rel of docs) {
  let text;
  try {
    text = readFileSync(join(REPO, rel), "utf8");
  } catch {
    continue;
  }
  for (const c of claims) {
    for (const hit of reassertionsIn(text, c)) {
      reassertions += 1;
      problems.push(`${rel}:${hit.line} re-states "${c.id}", proven false on ${c.assertedOn} — "${hit.text}"`);
    }
  }
}

console.log(`\n  ${docs.length} tracked document(s) scanned for re-assertion · ${reassertions} found`);

// REPORTED, never fatal: the state of the reviewer's OTHER write path.
//
// FALSE_CLAIMS.json and docs/agent/EVIDENCE.md are the two files the
// signalgrid-reviewer role may write, and only the first had anything watching it.
// EVIDENCE.md sat at its seeded-empty template from 2026-08-22 while the reviewer
// role ran, so the log that makes a finding independently re-checkable did not
// exist — the file said "the first review writes the first entry", and no review
// did. Printed rather than gated: entry COUNT is a real number, but "did this
// session's reviews get written up" is a judgement, and a gate on it would be
// satisfied by one junk entry. What a reader needs is to see the number and the
// date of the newest entry, so an empty or fossilised log is visible on every run
// instead of silent.
const evidencePath = resolve(REPO, "docs/agent/EVIDENCE.md");
if (!existsSync(evidencePath)) {
  console.log("\n  ⚠ docs/agent/EVIDENCE.md is missing — the reviewer role has nowhere to record evidence.");
} else {
  const { complete, incomplete } = evidenceEntries(readFileSync(evidencePath, "utf8"));
  if (complete.length === 0) {
    console.log("\n  ⚠ docs/agent/EVIDENCE.md holds NO complete entries — the reviewer's");
    console.log("    claim→command→output log is empty, so no finding here is independently re-checkable.");
  } else {
    const newest = complete.map((e) => e.date).sort().at(-1);
    console.log(`\n  docs/agent/EVIDENCE.md: ${complete.length} complete entr(ies), newest ${newest}`);
  }
  if (incomplete.length > 0) {
    console.log(`  ⚠ ${incomplete.length} dated heading(s) NOT counted — missing ${"Command/Output/Verdict"}:`);
    for (const e of incomplete) console.log(`      ${e.date} — ${e.title.slice(0, 58)} (missing: ${e.missing.join(", ")})`);
  }
  // GATED since 2026-09-06: the count may neither rise (an unverifiable entry landed)
  // nor sit under the ceiling (a completed entry must lower it, or the ratchet is a fossil).
  const ratchet = incompleteVerdict(incomplete.length);
  if (ratchet) problems.push(ratchet);
  else console.log(`  incomplete-heading ratchet: ${incomplete.length} = ceiling ${EVIDENCE_INCOMPLETE_CEILING} (held)`);
}

if (problems.length > 0) {
  console.error(`\nKnown-false-claim check FAILED: ${problems.length} problem(s).\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nA claim proven false once must not be made again. If you believe the tree has");
  console.error("changed, run `node scripts/agent/absence-check.mjs <topic>` and update the registry");
  console.error("entry with what you measured — striking through or blockquoting a correction is");
  console.error("always allowed.");
  process.exit(1);
}
console.log("\nKnown-false-claim check passed — every refutation holds, and no document re-states one.");
}
