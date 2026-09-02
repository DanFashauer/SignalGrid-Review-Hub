// check-ios-policy-defaults — a policy default may not be derived from the
// ABSENCE of policy.
//
//   node scripts/check-ios-policy-defaults.mjs             the guard
//   node scripts/check-ios-policy-defaults.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// `KioskConfig` reads Managed App Configuration — the dictionary an MDM delivers
// under `com.apple.configuration.managed` — through a family of accessors whose
// last argument is the value used WHEN THE KEY IS NOT THERE. An in-flight iOS
// batch grew a derived one:
//
//     static var isManaged: Bool { managed != nil }
//     ...
//     managedBool("AllowManualOverride", default: !isManaged)   // <- LOOSENS
//
// which reads "if no MDM handed us a dictionary, allow the badge-less manual
// override". Absence of a dictionary is not evidence of an unmanaged device: a
// SUPERVISED device whose admin never attached an app-config payload has none
// either, and neither does one whose payload failed to install. So the phone the
// org believes is captive is the phone that hands out the manual override — the
// unknown state loosened the answer. CLAUDE.md's second golden rule is the
// inverse: "an unknown/unreachable signal raises assurance, never lowers it".
//
// This is the same defect as check-nan-fail-open's, in Swift instead of TS: a
// value the code could not read becoming the value that grants.
//
// WHAT IS GATED (unambiguous only)
// --------------------------------
//   1. A managed-config accessor call whose `default:` expression references the
//      management state itself — `isManaged`, or the `managed` dictionary — is
//      flagged, UNLESS the accessor's default type is Bool AND the expression is
//      one of the two shapes that provably resolve to `false` when the dictionary
//      is absent: `isManaged` and `managed != nil` (optionally qualified, e.g.
//      `KioskConfig.isManaged`). Those TIGHTEN on absence, which is the doctrine.
//      Everything else that touches management state is flagged, including
//      `!isManaged`, `managed == nil` and any ternary: this is a recognised-safe
//      list, not a Swift evaluator, and it fails CLOSED on a shape it cannot
//      prove. A new shape that genuinely tightens gets ADDED here, deliberately.
//   2. For a NON-Bool default (String, Int, …) any management-derived expression
//      is flagged, full stop. "Restrictive" is not decidable for a string or a
//      number — there is no false to resolve to — so the gate does not pretend to
//      judge it. Write a literal.
//   3. A `default:` expression reading `UserDefaults.standard.bool(forKey:)` or
//      `.dictionary(forKey:)` is flagged whatever its type. That is unmanaged,
//      locally-writable state; a policy default derived from it is decided by the
//      device, not the admin.
//
// SCOPE IS DERIVED, NOT LISTED. The accessor family is read out of the Swift
// itself — every `static func` whose body reads the managed dictionary
// (`UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed")`),
// directly or TRANSITIVELY through another declaration in the same file (a
// `managed` / `managedConfiguration` computed var, or another accessor), with the
// type of its `default:` parameter — so an accessor added tomorrow is covered the
// day it lands whatever it is called, and a renamed anchor makes the derivation
// floor fail loudly rather than scanning for a name that no longer exists. An
// earlier version anchored the family on the NAME prefix `managed…`, and
// `ProviderConfigurationService.configured(env:managed:)` — which reads the same
// dictionary — was invisible to it. A static func that reads nothing managed (a
// display or formatting helper) stays outside the family; the self-test plants one.
// Transitivity is per file: a cross-file read through another type's computed
// property is a limit, stated, not a judgement.
//
// COMMENTS AND STRING LITERALS ARE MASKED (scripts/lib/sanitize.mjs, shared with
// check-nan-fail-open). This header quotes the defective line verbatim, the fix
// commit does, and the docs do. A gate that matched raw text would fire on the
// prose explaining the bug and punish writing the explanation down.
//
// LIMITS, said out loud: single-level variable substitution only (a default that
// is a local alias for an expression is resolved once, no further); no dataflow
// through functions; a management-derived value that reaches a default via a
// computed property is not followed. Those cases are missed, not judged safe.
//
// SELF-TEST: 14 planted Swift fixtures in a temp dir drive the real derivation
// and the real scanner in both directions, and the REAL KioskController.swift is
// run as a plant/remove pair in memory — every default rewritten to `false` must
// come back clean, then `!isManaged` planted in one of them must come back as
// exactly one hit. Both twins are derived from the file, so the control holds
// whether or not the tree currently carries the defect. A gate that has never
// failed proves nothing.

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = resolve(repo, "native/ios");
const SKIP_DIRS = new Set(["build", ".build", "DerivedData", "Pods", ".git"]);

