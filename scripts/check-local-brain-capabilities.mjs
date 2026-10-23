#!/usr/bin/env node
// Local-brain capabilities - the Mac's local brain may only rely on a command contract that is true.
//
//   node scripts/check-local-brain-capabilities.mjs              # the gate (writes nothing)
//   node scripts/check-local-brain-capabilities.mjs --write      # regenerate the tables in CAPABILITIES.md (the only writer)
//   node scripts/check-local-brain-capabilities.mjs --self-test  # plant violations; the real contract is the control
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
//                  AND the command TEXT names what exists says: `pnpm run X` is exists.packageScript X
//                  (or starts with the prefix), `node|bash|sh P` and `./P` are exists.file P, an import
//                  or workflow row names exists.file and its command contains it
//   R3-selftest    a row's selfTest is a step `node scripts/preflight.mjs --list-steps` or
//                  `node scripts/verify-breadth.mjs --list-steps` prints, or a run: line of
//                  .github/workflows/review-hub-ci.yml - a self-test no lane runs keeps nothing honest
//   R4-source      every cited path is tracked, every cited line range is inside the file, and every
//                  line citation - in a row's source or in the prose of CAPABILITIES.md - has an entry in
//                  capabilities.json "anchors" whose text appears INSIDE the cited lines of the checked-out
//                  head; an anchor nobody cites is a problem. A line moved by an edit above it goes red
//   R5-flags       cloudModelNeeded exactly when policy is cloud-model; an allowed row is read-only,
//                  writes no tree and nothing remote; an own-worktree row writes nothing remote; an
//                  owner-grant row writes to the network; networkWrites implies needsNetwork
//   R6-forbidden   every forbidden pattern compiles, matches each mustMatch control, matches no
//                  mustNotMatch control, and is exercised by at least one mustMatch control
//   R7-crosscheck  no command or selfTest outside the forbidden rows matches a forbidden command pattern
//   R8-markdown    the generated block of CAPABILITIES.md equals what renderBlock() makes of the JSON;
//                  the file does not start with a byte-order mark
//   R9-figures     no typed count or pass ratio in CAPABILITIES.md outside the generated block, or in a
//                  row's does/note text: the headings' counts are rendered, every other number is a
//                  command's output, never a sentence
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
// the text is still inside the cited lines. COMMANDS.md, the 2026-10-22 survey the contract was built from,
// is not tracked; its agreement with the cloud-model flags was checked once when the contract landed.
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
import { dirname, join, resolve } from "node:path";
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
export const FIGURE_RE = /(?<![:\-\d.])\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+|-)(?:[A-Za-z-]+\s+){0,2}(rows?|commands?|patterns?|entries|tests?|primitives?|gates?|steps?|proofs?|cases?|rules?|regex(?:es)?|days?|hours?|minutes?)\b/i;
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
    for (const [k, v] of Object.entries(anchors)) {
      if (typeof v !== "string" || v.trim().length < 12 || v.length > 200 || v.includes("\n")) add("R1-schema", `anchors["${k}"] must be one line of 12 to 200 characters`);
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
    } else if (c.kind === "command" && !/^git\s/.test(c.command ?? "") && !(c.note ?? "").trim()) {
      add("R2-exists", `${id}: a command row with exists null needs a note saying why`);
    }
    // R2 the command TEXT is what exists says it is: a command that names one script while exists proves another is no proof
    if (c.policy !== "forbidden" && typeof c.command === "string") {
      const ex = e !== null && typeof e === "object" ? e : {};
      if (c.kind === "command") {
        const t = commandTarget(c.command);
        if (t?.script !== undefined) {
          if (ex.packageScript !== undefined ? ex.packageScript !== t.script : ex.packageScriptPrefix === undefined || !t.script.startsWith(ex.packageScriptPrefix)) {
            add("R2-exists", `${id}: the command runs pnpm script "${t.script}" but exists names ${ex.packageScript !== undefined ? `"${ex.packageScript}"` : ex.packageScriptPrefix !== undefined ? `prefix "${ex.packageScriptPrefix}"` : "no package script"}`);
          }
        } else if (t?.file !== undefined && ex.file !== t.file) {
          add("R2-exists", `${id}: the command runs ${t.file} but exists names ${ex.file === undefined ? "no file" : ex.file}`);
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

    // R9 figures in row text
    for (const k of ["does", "note"]) {
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

  // R4 every line citation, wherever it is made: inside the file, and its anchor still inside the cited lines
  for (const [s, where] of [...cites].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const pc = parseCite(s);
    if (!pc || pc.lo === null) { add("R4-source", `${where}: "${s}" is not path:line or path:from-to`); continue; }
    if (!m.tracked.has(pc.path)) { add("R4-source", `${where}: ${s} cites ${pc.path}, which is not tracked`); continue; }
    const text = m.fileText(pc.path);
    if (text === null) { add("R4-source", `${where}: ${pc.path} cannot be read`); continue; }
    const lines = linesCached(text);
    if (pc.lo < 1 || pc.hi < pc.lo || pc.hi > lines.length) { add("R4-source", `${where}: ${s} is outside ${pc.path} (${lines.length} lines)`); continue; }
    if (!anchorsOk || !has(anchors, s)) { add("R4-source", `${where}: ${s} has no entry in capabilities.json anchors`); continue; }
    const a = anchors[s];
    if (typeof a === "string" && a.length > 0 && !lines.slice(pc.lo - 1, pc.hi).join("\n").includes(a)) add("R4-source", `${where}: the anchor for ${s} is no longer inside those lines (${JSON.stringify(a.slice(0, 60))})`);
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

function listSteps(script, problems) {
  const r = spawnSync(process.execPath, [script, "--list-steps"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
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
 * `listed` hands in the lane steps already listed, so a test need not spawn the two runners again.
 */
export function loadModel({ readFn = readRepo, jsonFile = null, mdFile = null, listed = null } = {}) {
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
    tracked = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean));
  } catch { problems.push("[R2-exists] git ls-files failed; refusing to report files as present or absent"); }
  if (tracked.size === 0 && problems.length === 0) problems.push("[R2-exists] git ls-files listed nothing");
  const steps = listed ?? [...listSteps("scripts/preflight.mjs", problems), ...listSteps("scripts/verify-breadth.mjs", problems)];
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
  if (loadProblems.length) failures.push(`the real tree did not load: ${loadProblems.join("; ")}`);
  const control = loadProblems.length ? ["(not loaded)"] : validate(model);
  if (control.length) failures.push(`CONTROL: the real contract must have no problem, and has ${control.length}: ${control.slice(0, 5).join("; ")}`);

  const clone = () => ({ ...model, json: JSON.parse(JSON.stringify(model.json)), steps: [...model.steps], wfCommands: [...model.wfCommands] });
  const find = (mm, name) => { const c = mm.json.commands.find((x) => x.name === name); if (!c) throw new Error(`no row named ${name}`); return c; };
  const first = (mm, policy, pred = () => true) => { const c = mm.json.commands.find((x) => x.policy === policy && pred(x)); if (!c) throw new Error(`no ${policy} row matches`); return c; };
  const withOwn = (mm, key) => mm.json.commands.find((c) => Array.isArray(c.source) && c.source.includes(key));
  // A cited line the gate can pin: the last long line of a tracked file, so a cite can run one past the end.
  const tail = (mm, path) => {
    const ls = linesOf(mm.fileText(path));
    let i = ls.length - 1;
    while (i > 0 && ls[i].trim().length < 20) i -= 1;
    return { n: ls.length, line: i + 1, text: ls[i].trim().slice(0, 40) };
  };
  const proseLine = (mm, text) => { mm.md = mm.md.replace(BEGIN, `${text}\n${BEGIN}`); };
  const aKey = (mm) => Object.keys(mm.json.anchors).sort()[0];

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
    ["R1-schema", "a one-word anchor", (mm) => { mm.json.anchors[aKey(mm)] = "x"; }, "must be one line of 12 to 200"],
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
    ["R4-source", "a source range that runs one line past the end", (mm) => { const t = tail(mm, "CLAUDE.md"); const k = `CLAUDE.md:${t.line}-${t.n + 1}`; find(mm, "hands").source.push(k); mm.json.anchors[k] = t.text; }, "is outside CLAUDE.md"],
    ["R4-source", "a line citation with no anchor", (mm) => { const k = aKey(mm); delete mm.json.anchors[k]; }, "has no entry in capabilities.json anchors"],
    ["R4-source", "an anchor that is not inside the cited lines", (mm) => { mm.json.anchors[aKey(mm)] = "this sentence is in none of the cited lines"; }, "is no longer inside those lines"],
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
  // Controls for the figure rule: a line citation and a rule parameter are not figures.
  const figureControls = [
    ["scripts/preflight.mjs:110-112 cites lines", false],
    ["docs/agent/ORG.md:196-203 and the rules it states", false],
    ["at most one task per cycle", false],
    ["a self-test that plants at least two mutants", false],
    ["Lists 68 rows.", true],
    ["the three local-brain tests", true],
    ["25/25 passed", true],
    ["The gate enforces nine rules.", true],
    ["retrying every 5 minutes", true],
    ["Is the 5-minute lane tick loaded", true],
    ["scripts/preflight.mjs:110-112 names the steps", false],
  ];
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
  if (linesOf("a\nb\n").length !== 2 || linesOf("a\nb").length !== 2 || linesOf("").length !== 0) failures.push("linesOf must not count the empty string after a final newline");

  let red = 0;
  if (!control.length) {
    for (const [rule, label, plant, want] of planted) {
      const mm = clone();
      try { plant(mm); } catch (err) { failures.push(`could not plant "${label}": ${err.message}`); continue; }
      const got = validate(mm);
      if (got.some((g) => g.startsWith(`[${rule}]`) && g.includes(want))) red += 1;
      else failures.push(`PLANTED ${label} did not fail ${rule} with "${want}" (got: ${got.slice(0, 3).join("; ") || "no problem"})`);
    }
    // The ceiling check needs the real backlog and header to pass as controls (they did: the control has no problem).
    // A load failure is named, never thrown: an unreadable Markdown, an unreadable JSON.
    const unreadable = (target) => (p) => { if (p === target) { const e = new Error("EISDIR: illegal operation on a directory, read"); e.code = "EISDIR"; throw e; } return readRepo(p); };
    for (const [target, rule] of [[MD_PATH, "R8-markdown"], [JSON_PATH, "R1-schema"]]) {
      let r = null;
      try { r = loadModel({ readFn: unreadable(target), listed: model.steps }); } catch (err) { failures.push(`loadModel threw on an unreadable ${target}: ${err.message}`); }
      if (r && !r.problems.some((p) => p.startsWith(`[${rule}]`) && p.includes("EISDIR"))) failures.push(`an unreadable ${target} was not named as ${rule} with its cause (got: ${r.problems.join("; ") || "no problem"})`);
    }
    // The exit code, through the command line: a contract with a problem exits 1 and names it; the real contract exits 0.
    const dir = mkdtempSync(join(tmpdir(), "lbc-selftest-"));
    try {
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
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  if (failures.length) {
    console.log("FAIL  local-brain capabilities self-test:");
    for (const f of failures) console.log(`      - ${f}`);
    process.exit(1);
  }
  const rules = new Set(planted.map(([r]) => r)).size;
  console.log(`PASS  local-brain capabilities self-test - ${red} planted violations across ${rules} rules each failed their own check, the exit code was proven through the command line, the real contract is the control and has no problem, the figure rule passed its ${figureControls.length} controls and the command-text rule its ${targetControls.length}`);
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
  console.log(`OK local-brain capabilities - ${model.json.commands.length} rows (${POLICIES.map((p) => `${p} ${by[p]}`).join(", ")}); every command's text names a script or file that exists, every cited line still holds its anchor, every self-test is run by a lane, every forbidden pattern holds its controls, and ${MD_PATH} matches ${JSON_PATH}.`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
