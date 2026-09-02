// No outbound fetch in a connector may run without the emission/live gate.
//
//   node scripts/check-ungated-fetch.mjs
//
// WHY THIS EXISTS. `docs/SECURITY_REVIEW_PACKAGE.md` tells an external assessor that
// the FIRST thing to verify is the fixture/live boundary: no connector reaches the
// network unless tier is beta/prod AND SIGNALGRID_LIVE_INTEGRATIONS=true AND a
// credential is present. An automated review took that document at its word, went
// looking, and found the claim false: `healthCheck()` on the SIEM webhook adapter and
// six ITSM adapters performed a real `fetch` to a configured URL with NONE of the
// three conditions checked.
//
// It was easy to miss for a specific reason worth recording: a health check does not
// FEEL like an emission. Nothing is sent, nothing is written, the return type is a
// boolean. But it resolves a configured hostname and opens a connection from wherever
// the process runs — in dev, that is a developer's laptop; in CI, a shared runner.
// That is a live call, and the boundary either covers every outbound path or it is
// not a boundary.
//
// The seven call sites are fixed. This gate is here so the eighth cannot arrive
// quietly — the same reasoning as the publication boundary: for a rule this
// load-bearing, remembered is the same as absent.
//
// WHAT IT CANNOT DO, stated because the tempting version overclaims. This is a static
// scan for fetch calls inside connector sources, checking that the enclosing function
// mentions the gate. It cannot prove the gate is reached on every path, cannot follow
// a fetch through a helper in another module, and does not look outside
// `lib/integrations`. It proves that no connector function calls fetch WITHOUT
// naming the gate — a necessary condition, not a sufficient one.
//
// THE BLIND SPOT THAT MADE IT LIE. For its whole life this gate matched the literal
// string `fetch(`. Its very first line is `if (!text.includes("fetch(")) continue;` —
// so a file that reaches the network exclusively through the repo's own
// `fetchWithTimeout()` helper contains no such substring and was never scanned AT ALL.
// Four adapter files were in that position, and two of them — `itsm/servicenow.ts` and
// `itsm/jira.ts` — have no gate token anywhere in the file, with `healthCheck()`
// methods that are precisely the ENFORCED class this gate was written to catch. It
// printed green over them.
//
// That is worse than the original defect. The original was an ungated call nobody had
// looked for; this was an ungated call the designated looker reported as absent.
//
// Two changes, so the shape cannot recur:
//
//   · FETCH_CALL matches any identifier containing "fetch", not the bare builtin. A
//     false positive here is loud and takes a minute to fix; a false negative is a
//     silent hole in the boundary the security package tells assessors to check first.
//   · assertNoUnseenWrapper() DERIVES the wrapper names — it reads every helper under
//     `lib/integrations/src/utils/` that itself calls the real `fetch`, and fails if
//     any of their names would not be matched by FETCH_CALL. Name the next helper
//     `httpPost` and this gate fails demanding to be widened, instead of going quiet.

// FOUR ASSERTIONS NOW, and they answer different questions about the same call:
//
//   1. WAS IT ALLOWED TO HAPPEN — the enclosing function names the emit gate.
//      (The original. Everything above describes it.)
//   2. IS IT BOUNDED — the fetch options object carries a `signal:` whose VALUE this
//      scan can resolve to a real bound (an inline `AbortSignal.timeout(...)`, or an
//      identifier assigned from one in the same file). `signal: undefined` used to
//      satisfy it, which is the option switched OFF clearing the check that exists to
//      require it. Scoped to network PRIMITIVES: a call to a fetch-named method
//      declared in the same file is a delegation, and its bound belongs at the
//      primitive inside it — demanding one at the delegation flagged correct code in
//      passkey-assurance. 27 outbound calls
//      across the six emitter families had none, including both retry loops
//      (siem/webhook.ts and itsm/generic-webhook.ts), where three unbounded attempts
//      run in series behind one caller's await. An unbounded fetch is not a
//      correctness bug in the vendor's eyes and never shows up as an error; it shows
//      up as a request slot that never returns.
//   3. IS THE KNOB CONNECTED — a config field named `timeout*` that nothing reads is
//      a finding. Ten adapters declared `timeout?: number`, defaulted it to 30000 in
//      the constructor, and NO line of code anywhere read it. An operator setting it
//      changed nothing, and the field is the reason nobody noticed assertion 2 was
//      false: the configurability existed on paper.
//
//   4. WAS THE CREDENTIAL NAMED — every `resolveEmission(` call passes a second
//      argument. The clause is checked against what the CALLER passes, and the
//      parameter was optional when it landed: 36 of 37 sites omitted it, so the
//      third condition of a boundary three documents call closed was enforced in
//      one place. A family holding no secret passes NO_CREDENTIAL and says so.
//
// Assertions 2 and 3 are ENFORCED in the six emitter families and REPORTED elsewhere.
// The family set is DERIVED — directories under the scan root whose `resolve.ts`
// imports `createEmitterResolver` — so a seventh emitter family is covered the day it
// is added, and a hand-maintained copy of the list cannot go stale.

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "lib/integrations/src/integrations";
const UTIL_ROOT = "lib/integrations/src/utils";
/** Comments must not clear a gate (review finding): a body containing
 *  "// resolveEmission is deliberately not called here" beside an ungated call
 *  read as GATED. Tokens are matched against comment-stripped text; the "//"
 *  strip spares protocol separators (https://...) so a URL cannot eat a real
 *  token that follows it on the same line. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

// Directories where an ungated outbound call FAILS the build rather than being
// reported. Named here, once, so the run can print the list instead of a comment
// asserting it — the previous shape stated the membership in prose and drifted.
const ENFORCED_DIRS = ["itsm", "siem", "telemetry", "passkey-assurance"];
const ENFORCED_DIR_RE = new RegExp(`/(${ENFORCED_DIRS.join("|")})/`);

const GATE_TOKENS = ["resolveEmission", "SIGNALGRID_LIVE_INTEGRATIONS", "resolveLive", "mode !== \"live\"", "mode === \"live\""];

// Any callee whose identifier contains "fetch" — the builtin AND every wrapper around
// it. The negative lookbehind keeps `obj.fetch(` and `this.doFetch(` in scope while
// excluding nothing that matters; breadth is the point. `new WebSocket…(` joined the
// pattern when the Fleet live-query collector landed: a websocket connect is an
// outbound call that never says "fetch", and an unscanned transport is exactly the
// hole this gate exists to close.
const FETCH_CALL = /(?<![\w$])(?:[\w$]*[Ff]etch[\w$]*|new\s+[\w$]*WebSocket[\w$]*)\s*\(/;

/**
 * Is an exported top-level function the FACTORY HALF of a gated resolver?
 *
 * WHY THIS EXISTS. Scope used to be class methods ONLY, and the stated reason was
 * external callability: a method "is externally callable on a constructed adapter, so
 * nothing stands between a caller and the network". An EXPORTED top-level function has
 * that same property — `index.ts` re-exports it — but was dropped from the scan
 * entirely, neither gated nor counted. Planting
 * `export async function x(u){ return fetch(u) }` in itsm/zendesk.ts, an ENFORCED
 * directory, left the gate GREEN (2026-08-24). The scope test measured a real property
 * and answered a different question than the one its own comment asked.
 *
 * Admitting every exported function naively re-opens the false-positive flood the first
 * draft of this gate died of: ~25 `makeDefault*Transport(...)` factories that ARE gated
 * one level up, by the `resolve*Connector` that calls them. So the clearing rule is the
 * same shape as the two already here — verified, not trusted:
 *
 *   an exported top-level function clears ONLY IF every call site of it, in its own file
 *   or its family's index.ts, sits inside a function whose body carries a gate token.
 *
 * Fail-closed twice over. A function with NO call site is NOT cleared — nothing local
 * gates it, so its only reachable caller is outside the family, which is exactly the
 * planted hole. And one ungated site among gated ones does not clear.
 */
