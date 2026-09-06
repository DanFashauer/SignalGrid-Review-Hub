// check-gitignore-producers — everything a vendored skill can create inside this
// repository must be ignored by the TRACKED ignore files.
//
//   node scripts/check-gitignore-producers.mjs             the gate
//   node scripts/check-gitignore-producers.mjs --self-test prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// `artifacts/sim-results/*.json` carry `provenance.workingTreeClean`, and
// `scripts/mac/run-requests.mjs` derives it from `git status --porcelain` being
// empty — UNTRACKED FILES INCLUDED. So a single untracked directory left behind by
// one run does not merely add clutter: it stamps every LATER Mac-lane result as
// minted from a dirty tree, and provenance is the product. CLAUDE.md records this
// happening twice already — `native/ios/build/` (~97MB of untracked xcodebuild
// output; the android twin had been ignored and the iOS one simply had not) and
// `.obsidian/`, ignored ahead of the first vault rather than after the first bad
// stamp.
//
// `.claude/skills/` holds 14 vendored third-party skills. Several of them WRITE
// INTO THE REPOSITORY ROOT as a documented step, and none of those paths was in
// the tracked `.gitignore` when this gate was written. One of them,
// `.claude/worktrees/`, was ignored only through `.git/info/exclude` — a file that
// lives inside `.git/`, is never committed, and therefore does not exist in a
// fresh clone or on a CI runner. It looked ignored on the one machine that had
// been set up by hand, and was not ignored anywhere else.
//
// WHAT IS GATED (unambiguous only)
// --------------------------------
// For each producer path below, and for a `diagrams/` path under EVERY tracked
// skill directory: `git check-ignore` must answer "ignored" when it is given ONLY
// the ignore files this repository tracks. Nothing else is judged — not whether
// the path exists, not whether the skill should be writing there.
//
// READING ONLY THE TRACKED IGNORE FILES — the part that needed care
// ----------------------------------------------------------------
// `git check-ignore` consults three sources at once: the `.gitignore` files in the
// work tree, `$GIT_DIR/info/exclude`, and `core.excludesFile`. There is NO flag
// that turns the last two off — `--no-index` is about the index, not about which
// exclude files are read — and running it here would answer "ignored" for
// `.claude/worktrees/` on this machine and "not ignored" on a fresh clone, which
// is the exact drift being gated. Verified by experiment on 2026-09-06: with
// `excluded-here` in `.git/info/exclude` and nothing in `.gitignore`,
// `git check-ignore --no-index -v --non-matching --stdin` printed
// `.git/info/exclude:1:excluded-here  excluded-here/x`.
//
// So the check runs against a PRISTINE HARNESS instead: a throwaway `git init` in
// a temp directory, its own `info/exclude` truncated to empty, `core.excludesFile`
// pinned LOCALLY at an empty file (local beats global, so the machine's global
// excludes cannot reach in), and every tracked `.gitignore` in this repo copied in
// at its own relative path (there are 7, not 1 — `native/ios/`, `native/android/`
// and four others carry their own). That is real git matching semantics over
// exactly the file set a fresh clone gets, and nothing else.
//
// Said plainly, because a gate must not overclaim: git offers NO switch that turns
// `$GIT_DIR/info/exclude` off, so what the harness buys is not immunity but a
// clean start — it is created empty on every run and nothing except buildHarness
// writes to it. The self-test asserts that emptiness directly rather than
// pretending a plant would be refused.
//
// Three controls run on the harness before any producer is judged: a path the
// tracked rules DO ignore must come back ignored, a path nothing ignores must come
// back not-ignored, and a path that only THIS repository's `.git/info/exclude`
// covers must come back NOT ignored — that last one fails loudly if the harness
// ever ends up resolving against the real repository instead of itself.
//
// WHAT IS NOT GATED — said out loud
// ---------------------------------
//   · The producer list is a documented CONSTANT, not a derivation, and that is a
//     deliberate exception to the house rule. What a third-party skill writes is
//     not something the build knows; it is read out of vendored source by a person.
//     What IS derived, and gated, is that the list has not fossilised: every entry
//     cites the `file:line` that produces it, and the gate FAILS if that line no
//     longer contains the cited text. A citation that has drifted means the
//     vendored code moved and the list must be re-read — the gate refuses to keep
//     answering from a stale note. (The `diagrams/` probe set IS derived, from
//     `git ls-files .claude/skills`, so a skill directory added tomorrow is probed
//     the day it lands.)
//   · Whether an ignore rule is TOO WIDE. A rule that also hides something wanted
//     is a judgement, not a fact, and is not decided here.
//   · Paths a skill writes OUTSIDE the repository (`/tmp`, `$TMPDIR`, the session
//     scratchpad). Those never reach `git status`, which is the whole point of the
//     skills that use them.
//   · Ignore rules in `.git/info/exclude`. Excluded on purpose — see above. A path
//     that is ignored only there is a FINDING here, not a pass.
//
// FLOORS. Fewer than 5 producers, fewer than 20 derived skill-directory probes, or
// fewer than 30 ignore patterns copied into the harness, and the gate REFUSES
// rather than reporting clean.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = ".claude/skills";

