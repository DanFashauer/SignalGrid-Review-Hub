// Emit PAYLOAD discipline — the emit gate answers "may I send"; this answers
// "what may I send".
//
//   node scripts/check-emit-payload-discipline.mjs              the guard
//   node scripts/check-emit-payload-discipline.mjs --self-test  prove it can fail
//   node scripts/check-emit-payload-discipline.mjs --report     the census
//
// WHY THIS EXISTS. `adapters/emit-gate.ts` and each family's `resolve.ts` decide
// WHETHER anything may leave (tier, live flag, credential) and say so in their own
// words: "the vendor modules type their own payloads; the gate decides WHETHER
// anything may leave, not what it looks like." Nothing checked the second half.
//
// An independent fail-closed read of the six emitter families on 2026-09-02 reported
// 27 payload-construction sites and 17 whole-object copies at 7 sites. Those are THAT
// READ'S figures, cited rather than re-measured here, and this gate does not hold
// them. The numbers this gate derives itself are printed on every run — families,
// outbound modules scanned, builders declared, untyped map fields — and those are the
// ones to trust. The finding that specified the gate is not in dispute either way:
// `JSON.stringify(event)` sent the entire inbound SIEMEventRequest, verbatim, to a
// customer-configured URL.
//
// A whole-object copy is not a defect you can see at the copy. It is a field that
// begins crossing to a customer's SIEM or service desk the day somebody widens a
// type three files away, with no edit at the boundary and nothing to review. That
// is the same shape as every other defect this repository keeps finding: something
// that goes on reporting success while quietly doing more than it was asked to.
//
// WHAT IS GATED (unambiguous shapes only, on the outbound modules of the derived
// emitter families):
//
//   1. `JSON.stringify(<builder param>)` — the whole inbound request serialised.
//      The rule requires the BARE parameter. Serialising a NAMED SUB-OBJECT —
//      `JSON.stringify(request.links)` — is NOT flagged, and that is a stated limit,
//      not a special case: whether a typed sub-object may be serialised by reference
//      needs the sub-object's type, which a lexical scan does not have. itsm/bmc-helix.ts
//      had exactly that line; it now names the four `links` fields (adapters/types.ts:22-27)
//      because the batch's rule is "typed sub-objects are copied field by field, so an
//      upstream addition never crosses unchosen". That fix was made by HAND and is held
//      by the declaration and by review — NOT by this rule. Widening rule 1 to member
//      paths was tried and rejected: it flags every legitimate closed serialisation too.
//   2. `...<param>` / `...<param>.<field>` spread into an object — the same copy
//      wearing a different spelling.
//   3. `<param>.<untyped map>` read anywhere — `rawEvent`, `evidence[].data`,
//      `customFields`, the webhook `data` slot. These are the `Record<string,
//      unknown>` fields, DERIVED from the type declarations rather than listed.
//   4. `Object.entries(<param>…)` — the merge-everything-into-the-payload shape.
//   5. `Object.assign(<anything>, <param>…)` — rule 2's copy without the spread
//      syntax. It was missed entirely until a reviewer planted
//      `...Object.assign({}, event)` and scored zero violations; the omission was not
//      even in the not-gated list below.
//
// AND TWO COMPLETENESS RULES, because the four above only see the modules they are
// pointed at, and the declaration that points them was a hand-pinned floor:
//
//   6. Every scanned outbound module must have at least ONE declared builder. A
//      reviewer added `siem/zz-newvendor.ts` — importing the emit gate, gating before
//      its fetch, hand-naming actor.email/name/badgeUid, device.ip and
//      location.coordinates.lat, declared nowhere — and BOTH this gate and the proof
//      stayed green, because `OUTBOUND_BUILDERS.length >= 18` is satisfied by a
//      declaration that has stopped describing the tree. A floor cannot notice an
//      addition; only a per-module correspondence can.
//   7. Inside a declared module, every function that takes a builder param and
//      returns a SYNCHRONOUS value must itself be declared — the same hole one level
//      down, a new `buildXPayload` beside a declared one. The rule's edge is stated
//      where it is implemented.
//
// EXEMPTION IS BY DECLARATION, NEVER BY SPECIAL CASE. Three untyped maps are the
// caller's own DECLARED open slots and must stay open. Each is listed in
// `lib/integrations/src/integrations/adapters/payload-fields.ts` with the exact
// source expression and the module it lives in, so the same expression copied into
// a second module still fails. A declared slot whose expression is no longer in its
// module is itself a failure — a stale exemption re-permits the gap it was granted
// for and reads as intentional ever after.
//
// SCOPE IS DERIVED, NOT LISTED. The families are the directories whose `resolve.ts`
// imports `createEmitterResolver`, exactly as `scripts/src/emit-gate-proof.ts:331`
// derives them. The outbound modules within a family are those that call `fetch(`
// or that payload-fields.ts declares a builder in — so syslog (which opens no
// socket) and caep-events (which has no transport) are covered, while the three
// `store.ts` modules, which serialise to redis and reach no vendor, are not.
//
// WHAT IS DELIBERATELY NOT GATED, said out loud:
//   · The CONTENT a caller puts in a declared open slot. This repository cannot see
//     it; governing it is the caller's job, and saying otherwise would be a claim
//     the gate does not hold.
//   · Dataflow. This is single-file lexical matching, and the exact reach is written
//     out because an earlier draft of this line overclaimed it. CAUGHT: a one-level
//     alias (`const all = event;`); a same-file helper declared with `function`; a
//     same-file helper declared as an ARROW with a typed parameter
//     (`const extra = (e: SIEMEventRequest) => …`) — NOT caught until a reviewer
//     planted it, because the signature matcher required an identifier before `(`
//     and arrow forms registered no parameters at all; and `Object.assign(t, param)`,
//     rule 5, added for the same reason. MISSED: a param laundered through a helper
//     in ANOTHER file, an untyped helper parameter, and anything needing a value's
//     provenance rather than its spelling. Those are holes, not decisions.
//   · Header values, URLs and query strings. Bodies only.
//
// COMMENTS AND STRING LITERALS ARE MASKED (scripts/lib/sanitize.mjs, the same
// helper check-nan-fail-open.mjs uses). Every builder here now carries prose
// explaining the copy it replaced, and itsm/generic-webhook.ts explains the
// rawEvent ordering at length. A gate that fired on the prose describing the defect
// would punish writing the explanation down — that has happened three times in this
// repository and the fix was never to delete the true sentence.
//
// SELF-TEST: a planted violation of each rule must be flagged and its fixed twin
// must pass. A gate that has never failed proves nothing.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAMILY_ROOT = "lib/integrations/src/integrations";
const DECL_PATH = `${FAMILY_ROOT}/adapters/payload-fields.ts`;

