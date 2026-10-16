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
//   4. Every `.claude/commands/*.md` slash command has YAML frontmatter with a
//      non-empty `description` — the line the harness lists it by. (A command has
//      no `name` field; its filename stem is the name.) Added 2026-09-30: the
//      prompt-master scan counted 12 tracked commands no gate looked at.
//   5. FLOORS. The skills, agents and commands walks each reach at least a floor of
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

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = ".claude/skills";
const AGENTS_DIR = ".claude/agents";
const COMMANDS_DIR = ".claude/commands";
/** The tiers DR-047 lets an agent name. Fable and Mythos are deliberately absent. */
const AGENT_MODELS = new Set(["haiku", "sonnet", "opus"]);

// Floors below today's real counts (26 skills, 13 agents on 2026-09-06 — the comment
// said 24 while the tree held 26, which is why the summary line, not this sentence, is
// the number to read: every run prints the current pair) but far above zero, so a
// broken walk fails loudly rather than passing over an empty result. The point of a
// floor is to catch a walk that reaches nothing, not to pin a total that a routine
// deletion would trip — a pinned total silently turns a legitimate removal into a
// regression, the mistake CLAUDE.md warns about for the proof suite.
const SKILL_FLOOR = 10;
const AGENT_FLOOR = 5;
const COMMAND_FLOOR = 5;

/**
 * A plain YAML scalar as the harness would read it: a trailing `# comment` is
 * dropped (outside quotes), one layer of quotes removed, whitespace trimmed, and
 * YAML's empty spellings — `~`, `null`, `!!null`, `[]`, `{}` — read as "".
 * `"  "`, `# todo` and `!!null` were each counted as a description until the
 * second Brain review on #1272.
 */
export function yamlScalar(raw) {
  let v = String(raw).trim();
  const q = v[0];
  if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) {
    v = v.slice(1, v.lastIndexOf(q));
  } else {
    v = v.replace(/(^|\s)#.*$/, "$1");
  }
  v = v.trim();
  if (/^(?:~|null|Null|NULL|!!null(?:\s.*)?|\[\s*\]|\{\s*\})$/.test(v)) return "";
  return v;
}

/**
 * Parse the leading `--- … ---` YAML block into a flat key→value map, or null.
 * A block scalar (`|`, `>`, with chomping/indent modifiers) takes its indented
 * continuation lines as its value, so `description: >` followed by nothing is
 * empty rather than the literal `>`. YAML's empty spellings — `""`, `''`, `~`,
 * `null` — read as empty, never as a description (Brain review on #1272).
 */
export function frontmatter(body) {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // A block scalar's body is literal text (a `#` in it is not a comment); only
    // a plain one-line value goes through the scalar cleanup.
    if (/^[|>][+-]?\d*[+-]?(?:\s+#.*)?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      value = block.join(" ").trim();
    } else {
      value = yamlScalar(value);
    }
    out[kv[1]] = value;
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
    const id = basename(file).replace(/\.md$/, "");
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
    // DR-047: every agent names its own tier, and only an engineering tier.
    // The record's own Consequences paragraph called this gate a follow-up;
    // it landed 2026-09-19 (the "five weekend projects" intake row).
    const model = (fm.model ?? "").trim();
    if (model === "") {
      problems.push(`${rel}: frontmatter has no \`model\` — DR-047 says a spawn names its tier, never inherits the coordinator's`);
    } else if (!AGENT_MODELS.has(model)) {
      problems.push(`${rel}: frontmatter \`model: ${model}\` is not one of ${[...AGENT_MODELS].join("|")} — DR-047 keeps Fable/Mythos off every engineering and review stage`);
    }
  }

  const commandFiles = io.listCommands();
  for (const file of commandFiles.slice().sort()) {
    const rel = `${COMMANDS_DIR}/${file}`;
    let body;
    try {
      body = io.read(rel);
    } catch (err) {
      problems.push(`${rel}: unreadable (${err.message}) — a slash command the harness lists but this gate cannot open`);
      continue;
    }
    const fm = frontmatter(body);
    if (!fm) {
      problems.push(`${rel}: no YAML frontmatter — a slash command with no \`description\` is listed with nothing to say what it does`);
      continue;
    }
    if (!fm.description || fm.description.trim() === "") {
      problems.push(`${rel}: frontmatter has no non-empty \`description\` — nobody notices until a person types it`);
    }
  }

  return { problems, skills: skillDirs.length, agents: agentFiles.length, commands: commandFiles.length };
}

// The real disk reader.
/** A recursive `.md` listing under `dir`, as forward-slash paths relative to it. */
const listMdRecursive = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .map((f) => String(f).split("\\").join("/"))
        .filter((f) => f.endsWith(".md"))
    : [];

/** The disk reader rooted at `root` — the real repo, or a planted temp tree in the self-test. */
const diskIoAt = (root) => ({
  listSkills: () => {
    const dir = join(root, SKILLS_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => d.name);
  },
  // Recursive, both: a namespaced agent or command (`ns/x.md`) is still one.
  listAgents: () => listMdRecursive(join(root, AGENTS_DIR)),
  listCommands: () => listMdRecursive(join(root, COMMANDS_DIR)),
  read: (rel) => readFileSync(join(root, rel), "utf8"),
});
const diskIo = diskIoAt(repo);