const PRODUCER_FLOOR = 5;
const SKILL_DIR_FLOOR = 20;
const PATTERN_FLOOR = 30;

/**
 * Paths a vendored skill can create INSIDE this repository, each with the
 * `file:line` in the vendored source that produces it. `needle` is the text that
 * must still be on that line; if it is not, the vendored code has moved and this
 * list is stale — which is fatal, not ignorable.
 */
export const PRODUCERS = [
  {
    probe: ".superpowers/x",
    what: "the brainstorming mockup server's session directory, when launched with --project-dir",
    sites: [
      { path: `${SKILLS_DIR}/brainstorming/visual-companion.md`, line: 58, needle: ".superpowers/" },
      { path: `${SKILLS_DIR}/brainstorming/scripts/start-server.sh`, line: 117, needle: ".superpowers/brainstorm/" },
      { path: `${SKILLS_DIR}/subagent-driven-development/scripts/sdd-workspace`, line: 36, needle: ".superpowers/sdd" },
    ],
  },
  {
    probe: ".worktrees/x",
    what: "the default project-local worktree root",
    sites: [{ path: `${SKILLS_DIR}/using-git-worktrees/SKILL.md`, line: 76, needle: ".worktrees/" }],
  },
  {
    probe: "worktrees/x",
    what: "the non-hidden alternative the same skill probes for and will use if it exists",
    sites: [{ path: `${SKILLS_DIR}/using-git-worktrees/SKILL.md`, line: 72, needle: "ls -d worktrees" }],
  },
  {
    probe: `${SKILLS_DIR}/writing-plans/diagrams/x`,
    what: "rendered graphviz output, written next to any SKILL.md that carries ```dot blocks",
    sites: [{ path: `${SKILLS_DIR}/writing-skills/render-graphs.js`, line: 131, needle: "'diagrams'" }],
  },
  {
    probe: ".claude/worktrees/x",
    what: "the agent harness's worktree root — ignored ONLY by .git/info/exclude until this gate",
    sites: [{ path: `${SKILLS_DIR}/stack-reference/ai-cli.md`, line: 77, needle: ".claude/worktrees/" }],
  },
];

// ── the pristine harness ─────────────────────────────────────────────────────

/** Every tracked ignore file in this repository, path → contents. */
export function trackedIgnoreFiles(root = repo) {
  const listed = execFileSync("git", ["ls-files", "--", ".gitignore", "*/.gitignore", "**/.gitignore"], {
    cwd: root,
    encoding: "utf8",
  });
  const paths = [...new Set(listed.split("\n").map((s) => s.trim()).filter(Boolean))];
  return new Map(paths.map((p) => [p, readFileSync(resolve(root, p), "utf8")]));
}