export function consumedByGatedFn(sources, name, gateTokens = GATE_TOKENS) {
  const texts = Array.isArray(sources) ? sources : [sources];
  let sites = 0;
  for (const text of texts) {
    const r = callSitesGated(text, name, gateTokens);
    if (r === null) return false;
    sites += r;
  }
  return sites > 0;
}

/** Call sites of `name` in ONE source: count if all are gated, null if any is not. */
function callSitesGated(text, name, gateTokens) {
  const lines = text.split("\n");
  const decl = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${name}\\b`);
  const use = new RegExp(`(?<![\\w$.])${name}\\s*\\(`);
  let sites = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (decl.test(lines[i])) continue;
    if (/^\s*(\/\/|\*)/.test(lines[i])) continue;
    if (/^\s*(export\s+)?import\b/.test(lines[i])) continue;
    if (!use.test(lines[i])) continue;
    sites += 1;
    let start = -1;
    for (let j = i; j >= 0 && j > i - 120; j -= 1) {
      const topLevelFn = /^(export\s+)?(async\s+)?function\s+\w+/.test(lines[j]);
      const methodDecl =
        /^  (private\s+|public\s+|protected\s+)?(async\s+)?[A-Za-z_]\w*\s*\(/.test(lines[j]) &&
        !/^\s*(if|for|while|switch|catch|return|await|else)\b/.test(lines[j]);
      if (topLevelFn || methodDecl) { start = j; break; }
    }
    if (start === -1) return null;
    const body = stripComments(lines.slice(start, i + 1).join("\n"));
    if (!gateTokens.some((t) => body.includes(t))) return null;
  }
  return sites;
}

/**
 * The six emitter families, DERIVED. A directory under the scan root is an emitter
 * family iff its `resolve.ts` imports `createEmitterResolver` — the shared
 * fail-closed factory every emitter's resolve.ts is built from. Hand-listing them
 * here is what `adapters/emit-gate.ts` and two proofs already did wrong once.
 */
export function deriveEmitterFamilies(readDir, readFile) {
  const families = [];
  for (const entry of readDir()) {
    let src;
    try { src = readFile(`${entry}/resolve.ts`); } catch { continue; }
    if (/createEmitterResolver/.test(src)) families.push(entry);
  }
  return families.sort();
}

/**
 * The argument text of the call whose opening paren is at `open`, brackets balanced.
 * Returned with the parens, so an empty options object is still visible.
 */
export function callArgs(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open); // unbalanced — treat as the whole tail rather than crash
}

/**
 * Fetch-shaped functions declared IN THIS FILE whose own body bounds the request.
 *
 * `this.fetchHostWithPolicies(uuid)` is not a network primitive — it is a private
 * method one line over, and the fetch inside it already carries an AbortSignal.
 * Demanding a `signal:` at the delegating call site would be demanding a bound on
 * a call that has one, i.e. flagging correct code, which is how a gate earns being
 * switched off. Derived from the body, not from the name: rename the helper or
 * strip its AbortSignal and every call site goes red.
 */
export function selfBoundingLocals(text) {
  const lines = stripComments(text).split("\n");
  const names = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*(?:export\s+)?(?:private\s+|public\s+|protected\s+)?(?:async\s+)?(?:function\s+)?([\w$]*[Ff]etch[\w$]*)\s*\(/);
    if (m === null) continue;
    // The declaration's body: up to the next declaration at the same indent, capped.
    const body = lines.slice(i, Math.min(i + 60, lines.length)).join("\n");
    if (/AbortSignal\.timeout/.test(body)) names.add(m[1]);
  }
  return names;
}

/**
 * Sites whose `signal:` this scan cannot resolve, cleared BY NAME with a reason.
 *
 * Empty on this tree, and that is measured rather than assumed: every `signal:` in
 * `lib/integrations/src/integrations` today is an inline `AbortSignal.timeout(...)`.
 * The map exists so the first genuinely INJECTED signal — one minted by a caller that
 * owns the deadline — gets an entry a reader can check, instead of the predicate being
 * widened until it clears everything again.
 */
export const INJECTED_SIGNALS = new Map([
  // ["family/connector.ts:120", "the deadline is the caller's; it passes its own signal in"],
]);

/**
 * Is this identifier bound to a real abort source IN THIS FILE?
 *
 * `signal: s` used to clear the bound on the strength of the property NAME alone, so
 * `signal: undefined` — the shape that switches the option off — cleared it too. The
 * binding has to be found: `const s = AbortSignal.timeout(...)`, a caller-owned
 * `new AbortController()` whose `.signal` is passed, or an `AbortSignal`-typed
 * parameter in a file that mints a timeout somewhere (the bound is threaded, not
 * absent). Anything else is unresolved, and unresolved is not bounded.
 */
export function identifierIsBound(text, name) {
  if (!name || name === "undefined" || name === "null") return false;
  const code = stripComments(text);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:const|let|var)\\s+${esc}\\s*(?::[^=;]+)?=\\s*(?:AbortSignal\\.timeout\\s*\\(|new\\s+AbortController\\s*\\()`).test(code)) return true;
  if (new RegExp(`\\b${esc}\\s*:\\s*AbortSignal\\b`).test(code) && /AbortSignal\.timeout\s*\(/.test(code)) return true;
  return false;
}

/**
 * Does this call's argument list bound the request?
 *
 * `signal:` as a PROPERTY, so a variable called `signalContext` or a comment
 * mentioning signals does not clear it — AND the VALUE must be a bound this scan can
 * point at. It previously accepted any `signal:` property whatsoever, so
 * `signal: undefined` and `signal: maybe` (an identifier assigned from nothing) both
 * read as bounded: the assertion was satisfied by the word rather than by the bound.
 * `fileText` supplies the scope in which an identifier is resolved; without it only
 * the inline form clears.
 */