// The anchor the gate was written for. Not a scope list — the scope is derived
// below — but a FLOOR: if this accessor stops existing under this name, the
// derivation has drifted and the gate must refuse rather than report zero.
const ANCHOR_ACCESSOR = "managedBool";
const FILE_FLOOR = 40;

// ── derivation ───────────────────────────────────────────────────────────────
// Every `static var` / `static func` declaration in a file with its body, found
// on the SANITIZED text (comments and string literals masked, length preserved)
// so a declaration quoted in a comment is not a declaration. A stored property
// (`static var x: T?` with no body) yields no body: the scan for its `{` stops at
// the next line that begins another declaration, rather than borrowing the body
// of whatever comes next.
const DECL_RE = /\b(?:private\s+|fileprivate\s+|internal\s+|public\s+)?static\s+(var|func)\s+([A-Za-z_]\w*)/g;
const DEFAULT_PARAM_RE = /\bdefault\s+[A-Za-z_]\w*\s*:\s*([A-Za-z_][\w.<>?\[\]]*)/;
const NEXT_DECL_RE = /^\s*(?:\}|@|private\b|fileprivate\b|internal\b|public\b|static\b|func\b|var\b|let\b|init\b|deinit\b|case\b|enum\b|struct\b|class\b|extension\b|protocol\b)/;
// The read that makes a declaration a managed-dictionary reader. Matched on the
// RAW text — sanitize() masks the string literal this key lives in.
const MANAGED_DICT_READ = /UserDefaults\s*\.\s*standard\s*\.\s*dictionary\s*\(\s*forKey\s*:\s*"com\.apple\.configuration\.managed"\s*\)/;

function declarations(rawSource) {
  const san = sanitize(rawSource);
  const out = [];
  for (const m of san.matchAll(DECL_RE)) {
    const kind = m[1];
    const name = m[2];
    let i = m.index + m[0].length;
    let depth = 0;
    let open = -1;
    for (; i < san.length; i += 1) {
      const c = san[i];
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth -= 1;
      else if (c === "{" && depth === 0) { open = i; break; }
      else if (c === "\n" && depth === 0) {
        const rest = san.slice(i + 1, san.indexOf("\n", i + 1) === -1 ? san.length : san.indexOf("\n", i + 1));
        if (NEXT_DECL_RE.test(rest)) break;
      }
    }
    if (open === -1) continue;
    depth = 0;
    let close = -1;
    for (let j = open; j < san.length; j += 1) {
      if (san[j] === "{") depth += 1;
      else if (san[j] === "}") { depth -= 1; if (depth === 0) { close = j; break; } }
    }
    if (close === -1) continue;
    const signature = san.slice(m.index, open);
    out.push({
      kind,
      name,
      line: san.slice(0, m.index).split("\n").length,
      defaultType: DEFAULT_PARAM_RE.exec(signature)?.[1] ?? null,
      bodySan: san.slice(open, close + 1),
      bodyRaw: rawSource.slice(open, close + 1),
    });
  }
  return out;
}

/**
 * The accessor family: every static func that reads the managed dictionary, directly
 * or through another declaration in the same file, with the type of its `default:`
 * parameter if it has one. Computed vars (`managed`, `isManaged`) are readers that
 * carry the read to the funcs; they are not accessors themselves.
 */
