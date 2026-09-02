#!/usr/bin/env node
// Port parity — the two Swift ports must not drift from their TS originals.
//
// Covers BOTH ported files: DecisionEngine.swift (which verdict) and
// AppWorkflows.swift (what the user then meets — auto, assist, step-up, blocked).
//
// `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is documented as a
// BYTE-FAITHFUL port of `lib/signalgrid-simulator/src/decisionEngine.ts`. That
// claim was true when written and is true today (verified: all 18 reason codes
// match). Nothing enforced it.
//
// That is the one drift in this repo with no ratchet, and it is the worst place
// to have one. Every other gate here exists because a claim can quietly stop
// being true — the SBOM, the sync manifest, the guard registry, the proof counts,
// the docs↔figure guard. A port is exactly that kind of claim: it is correct on
// the day it is written and decays silently afterwards, because the two files are
// edited by different people in different languages for different reasons, and
// nothing fails when only one of them changes.
//
// What silent divergence would mean here is not cosmetic. The iOS Assist gate is
// the product — the embedded gate is what a user actually meets. If the TS engine
// gains a rule and the port does not, the phone in someone's hand keeps returning
// the OLD verdict, confidently, with no error anywhere. It would not look broken.
// It would look like a device that decided differently from the fabric.
//
// WHAT THIS COMPARES, and why not a hash. Hashing the two files would fire on a
// comment or a reformat, and a gate that cries wolf gets bypassed — the repo
// already reasons this way about the enrollment-race skip. So this compares the
// DECISION VOCABULARY AND ITS WIRING, which is what a port has to preserve:
//
//   1. the set of reason codes each side can emit, and
//   2. for each reason code, the exact set of outcomes emitted alongside it.
//
// Both files state this identically — TS adds outcomes then pushes one code, Swift
// forms a union then appends the same code — so (2) is extractable as plain text
// with no parser and no Xcode, which matters because CI is linux and has neither.
// Renaming a variable or rewording a comment cannot trip it; changing what a
// verdict MEANS on one side and not the other always will.
//
// It cannot prove behavioural equivalence — only running both engines over shared
// vectors would, and that needs a Mac. It catches the failure that actually
// happens: a rule added, removed, or rewired on one side alone.
//
// SCOPE OF THE "DECLARED" SET (section 4). The core's reason codes are read from
// the SHARED_DEVICE_RULES_V1 array only — the ACTIVE shared-device policy. Draft
// rule sets in the same file (SHARED_DEVICE_RULES_V2 and any successor) are OUT
// OF SCOPE: their `*_STRICT` codes are a versioned draft nothing seeds by
// default, and counting them would let the demo mock emit a draft-only code and
// pass. If a draft is promoted, point CORE_RULES_ARRAY at the array that ships.
//
//   node scripts/check-decision-port-parity.mjs
//   node scripts/check-decision-port-parity.mjs --self-test   # self-tests ONLY
//
// `--self-test` is a real mode, not an accepted no-op: it runs the planted-defect
// suite, prints a passed/failed count and exits on it, so a step registered with
// that flag can never be green about nothing. The same suite also runs inline in
// the ordinary mode.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TS_PATH = "lib/signalgrid-simulator/src/decisionEngine.ts";
const SWIFT_PATH = "native/ios/EnterpriseShell/Services/DecisionEngine.swift";
const SELF_TEST_ONLY = process.argv.slice(2).includes("--self-test");

