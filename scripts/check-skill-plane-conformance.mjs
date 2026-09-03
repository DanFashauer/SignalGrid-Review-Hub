// Skill-plane conformance — the shape of a skill and an agent is not negotiable.
//
//   node scripts/check-skill-plane-conformance.mjs              # the gate
//   node scripts/check-skill-plane-conformance.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. Two sibling gates already govern the executable plane, and a
// gap sat between them. `check-agent-roster.mjs` asserts an AGENT has YAML
// frontmatter and derives its write power from `tools:`, but it never checks that
// the agent carries the `name` and `description` the harness selects it by, and it
// says nothing at all about `.claude/skills`. `check-org-roster.mjs` resolves a
// `skill:<name>` executor pointer to a directory holding a SKILL.md — existence,
// never shape. So a SKILL.md with no `description`, or a `name` that disagrees
// with its own directory, would load into the harness misindexed and pass every
// gate in the tree. The harness selects a skill by its metadata; a skill whose
// metadata is malformed is a skill the model cannot reliably reach, which is the
// same fossil as a role nobody runs, one directory over.
//
// This is the mechanical form of the agent-platform-steward's charter — no gate
// reads English — applied to the plane's own front matter. It keeps the agent and
// skill plane honest as it grows, which is the whole point of a plane that the org
// is now allowed to extend on its own initiative (DR-021).
//
// WHAT IS GATED (fails the build):
//   1. Every `.claude/skills/*/SKILL.md` has YAML frontmatter with a non-empty
//      `name` and a non-empty `description`.
//   2. Its `name` equals its directory name — the identifier the harness and the
//      org roster address it by. A name that drifts from the directory is a skill
//      that reads as one thing and is filed as another.
//   3. Every `.claude/agents/*.md` has YAML frontmatter with a non-empty `name`
//      and a non-empty `description`, and its `name` equals its filename stem.
//   4. FLOORS. The skills walk and the agents walk each reach at least a floor of
//      members. A walk that silently reaches nothing is the fail-open this whole
//      repository keeps finding — a gate green about a tree it never opened.
//
// This gate deliberately does NOT re-check what its siblings already own: write
// scopes and vendor drift are `check-agent-roster.mjs`; executor-pointer
// resolution is `check-org-roster.mjs`; cited-path integrity inside a skill body
// is `scan-agent-plane.mjs` and `check-cited-paths.mjs`. It owns exactly the
// front-matter shape those three assume and none of them assert.
//
// SELF-TEST: a well-formed member is clean; a skill missing `description`, an
// agent missing `name`, and a `name` that disagrees with its directory are each
// red; and the FLOORS are proven against the real tree, so a walk that resolves
// nothing cannot report green about nothing.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = ".claude/skills";
const AGENTS_DIR = ".claude/agents";

// Floors below today's real counts (24 skills, 13 agents) but far above zero, so a
// broken walk fails loudly rather than passing over an empty result. The point of a
// floor is to catch a walk that reaches nothing, not to pin a total that a routine
// deletion would trip — a pinned total silently turns a legitimate removal into a
// regression, the mistake CLAUDE.md warns about for the proof suite.
const SKILL_FLOOR = 10;
const AGENT_FLOOR = 5;