function deriveAccessors(files) {
  const accessors = new Map();
  for (const f of files) {
    const decls = declarations(readFileSync(f, "utf8"));
    const readers = new Set(decls.filter((d) => MANAGED_DICT_READ.test(d.bodyRaw)).map((d) => d.name));
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of decls) {
        if (readers.has(d.name)) continue;
        for (const r of readers) {
          if (new RegExp(`\\b${r}\\b`).test(d.bodySan)) { readers.add(d.name); grew = true; break; }
        }
      }
    }
    for (const d of decls) {
      if (d.kind !== "func" || !readers.has(d.name)) continue;
      const prior = accessors.get(d.name);
      // OVERLOADS. `managedString(_:default:)` and `managedString(_:)` are one
      // name with two shapes, and whichever came LAST used to win — so a
      // no-default overload declared below the real accessor erased its type and
      // every Bool default under it became "non-Bool", flagging `default:
      // isManaged`, which is correct, tightening code. A gate that punishes the
      // honest shape is the gate that is wrong. A declared default TYPE wins over
      // an overload that has none.
      if (prior && prior.defaultType !== null && d.defaultType === null) continue;
      accessors.set(d.name, { name: d.name, defaultType: d.defaultType, file: f, line: d.line });
    }
  }
  return accessors;
}

// ── expression classification ────────────────────────────────────────────────
const MANAGEMENT_REF = /\bisManaged\b|\bmanaged\b/;
const UNMANAGED_STORE = /UserDefaults\s*\.\s*standard\s*\.\s*(?:bool|dictionary)\s*\(\s*forKey/;
// The only two shapes proven to resolve to FALSE when the dictionary is absent.
const TIGHTENS_ON_ABSENCE = new Set(["isManaged", "managed != nil"]);

const norm = (expr) => {
  let e = expr.replace(/\s+/g, " ").trim();
  while (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1).trim();
  return e.replace(/\b(?:KioskConfig|Self|self)\s*\.\s*/g, "");
};

function classify(expr, defaultType, aliases, depth = 0) {
  const e = norm(expr);
  if (UNMANAGED_STORE.test(e)) {
    return { flag: true, why: "default read from UserDefaults.standard — unmanaged, device-writable state deciding policy" };
  }
  if (!MANAGEMENT_REF.test(e)) {
    // A bare identifier may be a local alias for a management-derived
    // expression. Resolve ONE level, then stop.
    if (depth === 0 && /^[A-Za-z_]\w*$/.test(e) && aliases.has(e)) {
      return classify(aliases.get(e), defaultType, aliases, depth + 1);
    }
    return { flag: false };
  }
  if (defaultType === "Bool" && TIGHTENS_ON_ABSENCE.has(e)) {
    return { flag: false };
  }
  if (defaultType === "Bool") {
    return { flag: true, why: "Bool default derived from management state and not provably false when the dictionary is absent" };
  }
  return { flag: true, why: `${defaultType ?? "non-Bool"} default derived from management state — restrictiveness is not decidable here; use a literal` };
}

// ── scanning ─────────────────────────────────────────────────────────────────
// `let/var X = <expr>` — one-level aliases, so `let d = !isManaged` used as a
// default is still caught, and `let d = isManaged` is still allowed.
const ALIAS_RE = /(?:let|var)\s+([A-Za-z_]\w*)\s*(?::\s*[A-Za-z_][\w.<>?\[\]]*\s*)?=\s*([^\n]+)/g;

/** Balanced-paren argument text starting at the index of an opening paren. */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return { text: src.slice(open + 1, i), start: open + 1 };
    }
  }
  return null;
}

/** Offset of the top-level `default:` label inside an argument list, or -1. */
function defaultArgAt(args) {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && args.startsWith("default", i) && /[:\s]/.test(args[i + 7] ?? "")) {
      const colon = args.indexOf(":", i);
      if (colon !== -1) return colon + 1;
    }
  }
  return -1;
}

/** Slice a top-level argument: from `from` to the next depth-0 comma or the end. */
function argSlice(args, from) {
  let depth = 0;
  for (let i = from; i < args.length; i += 1) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "," && depth === 0) return args.slice(from, i);
  }
  return args.slice(from);
}

/**
 * Every accessor call that passes a `default:`, with the ABSOLUTE offsets of the
 * default expression. sanitize() is length-preserving, so offsets taken from the
 * sanitized text index the raw text too — which is what lets the self-test
 * rewrite defaults in the real file.
 */
