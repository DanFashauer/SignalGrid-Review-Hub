// check-swift-serious — a toolchain-free mirror of the swiftlint rules that are
// ERROR severity and evaluable as plain text, so a serious Swift violation fails
// in seconds locally instead of twenty minutes later on a macOS runner.
//
//   node scripts/check-swift-serious.mjs             the guard
//   node scripts/check-swift-serious.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// `.github/workflows/ios-ci.yml`'s `Lint & Security` job runs swiftlint against
// `native/ios/.swiftlint.yml` on macos-latest, and any ERROR-severity violation
// fails the pull request. The cloud lane has no Swift toolchain and no swiftlint
// binary, so nothing local can run that job: a branch goes green through
// preflight and verify:breadth and then fails CI roughly twenty minutes later on
// rules that are pure text matching. That is exactly what happened on PR #387 —
// two string literals over the 200-column `line_length.error` threshold, and two
// DOC COMMENTS containing a literal `http://`, which the config's custom
// `insecure_url` rule (`http://(?!localhost)`, severity error) matches because
// swiftlint custom regex rules do not skip comments. Four failures, every one of
// them visible to plain text matching, all found only after a full macOS CI round
// trip.
//
// WHAT IT DELIBERATELY DOES NOT COVER
// -----------------------------------
//   * Every WARNING- and INFO-severity rule, while `strict` is false — those do
//     not fail CI, so gating on them here would fail builds CI passes. `strict`
//     is READ, not assumed: under `strict: true` swiftlint promotes every warning
//     to an error, this gate can no longer describe what fails CI, and it
//     REFUSES rather than print a partial verdict.
//   * Every rule that needs the Swift AST — the whole built-in rule set beyond
//     line_length (modifier_order, attributes, cyclomatic_complexity, nesting,
//     empty_count, the opt-in rules …), and any custom rule that declares
//     `match_kinds` (a syntax-kind filter this gate cannot evaluate).
//   * Any custom rule whose regex uses a construct whose MEANING this gate cannot
//     vouch for across engines. swiftlint compiles with NSRegularExpression
//     (ICU); `\p{Lu}` is a Unicode property there and the literal "p{Lu}" in
//     JavaScript without the `u` flag, so compilability is not agreement.
//     Patterns carrying `\p{`/`\P{`, `(?#`, or a POSIX class are reported as NOT
//     EVALUATED. This is a guard on shape, not a proof of equivalence: two
//     patterns that compile in both engines can still differ in corners nobody
//     has enumerated here.
//   * Multi-line matches. Custom regexes are applied line by line.
//
// WHICH WAY THE APPROXIMATIONS FALL
// ---------------------------------
// Two places do not match swiftlint exactly, and honesty about the direction
// matters more than the approximation:
//   * STRICTER, never looser — `line_length` on a line of code carrying a long
//     TRAILING comment. Real swiftlint subtracts comment tokens; this gate only
//     skips lines that are comments outright, because telling a trailing `//`
//     from a `//` inside a string literal is an AST question. Such a line is
//     flagged here and passed by CI.
//   * STRICTER when unsure, LOOSER in one named corner — the multi-line string
//     tracker below. When it cannot tell, it treats the line as string content,
//     which measures the line and ignores any marker on it: both strict. But if
//     it ever MISSED an opening delimiter, the content lines would be read as
//     code and a `//` line in there would be skipped — looser. Swift's grammar
//     is what keeps that corner narrow (the opening `"""` is the last thing on
//     its line), not a proof; it is not a shape this gate can rule out.
//
// So: this gate is GATED on what it evaluates and says out loud what it leaves
// alone. CI's real swiftlint remains the authority on whether native/ios lints; a
// green run here moves the #387 class of failure earlier, it does not replace the
// job. Nothing about scope is hand-listed — the thresholds, the excluded paths
// and the error-severity rule set are all read out of native/ios/.swiftlint.yml
// on every run, and a field the gate needs but cannot find is a hard failure that
// names the field.

import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS_DIR = "native/ios";
const CONFIG_PATH = `${IOS_DIR}/.swiftlint.yml`;

// Floor: a scan that suddenly sees a handful of files has lost its scope, and a gate
// scanning nothing is green about nothing. The floor is deliberately far below the
// live count and is NOT a pin on it — this sentence read "the tree carries 68 tracked
// .swift files today" while the gate was scanning 77, and every run prints the real
// figure ("scanned N tracked .swift file(s)"). Read that line, not this one.
const MIN_SWIFT_FILES = 40;

class GateError extends Error {}

// ---------------------------------------------------------------------------
// A tiny YAML reader. No dependency: neither `yaml` nor `js-yaml` resolves from
// this repository root — in this worktree or in the main checkout. Both exist in
// the pnpm store as transitive dependencies, neither is linked where an import
// could reach it (`require.resolve` returns MODULE_NOT_FOUND for both), and a
// gate that only runs after `pnpm install` is a gate that cannot run first.
// Subset:
// nested mappings by indentation, sequences of scalars, quoted and plain scalars,
// `#` comments outside quotes. Anything outside that subset is marked UNSUPPORTED
// rather than guessed — and reading a needed field out of an UNSUPPORTED subtree
// is a hard failure, never a default.
// ---------------------------------------------------------------------------