export function boundedByAbortSignal(args, fileText = "") {
  const a = stripComments(args);
  const m = a.match(/(?<![\w$.])signal\s*:\s*([^,}\n]+)/);
  if (m === null) return false;
  const value = m[1].trim().replace(/[,;)]+$/, "");
  if (/^AbortSignal\.timeout\s*\(/.test(value)) return true;
  if (!/^[\w$]+(?:\.[\w$]+)*$/.test(value)) return false; // a call of something else, a ternary, `undefined`
  return identifierIsBound(fileText, value.split(".")[0]);
}

/**
 * Fetch-shaped callees DECLARED IN THIS FILE — delegations, not network primitives.
 *
 * `this.fetchNormalized(identityRef, ref)` is a method one screen up whose own body
 * reaches the transport; demanding an `AbortSignal` at the delegating call site
 * demands it in the wrong place, and passkey-assurance was REPORTED as an unbounded
 * outbound site for exactly that reason — a false positive against correct code, in a
 * file that opens no socket of its own. The primitive inside the declaration is a
 * separate site in this same scan and is still required to bound, so nothing is lost.
 *
 * Derived from declarations in the file, never from a name list.
 */
export function locallyDeclaredFetchLikes(text) {
  const names = new Set();
  for (const line of stripComments(text).split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?(?:private\s+|public\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?([\w$]*[Ff]etch[\w$]*)\s*(?:<[^>]*>)?\s*\(/);
    if (m !== null) names.add(m[1]);
  }
  return names;
}

/** Commas at the TOP level of a bracketed argument list — how many arguments a call
 *  passes, without parsing TypeScript. Nested calls, objects and generics do not count. */
export function topLevelArgCount(args) {
  const body = args.replace(/^\(/, "").replace(/\)$/, "");
  if (body.trim() === "") return 0;
  let depth = 0;
  let count = 1;
  for (const ch of body) {
    // Angle brackets are deliberately NOT balanced here: `=>` and `a > b` are far more
    // common inside an argument list than a generic carrying a top-level comma, and
    // treating `>` as a closer drove the depth negative and hid the comma after it.
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) count += 1;
  }
  return count;
}

/**
 * ASSERTION 4 — every `resolveEmission(` call names the credential it holds.
 *
 * The credential parameter was OPTIONAL when it landed, and 36 of the 37 call sites in
 * lib/ omitted it — so the third clause of the boundary (tier AND live flag AND a
 * credential) was enforced only in the ITSM factory. Measured, not argued:
 * `new ZendeskAdapter({instanceUrl, email: "", apiToken: ""}).createTicket(...)` at
 * prod with the flag on POSTed to the configured host carrying
 * `Authorization: Basic L3Rva2VuOg==`.
 *
 * The parameter is now required, so the compiler catches an omission — but a type is
 * erased and this repository is also read by tools that never run tsc, so the shape is
 * asserted lexically too. A family with no secret must say `NO_CREDENTIAL`; the point
 * is that it is SAID.
 */
