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

import { readFileSync } from "node:fs";
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

for (const file of files) {
  const rel = file.slice(`${SCAN_ROOT}/`.length);
  if (EXEMPT.has(rel)) continue;
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  if (!FETCH_CALL.test(text)) continue;
  scanned += 1;

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
console.log("\nUngated-fetch gate passed — no ungated healthCheck() remains.");