/** Parse the leading `--- … ---` YAML block into a flat key→value map, or null. */
export function frontmatter(body) {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/**
 * Pure audit over an injected reader so the self-test can plant fixtures without
 * touching disk. `io.listSkills()` returns skill directory names that hold a
 * SKILL.md; `io.listAgents()` returns agent `.md` filenames; `io.read(rel)` reads
 * a repo-relative path.
 *
 * Returns { problems, skills, agents } where skills/agents are the counts actually
 * walked, so the caller can enforce the floors against a real or fixture tree.
 */
export function auditPlane(io) {
  const problems = [];

  const skillDirs = io.listSkills();
  for (const name of skillDirs.slice().sort()) {
    const rel = `${SKILLS_DIR}/${name}/SKILL.md`;
    let body;
    try {
      body = io.read(rel);
    } catch (err) {
      problems.push(`${rel}: unreadable (${err.message}) — a skill the harness loads but this gate cannot open`);
      continue;
    }
    const fm = frontmatter(body);
    if (!fm) {
      problems.push(`${rel}: no YAML frontmatter — the harness selects a skill by its metadata, and there is none`);
      continue;
    }
    if (!fm.name || fm.name.trim() === "") {
      problems.push(`${rel}: frontmatter has no non-empty \`name\` — an unnamed skill cannot be addressed`);
    } else if (fm.name.trim() !== name) {
      problems.push(`${rel}: frontmatter \`name: ${fm.name.trim()}\` disagrees with its directory \`${name}\` — a skill that reads as one thing and is filed as another`);
    }
    if (!fm.description || fm.description.trim() === "") {
      problems.push(`${rel}: frontmatter has no non-empty \`description\` — the model has nothing to trigger on`);
    }
  }

  const agentFiles = io.listAgents();
  for (const file of agentFiles.slice().sort()) {
    const rel = `${AGENTS_DIR}/${file}`;
    const id = file.replace(/\.md$/, "");
    let body;
    try {
      body = io.read(rel);
    } catch (err) {
      problems.push(`${rel}: unreadable (${err.message}) — a dispatchable agent this gate cannot open`);
      continue;
    }
    const fm = frontmatter(body);
    if (!fm) {
      problems.push(`${rel}: no YAML frontmatter — the harness cannot dispatch it`);
      continue;
    }
    if (!fm.name || fm.name.trim() === "") {
      problems.push(`${rel}: frontmatter has no non-empty \`name\``);
    } else if (fm.name.trim() !== id) {
      problems.push(`${rel}: frontmatter \`name: ${fm.name.trim()}\` disagrees with its filename \`${id}\``);
    }
    if (!fm.description || fm.description.trim() === "") {
      problems.push(`${rel}: frontmatter has no non-empty \`description\` — an agent whose job nobody wrote down cannot be selected for it`);
    }
  }

  return { problems, skills: skillDirs.length, agents: agentFiles.length };
}

// The real disk reader.
const diskIo = {
  listSkills: () => {
    const dir = join(repo, SKILLS_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => d.name);
  },
  listAgents: () => {
    const dir = join(repo, AGENTS_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  },
  read: (rel) => readFileSync(join(repo, rel), "utf8"),
};

function selfTest() {
  const checks = [];

  // One COMPLETE fixture; every negative is this minus exactly the field under
  // test, so the negatives stay negative as the shape grows.
  const good = "---\nname: good\ndescription: does a thing\n---\nbody";
  const skills = new Map([
    [`${SKILLS_DIR}/good/SKILL.md`, good],
    [`${SKILLS_DIR}/nodesc/SKILL.md`, "---\nname: nodesc\n---\nbody"],
    [`${SKILLS_DIR}/mismatch/SKILL.md`, "---\nname: something-else\ndescription: d\n---\nbody"],
    [`${SKILLS_DIR}/nofm/SKILL.md`, "no frontmatter here"],
  ]);
  const agents = new Map([
    [`${AGENTS_DIR}/good.md`, good],
    [`${AGENTS_DIR}/noname.md`, "---\ndescription: d\n---\nbody"],
  ]);
  const fio = {
    listSkills: () => ["good", "nodesc", "mismatch", "nofm"],
    listAgents: () => ["good.md", "noname.md"],
    read: (rel) => {
      if (skills.has(rel)) return skills.get(rel);
      if (agents.has(rel)) return agents.get(rel);
      throw new Error(`ENOENT ${rel}`);
    },
  };

  const r = auditPlane(fio);
  const has = (sub) => r.problems.some((p) => p.includes(sub));

  checks.push(["a well-formed skill raises no problem", !r.problems.some((p) => p.includes("good/SKILL.md"))]);
  checks.push(["a skill missing `description` is RED", has("nodesc/SKILL.md") && has("no non-empty `description`")]);
  checks.push(["a skill whose name disagrees with its directory is RED", has("mismatch/SKILL.md") && has("disagrees with its directory")]);
  checks.push(["a skill with no frontmatter is RED", has("nofm/SKILL.md") && has("no YAML frontmatter")]);
  checks.push(["a well-formed agent raises no problem", !r.problems.some((p) => p.includes("good.md"))]);
  checks.push(["an agent missing `name` is RED", has("noname.md") && has("no non-empty `name`")]);
  // The counts the floors are checked against are the walked counts, not a guess.
  checks.push(["the audit reports how many it actually walked", r.skills === 4 && r.agents === 2]);

  // FLOORS against the REAL tree: a walk that resolved nothing would make every
  // per-member check vacuous, which is the pass this gate exists to refuse.
  const live = auditPlane(diskIo);
  checks.push([`the real skills walk clears its floor (${live.skills} ≥ ${SKILL_FLOOR})`, live.skills >= SKILL_FLOOR]);
  checks.push([`the real agents walk clears its floor (${live.agents} ≥ ${AGENT_FLOOR})`, live.agents >= AGENT_FLOOR]);
  checks.push(["the real tree is itself conformant — the gate is green about a real plane, not only a fixture", live.problems.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());

if (runAsCli) {
  const { problems, skills, agents } = auditPlane(diskIo);
  console.log(`Skill-plane conformance — ${skills} skill(s), ${agents} agent(s) walked\n`);

  let fatal = [...problems];
  if (skills < SKILL_FLOOR) {
    fatal.push(`only ${skills} skill(s) walked (floor ${SKILL_FLOOR}) — the .claude/skills walk is not reaching the tree it is meant to cover`);
  }
  if (agents < AGENT_FLOOR) {
    fatal.push(`only ${agents} agent(s) walked (floor ${AGENT_FLOOR}) — the .claude/agents walk is not reaching the tree it is meant to cover`);
  }

  if (fatal.length > 0) {
    console.error("Skill-plane conformance FAILED:");
    for (const p of fatal) console.error(`  ✗ ${p}`);
    console.error(
      "\nEvery skill and agent the harness loads must carry the `name` and `description` it is\n" +
        "selected by, and a `name` that matches its own directory/filename. Fix the front matter\n" +
        "at the path named; do not exempt it.",
    );
    process.exit(1);
  }

  console.log("Skill-plane conformance passed — every skill and agent carries a name that matches its home and a non-empty description.");
}
