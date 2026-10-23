#!/usr/bin/env node
// Local-brain capabilities - the Mac's local brain may only rely on a command contract that is true.
//
//   node scripts/check-local-brain-capabilities.mjs              # the gate (writes nothing)
//   node scripts/check-local-brain-capabilities.mjs --write      # regenerate the tables in CAPABILITIES.md (the only writer)
//   node scripts/check-local-brain-capabilities.mjs --self-test  # plant violations; the real contract is the control
//   node scripts/check-local-brain-capabilities.mjs --self-test --fail-fast
//                                                                # stop at the first failure (the mutant harness only needs to know that one exists)
//   node scripts/check-local-brain-capabilities.mjs --contract-json <file> [--contract-md <file>]
//                                                                # validate those files in place of the repository's
//                                                                # (plumbing for the self-test and the mutant harness)
//
// WHY THIS EXISTS (owner, 2026-10-22: "let it leverage whatever we built so when I don't have usage
// and or credits with both Claude and Codex"). The Mac's local brain is an unattended unit that is not
// a Claude session. When neither Claude nor Codex has credits, the only thing standing between it and a
// wrong command is scripts/mac/local-brain/CAPABILITIES.md and its machine twin capabilities.json: which
// commands it may run, under which conditions, which need a cloud model, and which it must never run.
// A contract like that rots the way every hand-kept list in this repository has rotted - a script is
// renamed, a self-test stops being run, a cited line moves, a "never run this" pattern quietly stops
// matching - and a local model cannot tell. So the contract is checked here, on every preflight and CI
// run, and the Markdown tables are rendered from the JSON so the two cannot disagree.
//
// WHAT IS GATED (every rule fails the build; each has planted violations in --self-test):
//   R1-schema      fields, types, a known policy and kind, unique kebab-case names, every policy used,
//                  no newline in a text field and no backtick in a command, an anchors object
//   R2-exists      exists.packageScript is a package.json script (and runs exists.file when both are
//                  named), exists.packageScriptPrefix matches a script, exists.file is tracked,
//                  exists.export is exported by that file; a command row with no exists says why in note;
//                  AND the command TEXT names what exists says, for EVERY program on the line (a chain on
//                  && || ; | &, a subshell, $( ), a `cd` moving the directory later paths are read from):
//                  the first `pnpm run X` is exists.packageScript X (or starts with the prefix), the first
//                  `node|bash|sh P` or `./P` is exists.file P, every further script and file exists too,
//                  and a program the gate cannot check (`pnpm exec tool`, `npx`, anything outside a short
//                  list of system programs) needs a row with exists null and a note; an import or workflow
//                  row names exists.file and its command contains it
//   R3-selftest    a row's selfTest is a step `node scripts/preflight.mjs --list-steps` or
//                  `node scripts/verify-breadth.mjs --list-steps` prints, or a run: line of
//                  .github/workflows/review-hub-ci.yml - a self-test no lane runs keeps nothing honest
//   R4-source      every cited path is tracked, every cited line or range is inside the file, and every
//                  line citation - in a row's source or in the prose of CAPABILITIES.md - has an entry in
//                  capabilities.json "anchors": one text for path:line, { first, last } for path:from-to.
//                  Each text is one line of 12 to 200 characters, appears on exactly ONE line of its file,
//                  and sits on the cited line itself (first on the first cited line, last on the last). So
//                  a citation goes red when a line is inserted or removed at or above its last line,
//                  wherever in the range the edit lands; an anchor nobody cites is a problem
//   R5-flags       cloudModelNeeded exactly when policy is cloud-model; an allowed row is read-only,
//                  writes no tree and nothing remote; an own-worktree row writes nothing remote; an
//                  owner-grant row writes to the network; networkWrites implies needsNetwork
//   R6-forbidden   every forbidden pattern compiles, matches each mustMatch control, matches no
//                  mustNotMatch control, and is exercised by at least one mustMatch control
//   R7-crosscheck  no command or selfTest outside the forbidden rows matches a forbidden command pattern
//   R8-markdown    the generated block of CAPABILITIES.md equals what renderBlock() makes of the JSON;
//                  the file does not start with a byte-order mark
//   R9-figures     no typed count or pass ratio in CAPABILITIES.md outside the generated block, and none
//                  in any text a table shows: a row's command, does, note and selfTest. The headings'
//                  counts are rendered; every other number is a command's output, never a sentence. A
//                  figure is a digit run or a number word, up to two words, then a counted noun from a
//                  fixed list; a noun outside that list is not seen
//   R10-ceilings   the named ceilings below appear word for word in this header, in CAPABILITIES.md and in
//                  the backlog row that files them, so the three cannot drift apart
//
// FAIL-CLOSED. An unreadable or unparseable input, a git or --list-steps spawn that fails, or a
// --list-steps output that is not one JSON array is a problem, never a pass. Problems are sorted, and no
// clock or random value is read, so the same tree always prints the same verdict.
//
// WHAT IT DOES NOT DO, stated so its silence is not read as coverage: it does not run the commands (the
// self-tests it checks are run by the lanes that list them), it does not judge whether a row's words are
// true, and it does not judge that the text an anchor pins supports the sentence that cites it - only that
// the text is still on the line it is cited at. It does not see an edit that keeps a range's first and last
// line where they are and rewords a line between them. Its self-test plants a violation of each check
// listed above and the mutant harness breaks the gate's own source one check at a time, but only for the
// breaks someone wrote; a check nobody mutated can still be missing. COMMANDS.md, the 2026-10-22 survey the
// contract was built from, is not tracked; its agreement with the cloud-model flags was checked once when the
// contract landed.
// CRLF line ends in the JSON, or in the Markdown outside the generated block, are not a problem (CRLF
// inside the block is, through R8). It is registered by two preflight steps and two CI steps and carries no
// package.json alias on purpose, so check-gate-census does not list it; check-gate-self-tests-run and
// check-preflight-ci-parity do.
//
// CEILINGS, named (each one word for word here, in CAPABILITIES.md and in the backlog row that files it):
// Ceiling A: a gate that CI runs but preflight does not list is caught by no gate, because check-preflight-ci-parity checks only the other direction; this is true of every gate on mainline.
// Ceiling B: the forbidden patterns are a floor; a regular expression over a command line cannot see a command assembled at run time, and a command the patterns miss can still be forbidden by its row's words.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommands, stripYamlComments } from "./lib/workflow-invocation.mjs";

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const JSON_PATH = "scripts/mac/local-brain/capabilities.json";
export const MD_PATH = "scripts/mac/local-brain/CAPABILITIES.md";
export const GATE_PATH = "scripts/check-local-brain-capabilities.mjs";
export const BACKLOG_PATH = "docs/BUILD_BACKLOG.md";
export const SCOPE = "scripts/mac/local-brain";
const WORKFLOW = ".github/workflows/review-hub-ci.yml";

export const POLICIES = ["allowed", "own-worktree", "own-worktree-host-lock", "owner-grant", "cloud-model", "forbidden"];
export const KINDS = ["command", "import", "git", "github", "role", "workflow", "seam", "pattern"];
const BOOLS = ["readOnly", "writesTree", "needsNetwork", "networkWrites", "needsToken", "tokenOptional", "macOnly", "cloudModelNeeded"];
// A digit run or number word, up to two words, then a counted noun. A digit run that is part of a line citation
// (after a colon, a hyphen, a dot or another digit) is not a figure.
export const FIGURE_RE = /(?<![:\-\d.])\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+|-)(?:[A-Za-z-]+\s+){0,2}(rows?|commands?|patterns?|entries|tests?|primitives?|gates?|steps?|proofs?|cases?|rules?|regex(?:es)?|days?|hours?|minutes?|violations?|mutants?|controls?|checks?|forms?|tiers?)\b/i;
export const RATIO_RE = /\b\d+\s*\/\s*\d+\b/;
// path:line or path:from-to, anywhere in prose. The extension must start with a letter, so a time or a version is not one.
export const CITE_RE = /[\w.\/-]+\.[A-Za-z][A-Za-z0-9]*:\d+(?:-\d+)?/g;
export const CEILINGS = [
  "Ceiling A: a gate that CI runs but preflight does not list is caught by no gate, because check-preflight-ci-parity checks only the other direction; this is true of every gate on mainline.",
  "Ceiling B: the forbidden patterns are a floor; a regular expression over a command line cannot see a command assembled at run time, and a command the patterns miss can still be forbidden by its row's words.",
];
const ENV_PREFIX = "(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*";
const PNPM_RUN_RE = new RegExp(`^${ENV_PREFIX}pnpm\\s+run\\s+(\\S+)`);
const RUNNER_RE = new RegExp(`^${ENV_PREFIX}(?:node|bash|sh)\\s+(?:-\\S+\\s+)*(\\S+)`);
const DOT_SLASH_RE = new RegExp(`^${ENV_PREFIX}\\./(\\S+)`);
const SCRIPT_FILE_RE = /^[\w.\/-]+\.(?:mjs|cjs|js|sh)$/;

/** Pure: what a command row's text runs, as { script } for `pnpm run X`, { file } for `node|bash|sh P` or `./P`, else null. */
export function commandTarget(command) {
  const c = String(command ?? "").trim();
  let m = PNPM_RUN_RE.exec(c);
  if (m) return { script: m[1] };
  m = DOT_SLASH_RE.exec(c);
  if (m && SCRIPT_FILE_RE.test(m[1])) return { file: m[1] };
  m = RUNNER_RE.exec(c);
  if (m && SCRIPT_FILE_RE.test(m[1])) return { file: m[1] };
  return null;
}

/** System programs a command row may run without the gate checking them: they are not repository files. */
const KNOWN_PROGRAMS = ["git", "gh", "echo", "printf", "cat", "ls", "head", "tail", "grep", "wc", "sort", "uniq", "cut", "tr", "jq", "test", "true", "false"];
/** Package runners whose second word picks what runs: `pnpm exec tool` and `pnpm --filter pkg run X` are not `pnpm run X`. */
const RUNNERS = ["pnpm", "npm", "npx", "yarn", "corepack", "bunx"];

/**
 * Pure: the simple commands one command line runs, in order. It splits on && || ; | & and on the parentheses of a
 * subshell or $( ), never inside quotes; a # comment is dropped; a | with no space beside it is a placeholder
 * alternative (owner|"mac lane"), not a pipe.
 */
export function simpleCommands(command) {
  const s = String(command ?? "");
  const out = [];
  let cur = "";
  let q = null;
  const push = () => { const t = cur.trim(); if (t) out.push(t); cur = ""; };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i], prev = s[i - 1] ?? " ", next = s[i + 1] ?? " ";
    if (q !== null) {
      cur += ch;
      if (ch === "\\" && q === '"' && i + 1 < s.length) { i += 1; cur += s[i]; } else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "#" && /\s/.test(prev)) break;
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) { push(); i += 1; continue; }
    if (ch === ";" || ch === "(" || ch === ")") { push(); continue; }
    if (ch === "|" && (/\s/.test(prev) || /\s/.test(next))) { push(); continue; }
    if (ch === "&" && /\s/.test(prev) && /\s/.test(next)) { push(); continue; }
    cur += ch;
  }
  push();
  return out;
}

