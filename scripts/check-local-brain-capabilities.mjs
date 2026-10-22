#!/usr/bin/env node
// Local-brain capabilities - the Mac's local brain may only rely on a command contract that is true.
//
//   node scripts/check-local-brain-capabilities.mjs              # the gate (writes nothing)
//   node scripts/check-local-brain-capabilities.mjs --write      # regenerate the tables in CAPABILITIES.md (the only writer)
//   node scripts/check-local-brain-capabilities.mjs --self-test  # plant one violation per rule; the real contract is the control
//
// WHY THIS EXISTS (owner, 2026-10-22: "let it leverage whatever we built so when I don't have usage
// and or credits with both Claude and Codex"). The Mac's local brain is an unattended unit that is not
// a Claude session. When neither Claude nor Codex has credits, the only thing standing between it and a
// wrong command is scripts/mac/local-brain/CAPABILITIES.md and its machine twin capabilities.json: which
// commands it may run, under which conditions, which need a cloud model, and which it must never run.
// A contract like that rots the way every hand-kept list in this repository has rotted - a script is
// renamed, a self-test stops being run, a "never run this" pattern quietly stops matching - and a local
// model cannot tell. So the contract is checked here, on every preflight and CI run, and the Markdown
// tables are rendered from the JSON so the two cannot disagree.
//
// WHAT IS GATED (every rule fails the build; each has a planted violation in --self-test):
//   R1-schema      fields, types, a known policy and kind, unique kebab-case names, every policy used,
//                  no newline in a text field and no backtick in a command
//   R2-exists      exists.packageScript is a package.json script (and runs exists.file when both are
//                  named), exists.packageScriptPrefix matches a script, exists.file is tracked,
//                  exists.export is exported by that file; a command row with no exists says why in note
//   R3-selftest    a row's selfTest is a step `node scripts/preflight.mjs --list-steps` or
//                  `node scripts/verify-breadth.mjs --list-steps` prints, or a run: line of
//                  .github/workflows/review-hub-ci.yml - a self-test no lane runs keeps nothing honest
//   R4-source      every cited path is tracked and every cited line range is inside the file
//   R5-flags       cloudModelNeeded exactly when policy is cloud-model; an allowed row is read-only,
//                  writes no tree and nothing remote; an own-worktree row writes nothing remote; an
//                  owner-grant row writes to the network; networkWrites implies needsNetwork
//   R6-forbidden   every forbidden pattern compiles, matches each mustMatch control, matches no
//                  mustNotMatch control, and is exercised by at least one mustMatch control
//   R7-crosscheck  no command or selfTest outside the forbidden rows matches a forbidden command pattern
//   R8-markdown    the generated block of CAPABILITIES.md equals what renderBlock() makes of the JSON
//   R9-figures     no typed count or pass ratio in CAPABILITIES.md outside the generated block, or in a
//                  row's does/note text: the headings' counts are rendered, every other number is a
//                  command's output, never a sentence
//
// FAIL-CLOSED. An unreadable or unparseable input, a git or --list-steps spawn that fails, or a
// --list-steps output that is not one JSON array is a problem, never a pass. Problems are sorted, and no
// clock or random value is read, so the same tree always prints the same verdict.
//
// WHAT IT DOES NOT DO, stated so its silence is not read as coverage: it does not run the commands (the
// self-tests it checks are run by the lanes that list them), it does not judge whether a row's words are
// true, and the forbidden patterns are a floor - a command they miss can still be forbidden by its row's
// words. COMMANDS.md, the 2026-10-22 survey the contract was built from, is not tracked; its agreement
// with the cloud-model flags was checked once when the contract landed.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommands, stripYamlComments } from "./lib/workflow-invocation.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const JSON_PATH = "scripts/mac/local-brain/capabilities.json";
export const MD_PATH = "scripts/mac/local-brain/CAPABILITIES.md";
export const GATE_PATH = "scripts/check-local-brain-capabilities.mjs";
export const SCOPE = "scripts/mac/local-brain";
const WORKFLOW = ".github/workflows/review-hub-ci.yml";

export const POLICIES = ["allowed", "own-worktree", "own-worktree-host-lock", "owner-grant", "cloud-model", "forbidden"];
export const KINDS = ["command", "import", "git", "github", "role", "workflow", "seam", "pattern"];
const BOOLS = ["readOnly", "writesTree", "needsNetwork", "networkWrites", "needsToken", "tokenOptional", "macOnly", "cloudModelNeeded"];
export const FIGURE_RE = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[A-Za-z-]+\s+){0,2}(rows?|commands?|patterns?|entries|tests?|primitives?|gates?|steps?|proofs?|cases?)\b/i;
export const RATIO_RE = /\b\d+\s*\/\s*\d+\b/;

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
 *     steps: string[] (lane step commands, space-joined), wfCommands: string[] }.
 */
