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
// scan for `fetch(` inside connector sources, checking that the enclosing function
// mentions the gate. It cannot prove the gate is reached on every path, cannot follow
// a fetch through a helper in another module, and does not look outside
// `lib/integrations`. It proves that no connector function calls fetch WITHOUT
// naming the gate — a necessary condition, not a sufficient one.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "lib/integrations/src/integrations";
const GATE_TOKENS = ["resolveEmission", "SIGNALGRID_LIVE_INTEGRATIONS", "resolveLive", "mode !== \"live\"", "mode === \"live\""];

// Files whose `fetch` is not a connector reaching a vendor. Each needs a reason a
// reader can check — an unexplained exemption is how a gate quietly stops gating.
const EXEMPT = new Map([
  ["adapters/emit-gate.ts", "the gate itself"],
  [
    "telemetry/mde.ts",
    "GATED ONLY BY A LOCAL CONFIG FLAG (`isEnabled()` reads `config.enabled`), NOT by " +
      "the tier + SIGNALGRID_LIVE_INTEGRATIONS boundary. That is weaker than every other " +
      "connector and is an OPEN QUESTION, not a clearance — recorded here, printed every " +
      "run, rather than quietly fixed in a commit about something else.",
  ],
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
  if (!text.includes("fetch(")) continue;
  scanned += 1;

  // Split into top-level-ish function bodies by scanning for `fetch(` and walking
  // back to the nearest enclosing `function`/method opener.
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bfetch\(/.test(lines[i])) continue;
    if (/^\s*(\/\/|\*)/.test(lines[i])) continue; // a mention in a comment
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
    const body = lines.slice(start, i + 1).join("\n");
    const gated = GATE_TOKENS.some((t) => body.includes(t));
    if (gated) continue;

    // ENFORCED SCOPE: `healthCheck()`. That is the class of defect an automated
    // review actually found and that I verified site by site and fixed — seven of
    // them. It is also the sharpest case: a health check LOOKS inert (returns a
    // boolean, sends nothing) while opening a real connection, so it is the one most
    // likely to be re-added by someone acting in good faith.
    //
    // NOT ENFORCED, and counted out loud instead: every other outbound class method
    // (createTicket, lookupEndpoint, token fetches, retry helpers). Whether those are
    // gated at the adapter or by a caller one level up is a real audit, and a real
    // audit is not something to sweep through at speed on the back of a different
    // finding. Failing the build on them right now would either be wrong (if callers
    // do gate) or would push someone to bulk-silence the gate. Counting them keeps the
    // gap visible until it is done properly.
    if (/\bhealthCheck\s*\(/.test(lines[start])) {
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

// The unenforced remainder, printed every run so partial coverage is never mistaken
// for full coverage — the same convention as the guard registries.
if (unaudited.length > 0) {
  console.log(
    `\n  ⚠ ${unaudited.length} other outbound class method(s) NOT covered by this gate.\n` +
      "    Whether each is gated by a caller one level up is an open audit, deliberately\n" +
      "    not answered by a fast sweep attached to a different finding. Enforced scope\n" +
      "    here is healthCheck() only — the class that was found, verified and fixed.",
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
