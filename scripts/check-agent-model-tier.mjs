#!/usr/bin/env node
// check-agent-model-tier — every first-party subagent definition must name its DR-047
// model tier on its own frontmatter `model:` line, and the tier must be one of
// haiku, sonnet, opus.
//
//   node scripts/check-agent-model-tier.mjs              the gate
//   node scripts/check-agent-model-tier.mjs --self-test  prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// DR-047 (2026-09-12) exists because a subagent spawned with no `model:` inherited the
// coordinator's model, and when that model hit its usage limit every inherited subagent
// died with it. Rule 1 says registered `.claude/agents/*.md` roles set the tier by
// frontmatter; rule 2 says Fable / Mythos are never assigned to an engineering or review
// stage. The record said so honestly: "operating doctrine backed by review, not yet by a
// script". All fifteen definitions carried a tier the day this gate was written (measured:
// 8 opus, 6 sonnet, 1 haiku) — by convention. Nothing read the line, so the sixteenth
// agent could have shipped with `model: inherit`, no line at all, or a creative-tier
// model and every gate would have stayed green. Unknown tier is a LOOSENING (golden rule
// 2): a missing or inherited line means "whatever the caller is running", which is the
// exact failure the record was written to end.
//
// WHAT IS GATED
// -------------
// Each FIRST-PARTY file under .claude/agents/ must have, inside its YAML frontmatter,
// exactly one `model:` line whose value (quotes and a trailing `# comment` ignored) is
// literally `haiku`, `sonnet` or `opus`. Missing, `inherit`, `fable`, `mythos`, a dated
// model id, a different case, a duplicate line, or a `model:` that sits in the body
// below the frontmatter all FAIL, with the file named.
//
// First-party vs vendored is NOT decided here: it is check-agent-raise-hand.mjs's own
// discrimination (docs/agent/agent-tiers.json provenance "vendored", unknown provenance
// counts as first-party), imported, so there is one list. Vendored agents stay
// byte-identical to third_party/everything-claude-code/agents/ (check-agent-roster.mjs
// rule 5) and cannot be edited to satisfy this gate; they are counted, not checked.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { needsClause, vendoredIds } from "./check-agent-raise-hand.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const AGENTS_DIR_REL = ".claude/agents";

// A floor: an empty or misdirected walk can never pass as "all compliant".
const FILE_FLOOR = 10;

export const TIERS = Object.freeze(["haiku", "sonnet", "opus"]);

// One line, quoted from docs/DECISION_RECORDS.md (the self-test asserts each fragment is
// still there, so this line cannot drift from the record it cites).
export const DR047_FRAGMENTS = Object.freeze([
  "Registered `.claude/agents/*.md` roles set it by frontmatter",
  "never inherit",
  "Fable / Mythos",
  "are the creative tier and are never assigned to an engineering or review spawn",
]);
export const DR047_LINE =
  'DR-047: "Registered `.claude/agents/*.md` roles set it by frontmatter" and "never inherit" the coordinator\'s model; ' +
  '"Fable / Mythos are the creative tier and are never assigned to an engineering or review spawn."';

/** The text between the opening `---` and the next `---` line, or null with no frontmatter. */
export function frontmatterBlock(body) {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return m ? m[1] : null;
}

/** The `model:` lines of a definition's frontmatter, or null when it has no frontmatter. */
function modelLines(body) {
  const fm = frontmatterBlock(body);
  return fm === null ? null : fm.split(/\r?\n/).filter((l) => /^model\s*:/.test(l));
}

const valueOf = (line) =>
  line.replace(/^model\s*:/, "").replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The verdict on one definition's text: null when it names a legal tier, else the one
 * line that says what is wrong.
 */
export function tierProblem(body) {
  const lines = modelLines(body);
  if (lines === null) return "no YAML frontmatter, so no `model:` line (the harness would inherit the caller's model)";
  if (lines.length === 0) return "no `model:` line in the frontmatter (the harness would inherit the caller's model)";
  if (lines.length > 1) return `${lines.length} \`model:\` lines in the frontmatter — which one wins is not this gate's to guess`;
  const value = valueOf(lines[0]);
  if (value === "") return "`model:` is empty";
  if (!TIERS.includes(value)) {
    return `\`model: ${value}\` is not one of ${TIERS.join(", ")}` +
      (value === "inherit" ? " (inherit is the failure DR-047 was written to end)" : "");
  }
  return null;
}

function agentFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Audit a directory of definitions. `vendored` is the set of ids exempt from the check
 * (see header). Pure apart from reading the directory. Vendored definitions are never
 * failed, but their lines are tallied so the output says what it did NOT check.
 * @returns {{ total: number, firstParty: number, vendored: number, failures: {file:string, problem:string}[], tiers: Record<string, number>, vendoredTiers: Record<string, number> }}
 */
export function audit(dir, vendored) {
  const files = agentFiles(dir);
  const failures = [];
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0]));
  const vendoredTiers = {};
  let firstParty = 0;
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    if (!needsClause(f, vendored)) {
      const lines = modelLines(body);
      const v = lines && lines.length === 1 ? valueOf(lines[0]) || "(empty)" : "(none)";
      vendoredTiers[v] = (vendoredTiers[v] ?? 0) + 1;
      continue;
    }
    firstParty++;
    const problem = tierProblem(body);
    if (problem) failures.push({ file: f, problem });
    else tiers[valueOf(modelLines(body)[0])]++;
  }
  return { total: files.length, firstParty, vendored: files.length - firstParty, failures, tiers, vendoredTiers };
}

const def = (model) => `---\nname: x\ndescription: d\ntools: Read\n${model === null ? "" : `model: ${model}\n`}---\n\nbody\n`;