function callSites(rawSource, accessors) {
  const src = sanitize(rawSource);
  const sites = [];
  const names = [...accessors.keys()];
  if (names.length === 0) return sites;
  const callRe = new RegExp(`\\b(${names.join("|")})\\s*\\(`, "g");
  for (const m of src.matchAll(callRe)) {
    // A definition is not a call site.
    if (/\bfunc\s*$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    const open = m.index + m[0].length - 1;
    const args = argsAt(src, open);
    if (!args) continue;
    const off = defaultArgAt(args.text);
    if (off === -1) continue;
    const raw = argSlice(args.text, off);
    const lead = raw.length - raw.trimStart().length;
    const start = args.start + off + lead;
    const expr = raw.trim();
    // Classification runs on the SANITIZED expression (that is the point), but
    // the report quotes the RAW one — offsets are shared because sanitize is
    // length-preserving. Reporting the sanitized text printed a string-literal
    // default as `managed == nil ? " " : " "`, which named the line and then
    // hid what was on it.
    sites.push({
      accessor: m[1],
      expr,
      rawExpr: rawSource.slice(start, start + expr.length),
      start,
      end: start + expr.length,
      line: src.slice(0, start).split("\n").length,
    });
  }
  return sites;
}

/** Replace the default expressions at the given sites (raw text, offsets from callSites). */
function rewriteDefaults(rawSource, sites, replacement) {
  let out = rawSource;
  for (const s of [...sites].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + replacement + out.slice(s.end);
  }
  return out;
}

function findViolations(rawSource, accessors) {
  const aliases = new Map();
  for (const m of sanitize(rawSource).matchAll(ALIAS_RE)) aliases.set(m[1], m[2]);
  const hits = [];
  for (const s of callSites(rawSource, accessors)) {
    const type = accessors.get(s.accessor).defaultType;
    const verdict = classify(s.expr, type, aliases);
    if (!verdict.flag) continue;
    hits.push({ line: s.line, accessor: s.accessor, type, expr: s.rawExpr.replace(/\s+/g, " "), why: verdict.why });
  }
  return hits;
}

function swiftFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...swiftFiles(p));
    else if (e.name.endsWith(".swift")) out.push(p);
  }
  return out.sort();
}

// ── self-test ────────────────────────────────────────────────────────────────
const FIXTURE_DEFS = `enum FixtureConfig {
    private static var managed: [String: Any]? {
        UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed")
    }
    static var isManaged: Bool { managed != nil }
    private static var storedNotABody: String?
    private static let lock = NSLock()
    private static func managedBool(_ key: String, default def: Bool) -> Bool { (managed?[key] as? Bool) ?? def }
    private static func managedString(_ key: String, default def: String) -> String { (managed?[key] as? String) ?? def }
    private static func managedInt(_ key: String, default def: Int) -> Int { (managed?[key] as? Int) ?? def }
    private static func managedBool(_ key: String) -> Bool? { managed?[key] as? Bool }
    private static func managedString(_ key: String) -> String? { managed?[key] as? String }
    // The ProviderConfigurationService shape: a differently-named accessor reading
    // the same dictionary through its own computed var, two hops from the read.
    private static var managedConfiguration: [String: Any]? {
        UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed")
    }
    private static func configured(env: String, managed key: String) -> String? { managedConfiguration?[key] as? String }
    private static func configuredBool(env: String, managed key: String, default def: Bool) -> Bool { (managedConfiguration?[key] as? Bool) ?? def }
    // Display-only: a static func that reads nothing managed stays OUT of the family.
    private static func displayName(_ key: String, default def: String) -> String { key.isEmpty ? def : key.uppercased() }
    // A declaration quoted in a comment is not a declaration:
    // private static func managedFromComment(_ key: String, default def: Bool) -> Bool { def }
}
`;