function selfTest() {
  const checks = [];

  // One COMPLETE fixture; every negative is this minus exactly the field under
  // test, so the negatives stay negative as the shape grows.
  const good = "---\nname: good\ndescription: does a thing\n---\nbody";
  const goodAgent = "---\nname: good\ndescription: does a thing\nmodel: sonnet\n---\nbody";
  const skills = new Map([
    [`${SKILLS_DIR}/good/SKILL.md`, good],
    [`${SKILLS_DIR}/nodesc/SKILL.md`, "---\nname: nodesc\n---\nbody"],
    [`${SKILLS_DIR}/mismatch/SKILL.md`, "---\nname: something-else\ndescription: d\n---\nbody"],
    [`${SKILLS_DIR}/nofm/SKILL.md`, "no frontmatter here"],
  ]);
  const agents = new Map([
    [`${AGENTS_DIR}/good.md`, goodAgent],
    [`${AGENTS_DIR}/noname.md`, "---\ndescription: d\nmodel: sonnet\n---\nbody"],
    [`${AGENTS_DIR}/nomodel.md`, "---\nname: nomodel\ndescription: d\n---\nbody"],
    [`${AGENTS_DIR}/fable.md`, "---\nname: fable\ndescription: d\nmodel: fable\n---\nbody"],
    // DR-047's own headline failure: a spawn that inherits the coordinator's model.
    [`${AGENTS_DIR}/inherits.md`, "---\nname: inherits\ndescription: d\nmodel: inherit\n---\nbody"],
  ]);
  const commands = new Map([
    [`${COMMANDS_DIR}/good-cmd.md`, "---\ndescription: does a thing\nargument-hint: [x]\n---\nbody"],
    [`${COMMANDS_DIR}/nodesc-cmd.md`, "---\nargument-hint: [x]\n---\nbody"],
    [`${COMMANDS_DIR}/blank-cmd.md`, "---\ndescription:\n---\nbody"],
    [`${COMMANDS_DIR}/nofm-cmd.md`, "just a prompt, no frontmatter"],
    [`${COMMANDS_DIR}/quoted-empty-cmd.md`, '---\ndescription: ""\n---\nbody'],
    [`${COMMANDS_DIR}/tilde-cmd.md`, "---\ndescription: ~\n---\nbody"],
    [`${COMMANDS_DIR}/null-cmd.md`, "---\ndescription: null\n---\nbody"],
    [`${COMMANDS_DIR}/empty-block-cmd.md`, "---\ndescription: >\nargument-hint: [x]\n---\nbody"],
    [`${COMMANDS_DIR}/block-cmd.md`, "---\ndescription: |\n  does a thing\n  over two lines\n---\nbody"],
    [`${COMMANDS_DIR}/ns/nested-cmd.md`, "---\nargument-hint: [x]\n---\nbody"],
    [`${COMMANDS_DIR}/spaces-cmd.md`, '---\ndescription: "  "\n---\nbody'],
    [`${COMMANDS_DIR}/sq-spaces-cmd.md`, "---\ndescription: '  '\n---\nbody"],
    [`${COMMANDS_DIR}/comment-cmd.md`, "---\ndescription: # todo\n---\nbody"],
    [`${COMMANDS_DIR}/bangnull-cmd.md`, "---\ndescription: !!null\n---\nbody"],
    [`${COMMANDS_DIR}/list-cmd.md`, "---\ndescription: []\n---\nbody"],
    [`${COMMANDS_DIR}/map-cmd.md`, "---\ndescription: {}\n---\nbody"],
    [`${COMMANDS_DIR}/hash-in-text-cmd.md`, '---\ndescription: "the #1 pass"\n---\nbody'],
    [`${COMMANDS_DIR}/hash-in-block-cmd.md`, "---\ndescription: > # folded\n  #1 pass, not a comment\n---\nbody"],
  ]);
  const fio = {
    listSkills: () => ["good", "nodesc", "mismatch", "nofm"],
    listAgents: () => ["good.md", "noname.md", "nomodel.md", "fable.md", "inherits.md"],
    listCommands: () => [...commands.keys()].map((k) => k.slice(COMMANDS_DIR.length + 1)),
    read: (rel) => {
      if (skills.has(rel)) return skills.get(rel);
      if (agents.has(rel)) return agents.get(rel);
      if (commands.has(rel)) return commands.get(rel);
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
  checks.push(["an agent missing `model` is RED (DR-047)", has("nomodel.md") && has("has no `model`")]);
  checks.push(["an agent naming a non-engineering tier is RED (DR-047)", has("fable.md") && has("is not one of")]);
  checks.push(["an agent that INHERITS (`model: inherit`) is RED (DR-047) — the failure the record was written after", has("inherits.md") && r.problems.some((p) => p.includes("inherits.md") && p.includes("model: inherit"))]);
  checks.push(["a well-formed command raises no problem", !r.problems.some((p) => p.includes("good-cmd.md"))]);
  checks.push(["a command missing `description` is RED", r.problems.some((p) => p.includes("nodesc-cmd.md") && p.includes("no non-empty `description`"))]);
  checks.push(["a command with an empty `description` is RED", r.problems.some((p) => p.includes("blank-cmd.md") && p.includes("no non-empty `description`"))]);
  checks.push(["a command with no frontmatter is RED", r.problems.some((p) => p.includes("nofm-cmd.md") && p.includes("no YAML frontmatter"))]);
  for (const f of ["quoted-empty-cmd", "tilde-cmd", "null-cmd", "empty-block-cmd", "spaces-cmd", "sq-spaces-cmd", "comment-cmd", "bangnull-cmd", "list-cmd", "map-cmd"]) {
    checks.push([`a YAML-empty description (${f}) is RED, not present`, r.problems.some((p) => p.includes(`${f}.md`) && p.includes("no non-empty `description`"))]);
  }
  checks.push(["a block-scalar description with content is present", !r.problems.some((p) => p.includes("block-cmd.md") && !p.includes("empty-block"))]);
  checks.push(["a quoted description containing `#` is present (a `#` inside quotes is not a comment)", !r.problems.some((p) => p.includes("hash-in-text-cmd.md"))]);
  checks.push(["a block-scalar description starting with `#` is present (a block body is text)", !r.problems.some((p) => p.includes("hash-in-block-cmd.md"))]);
  checks.push(["a namespaced command (ns/x.md) is walked and RED without a description", r.problems.some((p) => p.includes("ns/nested-cmd.md"))]);
  // The counts the floors are checked against are the walked counts, not a guess.
  checks.push(["the audit reports how many it actually walked", r.skills === 4 && r.agents === 5 && r.commands === 18]);

  // The REAL disk walker, not the injected one: plant a namespaced agent and command
  // in a temp tree and read it back through diskIoAt. The injected fixture above
  // cannot catch a walker that stopped recursing.
  const tmp = mkdtempSync(join(tmpdir(), "skill-plane-"));
  try {
    mkdirSync(join(tmp, COMMANDS_DIR, "ns"), { recursive: true });
    mkdirSync(join(tmp, AGENTS_DIR, "ns"), { recursive: true });
    writeFileSync(join(tmp, COMMANDS_DIR, "ns", "zz.md"), "---\nargument-hint: [x]\n---\nbody");
    writeFileSync(join(tmp, AGENTS_DIR, "ns", "zz.md"), "---\nname: zz\ndescription: d\nmodel: fable\n---\nbody");
    const walked = auditPlane(diskIoAt(tmp));
    checks.push(["the real disk walker reaches a namespaced command and turns it RED", walked.commands === 1 && walked.problems.some((p) => p.includes(`${COMMANDS_DIR}/ns/zz.md`))]);
    checks.push(["the real disk walker reaches a namespaced agent and holds it to DR-047", walked.agents === 1 && walked.problems.some((p) => p.includes(`${AGENTS_DIR}/ns/zz.md`) && p.includes("is not one of"))]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // FLOORS against the REAL tree: a walk that resolved nothing would make every
  // per-member check vacuous, which is the pass this gate exists to refuse.
  const live = auditPlane(diskIo);
  checks.push([`the real skills walk clears its floor (${live.skills} ≥ ${SKILL_FLOOR})`, live.skills >= SKILL_FLOOR]);
  checks.push([`the real agents walk clears its floor (${live.agents} ≥ ${AGENT_FLOOR})`, live.agents >= AGENT_FLOOR]);
  checks.push([`the real commands walk clears its floor (${live.commands} ≥ ${COMMAND_FLOOR})`, live.commands >= COMMAND_FLOOR]);
  checks.push(["the real tree is itself conformant — the gate is green about a real plane, not only a fixture", live.problems.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());

if (runAsCli) {
  const { problems, skills, agents, commands } = auditPlane(diskIo);
  console.log(`Skill-plane conformance — ${skills} skill(s), ${agents} agent(s), ${commands} command(s) walked\n`);

  let fatal = [...problems];
  if (skills < SKILL_FLOOR) {
    fatal.push(`only ${skills} skill(s) walked (floor ${SKILL_FLOOR}) — the .claude/skills walk is not reaching the tree it is meant to cover`);
  }
  if (agents < AGENT_FLOOR) {
    fatal.push(`only ${agents} agent(s) walked (floor ${AGENT_FLOOR}) — the .claude/agents walk is not reaching the tree it is meant to cover`);
  }
  if (commands < COMMAND_FLOOR) {
    fatal.push(`only ${commands} command(s) walked (floor ${COMMAND_FLOOR}) — the .claude/commands walk is not reaching the tree it is meant to cover`);
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

  console.log("Skill-plane conformance passed — every skill and agent carries a name that matches its home and a non-empty description, and every slash command a description.");
}