// ── the declaration, read lexically ──────────────────────────────────────────
//
// Read with regexes rather than imported, because this is a .mjs gate and the
// declaration is TypeScript. The extraction is held honest by FLOORS below and by
// the self-test: a shape change that stops the extractor matching fails loudly
// instead of producing an empty exemption set that agrees with everything.
function parseDeclarations(source) {
  const builders = [];
  const body = source.slice(source.indexOf("OUTBOUND_BUILDERS"));
  for (const block of body.split(/\n  \{\n/).slice(1)) {
    const family = /family:\s*"([^"]+)"/.exec(block)?.[1];
    const module = /module:\s*"([^"]+)"/.exec(block)?.[1];
    const builder = /builder:\s*"([^"]+)"/.exec(block)?.[1];
    if (!family || !module || !builder) continue;
    const closedRaw = /closed:\s*\[([\s\S]*?)\]/.exec(block)?.[1] ?? "";
    const closed = [...closedRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const openRaw = /open:\s*\[([\s\S]*?)\n    \],?/.exec(block)?.[1] ?? "";
    const open = [...openRaw.matchAll(/slot:\s*"((?:[^"\\]|\\.)*)"[\s\S]*?source:\s*"((?:[^"\\]|\\.)*)"/g)].map(
      (m) => ({ slot: m[1], source: m[2] }),
    );
    builders.push({ family, module, builder, closed, open });
  }
  return builders;
}