/** Non-comment, non-blank pattern lines across an ignore-file map. */
export function countPatterns(files) {
  let n = 0;
  for (const text of files.values()) {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) n += 1;
    }
  }
  return n;
}

/**
 * A throwaway repository whose ONLY ignore rules are the given files. Returns the
 * directory; the caller removes it.
 * @param {Map<string,string>} files relative path → contents
 */
export function buildHarness(files) {
  const dir = mkdtempSync(join(tmpdir(), "sg-ignore-harness-"));
  const init = spawnSync("git", ["init", "-q", "."], { cwd: dir, encoding: "utf8" });
  if (init.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not git init the ignore harness: ${init.stderr || init.stdout}`);
  }
  // git's template writes a commented sample into info/exclude; truncate it so the
  // harness cannot inherit anything, and neutralise the user's global excludes.
  writeFileSync(join(dir, ".git", "info", "exclude"), "");
  writeFileSync(join(dir, ".git", "empty-excludes"), "");
  spawnSync("git", ["config", "core.excludesFile", join(dir, ".git", "empty-excludes")], { cwd: dir });
  for (const [rel, text] of files) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return dir;
}

/**
 * Ask git which of these paths the harness ignores.
 * @returns {Map<string, string|null>} path → the `source:line:pattern` that ignored
 *   it, or null when nothing did.
 */
export function checkIgnored(harnessDir, paths, env = undefined) {
  const r = spawnSync(
    "git",
    ["check-ignore", "--no-index", "-v", "--non-matching", "--stdin"],
    { cwd: harnessDir, encoding: "utf8", input: `${paths.join("\n")}\n`, env: env ? { ...process.env, ...env } : process.env },
  );
  // 0 = at least one match, 1 = no matches; anything else is git failing.
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git check-ignore failed in the harness (status ${r.status}): ${r.stderr || r.stdout}`);
  }
  const out = new Map(paths.map((p) => [p, null]));
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const rule = line.slice(0, tab);
    const path = line.slice(tab + 1);
    out.set(path, rule === "::" ? null : rule);
  }
  if (out.size !== paths.length || [...out.keys()].some((k) => !paths.includes(k))) {
    throw new Error("git check-ignore did not answer for exactly the paths it was asked about");
  }
  return out;
}

// ── controls: the harness must be reading what we think it is ────────────────

/**
 * A path that THIS repository's `.git/info/exclude` ignores and its tracked
 * `.gitignore` files do not — the sharpest available proof that the harness is not
 * resolving against the real repository. Returns null when there is no such path
 * (a fresh clone, or CI), which is reported, not fatal.
 */