const UNSUPPORTED = Symbol("unsupported-yaml-construct");

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === '"') {
      if (c === "\\") { i++; continue; }
      if (c === '"') quote = null;
    } else if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unescapeDouble(raw, lineNo) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") { out += c; continue; }
    const n = raw[++i];
    switch (n) {
      case "\\": out += "\\"; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      case "/": out += "/"; break;
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "0": out += "\0"; break;
      default:
        throw new GateError(
          `${CONFIG_PATH}:${lineNo}: unsupported escape "\\${n}" in a double-quoted scalar. ` +
          "This gate's YAML reader refuses to guess at it — extend the reader rather than assume.");
    }
  }
  return out;
}

function scalar(raw, lineNo) {
  const t = raw.trim();
  if (t.startsWith('"')) {
    if (!t.endsWith('"') || t.length < 2) throw new GateError(`${CONFIG_PATH}:${lineNo}: unterminated double-quoted scalar`);
    return unescapeDouble(t.slice(1, -1), lineNo);
  }
  if (t.startsWith("'")) {
    if (!t.endsWith("'") || t.length < 2) throw new GateError(`${CONFIG_PATH}:${lineNo}: unterminated single-quoted scalar`);
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~" || t === "") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

function parseYamlSubset(text) {
  const lines = [];
  text.split("\n").forEach((raw, idx) => {
    const stripped = stripComment(raw).replace(/\s+$/, "");
    if (stripped.trim() === "") return;
    lines.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim(), no: idx + 1 });
  });

  const state = { i: 0 };
  const skipDeeper = (indent) => { while (state.i < lines.length && lines[state.i].indent > indent) state.i++; };

  function parseNode(indent) {
    const first = lines[state.i];
    if (first.text === "-" || first.text.startsWith("- ")) {
      const arr = [];
      let unsupported = false;
      while (state.i < lines.length && lines[state.i].indent === indent &&
             (lines[state.i].text === "-" || lines[state.i].text.startsWith("- "))) {
        const line = lines[state.i];
        const rest = line.text.slice(1).trim();
        state.i++;
        // A sequence item that is itself a mapping (the `attributes:` block in
        // this config) is outside the subset. Mark and skip; never invent a shape.
        if (rest === "" || /:(\s|$)/.test(rest)) {
          unsupported = true;
          skipDeeper(indent);
        } else {
          arr.push(scalar(rest, line.no));
        }
      }
      return unsupported ? UNSUPPORTED : arr;
    }

    const map = {};
    while (state.i < lines.length && lines[state.i].indent === indent) {
      const line = lines[state.i];
      const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line.text);
      if (!m) {
        state.i++;
        skipDeeper(indent);
        map.__unsupported__ = true;
        continue;
      }
      const key = m[1];
      const inline = (m[2] ?? "").trim();
      state.i++;
      if (inline !== "") {
        map[key] = scalar(inline, line.no);
      } else if (state.i < lines.length && lines[state.i].indent > indent) {
        map[key] = parseNode(lines[state.i].indent);
      } else {
        map[key] = null;
      }
    }
    return map;
  }

  const root = parseNode(0);
  if (state.i < lines.length) {
    throw new GateError(
      `${CONFIG_PATH}:${lines[state.i].no}: this gate's YAML reader could not continue at "${lines[state.i].text}". ` +
      "Refusing to derive rules from a config it only partly understands.");
  }
  return root;
}

// ---------------------------------------------------------------------------
// Derivation. Every field the gate needs must be present; a missing one fails and
// names itself rather than falling back to a default that could silently disagree
// with what CI's swiftlint enforces.
// ---------------------------------------------------------------------------

function need(obj, path, what) {
  let cur = obj;
  for (const key of path) {
    if (cur === UNSUPPORTED) {
      throw new GateError(`${CONFIG_PATH}: "${path.join(".")}" sits inside a construct this gate's YAML reader does not support — cannot derive ${what}.`);
    }
    if (cur === null || typeof cur !== "object" || !(key in cur)) {
      throw new GateError(`${CONFIG_PATH}: missing "${path.join(".")}" — this gate refuses to assume a default for ${what}.`);
    }
    cur = cur[key];
  }
  if (cur === null || cur === UNSUPPORTED) {
    throw new GateError(`${CONFIG_PATH}: "${path.join(".")}" is empty or unsupported — cannot derive ${what}.`);
  }
  return cur;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*\*\//g, "(?:.*/)?").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${body}$`);
}

