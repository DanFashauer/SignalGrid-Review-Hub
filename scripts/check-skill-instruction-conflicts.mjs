// check-skill-instruction-conflicts — a skill may not instruct Claude to run a
// command the Bash deny-list hook refuses.
//
//   node scripts/check-skill-instruction-conflicts.mjs             the gate
//   node scripts/check-skill-instruction-conflicts.mjs --self-test prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// `.claude/hooks/block-dangerous.sh` is a PreToolUse hook: it reads the Bash tool
// call Claude Code is about to make and answers `permissionDecision:"deny"` for a
// forbidden pattern. `.claude/skills/` holds 14 vendored upstream skills plus 12
// first-party ones (`.claude/skills/VENDORED.md` counts them), and a skill is a
// procedure Claude is told to FOLLOW. When a skill's numbered step is a command
// the hook denies, the two halves of the agent plane contradict each other: the
// instruction says do it, the hook says you may not. What happens then is not a
// clean stop — it is a session that reaches step 6 of a documented procedure and
// cannot complete it, and the documented recovery is to work around the hook,
// which CLAUDE.md forbids in the same breath ("Never bypass a check").
//
// Three such sites were in the tree the day this gate was written, and none of
// them was noticed by anything:
//
//   finishing-a-development-branch/SKILL.md   `git branch -D <feature-branch>`
//                                             — a ```bash step, denied outright
//   subagent-driven-development/SKILL.md      `rm -rf <workspace>` — the cleanup
//                                             step of the whole workflow
//   brainstorming/scripts/stop-server.sh      `rm -rf "$SESSION_DIR"` — a line in
//                                             a shell script a skill tells Claude
//                                             to run
//
// `scripts/check-hook-denylist.mjs` already holds `.claude/settings.json` and the
// hook to each other. Nothing held the SKILLS to the hook.
//
// WHAT IS GATED (unambiguous only)
// --------------------------------
// A candidate command that the hook, ASKED DIRECTLY, answers `deny` to, and whose
// `path:line` is not named in the `## Overrides` table of
// `.claude/skills/VENDORED.md`. Candidates are:
//
//   1. Every non-blank, non-comment line inside a ```bash / ```sh / ```shell /
//      ```console fence in any tracked file under `.claude/skills/`. A leading
//      `$ ` or `% ` shell prompt is stripped first. A line whose first non-space
//      character is `#` is a shell comment: it does not execute, so it is not an
//      invocation.
//   2. Every inline `code` span in prose, UNLESS the enclosing paragraph is a
//      MENTION (below).
//   3. Every non-blank, non-comment line of a tracked file that begins with a
//      `#!` shebang naming a shell. Those are scripts a skill hands to Claude to
//      run; the whole file is invocation, not documentation. Detected from the
//      file's own first line, never from a list of names.
//
// THE MENTION RULE — the gate must not punish honest writing
// ----------------------------------------------------------
// The repository has three recorded cases of a gate flagging a TRUE sentence: copy
// that correctly said "not evaluated today", a page carrying a proper scope
// disclaimer, and a list of phrases a seller must AVOID flagged for containing
// them. This gate walks straight into the third of those: `stack-reference/git-ci.md`
// is a whole document whose purpose is to NAME the commands the hook refuses, and
// `stack-reference/SKILL.md` line 35 opens "Banned and ask-first are not
// suggestions." followed by the banned commands in backticks. Flagging those would
// be the gate being wrong, not the docs.
//
// So an inline span is a MENTION, not an invocation, when its enclosing PARAGRAPH
// (the run of contiguous non-blank prose lines around it, not merely the physical
// line — the idiom wraps, and `stack-reference/SKILL.md:36` carries three banned
// spans on the continuation of a sentence whose warning word is on line 35)
// contains any of, case-insensitively:
//
//   never · don't / don’t · do not · doesn't · forbidden · hazard · avoid ·
//   banned · deny / denies / denied (this is how "hook-denied" is written here) ·
//   refuse / refuses / refused · must not · not allowed · ask-first ·
//   **SAYS** (the stack-reference idiom: "the generic cheatsheet SAYS this, and
//   here is why it BREAKS here")
//
// The rule applies to inline spans ONLY. A line inside a ```bash fence is a step
// to execute; a warning word elsewhere in the prose around it does not make it
// stop executing. Widening the exemption to fences is how a gate stops catching
// the thing it exists for.
//
// WHAT IS NOT GATED — said out loud
// ---------------------------------
//   · The hook's own coverage. This gate retypes NOTHING from the pattern list;
//     it spawns `bash .claude/hooks/block-dangerous.sh` with the same stdin JSON
//     Claude Code sends and reads the answer. A pattern the hook misses (one
//     assembled from a variable, one split across a here-doc — the hook says so
//     itself) is missed here too, by construction. That is deliberate: a second
//     copy of the pattern list is the fossil `check-hook-denylist.mjs` exists to
//     prevent.
//   · Placeholder-ness. `rm -rf <workspace>` is judged as written. The hook denies
//     it, so it is flagged; whether the author meant a literal or a template is a
//     judgement, and the release valve for a judgement is an Overrides row with a
//     reason, not a heuristic in here.
//   · Non-shell executable content. A `.js` / `.ts` / `.cjs` file under skills is
//     read with the markdown rules (fences and backtick spans) — backticks in JS
//     are template literals, not code spans, so those files contribute noise-free
//     nothing in practice, and a dangerous `child_process` call inside one is NOT
//     seen. Only `#!`-shell files get the whole-file treatment.
//   · Whether an Overrides row is JUSTIFIED. The table is trusted; only its
//     existence and shape are read.
//   · Whether an Overrides row is STALE. Deliberately NOT reported. That table is
//     the general record of every vendored instruction that does not apply here —
//     "commit your work", "npm test", an Unsplash fetch — and only a handful of
//     its rows are deny-list conflicts at all (2 of 22 on 2026-09-06). Reporting
//     the other 20 as fossils would be this gate being wrong about writing that is
//     entirely correct, which is the failure mode this repository has hit three
//     times in one day.
//   · Multi-site and glob rows. A first cell naming several sites at once
//     (`server.cjs:106-112, :247-249`) or a brace glob (`test-pressure-{1,2,3}.md:3`)
//     does NOT parse, and therefore grants NO exemption. A path segment may not
//     contain a colon. If a deny-list conflict needs exempting, give it its own row
//     with a single `path:line` or `path:line-line`.
//
// SCOPE IS DERIVED, NEVER LISTED. The file set is `git ls-files .claude/skills` —
// tracked paths only, because only tracked paths publish and only tracked paths
// load for another clone. Nothing here names a skill directory.
//
// FAIL-CLOSED. A hook that cannot be spawned, that exits non-zero, or that answers
// something this gate cannot parse is FATAL, not a skip: the whole judgement rests
// on that one subprocess, and an unreadable answer is the loosest state it has.
// Two live probes run BEFORE the scan on every invocation — one command the hook
// must deny and one it must allow — so a hook that has been neutered cannot let
// this gate print a green summary about nothing.
//
// FLOORS. Fewer than 20 tracked skill files, or fewer than 200 JUDGEABLE
// candidates, and the gate REFUSES rather than reporting zero: that is the
// derivation having drifted, not the tree having got clean. Measured 2026-09-06:
// 73 files, 1066 judged, 1527 further inline spans read as mentions. Do not retype
// those numbers anywhere — the summary line prints the current ones.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = ".claude/hooks/block-dangerous.sh";
const SKILLS_DIR = ".claude/skills";
const VENDORED = ".claude/skills/VENDORED.md";