function selfTest() {
  const fail = [];
  const t = (name, ok) => { if (!ok) fail.push(name); };

  // 1. The verdict function, case by case.
  t("sonnet passes", tierProblem(def("sonnet")) === null);
  t("opus passes", tierProblem(def("opus")) === null);
  t("haiku passes", tierProblem(def("haiku")) === null);
  t("a quoted tier with a trailing comment passes", tierProblem(def('"opus"   # judgment')) === null);
  t("a missing model line FAILS", tierProblem(def(null)) !== null);
  t("model: inherit FAILS and says why", /inherit/.test(tierProblem(def("inherit")) ?? ""));
  t("model: fable FAILS", tierProblem(def("fable")) !== null);
  t("model: mythos FAILS", tierProblem(def("mythos")) !== null);
  t("a dated model id FAILS", tierProblem(def("claude-sonnet-4-20250514")) !== null);
  t("a differently cased tier FAILS (exact words only)", tierProblem(def("Opus")) !== null);
  t("an empty model line FAILS", tierProblem(def("")) !== null);
  t("two model lines FAIL", tierProblem("---\nname: x\nmodel: opus\nmodel: sonnet\n---\nb\n") !== null);
  t("a model line in the body, below the frontmatter, does not count", tierProblem("---\nname: x\ntools: Read\n---\n\nmodel: opus\n") !== null);
  t("no frontmatter at all FAILS", tierProblem("model: opus\n\nbody\n") !== null);

  // 2. The audit over a real directory: a passing file and three failing ones, plus the
  //    vendored exemption, built under the OS temp dir and removed afterwards.
  const root = mkdtempSync(join(tmpdir(), "sg-model-tier-"));
  try {
    const dir = join(root, ".claude/agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "good.md"), def("sonnet"));
    writeFileSync(join(dir, "no-model.md"), def(null));
    writeFileSync(join(dir, "inherits.md"), def("inherit"));
    writeFileSync(join(dir, "creative.md"), def("fable"));
    const r = audit(dir, new Set());
    const failed = r.failures.map((x) => x.file.slice(dir.length + 1)).sort();
    t("audit: exactly the three bad files fail", JSON.stringify(failed) === JSON.stringify(["creative.md", "inherits.md", "no-model.md"]));
    t("audit: the good file is not among the failures", !failed.includes("good.md"));
    t("audit: the tier tally counts the good file only", r.tiers.sonnet === 1 && r.tiers.opus === 0 && r.tiers.haiku === 0);

    // A vendored agent is exempt (it cannot be edited), an unregistered one is not.
    const v = audit(dir, new Set(["inherits", "creative"]));
    t("audit: vendored ids are exempt, first-party ones still fail",
      v.failures.length === 1 && v.failures[0].file.endsWith("no-model.md") && v.vendored === 2);
    t("audit: a vendored file's line is tallied, not judged", v.vendoredTiers.inherit === 1 && v.vendoredTiers.fable === 1);

    // 3. The gate as a process: exit 1 on the failing directory, 0 on the good one.
    const run = (d) => spawnSync(process.execPath, [SELF, "--agents-dir", d, "--floor", "1"], { encoding: "utf8" });
    const bad = run(dir);
    t("process: the failing directory exits 1", bad.status === 1);
    t("process: …names each failing file", ["no-model.md", "inherits.md", "creative.md"].every((n) => bad.stderr.includes(n)));
    t("process: …and quotes DR-047 on one line", bad.stderr.split("\n").filter((l) => l.includes("DR-047:")).length === 1);
    const goodDir = join(root, "good-only");
    mkdirSync(goodDir);
    writeFileSync(join(goodDir, "good.md"), def("opus"));
    const ok = run(goodDir);
    t("process: the good-only directory exits 0", ok.status === 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // 4. The citation: every fragment of the DR-047 line is still in the record.
  let dr = "";
  try { dr = readFileSync(join(repo, "docs/DECISION_RECORDS.md"), "utf8"); } catch { /* reported below */ }
  for (const frag of DR047_FRAGMENTS) t(`DR-047 still says "${frag}"`, dr.includes(frag));

  // 5. Coverage honesty on the real tree.
  const n = agentFiles(join(repo, AGENTS_DIR_REL)).length;
  t(`at least ${FILE_FLOOR} agent files are present (found ${n})`, n >= FILE_FLOOR);

  if (fail.length) { for (const f of fail) console.error(`self-test FAIL: ${f}`); return 1; }
  console.log("check-agent-model-tier self-test: ok");
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());

  // --agents-dir / --floor are the self-test's seam for running THIS process against a
  // fixture; CI and preflight pass neither. An override is printed so it cannot pass quietly.
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const overrideDir = flag("--agents-dir");
  const dir = overrideDir ? resolve(overrideDir) : join(repo, AGENTS_DIR_REL);
  const floor = flag("--floor") !== undefined ? Number(flag("--floor")) : FILE_FLOOR;
  if (overrideDir) console.log(`check-agent-model-tier: agents dir overridden → ${dir}`);

  let r;
  try { r = audit(dir, vendoredIds()); }
  catch (e) {
    console.error(`check-agent-model-tier FAIL — cannot read ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (!(floor >= 1) || r.total < floor) {
    console.error(`check-agent-model-tier FAIL — only ${r.total} agent file(s) found under ${overrideDir ? dir : AGENTS_DIR_REL} (floor ${floor}); the walk is wrong or the plane shrank.`);
    process.exit(1);
  }
  if (r.failures.length) {
    console.error(`check-agent-model-tier FAIL — ${r.failures.length} first-party agent definition(s) do not name a DR-047 tier (${TIERS.join(" | ")}):\n`);
    for (const f of r.failures) console.error(`  ${f.file.startsWith(repo) ? f.file.slice(repo.length + 1) : f.file}: ${f.problem}`);
    console.error(`\n${DR047_LINE}\nSet \`model: haiku\`, \`model: sonnet\` or \`model: opus\` in the frontmatter of each file above.`);
    process.exit(1);
  }
  const tally = (m) => Object.entries(m).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${t}`).join(", ") || "none";
  console.log(`check-agent-model-tier: ok — ${r.firstParty} first-party agent definition(s) name a DR-047 tier (${tally(r.tiers)}); ${r.vendored} vendored not checked — byte-identical to third_party, check-agent-roster rule 5 (their lines read: ${tally(r.vendoredTiers)})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