export function validate(m) {
  const P = [];
  const add = (rule, msg) => P.push(`[${rule}] ${msg}`);
  const { json } = m;
  if (!json || typeof json !== "object") return ["[R1-schema] capabilities.json is not an object"];
  if (json.scope !== SCOPE) add("R1-schema", `scope must be ${SCOPE}`);
  if (json.contract !== MD_PATH) add("R1-schema", `contract must be ${MD_PATH}`);
  if (json.gate !== GATE_PATH) add("R1-schema", `gate must be ${GATE_PATH}`);
  if (!/^[0-9a-f]{40}$/.test(json.measuredAt?.commit ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(json.measuredAt?.date ?? "")) add("R1-schema", "measuredAt needs a 40-hex commit and a YYYY-MM-DD date");
  if (!Array.isArray(json.commands)) { add("R1-schema", "commands is not an array"); return P.sort(); }
  for (const p of POLICIES) if (!json.commands.some((c) => c?.policy === p)) add("R1-schema", `no row has policy ${p}`);

  const names = new Set();
  const forbiddenCmd = [];
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
        if (e.packageScript !== undefined && !(e.packageScript in m.pkg)) add("R2-exists", `${id}: package.json has no script "${e.packageScript}"`);
        if (e.packageScriptPrefix !== undefined && !Object.keys(m.pkg).some((k) => k.startsWith(e.packageScriptPrefix))) add("R2-exists", `${id}: no package.json script starts with "${e.packageScriptPrefix}"`);
        if (e.file !== undefined && !m.tracked.has(e.file)) add("R2-exists", `${id}: ${e.file} is not a tracked file`);
        if (e.file !== undefined && e.packageScript !== undefined && e.packageScript in m.pkg && !String(m.pkg[e.packageScript]).includes(e.file)) add("R2-exists", `${id}: package script ${e.packageScript} does not run ${e.file}`);
        if (e.export !== undefined) {
          const t = e.file ? m.fileText(e.file) : null;
          const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const|let)\\s+${e.export}\\b|export\\s*\\{[^}]*\\b${e.export}\\b`);
          if (t === null || !re.test(t)) add("R2-exists", `${id}: ${e.file ?? "(no file)"} does not export ${e.export}`);
        }
      }
    } else if (c.kind === "command" && !/^git\s/.test(c.command ?? "") && !(c.note ?? "").trim()) {
      add("R2-exists", `${id}: a command row with exists null needs a note saying why`);
    }

    // R3 self-test registered
    if (c.selfTest !== null && c.selfTest !== undefined) {
      if (typeof c.selfTest !== "string" || !c.selfTest.trim() || /["']/.test(c.selfTest)) add("R3-selftest", `${id}: selfTest must be a non-empty, unquoted command or null`);
      else if (!m.steps.includes(c.selfTest.trim()) && !m.wfCommands.includes(c.selfTest.trim())) add("R3-selftest", `${id}: selfTest "${c.selfTest}" is no preflight or breadth step and no ${WORKFLOW} run: line`);
    }

    // R4 sources
    for (const s of Array.isArray(c.source) ? c.source : []) {
      const mm = /^([^:\s]+)(?::(\d+)(?:-(\d+))?)?$/.exec(s);
      if (!mm) { add("R4-source", `${id}: source "${s}" is not path, path:line or path:from-to`); continue; }
      const [, p, lo, hi] = mm;
      if (!m.tracked.has(p)) { add("R4-source", `${id}: source path ${p} is not tracked`); continue; }
      if (lo !== undefined) {
        const text = m.fileText(p);
        if (text === null) { add("R4-source", `${id}: ${p} cannot be read`); continue; }
        const n = text.split("\n").length;
        const a = Number(lo), b = Number(hi ?? lo);
        if (a < 1 || b < a || b > n) add("R4-source", `${id}: ${s} is outside ${p} (${n} lines)`);
      }
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

  // R8 the tables equal the rendering; R9 no typed figure outside them
  if (typeof m.md !== "string") add("R8-markdown", `${MD_PATH} cannot be read`);
  else {
    const span = blockSpan(m.md);
    if (typeof span === "string") add("R8-markdown", `${MD_PATH}: ${span}`);
    else {
      let rendered = null;
      try { rendered = expectedBlock(json); } catch (err) { add("R8-markdown", `the tables cannot be rendered: ${err.message}`); }
      if (rendered !== null && m.md.slice(span[0], span[1]) !== rendered) add("R8-markdown", `${MD_PATH}: the generated block differs from capabilities.json; run node ${GATE_PATH} --write`);
      const outside = (m.md.slice(0, span[0]) + "\n" + m.md.slice(span[1])).split("\n");
      outside.forEach((line) => {
        const hit = line.match(FIGURE_RE) ?? line.match(RATIO_RE);
        if (hit) add("R9-figures", `${MD_PATH}: "${hit[0]}" is a typed figure outside the generated block: "${line.trim()}"`);
      });
    }
  }
  return P.sort();
}

// ── reading the tree ────────────────────────────────────────────────────────────────────────────
const read = (p) => (existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), "utf8") : null);

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

/** Reads the real tree. Load failures are returned as problems, never swallowed. */
export function loadModel() {
  const problems = [];
  let json = null;
  try { json = JSON.parse(read(JSON_PATH) ?? "null"); } catch (err) { problems.push(`[R1-schema] ${JSON_PATH} does not parse: ${err.message}`); }
  if (json === null && problems.length === 0) problems.push(`[R1-schema] ${JSON_PATH} is missing`);
  let pkg = {};
  try { pkg = JSON.parse(read("package.json") ?? "{}").scripts ?? {}; } catch { problems.push("[R2-exists] package.json does not parse"); }
  let tracked = new Set();
  try {
    tracked = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean));
  } catch { problems.push("[R2-exists] git ls-files failed; refusing to report files as present or absent"); }
  if (tracked.size === 0 && problems.length === 0) problems.push("[R2-exists] git ls-files listed nothing");
  const steps = [...listSteps("scripts/preflight.mjs", problems), ...listSteps("scripts/verify-breadth.mjs", problems)];
  const wfText = read(WORKFLOW);
  if (wfText === null) problems.push(`[R3-selftest] ${WORKFLOW} cannot be read`);
  const wfCommands = wfText === null ? [] : runCommands(stripYamlComments(wfText), { strict: true }).map((c) => c.trim());
  return { model: { json, md: read(MD_PATH), pkg, tracked, steps, wfCommands, fileText: read }, problems };
}

// ── self-test ───────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const { model, problems: loadProblems } = loadModel();
  const failures = [];
  if (loadProblems.length) failures.push(`the real tree did not load: ${loadProblems.join("; ")}`);
  const control = loadProblems.length ? ["(not loaded)"] : validate(model);
  if (control.length) failures.push(`CONTROL: the real contract must have no problem, and has ${control.length}: ${control.slice(0, 5).join("; ")}`);

  const clone = () => ({ ...model, json: JSON.parse(JSON.stringify(model.json)) });
  const row = (mm, kind) => mm.json.commands.find((c) => c.policy === kind && c.exists && c.exists.packageScript && c.exists.file);
  const named = (mm, policy, pred = () => true) => mm.json.commands.find((c) => c.policy === policy && pred(c));
  const planted = [
    ["R1-schema", "a duplicate name", (mm) => { const [a, b] = mm.json.commands; b.name = a.name; }],
    ["R1-schema", "an unknown policy", (mm) => { named(mm, "allowed").policy = "maybe"; }],
    ["R1-schema", "a backtick in a command", (mm) => { named(mm, "allowed").command += " `x`"; }],
    ["R2-exists", "a package script that does not exist", (mm) => { row(mm, "allowed").exists.packageScript = "no:such-script"; }],
    ["R2-exists", "a file that is not tracked", (mm) => { row(mm, "allowed").exists.file = "scripts/no-such-gate.mjs"; }],
    ["R2-exists", "an export the file lacks", (mm) => { named(mm, "allowed", (c) => c.exists?.export).exists.export = "noSuchExport"; }],
    ["R3-selftest", "a self-test no lane runs", (mm) => { named(mm, "allowed", (c) => c.selfTest).selfTest = "node scripts/check-lane-messages.mjs --self-tst"; }],
    ["R4-source", "an untracked source path", (mm) => { named(mm, "allowed").source.push("scripts/no-such-gate.mjs:1"); }],
    ["R4-source", "a source line past the end of its file", (mm) => { named(mm, "allowed").source.push("package.json:999999"); }],
    ["R5-flags", "an allowed row that needs a cloud model", (mm) => { named(mm, "allowed").cloudModelNeeded = true; }],
    ["R5-flags", "an allowed row that writes the tree", (mm) => { const c = named(mm, "allowed"); c.readOnly = false; c.writesTree = true; }],
    ["R5-flags", "an owner-grant row with no network write", (mm) => { named(mm, "owner-grant").networkWrites = false; }],
    ["R6-forbidden", "a mustMatch control no pattern matches", (mm) => { named(mm, "forbidden", (c) => c.commandPatterns.length).controls.command.mustMatch.push("echo harmless"); }],
    ["R6-forbidden", "a mustNotMatch control a pattern matches", (mm) => { const c = named(mm, "forbidden", (x) => x.commandPatterns.length); c.controls.command.mustNotMatch.push(c.controls.command.mustMatch[0]); }],
    ["R6-forbidden", "a pattern that does not compile", (mm) => { named(mm, "forbidden", (c) => c.commandPatterns.length).commandPatterns.push("("); }],
    ["R6-forbidden", "a pattern no control exercises", (mm) => { named(mm, "forbidden", (c) => c.commandPatterns.length).commandPatterns.push("\\bno-such-command-xyz\\b"); }],
    ["R7-crosscheck", "an allowed command a forbidden pattern matches", (mm) => {
      const f = named(mm, "forbidden", (c) => c.commandPatterns.length);
      named(mm, "allowed").command = f.controls.command.mustMatch[0];
    }],
    ["R8-markdown", "a hand edit inside the generated block", (mm) => { mm.md = mm.md.replace("| Name | Command |", "| Name | Commands |"); }],
    ["R8-markdown", "a missing end marker", (mm) => { mm.md = mm.md.replace(END, ""); }],
    ["R9-figures", "a typed count in the prose", (mm) => { mm.md = mm.md.replace(BEGIN, `This contract lists 68 rows.\n${BEGIN}`); }],
    ["R9-figures", "a typed pass ratio in a note", (mm) => { named(mm, "allowed").note = "passed 25/25 on the archive copy"; }],
  ];
  // Controls for the figure rule: a line citation and a rule parameter are not figures.
  const figureControls = [
    ["scripts/preflight.mjs:110-112 cites lines", false],
    ["at most one task per cycle", false],
    ["a self-test that plants at least two mutants", false],
    ["Lists 68 rows.", true],
    ["the three local-brain tests", true],
    ["25/25 passed", true],
  ];
  for (const [text, want] of figureControls) {
    if ((FIGURE_RE.test(text) || RATIO_RE.test(text)) !== want) failures.push(`figure-rule control "${text}" should ${want ? "" : "not "}be a figure`);
  }
  let red = 0;
  if (!control.length) {
    for (const [rule, label, plant] of planted) {
      const mm = clone();
      try { plant(mm); } catch (err) { failures.push(`could not plant "${label}": ${err.message}`); continue; }
      const got = validate(mm);
      if (got.some((g) => g.startsWith(`[${rule}]`))) red += 1;
      else failures.push(`PLANTED ${label} did not fail ${rule} (got: ${got.slice(0, 3).join("; ") || "no problem"})`);
    }
  }
  if (failures.length) {
    console.log("FAIL  local-brain capabilities self-test:");
    for (const f of failures) console.log(`      - ${f}`);
    process.exit(1);
  }
  const rules = new Set(planted.map(([r]) => r)).size;
  console.log(`PASS  local-brain capabilities self-test - ${red} planted violations across ${rules} rules each failed their rule; the real contract is the control and has no problem; the figure rule passed its ${figureControls.length} controls`);
  process.exit(0);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  if (process.argv.includes("--write")) {
    const md = read(MD_PATH);
    let json;
    try { json = JSON.parse(read(JSON_PATH) ?? ""); } catch (err) { console.error(`x ${JSON_PATH} does not parse: ${err.message}`); process.exit(1); }
    if (md === null) { console.error(`x ${MD_PATH} is missing`); process.exit(1); }
    let next;
    try { next = writeBlock(md, json); } catch (err) { console.error(`x ${MD_PATH}: ${err.message}`); process.exit(1); }
    if (next === md) console.log(`${MD_PATH}: generated block unchanged`);
    else { writeFileSync(join(REPO, MD_PATH), next); console.log(`${MD_PATH}: generated block rewritten from ${JSON_PATH}`); }
    process.exit(0);
  }
  const { model, problems: loadProblems } = loadModel();
  const problems = loadProblems.length ? loadProblems : validate(model);
  if (problems.length) {
    console.error(`x local-brain capabilities: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`    ${p}`);
    console.error(`\nThe Mac's local brain trusts ${JSON_PATH} and ${MD_PATH} when no cloud model can check them.`);
    process.exit(1);
  }
  const by = Object.fromEntries(POLICIES.map((p) => [p, model.json.commands.filter((c) => c.policy === p).length]));
  console.log(`OK local-brain capabilities - ${model.json.commands.length} rows (${POLICIES.map((p) => `${p} ${by[p]}`).join(", ")}); every command exists, every self-test is run by a lane, every forbidden pattern holds its controls, and ${MD_PATH} matches ${JSON_PATH}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
