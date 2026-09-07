// Plugin-manifest gate — the SignalGrid plugin manifest must name exactly the
// components the tree actually ships, and it must validate.
//
//   node scripts/check-plugin-manifest.mjs             # the gate
//   node scripts/check-plugin-manifest.mjs --self-test # the detector, both directions
//
// WHY THIS EXISTS. `.claude-plugin/plugin.json` (DR-030) packages this repository's
// operating plane as a Claude Code plugin. Its `agents` field must be a list of file
// paths, not a directory — the loader rejects a directory there — so the manifest
// carries a HAND-LIST of agents beside a directory that is the real source. That is the
// exact "hand-list claimed derived" shape this repo has been bitten by: add an agent to
// `.claude/agents/` and the manifest silently ships without it. So the list is GATED
// against the directory rather than trusted.
//
// WHAT IS GATED (all fatal):
//   1. name === "signalgrid".
//   2. `agents` equals the tracked set `git ls-files .claude/agents/*.md`, exactly —
//      no missing file, no extra, each path present on disk. Empty derivation fails
//      (fail-closed: a vanished directory is a defect, not a pass).
//   3. `skills` and `commands` resolve to directories that exist and are non-empty;
//      every skill subdir has a SKILL.md.
//   4. Every path in the manifest is relative, starts with "./", and exists.
//   5. When the `claude` CLI is on PATH, `claude plugin validate .` exits 0. When it is
//      not, that is REPORTED, never silently green — the structural checks above still
//      run and still gate.
//
// SCOPE IS DERIVED: the agent set comes from `git ls-files`, so a new agent joins the
// check the moment it is tracked; an untracked scratch file cannot widen or narrow it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(repoRoot, ".claude-plugin", "plugin.json");

function trackedAgents(root) {
  const out = execFileSync("git", ["ls-files", ".claude/agents/*.md"], {
    cwd: root,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => "./" + p)
    .sort();
}

// Pure detector: given a parsed manifest and the derived agent list, return the list of
// violation strings. Both the live gate and the self-test drive this one function.
function findViolations(manifest, derivedAgents, root) {
  const v = [];
  if (manifest.name !== "signalgrid") {
    v.push(`name is ${JSON.stringify(manifest.name)}, expected "signalgrid"`);
  }

  if (derivedAgents.length === 0) {
    v.push("no tracked agents under .claude/agents/*.md — refusing to pass on an empty derivation");
  }
  const declared = Array.isArray(manifest.agents) ? [...manifest.agents].sort() : null;
  if (!declared) {
    v.push("`agents` must be an array of file paths");
  } else {
    const derivedSet = new Set(derivedAgents);
    const declaredSet = new Set(declared);
    for (const a of derivedAgents) {
      if (!declaredSet.has(a)) v.push(`agent shipped in tree but MISSING from manifest: ${a}`);
    }
    for (const a of declared) {
      if (!derivedSet.has(a)) v.push(`agent listed in manifest but NOT a tracked agent file: ${a}`);
    }
  }

  const pathFields = [];
  if (typeof manifest.skills === "string") pathFields.push(["skills", manifest.skills]);
  if (typeof manifest.commands === "string") pathFields.push(["commands", manifest.commands]);
  for (const a of declared || []) pathFields.push(["agents[]", a]);

  for (const [field, p] of pathFields) {
    if (typeof p !== "string" || !p.startsWith("./")) {
      v.push(`${field} path must be relative and start with "./": ${JSON.stringify(p)}`);
      continue;
    }
    if (!existsSync(join(root, p))) v.push(`${field} path does not exist: ${p}`);
  }

  // skills / commands must be non-empty directories; each skill dir needs a SKILL.md.
  const skillsDir = manifest.skills && join(root, manifest.skills);
  if (skillsDir && existsSync(skillsDir)) {
    const subs = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (subs.length === 0) v.push(`skills directory ${manifest.skills} has no skill subdirectories`);
    for (const s of subs) {
      if (!existsSync(join(skillsDir, s.name, "SKILL.md")))
        v.push(`skill ${s.name} has no SKILL.md`);
    }
  }
  const commandsDir = manifest.commands && join(root, manifest.commands);
  if (commandsDir && existsSync(commandsDir)) {
    const md = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    if (md.length === 0) v.push(`commands directory ${manifest.commands} has no .md files`);
  }

  return v;
}

function selfTest() {
  const derived = ["./.claude/agents/a.md", "./.claude/agents/b.md"];
  const base = {
    name: "signalgrid",
    skills: "./.claude/skills/",
    commands: "./.claude/commands/",
    agents: [...derived],
  };
  // The detector needs paths to exist for the existence checks; run the agent-drift
  // arm in isolation by passing a root with no such files and ignoring path-existence
  // violations, which is exactly the drift class we are proving catches.
  const driftViol = (m) =>
    findViolations(m, derived, "/nonexistent-root").filter((s) => /agent /.test(s));

  const clean = driftViol(base);
  if (clean.length !== 0) {
    console.error("SELF-TEST FAIL: complete manifest flagged as drifted:", clean);
    return 1;
  }
  const missing = driftViol({ ...base, agents: ["./.claude/agents/a.md"] });
  if (missing.length === 0) {
    console.error("SELF-TEST FAIL: a manifest missing a shipped agent was not flagged");
    return 1;
  }
  const extra = driftViol({ ...base, agents: [...derived, "./.claude/agents/ghost.md"] });
  if (extra.length === 0) {
    console.error("SELF-TEST FAIL: a manifest naming a non-existent agent was not flagged");
    return 1;
  }
  console.log("plugin-manifest self-test: complete=clean, missing=flagged, extra=flagged — green");
  return 0;
}

function run() {
  if (!existsSync(MANIFEST)) {
    console.error(`Plugin-manifest gate FAILED: ${MANIFEST} not found`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch (e) {
    console.error(`Plugin-manifest gate FAILED: manifest is not valid JSON — ${e.message}`);
    process.exit(1);
  }

  const derived = trackedAgents(repoRoot);
  const violations = findViolations(manifest, derived, repoRoot);

  // claude plugin validate — fatal when the CLI is present and disagrees; reported when absent.
  let cliValidated = false;
  let cliOnPath = true;
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
  } catch {
    cliOnPath = false;
  }
  if (cliOnPath) {
    try {
      execFileSync("claude", ["plugin", "validate", "."], { cwd: repoRoot, stdio: "pipe" });
      cliValidated = true;
    } catch (e) {
      const out = [e.stdout, e.stderr].filter(Boolean).map((b) => b.toString()).join("\n");
      violations.push(`claude plugin validate failed:\n${out.trim()}`);
    }
  }

  if (violations.length > 0) {
    console.error("Plugin-manifest gate FAILED:");
    for (const msg of violations) console.error("  - " + msg);
    process.exit(1);
  }

  console.log(
    `Plugin-manifest gate passed — signalgrid plugin: ${derived.length} agents (derived), ` +
      `skills + commands present; ` +
      (cliValidated
        ? "claude plugin validate exit 0."
        : "claude CLI not on PATH — CLI validation REPORTED as not run (structural checks passed).")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  run();
}