// ── the untyped maps, derived from the type declarations ─────────────────────
//
// NOT a hand list. A field is an untyped map iff its declared type is
// `Record<string, unknown>` (or `z.record(...)` in the zod-typed webhook family).
// A seventh such field added upstream tomorrow is covered without editing this file.
function deriveUntypedMapFields(typeSources) {
  const fields = new Set();
  for (const src of typeSources) {
    const clean = sanitize(src);
    for (const m of clean.matchAll(/(\w+)\??\s*:\s*Record<\s*string\s*,\s*unknown\s*>/g)) fields.add(m[1]);
    for (const m of clean.matchAll(/(\w+)\s*:\s*z\.record\s*\(/g)) fields.add(m[1]);
  }
  return fields;
}

// ── builder params, derived from the signatures ──────────────────────────────
//
// A BUILDER PARAM is a function parameter whose declared type is imported from the
// adapter type surface (`../adapters/types`) or the family's own `./types`, or is
// literally `Record<string, unknown>`. Local `const x: Record<string, unknown> = {}`
// declarations are NOT params and must not register — an early version did, and it
// reported `JSON.stringify(payload)` in splunk (a payload this file itself built,
// field by field) as a whole-object copy.
//
// One level of ALIASING is followed: `const all = event;` makes `all` a param name
// too. That is the laundered shape a lexical gate can still catch, and the
// self-test pins it.
function deriveParams(clean, raw, excludeTypes = new Set()) {
  const types = new Set();
  // Read the IMPORT LIST off the raw source, not the sanitized one: sanitize()
  // masks string-literal CONTENTS, so `from '../adapters/types'` arrives here as
  // `from '                   '` and matched nothing — every rule then found zero
  // params and the whole gate reported green over a tree it had not read. Anchored
  // at line start (`^\s*import`, multiline) so a commented-out import, which begins
  // `//` or ` *`, cannot widen the type set.
  for (const m of raw.matchAll(/^\s*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.\.\/adapters\/types|\.\/types)['"]/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) types.add(name);
    }
  }
  const params = new Set();
  // TWO signature forms, because one was missing and the gap was total. The first
  // requires an identifier before `(` — `function f(…) {`, `private build(…) {` —
  // and an ARROW assigned to a const has no identifier in that position, so
  // `const extra = (e: SIEMEventRequest) => ({ ...e })` registered NO parameters
  // and every rule below then had nothing to match. A reviewer planted exactly
  // that and the gate reported zero violations. Both bodies count now: `=> {` and
  // the expression form `=> (`.
  const SIGNATURES = [
    /(?:function\s+)?[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*(?::\s*[^{;=]+)?\s*\{/g,
    /\(([^)]*)\)\s*(?::\s*[^=>{;]+)?\s*=>/g,
  ];
  for (const sig of SIGNATURES.flatMap((re) => [...clean.matchAll(re)])) {
    for (const p of sig[1].split(",")) {
      const m = /^\s*(?:readonly\s+|private\s+|public\s+)?([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(p);
      if (!m) continue;
      const declared = m[2].trim();
      const named = declared.replace(/\[\]$/, "");
      if (excludeTypes.has(named)) continue;
      if (types.has(named) || /^Record<\s*string\s*,\s*unknown\s*>/.test(declared)) {
        params.add(m[1]);
      }
    }
  }
  // One-level aliases.
  for (const m of clean.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) {
    if (params.has(m[2])) params.add(m[1]);
  }
  return params;
}

// ── the family's OWN outbound envelope types, derived ────────────────────────
//
// A parameter typed with a shape THIS FAMILY BUILT is not a caller's object, and
// serialising it is the send, not a copy. `webhooks/dispatch.ts` is the live case:
// `buildPayload` constructs a `WebhookPayload`, parses it through a `.strict()`
// schema, and hands it to `dispatchToEndpoint(webhook, payload: WebhookPayload)`,
// which calls `JSON.stringify(payload)`. That is the wire write. Flagging it would
// be the gate punishing the disciplined shape — and the fix would have been to stop
// declaring the type, which is worse than the defect.
//
// DERIVED, not exempted by name: a type is an outbound envelope iff it is the
// declared RETURN type of a builder that payload-fields.ts declares. So the closure
// of `WebhookPayload` is what earns the pass, and a type nobody declares a builder
// for earns nothing. `Record<string, unknown>` is deliberately NOT excludable this
// way — half the builders return it, and it is also how the webhook `data` slot
// arrives.
function deriveBuiltTypes(declarations, familyRootAbs) {
  const built = new Set();
  for (const d of declarations) {
    const file = join(familyRootAbs, d.module);
    if (!existsSync(file)) continue;
    const short = d.builder.split(".").pop().split("#")[0];
    const clean = sanitize(readFileSync(file, "utf8"));
    const re = new RegExp(String.raw`\b${short}\s*\(([^)]*)\)\s*:\s*([A-Za-z_$][\w$]*)\b`);
    const m = re.exec(clean);
    if (m && !/^(string|number|boolean|void|Promise|Record)$/.test(m[2])) built.add(m[2]);
  }
  return built;
}

// ── completeness: what the four rules cannot see ─────────────────────────────
//
// Rules 1-5 scan for a defective SHAPE. They are blind to a module that simply is
// not declared, and to a new builder beside a declared one, because a scan finds
// nothing wrong with code that never claimed anything. That blindness was measured:
// a reviewer added a whole undeclared vendor module hand-naming actor.email,
// device.ip and location.coordinates.lat, and both this gate and the proof stayed
// green. The floor (`OUTBOUND_BUILDERS.length >= 18`) is satisfied by any
// declaration with 18 entries, including one that has stopped describing the tree.
//
// So: a per-module correspondence, in both directions.
//
// THE BUILDER SHAPE, defined mechanically and with its edge stated. A function is
// builder-shaped when it takes a builder param AND declares a SYNCHRONOUS return
// type — not `Promise<…>` (that is a send, not a build), not `void`/`boolean`
// (a predicate). `sendEvent(event): Promise<SIEMEventResponse>` is therefore not
// builder-shaped and `formatCEF(event): string` is. The edge this leaves: a
// builder with NO declared return type is missed, and an untyped parameter is
// missed. Both are visible to a reader of the module and neither can be caught
// without inference this gate does not do.
function buildersIn(clean, raw, builtTypes) {
  const params = deriveParams(clean, raw, builtTypes);
  if (params.size === 0) return [];
  const found = [];
  const RE = /(?:function\s+|(?:private|public|protected)\s+(?:async\s+)?|const\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*:\s*([^{;=]+?)\s*(?:\{|=>)/g;
  for (const m of clean.matchAll(RE)) {
    const [, name, args, ret] = m;
    if (/^(if|for|while|switch|catch|return)$/.test(name)) continue;
    const takesParam = args.split(",").some((a) => {
      const d = /^\s*(?:readonly\s+|private\s+|public\s+)?([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(a);
      if (!d) return false;
      const named = d[2].trim().replace(/\[\]$/, "");
      return params.has(d[1]) && !builtTypes.has(named);
    });
    if (!takesParam) continue;
    const r = ret.trim();
    if (/^Promise\s*</.test(r) || /^(void|boolean|never)$/.test(r)) continue;
    found.push(name);
  }
  return [...new Set(found)];
}

// ── the four rules ───────────────────────────────────────────────────────────
function findViolations(source, declaredSources, untypedMaps, builtTypes = new Set()) {
  const clean = sanitize(source);
  const params = deriveParams(clean, source, builtTypes);
  if (params.size === 0) return [];
  const lines = clean.split("\n");
  const names = [...params].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const hits = [];
  const allowed = (expr) => declaredSources.has(expr);

  const R1 = new RegExp(String.raw`JSON\.stringify\s*\(\s*(${names})\s*[),]`, "g");
  const R2 = new RegExp(String.raw`\.\.\.\s*((?:${names})(?:\??\.[\w$]+)*)`, "g");
  const mapNames = [...untypedMaps].join("|");
  const R3 = new RegExp(String.raw`\b((?:${names})(?:\??\.[\w$]+)*?\??\.(?:${mapNames}))\b`, "g");
  const R4 = new RegExp(String.raw`Object\.entries\s*\(\s*((?:${names})(?:\??\.[\w$]+)*)`, "g");
  // Rule 5: the same copy as rule 2 with different syntax. `Object.assign({}, event)`
  // produces a whole-object copy that no spread appears in, and the target argument
  // is deliberately not constrained — `Object.assign(payload, event)` is the shape
  // that would actually ship.
  const R5 = new RegExp(String.raw`Object\.assign\s*\([^,()]*,\s*((?:${names})(?:\??\.[\w$]+)*)`, "g");

  lines.forEach((line, i) => {
    for (const [rule, re, what] of [
      [1, R1, "the whole inbound request is serialised"],
      [2, R2, "the whole object is spread into a payload"],
      [3, R3, "an untyped caller map is read outside a declared open slot"],
      [4, R4, "every key of a caller map is merged into the payload"],
      [5, R5, "the whole object is copied by Object.assign"],
    ]) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const expr = m[1];
        if (allowed(expr)) continue;
        hits.push({ line: i + 1, rule, expr, what, text: line.trim() });
      }
    }
  });
  return hits;
}

// ── self-test ────────────────────────────────────────────────────────────────
const SELF_MAPS = new Set(["rawEvent", "data", "customFields", "config"]);
const NO_DECLARATIONS = new Set();
{
  const cases = [
    // rule 1
    [
      "rule 1 — JSON.stringify of the whole request",
      "function f(event: SIEMEventRequest) { return JSON.stringify(event); }",
      true,
    ],
    [
      "rule 1 fixed — a named closed sub-object is NOT flagged (the shape bmc-helix USED to have; it now names the four fields, and this case pins the rule's stated limit, not that file)",
      "function f(request: ITSMTicketRequest) { return JSON.stringify(request.links); }",
      false,
    ],
    // rule 2
    [
      "rule 2 — spread of the param into a returned object",
      "function f(event: SIEMEventRequest) { return { time: 1, ...event }; }",
      true,
    ],
    [
      "rule 2 — spread of an untyped sub-map (the generic-webhook shape, undeclared)",
      "function f(request: ITSMTicketRequest) { return { ...request.rawEvent, title: request.title }; }",
      true,
    ],
    // rule 3
    [
      "rule 3 — an untyped caller map assigned into the payload",
      "function f(event: SIEMEventRequest) { const p = {}; p.extra = event.customFields; return p; }",
      true,
    ],
    // rule 4
    [
      "rule 4 — Object.entries merge of a caller map",
      "function f(event: SIEMEventRequest) { const p = {}; for (const [k, v] of Object.entries(event.customFields)) { p[k] = v; } return p; }",
      true,
    ],
    // laundering
    [
      "laundered by ALIAS — const all = event, then spread",
      "function f(event: SIEMEventRequest) { const all = event; return { ...all }; }",
      true,
    ],
    [
      "laundered by a SAME-FILE HELPER — the helper's own param is typed",
      "function copyAll(e: SIEMEventRequest) { return { ...e }; }\nfunction f(event: SIEMEventRequest) { return copyAll(event); }",
      true,
    ],
    [
      "laundered by an ARROW helper — the form that scored zero until a reviewer planted it",
      "const extra = (e: SIEMEventRequest) => ({ ...e });\nfunction f(event: SIEMEventRequest) { return { type: event.type, ...extra(event) }; }",
      true,
    ],
    [
      "an arrow helper that names fields is NOT flagged",
      "const pick = (e: SIEMEventRequest) => ({ userId: e.actor?.userId });\nfunction f(event: SIEMEventRequest) { return { actor: pick(event) }; }",
      false,
    ],
    [
      "rule 5 — Object.assign copy, the spread-free spelling (also a reviewer plant)",
      "function f(event: SIEMEventRequest) { return { time: 1, ...Object.assign({}, event) }; }",
      true,
    ],
    [
      "rule 5 — Object.assign onto the payload itself",
      "function f(event: SIEMEventRequest) { const p = { time: 1 }; Object.assign(p, event); return p; }",
      true,
    ],
    [
      "Object.assign of a NON-param is NOT flagged",
      "function f(event: SIEMEventRequest) { return Object.assign({}, { type: event.type }); }",
      false,
    ],
    [
      "REORDERED — sanctioned fields first, whole-object spread last",
      "function f(event: SIEMEventRequest) { return { type: event.type, severity: event.severity, ...event }; }",
      true,
    ],
    // the disciplined shape must pass
    [
      "field-by-field copy of a typed sub-object is NOT flagged",
      "function f(event: SIEMEventRequest) { return { actor: event.actor ? { userId: event.actor.userId, email: event.actor.email } : undefined }; }",
      false,
    ],
    // honest prose and literals must pass — the failure mode this gate must not have
    [
      "PROSE describing the defect is NOT flagged",
      "// this used to be JSON.stringify(event) and spread { ...event } into the body\nfunction f(event: SIEMEventRequest) { return { type: event.type }; }",
      false,
    ],
    [
      "a STRING LITERAL naming the defect is NOT flagged",
      "function f(event: SIEMEventRequest) { return { type: event.type, hint: 'do not write JSON.stringify(event)' }; }",
      false,
    ],
    // the expected non-findings named in the brief, passing by rule shape
    [
      "an OAuth token request is NOT flagged (the mde shape)",
      "function f(cfg: Cfg) { return new URLSearchParams({ client_id: cfg.clientId, scope: 'x' }); }",
      false,
    ],
    [
      "a bounded query body is NOT flagged (the fleetdm shape)",
      "function f(sql: string, hostIds: number[]) { return JSON.stringify({ query: sql, selected: { hosts: hostIds } }); }",
      false,
    ],
    [
      "a local const typed Record<string, unknown> is NOT a builder param",
      "function f(x: string) { const payload: Record<string, unknown> = { a: x }; return JSON.stringify(payload); }",
      false,
    ],
  ];
  // Every fixture carries the REAL import line, so the import-derivation half of
  // deriveParams() is exercised by the self-test too. It was not, and that is how a
  // version shipped in which sanitize() had masked the import path — the type set
  // came back empty, no parameter registered, and the whole gate reported zero
  // violations over a tree it had never actually read.
  const FIXTURE_IMPORT = "import type { SIEMEventRequest, ITSMTicketRequest } from '../adapters/types';\n";
  const run = (src, declared) => findViolations(FIXTURE_IMPORT + src, declared, SELF_MAPS);
  const failures = cases.filter(([, src, shouldFlag]) => run(src, NO_DECLARATIONS).length > 0 !== shouldFlag);
  // A declared open slot must EXEMPT, and only in its own module — proven here so
  // the exemption path is exercised in both directions rather than assumed.
  const declaredCase = "function f(event: SIEMEventRequest) { return { customFields: event.customFields }; }";
  if (run(declaredCase, new Set(["event.customFields"])).length !== 0) {
    failures.push(["a DECLARED open slot must be exempt"]);
  }
  if (run(declaredCase, NO_DECLARATIONS).length === 0) {
    failures.push(["an UNDECLARED open slot must NOT be exempt"]);
  }
  if (failures.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — these cases did not behave as required:\n" +
        failures.map(([name]) => `    · ${name}`).join("\n") +
        "\n  The detector no longer matches the defect it was written for; a gate that\n" +
        "  cannot flag a planted violation is green about nothing.",
    );
    process.exit(1);
  }
}

if (process.argv.includes("--self-test")) {
  console.log("emit-payload-discipline self-test: green — every rule flags a planted violation and passes its fixed twin.");
  process.exit(0);
}

// ── scope, DERIVED ───────────────────────────────────────────────────────────
const familyRootAbs = resolve(repo, FAMILY_ROOT);
const families = readdirSync(familyRootAbs, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => {
    const p = join(familyRootAbs, name, "resolve.ts");
    return existsSync(p) && /createEmitterResolver/.test(readFileSync(p, "utf8"));
  })
  .sort();

if (!existsSync(resolve(repo, DECL_PATH))) {
  console.error(`✗ ${DECL_PATH} is missing — there is nothing declaring what may leave.`);
  process.exit(1);
}
const declarations = parseDeclarations(readFileSync(resolve(repo, DECL_PATH), "utf8"));
const builtTypes = deriveBuiltTypes(declarations, familyRootAbs);

const typeSources = [readFileSync(resolve(repo, FAMILY_ROOT, "adapters/types.ts"), "utf8")];
for (const f of families) {
  const p = join(familyRootAbs, f, "types.ts");
  if (existsSync(p)) typeSources.push(readFileSync(p, "utf8"));
}
const untypedMaps = deriveUntypedMapFields(typeSources);

// An OUTBOUND module reaches a vendor (`fetch(`) or is declared to build a payload.
const declaredModules = new Set(declarations.map((d) => d.module));
const modules = [];
for (const family of families) {
  for (const file of readdirSync(join(familyRootAbs, family)).filter((f) => f.endsWith(".ts")).sort()) {
    const rel = `${family}/${file}`;
    const src = readFileSync(join(familyRootAbs, rel), "utf8");
    if (/\bfetch\s*\(/.test(sanitize(src)) || declaredModules.has(rel)) modules.push({ rel, src });
  }
}

console.log("Emit payload discipline — the gate answers 'may I send'; this answers 'what may I send'\n");

let problems = 0;

// ── FLOORS. A derivation that stops matching agrees with an empty expectation ──
const FAMILY_COUNT = 6;
const MODULE_FLOOR = 12;
const BUILDER_FLOOR = 18;
const MAP_FLOOR = 3;
for (const [label, actual, want, how] of [
  ["emitter families derived", families.length, FAMILY_COUNT, "==="],
  ["outbound modules scanned", modules.length, MODULE_FLOOR, ">="],
  ["builders declared", declarations.length, BUILDER_FLOOR, ">="],
  ["untyped map fields derived", untypedMaps.size, MAP_FLOOR, ">="],
]) {
  const ok = how === "===" ? actual === want : actual >= want;
  if (!ok) {
    console.error(`  ✗ ${label}: ${actual} (needs ${how} ${want}) — the derivation is not reaching the tree it covers.`);
    problems += 1;
  }
}

// ── the declaration must not fossilise ───────────────────────────────────────
for (const d of declarations) {
  if (!families.includes(d.family)) {
    console.error(`  ✗ payload-fields.ts declares family "${d.family}", which is not a derived emitter family.`);
    problems += 1;
  }
  if (!existsSync(join(familyRootAbs, d.module))) {
    console.error(`  ✗ payload-fields.ts declares ${d.module}, which does not exist.`);
    problems += 1;
    continue;
  }
  const clean = sanitize(readFileSync(join(familyRootAbs, d.module), "utf8"));
  for (const slot of d.open) {
    if (!clean.includes(slot.source)) {
      console.error(
        `  ✗ ${d.module}: declares an open slot "${slot.slot}" sourced from \`${slot.source}\`, but that\n` +
          "      expression is not in the module any more. A stale exemption re-permits the gap it\n" +
          "      was granted for and reads as intentional ever after — delete it or fix the source.",
      );
      problems += 1;
    }
  }
}
for (const rel of declaredModules) {
  if (!modules.some((m) => m.rel === rel)) {
    console.error(`  ✗ ${rel} is declared in payload-fields.ts but was not scanned — the scope derivation missed it.`);
    problems += 1;
  }
}

// ── completeness rules 6 and 7 ───────────────────────────────────────────────
{
  const declaredIn = (rel) => declarations.filter((d) => d.module === rel);
  for (const { rel, src } of modules) {
    const mine = declaredIn(rel);
    if (mine.length === 0) {
      console.error(
        `  ✗ ${FAMILY_ROOT}/${rel}: reaches a vendor but declares NO builder in adapters/payload-fields.ts.\n` +
          "      Every outbound module states what it sends. An undeclared one is a field set\n" +
          "      nobody chose and no proof drives — which is how a whole vendor module was added\n" +
          "      hand-naming actor.email and device.ip with this gate green.",
      );
      problems += 1;
      continue;
    }
    const declaredNames = new Set(mine.map((d) => d.builder.split(".").pop().split("#")[0]));
    for (const name of buildersIn(sanitize(src), src, builtTypes)) {
      if (declaredNames.has(name)) continue;
      console.error(
        `  ✗ ${FAMILY_ROOT}/${rel}: \`${name}\` is builder-shaped (takes a caller request, returns a\n` +
          "      synchronous value) but is declared nowhere. Declare its closed set in\n" +
          "      adapters/payload-fields.ts, or change it so it no longer builds an outbound value.",
      );
      problems += 1;
    }
  }
}

// ── the scan ─────────────────────────────────────────────────────────────────
for (const { rel, src } of modules) {
  const declaredSources = new Set(
    declarations.filter((d) => d.module === rel).flatMap((d) => d.open.map((o) => o.source)),
  );
  for (const h of findViolations(src, declaredSources, untypedMaps, builtTypes)) {
    console.error(
      `  ✗ ${FAMILY_ROOT}/${rel}:${h.line} (rule ${h.rule}) — ${h.what}\n` +
        `      ${h.text}\n` +
        `      \`${h.expr}\` crosses to a vendor without being named. Copy the typed fields one by\n` +
        "      one, or declare it as an open slot in adapters/payload-fields.ts with a reason.",
    );
    problems += 1;
  }
}

// ── the DOC tables must equal the declaration ────────────────────────────────
//
// Two new documentation sections state the outbound field sets in prose, and prose
// is where a declaration goes to rot: the doc is written once, the declaration keeps
// moving, and nobody notices because the sentence still reads fine. Every figure in
// those sections was ungated on first landing — the family count and the per-family
// key lists were plain text.
//
// So the lists are DERIVED here and matched against the documents. The rule is
// deliberately stronger than "the correct list appears somewhere": any backticked
// run in the document that carries three or more of a builder's declared keys must
// be EXACTLY that builder's list. That is what makes editing one key in a table a
// failure rather than a second, near-miss home for the same figure.
//
// Not gated here: the per-family PROSE (which slot is open, why). That is judgement,
// it is reviewed by a human, and a gate over it would be a gate over writing.
{
  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const DOCS = ["docs/DATA_RETENTION_AND_PERSONAL_DATA.md", "docs/INTEGRATION_CATALOG.md"];
  const docText = new Map();
  for (const d of DOCS) {
    const abs = resolve(repo, d);
    if (!existsSync(abs)) {
      console.error(`  ✗ ${d}: named as an outbound-surface document but does not exist.`);
      problems += 1;
      continue;
    }
    docText.set(d, readFileSync(abs, "utf8"));
  }

  // 1. The family count, derived from the resolver factory (the same derivation the
  //    scan above uses), stated as a word in both documents.
  const familyWord = NUMBER_WORDS[families.length] ?? String(families.length);
  for (const [doc, text] of docText) {
    const hits = [...text.matchAll(/\b([a-z]+|\d+)\s+emitter families\b/g)].map((m) => m[1]);
    if (hits.length === 0) {
      console.error(`  ✗ ${doc}: states no "<n> emitter families" figure — the anchor drifted, so this row guards nothing.`);
      problems += 1;
    }
    for (const h of hits) {
      if (h !== familyWord) {
        console.error(
          `  ✗ ${doc}: says "${h} emitter families"; the tree derives ${familyWord} ` +
            `(${families.join(", ")}).`,
        );
        problems += 1;
      }
    }
  }

  // 2. The ITSM typed-vendor count — every itsm module except the generic-webhook
  //    adapter, which is the one whose body an operator templates.
  const typedItsmVendors = new Set(
    declarations.filter((d) => d.family === "itsm" && !/generic-webhook/.test(d.module)).map((d) => d.module),
  );
  const vendorWord = NUMBER_WORDS[typedItsmVendors.size] ?? String(typedItsmVendors.size);
  for (const [doc, text] of docText) {
    for (const m of text.matchAll(/\b([a-z]+|\d+)\s+typed vendors\b/g)) {
      if (m[1] !== vendorWord) {
        console.error(`  ✗ ${doc}: says "${m[1]} typed vendors"; the declaration names ${vendorWord}.`);
        problems += 1;
      }
    }
  }

  // 3. The key lists themselves.
  //
  // TWO CHECKS, and they are separate on purpose. Several builders share most of
  // their keys (splunk's event object, the SIEM webhook body and the syslog JSON
  // record differ by three keys and an ordering), so a per-builder near-miss rule
  // reported each one as a corruption of the others. The set-level rule below has no
  // such cross-talk: EVERY backticked run in these documents that carries three or
  // more keys of ANY declared builder must equal SOME declared list exactly. Change
  // one key in a table and the run matches nothing, which is the failure we want; a
  // legitimate second list is simply another exact match.
  const ALL_LISTS = new Set(declarations.map((d) => d.closed.join(", ")));
  const ALL_KEYS = new Set(declarations.flatMap((d) => d.closed));
  for (const [doc, text] of docText) {
    for (const run of text.matchAll(/`([^`]+)`/g)) {
      const parts = run[1].split(", ").map((x) => x.trim());
      if (parts.length < 3) continue;
      if (parts.filter((x) => ALL_KEYS.has(x)).length < 3) continue;
      if (ALL_LISTS.has(run[1])) continue;
      console.error(
        `  ✗ ${doc}: a key list matches no declared builder in payload-fields.ts.\n` +
          `      doc: ${run[1]}\n` +
          "      Every backticked run of three or more declared keys must equal one builder's\n" +
          "      closed set exactly. A table that drifts by one key reads as authoritative.",
      );
      problems += 1;
    }
  }

  // And the other direction: each list a document is supposed to STATE must still be
  // in it. A row that quietly stopped stating its figure guards nothing while reading
  // as though it does. Short lists (fewer than three keys) are checked only this way
  // — the set rule above cannot see them.
  const LISTED = [
    ["siem/splunk.ts", "SplunkAdapter.buildEventPayload"],
    ["siem/splunk.ts", "SplunkAdapter.buildEventPayload#event"],
    ["siem/webhook.ts", "WebhookSIEMAdapter.buildEventPayload"],
    ["syslog/transport.ts", "SyslogAdapter.formatJSON"],
    ["telemetry/mde.ts", "MDEAdapter.getAccessToken"],
    ["telemetry/fleetdm.ts", "FleetDMAdapter.runLiveQuery"],
    ["webhooks/dispatch.ts", "buildPayload"],
    ["caep-events/format.ts", "buildCaepClaims"],
  ];
  for (const [module, builder] of LISTED) {
    const decl = declarations.find((d) => d.module === module && d.builder === builder);
    if (!decl) {
      console.error(`  ✗ a doc row names ${module} ${builder}, which payload-fields.ts no longer declares.`);
      problems += 1;
      continue;
    }
    const want = "`" + decl.closed.join(", ") + "`";
    if (![...docText.values()].some((t) => t.includes(want))) {
      console.error(
        `  ✗ ${builder} (${module}): its declared key list appears in NO outbound-surface document.\n` +
          `      Expected the run ${want}.`,
      );
      problems += 1;
    }
  }
}

if (process.argv.includes("--report")) {
  console.log("Declared outbound builders (REPORTED — the census, not the gate):\n");
  for (const d of declarations) {
    const open = d.open.length === 0 ? "none" : d.open.map((o) => `${o.slot} <- ${o.source}`).join("; ");
    console.log(`  ${d.module}  ${d.builder}\n    closed(${d.closed.length}): ${d.closed.join(", ")}\n    open: ${open}`);
  }
  console.log("");
}

console.log(
  `\nemit-payload-discipline: ${families.length} families (${families.join(", ")}), ` +
    `${modules.length} outbound modules scanned, ${declarations.length} builders declared, ` +
    `${untypedMaps.size} untyped map fields derived (${[...untypedMaps].sort().join(", ")}), ` +
    `${builtTypes.size} own-envelope type(s) derived (${[...builtTypes].sort().join(", ") || "none"}), ` +
    `${problems} violation(s); self-test green`,
);

if (problems > 0) {
  console.error(
    "\nEmit payload discipline FAILED.\n" +
      "A whole-object copy at an outbound boundary is a field that starts crossing to a\n" +
      "customer the day somebody widens a type somewhere else. Name what leaves.",
  );
  process.exit(1);
}
console.log("Emit payload discipline passed — every field crossing to a vendor is named, and every open slot is declared.");
