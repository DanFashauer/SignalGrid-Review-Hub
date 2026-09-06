#!/usr/bin/env node
// SwiftLint custom rules — each regex must fire on a planted positive and stay
// silent on a planted negative, with the fixtures named after the rule.
//
// WHY. `native/ios/.swiftlint.yml` declared a `force_unwrap` rule whose regex was
// `!\s*(as|is)` — a force CAST, never a force unwrap. The first-party skill
// `stack-reference/native.md` told every agent the rule "warns" on `.year!`; it
// could not, and `docs/agent/PONYTAIL_AUDIT_2026-09-01.md` repeated the name as one
// of the seven guards in place (thirteenth audit round, 2026-09-06). A lint rule
// nobody has ever seen fire is a check that did not run, read as a check that
// passed. The cloud lane has no swiftlint; what it CAN hold is the regex itself,
// which is why the fixtures live here and not in a Swift test target.
//
// SwiftLint compiles custom-rule regexes with NSRegularExpression (ICU). The
// constructs these rules use — character classes, alternation, `\s`, `\w`, `\b`,
// negative lookahead and a fixed-width lookbehind — mean the same thing in
// JavaScript, so a JS RegExp is a faithful oracle for THESE rules; a rule that used
// an ICU-only construct would fail to compile here and be reported, never assumed.
//
// Writing the fixtures found two MORE rules that had never fired on their subject:
// `force_cast` (the old force_unwrap regex, `!\s*(as|is)`) put the `!` on the wrong
// side of `as` and matched no Swift cast at all; `weak_delegate` fired on the very
// `weak var … Delegate` declaration it exists to recommend. Both are now the regex
// their name promises. Three of eight custom rules were decoration until today.
//
//   node scripts/check-swiftlint-rules.mjs [--self-test]

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG = "native/ios/.swiftlint.yml";

/** The planted lines. Every rule in the config must have an entry; every entry must name a rule in the config. */
export const FIXTURES = {
  hardcoded_credentials: {
    fires: ['let password = "hunter2"', "apiKey: 'abc'"],
    silent: ["let passwordField = UITextField()", "let password = keychain.read()"],
  },
  print_statement: {
    fires: ['print("hello")', "  print(value)"],
    silent: ["AuditLogger.info(value)", "debugPrint(value)"],
  },
  force_unwrap: {
    fires: ["Calendar.current.dateComponents([.year], from: d).year!", "let n = value!.count", "return items[0]!"],
    silent: ["if a != b {", "guard !isLocked else {", 'print("Done!")', "let n = value?.count"],
  },
  force_cast: {
    fires: ["let v = x as! Foo", "return dict[key] as! String"],
    silent: ["let v = x as? Foo", "let v = x as Foo", "if a != b {", "let alias = x"],
  },
  insecure_url: {
    fires: ['let u = "http://example.com/api"'],
    silent: ['let u = "https://example.com/api"', 'let u = "http://localhost:8080"'],
  },
  todo_without_severity: {
    fires: ["// TODO: fix this", "// FIXME:later"],
    silent: ["// TODO: HIGH fix this", "// FIXME: LOW cosmetic"],
  },
  weak_delegate: {
    fires: ["var sessionDelegate: SessionDelegate"],
    silent: ["weak var sessionDelegate: SessionDelegate?", "var delegateCount = 0"],
  },
  device_encryption: {
    fires: ["if isDataProtectionEnabled {"],
    silent: ["if isEncrypted {"],
  },
};

/** Pure: `{ name: { regex, severity } }` from the config's custom_rules block. */
export function customRulesIn(yaml) {
  const rules = {};
  const block = yaml.split(/^custom_rules:\s*$/m)[1];
  if (!block) return rules;
  let current = null;
  for (const line of block.split("\n")) {
    if (/^\S/.test(line)) break; // left the custom_rules mapping
    const head = /^ {2}([a-z_]+):\s*$/.exec(line);
    if (head) {
      current = head[1];
      rules[current] = {};
      continue;
    }
    const kv = /^ {4}(regex|severity):\s*(.+?)\s*$/.exec(line);
    if (kv && current) {
      let v = kv[2];
      if (kv[1] === "regex") v = JSON.parse(v); // YAML double-quoted scalar ≈ JSON string
      rules[current][kv[1]] = v;
    }
  }
  return rules;
}

/** Pure audit over parsed rules and the fixture table. */
export function auditRules(rules, fixtures = FIXTURES) {
  const fatal = [];
  const names = Object.keys(rules);
  if (names.length === 0) fatal.push(`${CONFIG}: no custom_rules parsed — the block moved or the parser broke; refusing to conclude anything`);
  for (const name of names) {
    const fx = fixtures[name];
    if (!fx) {
      fatal.push(`${name}: a custom rule with no planted fixture — nothing shows it can fire`);
      continue;
    }
    let re;
    try {
      re = new RegExp(rules[name].regex);
    } catch (e) {
      fatal.push(`${name}: regex does not compile as a JavaScript RegExp (${e.message}) — cannot be vouched for here`);
      continue;
    }
    for (const line of fx.fires) if (!re.test(line)) fatal.push(`${name}: does NOT fire on the planted positive ${JSON.stringify(line)} — the rule cannot catch what it is named for`);
    for (const line of fx.silent) if (re.test(line)) fatal.push(`${name}: fires on the planted negative ${JSON.stringify(line)} — a rule that cries wolf gets switched off`);
  }
  for (const name of Object.keys(fixtures)) if (!rules[name]) fatal.push(`fixture ${name} names a rule the config no longer declares — a fossil fixture`);
  return { fatal, rules: names.length };
}

function selfTest() {
  const checks = [];
  const yaml = readFileSync(join(repoRoot, CONFIG), "utf8");
  const rules = customRulesIn(yaml);
  checks.push(["the config parses to the eight custom rules the tree declares", Object.keys(rules).length === 8 && "force_unwrap" in rules && "force_cast" in rules]);
  const live = auditRules(rules);
  checks.push(["LIVE: every rule fires on its positives and stays silent on its negatives", live.fatal.length === 0]);
  const old = { ...rules, force_unwrap: { regex: "!\\s*(as|is)", severity: "warning" } };
  checks.push(["THE SHIPPED DEFECT: the old force_unwrap regex (a cast matcher) fails on `.year!` by name",
    auditRules(old).fatal.some((f) => f.startsWith("force_unwrap") && f.includes(".year!"))]);
  checks.push(["a rule with no fixture is FATAL — a rule nobody has seen fire is not a rule",
    auditRules({ ...rules, ghost_rule: { regex: "x", severity: "warning" } }).fatal.some((f) => f.includes("ghost_rule"))]);
  checks.push(["a fixture whose rule vanished is FATAL — a fossil fixture", auditRules(rules, { ...FIXTURES, gone: { fires: ["x"], silent: [] } }).fatal.some((f) => f.includes("gone"))]);
  checks.push(["an empty config refuses to conclude", auditRules({}).fatal.some((f) => f.includes("refusing"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const r = auditRules(customRulesIn(readFileSync(join(repoRoot, CONFIG), "utf8")));
  console.log(`SwiftLint custom rules — ${r.rules} rule(s) in ${CONFIG}, each held to planted positives and negatives.`);
  if (r.fatal.length > 0) {
    console.error(`\nSwiftLint-rules check FAILED: ${r.fatal.length} problem(s).`);
    for (const f of r.fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("SwiftLint-rules check passed — every custom rule fires on what it is named for and on nothing planted beside it.");
}