// swiftlint compiles its custom regexes with NSRegularExpression (ICU). A pattern
// can compile in BOTH engines and still MEAN different things — `\p{Lu}` is a
// Unicode property in ICU and, without the `u` flag, the literal "p{Lu}" in
// JavaScript. Compilability is therefore not agreement. Patterns carrying a
// construct whose meaning this gate cannot vouch for are reported as NOT
// EVALUATED rather than applied under a JavaScript reading of them.
const ICU_ONLY = [
  [/\\[pP]\{/, "\\p{...} Unicode property (a literal without the u flag in JS)"],
  [/\(\?#/, "(?#...) inline comment group (unsupported in JS)"],
  [/\[\[:[a-z]+:\]\]|\[:[a-z]+:\]/, "POSIX character class (a character set in JS)"],
];

function icuOnlyConstruct(source) {
  for (const [re, what] of ICU_ONLY) if (re.test(source)) return what;
  return null;
}

function deriveConfig(configText) {
  const doc = parseYamlSubset(configText);

  const excludedRaw = need(doc, ["excluded"], "the excluded path set");
  if (!Array.isArray(excludedRaw)) throw new GateError(`${CONFIG_PATH}: "excluded" is not a list of paths.`);
  const excluded = excludedRaw.map(String);

  // `strict` decides whether this gate's whole premise holds. Under strict: true
  // swiftlint promotes EVERY warning to an error, so the rules listed below as
  // "not gated here, severity is not error" would in fact be failing CI — and
  // printing that line would be a false sentence. Derived, never assumed.
  const strict = need(doc, ["strict"], "the strict flag");
  if (typeof strict !== "boolean") {
    throw new GateError(`${CONFIG_PATH}: "strict" is ${JSON.stringify(strict)}, not a boolean.`);
  }

  const lineLengthError = need(doc, ["line_length", "error"], "the line_length error threshold");
  if (typeof lineLengthError !== "number") {
    throw new GateError(`${CONFIG_PATH}: "line_length.error" is ${JSON.stringify(lineLengthError)}, not a number.`);
  }
  const ignoresComments = need(doc, ["line_length", "ignores_comments"], "line_length.ignores_comments");
  if (typeof ignoresComments !== "boolean") {
    throw new GateError(`${CONFIG_PATH}: "line_length.ignores_comments" is ${JSON.stringify(ignoresComments)}, not a boolean.`);
  }

  const customRoot = need(doc, ["custom_rules"], "the custom rule set");
  if (typeof customRoot !== "object" || Array.isArray(customRoot)) {
    throw new GateError(`${CONFIG_PATH}: "custom_rules" is not a mapping of rule names.`);
  }

  const errorRules = [];
  const skipped = [];
  const unevaluable = [];
  for (const [name, body] of Object.entries(customRoot)) {
    if (name === "__unsupported__") {
      throw new GateError(`${CONFIG_PATH}: "custom_rules" contains a construct this gate's YAML reader does not support — refusing to derive a partial rule set.`);
    }
    if (body === UNSUPPORTED || body === null || typeof body !== "object") {
      throw new GateError(`${CONFIG_PATH}: custom rule "${name}" could not be read — refusing to derive a partial rule set.`);
    }
    if (!("severity" in body)) {
      throw new GateError(`${CONFIG_PATH}: custom rule "${name}" has no "severity" — this gate refuses to assume one.`);
    }
    if (body.severity !== "error") { skipped.push(`${name} (${body.severity})`); continue; }
    if (!("regex" in body) || typeof body.regex !== "string") {
      throw new GateError(`${CONFIG_PATH}: error-severity custom rule "${name}" has no string "regex".`);
    }
    if (!("message" in body) || typeof body.message !== "string") {
      throw new GateError(`${CONFIG_PATH}: error-severity custom rule "${name}" has no string "message".`);
    }
    if ("match_kinds" in body) {
      unevaluable.push(`${name} (declares match_kinds — needs the Swift AST)`);
      continue;
    }
    const icu = icuOnlyConstruct(body.regex);
    if (icu) {
      unevaluable.push(`${name} (regex uses ${icu} — this gate will not guess at its meaning)`);
      continue;
    }
    let regex;
    try {
      regex = new RegExp(body.regex);
    } catch (err) {
      throw new GateError(
        `${CONFIG_PATH}: error-severity custom rule "${name}" has a regex this gate cannot compile in JavaScript (${err.message}). ` +
        "Refusing to skip it silently — swiftlint would still enforce it in CI.");
    }
    errorRules.push({
      name,
      regex,
      source: body.regex,
      message: body.message,
      excluded: "excluded" in body && body.excluded !== null ? [].concat(body.excluded).map(String) : [],
      included: "included" in body && body.included !== null ? [].concat(body.included).map(String) : [],
    });
  }

  if (strict) {
    // Refuse rather than print a verdict this gate knows is incomplete. Every
    // name below now fails CI and this gate does not evaluate it, and every
    // built-in warning rule (all of which need the Swift AST) joins them.
    throw new GateError(
      `${CONFIG_PATH}: "strict: true" promotes every warning-severity rule to error, so this gate no longer ` +
      "mirrors what fails CI. Promoted custom rules it does NOT evaluate: " +
      `${skipped.join(", ") || "none"}; plus every built-in warning rule, which needs the Swift AST. ` +
      "Extend this gate to cover them, or set strict back to false — it will not print a verdict it knows is partial.");
  }

  return {
    excluded,
    excludedMatchers: excluded.map((e) => ({ raw: e, re: e.includes("*") ? globToRegExp(e) : null })),
    lineLengthError,
    ignoresComments,
    strict,
    errorRules,
    skipped,
    unevaluable,
  };
}

function isExcluded(relToIos, cfg) {
  return cfg.excludedMatchers.some(({ raw, re }) =>
    re ? re.test(relToIos) : relToIos === raw || relToIos.startsWith(`${raw}/`));
}

// ---------------------------------------------------------------------------
// Multi-line string literals. The comment-only skip and the swiftlint:disable
// markers are TEXT shapes, and inside a Swift `"""` block they are string
// CONTENT, not syntax — swiftlint sees content. ManagedAppViewController.swift
// already injects JavaScript in a `"""` block where `//` is the comment idiom,
// so without this a `//` line in there would dodge line_length, and a
// `// swiftlint:disable all` in injected source would silence the rest of the
// file. Swift's grammar makes the delimiters findable without an AST: the
// opening `"""` is the last thing on its line and the closing `"""` the first
// thing on its. Raw forms (`#"""` … `"""#`) carry matching hash counts.
//
// Where the tracker is unsure it FAILS CLOSED — it treats the line as string
// content, which measures the line and ignores any marker on it. Both are the
// strict direction, so an over-eager tracker can only over-report.
// ---------------------------------------------------------------------------

function multilineStringLines(lines) {
  const inside = lines.map(() => false);
  let openHashes = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openHashes === null) {
      const m = /(#*)"""[ \t]*$/.exec(line);
      if (!m) continue;
      // A `"""` sitting after a `//` on the same line is an example inside a
      // comment, not an opener. (Being wrong the other way costs only
      // strictness — see the note above.)
      const slashes = line.indexOf("//");
      if (slashes !== -1 && slashes < m.index) continue;
      openHashes = m[1].length;
      continue; // the delimiter line itself is code
    }
    // Closing delimiter: `"""` at the head of the line, same hash count.
    if (new RegExp(`^[ \\t]*"""#{${openHashes}}(?!#)`).test(line)) {
      openHashes = null; // the delimiter line itself is code
      continue;
    }
    inside[i] = true;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// swiftlint:disable handling — the same control comments the real linter honours.
// ---------------------------------------------------------------------------

const DISABLE_RE = /\/\/\s*swiftlint:(disable|enable)(?::(next|this|previous))?\s+([^\n]*)$/;

function disabledMap(lines, insideString) {
  // disabled[i] = the set of rule names suppressed on line i ("all" included).
  const disabled = lines.map(() => new Set());
  const region = new Set();
  for (let i = 0; i < lines.length; i++) {
    // A marker that is string content is not a marker.
    const m = insideString[i] ? null : DISABLE_RE.exec(lines[i]);
    const verb = m ? m[1] : null;
    const scope = m ? m[2] : null;
    const names = m ? m[3].trim().split(/[\s,]+/).filter(Boolean) : [];

    // A region-scoped `enable` is applied BEFORE the region is snapshotted onto
    // this line, so a violation on the enable line itself is reported rather
    // than swallowed by the region it closes. And `enable all` ends EVERY open
    // region: `all` means every rule, but it never appears in the region set,
    // so deleting by name matched nothing and a rule-specific region outlived
    // its own terminator — this gate reporting nothing where CI fails.
    if (verb === "enable" && !scope) {
      if (names.includes("all")) region.clear();
      else for (const n of names) region.delete(n);
    }

    for (const r of region) disabled[i].add(r);

    if (!m) continue;
    if (verb === "disable") {
      if (scope === "next") { if (i + 1 < lines.length) for (const n of names) disabled[i + 1].add(n); }
      else if (scope === "this") { for (const n of names) disabled[i].add(n); }
      else if (scope === "previous") { if (i > 0) for (const n of names) disabled[i - 1].add(n); }
      else { for (const n of names) { region.add(n); disabled[i].add(n); } }
    } else if (scope === "this") {
      for (const n of names) disabled[i].delete(n);
    } else if (scope === "next" && i + 1 < lines.length) {
      for (const n of names) disabled[i + 1].delete(n);
    } else if (scope === "previous" && i > 0) {
      for (const n of names) disabled[i - 1].delete(n);
    }
  }
  return disabled;
}

const isOff = (disabled, i, rule) => disabled[i].has("all") || disabled[i].has(rule);

// ---------------------------------------------------------------------------
// The scan itself.
// ---------------------------------------------------------------------------

function scanContent(displayPath, matchPath, content, cfg) {
  const out = [];
  const lines = content.split("\n");
  const insideString = multilineStringLines(lines);
  const disabled = disabledMap(lines, insideString);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!isOff(disabled, i, "line_length") && line.length > cfg.lineLengthError) {
      // ignores_comments: swiftlint discounts comment content. This gate only
      // skips a line that IS a comment, and only outside a `"""` block, where a
      // leading `//` is text rather than syntax. The header names the direction
      // the remaining approximation falls in.
      const commentOnly = !insideString[i] && line.trimStart().startsWith("//");
      if (!(cfg.ignoresComments && commentOnly)) {
        out.push({
          path: displayPath,
          line: i + 1,
          col: cfg.lineLengthError + 1,
          rule: "line_length",
          message: `Line should be ${cfg.lineLengthError} characters or less; it is currently ${line.length} characters`,
        });
      }
    }

    for (const rule of cfg.errorRules) {
      if (rule.included.length && !rule.included.some((pat) => new RegExp(pat).test(matchPath))) continue;
      if (rule.excluded.length && rule.excluded.some((pat) => new RegExp(pat).test(matchPath))) continue;
      if (isOff(disabled, i, rule.name)) continue;
      rule.regex.lastIndex = 0;
      const m = rule.regex.exec(line);
      if (m) out.push({ path: displayPath, line: i + 1, col: m.index + 1, rule: rule.name, message: rule.message });
    }
  }
  return out;
}

function trackedSwiftFiles() {
  const raw = execFileSync("git", ["ls-files", "-z", "--", IOS_DIR], {
    cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  return raw.split("\0").filter((p) => p.endsWith(".swift"));
}

// ---------------------------------------------------------------------------
// --self-test: plant each defect class in a temp tree and assert BOTH verdicts.
// Driven by the REAL derived config, so a config that lost insecure_url or
// flipped ignores_comments makes this fail loudly instead of drifting quietly.
// ---------------------------------------------------------------------------

function selfTest(cfg, rawConfigText) {
  const failures = [];
  const notes = [];

  // Floors on the derivation itself, before a single case is planted.
  if (cfg.errorRules.length < 1) failures.push("derivation floor: no error-severity custom rule was derived from the config");
  if (!Number.isFinite(cfg.lineLengthError) || cfg.lineLengthError < 1) failures.push("derivation floor: line_length.error is not a usable threshold");
  if (cfg.excluded.length < 1) failures.push("derivation floor: no excluded paths were derived");
  const insecure = cfg.errorRules.find((r) => r.name === "insecure_url");
  const creds = cfg.errorRules.find((r) => r.name === "hardcoded_credentials");
  if (!insecure) failures.push("derivation floor: the config no longer carries an error-severity `insecure_url` rule, so the planted http:// cases cannot be asserted");
  if (!creds) failures.push("derivation floor: the config no longer carries an error-severity `hardcoded_credentials` rule, so its planted cases cannot be asserted");

  // A `strict: true` config must REFUSE, because under it the warning rules this
  // gate does not evaluate are failing CI and the "not gated, severity is not
  // error" line would be a false sentence. Asserted against a real copy of the
  // live config with the one field flipped, so it exercises the whole derivation.
  const strictText = rawConfigText.replace(/^strict:\s*false\s*$/m, "strict: true");
  if (strictText === rawConfigText) {
    failures.push("strict case: could not flip `strict: false` in the live config text — the field this gate reads has moved or changed shape");
  } else {
    let refused = null;
    try {
      deriveConfig(strictText);
    } catch (err) {
      refused = err instanceof GateError ? err.message : `wrong error type: ${err}`;
    }
    const ok = typeof refused === "string" && refused.includes("strict: true");
    notes.push(`  ${ok ? "ok  " : "FAIL"}  strict: true is REFUSED, not quietly under-reported — ${ok ? "gate refused and named the promoted rules" : `got ${refused === null ? "no error at all" : refused}`}`);
    if (!ok) failures.push("strict: true must make derivation refuse");
    // Negative control: the live config (strict: false) must still derive.
    try {
      deriveConfig(rawConfigText);
      notes.push("  ok    the live config (strict: false) still derives — the refusal is specific, not blanket");
    } catch (err) {
      notes.push(`  FAIL  the live config no longer derives: ${err.message}`);
      failures.push("the live config must still derive");
    }
  }

  // The NOT-EVALUATED and refusal arms are the quiet half of this derivation:
  // when one stops working the gate does not go red, it silently covers LESS.
  // Nothing watched them — emptying ICU_ONLY, deleting the match_kinds arm, or
  // defaulting a missing field each left this self-test at PASS. These three
  // drive deriveConfig on mutated copies of the LIVE config text and assert the
  // REASON TEXT, not merely that something was skipped or that something threw.
  const derivationCases = [
    {
      label: "an error rule whose regex uses \\p{Lu} lands in NOT EVALUATED, naming the Unicode property",
      anchor: '    regex: "http://(?!localhost)"',
      replacement: '    regex: "\\\\p{Lu}http://(?!localhost)"',
      check: (cfgOut, err) => {
        if (err) return `derivation threw instead of reporting: ${err}`;
        const entry = cfgOut.unevaluable.find((u) => u.startsWith("insecure_url"));
        if (!entry) return `insecure_url absent from NOT EVALUATED (saw: ${cfgOut.unevaluable.join("; ") || "nothing"})`;
        if (!/Unicode property/.test(entry)) return `the reason does not name the Unicode property: "${entry}"`;
        if (cfgOut.errorRules.some((r) => r.name === "insecure_url")) return "insecure_url was still GATED, under a JavaScript reading of an ICU pattern";
        return null;
      },
    },
    {
      label: "an error rule declaring match_kinds lands in NOT EVALUATED, naming match_kinds",
      anchor: [
        '    regex: "http://(?!localhost)"',
        '    message: "Use HTTPS instead of HTTP for security"',
        "    severity: error",
      ].join("\n"),
      replacement: [
        '    regex: "http://(?!localhost)"',
        '    message: "Use HTTPS instead of HTTP for security"',
        "    severity: error",
        "    match_kinds: string",
      ].join("\n"),
      check: (cfgOut, err) => {
        if (err) return `derivation threw instead of reporting: ${err}`;
        const entry = cfgOut.unevaluable.find((u) => u.startsWith("insecure_url"));
        if (!entry) return `insecure_url absent from NOT EVALUATED (saw: ${cfgOut.unevaluable.join("; ") || "nothing"})`;
        if (!/match_kinds/.test(entry)) return `the reason does not name match_kinds: "${entry}"`;
        if (cfgOut.errorRules.some((r) => r.name === "insecure_url")) return "insecure_url was still GATED, with a syntax-kind filter this gate cannot evaluate";
        return null;
      },
    },
    {
      label: "a config with line_length.error removed REFUSES, naming the field",
      anchor: ["line_length:", "  warning: 120", "  error: 200", "  ignores_comments: true"].join("\n"),
      replacement: ["line_length:", "  warning: 120", "  ignores_comments: true"].join("\n"),
      check: (cfgOut, err) => {
        if (!err) return `derivation returned a config instead of refusing (line_length.error=${cfgOut.lineLengthError})`;
        if (!err.includes('missing "line_length.error"')) return `the refusal does not name the field: "${err}"`;
        return null;
      },
    },
  ];

  for (const c of derivationCases) {
    let problem;
    if (rawConfigText.split(c.anchor).length - 1 !== 1) {
      // The anchor is part of the assertion: if the live config no longer has
      // this shape, the case proves nothing and must say so rather than pass.
      problem = `anchor not found exactly once in the live config — the shape this case mutates has moved: ${JSON.stringify(c.anchor)}`;
    } else {
      let cfgOut = null;
      let err = null;
      try {
        cfgOut = deriveConfig(rawConfigText.replace(c.anchor, c.replacement));
      } catch (e) {
        err = e instanceof GateError ? e.message : `wrong error type: ${e}`;
      }
      problem = c.check(cfgOut, err);
    }
    notes.push(`  ${problem ? "FAIL" : "ok  "}  ${c.label}${problem ? ` — ${problem}` : ""}`);
    if (problem) failures.push(c.label);
  }

  const dir = mkdtempSync(join(tmpdir(), "swift-serious-selftest-"));
  const cases = [];
  try {
    const long = "x".repeat(cfg.lineLengthError + 20);
    const write = (name, body) => {
      const f = join(dir, name);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, body);
      return f;
    };

    // 1/2. The threshold BOUNDARY, both sides. swiftlint's line_length fires on
    //      "longer than", so exactly the threshold is legal and one past it is not.
    cases.push({
      label: `a line of exactly ${cfg.lineLengthError} characters does NOT fire`,
      file: write("Boundary.swift", `${"y".repeat(cfg.lineLengthError)}\n`), rule: "line_length", expect: false,
    });
    cases.push({
      label: `a line of ${cfg.lineLengthError + 1} characters MUST fire`,
      file: write("BoundaryPlus.swift", `${"y".repeat(cfg.lineLengthError + 1)}\n`), rule: "line_length", expect: true,
    });

    // 3. A code line well over the threshold.
    cases.push({
      label: "code line over line_length.error fires",
      file: write("LongCode.swift", `let s = "${long}"\n`), rule: "line_length", expect: true,
    });

    // 4. A comment-only line over the threshold must NOT fire while
    //    ignores_comments is true. The expectation is DERIVED, not assumed: set
    //    ignores_comments: false in the config and this case flips to MUST fire.
    cases.push({
      label: `comment-only long line ${cfg.ignoresComments ? "does NOT fire (ignores_comments: true)" : "fires (ignores_comments: false)"}`,
      file: write("LongComment.swift", `// ${long}\n`), rule: "line_length", expect: !cfg.ignoresComments,
    });

    // 5/6. Inside a `"""` block a leading `//` is string CONTENT, so the line is
    //      measured — and a marker in there is not a marker. Without the
    //      multi-line tracker both of these went the other way, and the second
    //      one silenced the rest of the file.
    cases.push({
      label: 'a `//` line inside a """ block is MEASURED, not skipped',
      file: write("InjectedJS.swift", `let js = """\n// ${long}\n"""\n`), rule: "line_length", expect: true,
    });
    cases.push({
      label: 'a swiftlint:disable all inside a """ block does NOT suppress the code after it',
      file: write("InjectedMarker.swift", 'let js = """\n// swiftlint:disable all\n"""\nlet x = "http://e.example"\n'),
      rule: "insecure_url", expect: true, expectLine: 4,
    });
    // 6b. Negative control for the tracker: the SAME marker outside a string does
    //     suppress, so case 6 is about the string, not about markers failing.
    cases.push({
      label: "the same marker outside a string DOES suppress (control for the case above)",
      file: write("PlainMarker.swift", '// swiftlint:disable all\nlet x = "http://e.example"\n'),
      rule: "insecure_url", expect: false,
    });
    // 6c. The raw form `#""" … """#` is tracked too.
    cases.push({
      label: 'a `//` line inside a raw #""" block is MEASURED too',
      file: write("RawString.swift", `let js = #"""\n// ${long}\n"""#\n`), rule: "line_length", expect: true,
    });

    if (insecure) {
      // 7. http:// inside a DOC COMMENT must fire — two of PR #387's four failures.
      cases.push({
        label: "http:// in a doc comment fires insecure_url",
        file: write("CommentUrl.swift", "/// See http://example.com/docs for the wire format.\n"), rule: "insecure_url", expect: true,
      });
      // 8. http://localhost must NOT fire — the config's negative lookahead.
      cases.push({
        label: "http://localhost does NOT fire insecure_url",
        file: write("LocalUrl.swift", 'let base = "http://localhost:8080/v1"\n'), rule: "insecure_url", expect: false,
      });
      // 9. disable:next suppresses the line that follows it.
      cases.push({
        label: "swiftlint:disable:next suppresses insecure_url on the next line",
        file: write("Suppressed.swift", '// swiftlint:disable:next insecure_url\nlet loopback = "http://127.0.0.1:8080"\n'),
        rule: "insecure_url", expect: false,
      });
      // 10. The identical line WITHOUT the marker must fire — the negative control
      //     for case 9, and the whole reason case 9 proves anything.
      cases.push({
        label: "the same 127.0.0.1 line without the marker fires",
        file: write("Unsuppressed.swift", 'let loopback = "http://127.0.0.1:8080"\n'), rule: "insecure_url", expect: true,
      });
      // 11/12. A disable/enable REGION suppresses inside itself and not after.
      cases.push({
        label: "a disable/enable region suppresses inside it",
        file: write("Region.swift", '// swiftlint:disable insecure_url\nlet a = "http://a.example"\n// swiftlint:enable insecure_url\n'),
        rule: "insecure_url", expect: false,
      });
      cases.push({
        label: "after swiftlint:enable the rule fires again",
        file: write("RegionEnd.swift", '// swiftlint:disable insecure_url\nlet a = "http://a.example"\n// swiftlint:enable insecure_url\nlet b = "http://b.example"\n'),
        rule: "insecure_url", expect: true, expectLine: 4,
      });
      // 13. `enable all` ends a RULE-SPECIFIC region. Deleting by name matched
      //     nothing here, so the region outlived its terminator and this file
      //     reported nothing while CI failed on it.
      cases.push({
        label: "swiftlint:enable all ends a rule-specific disable region",
        file: write("EnableAll.swift", '// swiftlint:disable insecure_url\nlet a = "http://a.example"\n// swiftlint:enable all\nlet b = "http://b.example"\n'),
        rule: "insecure_url", expect: true, expectLine: 4,
      });
      // 13b. The other half of the same fix: a violation ON the enable line is
      //      reported, because the region is closed before it is snapshotted onto
      //      that line. Snapshot-then-parse swallowed it.
      cases.push({
        label: "a violation on the swiftlint:enable line itself is reported",
        file: write("EnableLine.swift", '// swiftlint:disable insecure_url\nlet a = "http://a.example"\nlet b = "http://b.example" // swiftlint:enable insecure_url\n'),
        rule: "insecure_url", expect: true, expectLine: 3,
      });
      // 14. disable:this on the same line.
      cases.push({
        label: "swiftlint:disable:this suppresses on its own line",
        file: write("This.swift", 'let c = "http://c.example" // swiftlint:disable:this insecure_url\n'),
        rule: "insecure_url", expect: false,
      });
      // 15. `all` is honoured like any other rule name.
      cases.push({
        label: "swiftlint:disable:next all suppresses insecure_url too",
        file: write("All.swift", '// swiftlint:disable:next all\nlet d = "http://d.example"\n'),
        rule: "insecure_url", expect: false,
      });
    }

    if (creds) {
      // 16/17. The other derived error rule had no planted case at all until now:
      //        a gate is only proven for the rules it has been watched to catch.
      cases.push({
        label: "a credential-shaped literal fires hardcoded_credentials",
        file: write("Creds.swift", 'let apiKey = "sk-live-abcdef"\n'), rule: "hardcoded_credentials", expect: true,
      });
      cases.push({
        label: "prose mentioning a password does NOT fire hardcoded_credentials",
        file: write("CredsProse.swift", 'label.text = "Enter your password"\n'), rule: "hardcoded_credentials", expect: false,
      });
    }

    for (const c of cases) {
      const hits = scanContent(c.file, c.file, readFileSync(c.file, "utf8"), cfg).filter((h) => h.rule === c.rule);
      const fired = hits.length > 0;
      let ok = fired === c.expect;
      let detail = `${hits.length}`;
      if (ok && c.expectLine !== undefined) {
        ok = hits.some((h) => h.line === c.expectLine);
        detail = `${hits.length} at line(s) ${hits.map((h) => h.line).join(",") || "-"} (wanted line ${c.expectLine})`;
      }
      notes.push(`  ${ok ? "ok  " : "FAIL"}  ${c.label} — expected ${c.expect ? "a violation" : "no violation"}, got ${detail}`);
      if (!ok) failures.push(c.label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("check-swift-serious --self-test");
  console.log(`  derived: strict=${cfg.strict} line_length.error=${cfg.lineLengthError} ignores_comments=${cfg.ignoresComments} error-rules=[${cfg.errorRules.map((r) => r.name).join(", ") || "none"}]`);
  for (const n of notes) console.log(n);
  if (failures.length) {
    console.error(`\nFAIL  self-test — ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`PASS  self-test — ${notes.length} assertion(s), both directions, against the live config.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------

function main() {
  const configFull = resolve(repo, CONFIG_PATH);
  if (!existsSync(configFull)) {
    console.error(`x ${CONFIG_PATH} not found — this gate mirrors that config and refuses to run without it.`);
    process.exit(1);
  }
  const configText = readFileSync(configFull, "utf8");
  const cfg = deriveConfig(configText);

  if (process.argv.includes("--self-test")) selfTest(cfg, configText);

  const all = trackedSwiftFiles();
  const scanned = all.filter((p) => !isExcluded(p.slice(IOS_DIR.length + 1), cfg));
  if (scanned.length < MIN_SWIFT_FILES) {
    console.error(`x scope floor: found only ${scanned.length} tracked .swift file(s) under ${IOS_DIR} (floor ${MIN_SWIFT_FILES}).`);
    console.error("  A gate scanning nothing is green about nothing — either the tree moved or `git ls-files` returned less than it should.");
    process.exit(1);
  }

  const violations = [];
  for (const p of scanned) {
    violations.push(...scanContent(p, p.slice(IOS_DIR.length + 1), readFileSync(resolve(repo, p), "utf8"), cfg));
  }

  console.log(`check-swift-serious — error-severity swiftlint rules, derived from ${CONFIG_PATH}`);
  console.log(`  strict: ${cfg.strict} (true would promote every warning to error; this gate refuses to run under it)`);
  console.log(`  line_length.error = ${cfg.lineLengthError} (ignores_comments: ${cfg.ignoresComments})`);
  for (const r of cfg.errorRules) console.log(`  GATED custom rule (error) ${r.name}: /${r.source}/`);
  if (cfg.unevaluable.length) console.log(`  NOT EVALUATED here, CI's swiftlint still enforces them: ${cfg.unevaluable.join(", ")}`);
  console.log(`  not gated here, severity is not error: ${cfg.skipped.join(", ") || "none"}`);
  console.log(`  excluded paths: ${cfg.excluded.join(", ")}`);
  console.log(`  scanned ${scanned.length} tracked .swift file(s) (${all.length - scanned.length} excluded)`);

  if (violations.length) {
    console.error("");
    for (const v of violations) console.error(`${v.path}:${v.line}:${v.col}: error: ${v.message} (${v.rule})`);
    console.error(`\nx ${violations.length} SERIOUS swiftlint violation(s) — the Lint & Security job in .github/workflows/ios-ci.yml fails the PR on these.`);
    process.exit(1);
  }
  console.log(`OK no error-severity violation across ${scanned.length} file(s). Warning-severity and AST rules remain CI swiftlint's business.`);
}

try {
  main();
} catch (err) {
  if (err instanceof GateError) {
    console.error(`x ${err.message}`);
    process.exit(1);
  }
  throw err;
}
