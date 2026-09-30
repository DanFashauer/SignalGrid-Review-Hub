// check-resource-scan-binding.mjs — an intake row that cites a scan file is backed by it.
//
//   node scripts/check-resource-scan-binding.mjs              # the gate
//   node scripts/check-resource-scan-binding.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS (BUILD_BACKLOG, "intake row citing a resource-scans file", ICM-3,
// 2026-09-19). The intake rule (tool-evaluation-by-use §5b) writes its stage
// outputs — A proposals, B one confirm per roster perspective, C the brain's
// decision — to a JSON file under `docs/agent/resource-scans/`, and the
// `docs/agent/RESOURCE_INTAKE.md` row quotes it. Nothing bound the two: a row could
// claim N confirmed tasks with no confirm record behind it, or a decision could
// say `landed` about a path that does not exist. Same binding shape as
// `scripts/check-sim-requests.mjs`: the claim and the record must agree.
//
// WHAT IS GATED, for every intake-log row that CITES a scan file by its full path:
//   1. the cited file exists and parses as JSON;
//   2. `proposals[]` is non-empty and every proposal carries ≥1 `tasks[]` entry
//      with a unique string `id`;
//   3. `confirms[]` is non-empty, every confirm carries ≥1 vote, and every vote
//      names a task id the proposals hold;
//   4. `decision` is a non-empty object whose keys ⊆ the proposals' task ids;
//   5. a decision whose outcome is `landed` names ≥1 repo path in `where`, and
//      every repo path it names exists.
//
// THE TRIGGER IS THE CITATION, not the word "Self-scan": a row may describe the
// process without a file, and that row reads as "no scan file", never as a match.
// The count of rows walked and rows citing is printed on every run. Zero intake
// rows walked FAILS (a walk that reached nothing is not green about anything);
// zero citing rows is REPORTED as zero — never printed as a pass.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INTAKE = "docs/agent/RESOURCE_INTAKE.md";
const SCAN_CITE = /docs\/agent\/resource-scans\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;
/** A repo-relative path token: at least one directory and a file extension. */
const PATH_TOKEN = /(?:^|[\s(`'"])((?:\.?[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]*[A-Za-z0-9_-]\.[A-Za-z0-9]+)/g;

/** Intake-log rows: markdown table lines whose first cell is an ISO date. */
export function intakeRows(text) {
  return text.split("\n").map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line));
}

/** Every distinct scan file a row cites, by its full repo-relative path. */
export function citedScans(line) {
  return [...new Set([...line.matchAll(SCAN_CITE)].map((m) => `docs/agent/resource-scans/${m[1].replace(/\.+$/, "")}`))];
}

/** Problems with one scan file's content (already read), [] when it is bound. */
export function auditScan(rel, raw, exists) {
  const problems = [];
  let scan;
  try {
    scan = JSON.parse(raw);
  } catch (err) {
    return [`${rel}: not parseable JSON (${err.message})`];
  }
  const taskIds = new Set();
  const proposals = Array.isArray(scan?.proposals) ? scan.proposals : [];
  if (proposals.length === 0) problems.push(`${rel}: no \`proposals[]\` — a scan with no proposal backs no task`);
  for (const [pi, p] of proposals.entries()) {
    const tasks = Array.isArray(p?.tasks) ? p.tasks : [];
    if (tasks.length === 0) problems.push(`${rel}: proposals[${pi}] has no \`tasks[]\``);
    for (const t of tasks) {
      if (typeof t?.id !== "string" || t.id.trim() === "") problems.push(`${rel}: proposals[${pi}] holds a task with no string \`id\``);
      else if (taskIds.has(t.id)) problems.push(`${rel}: task id \`${t.id}\` appears twice`);
      else taskIds.add(t.id);
    }
  }
  const confirms = Array.isArray(scan?.confirms) ? scan.confirms : [];
  if (confirms.length === 0) problems.push(`${rel}: no \`confirms[]\` — nothing confirmed a single proposed task`);
  for (const [ci, c] of confirms.entries()) {
    const votes = Array.isArray(c?.votes) ? c.votes : [];
    if (votes.length === 0) problems.push(`${rel}: confirms[${ci}] carries no vote`);
    for (const v of votes) {
      if (!taskIds.has(v?.id)) problems.push(`${rel}: confirms[${ci}] votes on \`${v?.id}\`, which no proposal holds`);
    }
  }
  const decision = scan?.decision;
  const keys = decision && typeof decision === "object" && !Array.isArray(decision) ? Object.keys(decision) : [];
  if (keys.length === 0) problems.push(`${rel}: no \`decision\` — the brain's stage C is missing`);
  for (const id of keys) {
    if (!taskIds.has(id)) problems.push(`${rel}: decision names \`${id}\`, which no proposal holds`);
    const d = decision[id];
    if (d?.outcome === "landed") {
      const paths = [...String(d?.where ?? "").matchAll(PATH_TOKEN)].map((m) => m[1]);
      if (paths.length === 0) problems.push(`${rel}: decision \`${id}\` is \`landed\` but names no repo path`);
      for (const p of paths) if (!exists(p)) problems.push(`${rel}: decision \`${id}\` is \`landed\` at \`${p}\`, which does not exist`);
    }
  }
  return problems;
}

/** Pure audit over an injected reader: `io.read(rel)` and `io.exists(rel)`. */
export function auditBinding(io) {
  const problems = [];
  const rows = intakeRows(io.read(INTAKE));
  let citing = 0;
  const seen = new Map();
  for (const { line, n } of rows) {
    const cited = citedScans(line);
    if (cited.length === 0) continue;
    citing++;
    for (const rel of cited) {
      if (!seen.has(rel)) {
        seen.set(rel, io.exists(rel) ? auditScan(rel, io.read(rel), io.exists) : [`${rel}: cited but does not exist`]);
      }
      for (const p of seen.get(rel)) problems.push(`${INTAKE}:${n} → ${p}`);
    }
  }
  return { problems, rows: rows.length, citing, files: seen.size };
}

const diskIo = {
  read: (rel) => readFileSync(join(repo, rel), "utf8"),
  exists: (rel) => existsSync(join(repo, rel)),
};

function selfTest() {
  const good = {
    proposals: [{ tasks: [{ id: "A-1" }, { id: "A-2" }] }],
    confirms: [{ perspective: "x", votes: [{ id: "A-1", verdict: "confirm" }] }],
    decision: { "A-1": { outcome: "landed", where: "scripts/real.mjs: a gate" }, "A-2": { outcome: "filed", where: "the backlog" } },
  };
  const mut = (f) => { const c = structuredClone(good); f(c); return JSON.stringify(c); };
  const S = "docs/agent/resource-scans/";
  const files = new Map([
    ["scripts/real.mjs", ""],
    [`${S}good.json`, JSON.stringify(good)],
    [`${S}noconfirm.json`, mut((c) => { c.confirms = []; })],
    [`${S}strayid.json`, mut((c) => { c.decision["Z-9"] = { outcome: "filed" }; })],
    [`${S}ghostland.json`, mut((c) => { c.decision["A-1"].where = "scripts/ghost.mjs"; })],
    [`${S}nopathland.json`, mut((c) => { c.decision["A-1"].where = "somewhere in the tree"; })],
    [`${S}strayvote.json`, mut((c) => { c.confirms[0].votes[0].id = "Q-1"; })],
    [`${S}notasks.json`, mut((c) => { c.proposals = [{ tasks: [] }]; })],
    [`${S}garbled.json`, "{ not json"],
  ]);
  const intakeOf = (...cells) => ["# Intake", "", "| Date | Resource |", "| --- | --- |", ...cells.map((c) => `| 2026-09-19 | ${c} |`)].join("\n");
  const run = (intake) =>
    auditBinding({
      read: (rel) => (rel === INTAKE ? intake : files.has(rel) ? files.get(rel) : (() => { throw new Error(`ENOENT ${rel}`); })()),
      exists: (rel) => rel === INTAKE || files.has(rel),
    });
  const redFor = (name, sub) => {
    const r = run(intakeOf(`Self-scan: \`${S}${name}.json\``));
    return r.problems.some((p) => p.includes(`${name}.json`) && p.includes(sub));
  };

  const checks = [];
  const g = run(intakeOf(`scan in \`${S}good.json\``));
  checks.push(["a row citing a complete, bound scan file is clean", g.problems.length === 0 && g.citing === 1 && g.files === 1]);
  checks.push(["a row citing a scan file that does not exist is RED", redFor("missing", "does not exist")]);
  checks.push(["a scan file with no confirms[] is RED", redFor("noconfirm", "no `confirms[]`")]);
  checks.push(["a decision naming a task no proposal holds is RED", redFor("strayid", "`Z-9`, which no proposal holds")]);
  checks.push(["a `landed` decision at a path that does not exist is RED", redFor("ghostland", "`scripts/ghost.mjs`, which does not exist")]);
  checks.push(["a `landed` decision naming no path is RED", redFor("nopathland", "names no repo path")]);
  checks.push(["a confirm voting on a task no proposal holds is RED", redFor("strayvote", "`Q-1`, which no proposal holds")]);
  checks.push(["a proposal with no tasks[] is RED", redFor("notasks", "has no `tasks[]`")]);
  checks.push(["an unparseable scan file is RED", redFor("garbled", "not parseable JSON")]);
  const word = run(intakeOf("Self-scan ran; results summarised here, no file written"));
  checks.push(["the word \"Self-scan\" with no citation reads as no scan file, never a match", word.rows === 1 && word.citing === 0 && word.problems.length === 0]);
  const dir = run(intakeOf(`stage outputs go under \`${S}\``));
  checks.push(["citing only the directory is not a scan-file citation", dir.citing === 0]);
  const empty = run("# Intake\n\nno table yet\n");
  checks.push(["an intake log with no rows reports zero rows walked (the CLI fails on it)", empty.rows === 0]);

  // The real tree: the walk reaches rows, and every citing row is bound.
  const live = auditBinding(diskIo);
  checks.push([`the real intake walk reaches rows (${live.rows} walked, ${live.citing} citing)`, live.rows > 0]);
  checks.push(["the real tree is itself bound — green about a real ledger, not only a fixture", live.problems.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());

if (runAsCli) {
  const { problems, rows, citing, files } = auditBinding(diskIo);
  console.log(`Resource-scan binding — ${rows} intake row(s) walked, ${citing} cite a scan file (${files} distinct file(s))\n`);
  if (rows === 0) {
    console.error(`✗ 0 intake rows walked in ${INTAKE} — the walk reached nothing, so it is green about nothing.`);
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error("Resource-scan binding FAILED:");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("\nAn intake row that cites a scan file must be backed by it: proposals with tasks, ≥1 confirm, and a decision over those task ids whose `landed` paths exist.");
    process.exit(1);
  }
  if (citing === 0) {
    console.log("REPORTED: 0 rows cite a scan file — nothing is bound, so nothing here passed.");
  } else {
    console.log(`Resource-scan binding passed — ${citing} citing row(s), every cited scan file backs its claim.`);
  }
}