/** Strip comments so prose about a reason code is never read as emitting one. */
function code(src) {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/**
 * Extract reasonCode -> Set(signed outcome mutations) by walking the file in order.
 *
 * Both files write a rule as "mutate the outcome set, then name the reason", so a
 * code owns the mutations since the previous code.
 *
 * Mutations are SIGNED (`+allow`, `-allow`) because some rules REMOVE an outcome —
 * `ALLOW_REMOVED_DUE_TO_HIGHER_RISK` deletes `allow` — and a model that only saw
 * additions would read a removal as an emission. The first version of this guard
 * did exactly that and reported a divergence that did not exist: it matched Swift's
 * `formUnion([...])` but not its `insert(...)`, so one side accumulated outcomes
 * the other appeared to lack. Both engines were identical. That false positive is
 * why the shapes below are enumerated per language rather than assumed.
 */
function extract(src, { adds, removes, pushCode }) {
  const rules = new Map();
  let pending = new Set();
  const tokens = [];

  const collect = (patterns, sign) => {
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        // One formUnion([...]) can carry several outcomes; a single add carries one.
        for (const o of m[1].matchAll(/"([a-z_]+)"/g)) {
          tokens.push({ at: m.index, kind: "outcome", value: `${sign}${o[1]}` });
        }
      }
    }
  };
  collect(adds, "+");
  collect(removes, "-");

  pushCode.lastIndex = 0;
  for (const m of src.matchAll(pushCode)) tokens.push({ at: m.index, kind: "code", value: m[1] });
  tokens.sort((a, b) => a.at - b.at);

  for (const t of tokens) {
    if (t.kind === "outcome") {
      pending.add(t.value);
    } else {
      const existing = rules.get(t.value) ?? new Set();
      for (const o of pending) existing.add(o);
      rules.set(t.value, existing);
      pending = new Set();
    }
  }
  return rules;
}

const tsSrc = code(readFileSync(resolve(repo, TS_PATH), "utf8"));
const swiftSrc = code(readFileSync(resolve(repo, SWIFT_PATH), "utf8"));

const ts = extract(tsSrc, {
  adds: [/outcomes\.add\((\s*"[a-z_]+"\s*)\)/g],
  removes: [/outcomes\.delete\((\s*"[a-z_]+"\s*)\)/g],
  pushCode: /reasonCodes\.push\("([A-Z0-9_]+)"\)/g,
});
const swift = extract(swiftSrc, {
  // Swift writes additions BOTH ways — formUnion([...]) for several, insert() for
  // one. Missing the second form is what produced this guard's first false positive.
  adds: [/outcomes\.formUnion\(\[([^\]]*)\]\)/g, /outcomes\.insert\((\s*"[a-z_]+"\s*)\)/g],
  removes: [/outcomes\.remove\((\s*"[a-z_]+"\s*)\)/g],
  pushCode: /reasonCodes\.append\("([A-Z0-9_]+)"\)/g,
});

const say = (s) => console.log(s);

/**
 * Sections 1-3 and the declared core-only categories, as one function so that
 * `--self-test` can run the planted-defect suite WITHOUT running (or printing,
 * or exiting on) the real comparison.
 */
