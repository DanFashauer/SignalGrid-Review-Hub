// Build the fully client-side Trusted Room Entry console.
//
// Bundles the decision core + orchestration + scenarios (@workspace/room-sim
// browser entry) with esbuild, then inlines the bundle into the UI shell to
// produce a single self-contained HTML file that runs entirely in the browser —
// no server, no network, works on iPhone/iPad.
//
//   node scripts/build-room-console.mjs
//
// Output: docs/room-entry-console.html
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const result = await esbuild.build({
  entryPoints: [resolve(repo, "lib/room-sim/src/browser.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
});
const bundle = result.outputFiles[0].text;
if (bundle.includes("</script")) throw new Error("bundle contains a </script token; cannot inline safely");

// THE BUNDLE MUST CARRY THE SCENARIOS, not just compile. Three ids from the three
// domains: if the browser entry stops re-exporting the catalogue, the page would
// still build and show an empty list.
for (const marker of ["compliant-standard", "wh-noncompliant-pick", "gf-disabled-field"]) {
  if (!bundle.includes(marker)) throw new Error(`bundle is missing scenario "${marker}"; the catalogue was not linked in`);
}

const shell = readFileSync(resolve(repo, "tools/room-console/shell.html"), "utf8");
// The marker guard: `String.replace` with a missing needle is a silent no-op, and
// the page would ship with an empty <script> and no engine.
if (!shell.includes("/*__BUNDLE__*/")) throw new Error("tools/room-console/shell.html has no /*__BUNDLE__*/ marker; nothing to inline into");

// ── sigClass VECTORS, DERIVED FROM THE CORE ─────────────────────────────────
//
// The page renders every field of `DecisionEvidence` through `sigClass`, and the page
// has no other test, so its colouring is verified HERE, at build time, by executing the
// shell's own function against every member of every union the interface names.
//
// THE SCOPE IS DERIVED, NEVER HAND-LISTED. This block used to hold 41 hand-written
// vectors, and a hand-written list can only ever catch the values somebody remembered.
// It contained no member of `ManagementHealthState`, `LocalAuthorityGrantState`,
// `BatteryHealthState`, `CustodyState` or `TamperState` — so it passed, green, while
// `sigClass("broken")` returned 'ok' (the management-health FAILURE state in the allow
// green, because "broken" contains "ok") and `sigClass("none")` returned 'bad' (the
// HEALTHY tamper state in the deny red). Both were found by reading the unions, which is
// exactly what this now does instead of remembering them.
//
// So: `lib/signalgrid-core/src/types.ts` is parsed for the `DecisionEvidence` interface
// and for every string union / `as const` array it refers to, and EXPECTED_CLASSES below
// must classify every member of every one of them. A member added to the core, removed
// from it, or renamed fails this build until it is classified — in both directions, so a
// stale entry is as fatal as a missing one.
//
// WHAT IS DERIVED AND WHAT IS JUDGEMENT, stated plainly: the SCOPE (which fields exist,
// which values each can take) is derived from the core. The COLOUR each value gets is a
// judgement, written once in EXPECTED_CLASSES, and it is the thing worth reviewing.
const TYPES_REL = "lib/signalgrid-core/src/types.ts";
const typesSrc = readFileSync(resolve(repo, TYPES_REL), "utf8");

/**
 * `export type Name = "a" | "b";` → Map name → members.
 *
 * Single-quantifier by construction, the same shape (and for the same reason) as
 * `check-dock-firmware-contract.mjs`: `(?:\s*\|?\s*"[^"]*")+` is ambiguous and
 * backtracks exponentially, and a gate that can be made to hang is a gate that stops
 * gating. Capture the right-hand side with one `[^;]*`, pull the quoted values out, and
 * refuse anything whose residue is not pipes and whitespace — a mapped type, a template
 * literal or a reference is skipped rather than half-understood.
 */
function parseStringUnions(source) {
  const unions = new Map();
  for (const m of source.matchAll(/export type (\w+)\s*=\s*([^;]*);/g)) {
    const rhs = m[2];
    const values = [...rhs.matchAll(/"([^"]*)"/g)].map((v) => v[1]);
    if (values.length === 0) continue;
    if (!/^[|\s]*$/.test(rhs.replace(/"[^"]*"/g, ""))) continue;
    unions.set(m[1], values);
  }
  return unions;
}

/** `export const NAME = ["a", "b"] as const;` → Map NAME → members. */
function parseConstArrays(source) {
  const arrays = new Map();
  for (const m of source.matchAll(/export const (\w+)\s*=\s*\[([^\]]*)\]\s*as const;/g)) {
    arrays.set(m[1], [...m[2].matchAll(/"([^"]*)"/g)].map((v) => v[1]));
  }
  return arrays;
}

/** `export type Name = (typeof ARRAY)[number];` → Map name → ARRAY. */
function parseArrayAliases(source) {
  const aliases = new Map();
  for (const m of source.matchAll(/export type (\w+)\s*=\s*\(typeof (\w+)\)\[number\];/g)) {
    aliases.set(m[1], m[2]);
  }
  return aliases;
}

/** Fields of `export interface DecisionEvidence { … }` → [{ name, type }], in order.
 *  Comments are stripped first so a field name mentioned in prose is not read as a field. */
function parseEvidenceFields(source) {
  const start = source.indexOf("export interface DecisionEvidence");
  if (start === -1) throw new Error(`${TYPES_REL} has no \`export interface DecisionEvidence\`; the derivation has drifted`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`${TYPES_REL}: \`DecisionEvidence\` has no closing brace`);
  const body = source
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/(\w+)\s*:\s*([^;]+);/g)].map((m) => ({ name: m[1], type: m[2].trim() }));
}

const stringUnions = parseStringUnions(typesSrc);
const constArrays = parseConstArrays(typesSrc);
const arrayAliases = parseArrayAliases(typesSrc);
const evidenceFields = parseEvidenceFields(typesSrc);

/** Resolve one interface field's declared type into `{ typeKey, members }`. */
function resolveFieldType(type) {
  if (type === "boolean") return { typeKey: "boolean", members: [] };
  if (/^boolean\s*\|\s*"unknown"$/.test(type)) return { typeKey: "boolean|unknown", members: ["unknown"] };
  if (/^\w+$/.test(type)) {
    if (stringUnions.has(type)) return { typeKey: type, members: stringUnions.get(type) };
    const arrayName = arrayAliases.get(type);
    if (arrayName && constArrays.has(arrayName)) return { typeKey: type, members: constArrays.get(arrayName) };
  }
  throw new Error(
    `${TYPES_REL}: cannot resolve DecisionEvidence field type "${type}" to a value set. ` +
      `The derivation must understand every field or it is scanning less than it claims.`,
  );
}

// THE JUDGEMENT, and the only hand-authored thing in this block. Keyed by TYPE, so two
// fields sharing a union (postureFreshness / dockEvidenceFreshness) cannot drift apart.
//   ok   — the good or expected reading
//   warn — degraded, not yet answered, or an answer no source can give
//   bad  — an affirmative failure
// Grounded in `lib/signalgrid-core/src/policy.ts` where a rule grades the value, and in
// the union's own doc comment where none does (BadgeBindingState calls `absent` "not
// itself a fault"; BatteryHealthState calls `failing` the state charging cannot fix).
const EXPECTED_CLASSES = {
  boolean: {},
  "boolean|unknown": { unknown: "warn" },
  ComplianceState: { compliant: "ok", non_compliant: "bad", unknown: "warn" },
  OwnerType: { corporate: "ok", shared: "ok", personal: "warn", unknown: "warn" },
  Freshness: { fresh: "ok", stale: "bad", expired: "bad", missing: "warn", unknown: "warn" },
  // Risk tier describes the ACTION, not the device. No tier is a device fault, so the
  // graded tiers raise attention rather than reporting a failure.
  RiskTier: { low: "ok", standard: "ok", elevated: "warn", critical: "warn" },
  CustodyState: { checked_in: "ok", checked_out: "ok", overdue: "bad", exception: "bad", maintenance: "bad", unknown: "warn" },
  ChargeState: { charging: "ok", charged: "ok", low: "warn", critical: "bad", not_present: "bad", unknown: "warn" },
  BatteryHealthState: { healthy: "ok", degraded: "warn", failing: "bad", unknown: "warn" },
  TamperState: { none: "ok", suspected: "warn", confirmed: "bad", sensor_unavailable: "warn", unknown: "warn" },
  DockState: { occupied: "ok", empty: "ok", reserved: "ok", faulted: "bad", offline: "bad", unknown: "warn" },
  BaselineState: { aligned: "ok", partial: "warn", drifted: "bad", not_assessed: "warn", unknown: "warn" },
  BenchmarkSelectionState: { confirmed: "ok", misfit: "bad", unverified: "warn" },
  ShiftContextState: { confirmed: "ok", misfit: "bad", unverified: "warn" },
  BadgeBindingState: { present: "ok", removed: "bad", forced: "bad", absent: "warn", unknown: "warn" },
  ManagementHealthState: { healthy: "ok", degraded: "warn", broken: "bad", unknown: "warn" },
  LocalAuthorityGrantState: { verified: "ok", withheld: "bad", unverified: "warn" },
};

// Build the vector list: one entry per (field, member), plus the booleans and the
// absent-evidence cases every field must answer the same way.
const derivationErrors = [];
const sigVectors = [];
const usedTypeKeys = new Set();
for (const field of evidenceFields) {
  const { typeKey, members } = resolveFieldType(field.type);
  usedTypeKeys.add(typeKey);
  const expected = EXPECTED_CLASSES[typeKey];
  if (!expected) {
    derivationErrors.push(`no EXPECTED_CLASSES entry for type "${typeKey}" (field ${field.name})`);
    continue;
  }
  const declared = Object.keys(expected).sort();
  const actual = [...members].sort();
  const missing = actual.filter((m) => !declared.includes(m));
  const stale = declared.filter((m) => !actual.includes(m));
  if (missing.length > 0) derivationErrors.push(`${typeKey}: unclassified member(s) ${missing.join(", ")} — classify them in EXPECTED_CLASSES`);
  if (stale.length > 0) derivationErrors.push(`${typeKey}: EXPECTED_CLASSES names ${stale.join(", ")}, which ${TYPES_REL} no longer declares`);
  for (const member of members) {
    if (expected[member] === undefined) continue;
    sigVectors.push([field.name, member, expected[member]]);
  }
  if (typeKey === "boolean" || typeKey === "boolean|unknown") {
    sigVectors.push([field.name, true, "ok"], [field.name, false, "bad"]);
  }
  sigVectors.push([field.name, null, "warn"], [field.name, undefined, "warn"]);
  // A value the core never declares is amber, on every field, always.
  sigVectors.push([field.name, "a_value_the_core_does_not_declare", "warn"]);
}
for (const typeKey of Object.keys(EXPECTED_CLASSES)) {
  if (!usedTypeKeys.has(typeKey)) derivationErrors.push(`EXPECTED_CLASSES has "${typeKey}", which no DecisionEvidence field uses — a fossil`);
}

// REGRESSION PINS. Not scope — each names a defect this file shipped, so the fix cannot
// be undone quietly by a future edit to the tables. The sweep above already covers the
// first three; they are restated because a table edit that reclassified them would
// otherwise change the expectation and the sweep with it.
const REGRESSION_PINS = [
  ["managementHealthState", "broken", "bad"],   // rendered 'ok': "broken" contains "ok"
  ["tamperState", "none", "ok"],                // rendered 'bad': the /^no/ prefix rule
  ["batteryHealth", "failing", "bad"],          // rendered 'warn', the same tier as unknown
  ["deviceCompliance", "non_compliant", "bad"], // the original substring defect
  ["deviceCompliance", "noncompliant", "warn"], // a separator variant is not a member: amber, never green
  ["tamperState", "confirmed", "bad"],          // the deny state; 'confirmed' is GOOD on another field
  ["benchmarkSelection", "confirmed", "ok"],    // …and the same word, good, on that other field
  ["workflowRiskTier", "low", "ok"],            // 'low' is benign here and bad on dockChargeState
  ["dockChargeState", "low", "warn"],
  ["notAFieldOfDecisionEvidence", "healthy", "warn"], // an unknown field is never green
];

// FLOORS. A parse that finds nothing must not read as a clean sweep.
if (evidenceFields.length < 20) derivationErrors.push(`parsed only ${evidenceFields.length} DecisionEvidence fields from ${TYPES_REL}; expected at least 20 — the parse has drifted`);
if (stringUnions.size < 10) derivationErrors.push(`parsed only ${stringUnions.size} string unions from ${TYPES_REL}; expected at least 10`);
if (sigVectors.length < 100) derivationErrors.push(`derived only ${sigVectors.length} colour vectors; expected at least 100`);
if (derivationErrors.length > 0) {
  throw new Error(`sigClass vector derivation is not sound:\n  ${derivationErrors.join("\n  ")}`);
}

const sigSrc = /\/\*sigClass:start\*\/([\s\S]*?)\/\*sigClass:end\*\//.exec(shell)?.[1];
if (!sigSrc) throw new Error("tools/room-console/shell.html has no /*sigClass:start*/…/*sigClass:end*/ block to test");
const sigModule = new Function(`${sigSrc}; return { sigClass, SIG_FIELDS };`)();
const { sigClass, SIG_FIELDS } = sigModule;

/** Run the whole derived vector set against one implementation. Returns the failures. */
function colourFailures(fn) {
  const out = [];
  for (const [field, value, want] of [...sigVectors, ...REGRESSION_PINS]) {
    let got;
    try {
      got = fn(field, value);
    } catch (err) {
      got = `threw ${err.message}`;
    }
    if (got !== want) out.push(`${field} = ${JSON.stringify(value)} → ${got} (want ${want})`);
  }
  return out;
}

// The shell's field table must be the interface's field set, exactly. Without this the
// sweep above would silently skip a field the page still renders.
const shellFields = Object.keys(SIG_FIELDS).sort();
const coreFields = evidenceFields.map((f) => f.name).sort();
const notInShell = coreFields.filter((f) => !shellFields.includes(f));
const notInCore = shellFields.filter((f) => !coreFields.includes(f));
if (notInShell.length > 0 || notInCore.length > 0) {
  throw new Error(
    "the shell's SIG_FIELDS is not the DecisionEvidence field set:\n" +
      (notInShell.length ? `  rendered by the page, unclassified in the shell: ${notInShell.join(", ")}\n` : "") +
      (notInCore.length ? `  classified in the shell, not a field of DecisionEvidence: ${notInCore.join(", ")}\n` : ""),
  );
}

const sigFailures = colourFailures(sigClass);
if (sigFailures.length > 0) {
  throw new Error(`sigClass renders the wrong colour (${sigFailures.length} of ${sigVectors.length + REGRESSION_PINS.length} vectors):\n  ${sigFailures.join("\n  ")}`);
}
const wronglyGreen = [...sigVectors, ...REGRESSION_PINS].filter(([, , want]) => want !== "ok").filter(([f, v]) => sigClass(f, v) === "ok");
if (wronglyGreen.length > 0) {
  throw new Error(`sigClass renders a non-good value green: ${wronglyGreen.map(([f, v]) => `${f}=${JSON.stringify(v)}`).join(", ")}`);
}

// SELF-TEST — the check must be able to FAIL, or it proves nothing. Two implementations
// that are wrong in the two ways this page has actually been wrong are run through the
// same `colourFailures`, and each must be caught. A green sweep over a checker that
// cannot fail is green about nothing.
{
  // (a) The retired substring/word-list body, verbatim in shape. Its signature ignores
  //     the field, which is the second half of the defect.
  const retired = (_field, v) => {
    if (v === true) return "ok";
    if (v === false) return "bad";
    if (v === null || v === undefined) return "warn";
    const s = String(v).toLowerCase().replace(/[^a-z]/g, "");
    const ok = ["enabled", "compliant", "present", "bound", "aligned", "fresh", "docked", "nominal", "supported", "enrolled", "healthy", "ok"];
    const bad = ["disabled", "noncompliant", "notpresent", "absent", "withdrawn", "forced", "tampered", "drifted", "offline", "faulted", "stale", "expired", "removed", "revoked", "misfit", "unsupported", "undocked", "unbound", "unenrolled", "denied", "blocked"];
    const warn = ["unknown", "missing", "suspected", "degraded", "pending", "unverified", "partial"];
    if (ok.includes(s)) return "ok";
    if (bad.some((b) => s.includes(b))) return "bad";
    if (warn.some((w) => s.includes(w))) return "warn";
    if (/^(un|non|not|no)/.test(s)) return "bad";
    if (ok.some((o) => s.includes(o))) return "ok";
    return "warn";
  };
  const retiredFailures = colourFailures(retired);
  if (retiredFailures.length === 0) {
    throw new Error("SELF-TEST FAILED: the retired substring classifier passes the vector sweep, so the sweep cannot detect the defect it exists for");
  }
  if (!retiredFailures.some((f) => f.startsWith("managementHealthState = \"broken\""))) {
    throw new Error(`SELF-TEST FAILED: the sweep did not flag \`broken\` rendering green under the retired classifier. Flagged: ${retiredFailures.join("; ")}`);
  }

  // (b) The current table, but field-blind — the collision `confirmed`/`low` proves the
  //     field argument is load-bearing rather than decorative.
  const fieldBlind = (_field, v) => sigClass("tamperState", v);
  if (colourFailures(fieldBlind).length === 0) {
    throw new Error("SELF-TEST FAILED: a field-blind classifier passes the sweep, so the per-field tables are not actually being distinguished");
  }

  // (c) A union member the core declares but the tables do not: the derivation must
  //     refuse it rather than skip it silently.
  const probeType = "TamperState";
  const withGap = { ...EXPECTED_CLASSES[probeType] };
  delete withGap.none;
  if (Object.keys(withGap).length === Object.keys(EXPECTED_CLASSES[probeType]).length) {
    throw new Error(`SELF-TEST FAILED: could not construct a gap in ${probeType} — the classification map is not shaped as assumed`);
  }
  const gapMembers = stringUnions.get(probeType) ?? [];
  const undetected = gapMembers.filter((m) => Object.keys(withGap).includes(m)).length === gapMembers.length;
  if (undetected) {
    throw new Error(`SELF-TEST FAILED: removing a member from ${probeType}'s classification produced no unclassified member`);
  }
}

console.log(
  `sigClass: ${sigVectors.length} derived vectors + ${REGRESSION_PINS.length} regression pins over ` +
    `${evidenceFields.length} DecisionEvidence fields / ${usedTypeKeys.size} value sets — all pass`,
);

const content = shell.replace("/*__BUNDLE__*/", () => bundle);
const i = content.indexOf('<div class="wrap">');
const head = content.slice(0, i).trim();
const body = content.slice(i).trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="SignalGrid Trusted Room Entry — a context-aware trust & orchestration simulation that runs entirely in the browser.">
${head}
</head>
<body>
${body}
</body>
</html>
`;

const out = resolve(repo, "docs/room-entry-console.html");
writeFileSync(out, html);
console.log(`Built ${out} (${html.length} bytes; bundle ${bundle.length} bytes)`);