const CASES = [
  ["negated isManaged — the in-flight defect", `let a = managedBool("AllowManualOverride", default: !isManaged)`, true],
  ["bare isManaged is false when absent — allowed", `let a = managedBool("AllowManualOverride", default: isManaged)`, false],
  ["managed == nil", `let a = managedBool("K", default: managed == nil)`, true],
  ["managed != nil is false when absent — allowed", `let a = managedBool("K", default: managed != nil)`, false],
  ["qualified isManaged — allowed", `let a = managedBool("K", default: KioskConfig.isManaged)`, false],
  ["String default derived from management state", `let a = managedString("K", default: isManaged ? "strict" : "open")`, true],
  ["Int default derived from management state", `let a = managedInt("K", default: isManaged ? 1 : 0)`, true],
  ["plain literal default — allowed", `let a = managedBool("SingleAppModeEnabled", default: true)`, false],
  ["default computed from another managed key — allowed", `let a = managedBool("A", default: managedBool("B", default: false))`, false],
  ["comment quoting the defect is not a call site", `// managedBool("A", default: !isManaged)`, false],
  ["the same expression inside a string literal", `let doc = "managedBool(\\"A\\", default: !isManaged)"`, false],
  ["UserDefaults.standard.bool as the default", `let a = managedBool("K", default: UserDefaults.standard.bool(forKey: "K"))`, true],
  ["alias for a loosening expression", `let unmanagedDefault = !isManaged\nlet a = managedBool("K", default: unmanagedDefault)`, true],
  ["multi-line call, negated", `let a = managedBool(\n    "K",\n    default: !isManaged\n)`, true],
  ["differently-named accessor (configured… shape), negated", `let a = configuredBool(env: "E", managed: "K", default: !isManaged)`, true],
  ["differently-named accessor, literal default — allowed", `let a = configuredBool(env: "E", managed: "K", default: false)`, false],
  ["display-only helper is outside the family even with a loosening-shaped default", `let a = displayName("K", default: isManaged ? "a" : "b")`, false],
];

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "ios-policy-defaults-"));
  const failures = [];
  try {
    mkdirSync(join(dir, "Fixtures"), { recursive: true });
    writeFileSync(join(dir, "Fixtures", "Defs.swift"), FIXTURE_DEFS);
    CASES.forEach(([name, body], i) => {
      writeFileSync(join(dir, "Fixtures", `Case${i}.swift`), `enum C${i} {\n    ${body}\n}\n`);
    });
    const files = swiftFiles(dir);
    const accessors = deriveAccessors(files);
    // The derivation itself is under test: three accessors, with their types.
    const derived = [...accessors.keys()].sort().join(",");
    if (derived !== "configured,configuredBool,managedBool,managedInt,managedString") {
      failures.push(`derivation found "${derived}", expected configured,configuredBool,managedBool,managedInt,managedString (display-only and commented-out declarations excluded)`);
    }
    if (accessors.get("configuredBool")?.defaultType !== "Bool" || accessors.get("configured")?.defaultType !== null) {
      failures.push("derivation did not read the default: type of the configured… shape (Bool for configuredBool, none for configured)");
    }
    if (accessors.get("managedBool")?.defaultType !== "Bool" || accessors.get("managedString")?.defaultType !== "String") {
      failures.push("derivation did not read the default: parameter types out of the fixture definitions");
    }
    CASES.forEach(([name, , shouldFlag], i) => {
      const src = readFileSync(join(dir, "Fixtures", `Case${i}.swift`), "utf8");
      const flagged = findViolations(src, accessors).length > 0;
      if (flagged !== shouldFlag) failures.push(`${shouldFlag ? "MISSED" : "FALSE POSITIVE"}: ${name}`);
    });

    // Plant and remove on the REAL file. Both twins are DERIVED from it rather
    // than from its current state: the "removed" twin rewrites every default in
    // the file to the restrictive literal `false` and must come back clean, and
    // the "planted" twin then puts `!isManaged` into exactly one of them and must
    // come back with exactly that one. This is deliberately independent of
    // whether the tree currently carries the defect — an earlier version asserted
    // the file was already clean, which turned a REAL violation into a confusing
    // self-test refusal instead of the file:line report the gate exists to print.
    const kiosk = join(IOS, "EnterpriseShell/Services/KioskController.swift");
    const real = readFileSync(kiosk, "utf8");
    const realAccessors = deriveAccessors([kiosk]);
    const realSites = callSites(real, realAccessors);
    if (!realAccessors.has(ANCHOR_ACCESSOR)) {
      failures.push(`the real KioskController.swift no longer defines ${ANCHOR_ACCESSOR}(_:default:) — derivation drifted`);
    } else if (realSites.length === 0) {
      failures.push("no managed-config call with a `default:` found in the real KioskController.swift — the call shape changed");
    } else {
      const removed = rewriteDefaults(real, realSites, "false");
      if (findViolations(removed, realAccessors).length !== 0) {
        failures.push("the removed twin (every default rewritten to the literal `false`) still flags — the classifier is over-firing");
      }
      const planted = rewriteDefaults(removed, callSites(removed, realAccessors).slice(0, 1), "!isManaged");
      const plantedHits = findViolations(planted, realAccessors);
      if (plantedHits.length !== 1) {
        failures.push(`planting \`default: !isManaged\` in the real KioskController.swift yielded ${plantedHits.length} hit(s), expected exactly 1`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

const failures = selfTest();
if (failures.length > 0) {
  console.error("FAIL  self-test — the detector no longer behaves as required:");
  for (const f of failures) console.error(`    · ${f}`);
  console.error("\nA gate that cannot flag a planted violation is green about nothing.");
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log(
    `PASS  self-test — ${CASES.length} planted fixtures behave in both directions, the accessor derivation ` +
      "reads its five names and types out of the Swift by following the managed-dictionary read (not a name prefix), " +
      "excludes a display-only helper and a commented-out declaration, and — in the real KioskController.swift — every default " +
      "rewritten to the literal `false` comes back clean while `!isManaged` planted in one of them comes back as " +
      "exactly one hit.",
  );
  process.exit(0);
}

// ── the guard ────────────────────────────────────────────────────────────────
const files = swiftFiles(IOS);
if (files.length < FILE_FLOOR) {
  console.error(
    `x Only ${files.length} .swift file(s) found under native/ios (floor ${FILE_FLOOR}) — the walk is not reaching the tree it is supposed to cover.`,
  );
  process.exit(1);
}
const accessors = deriveAccessors(files);
if (!accessors.has(ANCHOR_ACCESSOR)) {
  console.error(
    `x No \`static func ${ANCHOR_ACCESSOR}(_ key: String, …)\` found in the tree. The managed-config accessor ` +
      "family is DERIVED from those definitions; if it moved or was renamed this gate is scanning for a name that no " +
      "longer exists, and reporting zero would be a lie. Update ANCHOR_ACCESSOR once you have confirmed the new shape.",
  );
  process.exit(1);
}
const withDefault = [...accessors.values()].filter((a) => a.defaultType !== null);
if (withDefault.length === 0) {
  console.error("x Derived accessors carry no `default:` parameter — nothing to check, which means the derivation drifted.");
  process.exit(1);
}

console.log("iOS policy defaults — a default may not be derived from the ABSENCE of managed configuration\n");
console.log(
  `  DERIVED accessor family (${accessors.size}): ` +
    [...accessors.values()].map((a) => `${a.name}(_:${a.defaultType ? `default:${a.defaultType}` : ""}) @ ${relative(repo, a.file)}:${a.line}`).join(", "),
);

let problems = 0;
for (const f of files) {
  for (const h of findViolations(readFileSync(f, "utf8"), accessors)) {
    console.error(
      `\n  x ${relative(repo, f)}:${h.line}  ${h.accessor}(…, default: ${h.expr})\n` +
        `      default expression: ${h.expr}\n` +
        `      ${h.why}`,
    );
    problems += 1;
  }
}

console.log(`\nios-policy-defaults: ${files.length} .swift file(s) scanned, ${problems} violation(s); self-test green`);
if (problems > 0) {
  console.error(
    "\niOS policy-defaults gate FAILED. An absent `com.apple.configuration.managed` dictionary is an UNKNOWN\n" +
      "management state, not a known-unmanaged one: a supervised device whose admin never attached an app-config\n" +
      "payload has none either. Deriving a LOOSER default from that absence hands the unenforced case the\n" +
      "permission. Unknown must tighten the answer, never loosen it — write the restrictive literal, and if the\n" +
      "unmanaged build genuinely needs a way in, give it an explicit, separately-named affordance.",
  );
  process.exit(1);
}
console.log("iOS policy-defaults gate passed — every managed-config default is a literal or provably tightens when policy is absent.");