function checkEnginesAndWorkflows() {
  let problems = 0;

  if (ts.size === 0 || swift.size === 0) {
    console.error(
      `✗ extracted no rules (ts=${ts.size}, swift=${swift.size}). The emission shape in one of these\n` +
        `  files changed, so this guard is no longer reading them — which means it is no longer\n` +
        `  guarding anything. Fix the patterns rather than deleting the check.`,
    );
    process.exit(1);
  }

  // ── 1. vocabulary ──────────────────────────────────────────────────────────
  const onlyTs = [...ts.keys()].filter((k) => !swift.has(k)).sort();
  const onlySwift = [...swift.keys()].filter((k) => !ts.has(k)).sort();

  for (const c of onlyTs) {
    console.error(`  ✗ ${c}: emitted by the TS engine, ABSENT from the Swift port — the phone cannot express this verdict`);
    problems += 1;
  }
  for (const c of onlySwift) {
    console.error(`  ✗ ${c}: emitted by the Swift port, ABSENT from the TS engine — the port invented a verdict`);
    problems += 1;
  }

  // ── 2. wiring ──────────────────────────────────────────────────────────────
  // Same code on both sides, different consequences, is the subtle one: nothing is
  // missing, so a vocabulary check alone would pass while the two disagree.
  for (const [c, tsOutcomes] of [...ts.entries()].sort()) {
    const swOutcomes = swift.get(c);
    if (!swOutcomes) continue;
    const missing = [...tsOutcomes].filter((o) => !swOutcomes.has(o)).sort();
    const extra = [...swOutcomes].filter((o) => !tsOutcomes.has(o)).sort();
    if (missing.length || extra.length) {
      console.error(
        `  ✗ ${c}: the two engines disagree on what it does\n` +
          `      TS:    ${[...tsOutcomes].sort().join(", ") || "(none)"}\n` +
          `      Swift: ${[...swOutcomes].sort().join(", ") || "(none)"}`,
      );
      problems += 1;
    }
  }

  say(`decision-port parity: ${ts.size} TS rules vs ${swift.size} Swift rules, ${problems} divergence(s)`);

  // ── 3. AppWorkflows: the OTHER ported file ─────────────────────────────────
  // DecisionEngine decides; AppWorkflows turns that decision into what the user
  // meets — which action is automatic, which needs a confirmation, which is blocked.
  // It is the second byte-faithful port and carries the identical risk, so guarding
  // only the first would leave half the gate unratcheted.
  //
  // Its rules are not reason-code emissions, so the comparison above does not apply.
  // What it does have is a shared VOCABULARY — the same three enums and the same
  // four operations, declared as a union in TS and an enum in Swift. If TS gains a
  // disposition the port lacks, the device cannot express it; if the port loses an
  // operation, a screen silently stops gating. Both are extractable as text.
  const wfTsSrc = code(readFileSync(resolve(repo, WF_TS), "utf8"));
  const wfSwiftSrc = code(readFileSync(resolve(repo, WF_SWIFT), "utf8"));

  for (const name of ["AppRiskTier", "AppActionDisposition", "AppSessionMode"]) {
    const a = tsUnion(wfTsSrc, name);
    const b = swiftEnum(wfSwiftSrc, name);
    if (!a || !b) {
      console.error(`  ✗ ${name}: could not be read from ${!a ? WF_TS : WF_SWIFT} — the declaration shape changed, so this guard stopped guarding it`);
      problems += 1;
      continue;
    }
    const missing = [...a].filter((x) => !b.has(x)).sort();
    const extra = [...b].filter((x) => !a.has(x)).sort();
    if (missing.length || extra.length) {
      console.error(
        `  ✗ ${name}: vocabulary differs\n` +
          `      only in TS:    ${missing.join(", ") || "(none)"}\n` +
          `      only in Swift: ${extra.join(", ") || "(none)"}`,
      );
      problems += 1;
    }
  }

  // The operations the port must keep offering. A missing one is a screen that
  // silently stops gating rather than an error anyone would see.
  const wfTsFns = new Set([...wfTsSrc.matchAll(/export function ([a-zA-Z]+)\(/g)].map((m) => m[1]));
  const wfSwiftFns = new Set([...wfSwiftSrc.matchAll(/\n\s*static func ([a-zA-Z]+)\(/g)].map((m) => m[1]));
  for (const fn of ["planAppSession", "gateAppAction", "confirmAppActions", "completeAppStepUp"]) {
    if (!wfTsFns.has(fn)) {
      console.error(`  ✗ ${fn}: gone from ${WF_TS} — update this guard's expected list if that was intended`);
      problems += 1;
    } else if (!wfSwiftFns.has(fn)) {
      console.error(`  ✗ ${fn}: present in TS, ABSENT from the Swift port — that gating step does not run on the device`);
      problems += 1;
    }
  }

  say(`app-workflows parity: 3 enums + 4 operations compared`);

  // ── Declared core-only categories: the divergence must be LOUD, both ways ───
  //
  // The 2026-08-10 second scan found the gap this section pins: the product core
  // (`lib/signalgrid-core`) gained `device_management_health` and `local_authority`
  // with active restrict rules, while the simulator and its Swift port have no
  // vocabulary for either. This gate compares simulator↔Swift only — both sides
  // equally blind — so nothing could notice that /v1 restricts a device the phone
  // would allow. Day-one-quiet bounds the harm (a fleet not emitting the signals
  // sees no divergence), but an undeclared gap is exactly the class of silent
  // disagreement this repo refuses.
  //
  // So the gap is DECLARED, and the declaration is checked in both directions:
  //   · each declared category must exist in the core (else the entry is stale);
  //   · neither engine file may mention it (else the port started landing and the
  //     declaration is now hiding finished work — remove the entry and let the
  //     normal parity sections take over).
  // Porting them belongs to the Mac lane via the SignalContext pattern, never by
  // editing the ported engines' behaviour (CLAUDE.md golden rule 1).
  const coreTypesSrc = code(readFileSync(resolve(repo, "lib/signalgrid-core/src/types.ts"), "utf8"));
  for (const cat of CORE_ONLY_CATEGORIES) {
    if (!coreTypesSrc.includes(`"${cat}"`)) {
      console.error(`  ✗ ${cat}: declared core-only but ABSENT from the core's SIGNAL_CATEGORIES — stale declaration, delete it`);
      problems += 1;
    }
    const camel = cat.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    for (const [label, src] of [["simulator", tsSrc], ["Swift port", swiftSrc]]) {
      if (src.includes(cat) || src.includes(camel)) {
        console.error(
          `  ✗ ${cat}: declared core-only but the ${label} now mentions it — ` +
            `the port has begun; remove it from CORE_ONLY_CATEGORIES so the parity sections govern it`,
        );
        problems += 1;
      }
    }
  }
  say(`declared core-only categories: ${CORE_ONLY_CATEGORIES.length} pinned (core has them, neither engine does)`);

  return problems;
}

const WF_TS = "lib/app-workflows/src/index.ts";
const WF_SWIFT = "native/ios/EnterpriseShell/Services/AppWorkflows.swift";

/** `export type X = "a" | "b";` -> Set{a,b} */
function tsUnion(src, name) {
  const m = new RegExp(`export type ${name}\\s*=\\s*([^;]+);`).exec(src);
  if (!m) return null;
  return new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}
/** `enum X: String { case a, b }` -> Set{a,b} */
function swiftEnum(src, name) {
  const m = new RegExp(`enum ${name}\\s*:\\s*String\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) return null;
  const cases = new Set();
  for (const c of m[1].matchAll(/case\s+([a-zA-Z0-9_,\s]+)/g)) {
    for (const one of c[1].split(",")) {
      const t = one.trim();
      if (t) cases.add(t);
    }
  }
  return cases;
}

const CORE_ONLY_CATEGORIES = ["device_management_health", "local_authority"];

// ── 4. The THIRD engine: SignalGridMobile's mock ─────────────────────────────
//
// `MockSignalGridAPI.verdict(for:)` is a decision engine too. It is not a port of
// the simulator — it is a demo fixture with its own ten substring rules — but it
// emits REASON CODES and OUTCOMES into the Operator/Wardlink surfaces a buyer is
// shown, and nothing checked that the vocabulary it speaks is the product's.
// Sections 1-3 compare simulator↔EnterpriseShell only, so a code invented here,
// or one renamed in the core and left stale here, was invisible.
//
// This is deliberately WEAKER than the parity above, and the difference is the
// point: the mock is not required to implement every core rule (it is a fixture
// covering nine of them plus the trusted case), so this is a SUBSET check, not an
// equality check. What it forbids is the mock speaking a word the product does
// not define — an invented reason code, or an outcome outside the engine's four.
//
// SCOPE: GATED (subset + outcome membership) against the ACTIVE rule array only.
// NOT gated: whether the mock's rules AGREE with the core's rules for the same
// inputs — the mock matches on substrings of a demo identity ref, the core matches
// on evidence fields, and there is no shared vector set to replay. That gap is
// real and is reported, not claimed shut.
const MOCK_PATH = "native/ios/SignalGridMobile/SignalGridMobileCore/Sources/SignalGridMobileCore/MockSignalGridAPI.swift";
const MOCK_MODELS_PATH = "native/ios/SignalGridMobile/SignalGridMobileCore/Sources/SignalGridMobileCore/Models.swift";
// The core DEFINES its reason codes here, as the rule specs the seed installs —
// resolution.ts and remediation.ts merely key off them, and v1-openapi.yaml only
// documents them, so neither is the definition.
const CORE_RULES_PATH = "lib/signalgrid-core/src/policy.ts";
// …and it defines them TWICE: once in the active shared-device policy and again
// in the strict v2 DRAFT, which re-issues five rules under `*_STRICT` codes. The
// declared set is scoped to the active array so a draft-only code cannot be used
// to justify a mock emission. Point this at whichever array ships if v2 is
// promoted; the scoping, not the name, is the rule.
const CORE_RULES_ARRAY = "SHARED_DEVICE_RULES_V1";

/** The body of `verdict(for:)` — everything up to the first dedented `}`. */
function verdictBody(src) {
  const start = src.indexOf("static func verdict(for");
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.search(/\n {4}\}/);
  return end < 0 ? null : rest.slice(0, end);
}

/** `Verdict(.stepUp, "POSTURE_STALE", …)` -> [{outcomeCase, code}] */
function mockVerdicts(body) {
  return [...body.matchAll(/Verdict\(\s*\.([A-Za-z0-9_]+)\s*,\s*"([A-Z0-9_]+)"/g)].map((m) => ({
    outcomeCase: m[1],
    code: m[2],
  }));
}

/** `enum DecisionOutcome: String { case allow; case stepUp = "step_up" }` -> case -> rawValue */
function swiftRawValues(src, name) {
  const at = src.indexOf(`enum ${name}: String`);
  if (at < 0) return null;
  const rest = src.slice(at);
  const end = rest.search(/\n {4}public var|\n\}/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const map = new Map();
  for (const m of body.matchAll(/\n\s*case\s+([A-Za-z0-9_]+)(?:\s*=\s*"([a-z_]+)")?/g)) {
    map.set(m[1], m[2] ?? m[1]);
  }
  return map;
}

/**
 * The text of `export const NAME: PolicyRuleSpec[] = [ … ];`, or null.
 *
 * The array is bounded by its own closing `];` at column 0 — nested arrays inside
 * a rule spec are indented, so the first line-initial `];` after the declaration
 * is the end of the array and nothing else.
 */
function ruleArraySlice(src, name) {
  const decl = new RegExp(`export const ${name}\\s*:[^=]*=\\s*\\[`).exec(src);
  if (!decl) return null;
  const end = src.indexOf("\n];", decl.index);
  return end < 0 ? null : src.slice(decl.index, end + 3);
}

/**
 * Every reason code declared by the rule specs in `src`.
 *
 * ANCHORED to lines that are themselves a `reasonCode:` field, with any trailing
 * `//` comment on such a line cut off first. The previous version matched
 * `reasonCode: "X"` ANYWHERE in a source with only line-LEADING comments removed,
 * so a trailing `// retired: reasonCode: "X"` beside a live rule re-declared X and
 * the subset check below quietly accepted a code the core no longer emits. That is
 * fail-open: the gate would have stayed green while the demo spoke a dead word.
 */
function coreDeclaredCodes(src) {
  const out = new Set();
  for (const line of src.split("\n")) {
    if (!/^\s*reasonCode:/.test(line)) continue;
    const m = /^\s*reasonCode:\s*"([A-Z0-9_]+)"/.exec(line.split("//")[0]);
    if (m) out.add(m[1]);
  }
  return out;
}

/** The one comparison, factored out so the self-test can run it on synthetic input. */
function compareMock({ verdicts, rawValues, declared, validOutcomes }) {
  const found = [];
  for (const v of verdicts) {
    if (!declared.has(v.code)) {
      found.push(
        `  ✗ ${v.code}: emitted by ${MOCK_PATH} verdict(for:), NOT declared by the core's active rule specs ` +
          `(${CORE_RULES_ARRAY} in ${CORE_RULES_PATH}) — the demo surfaces a reason code the product does not define`,
      );
    }
    const raw = rawValues.get(v.outcomeCase);
    if (raw === undefined) {
      found.push(`  ✗ .${v.outcomeCase}: not a case of DecisionOutcome — the mock names an outcome the model lacks`);
    } else if (!validOutcomes.has(raw)) {
      found.push(`  ✗ "${raw}" (.${v.outcomeCase}) is outside the engine's VALID_OUTCOMES {${[...validOutcomes].join(", ")}}`);
    }
  }
  return found;
}

const mockSrc = code(readFileSync(resolve(repo, MOCK_PATH), "utf8"));
const mockBody = verdictBody(mockSrc);
const modelsSrc = code(readFileSync(resolve(repo, MOCK_MODELS_PATH), "utf8"));
const coreRulesSrc = code(readFileSync(resolve(repo, CORE_RULES_PATH), "utf8"));
const coreRulesSlice = ruleArraySlice(coreRulesSrc, CORE_RULES_ARRAY);

const outcomeRawValues = swiftRawValues(modelsSrc, "DecisionOutcome");
const declaredCodes = coreDeclaredCodes(coreRulesSlice ?? "");
// The whole file, used ONLY to measure how many codes the scoping excludes and to
// give the self-test a real draft-only code to plant. Never compared against.
const declaredCodesWholeFile = coreDeclaredCodes(coreRulesSrc);
// Derived from the engine's own guard set, never retyped here.
const validOutcomesMatch = /const VALID_OUTCOMES = new Set<DecisionOutcome>\(\[([^\]]*)\]\)/.exec(coreRulesSrc);
const validOutcomes = new Set(
  validOutcomesMatch ? [...validOutcomesMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [],
);

const mockRules = mockBody ? mockVerdicts(mockBody) : [];
const mockCodeSet = new Set(mockRules.map((r) => r.code));

// ── Floors: a gate that parsed nothing is green about nothing ────────────────
// The mock declares TEN distinct reason codes today (nine substring rules plus the
// trusted fall-through). The floor is the MEASURED number, not a slack one: at 8
// it tolerated two rules being routed through a constant (`Codes.identityDisabled`)
// rather than a string literal — invisible to this parse — and the gate would have
// gone on reporting green over eight checked rules and two unchecked ones. BUMP IT
// DELIBERATELY when a rule is added, the same discipline the proof counts use.
const MIN_MOCK_CODES = 10;
// The active array declares 26 codes today. This floor stays well under that on
// purpose: it exists to catch the parse breaking, not to pin the policy's size,
// and a rule legitimately retired must not turn into a red gate.
const MIN_CORE_CODES = 10;

function mockFloorProblems({ body, codeSet, slice, declared, rawValues, outcomes }) {
  const found = [];
  if (!body) {
    found.push(`  ✗ could not find verdict(for:) in ${MOCK_PATH} — the shape changed and this section stopped reading it`);
  } else if (codeSet.size < MIN_MOCK_CODES) {
    found.push(`  ✗ parsed only ${codeSet.size} reason code(s) from the mock, floor is ${MIN_MOCK_CODES} — the parse has drifted, not the code`);
  }
  if (!slice) {
    found.push(
      `  ✗ could not locate \`export const ${CORE_RULES_ARRAY}\` in ${CORE_RULES_PATH} — the declared set could not be scoped ` +
        `to the active policy, so the subset check has nothing trustworthy to compare against`,
    );
  }
  if (declared.size < MIN_CORE_CODES) {
    found.push(`  ✗ parsed only ${declared.size} reason code(s) from ${CORE_RULES_ARRAY} in ${CORE_RULES_PATH}, floor is ${MIN_CORE_CODES} — the declaration shape changed`);
  }
  if (!rawValues || rawValues.size === 0) {
    found.push(`  ✗ could not read DecisionOutcome from ${MOCK_MODELS_PATH} — outcome membership is unchecked`);
  }
  if (outcomes.size === 0) {
    found.push(`  ✗ could not read VALID_OUTCOMES from ${CORE_RULES_PATH} — outcome membership is unchecked`);
  }
  return found;
}

// ── Self-tests: the comparison must still be able to FAIL ────────────────────
// Planted defects run through the SAME functions the real check uses. A gate that
// cannot demonstrate a failure has not demonstrated a pass. Runs inline in the
// ordinary mode and is the whole of `--self-test`.
function runSelfTests() {
  const results = [];
  const t = (name, ok, detail) => results.push({ name, ok, detail });
  const rv = outcomeRawValues ?? new Map();
  const goodCase = [...rv.entries()].find(([, raw]) => validOutcomes.has(raw))?.[0] ?? "allow";

  const planted = compareMock({
    verdicts: [{ outcomeCase: "allow", code: "TOTALLY_INVENTED_CODE" }],
    rawValues: rv,
    declared: declaredCodes,
    validOutcomes,
  });
  t("invented reason code is flagged", planted.length > 0, `${planted.length} finding(s)`);

  const renamed = compareMock({
    verdicts: mockRules.slice(0, 1),
    rawValues: rv,
    // the core "renames" the code the mock still emits
    declared: new Set([...declaredCodes].filter((c) => c !== (mockRules[0]?.code ?? ""))),
    validOutcomes,
  });
  t("code renamed in the core, stale in the mock, is flagged", renamed.length > 0, `${renamed.length} finding(s)`);

  const badOutcome = compareMock({
    verdicts: [{ outcomeCase: "escalate", code: [...declaredCodes][0] }],
    rawValues: rv,
    declared: declaredCodes,
    validOutcomes,
  });
  t("outcome outside DecisionOutcome is flagged", badOutcome.length > 0, `${badOutcome.length} finding(s)`);

  // F1 — a TRAILING comment must not be able to declare a code. The old
  // extraction stripped only line-LEADING comments, so the ghost below counted.
  const trailing = coreDeclaredCodes(
    [
      '    reasonCode: "REAL_ONE",',
      '    reasonCode: "REAL_TWO", // retired: reasonCode: "GHOST_TRAILING"',
      '    // reasonCode: "GHOST_LEADING"',
      '    const note = `see reasonCode: "GHOST_INLINE"`;',
    ].join("\n"),
  );
  const trailingOk =
    trailing.has("REAL_ONE") &&
    trailing.has("REAL_TWO") &&
    !trailing.has("GHOST_TRAILING") &&
    !trailing.has("GHOST_LEADING") &&
    !trailing.has("GHOST_INLINE") &&
    trailing.size === 2;
  t("trailing `// … reasonCode: \"X\"` does NOT declare X", trailingOk, `extracted {${[...trailing].join(", ")}}`);

  // F2 — two rules routed through constants must trip the mock floor. Real mock
  // source, two literals swapped for the constant form this parse cannot see.
  const constantised = mockSrc
    .replace('"IDENTITY_DISABLED"', "Codes.identityDisabled")
    .replace('"BADGE_FORCED_REMOVAL"', "Codes.badgeForcedRemoval");
  const cBody = verdictBody(constantised);
  const cCodes = new Set((cBody ? mockVerdicts(cBody) : []).map((r) => r.code));
  const cFloor = mockFloorProblems({
    body: cBody,
    codeSet: cCodes,
    slice: coreRulesSlice,
    declared: declaredCodes,
    rawValues: rv,
    outcomes: validOutcomes,
  });
  const floorOk = cCodes.size === mockCodeSet.size - 2 && cFloor.some((p) => p.includes(`floor is ${MIN_MOCK_CODES}`));
  t(
    "two codes routed through constants trip the mock floor",
    floorOk,
    `${mockCodeSet.size} → ${cCodes.size} code(s) parsed, ${cFloor.length} floor finding(s)`,
  );

  // F3 — a code that exists ONLY in the draft rule set must be rejected. The
  // draft-only code is derived from the file and the slice DIRECTLY, never from
  // `declaredCodes`, so that a gate which stopped scoping fails this test instead
  // of quietly having nothing left to plant. If the draft ever stops carrying a
  // code the active array lacks, say so rather than pretending the scoping was
  // exercised.
  const scopedIndependently = coreDeclaredCodes(coreRulesSlice ?? "");
  const draftOnly = [...declaredCodesWholeFile].find((c) => !scopedIndependently.has(c));
  const draftPlant = compareMock({
    verdicts: [{ outcomeCase: goodCase, code: draftOnly ?? "SYNTHETIC_DRAFT_ONLY_CODE" }],
    rawValues: rv,
    declared: declaredCodes,
    validOutcomes,
  });
  t(
    "draft-only code planted into the mock is rejected",
    draftPlant.some((p) => p.includes(draftOnly ?? "SYNTHETIC_DRAFT_ONLY_CODE")),
    draftOnly
      ? `planted real draft-only code ${draftOnly}, ${draftPlant.length} finding(s)`
      : `NOTE: no draft-only code exists in the file today, so this ran on a synthetic code and did not exercise the scoping; ${draftPlant.length} finding(s)`,
  );
  t(
    "the scoped slice excludes the draft array",
    Boolean(coreRulesSlice) && !coreRulesSlice.includes("SHARED_DEVICE_RULES_V2"),
    coreRulesSlice ? `${coreRulesSlice.split("\n").length} line(s) scoped` : "no slice",
  );

  return results;
}

function checkMockSection() {
  let problems = 0;

  for (const line of mockFloorProblems({
    body: mockBody,
    codeSet: mockCodeSet,
    slice: coreRulesSlice,
    declared: declaredCodes,
    rawValues: outcomeRawValues,
    outcomes: validOutcomes,
  })) {
    console.error(line);
    problems += 1;
  }

  for (const r of runSelfTests()) {
    if (r.ok) continue;
    console.error(
      `  ✗ SELF-TEST FAILED: "${r.name}" (${r.detail}) — this section is reporting green ` +
        `without being able to go red. Run: node scripts/check-decision-port-parity.mjs --self-test`,
    );
    problems += 1;
  }

  for (const line of compareMock({
    verdicts: mockRules,
    rawValues: outcomeRawValues ?? new Map(),
    declared: declaredCodes,
    validOutcomes,
  })) {
    console.error(line);
    problems += 1;
  }

  const excluded = declaredCodesWholeFile.size - declaredCodes.size;
  say(
    `mock-engine vocabulary: ${mockCodeSet.size} reason code(s) in verdict(for:) ⊆ ${declaredCodes.size} declared by ` +
      `${CORE_RULES_ARRAY} in ${CORE_RULES_PATH}; outcomes within {${[...validOutcomes].join(", ")}}\n` +
      `  (scope: the ACTIVE rule array only — ${excluded} draft-only code(s) elsewhere in that file are OUT OF SCOPE.)\n` +
      `  (GATED: vocabulary only. NOT gated: whether the mock's substring rules agree with the core's ` +
      `evidence rules — no shared vectors exist to replay.)`,
  );
  return problems;
}

// ── main ─────────────────────────────────────────────────────────────────────
if (SELF_TEST_ONLY) {
  const results = runSelfTests();
  for (const r of results) say(`  ${r.ok ? "✓" : "✗"} ${r.name} — ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  say(`self-test: ${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\nSELF-TEST FAILED — this gate cannot demonstrate a planted defect, so its green means nothing.`);
    process.exit(1);
  }
  process.exit(0);
}

let problems = checkEnginesAndWorkflows();
problems += checkMockSection();

if (problems > 0) {
  console.error(
    `\nDecision-port parity FAILED.\n` +
      `  ${TS_PATH}\n  ${SWIFT_PATH}\n` +
      `A change to the decision engine must land on BOTH sides. The Swift port is what runs\n` +
      `on the device, so a port left behind does not fail — it quietly decides the old way.`,
  );
  process.exit(1);
}
say(
  "Port parity passed — DecisionEngine emits the same verdicts wired the same way, and\n" +
    "AppWorkflows offers the same vocabulary and the same gating operations.",
);