export function infoExcludeOnlyProbe(root = repo) {
  const excludePath = resolve(root, ".git/info/exclude");
  if (!existsSync(excludePath)) return null;
  const candidates = readFileSync(excludePath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => {
      const bare = l.replace(/^\*\*\//, "").replace(/^\//, "");
      if (bare.includes("*") || bare.includes("?") || bare.includes("[")) return null;
      return bare.endsWith("/") ? `${bare}x` : bare;
    })
    .filter(Boolean);
  for (const p of candidates) {
    const real = spawnSync("git", ["check-ignore", "-q", "--no-index", "--", p], { cwd: root });
    if (real.status === 0) return p;
  }
  return null;
}

function runControls(harnessDir, notes) {
  // 1. Something the tracked rules really do ignore. Derived, not typed: the first
  //    directory pattern in the root .gitignore.
  const root = readFileSync(resolve(repo, ".gitignore"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("!") && !l.includes("*") && l.endsWith("/"));
  if (!root) throw new Error("no plain directory pattern found in .gitignore to use as the positive control");
  const positive = `${root.replace(/^\//, "")}x`;
  // 2. Something nothing ignores.
  const negative = "sg-harness-control-not-ignored-anywhere.txt";
  // 3. Something only THIS repo's .git/info/exclude covers.
  const infoOnly = infoExcludeOnlyProbe();

  const probes = [positive, negative, ...(infoOnly ? [infoOnly] : [])];
  const answers = checkIgnored(harnessDir, probes);
  if (answers.get(positive) === null) {
    throw new Error(`harness control FAILED: ${positive} is ignored by the tracked .gitignore but the harness says it is not — the tracked ignore files did not reach the harness.`);
  }
  if (answers.get(negative) !== null) {
    throw new Error(`harness control FAILED: ${negative} is ignored by nothing, yet the harness matched ${answers.get(negative)} — the harness answers "ignored" to anything.`);
  }
  if (infoOnly) {
    if (answers.get(infoOnly) !== null) {
      throw new Error(`harness control FAILED: ${infoOnly} is ignored only by this repository's .git/info/exclude, yet the harness matched ${answers.get(infoOnly)} — the harness is resolving against the real repository, not itself.`);
    }
    notes.push(`control: ${infoOnly} is ignored here only via .git/info/exclude and is correctly NOT ignored in the harness`);
  } else {
    notes.push("control: no .git/info/exclude-only path available to probe (fresh clone or CI) — that one control did not run");
  }
  notes.push(`control: ${positive} ignored by ${answers.get(positive)}; ${negative} ignored by nothing`);
}

// ── citations must not fossilise ─────────────────────────────────────────────

export function checkCitations(producers, root = repo) {
  const broken = [];
  for (const p of producers) {
    for (const s of p.sites) {
      const abs = resolve(root, s.path);
      if (!existsSync(abs)) {
        broken.push(`${s.path}:${s.line} — file does not exist (cited as producing ${p.probe})`);
        continue;
      }
      const line = readFileSync(abs, "utf8").split("\n")[s.line - 1];
      if (line === undefined || !line.includes(s.needle)) {
        broken.push(
          `${s.path}:${s.line} — no longer contains ${JSON.stringify(s.needle)} (cited as producing ${p.probe}); found ${JSON.stringify((line ?? "<past end of file>").trim().slice(0, 90))}`,
        );
      }
    }
  }
  return broken;
}

// ── derived probes ───────────────────────────────────────────────────────────

/** Every tracked top-level skill directory, from git — never a hand list. */
export function trackedSkillDirs(root = repo) {
  const listed = execFileSync("git", ["ls-files", "--", SKILLS_DIR], { cwd: root, encoding: "utf8" });
  const dirs = new Set();
  for (const p of listed.split("\n")) {
    const parts = p.trim().split("/");
    if (parts.length > 3 && parts[0] === ".claude" && parts[1] === "skills") dirs.add(`${SKILLS_DIR}/${parts[2]}`);
  }
  return [...dirs].sort();
}

// ── main ─────────────────────────────────────────────────────────────────────

function run() {
  if (PRODUCERS.length < PRODUCER_FLOOR) {
    console.error(`✗ only ${PRODUCERS.length} producers listed (floor ${PRODUCER_FLOOR}) — refusing to report clean.`);
    process.exit(1);
  }

  const broken = checkCitations(PRODUCERS);
  if (broken.length > 0) {
    console.error(`✗ ${broken.length} producer citation(s) no longer match the vendored source — the list is stale and this gate refuses to answer from it:`);
    for (const b of broken) console.error(`  ${b}`);
    console.error("  Re-read the vendored file, correct the file:line and needle in PRODUCERS, and re-run.");
    process.exit(1);
  }

  const skillDirs = trackedSkillDirs();
  if (skillDirs.length < SKILL_DIR_FLOOR) {
    console.error(`✗ only ${skillDirs.length} tracked skill directories found (floor ${SKILL_DIR_FLOOR}) — the derivation drifted; refusing to conclude.`);
    process.exit(1);
  }

  const ignoreFiles = trackedIgnoreFiles();
  const patterns = countPatterns(ignoreFiles);
  if (patterns < PATTERN_FLOOR) {
    console.error(`✗ only ${patterns} ignore patterns across ${ignoreFiles.size} tracked ignore file(s) (floor ${PATTERN_FLOOR}) — refusing to conclude.`);
    process.exit(1);
  }

  const notes = [];
  const harness = buildHarness(ignoreFiles);
  let missing;
  try {
    runControls(harness, notes);
    const derived = skillDirs.map((d) => `${d}/diagrams/x`);
    const probes = [...new Set([...PRODUCERS.map((p) => p.probe), ...derived])];
    const answers = checkIgnored(harness, probes);
    missing = probes.filter((p) => answers.get(p) === null);
    console.log(
      `gitignore↔skill producers: ${PRODUCERS.length} listed producers + ${derived.length} derived diagrams/ probes ` +
        `checked against ${patterns} patterns from ${ignoreFiles.size} tracked ignore file(s) in a pristine harness; ` +
        `${probes.length - missing.length}/${probes.length} ignored`,
    );
    for (const n of notes) console.log(`  ${n}`);
  } finally {
    rmSync(harness, { recursive: true, force: true });
  }

  if (missing.length > 0) {
    console.error(`✗ ${missing.length} path(s) a vendored skill can create are NOT ignored by the tracked ignore files:`);
    const listedMisses = missing.filter((p) => PRODUCERS.some((x) => x.probe === p));
    const derivedMisses = missing.filter((p) => !PRODUCERS.some((x) => x.probe === p));
    for (const p of listedMisses) {
      const src = PRODUCERS.find((x) => x.probe === p);
      console.error(`  ${p}  — ${src.what}`);
      for (const s of src.sites) console.error(`      produced at ${s.path}:${s.line}`);
    }
    if (derivedMisses.length > 0) {
      console.error(`  ${derivedMisses.length} derived diagrams/ path(s), rendered by ${SKILLS_DIR}/writing-skills/render-graphs.js:131 next to any SKILL.md carrying \`\`\`dot blocks:`);
      for (const p of derivedMisses.slice(0, 5)) console.error(`      ${p}`);
      if (derivedMisses.length > 5) console.error(`      … and ${derivedMisses.length - 5} more (one per tracked skill directory)`);
    }
    console.error("");
    console.error("  Untracked leftovers make `git status --porcelain` non-empty, which is exactly how");
    console.error("  scripts/mac/run-requests.mjs derives provenance.workingTreeClean — so one of these");
    console.error("  stamps every LATER sim result as minted from a dirty tree. Add the rule to .gitignore");
    console.error("  (the TRACKED file; .git/info/exclude does not exist in a fresh clone or on CI).");
    process.exit(1);
  }
  console.log("✓ every listed and derived skill-produced path is ignored by the tracked ignore files alone.");
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  };

  const probes = PRODUCERS.map((p) => p.probe);

  // 1. A fixture ignore text carrying every producer → nothing flagged.
  const complete = new Map([[
    ".gitignore",
    ["node_modules", ".superpowers/", "/.worktrees/", "/worktrees/", "/.claude/skills/*/diagrams/", "**/.claude/worktrees/"].join("\n"),
  ]]);
  let h = buildHarness(complete);
  try {
    const a = checkIgnored(h, probes);
    check("a fixture .gitignore carrying every producer flags nothing", probes.every((p) => a.get(p) !== null), JSON.stringify([...a]));
  } finally {
    rmSync(h, { recursive: true, force: true });
  }

  // 2. THE PLANT: the same fixture with ONE producer's rule removed → that one, and
  //    only that one, is flagged. Run for every producer in turn, so no entry can be
  //    passing by accident.
  const rules = [".superpowers/", "/.worktrees/", "/worktrees/", "/.claude/skills/*/diagrams/", "**/.claude/worktrees/"];
  let plantOk = true;
  const plantDetail = [];
  for (let i = 0; i < probes.length; i += 1) {
    const text = ["node_modules", ...rules.filter((_, j) => j !== i)].join("\n");
    const dir = buildHarness(new Map([[".gitignore", text]]));
    try {
      const a = checkIgnored(dir, probes);
      const flagged = probes.filter((p) => a.get(p) === null);
      if (flagged.length !== 1 || flagged[0] !== probes[i]) {
        plantOk = false;
        plantDetail.push(`removing ${rules[i]} flagged ${JSON.stringify(flagged)}, expected [${probes[i]}]`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  check(`removing each producer's rule in turn flags exactly that producer (${probes.length} plants)`, plantOk, plantDetail.join("; "));

  // 3. The harness starts from nothing but the files handed to it. git offers no
  //    switch to turn `$GIT_DIR/info/exclude` off — a pattern written into the
  //    harness's own exclude file after it is built IS honoured, and this test
  //    asserts that rather than pretending otherwise. What the harness buys is that
  //    it is created empty every run and nothing but buildHarness writes to it.
  h = buildHarness(new Map([[".gitignore", "node_modules\n"]]));
  try {
    const excludeText = readFileSync(join(h, ".git", "info", "exclude"), "utf8");
    check("the harness's own .git/info/exclude is emptied at build time", excludeText === "", JSON.stringify(excludeText.slice(0, 80)));

    // A GLOBAL core.excludesFile must not reach it: the harness pins the setting
    // locally, and local beats global.
    const globalDir = mkdtempSync(join(tmpdir(), "sg-ignore-global-"));
    writeFileSync(join(globalDir, "ignore"), "globally-excluded/\n");
    writeFileSync(join(globalDir, "gitconfig"), `[core]\n\texcludesFile = ${join(globalDir, "ignore")}\n`);
    const a = checkIgnored(h, ["node_modules/x", "globally-excluded/x", "plain.txt"], {
      GIT_CONFIG_GLOBAL: join(globalDir, "gitconfig"),
      HOME: globalDir,
    });
    rmSync(globalDir, { recursive: true, force: true });

    check("the harness honours the tracked rules it was given", a.get("node_modules/x") !== null);
    check(
      "a machine-global core.excludesFile is NOT honoured inside the harness",
      a.get("globally-excluded/x") === null,
      `matched ${a.get("globally-excluded/x")}`,
    );
    check("an unmatched path comes back not-ignored", a.get("plain.txt") === null);
  } finally {
    rmSync(h, { recursive: true, force: true });
  }

  // 4. A drifted citation is FATAL, not ignorable.
  const drifted = checkCitations([
    { probe: "x/y", what: "fixture", sites: [{ path: ".gitignore", line: 1, needle: "this-text-is-not-on-line-1" }] },
  ]);
  check("a citation whose line no longer carries its needle is reported broken", drifted.length === 1, JSON.stringify(drifted));
  check("the live citations all still match the vendored source", checkCitations(PRODUCERS).length === 0, JSON.stringify(checkCitations(PRODUCERS)));

  // 5. The floors, and that the live scope clears them.
  const dirs = trackedSkillDirs();
  const files = trackedIgnoreFiles();
  check(
    "the live scope clears every floor",
    PRODUCERS.length >= PRODUCER_FLOOR && dirs.length >= SKILL_DIR_FLOOR && countPatterns(files) >= PATTERN_FLOOR,
    `producers=${PRODUCERS.length} skillDirs=${dirs.length} patterns=${countPatterns(files)} ignoreFiles=${files.size}`,
  );
  check(
    "more than one tracked ignore file is collected (a single-file harness would be wrong)",
    files.size > 1,
    `${files.size} file(s): ${[...files.keys()].join(", ")}`,
  );

  const failed = results.filter((r) => !r).length;
  console.log(`self-test: ${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (process.argv.includes("--self-test")) selfTest();
else run();