export function resolveEmissionCallsMissingCredential(text) {
  const code = stripComments(text);
  const out = [];
  for (const m of code.matchAll(/(?<![\w$.])resolveEmission\s*\(/g)) {
    const before = code.slice(Math.max(0, m.index - 30), m.index);
    if (/(?:function|import)\s+$/.test(before)) continue; // the declaration is not a call
    const args = callArgs(code, m.index + m[0].length - 1);
    if (topLevelArgCount(args) < 2) {
      out.push({ line: code.slice(0, m.index).split("\n").length, text: `resolveEmission${args.slice(0, 60)}` });
    }
  }
  return out;
}

/**
 * Config fields named `timeout*` that NOTHING reads.
 *
 * A read is a member access — `this.config.timeout`, `opts.timeoutMs`. The field's
 * own declaration (`timeout?: number;`) and its own assignment in an object literal
 * (`timeout: config.timeout || 30000`) do not count; the right-hand side of that
 * assignment reads the *incoming parameter*, which is why the naive "does the name
 * appear twice" test reported all ten of these as connected.
 */
export function unreadTimeoutFields(text) {
  const code = stripComments(text);
  const declared = new Set();
  for (const m of code.matchAll(/^\s*(timeout[\w$]*)\??\s*:\s*(number|string)\s*;/gim)) {
    declared.add(m[1]);
  }
  const unread = [];
  for (const name of declared) {
    const reads = code
      .split("\n")
      // `AbortSignal.timeout(...)` is the BOUNDING CALL, not a read of the field —
      // and it contains the literal `.timeout`, so counting it would clear every
      // file that bounds its fetches with a hardcoded preset. That is precisely the
      // shape this assertion exists to find.
      .map((line) => line.replace(/AbortSignal\.timeout/g, "AbortSignal.__bound"))
      // The field's OWN assignment, wherever it sits on the line: `timeout: config.timeout
      // || 30000` reads the incoming PARAMETER, not the field, and counting it cleared
      // all ten of the dead knobs.
      .filter((line) => !/(^|[{,(])\s*timeout[\w$]*\s*:/i.test(line))
      .filter((line) => new RegExp(`\\.${name}\\b`).test(line)).length;
    if (reads === 0) unread.push(name);
  }
  return unread.sort();
}

/**
 * The gate's own blind-spot detector.
 *
 * FETCH_CALL is a naming convention, and a convention that nobody enforces is a
 * convention that eventually gets broken — which is exactly how the `fetchWithTimeout`
 * hole opened. So: find every helper under utils/ that calls the real `fetch`, and
 * assert its exported name would be MATCHED by FETCH_CALL. A future `httpPost()` helper
 * fails this with an explicit instruction, rather than silently removing files from the
 * scan the way its predecessor did.
 */
function assertNoUnseenWrapper() {
  const utilFiles = execFileSync("git", ["ls-files", UTIL_ROOT], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const unseen = [];
  for (const file of utilFiles) {
    const text = readFileSync(resolve(repoRoot, file), "utf8");
    // Does this helper reach a real network primitive? `fetch(` AND WebSocket
    // construction both count — a utils helper wrapping `new WebSocket` would
    // otherwise recreate the exact fetchWithTimeout blind spot this function
    // exists to close, with a transport that never says "fetch" (review
    // finding, 2026-08-18).
    const reachesNetwork = /(?<![\w$.])fetch\s*\(/.test(text) || /\bWebSocket\b/.test(stripComments(text));
    if (!reachesNetwork) continue;
    for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)) {
      const name = m[1];
      if (!FETCH_CALL.test(`${name}(`)) unseen.push(`${file} → ${name}()`);
    }
  }
  return unseen;
}

// Files whose `fetch` is not a connector reaching a vendor. Each needs a reason a
// reader can check — an unexplained exemption is how a gate quietly stops gating.
const EXEMPT = new Map([
  ["adapters/emit-gate.ts", "the gate itself"],
  // telemetry/mde.ts WAS exempt here, with a stated reason printed on every run: it was
  // gated by a local `config.enabled` flag instead of the tier + SIGNALGRID_LIVE_INTEGRATIONS
  // boundary, and the entry called that "an OPEN QUESTION, not a clearance". The question
  // is now answered — `MDEAdapter.isEnabled()` requires resolveEmission().mode === "live"
  // as well, which covers all five of its fetch sites — so the exemption is deleted rather
  // than left standing as a permanent apology. An exemption that outlives its reason
  // becomes a hole nobody re-examines.
]);

/**
 * Falsification harness. A guard nobody has watched FAIL proves nothing, and this gate
 * shipped for months with no way to watch it fail — which is how the exported-function
 * hole survived. Fixture 1 IS the planted defect, kept permanently.
 *   node scripts/check-ungated-fetch.mjs --self-test
 */
function selfTest() {
  const gatedResolver = [
    'export function resolveX(env) {',
    '  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") return null;',
    '  return makeT(env.baseUrl);',
    '}',
    'export function makeT(u) { return () => fetch(u); }',
  ].join("\n");
  const ungatedCaller = [
    'export function buildX(env) {',
    '  return makeT(env.baseUrl);',
    '}',
    'export function makeT(u) { return () => fetch(u); }',
  ].join("\n");
  const orphan = 'export async function plantedUngated(u) {\n  return fetch(u);\n}';
  const mixed = gatedResolver + "\n" + [
    'export function alsoBuilds(env) {',
    '  return makeT(env.baseUrl);',
    '}',
  ].join("\n");
  const plantedUnbounded = "const r = await fetch(url, { method: 'POST', headers, body });";
  const plantedBounded = "const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(1000) });";
  const plantedMultiline = [
    "const r = await fetch(url, {",
    "  method: 'POST',",
    "  headers: { 'Content-Type': 'application/json' },",
    "  signal: AbortSignal.timeout(this.config.timeout),",
    "});",
  ].join("\n");
  const plantedNested = [
    "const r = await fetch(`${base}/v2/tickets`, {",
    "  headers: { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` },",
    "  signal: AbortSignal.timeout(30000),",
    "});",
  ].join("\n");
  const deadKnob = "interface C {\n  timeout?: number;\n}\nconst c = { timeout: config.timeout || 30000 };";
  const liveKnob = deadKnob + "\nawait fetch(u, { signal: AbortSignal.timeout(this.config.timeout) });";
  const presetOnlyKnob = deadKnob + "\nawait fetch(u, { signal: AbortSignal.timeout(TIMEOUT_PRESETS.normal) });";
  const mentionOnly = [
    'export function resolveX(env) {',
    '  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") return null;',
    '  // makeT(url) is what we would call here',
    '  return null;',
    '}',
    'export function makeT(u) { return () => fetch(u); }',
  ].join("\n");

  const checks = [
    ["an exported factory with NO call site is NOT cleared — the planted hole", consumedByGatedFn(orphan, "plantedUngated") === false],
    ["an exported factory called by a GATED resolver is cleared", consumedByGatedFn(gatedResolver, "makeT") === true],
    ["an exported factory called by an UNGATED function is NOT cleared", consumedByGatedFn(ungatedCaller, "makeT") === false],
    ["one gated site + one ungated site is NOT cleared — fail-closed on the weakest", consumedByGatedFn(mixed, "makeT") === false],
    ["a call site cleared in a SIBLING source counts (factory one file over from its resolver)", consumedByGatedFn([orphan.replace("plantedUngated", "makeT"), gatedResolver], "makeT") === true],
    ["a name appearing only in a COMMENT is not a call site", consumedByGatedFn(mentionOnly, "makeT") === false],
    ["a name appearing only in an IMPORT is not a call site", consumedByGatedFn('import { makeT } from "./t";\nexport function makeT(u) { return () => fetch(u); }', "makeT") === false],
    ["the enforced-dir regex is DERIVED from ENFORCED_DIRS, not a second copy of the list",
      ENFORCED_DIRS.every((d) => ENFORCED_DIR_RE.test(`lib/integrations/src/integrations/${d}/x.ts`))],
    ["a directory NOT in the list is not enforced", !ENFORCED_DIR_RE.test("lib/integrations/src/integrations/telemetry-ish/x.ts")],
    ["the enforced list is non-empty — an empty list would silently make every finding advisory", ENFORCED_DIRS.length > 0],
    ["FETCH_CALL still matches a wrapper callee", FETCH_CALL.test("fetchWithTimeout(")],
    ["FETCH_CALL still matches the bare builtin", FETCH_CALL.test("fetch(")],

    // ── assertion 2: is it bounded ────────────────────────────────────────────
    ["a fetch options object WITHOUT signal is unbounded — the planted defect",
      boundedByAbortSignal(callArgs(plantedUnbounded, plantedUnbounded.indexOf("(", plantedUnbounded.indexOf("fetch")))) === false],
    ["the same call WITH signal is bounded (the probe is not always-fail)",
      boundedByAbortSignal(callArgs(plantedBounded, plantedBounded.indexOf("(", plantedBounded.indexOf("fetch")))) === true],
    ["a MULTI-LINE options object is read whole, not just its first line",
      boundedByAbortSignal(callArgs(plantedMultiline, plantedMultiline.indexOf("(", plantedMultiline.indexOf("fetch")))) === true],
    ["a nested template literal with braces does not truncate the argument scan",
      boundedByAbortSignal(callArgs(plantedNested, plantedNested.indexOf("(", plantedNested.indexOf("fetch")))) === true],
    ["a variable NAMED signalContext does not clear the bound",
      boundedByAbortSignal("(url, { headers, body: signalContext })") === false],
    ["`signal:` inside a COMMENT does not clear the bound",
      boundedByAbortSignal("(url, { headers /* signal: AbortSignal.timeout(1) */ })") === false],

    // ── assertion 2, continued: the signal must be a bound, not the word ──────
    ["`signal: undefined` does NOT clear the bound — the planted defect",
      boundedByAbortSignal("(url, { method: 'POST', signal: undefined })") === false],
    ["`signal: <identifier>` with no bounding assignment in the file does NOT clear it — the planted defect",
      boundedByAbortSignal("(url, { signal: maybe })", "const maybe = opts.signal;\nawait fetch(url, { signal: maybe });") === false],
    ["`const s = AbortSignal.timeout(5000)` then `signal: s` IS bounded",
      boundedByAbortSignal("(url, { signal: s })", "const s = AbortSignal.timeout(5000);\nawait fetch(url, { signal: s });") === true],
    ["a caller-owned `new AbortController()` passed as `signal: c.signal` IS bounded",
      boundedByAbortSignal("(url, { signal: c.signal })", "const c = new AbortController();") === true],
    ["an `AbortSignal`-typed parameter in a file that mints a timeout IS bounded (threaded, not absent)",
      boundedByAbortSignal("(url, { signal })".replace("signal }", "signal: sig }"), "function get(u: string, sig: AbortSignal) {}\nget(u, AbortSignal.timeout(1000));") === true],
    ["the inline form still clears it (the predicate is not always-fail)",
      boundedByAbortSignal("(url, { signal: AbortSignal.timeout(this.config.timeout) })") === true],
    ["a bound resolved in ANOTHER file does not leak in — resolution is file-scoped",
      boundedByAbortSignal("(url, { signal: s })", "") === false],

    // ── assertion 2, scope: a delegation is not a network primitive ───────────
    ["a fetch-NAMED method declared in this file is a local declaration",
      locallyDeclaredFetchLikes("  async fetchNormalized(id: string): Promise<X> {\n    return this.transport.get(id);\n  }").has("fetchNormalized")],
    ["the bare builtin is never a local declaration (it must always bound)",
      locallyDeclaredFetchLikes("const r = await fetch(u, { signal: AbortSignal.timeout(1) });").has("fetch") === false],
    ["an IMPORTED fetch-named helper is not a local declaration — it still must bound at the call site",
      locallyDeclaredFetchLikes('import { fetchThing } from "./t";\nawait fetchThing(u);').has("fetchThing") === false],
    ["the injected-signal exclusion map is a Map that can hold an entry with a reason", INJECTED_SIGNALS instanceof Map],

    // ── assertion 4: every resolveEmission( names its credential ──────────────
    ["a bare `resolveEmission()` IS a finding — the planted defect",
      resolveEmissionCallsMissingCredential("const e = resolveEmission();").length === 1],
    ["`resolveEmission(process.env)` — env only, credential omitted — IS a finding",
      resolveEmissionCallsMissingCredential("const e = resolveEmission(process.env);").length === 1],
    ["`resolveEmission(process.env, this.emissionCredential())` is clean (the gate does not punish the fix)",
      resolveEmissionCallsMissingCredential("const e = resolveEmission(process.env, this.emissionCredential());").length === 0],
    ["`resolveEmission(process.env, NO_CREDENTIAL)` is clean — a family with no secret says so",
      resolveEmissionCallsMissingCredential("const e = resolveEmission(process.env, NO_CREDENTIAL);").length === 0],
    ["the DECLARATION of resolveEmission is not a call site",
      resolveEmissionCallsMissingCredential("export function resolveEmission(\n  env: NodeJS.ProcessEnv,\n  credential: EmissionCredential | NoCredential,\n): EmitResolution {").length === 0],
    ["a call in a COMMENT is not a call site",
      resolveEmissionCallsMissingCredential("// this used to be resolveEmission()\nconst x = 1;").length === 0],
    ["a comma NESTED inside one argument does not fake a second argument",
      resolveEmissionCallsMissingCredential("const e = resolveEmission(makeEnv(a, b));").length === 1],
    ["a multi-line two-argument call is read whole",
      resolveEmissionCallsMissingCredential("const e = resolveEmission(\n  process.env,\n  { name: 'X', value: v },\n);").length === 0],
    ["topLevelArgCount is not fooled by an arrow function in an argument",
      topLevelArgCount("(process.env, (x) => x.value)") === 2],

    // ── assertion 3: is the knob connected ────────────────────────────────────
    ["a timeout field read by nothing IS a finding — the planted defect",
      JSON.stringify(unreadTimeoutFields(deadKnob)) === JSON.stringify(["timeout"])],
    ["a timeout field read at a call site is NOT a finding",
      unreadTimeoutFields(liveKnob).length === 0],
    ["`AbortSignal.timeout(PRESET)` does NOT count as reading the field it shadows",
      JSON.stringify(unreadTimeoutFields(presetOnlyKnob)) === JSON.stringify(["timeout"])],
    ["a differently-named knob (timeoutMs) is caught too — the rule is the prefix, not the word",
      JSON.stringify(unreadTimeoutFields(deadKnob.replace(/timeout/g, "timeoutMs"))) === JSON.stringify(["timeoutMs"])],

    // ── the derivation itself ─────────────────────────────────────────────────
    ["a delegating call to an in-file helper that bounds its OWN fetch is not flagged",
      selfBoundingLocals("  private async fetchHost(u) {\n    return fetch(u, { signal: AbortSignal.timeout(1) });\n  }").has("fetchHost")],
    ["an in-file helper whose fetch is UNBOUNDED does not clear its callers — the planted defect",
      selfBoundingLocals("  private async fetchHost(u) {\n    return fetch(u, { headers });\n  }").has("fetchHost") === false],
    ["emitter families are DERIVED from resolve.ts importing createEmitterResolver",
      JSON.stringify(deriveEmitterFamilies(() => ["itsm", "siem", "nac"], (rel) =>
        rel.startsWith("nac/") ? "export const x = 1;" : "import { createEmitterResolver } from '../adapters/emitter-resolver';")) ===
        JSON.stringify(["itsm", "siem"])],
    ["a directory with NO resolve.ts is not an emitter family",
      deriveEmitterFamilies(() => ["graph"], () => { throw new Error("ENOENT"); }).length === 0],
    ["the real tree still yields at least six emitter families",
      deriveEmitterFamilies(
        () => readdirSync(resolve(repoRoot, SCAN_ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name),
        (rel) => readFileSync(resolve(repoRoot, SCAN_ROOT, rel), "utf8"),
      ).length >= 6],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const files = execFileSync("git", ["ls-files", SCAN_ROOT], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const findings = [];
const unaudited = [];
let scanned = 0;
let fetchSites = 0;

// ── ASSERTIONS 2 AND 3 ───────────────────────────────────────────────────────
// The emitter families, derived (see deriveEmitterFamilies). Enforced scope for
// bounding and for the timeout-knob check; everything else is REPORTED.
const EMITTER_FAMILIES = deriveEmitterFamilies(
  () =>
    readdirSync(resolve(repoRoot, SCAN_ROOT), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  (rel) => readFileSync(resolve(repoRoot, SCAN_ROOT, rel), "utf8"),
);
const EMITTER_FAMILY_RE = new RegExp(`/(${EMITTER_FAMILIES.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})/`);

// Wrappers that bound the request THEMSELVES, derived rather than trusted: a helper
// under utils/ whose own body contains `AbortSignal.timeout` needs no `signal:` at
// its call site. Rename or gut the helper and its callers go red.
const SELF_BOUNDING_WRAPPERS = new Set();
for (const file of execFileSync("git", ["ls-files", UTIL_ROOT], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  if (!/AbortSignal\.timeout/.test(text)) continue;
  for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)) SELF_BOUNDING_WRAPPERS.add(m[1]);
}

const unbounded = [];
const unboundedReported = [];
const delegatedSites = [];
const injectedSignalSites = [];
const deadTimeoutKnobs = [];
const missingCredentialArgs = [];
let resolveEmissionCalls = 0;
let primitiveSites = 0;
let boundedSites = 0;

for (const file of files) {
  const rel = file.slice(`${SCAN_ROOT}/`.length);
  if (EXEMPT.has(rel)) continue;
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  if (!FETCH_CALL.test(text)) continue;
  scanned += 1;
  const localBounded = selfBoundingLocals(text);
  const localDeclared = locallyDeclaredFetchLikes(text);

  // ASSERTION 3 — IS THE KNOB CONNECTED. Scoped to files that actually reach the
  // network: syslog/transport.ts declares `timeout` and reads it nowhere, and that
  // is HONEST — it opens no socket at all, so there is nothing to bound. Punishing
  // it would be punishing a true statement about an unimplemented transport.
  for (const name of unreadTimeoutFields(text)) {
    deadTimeoutKnobs.push(`${file}  ${name} — declared, defaulted, read by nothing`);
  }

  // Split into top-level-ish function bodies by scanning for `fetch(` and walking
  // back to the nearest enclosing `function`/method opener.
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!FETCH_CALL.test(lines[i])) continue;
    if (/^\s*(\/\/|\*)/.test(lines[i])) continue; // a mention in a comment
    // An `import { fetchWithTimeout } from …` line names a wrapper without calling it.
    if (/^\s*import\b/.test(lines[i])) continue;
    // Widening FETCH_CALL from the bare builtin to any "fetch"-containing identifier
    // also matches DECLARATIONS — `async fetchPosture(deviceId: string)` is a method
    // signature, not a call. Counting those would have inflated the unenforced list
    // with ~30 phantom sites and buried the two real ones. A declaration names
    // parameters with types and opens a body; a call does neither.
    if (/^\s*(export\s+)?(private\s+|public\s+|protected\s+)?(async\s+)?[\w$]+\s*(<[^>]*>)?\s*\([^)]*\)\s*:\s*\w/.test(lines[i])) continue;
    if (/^\s*(export\s+)?(async\s+)?function\s/.test(lines[i])) continue;
    if (/^\s*(private\s+|public\s+|protected\s+)?(async\s+)?[\w$]+\s*\($/.test(lines[i])) continue; // multi-line signature
    fetchSites += 1;

    // ASSERTION 2 — IS IT BOUNDED. Uses the raw text and the site's absolute offset
    // so a multi-line options object is read whole; `lines[i]` alone sees only the
    // opening brace. HEAD probes are included on purpose: a health check that hangs
    // is a health check that never answers, which is the worst of the three states.
    {
      const offset = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
      const openRel = text.slice(offset).search(/\(/);
      const callee = (lines[i].match(FETCH_CALL) ?? [""])[0].replace(/[^\w$]+$/, "").replace(/^new\s+/, "");
      const wrapped = SELF_BOUNDING_WRAPPERS.has(callee) || localBounded.has(callee);
      const args = openRel === -1 ? "" : callArgs(text.slice(offset), openRel);
      // A WebSocket constructor accepts no AbortSignal — there is no such option on
      // the API — so demanding one would be demanding the impossible. Its bound is
      // the collection window (`timeoutMs`, read by assertion 3), not a request
      // signal. Excluded by SHAPE, with the reason, rather than by file name.
      const isWebSocket = /WebSocket/.test(callee);
      // NOT A NETWORK PRIMITIVE: a fetch-NAMED callee declared in this same file is a
      // delegation, and its bound belongs at the primitive inside the declaration —
      // which is its own site in this scan. Counted and printed, never silently
      // dropped. (`fetch` itself is never "locally declared" in these files.)
      const isLocalDelegation = callee !== "fetch" && !wrapped && localDeclared.has(callee);
      const site = `${file}:${i + 1}  ${lines[i].trim().slice(0, 72)}`;
      if (isLocalDelegation) {
        delegatedSites.push(site);
      } else if (wrapped || isWebSocket || boundedByAbortSignal(args, text)) {
        primitiveSites += 1;
        boundedSites += 1;
      } else if (INJECTED_SIGNALS.has(`${rel}:${i + 1}`)) {
        primitiveSites += 1;
        injectedSignalSites.push(`${site}  — ${INJECTED_SIGNALS.get(`${rel}:${i + 1}`)}`);
      } else {
        primitiveSites += 1;
        if (EMITTER_FAMILY_RE.test(file)) unbounded.push(site);
        else unboundedReported.push(site);
      }
    }

    // Walk back to the enclosing declaration. Only CLASS METHODS are in scope: they
    // are externally callable on a constructed adapter, so nothing stands between a
    // caller and the network. A top-level `makeDefault*Transport(...)` factory is
    // different in kind — it is plumbing the gated `resolve*Connector` builds AFTER
    // checking tier, flag and credential, so flagging it is a false positive. The
    // first draft of this gate did exactly that, reporting 8 sites that were all
    // correctly gated one level up. A gate that cries wolf gets switched off, and a
    // switched-off gate is worse than none because the policy still reads as enforced.
    let start = -1;
    let isClassMethod = false;
    let exportedFnName = null;
    for (let j = i; j >= 0 && j > i - 120; j -= 1) {
      const topLevelFn = /^(export\s+)?(async\s+)?function\s+\w+/.test(lines[j]);
      // Exclude control-flow keywords: `  if (…) {` otherwise reads as a method
      // declaration and anchors the walk-back to the wrong line.
      const methodDecl =
        /^  (private\s+|public\s+|protected\s+)?(async\s+)?[A-Za-z_]\w*\s*\(/.test(lines[j]) &&
        !/^\s*(if|for|while|switch|catch|return|await|else)\b/.test(lines[j]);
      if (topLevelFn) {
        start = j;
        isClassMethod = false;
        const m = lines[j].match(/^export\s+(?:async\s+)?function\s+([\w$]+)/);
        exportedFnName = m === null ? null : m[1];
        break;
      }
      if (methodDecl) { start = j; isClassMethod = true; break; }
    }
    // An EXPORTED top-level function is in scope for the same stated reason class
    // methods are: it is reachable from outside the family, with nothing between the
    // caller and the network. A NON-exported one stays out — it is internal plumbing,
    // and flagging it is the false positive the first draft of this gate died of.
    if (start === -1) continue;
    if (!isClassMethod && exportedFnName === null) continue;
    const body = stripComments(lines.slice(start, i + 1).join("\n"));
    const gated = GATE_TOKENS.some((t) => body.includes(t));
    if (gated) continue;

    // THE FACTORY PATTERN, verified rather than trusted — see consumedByGatedFn.
    // Sources: this file plus the family's own index.ts, since the resolver that builds
    // the live connector often lives one file over from the factory it calls
    // (device-management-health/graph-transport.ts is the case in tree).
    if (!isClassMethod) {
      const sources = [text];
      const sib = resolve(repoRoot, file, "..", "index.ts");
      if (sib !== resolve(repoRoot, file)) {
        try { sources.push(readFileSync(sib, "utf8")); } catch { /* no sibling index.ts */ }
      }
      if (consumedByGatedFn(sources, exportedFnName)) continue;
    }

    // THE CHOKEPOINT PATTERN, verified rather than trusted. mde.ts and
    // fleetdm.ts gate every live path through one `isEnabled()` whose body
    // wraps resolveEmission() — a deliberate single point "that cannot be
    // bypassed by adding a new method". A method guarding on this.isEnabled()
    // is gated ONLY IF this file's isEnabled() itself carries a gate token:
    // mde once had an isEnabled() lookalike that checked config.enabled alone
    // (an operator preference, not a safety control), and accepting the NAME
    // would re-open exactly that hole.
    if (/\bthis\.isEnabled\s*\(\)/.test(body)) {
      const impl = text.match(/isEnabled\s*\(\)\s*:\s*boolean\s*\{[\s\S]*?\n  \}/);
      if (impl !== null && GATE_TOKENS.some((t) => stripComments(impl[0]).includes(t))) continue;
    }

    // THE TRANSPORT-INJECTION PATTERN, verified rather than trusted — the last
    // survivor of the 2026-08-16 audit becomes gate-checked. passkey-assurance's
    // connector reaches the network ONLY through a constructor-injected
    // `this.transport`, and the sole site that constructs it live is the
    // family's index.ts resolver, behind the full three-condition gate. So: a
    // flagged method in a file whose class takes an injected transport counts
    // as gated ONLY IF that family's own index.ts carries a gate token in
    // comment-stripped source — the resolver IS the gate, and if someone strips
    // the gate from the resolver, every method here goes red at once.
    if (/private readonly transport/.test(text)) {
      const idx = resolve(repoRoot, file, "..", "index.mjs").replace(/index\.mjs$/, "index.ts");
      try {
        const resolver = stripComments(readFileSync(idx, "utf8"));
        if (GATE_TOKENS.some((t) => resolver.includes(t))) continue;
      } catch { /* no index.ts — fall through to the report */ }
    }

    // ENFORCED SCOPE, widened 2026-08-16 after the audit it was waiting for:
    //
    //   · `healthCheck()` everywhere — the original class, found and fixed seven-up.
    //   · EVERY outbound method under itsm/, siem/ and telemetry/ — audited: the
    //     itsm/siem adapters ARE
    //     the live transport (nothing constructs them in fixture mode; no proof and
    //     no artifact references the classes), so an ungated method there is a
    //     boundary hole with no caller above it to close it. All seventeen are now
    //     gated in-method, the same shape as the healthCheck fix.
    //
    // THE MODE-POLYMORPHIC FAMILIES ARE NOW ENFORCED TOO, and this comment used to
    // say the opposite. It read "STILL NOT ENFORCED ... telemetry/ and
    // passkey-assurance ... stay visible here" while sitting directly above a line
    // that routed both into the FATAL list — and it contradicted its own preceding
    // bullet, which already listed telemetry/ as enforced. Corrected 2026-08-24; no
    // gate reads English, so a sentence describing the line beneath it is exactly
    // the kind of claim that rots unnoticed.
    //
    // What resolved the original concern: telemetry/ and passkey-assurance methods
    // ARE mode-polymorphic — the same method serves fixture transports in proofs
    // (proof:passkey-assurance drives fetchNormalizedSet with fixtures; the live
    // lanes drive fleetdm/mde with the boundary open), so an in-method `mode !==
    // "live"` throw would break the fixture path it legitimately serves. That was
    // answered by making the CLEARING rules smarter rather than by exempting the
    // directories: the isEnabled() chokepoint check and the transport-injection
    // check both clear a method whose gate lives one level up, verified rather than
    // trusted. So the families are fatal AND their legitimate fixture paths pass.
    //
    // The unenforced remainder is consequently EMPTY on a clean tree. It is still
    // printed when non-empty, because "nothing is deferred right now" and "nothing
    // can ever be deferred" are different claims.
    const enforcedDir = ENFORCED_DIR_RE.test(file);
    if (enforcedDir || /\bhealthCheck\s*\(/.test(lines[start])) {
      findings.push({ file, line: i + 1, fn: lines[start].trim().slice(0, 72) });
    } else {
      unaudited.push(`${file}:${i + 1}  ${lines[start].trim().slice(0, 64)}`);
    }
  }
}

// ── ASSERTION 4 — every resolveEmission( call NAMES the credential it holds ──
// Scanned over every connector source, not only the ones containing a fetch: the ITSM
// factory gates without fetching, and a call that skips the clause is a hole wherever
// it sits.
for (const file of files) {
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  const code = stripComments(text);
  for (const m of code.matchAll(/(?<![\w$.])resolveEmission\s*\(/g)) {
    const before = code.slice(Math.max(0, m.index - 30), m.index);
    if (/(?:function|import)\s+$/.test(before)) continue;
    resolveEmissionCalls += 1;
  }
  for (const hit of resolveEmissionCallsMissingCredential(text)) {
    missingCredentialArgs.push(`${file}:${hit.line}  ${hit.text}`);
  }
}

console.log("Ungated-fetch gate — the fixture/live boundary covers EVERY outbound path\n");
console.log(`  connector files containing fetch: ${scanned}`);
console.log(`  fetch call sites checked:         ${fetchSites}`);
console.log(`  exempt (with a stated reason):    ${EXEMPT.size}`);
for (const [path, reason] of EXEMPT) {
  if (path === "adapters/emit-gate.ts") continue;
  console.log(`\n  ⚠ EXEMPT — ${path}\n      ${reason}`);
}

if (fetchSites === 0) {
  console.error("\n✗ zero fetch sites found — the scan matched nothing, which means it is measuring nothing.");
  process.exit(1);
}

const unseenWrappers = assertNoUnseenWrapper();
if (unseenWrappers.length > 0) {
  console.error(
    `\n✗ ${unseenWrappers.length} network helper(s) whose name FETCH_CALL would not match:\n` +
      unseenWrappers.map((u) => `    ${u}`).join("\n") +
      "\n\n  Every connector file that reaches the network only through such a helper would be\n" +
      "  skipped by this scan entirely — the exact defect that let two ungated healthCheck()\n" +
      "  methods sit behind a green gate. Widen FETCH_CALL, or rename the helper so its name\n" +
      "  contains \"fetch\".",
  );
  process.exit(1);
}
console.log(`  network helpers under utils/:     all named so the scan can see them`);
console.log(`  enforced dirs (a finding FAILS):  ${ENFORCED_DIRS.join(", ")}, plus healthCheck() everywhere`);

// The unenforced remainder, printed every run so partial coverage is never mistaken
// for full coverage — the same convention as the guard registries.
if (unaudited.length > 0) {
  console.log(
    `\n  ⚠ ${unaudited.length} other outbound function(s) NOT covered by this gate.\n` +
      "    The 2026-08-16 audit closed every prior member of this list; anything printed\n" +
      "    here is NEW since then and needs the same treatment. The clearing rules the\n" +
      "    gate now verifies: an in-method gate token; an isEnabled() chokepoint whose\n" +
      "    OWN implementation carries a token (a config.enabled lookalike fails); or a\n" +
      "    constructor-injected transport whose family index.ts resolver carries the\n" +
      "    token (strip the resolver's gate and every method in the family goes red).\n" +
      `    Enforced dirs (a finding FAILS the build): ${ENFORCED_DIRS.join("/, ")}/, plus healthCheck() everywhere.`,
  );
  for (const u of unaudited) console.log(`      ${u}`);
}

// ── ASSERTION 4 REPORT ───────────────────────────────────────────────────────
console.log(`  resolveEmission() call sites:     ${resolveEmissionCalls}, each naming a credential or NO_CREDENTIAL`);

// FLOOR. The clause is only enforced where the call is made, so a scan that finds
// almost no calls is not evidence of anything. 37 sites exist today; 30 is below that
// with room for consolidation, and a derivation that has stopped matching fails here
// instead of reporting an empty set as clean.
if (resolveEmissionCalls < 30) {
  console.error(
    `\n✗ found only ${resolveEmissionCalls} resolveEmission() call site(s) (expected >= 30).\n` +
      "  Either the gate has been removed from the connector families, or this scan has\n" +
      "  stopped matching and assertion 4 is measuring nothing.",
  );
  process.exit(1);
}

if (missingCredentialArgs.length > 0) {
  console.error(
    `\n✗ ${missingCredentialArgs.length} resolveEmission() call(s) passing no credential:\n` +
      missingCredentialArgs.map((m) => `    ${m}`).join("\n") +
      "\n\n  The boundary is THREE conditions — tier AND SIGNALGRID_LIVE_INTEGRATIONS AND a\n" +
      "  credential — and the third is checked only against what the caller passes. An\n" +
      "  omitted argument skipped it silently at 36 of 37 sites: an ITSM adapter built with\n" +
      "  an empty apiToken POSTed to a real vendor carrying `Basic L3Rva2VuOg==`.\n" +
      "  Pass the secret this family's config declares, or NO_CREDENTIAL if it holds none.",
  );
  process.exit(1);
}

// ── ASSERTION 2 + 3 REPORT ───────────────────────────────────────────────────
console.log(`  emitter families (DERIVED):       ${EMITTER_FAMILIES.join(", ")}`);
console.log(`  outbound call sites:              ${fetchSites} (${primitiveSites} network primitives, ${delegatedSites.length} delegating to a local declaration)`);
console.log(`  primitives bounded by a signal:   ${boundedSites}/${primitiveSites}`);
console.log(`  signals cleared BY NAME:          ${INJECTED_SIGNALS.size} (none needed on this tree)`);
for (const d of injectedSignalSites) console.log(`      ⚠ ${d}`);
if (delegatedSites.length > 0) {
  console.log(
    "\n  Delegating call(s) to a fetch-NAMED declaration in the same file. Not network\n" +
      "  primitives: the bound belongs at the primitive inside the declaration, which is\n" +
      "  its own site above. Printed so the exclusion is visible rather than assumed.",
  );
  for (const d of delegatedSites) console.log(`      ${d}`);
}

// FLOORS. Both derivations can silently stop matching, and a scan that finds
// nothing reports everything as clean. Six emitter families exist; a change that
// leaves fewer than six is a broken derivation, not a deleted family.
if (EMITTER_FAMILIES.length < 6) {
  console.error(
    `\n✗ derived only ${EMITTER_FAMILIES.length} emitter families (expected >= 6): ${EMITTER_FAMILIES.join(", ") || "none"}.\n` +
      "  A family is derived from its resolve.ts importing createEmitterResolver. Fewer than\n" +
      "  six means the derivation has drifted, and assertions 2 and 3 are enforcing over a\n" +
      "  smaller tree than they report.",
  );
  process.exit(1);
}
if (boundedSites === 0 || primitiveSites === 0) {
  console.error("\n✗ zero bounded network primitives — the `signal:` probe matched nothing, so it is measuring nothing.");
  process.exit(1);
}

if (unboundedReported.length > 0) {
  console.log(
    `\n  ⚠ ${unboundedReported.length} unbounded fetch site(s) OUTSIDE the emitter families — REPORTED, not gated.\n` +
      "    These families are not all vendor transports and some are mode-polymorphic; the\n" +
      "    bound belongs on them too, but claiming this gate holds them would be false.",
  );
  for (const u of unboundedReported) console.log(`      ${u}`);
}

if (deadTimeoutKnobs.length > 0) {
  console.error(
    `\n✗ ${deadTimeoutKnobs.length} config field(s) named timeout* that nothing reads:\n` +
      deadTimeoutKnobs.map((d) => `    ${d}`).join("\n") +
      "\n\n  A timeout an operator can set and no code consults is a knob with nothing behind\n" +
      "  it — and it is why nobody noticed the fetches were unbounded: the configurability\n" +
      "  existed on paper. Read it at the call sites, or delete the field.",
  );
  process.exit(1);
}

if (unbounded.length > 0) {
  console.error(
    `\n✗ ${unbounded.length} outbound fetch site(s) in an emitter family with no AbortSignal:\n` +
      unbounded.map((u) => `    ${u}`).join("\n") +
      "\n\n  Add `signal: AbortSignal.timeout(<bounded ms>)` — the adapter's configured\n" +
      "  `timeout` where it has one. Inside a retry loop this is per ATTEMPT: three\n" +
      "  unbounded attempts in series is three hangs behind one caller's await.",
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n✗ ${findings.length} outbound fetch site(s) with no live-gate check in the enclosing function:\n`);
  for (const f of findings) console.error(`    ${f.file}:${f.line}  in  ${f.fn}`);
  console.error(
    "\n  A health check is still a live call: it resolves a configured hostname and\n" +
      "  opens a connection from wherever the process runs. Gate it with resolveEmission()\n" +
      "  (return the safe value when mode !== \"live\"), or add it to EXEMPT with a reason.",
  );
  process.exit(1);
}

console.log(
  "\n  NOT established: that the gate is REACHED on every path. This is a static scan —\n" +
    "  it proves no connector function calls fetch without naming the gate, which is a\n" +
    "  necessary condition, not a sufficient one.",
);
console.log(
  "\nUngated-fetch gate passed — no ungated healthCheck() remains, every emitter-family\n" +
    "fetch is bounded, and no timeout knob is disconnected.",
);