/** Pure: a path read from directory cwd ("" is the repository root) as a repository-relative path, or null when it leaves the repository or cannot be known. */
function resolveIn(cwd, p) {
  if (cwd === null || /^[\/~$"']/.test(p)) return null;
  const r = posix.normalize(posix.join(cwd === "" ? "." : cwd, p));
  return r === ".." || r.startsWith("../") || r.startsWith("/") ? null : r === "." ? "" : r;
}

/**
 * Pure: what each simple command of a line runs, in order:
 *   { script }          pnpm run X
 *   { file }            node|bash|sh P or ./P, read from the directory a `cd` moved to
 *   { unresolved }      such a file whose directory cannot be known
 *   { other, known }    any other program; known when it is a system program the gate need not check
 * A `cd DIR` is consumed: it moves the directory the later paths are read from.
 */
export function commandPrograms(command) {
  const out = [];
  let cwd = "";
  for (const seg of simpleCommands(command)) {
    const cd = /^cd\s+(\S+)$/.exec(seg);
    if (cd) { cwd = resolveIn(cwd, cd[1]); continue; }
    const t = commandTarget(seg);
    if (t?.script !== undefined) { out.push({ script: t.script }); continue; }
    if (t?.file !== undefined) {
      const f = resolveIn(cwd, t.file);
      out.push(f === null ? { unresolved: seg } : { file: f });
      continue;
    }
    const words = seg.replace(new RegExp(`^${ENV_PREFIX}`), "").split(/\s+/);
    const first = words[0] ?? "";
    out.push({ other: RUNNERS.includes(first) ? words.slice(0, 2).join(" ") : first, known: KNOWN_PROGRAMS.includes(first) });
  }
  return out;
}

/** Pure: the lines of a text as a reader counts them: a final newline does not start another line. */
export function linesOf(text) {
  const l = String(text).split("\n");
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
}

const LINE_CACHE = new Map();
/** linesOf, remembered per text: the self-test validates the same files many times. */
function linesCached(text) {
  let l = LINE_CACHE.get(text);
  if (l === undefined) { l = linesOf(text); LINE_CACHE.set(text, l); }
  return l;
}

const HIT_CACHE = new WeakMap();
/** Pure: the 1-based numbers of the lines of `lines` that contain `text`, remembered per (lines, text): the self-test validates the same files many times. */
function hitsOf(lines, text) {
  let per = HIT_CACHE.get(lines);
  if (per === undefined) { per = new Map(); HIT_CACHE.set(lines, per); }
  let hits = per.get(text);
  if (hits === undefined) {
    hits = [];
    lines.forEach((l, i) => { if (l.includes(text)) hits.push(i + 1); });
    per.set(text, hits);
  }
  return hits;
}

/** Pure: { path, lo, hi } for "path", "path:line" or "path:from-to"; null when it is none of those. */
export function parseCite(s) {
  const mm = /^([^:\s]+)(?::(\d+)(?:-(\d+))?)?$/.exec(s);
  if (!mm) return null;
  return { path: mm[1], lo: mm[2] === undefined ? null : Number(mm[2]), hi: mm[2] === undefined ? null : Number(mm[3] ?? mm[2]) };
}
// ── the generated block ─────────────────────────────────────────────────────────────────────────
export const BEGIN = "<!-- generated:capabilities:begin (regenerated from capabilities.json by the gate's write mode; never hand-edit) -->";
export const END = "<!-- generated:capabilities:end -->";
export const SECTIONS = [
  ["allowed", "Run any cycle (read-only)"],
  ["own-worktree", "Run only in your own worktree"],
  ["own-worktree-host-lock", "Run only in your own worktree, holding the host lock"],
  ["owner-grant", "Only after the owner grants it"],
  ["cloud-model", "Your floor: these need a cloud model"],
  ["forbidden", "Never run or change these"],
];
const pipe = (s) => String(s).replace(/\|/g, "\\|");
const prose = (s) => pipe(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = (s) => "`" + pipe(s) + "`";
const yn = (b) => (b ? "yes" : "-");

/** Pure: the tables, one per policy, in SECTIONS order; rows in file order. */
export function renderBlock(json) {
  const out = [];
  for (const [policy, heading] of SECTIONS) {
    const rows = json.commands.filter((c) => c.policy === policy);
    out.push(`### ${heading} (${rows.length} ${rows.length === 1 ? "row" : "rows"})`, "");
    if (policy !== "forbidden") {
      out.push("| Name | Command | What it gives you | RO | Writes tree | Net | Token | macOS | Cloud model | Self-test | Source |");
      out.push("| --- | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |");
      for (const c of rows) {
        const net = c.networkWrites ? "write" : c.needsNetwork ? "read" : "-";
        const token = c.needsToken ? "yes" : c.tokenOptional ? "optional" : "-";
        out.push(`| ${c.name} | ${code(c.command)} | ${prose(c.does)} | ${yn(c.readOnly)} | ${yn(c.writesTree)} | ${net} | ${token} | ${yn(c.macOnly)} | ${yn(c.cloudModelNeeded)} | ${c.selfTest ? code(c.selfTest) : "-"} | ${prose(c.source.join("; "))} |`);
      }
    } else {
      out.push("| Name | What it covers | Why | Command patterns | Path patterns | Source |");
      out.push("| --- | --- | --- | :-: | :-: | --- |");
      for (const c of rows) {
        out.push(`| ${c.name} | ${prose(c.command)} | ${prose(c.does)} | ${c.commandPatterns.length} | ${c.pathPatterns.length} | ${prose(c.source.join("; "))} |`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

/** Pure: the exact block, markers included. */
export const expectedBlock = (json) => `${BEGIN}\n\n${renderBlock(json)}\n${END}`;

/** Pure: [start, end) of the block, or a problem string when the markers are missing, repeated or reversed. */
function blockSpan(md) {
  const a = md.indexOf(BEGIN);
  const b = md.indexOf(END);
  if (a < 0 || b < 0) return "the generated-block markers are missing";
  if (md.indexOf(BEGIN, a + 1) >= 0 || md.indexOf(END, b + 1) >= 0) return "a generated-block marker appears more than once";
  if (b < a) return "the end marker comes before the begin marker";
  return [a, b + END.length];
}

/** Pure: the Markdown with its block replaced by the rendering of json. Throws on bad markers. */
export function writeBlock(md, json) {
  const span = blockSpan(md);
  if (typeof span === "string") throw new Error(span);
  return md.slice(0, span[0]) + expectedBlock(json) + md.slice(span[1]);
}


// ── the rules ───────────────────────────────────────────────────────────────────────────────────
/**
 * Pure: every problem with the contract, sorted. `m` is
 *   { json, md, pkg: {name: command}, tracked: Set<path>, fileText: (path) => string|null,
 *     steps: string[] (lane step commands, space-joined), wfCommands: string[],
 *     backlog: string|null (docs/BUILD_BACKLOG.md), selfSource: string|null (this file) }.
 */
export function validate(m) {
  const P = [];
  const add = (rule, msg) => P.push(`[${rule}] ${msg}`);
  const { json } = m;
  if (!json || typeof json !== "object") return ["[R1-schema] capabilities.json is not an object"];
  const has = (o, k) => o !== null && typeof o === "object" && Object.hasOwn(o, k);
  if (json.scope !== SCOPE) add("R1-schema", `scope must be ${SCOPE}`);
  if (json.contract !== MD_PATH) add("R1-schema", `contract must be ${MD_PATH}`);
  if (json.gate !== GATE_PATH) add("R1-schema", `gate must be ${GATE_PATH}`);
  if (!/^[0-9a-f]{40}$/.test(json.measuredAt?.commit ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(json.measuredAt?.date ?? "")) add("R1-schema", "measuredAt needs a 40-hex commit and a YYYY-MM-DD date");
  const anchors = json.anchors;
  const anchorsOk = anchors !== null && typeof anchors === "object" && !Array.isArray(anchors);
  if (!anchorsOk) add("R1-schema", "anchors must be an object of citation -> anchor text");
  else {
    // one line of 12 to 200 characters, so a text names a line and is not a stray word
    const oneLine = (t) => typeof t === "string" && t.trim().length >= 12 && t.length <= 200 && !t.includes("\n");
    for (const [k, v] of Object.entries(anchors)) {
      const pc = parseCite(k);
      if (!pc || pc.lo === null) add("R1-schema", `anchors["${k}"] is not a path:line or path:from-to citation`);
      else if (pc.lo === pc.hi) { if (!oneLine(v)) add("R1-schema", `anchors["${k}"] must be one line of 12 to 200 characters`); }
      else if (v === null || Object.keys(v).sort().join(",") !== "first,last" || !oneLine(v.first) || !oneLine(v.last)) {
        add("R1-schema", `anchors["${k}"] must be { first, last }, each one line of 12 to 200 characters`);
      }
    }
  }
  if (!Array.isArray(json.commands)) { add("R1-schema", "commands is not an array"); return P.sort(); }
  for (const p of POLICIES) if (!json.commands.some((c) => c?.policy === p)) add("R1-schema", `no row has policy ${p}`);

  const names = new Set();
  const forbiddenCmd = [];
  const cites = new Map(); // "path:lo-hi" -> where it is cited first
  const noteCite = (s, where) => { if (!cites.has(s)) cites.set(s, where); };
  for (const c of json.commands) {
    const id = typeof c?.name === "string" ? c.name : "(unnamed)";
    if (!c || typeof c !== "object") { add("R1-schema", "a row is not an object"); continue; }
    if (typeof c.name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name)) add("R1-schema", `${id}: name must be kebab-case`);
    if (names.has(c.name)) add("R1-schema", `${id}: duplicate name`);
    names.add(c.name);
    if (!POLICIES.includes(c.policy)) add("R1-schema", `${id}: policy "${c.policy}" is not one of ${POLICIES.join(", ")}`);
    if (!KINDS.includes(c.kind)) add("R1-schema", `${id}: kind "${c.kind}" is not one of ${KINDS.join(", ")}`);
    if ((c.kind === "pattern") !== (c.policy === "forbidden")) add("R1-schema", `${id}: kind pattern and policy forbidden go together`);
    for (const k of ["command", "does"]) if (typeof c[k] !== "string" || !c[k].trim()) add("R1-schema", `${id}: ${k} must be a non-empty string`);
    if (typeof c.note !== "string") add("R1-schema", `${id}: note must be a string (empty is fine)`);
    for (const k of ["command", "does", "note", "selfTest"]) if (typeof c[k] === "string" && c[k].includes("\n")) add("R1-schema", `${id}: ${k} holds a newline`);
    for (const k of ["command", "selfTest"]) if (typeof c[k] === "string" && c[k].includes("`")) add("R1-schema", `${id}: ${k} holds a backtick`);
    for (const b of BOOLS) if (typeof c[b] !== "boolean") add("R1-schema", `${id}: ${b} must be a boolean`);
    if (!Array.isArray(c.source) || c.source.length === 0 || !c.source.every((s) => typeof s === "string")) add("R1-schema", `${id}: source must be a non-empty array of strings`);

    // R2 exists
    const e = c.exists;
    const progs = c.kind === "command" && typeof c.command === "string" ? commandPrograms(c.command) : [];
    if (e !== null && e !== undefined) {
      if (typeof e !== "object") add("R2-exists", `${id}: exists must be an object or null`);
      else {
        if (e.packageScript !== undefined && !has(m.pkg, e.packageScript)) add("R2-exists", `${id}: package.json has no script "${e.packageScript}"`);
        if (e.packageScriptPrefix !== undefined && !Object.keys(m.pkg).some((k) => k.startsWith(e.packageScriptPrefix))) add("R2-exists", `${id}: no package.json script starts with "${e.packageScriptPrefix}"`);
        if (e.file !== undefined && !m.tracked.has(e.file)) add("R2-exists", `${id}: ${e.file} is not a tracked file`);
        if (e.file !== undefined && e.packageScript !== undefined && has(m.pkg, e.packageScript) && !String(m.pkg[e.packageScript]).includes(e.file)) add("R2-exists", `${id}: package script ${e.packageScript} does not run ${e.file}`);
        if (e.export !== undefined) {
          const t = e.file ? m.fileText(e.file) : null;
          const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const|let)\\s+${e.export}\\b|export\\s*\\{[^}]*\\b${e.export}\\b`);
          if (t === null || !re.test(t)) add("R2-exists", `${id}: ${e.file ?? "(no file)"} does not export ${e.export}`);
        }
      }
    } else if (c.kind === "command" && !(progs.length > 0 && progs.every((x) => x.known)) && !(c.note ?? "").trim()) {
      add("R2-exists", `${id}: a command row with exists null needs a note saying why`);
    }
    // R2 the command TEXT is what exists says it is: a command that names one script while exists proves another is no proof
    if (c.policy !== "forbidden" && typeof c.command === "string") {
      const ex = e !== null && typeof e === "object" ? e : {};
      if (c.kind === "command") {
        const targets = progs.filter((x) => x.script !== undefined || x.file !== undefined);
        const t = targets[0];
        if (t?.script !== undefined) {
          if (ex.packageScript !== undefined ? ex.packageScript !== t.script : ex.packageScriptPrefix === undefined || !t.script.startsWith(ex.packageScriptPrefix)) {
            add("R2-exists", `${id}: the command runs pnpm script "${t.script}" but exists names ${ex.packageScript !== undefined ? `"${ex.packageScript}"` : ex.packageScriptPrefix !== undefined ? `prefix "${ex.packageScriptPrefix}"` : "no package script"}`);
          }
        } else if (t?.file !== undefined && ex.file !== t.file) {
          add("R2-exists", `${id}: the command runs ${t.file} but exists names ${ex.file === undefined ? "no file" : ex.file}`);
        }
        // every further script and file on the line exists too, and no program is left unread
        for (const x of targets.slice(1)) {
          if (x.script !== undefined) {
            const star = x.script.indexOf("*");
            const found = star < 0 ? has(m.pkg, x.script) : Object.keys(m.pkg).some((k) => k.startsWith(x.script.slice(0, star)));
            if (!found) add("R2-exists", `${id}: the command also runs pnpm script "${x.script}", which package.json does not have`);
          } else if (!m.tracked.has(x.file)) add("R2-exists", `${id}: the command also runs ${x.file}, which is not a tracked file`);
        }
        for (const x of progs) {
          if (x.unresolved !== undefined) add("R2-exists", `${id}: the command runs "${x.unresolved}" from a directory the gate cannot work out`);
          else if (x.other !== undefined && !x.known && !((e === null || e === undefined) && (c.note ?? "").trim())) add("R2-exists", `${id}: the command runs "${x.other}", which the gate cannot check; a row that does this needs exists null and a note saying why`);
        }
      } else if (c.kind === "import" || c.kind === "workflow") {
        if (ex.file === undefined) add("R2-exists", `${id}: an ${c.kind} row must name, in exists.file, the file it imports or runs`);
        else if (!c.command.includes(ex.file)) add("R2-exists", `${id}: the ${c.kind} row's command does not contain ${ex.file}, the file exists names`);
      }
    }

    // R3 self-test registered
    if (c.selfTest !== null && c.selfTest !== undefined) {
      if (typeof c.selfTest !== "string" || !c.selfTest.trim() || /["']/.test(c.selfTest)) add("R3-selftest", `${id}: selfTest must be a non-empty, unquoted command or null`);
      else if (!m.steps.includes(c.selfTest.trim()) && !m.wfCommands.includes(c.selfTest.trim())) add("R3-selftest", `${id}: selfTest "${c.selfTest}" is no preflight or breadth step and no ${WORKFLOW} run: line`);
    }

    // R4 sources: a path must be tracked; a line citation is collected and judged below with the prose ones
    for (const s of Array.isArray(c.source) ? c.source : []) {
      const pc = typeof s === "string" ? parseCite(s) : null;
      if (!pc) { add("R4-source", `${id}: source "${s}" is not path, path:line or path:from-to`); continue; }
      if (!m.tracked.has(pc.path)) { add("R4-source", `${id}: source path ${pc.path} is not tracked`); continue; }
      if (pc.lo !== null) noteCite(s, `${id}: source`);
    }

    // R5 flags agree with the policy
    if (c.policy !== "forbidden") {
      if (c.cloudModelNeeded !== (c.policy === "cloud-model")) add("R5-flags", `${id}: cloudModelNeeded must be true exactly when policy is cloud-model`);
      if (c.policy === "allowed" && !(c.readOnly === true && c.writesTree === false && c.networkWrites === false)) add("R5-flags", `${id}: an allowed row must be readOnly, write no tree and write nothing remote`);
      if ((c.policy === "own-worktree" || c.policy === "own-worktree-host-lock") && c.networkWrites) add("R5-flags", `${id}: an own-worktree row may not write to the network`);
      if (c.policy === "owner-grant" && c.networkWrites !== true) add("R5-flags", `${id}: an owner-grant row must write to the network`);
      if (c.networkWrites && !c.needsNetwork) add("R5-flags", `${id}: networkWrites implies needsNetwork`);
      if (c.readOnly && c.writesTree) add("R5-flags", `${id}: readOnly and writesTree exclude each other`);
      if ("commandPatterns" in c || "pathPatterns" in c || "controls" in c) add("R5-flags", `${id}: only forbidden rows carry patterns and controls`);
    }

    // R6 forbidden patterns hold their controls
    if (c.policy === "forbidden") {
      const lists = { command: c.commandPatterns, path: c.pathPatterns };
      if (!Array.isArray(lists.command) || !Array.isArray(lists.path)) { add("R6-forbidden", `${id}: commandPatterns and pathPatterns must both be arrays`); continue; }
      if (lists.command.length + lists.path.length === 0) add("R6-forbidden", `${id}: a forbidden row needs at least one pattern`);
      for (const target of ["command", "path"]) {
        const srcs = lists[target];
        const ctl = c.controls?.[target];
        if (srcs.length === 0) { if (ctl !== undefined) add("R6-forbidden", `${id}: ${target} controls with no ${target} patterns`); continue; }
        let res;
        try { res = srcs.map((s) => new RegExp(s)); } catch (err) { add("R6-forbidden", `${id}: a ${target} pattern does not compile: ${err.message}`); continue; }
        const okList = (a) => Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === "string");
        if (!ctl || !okList(ctl.mustMatch) || !okList(ctl.mustNotMatch)) { add("R6-forbidden", `${id}: ${target} needs non-empty mustMatch and mustNotMatch controls`); continue; }
        for (const s of ctl.mustMatch) if (!res.some((r) => r.test(s))) add("R6-forbidden", `${id}: ${target} control "${s}" must match and matches no pattern`);
        for (const s of ctl.mustNotMatch) if (res.some((r) => r.test(s))) add("R6-forbidden", `${id}: ${target} control "${s}" must not match and does`);
        for (const r of res) if (!ctl.mustMatch.some((s) => r.test(s))) add("R6-forbidden", `${id}: ${target} pattern ${r} is exercised by no mustMatch control`);
        if (target === "command") for (const r of res) forbiddenCmd.push([c.name, r]);
      }
    }

    // R9 figures in the text of a row: what a table shows (command, does, selfTest) and the note beside it
    for (const k of ["command", "does", "note", "selfTest"]) {
      const t = typeof c[k] === "string" ? c[k] : "";
      const hit = t.match(FIGURE_RE) ?? t.match(RATIO_RE);
      if (hit) add("R9-figures", `${id}: ${k} types a figure ("${hit[0]}"); derive it or drop it`);
    }
  }

  // R7 nothing listed outside the forbidden rows matches a forbidden command pattern
  for (const c of json.commands) {
    if (!c || c.policy === "forbidden") continue;
    for (const s of [c.command, c.selfTest]) {
      if (typeof s !== "string") continue;
      for (const [n, r] of forbiddenCmd) if (r.test(s)) add("R7-crosscheck", `${c.name}: "${s}" matches forbidden row ${n} (${r})`);
    }
  }

  // R8 the tables equal the rendering; R9 no typed figure outside them; the prose's line citations join R4
  if (typeof m.md !== "string") add("R8-markdown", `${MD_PATH} cannot be read`);
  else {
    let citeText = m.md; // a broken block leaves nothing to separate, so every citation in the file is judged
    if (m.md.charCodeAt(0) === 0xfeff) add("R8-markdown", `${MD_PATH}: starts with a byte-order mark`);
    const span = blockSpan(m.md);
    if (typeof span === "string") add("R8-markdown", `${MD_PATH}: ${span}`);
    else {
      let rendered = null;
      try { rendered = expectedBlock(json); } catch (err) { add("R8-markdown", `the tables cannot be rendered: ${err.message}`); }
      if (rendered !== null && m.md.slice(span[0], span[1]) !== rendered) add("R8-markdown", `${MD_PATH}: the generated block differs from capabilities.json; run node ${GATE_PATH} --write`);
      citeText = m.md.slice(0, span[0]) + "\n" + m.md.slice(span[1]);
      citeText.split("\n").forEach((line) => {
        const hit = line.match(FIGURE_RE) ?? line.match(RATIO_RE);
        if (hit) add("R9-figures", `${MD_PATH}: "${hit[0]}" is a typed figure outside the generated block: "${line.trim()}"`);
      });
    }
    for (const t of citeText.matchAll(CITE_RE)) noteCite(t[0], `${MD_PATH} prose`);
  }

  // R4 every line citation, wherever it is made: inside the file, and its anchors on the cited lines and on no other line
  for (const [s, where] of [...cites].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const pc = parseCite(s); // noteCite is only called with a citation that parses, so pc is never null here
    if (!m.tracked.has(pc.path)) { add("R4-source", `${where}: ${s} cites ${pc.path}, which is not tracked`); continue; }
    const text = m.fileText(pc.path);
    if (text === null) { add("R4-source", `${where}: ${pc.path} cannot be read`); continue; }
    const lines = linesCached(text);
    if (pc.lo < 1 || pc.hi < pc.lo || pc.hi > lines.length) { add("R4-source", `${where}: ${s} is outside ${pc.path} (${lines.length} lines)`); continue; }
    if (!anchorsOk || !has(anchors, s)) { add("R4-source", `${where}: ${s} has no entry in capabilities.json anchors`); continue; }
    const a = anchors[s];
    // a single line pins one text; a range pins its first line and its last (a malformed anchor is an R1 problem, not read here)
    const pins = pc.lo === pc.hi ? [["anchor", a, pc.lo]] : [["first-line anchor", a?.first, pc.lo], ["last-line anchor", a?.last, pc.hi]];
    for (const [label, text, ln] of pins) {
      if (typeof text !== "string" || text === "") continue;
      const hits = hitsOf(lines, text);
      if (!hits.includes(ln)) add("R4-source", `${where}: the ${label} for ${s} is not on line ${ln} of ${pc.path}${hits.length ? ` (it is on line ${hits[0]})` : ""}; a line moved or the text changed (${JSON.stringify(text.slice(0, 60))})`);
      else if (hits.length > 1) add("R4-source", `${where}: the ${label} for ${s} appears on ${hits.length} lines of ${pc.path} (${hits.join(", ")}); an anchor names one line`);
    }
  }
  if (anchorsOk) for (const k of Object.keys(anchors).sort()) if (!cites.has(k)) add("R4-source", `anchors["${k}"] is cited by no row source and by no prose in ${MD_PATH}`);

  // R10 the named ceilings are the same words in the gate's header, the contract and the backlog row
  for (const ceiling of CEILINGS) {
    if (typeof m.selfSource !== "string" || !m.selfSource.split("\n").some((l) => l === `// ${ceiling}`)) add("R10-ceilings", `${GATE_PATH}: the header does not carry "${ceiling.slice(0, 40)}..." word for word`);
    if (typeof m.md !== "string" || !m.md.includes(ceiling)) add("R10-ceilings", `${MD_PATH}: does not carry "${ceiling.slice(0, 40)}..." word for word`);
    if (typeof m.backlog !== "string") add("R10-ceilings", `${BACKLOG_PATH} cannot be read`);
    else if (!m.backlog.includes(ceiling)) add("R10-ceilings", `${BACKLOG_PATH}: does not carry "${ceiling.slice(0, 40)}..." word for word`);
  }
  return P.sort();
}

// ── reading the tree ────────────────────────────────────────────────────────────────────────────
const readRepo = (p) => (existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), "utf8") : null);
/** A read that cannot throw: { text } (null when absent) or { error }. */
function attempt(readFn, p) {
  try { return { text: readFn(p), error: null }; } catch (err) { return { text: null, error: String(err?.message ?? err).split("\n")[0] }; }
}

const defaultListRunner = (script) => spawnSync(process.execPath, [script, "--list-steps"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
const defaultLsFiles = () => execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function listSteps(script, problems, runner) {
  const r = runner(script);
  if (r.status !== 0) { problems.push(`[R3-selftest] node ${script} --list-steps exited ${r.status ?? r.signal}; refusing to judge self-tests without it`); return []; }
  const last = String(r.stdout).split("\n").filter((l) => l.trim() !== "").pop() ?? "";
  try {
    const list = JSON.parse(last);
    if (!Array.isArray(list) || list.length === 0 || !list.every((s) => Array.isArray(s?.cmd))) throw new Error("not a non-empty array of steps");
    return list.map((s) => s.cmd.join(" "));
  } catch (err) {
    problems.push(`[R3-selftest] node ${script} --list-steps printed no usable step list (${err.message})`);
    return [];
  }
}

/**
 * Reads the real tree. Load failures are returned as problems, never swallowed and never thrown.
 * `readFn` reads a repository-relative path (tests inject failures); `jsonFile` / `mdFile` replace the contract files;
 * `listed` hands in the lane steps already listed, so a test need not spawn the two runners again; `listRunner` and
 * `lsFiles` are what the lane steps and the tracked files are asked of, so a test can make either fail.
 */
export function loadModel({ readFn = readRepo, jsonFile = null, mdFile = null, listed = null, listRunner = defaultListRunner, lsFiles = defaultLsFiles } = {}) {
  const problems = [];
  const rf = (p) => {
    if (p === JSON_PATH && jsonFile !== null) return readFileSync(jsonFile, "utf8");
    if (p === MD_PATH && mdFile !== null) return readFileSync(mdFile, "utf8");
    return readFn(p);
  };
  let json = null;
  const j = attempt(rf, JSON_PATH);
  if (j.error) problems.push(`[R1-schema] ${JSON_PATH} cannot be read: ${j.error}`);
  else if (j.text === null) problems.push(`[R1-schema] ${JSON_PATH} is missing`);
  else {
    try { json = JSON.parse(j.text); } catch (err) { problems.push(`[R1-schema] ${JSON_PATH} does not parse: ${err.message}`); }
  }
  const md = attempt(rf, MD_PATH);
  if (md.error) problems.push(`[R8-markdown] ${MD_PATH} cannot be read: ${md.error}`);
  let pkg = {};
  const pk = attempt(rf, "package.json");
  if (pk.error) problems.push(`[R2-exists] package.json cannot be read: ${pk.error}`);
  else {
    try { pkg = JSON.parse(pk.text ?? "{}").scripts ?? {}; } catch { problems.push("[R2-exists] package.json does not parse"); }
  }
  let tracked = new Set();
  try {
    tracked = new Set(lsFiles().split("\0").filter(Boolean));
  } catch { problems.push("[R2-exists] git ls-files failed; refusing to report files as present or absent"); }
  if (tracked.size === 0 && problems.length === 0) problems.push("[R2-exists] git ls-files listed nothing");
  const steps = listed ?? [...listSteps("scripts/preflight.mjs", problems, listRunner), ...listSteps("scripts/verify-breadth.mjs", problems, listRunner)];
  const wf = attempt(rf, WORKFLOW);
  if (wf.error || wf.text === null) problems.push(`[R3-selftest] ${WORKFLOW} cannot be read${wf.error ? `: ${wf.error}` : ""}`);
  const wfCommands = wf.text === null ? [] : runCommands(stripYamlComments(wf.text), { strict: true }).map((c) => c.trim());
  const backlog = attempt(rf, BACKLOG_PATH);
  if (backlog.error) problems.push(`[R10-ceilings] ${BACKLOG_PATH} cannot be read: ${backlog.error}`);
  const self = attempt((p) => readFileSync(p, "utf8"), SELF);
  if (self.error) problems.push(`[R10-ceilings] ${GATE_PATH} cannot be read: ${self.error}`);
  const seen = new Map();
  const fileText = (p) => { if (!seen.has(p)) { const r = attempt(rf, p); seen.set(p, r.error ? null : r.text); } return seen.get(p); };
  return { model: { json, md: md.text, pkg, tracked, steps, wfCommands, fileText, backlog: backlog.text, selfSource: self.text }, problems };
}

// ── self-test ───────────────────────────────────────────────────────────────────────────────────
function cli(args) {
  return spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
}

function selfTest() {
  const { model, problems: loadProblems } = loadModel();
  const failures = [];
  const failFast = process.argv.includes("--fail-fast");
  const stop = () => failFast && failures.length > 0;
  if (loadProblems.length) failures.push(`the real tree did not load: ${loadProblems.join("; ")}`);
  const control = loadProblems.length ? ["(not loaded)"] : validate(model);
  if (control.length) failures.push(`CONTROL: the real contract must have no problem, and has ${control.length}: ${control.slice(0, 5).join("; ")}`);

  const clone = () => ({ ...model, json: JSON.parse(JSON.stringify(model.json)), steps: [...model.steps], wfCommands: [...model.wfCommands] });
  const find = (mm, name) => { const c = mm.json.commands.find((x) => x.name === name); if (!c) throw new Error(`no row named ${name}`); return c; };
  const first = (mm, policy, pred = () => true) => { const c = mm.json.commands.find((x) => x.policy === policy && pred(x)); if (!c) throw new Error(`no ${policy} row matches`); return c; };
  // A cited line the gate can pin: the last long line of a tracked file, so a cite can run one past the end.
  const tail = (mm, path) => {
    const ls = linesOf(mm.fileText(path));
    let i = ls.length - 1;
    while (i > 0 && ls[i].trim().length < 20) i -= 1;
    return { n: ls.length, line: i + 1, text: ls[i].trim().slice(0, 40) };
  };
  const proseLine = (mm, text) => { mm.md = mm.md.replace(BEGIN, `${text}\n${BEGIN}`); };
  const aKey = (mm) => Object.keys(mm.json.anchors).sort()[0];
  // Anchored citations of one shape: a single line, or a range at least three lines wide (so it can be shifted without collapsing).
  const keysOf = (mm, pred) => Object.keys(mm.json.anchors).filter((k) => { const c = parseCite(k); return c !== null && c.lo !== null && pred(c); }).sort();
  const singles = (mm) => keysOf(mm, (c) => c.lo === c.hi);
  const ranges = (mm) => keysOf(mm, (c) => c.hi - c.lo >= 2);
  // The citation of an anchored range or line moved by (dLo, dHi) while its anchors stay where they were: what an edit that
  // inserts (negative) or removes (positive) lines above, or inside, a cited range does to it. Cited from row "hands".
  const shifted = (mm, pool, dLo, dHi) => {
    for (const k of pool(mm)) {
      const c = parseCite(k);
      const lo = c.lo + dLo, hi = c.hi + dHi;
      const key = c.lo === c.hi ? `${c.path}:${lo}` : `${c.path}:${lo}-${hi}`;
      if (lo < 1 || hi < lo || (c.lo !== c.hi && hi === lo) || hi > linesOf(mm.fileText(c.path)).length || Object.hasOwn(mm.json.anchors, key)) continue;
      mm.json.anchors[key] = mm.json.anchors[k];
      find(mm, "hands").source.push(key);
      return key;
    }
    throw new Error("no anchored citation can be shifted that way");
  };
  const shiftRange = (dLo, dHi) => (mm) => shifted(mm, ranges, dLo, dHi);
  const shiftSingle = (d) => (mm) => shifted(mm, singles, d, d);
  const substantive = (t) => t.trim().length >= 12 && t.length <= 200 && (t.match(/[A-Za-z0-9]/g) ?? []).length >= 8;
  // A line of a cited file whose text occurs on two lines, with a unique line before it and one after it to range with.
  const twice = (mm) => {
    for (const path of ["scripts/preflight.mjs", "docs/agent/scheduled-routines.json", "CLAUDE.md", "docs/LANE_COORDINATION.md", "scripts/lane-deliver.mjs"]) {
      const ls = linesOf(mm.fileText(path) ?? "");
      const seen = new Map();
      for (let i = 0; i < ls.length; i += 1) {
        const t = ls[i].trim();
        if (!substantive(t)) continue;
        if (!seen.has(t)) { seen.set(t, i + 1); continue; }
        const unique = (n, step) => { for (let j = n - 1; j >= 0 && j < ls.length; j += step) { const u = ls[j].trim(); if (substantive(u) && ls.filter((l) => l.includes(u)).length === 1) return { n: j + 1, text: u }; } return null; };
        const before = unique(seen.get(t) - 1, -1), after = unique(i + 2, 1);
        if (before && after) return { path, text: t, a: seen.get(t), b: i + 1, before, after };
      }
    }
    throw new Error("no repeated line found in the cited files");
  };
  // [rule, what is planted, how, a fragment of the message that must appear]
  const planted = [
    ["R1-schema", "a duplicate name", (mm) => { const [a, b] = mm.json.commands; b.name = a.name; }, "duplicate name"],
    ["R1-schema", "an unknown policy", (mm) => { first(mm, "allowed").policy = "maybe"; }, "is not one of"],
    ["R1-schema", "a backtick in a command", (mm) => { first(mm, "allowed").command += " `x`"; }, "holds a backtick"],
    ["R1-schema", "a newline in a text field", (mm) => { find(mm, "hands").does = "line one\nline two"; }, "holds a newline"],
    ["R1-schema", "a name that is not kebab-case", (mm) => { find(mm, "hands").name = "Hands_Board"; }, "name must be kebab-case"],
    ["R1-schema", "a measuredAt that is not a commit", (mm) => { mm.json.measuredAt.commit = "HEAD"; }, "measuredAt needs"],
    ["R1-schema", "kind pattern on an allowed row", (mm) => { find(mm, "hands").kind = "pattern"; }, "kind pattern and policy forbidden go together"],
    ["R1-schema", "a boolean written as text", (mm) => { find(mm, "hands").macOnly = "no"; }, "must be a boolean"],
    ["R1-schema", "no anchors object", (mm) => { delete mm.json.anchors; }, "anchors must be an object"],
    ["R1-schema", "a one-word anchor", (mm) => { mm.json.anchors[singles(mm)[0]] = "x"; }, "must be one line of 12 to 200"],
    ["R2-exists", "a package script that does not exist", (mm) => { find(mm, "loop-state").exists.packageScript = "no:such-script"; }, "has no script"],
    ["R2-exists", "a prototype key named as a package script", (mm) => { const e = find(mm, "loop-state").exists; e.packageScript = "constructor"; delete e.file; }, 'has no script "constructor"'],
    ["R2-exists", "a file that is not tracked", (mm) => { find(mm, "objective-queue").exists.file = "scripts/no-such-gate.mjs"; }, "is not a tracked file"],
    ["R2-exists", "an export the file lacks", (mm) => { find(mm, "objective-read-verdict").exists.export = "noSuchExport"; }, "does not export"],
    ["R2-exists", "a script prefix no script has", (mm) => { find(mm, "proof").exists.packageScriptPrefix = "prooof:"; }, "no package.json script starts with"],
    ["R2-exists", "a package script that does not run the named file", (mm) => { find(mm, "loop-state").exists.file = "scripts/raised-hands.mjs"; }, "does not run"],
    ["R2-exists", "a command row with no exists and no note", (mm) => { find(mm, "test-api").note = ""; }, "needs a note"],
    ["R2-exists", "a pnpm command whose text names another script", (mm) => { find(mm, "loop-state").command = "pnpm run lop:state"; }, "the command runs pnpm script"],
    ["R2-exists", "a node command whose text names another file", (mm) => { find(mm, "objective-queue").command = "node scripts/objective-loops.mjs --json"; }, "the command runs scripts/objective-loops.mjs"],
    ["R2-exists", "a ./ command whose text names another file", (mm) => { find(mm, "validate-sim-macos").command = "./validate-sim-macoss.sh"; }, "the command runs validate-sim-macoss.sh"],
    ["R2-exists", "a glob command outside its script prefix", (mm) => { find(mm, "proof").command = "pnpm run prof:*"; }, "the command runs pnpm script"],
    ["R2-exists", "an import row with no exists", (mm) => { find(mm, "classify-diff").exists = null; }, "must name, in exists.file, the file it imports or runs"],
    ["R2-exists", "an import command that lacks the file exists names", (mm) => { find(mm, "objective-read-verdict").command = "import { readVerdict } from './scripts/other.mjs'"; }, "does not contain"],
    ["R3-selftest", "a self-test no lane runs", (mm) => { find(mm, "lane-messages-gate").selfTest = "node scripts/check-lane-messages.mjs --self-tst"; }, "is no preflight or breadth step"],
    ["R3-selftest", "a quoted self-test", (mm) => { find(mm, "lane-messages-gate").selfTest = "node scripts/check-lane-messages.mjs --self-test 'x'"; }, "unquoted command"],
    ["R4-source", "an untracked source path", (mm) => { find(mm, "hands").source.push("scripts/no-such-gate.mjs"); }, "source path scripts/no-such-gate.mjs is not tracked"],
    ["R4-source", "a source line zero", (mm) => { find(mm, "hands").source.push("CLAUDE.md:0"); }, "is outside CLAUDE.md"],
    ["R4-source", "a source range that runs backwards", (mm) => { find(mm, "hands").source.push("CLAUDE.md:5-3"); }, "is outside CLAUDE.md"],
    ["R4-source", "a source that is not a citation", (mm) => { find(mm, "hands").source.push("not a citation::"); }, "is not path, path:line or path:from-to"],
    ["R4-source", "a source line past the end of its file", (mm) => { const t = tail(mm, "CLAUDE.md"); find(mm, "hands").source.push(`CLAUDE.md:${t.n + 1}`); }, "is outside CLAUDE.md"],
    ["R4-source", "a source range that runs one line past the end", (mm) => { const t = tail(mm, "CLAUDE.md"); const k = `CLAUDE.md:${t.line}-${t.n + 1}`; find(mm, "hands").source.push(k); mm.json.anchors[k] = { first: t.text, last: t.text }; }, "is outside CLAUDE.md"],
    ["R4-source", "a line citation with no anchor", (mm) => { const k = aKey(mm); delete mm.json.anchors[k]; }, "has no entry in capabilities.json anchors"],
    ["R4-source", "an anchor that is not on its cited line", (mm) => { mm.json.anchors[singles(mm)[0]] = "this sentence is on none of the cited lines"; }, "is not on line"],
    ["R4-source", "an anchor nobody cites", (mm) => { mm.json.anchors["package.json:1"] = "an anchor that no citation uses"; }, "is cited by no row source"],
    ["R4-source", "a prose citation with no anchor", (mm) => { proseLine(mm, "See package.json:2 for it."); }, "prose: package.json:2 has no entry"],
    ["R4-source", "a prose citation past the end of its file", (mm) => { proseLine(mm, "See package.json:999999 for it."); }, "package.json:999999 is outside package.json"],
    ["R4-source", "a prose citation of an untracked file", (mm) => { proseLine(mm, "See scripts/no-such-gate.mjs:3 for it."); }, "which is not tracked"],
    ["R5-flags", "an allowed row that needs a cloud model", (mm) => { first(mm, "allowed").cloudModelNeeded = true; }, "cloudModelNeeded must be true exactly"],
    ["R5-flags", "an allowed row that writes the tree", (mm) => { const c = first(mm, "allowed"); c.readOnly = false; c.writesTree = true; }, "an allowed row must be readOnly"],
    ["R5-flags", "an owner-grant row with no network write", (mm) => { first(mm, "owner-grant").networkWrites = false; }, "an owner-grant row must write"],
    ["R5-flags", "a network write that needs no network", (mm) => { find(mm, "lane-deliver-ack").needsNetwork = false; }, "networkWrites implies needsNetwork"],
    ["R5-flags", "a row that is read-only and writes the tree", (mm) => { find(mm, "build-loop").readOnly = true; }, "exclude each other"],
    ["R5-flags", "patterns on a row that is not forbidden", (mm) => { find(mm, "hands").commandPatterns = []; }, "only forbidden rows carry patterns"],
    ["R5-flags", "an own-worktree row that writes the network", (mm) => { const c = find(mm, "build-loop"); c.networkWrites = true; c.needsNetwork = true; }, "an own-worktree row may not write"],
    ["R6-forbidden", "pattern lists that are not arrays", (mm) => { first(mm, "forbidden", (c) => c.commandPatterns.length).commandPatterns = "not a list"; }, "must both be arrays"],
    ["R6-forbidden", "a forbidden row with no pattern", (mm) => { const c = find(mm, "own-contract"); c.pathPatterns = []; delete c.controls.path; }, "needs at least one pattern"],
    ["R6-forbidden", "controls for patterns that are not there", (mm) => { find(mm, "own-contract").controls.command = { mustMatch: ["x"], mustNotMatch: ["y"] }; }, "command controls with no command patterns"],
    ["R6-forbidden", "patterns with no controls", (mm) => { delete first(mm, "forbidden", (c) => c.commandPatterns.length).controls.command; }, "needs non-empty mustMatch and mustNotMatch controls"],
    ["R6-forbidden", "a mustMatch control no pattern matches", (mm) => { first(mm, "forbidden", (c) => c.commandPatterns.length).controls.command.mustMatch.push("echo harmless"); }, "must match and matches no pattern"],
    ["R6-forbidden", "a mustNotMatch control a pattern matches", (mm) => { const c = first(mm, "forbidden", (x) => x.commandPatterns.length); c.controls.command.mustNotMatch.push(c.controls.command.mustMatch[0]); }, "must not match and does"],
    ["R6-forbidden", "a pattern that does not compile", (mm) => { first(mm, "forbidden", (c) => c.commandPatterns.length).commandPatterns.push("("); }, "does not compile"],
    ["R6-forbidden", "a pattern no control exercises", (mm) => { first(mm, "forbidden", (c) => c.commandPatterns.length).commandPatterns.push("\\bno-such-command-xyz\\b"); }, "is exercised by no mustMatch control"],
    ["R7-crosscheck", "an allowed command a forbidden pattern matches", (mm) => { first(mm, "allowed").command = first(mm, "forbidden", (c) => c.commandPatterns.length).controls.command.mustMatch[0]; }, "matches forbidden row"],
    ["R7-crosscheck", "a registered self-test a forbidden pattern matches", (mm) => { const st = "node scripts/objective-loop.mjs --write"; find(mm, "objective-queue").selfTest = st; mm.steps.push(st); }, 'node scripts/objective-loop.mjs --write" matches forbidden row'],
    ["R7-crosscheck", "an owner-grant command a forbidden pattern matches", (mm) => { find(mm, "push-own-branch").command = "git push --force origin HEAD:refs/heads/mac/local-brain-x"; }, "matches forbidden row force-push"],
    ["R8-markdown", "a hand edit inside the generated block", (mm) => { mm.md = mm.md.replace("| Name | Command |", "| Name | Commands |"); }, "the generated block differs"],
    ["R8-markdown", "trailing spaces inside the generated block", (mm) => { mm.md = mm.md.replace(/(\n\| hands \|[^\n]*)/, "$1   "); }, "the generated block differs"],
    ["R8-markdown", "a missing end marker", (mm) => { mm.md = mm.md.replace(END, ""); }, "markers are missing"],
    ["R8-markdown", "markers in the wrong order", (mm) => { mm.md = mm.md.replace(BEGIN, "@@B@@").replace(END, BEGIN).replace("@@B@@", END); }, "comes before"],
    ["R8-markdown", "a duplicated end marker", (mm) => { mm.md = mm.md.replace(END, `${END}\n${END}`); }, "appears more than once"],
    ["R8-markdown", "a byte-order mark", (mm) => { mm.md = String.fromCharCode(0xfeff) + mm.md; }, "byte-order mark"],
    ["R9-figures", "a typed count in the prose", (mm) => { proseLine(mm, "This contract lists 68 rows."); }, "typed figure outside the generated block"],
    ["R9-figures", "a typed number word in the prose", (mm) => { proseLine(mm, "The gate enforces nine rules."); }, "typed figure outside the generated block"],
    ["R9-figures", "a typed duration in the prose", (mm) => { proseLine(mm, "The job retries every 5 minutes."); }, "typed figure outside the generated block"],
    ["R9-figures", "a typed pass ratio in a note", (mm) => { first(mm, "allowed").note = "passed 25/25 on the archive copy"; }, "types a figure"],
    ["R10-ceilings", "a contract that drops a ceiling", (mm) => { mm.md = mm.md.replace(CEILINGS[0], ""); }, `${MD_PATH}: does not carry`],
    ["R10-ceilings", "a backlog row that drops a ceiling", (mm) => { mm.backlog = mm.backlog.replace(CEILINGS[1], ""); }, `${BACKLOG_PATH}: does not carry`],
    ["R10-ceilings", "a header that drops a ceiling", (mm) => { mm.selfSource = mm.selfSource.replace(`// ${CEILINGS[0]}`, ""); }, "the header does not carry"],
  ];
  // Round 3. Each of these answers a finding of the round-2 refute (M1, M2, L1, L3, L4) or closes a check no plant had reached.
  const pushPlants = (rows) => { for (const r of rows) planted.push(r); };
  const NOT_EXPORTED = (mm) => (/^(?:async\s+)?function\s+(\w+)/m.exec(mm.fileText("scripts/objective-loop.mjs") ?? "") ?? [])[1];
  // M1: an edit above or inside a cited range moves its first or last line off the line it is cited at.
  pushPlants([
    ["R4-source", "a range whose first line is one line after the cited first line", shiftRange(-1, 0), "the first-line anchor for"],
    ["R4-source", "a range whose first line is one line before the cited first line", shiftRange(1, 0), "the first-line anchor for"],
    ["R4-source", "a range whose last line is one line before the cited last line", shiftRange(0, 1), "the last-line anchor for"],
    ["R4-source", "a range whose last line is one line after the cited last line", shiftRange(0, -1), "the last-line anchor for"],
    ["R4-source", "a line inserted above a range citation", shiftRange(-1, -1), "the first-line anchor for"],
    ["R4-source", "a line inserted above a range citation, seen at its last line", shiftRange(-1, -1), "the last-line anchor for"],
    ["R4-source", "a line removed above a range citation", shiftRange(1, 1), "the first-line anchor for"],
    ["R4-source", "nine lines inserted above a range citation", shiftRange(-9, -9), "the first-line anchor for"],
    ["R4-source", "a line citation one line after its text", shiftSingle(-1), "the anchor for"],
    ["R4-source", "a line citation one line before its text", shiftSingle(1), "the anchor for"],
    ["R4-source", "a single-line anchor whose text is on two lines", (mm) => { const t = twice(mm); const k = `${t.path}:${t.a}`; find(mm, "hands").source.push(k); mm.json.anchors[k] = t.text; }, "an anchor names one line"],
    ["R4-source", "a first-line anchor whose text is on two lines", (mm) => { const t = twice(mm); const k = `${t.path}:${t.a}-${t.after.n}`; find(mm, "hands").source.push(k); mm.json.anchors[k] = { first: t.text, last: t.after.text }; }, "the first-line anchor for"],
    ["R4-source", "a last-line anchor whose text is on two lines", (mm) => { const t = twice(mm); const k = `${t.path}:${t.before.n}-${t.b}`; find(mm, "hands").source.push(k); mm.json.anchors[k] = { first: t.before.text, last: t.text }; }, "the last-line anchor for"],
    ["R4-source", "a cited file that cannot be read", (mm) => { const ft = mm.fileText; mm.fileText = (path) => (path === "CLAUDE.md" ? null : ft(path)); }, "CLAUDE.md cannot be read"],
    ["R1-schema", "a whitespace-padded anchor", (mm) => { mm.json.anchors[singles(mm)[0]] = "            x"; }, "must be one line of 12 to 200"],
    ["R1-schema", "an anchor over 200 characters", (mm) => { mm.json.anchors[singles(mm)[0]] = "x".repeat(201); }, "must be one line of 12 to 200"],
    ["R1-schema", "an anchor spanning two lines", (mm) => { mm.json.anchors[singles(mm)[0]] = "the first of two lines\nthe second of two lines"; }, "must be one line of 12 to 200"],
    ["R1-schema", "an anchor that is not text", (mm) => { mm.json.anchors[singles(mm)[0]] = 424242424242; }, "must be one line of 12 to 200"],
    ["R1-schema", "a single-line citation anchored with a pair", (mm) => { mm.json.anchors[singles(mm)[0]] = { first: "the first anchor text", last: "the last anchor text" }; }, "must be one line of 12 to 200"],
    ["R1-schema", "a range anchored with a bare text", (mm) => { mm.json.anchors[ranges(mm)[0]] = "a bare text for a range"; }, "must be { first, last }"],
    ["R1-schema", "a range anchor that is null", (mm) => { mm.json.anchors[ranges(mm)[0]] = null; }, "must be { first, last }"],
    ["R1-schema", "a range anchor with no last", (mm) => { mm.json.anchors[ranges(mm)[0]] = { first: "the first anchor text" }; }, "must be { first, last }"],
    ["R1-schema", "a range anchor with a third key", (mm) => { const a = mm.json.anchors[ranges(mm)[0]]; mm.json.anchors[ranges(mm)[0]] = { ...a, middle: "a middle anchor text" }; }, "must be { first, last }"],
    ["R1-schema", "a range anchor whose first is one short word", (mm) => { const k = ranges(mm)[0]; mm.json.anchors[k] = { ...mm.json.anchors[k], first: "x" }; }, "must be { first, last }"],
    ["R1-schema", "a range anchor whose last is one short word", (mm) => { const k = ranges(mm)[0]; mm.json.anchors[k] = { ...mm.json.anchors[k], last: "x" }; }, "must be { first, last }"],
    ["R1-schema", "an anchors key that is not a citation", (mm) => { mm.json.anchors["not a citation"] = "some text of twelve characters or more"; }, "is not a path:line or path:from-to citation"],
  ]);
  // M2: every check of the schema, planted.
  pushPlants([
    ["R1-schema", "a scope that is not the brain's directory", (mm) => { mm.json.scope = "scripts"; }, "scope must be"],
    ["R1-schema", "a contract that is not CAPABILITIES.md", (mm) => { mm.json.contract = "README.md"; }, "contract must be"],
    ["R1-schema", "a gate that is not this file", (mm) => { mm.json.gate = "scripts/other.mjs"; }, "gate must be"],
    ["R1-schema", "a policy no row uses", (mm) => { for (const c of mm.json.commands.filter((x) => x.policy === "cloud-model")) c.policy = "owner-grant"; }, "no row has policy cloud-model"],
    ["R1-schema", "an unknown kind", (mm) => { find(mm, "hands").kind = "shell"; }, 'kind "shell" is not one of'],
    ["R1-schema", "a does that is only spaces", (mm) => { find(mm, "hands").does = "   "; }, "does must be a non-empty string"],
    ["R1-schema", "a command that is empty", (mm) => { find(mm, "hands").command = ""; }, "command must be a non-empty string"],
    ["R1-schema", "a note that is not text", (mm) => { find(mm, "hands").note = null; }, "note must be a string"],
    ["R1-schema", "a row with no source", (mm) => { find(mm, "hands").source = []; }, "source must be a non-empty array of strings"],
    ["R1-schema", "a source that is not an array", (mm) => { find(mm, "hands").source = "docs/agent/ORG.md"; }, "source must be a non-empty array of strings"],
    ["R1-schema", "a row that is not an object", (mm) => { mm.json.commands.push(42); }, "a row is not an object"],
    ["R1-schema", "a commands list that is not an array", (mm) => { mm.json.commands = {}; }, "commands is not an array"],
    ["R1-schema", "a contract that is not an object", (mm) => { mm.json = null; }, "is not an object"],
    ["R2-exists", "an exists that is not an object", (mm) => { find(mm, "hands").exists = "scripts/raised-hands.mjs"; }, "exists must be an object or null"],
    ["R2-exists", "an export the file names but does not export", (mm) => { const n = NOT_EXPORTED(mm); const c = find(mm, "objective-read-verdict"); c.exists.export = n; c.command = c.command.replace("readVerdict", n); }, "does not export"],
    ["R2-exists", "a workflow row with no exists", (mm) => { find(mm, "land-branch-workflow").exists = null; }, "must name, in exists.file"],
    ["R3-selftest", "a self-test that is empty", (mm) => { find(mm, "lane-messages-gate").selfTest = ""; }, "selfTest must be a non-empty, unquoted command or null"],
    ["R3-selftest", "a self-test that is not text", (mm) => { find(mm, "lane-messages-gate").selfTest = 42; }, "selfTest must be a non-empty, unquoted command or null"],
    ["R6-forbidden", "a control that is not text", (mm) => { find(mm, "merge").controls.command.mustNotMatch.push(42); }, "needs non-empty mustMatch and mustNotMatch controls"],
    ["R8-markdown", "a Markdown file that cannot be read", (mm) => { mm.md = null; }, "cannot be read"],
    ["R8-markdown", "a row the tables cannot render", (mm) => { find(mm, "hands").source = "docs/agent/ORG.md"; }, "the tables cannot be rendered"],
    ["R10-ceilings", "a gate whose own source cannot be read", (mm) => { mm.selfSource = null; }, "the header does not carry"],
    ["R10-ceilings", "a backlog that cannot be read", (mm) => { mm.backlog = null; }, "cannot be read"],
  ]);
  // M2: a forbidden pattern must be refused wherever a command is listed, in every policy that is not forbidden.
  pushPlants(["allowed", "own-worktree", "own-worktree-host-lock", "owner-grant", "cloud-model"].map((pol) =>
    ["R7-crosscheck", `a ${pol} command a forbidden pattern matches`, (mm) => { first(mm, pol).command = "git push --force origin HEAD:refs/heads/mac/local-brain-x"; }, "matches forbidden row force-push"]));
  // L1: a global option between git and its subcommand is no way round a forbidden pattern.
  pushPlants([
    ["R7-crosscheck", "git -C before a push to mainline", (mm) => { find(mm, "fetch-mainline").command = "git -C /tmp/sg-brain push origin HEAD:SignalGrid_Alpha"; }, "matches forbidden row merge"],
    ["R7-crosscheck", "git -C before a force-push", (mm) => { find(mm, "fetch-mainline").command = "git -C /tmp/sg-brain push --force origin HEAD:refs/heads/mac/x"; }, "matches forbidden row force-push"],
    ["R7-crosscheck", "git --git-dir before a branch deletion", (mm) => { find(mm, "fetch-mainline").command = "git --git-dir=/tmp/w/repo.d branch -D mac/x"; }, "matches forbidden row delete"],
    ["R7-crosscheck", "gh pr comment", (mm) => { find(mm, "fetch-mainline").command = "gh pr comment 439 --body 'brain says hi'"; }, "matches forbidden row send-outside"],
    ["R7-crosscheck", "the GitHub tool that merges, by its qualified name", (mm) => { find(mm, "fetch-mainline").command = "mcp__github__merge_pull_request owner=o repo=r pullNumber=1"; }, "matches forbidden row merge"],
  ]);
  // L3: R9 reads every text a table shows, in every table: the command, does, note and selfTest of a row of each policy.
  for (const pol of POLICIES) {
    for (const k of pol === "forbidden" ? ["command", "does", "note"] : ["command", "does", "note", "selfTest"]) {
      planted.push(["R9-figures", `a typed figure in the ${k} of a ${pol} row`, (mm) => { const c = first(mm, pol); c[k] = `${c[k] ?? "node scripts/x.mjs --self-test"} (the 7 merge forms)`; }, `${k} types a figure`]);
    }
  }
  // L4: a command line is read program by program; a second program that does not exist is a problem wherever it stands.
  const hl = "node scripts/raise-hand.mjs --list";
  const chain = (label, text, want) => ["R2-exists", label, (mm) => { find(mm, "hands-list").command = text; }, want];
  pushPlants([
    chain("a && chain whose second script is missing", `${hl} && node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a ; chain whose second script is missing", `${hl}; node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a pipe whose second script is missing", `${hl} | node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a || chain whose second script is missing", `${hl} || node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a && chain with no space beside it", `${hl}&&node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a || chain with no space beside it", `${hl}||node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a background & whose second script is missing", `${hl} & node scripts/no-such-script.mjs`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a subshell whose second script is missing", `(${hl}; node scripts/no-such-script.mjs)`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a $( ) whose script is missing", `${hl} $(node scripts/no-such-script.mjs)`, "also runs scripts/no-such-script.mjs, which is not a tracked file"),
    chain("a second pnpm script that does not exist", `${hl} && pnpm run no-such-script`, 'also runs pnpm script "no-such-script"'),
    chain("a second pnpm glob no script matches", `${hl} && pnpm run nosuchprefix:*`, 'also runs pnpm script "nosuchprefix:*"'),
    chain("a first script that is not the one exists names", `node scripts/no-such-script.mjs && ${hl}`, "the command runs scripts/no-such-script.mjs but exists names scripts/raise-hand.mjs"),
    ["R2-exists", "a command row that runs nothing", (mm) => { const c = find(mm, "fetch-mainline"); c.command = "# nothing"; c.note = ""; }, "needs a note saying why"],
    ["R1-schema", "a source entry that is not text", (mm) => { find(mm, "hands").source.push(42); }, "source must be a non-empty array of strings"],
    chain("a cd then a relative script that does not exist", "cd scripts && node no-such-script.mjs --list", "the command runs scripts/no-such-script.mjs but exists names scripts/raise-hand.mjs"),
    chain("a cd out of the repository", `cd /tmp && ${hl}`, "from a directory the gate cannot work out"),
    chain("a cd to the parent", `cd .. && ${hl}`, "from a directory the gate cannot work out"),
    chain("a pnpm exec of a tool", "pnpm exec no-such-tool --list", 'runs "pnpm exec", which the gate cannot check'),
    chain("an npx of a tool", "npx no-such-tool --list", 'runs "npx no-such-tool", which the gate cannot check'),
    chain("a program outside the short list, in a pipe", `${hl} | some-tool`, 'runs "some-tool", which the gate cannot check'),
    chain("node with no script file", "node -e 'console.log(1)'", 'runs "node", which the gate cannot check'),
  ]);
  const clean = []; // commands that must raise no R2 problem on row hands-list
  clean.push(`${hl} && echo done`, `${hl} | head -5`, `cd scripts && node raise-hand.mjs --list`, `${hl} 2>&1`, `${hl} # node scripts/gone.mjs`, `(${hl})`, `${hl} && git status`, `node scripts/raise-hand.mjs --list --who owner|"mac lane"`, `${hl} # && node scripts/gone.mjs`);
  // Load failures: a file that cannot be read, or is absent, is a problem named with its rule - never a pass and never a throw.
  const reading = (target, how) => (path) => {
    if (path !== target) return readRepo(path);
    if (how === "absent") return null;
    if (how === "garbage") return "{ this is not json";
    const e = new Error("EISDIR: illegal operation on a directory, read"); e.code = "EISDIR"; throw e;
  };
  const stepList = (out) => () => out;
  const loadPlants = [
    ...[[MD_PATH, "R8-markdown"], [JSON_PATH, "R1-schema"], ["package.json", "R2-exists"], [BACKLOG_PATH, "R10-ceilings"], [WORKFLOW, "R3-selftest"]]
      .map(([target, rule]) => [`an unreadable ${target}`, { readFn: reading(target, "unreadable") }, rule, "EISDIR"]),
    [`an absent ${MD_PATH}`, { readFn: reading(MD_PATH, "absent") }, "R8-markdown", "cannot be read"],
    [`an absent ${JSON_PATH}`, { readFn: reading(JSON_PATH, "absent") }, "R1-schema", "is missing"],
    ["an absent package.json", { readFn: reading("package.json", "absent") }, "R2-exists", "has no script"],
    [`an absent ${BACKLOG_PATH}`, { readFn: reading(BACKLOG_PATH, "absent") }, "R10-ceilings", "cannot be read"],
    [`an absent ${WORKFLOW}`, { readFn: reading(WORKFLOW, "absent") }, "R3-selftest", "cannot be read"],
    [`a ${JSON_PATH} that does not parse`, { readFn: reading(JSON_PATH, "garbage") }, "R1-schema", "does not parse"],
    ["a package.json that does not parse", { readFn: reading("package.json", "garbage") }, "R2-exists", "does not parse"],
    ["a git ls-files that fails", { lsFiles: () => { throw new Error("git is not here"); } }, "R2-exists", "git ls-files failed"],
    ["a git ls-files that lists nothing", { lsFiles: () => "" }, "R2-exists", "git ls-files listed nothing"],
    ["a step lister that exits non-zero", { listed: null, listRunner: stepList({ status: 1, stdout: "" }) }, "R3-selftest", "exited 1"],
    ["a step lister that is killed", { listed: null, listRunner: stepList({ status: null, signal: "SIGTERM", stdout: "" }) }, "R3-selftest", "exited SIGTERM"],
    ["a step lister that prints no JSON", { listed: null, listRunner: stepList({ status: 0, stdout: "not json\n" }) }, "R3-selftest", "printed no usable step list"],
    ["a step lister that prints no steps", { listed: null, listRunner: stepList({ status: 0, stdout: "[]\n" }) }, "R3-selftest", "printed no usable step list"],
    ["a step lister whose steps carry no cmd", { listed: null, listRunner: stepList({ status: 0, stdout: '[{"name":"x"}]\n' }) }, "R3-selftest", "printed no usable step list"],
  ];
  // Controls for the figure rule: a line citation and a rule parameter are not figures.
  const figureControls = [
    ["scripts/preflight.mjs:110-112 cites lines", false],
    ["docs/agent/ORG.md:196-203 and the rules it states", false],
    ["at most one task per cycle", false],
    ["a self-test that plants at least two mutants", true],
    ["Lists 68 rows.", true],
    ["the three local-brain tests", true],
    ["25/25 passed", true],
    ["The gate enforces nine rules.", true],
    ["retrying every 5 minutes", true],
    ["Is the 5-minute lane tick loaded", true],
    ["scripts/preflight.mjs:110-112 names the steps", false],
  ];
  // Every counted noun and every number word, each on its own: a noun or word dropped from the rule is a figure it no longer sees.
  const nouns = [["rows", "row"], ["commands", "command"], ["patterns", "pattern"], ["entries", null], ["tests", "test"], ["primitives", "primitive"], ["gates", "gate"], ["steps", "step"], ["proofs", "proof"], ["cases", "case"], ["rules", "rule"], ["regexes", "regex"], ["days", "day"], ["hours", "hour"], ["minutes", "minute"], ["violations", "violation"], ["mutants", "mutant"], ["controls", "control"], ["checks", "check"], ["forms", "form"], ["tiers", "tier"]];
  for (const [plural, singular] of nouns) {
    figureControls.push([`it holds 7 ${plural} here`, true]);
    if (singular !== null) figureControls.push([`it holds 1 ${singular} here`, true]);
  }
  for (const word of ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]) figureControls.push([`it holds ${word} rows here`, true]);
  figureControls.push(["it holds one row here", false], ["it holds 7 widgets here", false], ["it holds seven widgets here", false]);
  for (const [text, want] of figureControls) {
    if ((FIGURE_RE.test(text) || RATIO_RE.test(text)) !== want) failures.push(`figure-rule control "${text}" should ${want ? "" : "not "}be a figure`);
  }
  // Controls for the command-text rule.
  const targetControls = [
    ["pnpm run loop:state", { script: "loop:state" }],
    ["pnpm run hand:raise -- --doing x", { script: "hand:raise" }],
    ["node scripts/objective-loop.mjs --json", { file: "scripts/objective-loop.mjs" }],
    ["bash scripts/mac/install-launchd.sh --status", { file: "scripts/mac/install-launchd.sh" }],
    ["./validate-sim-macos.sh", { file: "validate-sim-macos.sh" }],
    ["SG_X=1 node --max-old-space-size=4096 scripts/a.mjs", { file: "scripts/a.mjs" }],
    ["node --input-type=module -e 'import x from \"./scripts/a.mjs\"'", null],
    ["git fetch origin SignalGrid_Alpha", null],
    ["pnpm --filter @workspace/api-server run test:api", null],
  ];
  for (const [text, want] of targetControls) {
    if (JSON.stringify(commandTarget(text)) !== JSON.stringify(want)) failures.push(`command-target control "${text}" should be ${JSON.stringify(want)}, is ${JSON.stringify(commandTarget(text))}`);
  }
  // Controls for the program reader: what each command line runs, in order.
  const fa = { file: "scripts/a.mjs" }, fb = { file: "scripts/b.mjs" };
  const programControls = [
    ["node scripts/a.mjs && node scripts/b.mjs", [fa, fb]],
    ["node scripts/a.mjs || node scripts/b.mjs", [fa, fb]],
    ["node scripts/a.mjs&&node scripts/b.mjs", [fa, fb]],
    ["node scripts/a.mjs||node scripts/b.mjs", [fa, fb]],
    ["node scripts/a.mjs; node scripts/b.mjs", [fa, fb]],
    ["node scripts/a.mjs | node scripts/b.mjs", [fa, fb]],
    ["node scripts/a.mjs & node scripts/b.mjs", [fa, fb]],
    ["(node scripts/a.mjs; node scripts/b.mjs)", [fa, fb]],
    ["echo $(node scripts/b.mjs)", [{ other: "echo", known: true }, fb]],
    ["node scripts/a.mjs 2>&1", [fa]],
    ["cd scripts && node a.mjs", [fa]],
    ["cd scripts && cd lib && node a.mjs", [{ file: "scripts/lib/a.mjs" }]],
    ["cd /tmp && node a.mjs", [{ unresolved: "node a.mjs" }]],
    ["cd .. && node a.mjs", [{ unresolved: "node a.mjs" }]],
    ["pnpm run a && pnpm run b", [{ script: "a" }, { script: "b" }]],
    ["pnpm exec tool --x", [{ other: "pnpm exec", known: false }]],
    ["pnpm --filter pkg run t", [{ other: "pnpm --filter", known: false }]],
    ["npx tool", [{ other: "npx tool", known: false }]],
    ["git fetch origin SignalGrid_Alpha", [{ other: "git", known: true }]],
    ["some-tool --x", [{ other: "some-tool", known: false }]],
    ['pnpm run x "a | b && c; d"', [{ script: "x" }]],
    ["pnpm run x 'a | b && c; d'", [{ script: "x" }]],
    ['pnpm run x --who owner|"mac lane"|"cloud lane"', [{ script: "x" }]],
    ["pnpm run x # node scripts/gone.mjs", [{ script: "x" }]],
    ["pnpm run x # then && node scripts/gone.mjs", [{ script: "x" }]],
    ['pnpm run x "a \\" | b"', [{ script: "x" }]],
    ["pnpm run x 'a\\' | b'", [{ script: "x" }, { other: "b'", known: false }]],
    ["FOO=1 node scripts/a.mjs", [fa]],
    ["./run.sh && ./other.sh", [{ file: "run.sh" }, { file: "other.sh" }]],
    ["", []],
  ];
  for (const [text, want] of programControls) {
    const got = commandPrograms(text);
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`program control "${text}" should be ${JSON.stringify(want)}, is ${JSON.stringify(got)}`);
  }
  if (linesOf("a\nb\n").length !== 2 || linesOf("a\nb").length !== 2 || linesOf("").length !== 0) failures.push("linesOf must not count the empty string after a final newline");

  let red = 0;
  if (!control.length) {
    for (const [rule, label, plant, want] of planted) {
      if (stop()) break;
      const mm = clone();
      try { plant(mm); } catch (err) { failures.push(`could not plant "${label}": ${err.message}`); continue; }
      const got = validate(mm);
      if (got.some((g) => g.startsWith(`[${rule}]`) && g.includes(want))) red += 1;
      else failures.push(`PLANTED ${label} did not fail ${rule} with "${want}" (got: ${got.slice(0, 3).join("; ") || "no problem"})`);
    }
    // Commands that read as a chain but are fine: the row they sit in must raise no R2 problem.
    for (const text of clean) {
      if (stop()) break;
      const mm = clone();
      find(mm, "hands-list").command = text;
      const got = validate(mm).filter((g) => g.startsWith("[R2-exists] hands-list:"));
      if (got.length) failures.push(`CLEAN chain "${text}" must raise no R2 problem, and raised: ${got[0]}`);
    }
    // The ceiling check needs the real backlog and header to pass as controls (they did: the control has no problem).
    // A load failure is named with its rule, never thrown and never a pass: an unreadable or an absent file.
    for (const [what, opts, rule, frag] of loadPlants) {
      if (stop()) break;
      let r = null;
      try { r = loadModel({ listed: model.steps, ...opts }); } catch (err) { failures.push(`loadModel threw on ${what}: ${err.message}`); continue; }
      let got = r.problems;
      if (!got.length) { try { got = validate(r.model); } catch (err) { failures.push(`validate threw on ${what}: ${err.message}`); continue; } }
      if (got.some((g) => g.startsWith(`[${rule}]`) && g.includes(frag))) red += 1;
      else failures.push(`${what} was not named as ${rule} with "${frag}" (got: ${got.slice(0, 2).join("; ") || "no problem"})`);
    }
    // The exit code, through the command line: a contract with a problem exits 1 and names it; the real contract exits 0.
    const dir = mkdtempSync(join(tmpdir(), "lbc-selftest-"));
    try {
      if (stop()) throw new Error("fail-fast");
      const bad = JSON.parse(JSON.stringify(model.json));
      bad.commands[1].name = bad.commands[0].name;
      writeFileSync(join(dir, "capabilities.json"), `${JSON.stringify(bad, null, 2)}\n`);
      const planted1 = cli(["--contract-json", join(dir, "capabilities.json")]);
      if (planted1.status !== 1 || !/\[R1-schema\][^\n]*duplicate name/.test(planted1.stderr)) failures.push(`CLI: a contract with a duplicate name must exit 1 and name it (exit ${planted1.status}, stderr: ${planted1.stderr.split("\n")[0]})`);
      else red += 1;
      const ok = cli(["--contract-json", join(REPO, JSON_PATH)]);
      if (ok.status !== 0 || !ok.stdout.startsWith("OK local-brain capabilities")) failures.push(`CLI: the real contract must exit 0 with an OK line (exit ${ok.status}, stdout: ${ok.stdout.split("\n")[0]}, stderr: ${ok.stderr.split("\n")[0]})`);
      const missing = cli(["--contract-json", join(dir, "no-such-file.json")]);
      if (missing.status !== 1 || !/cannot be read/.test(missing.stderr)) failures.push(`CLI: an unreadable contract file must exit 1 and say so (exit ${missing.status})`);
      else red += 1;
    } catch (err) { if (err.message !== "fail-fast") throw err; } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  if (failures.length) {
    console.log("FAIL  local-brain capabilities self-test:");
    for (const f of failures) console.log(`      - ${f}`);
    process.exit(1);
  }
  const rules = new Set(planted.map(([r]) => r)).size;
  console.log(`PASS  local-brain capabilities self-test - ${red} planted violations across ${rules} rules each failed their own check, the exit code was proven through the command line, the real contract is the control and has no problem, the figure rule passed its ${figureControls.length} controls, the command-text rule its ${targetControls.length}, the program reader its ${programControls.length} and ${clean.length} clean chains`);
  process.exit(0);
}

function flag(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) { console.error(`x ${name} needs a file path`); process.exit(2); }
  return resolve(v);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const jsonFile = flag("--contract-json");
  const mdFile = flag("--contract-md");
  if (process.argv.includes("--write")) {
    if (jsonFile !== null || mdFile !== null) { console.error("x --write rewrites the repository's CAPABILITIES.md and takes no --contract-json or --contract-md"); process.exit(2); }
    const md = attempt(readRepo, MD_PATH);
    const js = attempt(readRepo, JSON_PATH);
    if (js.error || js.text === null) { console.error(`x ${JSON_PATH} ${js.error ? `cannot be read: ${js.error}` : "is missing"}`); process.exit(1); }
    let json;
    try { json = JSON.parse(js.text); } catch (err) { console.error(`x ${JSON_PATH} does not parse: ${err.message}`); process.exit(1); }
    if (md.error || md.text === null) { console.error(`x ${MD_PATH} ${md.error ? `cannot be read: ${md.error}` : "is missing"}`); process.exit(1); }
    let next;
    try { next = writeBlock(md.text, json); } catch (err) { console.error(`x ${MD_PATH}: ${err.message}`); process.exit(1); }
    if (next === md.text) console.log(`${MD_PATH}: generated block unchanged`);
    else { writeFileSync(join(REPO, MD_PATH), next); console.log(`${MD_PATH}: generated block rewritten from ${JSON_PATH}`); }
    process.exit(0);
  }
  const { model, problems: loadProblems } = loadModel({ jsonFile, mdFile });
  const problems = loadProblems.length ? loadProblems : validate(model);
  if (problems.length) {
    console.error(`x local-brain capabilities: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`    ${p}`);
    console.error(`\nThe Mac's local brain trusts ${JSON_PATH} and ${MD_PATH} when no cloud model can check them.`);
    process.exit(1);
  }
  const by = Object.fromEntries(POLICIES.map((p) => [p, model.json.commands.filter((c) => c.policy === p).length]));
  console.log(`OK local-brain capabilities - ${model.json.commands.length} rows (${POLICIES.map((p) => `${p} ${by[p]}`).join(", ")}); every program on a command's line is a script or file that exists, every cited line and range still sits on its anchors, every self-test is run by a lane, every forbidden pattern holds its controls, and ${MD_PATH} matches ${JSON_PATH}.`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
