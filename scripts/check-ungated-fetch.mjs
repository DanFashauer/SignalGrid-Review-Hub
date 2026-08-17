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

const GATE_TOKENS = ["resolveEmission", "SIGNALGRID_LIVE_INTEGRATIONS", "resolveLive", "mode !== \"live\"", "mode === \"live\""];

// Any callee whose identifier contains "fetch" — the builtin AND every wrapper around
// it. The negative lookbehind keeps `obj.fetch(` and `this.doFetch(` in scope while
// excluding nothing that matters; breadth is the point.
const FETCH_CALL = /(?<![\w$])[\w$]*[Ff]etch[\w$]*\s*\(/;

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
    // Does this helper reach the real network primitive?
    if (!/(?<![\w$.])fetch\s*\(/.test(text)) continue;
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
    for (let j = i; j >= 0 && j > i - 120; j -= 1) {
      const topLevelFn = /^(export\s+)?(async\s+)?function\s+\w+/.test(lines[j]);
      // Exclude control-flow keywords: `  if (…) {` otherwise reads as a method
      // declaration and anchors the walk-back to the wrong line.
      const methodDecl =
        /^  (private\s+|public\s+|protected\s+)?(async\s+)?[A-Za-z_]\w*\s*\(/.test(lines[j]) &&
        !/^\s*(if|for|while|switch|catch|return|await|else)\b/.test(lines[j]);
      if (topLevelFn) { start = j; isClassMethod = false; break; }
      if (methodDecl) { start = j; isClassMethod = true; break; }
    }
    if (start === -1 || !isClassMethod) continue;
    const body = stripComments(lines.slice(start, i + 1).join("\n"));
    const gated = GATE_TOKENS.some((t) => body.includes(t));
    if (gated) continue;

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
    // STILL NOT ENFORCED, counted out loud, and now with the audit's reason: the
    // telemetry/ and passkey-assurance methods are MODE-POLYMORPHIC — the same
    // method serves fixture transports in proofs (proof:passkey-assurance drives
    // fetchNormalizedSet with fixtures; the live lanes drive fleetdm/mde with the
    // boundary open), so an in-method mode!=live throw would break the fixture
    // path it legitimately serves. Their gate belongs where the live transport is
    // selected; until each is verified site by site, they stay visible here.
    const enforcedDir = /\/(itsm|siem|telemetry)\//.test(file);
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

// The unenforced remainder, printed every run so partial coverage is never mistaken
// for full coverage — the same convention as the guard registries.
if (unaudited.length > 0) {
  console.log(
    `\n  ⚠ ${unaudited.length} other outbound class method(s) NOT covered by this gate.\n` +
      "    Audited 2026-08-16, one survivor: passkey-assurance fetchNormalizedSet is\n" +
      "    TRANSPORT-POLYMORPHIC — its live/fixture split is decided by the resolver in\n" +
      "    its index.ts (fixture unless tier + SIGNALGRID_LIVE_INTEGRATIONS + credential),\n" +
      "    which this per-function scan cannot follow across files. Verified by reading;\n" +
      "    kept visible here because verified-by-reading is not verified-by-gate.\n" +
      "    Everything else is enforced: healthCheck() everywhere, and every outbound\n" +
      "    method under itsm/, siem/ and telemetry/ — where the isEnabled() chokepoint\n" +
      "    counts only if its own implementation carries a gate token (the lookalike\n" +
      "    that checks config.enabled alone FAILS the build, tested by mutation).",
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