const FILE_FLOOR = 20;
const CANDIDATE_FLOOR = 200;
const CONCURRENCY = 8;

const FENCE_LANGS = new Set(["bash", "sh", "shell", "console"]);

// Each term below is here because a real line in this tree needed it. See the
// MENTION RULE block in the header for the sites.
export const MENTION_RE =
  /\bnever\b|\bdon['’]t\b|\bdo not\b|\bdoesn['’]t\b|\bforbidden\b|\bhazard\w*\b|\bavoid\w*\b|\bbanned\b|\bden(?:y|ies|ied)\b|\brefus(?:e|es|ed)\b|\bmust not\b|\bnot allowed\b|\bask-first\b|\*\*SAYS\*\*/i;

const SHEBANG_SHELL_RE = /^#!.*\b(?:ba|z|da|k)?sh\b/;
const PROMPT_RE = /^[$%]\s+/;

// ── candidate extraction (pure) ──────────────────────────────────────────────

/**
 * Every Bash INVOCATION a file instructs Claude to run.
 * @param {string} text file contents
 * @returns {{line:number, kind:"fence"|"inline"|"script", lang:string|null,
 *            command:string, source:string, mention:boolean}[]}
 */
export function extractCandidates(text) {
  const lines = text.split("\n");

  // A shell script is invocation top to bottom; markdown rules do not apply.
  if (SHEBANG_SHELL_RE.test(lines[0] ?? "")) {
    const out = [];
    lines.forEach((line, i) => {
      const body = line.trim();
      if (!body || body.startsWith("#")) return;
      out.push({ line: i + 1, kind: "script", lang: "sh", command: body, source: line, mention: false });
    });
    return out;
  }

  // Pass 1 — which lines are fence markers, and which fence (if any) each line
  // is inside. A closing marker is the same character, at least as long, and
  // carries no info string; that keeps a ```` ```` ```` wrapper around a ```bash
  // block from closing on the inner fence.
  const fenceLang = new Array(lines.length).fill(null);
  const isMarker = new Array(lines.length).fill(false);
  let open = null;
  lines.forEach((line, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (m) {
      const char = m[1][0];
      const len = m[1].length;
      const info = m[2].toLowerCase();
      if (open === null) {
        open = { char, len, lang: info };
        isMarker[i] = true;
        return;
      }
      if (char === open.char && len >= open.len && info === "") {
        open = null;
        isMarker[i] = true;
        return;
      }
    }
    if (open !== null) fenceLang[i] = open.lang;
  });

  // Pass 2 — paragraphs: maximal runs of contiguous non-blank prose lines.
  const paragraphs = [];
  let start = null;
  for (let i = 0; i <= lines.length; i += 1) {
    const isProse = i < lines.length && fenceLang[i] === null && !isMarker[i] && lines[i].trim() !== "";
    if (isProse) {
      if (start === null) start = i;
      continue;
    }
    if (start !== null) {
      paragraphs.push({ startLine: start, text: lines.slice(start, i).join("\n") });
      start = null;
    }
  }

  const out = [];

  // Pass 3a — fenced steps, line by line.
  lines.forEach((line, i) => {
    if (isMarker[i]) return;
    const lang = fenceLang[i];
    if (lang === null || !FENCE_LANGS.has(lang)) return;
    const body = line.trim().replace(PROMPT_RE, "");
    if (!body || body.startsWith("#")) return;
    out.push({ line: i + 1, kind: "fence", lang, command: body, source: line, mention: false });
  });

  // Pass 3b — inline spans, paired across the WHOLE paragraph rather than per
  // line. A span may wrap (`git push origin --delete\n   <branch>`), and pairing
  // per line leaves an odd backtick behind that desynchronises every later span
  // on that line — which is how `git-ci.md:47`'s `git branch -D` was invisible to
  // the first version of this gate. The span is attributed to the line it OPENS
  // on, and its internal newline+indent is collapsed to one space (the hook
  // collapses whitespace itself, so this only changes what is printed).
  for (const p of paragraphs) {
    const mention = MENTION_RE.test(p.text);
    for (const m of p.text.matchAll(/`([^`]+)`/g)) {
      const body = m[1].replace(/\s+/g, " ").trim().replace(PROMPT_RE, "");
      if (!body) continue;
      const line = p.startLine + p.text.slice(0, m.index).split("\n").length;
      out.push({ line, kind: "inline", lang: null, command: body, source: lines[line - 1] ?? "", mention });
    }
  }

  out.sort((a, b) => a.line - b.line);
  return out;
}

// ── the Overrides table (pure) ───────────────────────────────────────────────

/**
 * Rows of the `## Overrides` table in VENDORED.md whose first cell is a backticked
 * `path:line` or `path:line-line`, path relative to `.claude/skills/`. The section
 * is optional; absent means no overrides, not an error.
 * @param {string} vendoredText
 * @returns {{present:boolean, entries:{path:string,start:number,end:number,raw:string}[]}}
 */
export function parseOverrides(vendoredText) {
  const lines = vendoredText.split("\n").map((l) => l.replace(/^\s*>\s?/, ""));
  const head = lines.findIndex((l) => /^#{2,}\s+Overrides\b/i.test(l));
  if (head === -1) return { present: false, entries: [] };
  const entries = [];
  for (let i = head + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+\S/.test(lines[i])) break;
    const row = lines[i].trim();
    if (!row.startsWith("|")) continue;
    const first = row.split("|")[1]?.trim() ?? "";
    const code = /^`([^`]+)`$/.exec(first);
    if (!code) continue;
    // A path segment may not contain a colon, so a multi-site cell
    // (`a.md:1, :2`) does not parse and grants nothing. See the header.
    const site = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(code[1].trim());
    if (!site) continue;
    entries.push({
      path: site[1].replace(/^\.?\/*/, ""),
      start: Number(site[2]),
      end: site[3] ? Number(site[3]) : Number(site[2]),
      raw: code[1].trim(),
    });
  }
  return { present: true, entries };
}

/** Does an Overrides entry cover this site? Paths are relative to .claude/skills/. */
export function isOverridden(entries, relPathFromSkills, line) {
  return entries.some((e) => e.path === relPathFromSkills && line >= e.start && line <= e.end);
}

// ── asking the hook (impure, fail-closed) ────────────────────────────────────

class HookFatal extends Error {}

/** One PreToolUse call, shaped exactly as Claude Code sends it. */
function askHook(hookPath, command) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [hookPath], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => reject(new HookFatal(`could not execute ${hookPath}: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new HookFatal(`${hookPath} exited ${code} judging ${JSON.stringify(command)} — stderr: ${stderr.trim()}`));
        return;
      }
      const raw = stdout.trim();
      if (raw === "") {
        resolvePromise(false);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new HookFatal(`${hookPath} answered something this gate cannot parse as JSON: ${raw.slice(0, 200)}`));
        return;
      }
      const decision = parsed?.hookSpecificOutput?.permissionDecision;
      if (decision === "deny") resolvePromise(true);
      else if (decision === undefined || decision === "allow") resolvePromise(false);
      else reject(new HookFatal(`${hookPath} answered permissionDecision=${JSON.stringify(decision)}, which this gate cannot judge`));
    });
    child.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
  });
}

/** Judge many commands, deduplicated, with a small pool. Map<command, boolean>. */
export async function judgeAll(hookPath, commands) {
  const unique = [...new Set(commands)];
  const verdict = new Map();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= unique.length) return;
      verdict.set(unique[i], await askHook(hookPath, unique[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length || 1) }, worker));
  return verdict;
}

/**
 * The live capability probes. A hook that no longer denies what it must, or that
 * denies a harmless command, cannot be used to judge anything.
 */
async function proveHookWorks(hookPath) {
  const mustDeny = "rm -" + "rf /tmp/signalgrid-gate-probe";
  const mustAllow = "echo signalgrid-gate-probe";
  if (!(await askHook(hookPath, mustDeny))) {
    throw new HookFatal(`${hookPath} did NOT deny ${JSON.stringify(mustDeny)} — the deny list cannot be used to judge skills.`);
  }
  if (await askHook(hookPath, mustAllow)) {
    throw new HookFatal(`${hookPath} denied the harmless probe ${JSON.stringify(mustAllow)} — every candidate would look denied.`);
  }
}

// ── the scan ─────────────────────────────────────────────────────────────────

function trackedSkillFiles() {
  const out = execFileSync("git", ["ls-files", "--", SKILLS_DIR], { cwd: repo, encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{path:string, text:string}[]} files paths repo-relative
 * @param {Map<string, boolean>|((c:string)=>boolean)} verdict
 * @param {{path:string,start:number,end:number,raw:string}[]} overrides
 */
export function collect(files, verdict, overrides) {
  const deniedFor = typeof verdict === "function" ? verdict : (c) => verdict.get(c) === true;
  const findings = [];
  const overriddenHits = [];
  const mentionsDenied = [];
  let judged = 0;
  let mentions = 0;
  for (const f of files) {
    const rel = f.path.startsWith(`${SKILLS_DIR}/`) ? f.path.slice(SKILLS_DIR.length + 1) : f.path;
    for (const c of extractCandidates(f.text)) {
      const hit = { file: f.path, rel, ...c };
      if (c.mention) {
        mentions += 1;
        // What the mention exemption COSTS, made visible rather than invisible:
        // a span the hook would deny, suppressed because its paragraph warns
        // against it. If this list ever stops looking like documentation, the
        // exemption is too wide.
        if (deniedFor(c.command)) mentionsDenied.push(hit);
        continue;
      }
      judged += 1;
      if (!deniedFor(c.command)) continue;
      if (isOverridden(overrides, rel, c.line)) overriddenHits.push(hit);
      else findings.push(hit);
    }
  }
  return { findings, overriddenHits, mentionsDenied, judged, mentions };
}

async function run() {
  const hookPath = resolve(repo, HOOK);
  if (!existsSync(hookPath)) {
    console.error(`✗ ${HOOK} is missing — there is no deny list to hold the skills to, which is the loosest state this can be in.`);
    process.exit(1);
  }
  await proveHookWorks(hookPath);

  const paths = trackedSkillFiles();
  if (paths.length < FILE_FLOOR) {
    console.error(`✗ only ${paths.length} tracked files under ${SKILLS_DIR}/ (floor ${FILE_FLOOR}) — the derivation drifted; refusing to report a clean scan of almost nothing.`);
    process.exit(1);
  }
  const files = paths.map((p) => ({ path: p, text: readFileSync(resolve(repo, p), "utf8") }));

  const allCandidates = files.flatMap((f) => extractCandidates(f.text));
  const judgeable = allCandidates.filter((c) => !c.mention);
  if (judgeable.length < CANDIDATE_FLOOR) {
    console.error(`✗ only ${judgeable.length} candidate invocations found (floor ${CANDIDATE_FLOOR}) across ${paths.length} files — the fence/inline parse drifted; refusing to conclude.`);
    process.exit(1);
  }

  const vendoredPath = resolve(repo, VENDORED);
  const overrides = existsSync(vendoredPath)
    ? parseOverrides(readFileSync(vendoredPath, "utf8"))
    : { present: false, entries: [] };

  // Mentions are judged too — not to gate them, but so the cost of the exemption
  // is a printed number instead of an invisible one.
  const verdict = await judgeAll(hookPath, allCandidates.map((c) => c.command));
  const { findings, overriddenHits, mentionsDenied, judged, mentions } = collect(files, verdict, overrides.entries);

  console.log(
    `skill↔deny-list: ${files.length} files, ${judged} candidates judged, ` +
      `${findings.length + overriddenHits.length} denied, ${overriddenHits.length} overridden ` +
      `(${mentions} inline spans read as mentions, not invocations; ` +
      `Overrides section ${overrides.present ? `present, ${overrides.entries.length} parsed row(s)` : "absent"})`,
  );

  for (const h of overriddenHits) {
    console.log(`  overridden: ${h.file}:${h.line}  ${h.command}`);
  }
  if (mentionsDenied.length > 0) {
    console.log(`  REPORTED, never gated — ${mentionsDenied.length} span(s) the hook WOULD deny, exempted because the surrounding paragraph warns against them:`);
    for (const h of mentionsDenied) console.log(`    ${h.file}:${h.line}  ${h.command}`);
  }

  if (findings.length > 0) {
    console.error(`✗ ${findings.length} skill instruction(s) the Bash deny list refuses:`);
    for (const h of findings) {
      console.error(`  ${h.file}:${h.line}  [${h.kind}${h.lang ? `:${h.lang}` : ""}]  ${h.command}`);
    }
    console.error("");
    console.error(`  Each is a step Claude is told to take and is then denied at PreToolUse.`);
    console.error(`  Fix the skill, or add a row to the \`## Overrides\` table in ${VENDORED}`);
    console.error(`  whose first cell is the backticked path:line (path relative to ${SKILLS_DIR}/) and`);
    console.error(`  whose remaining cells say why the conflict is acceptable.`);
    process.exit(1);
  }
  console.log("✓ no tracked skill instructs a command the deny list refuses.");
}

// ── self-test ────────────────────────────────────────────────────────────────
// Both directions, against the REAL hook: a planted invocation must be flagged,
// the same string in prose must not, an overridden site must not, an unusable
// hook must be fatal, and a too-small scope must refuse.

async function selfTest() {
  const hookPath = resolve(repo, HOOK);
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  };

  if (!existsSync(hookPath)) {
    console.error(`  ✗ ${HOOK} is missing; the self-test cannot run against the real hook.`);
    process.exit(1);
  }

  const BAD = "rm -" + "rf x";

  // 1. planted invocation inside a bash fence → flagged
  const planted = ["# Fixture", "", "Run the cleanup step:", "", "```bash", BAD, "```", ""].join("\n");
  // 2. the same string in a "never run" prose line → not flagged
  const prose = ["# Fixture", "", `Never run \`${BAD}\` here; it destroys the workspace.`, ""].join("\n");
  // 3. the wrapped-mention idiom this repo actually writes
  const wrapped = [
    "# Fixture",
    "",
    "2. **Banned and ask-first are not suggestions.** `git reset --hard`, `git stash`",
    "   (all forms), `--no-verify`, `--force` — each is hook-denied.",
    "",
  ].join("\n");

  const files = [
    { path: `${SKILLS_DIR}/fixture/planted.md`, text: planted },
    { path: `${SKILLS_DIR}/fixture/prose.md`, text: prose },
    { path: `${SKILLS_DIR}/fixture/wrapped.md`, text: wrapped },
  ];
  const cands = files.flatMap((f) => extractCandidates(f.text));
  const verdict = await judgeAll(hookPath, cands.map((c) => c.command));

  const noOverride = collect(files, verdict, []);
  check(
    "a planted invocation inside a ```bash fence is FLAGGED",
    noOverride.findings.length === 1 &&
      noOverride.findings[0].file.endsWith("planted.md") &&
      noOverride.findings[0].line === 6,
    `got ${JSON.stringify(noOverride.findings.map((f) => `${f.file}:${f.line}`))}`,
  );
  check(
    'the same string in a "never run `…`" prose line is NOT flagged',
    !noOverride.findings.some((f) => f.file.endsWith("prose.md")),
  );
  check(
    "the wrapped Banned/hook-denied idiom is NOT flagged, including its continuation line",
    !noOverride.findings.some((f) => f.file.endsWith("wrapped.md")),
    `got ${JSON.stringify(noOverride.findings.filter((f) => f.file.endsWith("wrapped.md")).map((f) => `${f.file}:${f.line} ${f.command}`))}`,
  );
  // The exemption must be doing real work, not passing because the spans were
  // harmless: at least one suppressed span on EACH line must be one the hook
  // genuinely denies — line 3 (where the warning word is) and line 4 (the
  // continuation, which carries no warning word of its own).
  const wrappedMentionLines = new Set(
    noOverride.mentionsDenied.filter((h) => h.file.endsWith("wrapped.md")).map((h) => h.line),
  );
  check(
    "the mention exemption is suppressing spans the hook really denies, on the warning line AND its continuation",
    wrappedMentionLines.has(3) && wrappedMentionLines.has(4),
    `denied-but-exempted lines: ${JSON.stringify([...wrappedMentionLines])}`,
  );

  // 4. the same planted site, overridden → not flagged, and counted as overridden
  const withOverride = collect(files, verdict, [{ path: "fixture/planted.md", start: 6, end: 6, raw: "fixture/planted.md:6" }]);
  check(
    "an overridden site is NOT flagged and is counted as overridden",
    withOverride.findings.length === 0 && withOverride.overriddenHits.length === 1,
    `findings=${withOverride.findings.length} overridden=${withOverride.overriddenHits.length}`,
  );
  const rangeOverride = collect(files, verdict, [{ path: "fixture/planted.md", start: 1, end: 20, raw: "fixture/planted.md:1-20" }]);
  check("a path:line-line RANGE override covers the site", rangeOverride.findings.length === 0);

  // 5. the Overrides table parser, both shapes and the absent case
  const table = [
    "## Overrides",
    "",
    "| Site | Why |",
    "| --- | --- |",
    "| `finishing-a-development-branch/SKILL.md:156` | vendored, upstream |",
    "| `subagent-driven-development/SKILL.md:480-490` | vendored, upstream |",
    "| not-backticked/SKILL.md:1 | ignored |",
    "",
    "## Something else",
    "| `never/parsed.md:9` | past the section |",
  ].join("\n");
  const parsed = parseOverrides(table);
  check(
    "parseOverrides reads path:line and path:line-line, ignores unbackticked rows, stops at the next heading",
    parsed.present &&
      parsed.entries.length === 2 &&
      parsed.entries[0].start === 156 &&
      parsed.entries[0].end === 156 &&
      parsed.entries[1].start === 480 &&
      parsed.entries[1].end === 490,
    JSON.stringify(parsed),
  );
  check("an absent ## Overrides section parses as absent, not as an error", parseOverrides("# Vendored\n\nno table here\n").present === false);

  // 6. a #!-shell file is invocation top to bottom; its comments are not
  const script = ["#!/usr/bin/env bash", "set -euo pipefail", `# ${BAD}   <- a comment, not a step`, BAD, ""].join("\n");
  const scriptCands = extractCandidates(script).filter((c) => !c.mention);
  const scriptVerdict = await judgeAll(hookPath, scriptCands.map((c) => c.command));
  const scriptHits = collect([{ path: `${SKILLS_DIR}/fixture/s.sh`, text: script }], scriptVerdict, []);
  check(
    "a #!-shell file flags the executable line and NOT the commented one",
    scriptHits.findings.length === 1 && scriptHits.findings[0].line === 4,
    `got ${JSON.stringify(scriptHits.findings.map((f) => `${f.file}:${f.line}`))}`,
  );

  // 7. a hook that cannot be executed is FATAL, never a silent pass
  let fatal = false;
  try {
    await askHook(resolve(repo, ".claude/hooks/does-not-exist.sh"), "echo hi");
  } catch (e) {
    fatal = e instanceof HookFatal;
  }
  check("a hook that cannot be executed is FATAL (fail-closed), not an allow", fatal);

  // 8. plant/remove against the REAL tree: the real files plus one planted fence
  //    must yield exactly one MORE finding than the real files alone.
  const realPaths = trackedSkillFiles();
  const realFiles = realPaths.map((p) => ({ path: p, text: readFileSync(resolve(repo, p), "utf8") }));
  const realCands = realFiles.flatMap((f) => extractCandidates(f.text)).filter((c) => !c.mention);
  const realVerdict = await judgeAll(hookPath, realCands.map((c) => c.command));
  const before = collect(realFiles, realVerdict, []).findings.length;
  const victim = realFiles.find((f) => f.path.endsWith("/SKILL.md"));
  const plantedFiles = realFiles.map((f) =>
    f === victim ? { path: f.path, text: `${f.text}\n\`\`\`bash\n${BAD}\n\`\`\`\n` } : f,
  );
  const plantedCands = plantedFiles.flatMap((f) => extractCandidates(f.text)).filter((c) => !c.mention);
  const plantedVerdict = await judgeAll(hookPath, plantedCands.map((c) => c.command));
  const after = collect(plantedFiles, plantedVerdict, []).findings.length;
  check(
    `planting one denied step into a real skill adds exactly one finding (${before} → ${after})`,
    after === before + 1,
  );

  // 9. the floors refuse rather than reporting zero
  check("the file floor is above a trivially-small scope", FILE_FLOOR >= 20 && CANDIDATE_FLOOR >= 200);
  check(
    "the live scope clears both floors today",
    realPaths.length >= FILE_FLOOR && realCands.length >= CANDIDATE_FLOOR,
    `files=${realPaths.length} candidates=${realCands.length}`,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`self-test: ${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

const isSelfTest = process.argv.includes("--self-test");
try {
  if (isSelfTest) await selfTest();
  else await run();
} catch (e) {
  if (e instanceof HookFatal) {
    console.error(`✗ FATAL — ${e.message}`);
    console.error("  This gate judges by asking the hook; an unusable hook is a failure, never a skip.");
    process.exit(1);
  }
  throw e;
}
