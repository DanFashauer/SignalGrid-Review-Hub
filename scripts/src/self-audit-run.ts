// self-audit:run — run the self-audit against REAL gate results and print the
// system's health in plain language.
//
// The engine (@workspace/self-audit) is pure; this is the runner that gives it
// truth. It maps each checklist item's probe key to the real gate/proof command
// that answers it, executes them, and feeds the outcomes into the SAME engine and
// SAME plain-language layer the administrative screen uses. So the words an owner
// reads here ("Everything is working." / "N things need your attention.") are backed
// by proofs that actually ran, not a fixture.
//
// Fail closed, exactly like the engine: a probe with no command mapping, or a
// heavy probe skipped without --full, resolves to `unknown` — and unknown is never
// healthy. `--full` runs the heavy browser probe too. Coverage is checked against
// the COMMITTED live-sync manifest, so a contract dimension no checklist item covers
// surfaces as its own attention item.
//
// Run:  cd scripts && npx tsx ./src/self-audit-run.ts [--full] [--json]

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CHECKLIST,
  deriveChecklist,
  runAudit,
  proposeHeals,
  summarizePlain,
  type ProbeResult,
} from "@workspace/self-audit";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const full = process.argv.includes("--full");
const asJson = process.argv.includes("--json");

/** How each checklist probe key is answered by a real command. A probe marked
 *  `heavy` is skipped unless --full (and reported `unknown`, fail-closed). A probe
 *  key with no entry here is also `unknown` — the runner never guesses healthy. */
const PROBE_COMMANDS: Record<string, { run: string[]; heavy?: boolean }> = {
  "proof:api-contract": { run: ["pnpm", "run", "proof:api-contract"] },
  "proof:posture-composition": { run: ["pnpm", "run", "proof:posture-composition"] },
  // The screens-are-live check is the browser E2E — heavy, so opt-in via --full.
  "e2e:consoles": { run: ["pnpm", "run", "test:e2e"], heavy: true },
  // "connectors fail-closed" is exactly what the shared grant-safety brute-force proves.
  "proof:connectors": { run: ["pnpm", "run", "proof:grant-safety"] },
  "proof:task-exception": { run: ["pnpm", "run", "proof:task-exception"] },
  "proof:handoff-sim": { run: ["pnpm", "run", "proof:handoff-sim"] },
  "proof:work-context": { run: ["pnpm", "run", "proof:work-context"] },
};

function runProbe(probeKey: string): ProbeResult {
  const entry = PROBE_COMMANDS[probeKey];
  if (!entry) {
    return { status: "unknown", detail: `no gate mapped for '${probeKey}' — not verified` };
  }
  if (entry.heavy && !full) {
    return { status: "unknown", detail: "heavy check skipped — re-run with --full to verify" };
  }
  const [cmd, ...args] = entry.run;
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", timeout: 30 * 60_000 });
  if (r.error) return { status: "unknown", detail: `could not run: ${r.error.message}` };
  return r.status === 0
    ? { status: "healthy", detail: `${args[args.length - 1]} passed` }
    : { status: "broken", detail: `${args[args.length - 1]} failed` };
}

// The inventory the checklist is held honest against: the real contract dimensions
// from the COMMITTED manifest. A dimension no checklist item covers becomes a gap.
function manifestDimensions(): string[] {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, "artifacts/sync/live-sync-manifest.json"), "utf8"),
    );
    const body = manifest.body ?? {};
    // The array-valued contract dimensions (not metadata like schema/contract version).
    return [
      "signalKinds",
      "signalCategories",
      "taskExceptionReasonCodes",
      "workContextTrustCeilings",
      "handoffSimRefusalCodes",
      "mcpTools",
      "consumers",
    ].filter((k) => Array.isArray(body[k]) || typeof body[k] === "number" || body[k] != null);
  } catch {
    // Manifest unreadable → cover only what the checklist claims, and let the
    // missing coverage-of-reality be a visible unknown rather than a false pass.
    return [...new Set(DEFAULT_CHECKLIST.flatMap((i) => i.covers))];
  }
}

const checklist = deriveChecklist([...DEFAULT_CHECKLIST], { dimensions: manifestDimensions() });

// Run every probe the checklist needs (coverage-gap items use a `coverage:*` key
// with no command → unknown, which is correct: a gap is not verified).
const probeResults: Record<string, ProbeResult> = {};
for (const item of checklist) {
  probeResults[item.probeKey] = runProbe(item.probeKey);
}

const report = runAudit(checklist, probeResults);
const heals = proposeHeals(report);
const plain = summarizePlain(report, heals);

if (asJson) {
  console.log(JSON.stringify({ plain, report, proposedHeals: heals }, null, 2));
} else {
  console.log(`\n${plain.headline}\n`);
  for (const line of plain.lines) {
    const mark = line.needsAttention ? "!" : "✓";
    console.log(`  ${mark} ${line.area} — ${line.state}`);
    console.log(`      ${line.sentence}`);
  }
  if (plain.suggestedFixes.length > 0) {
    console.log(`\nSuggested fixes (your approval needed — nothing has been done):`);
    for (const fix of plain.suggestedFixes) {
      console.log(`  • ${fix.area}: ${fix.whatWeWouldDo}`);
    }
  }
  if (!full) {
    console.log(`\n(Heavy checks skipped. Re-run with --full to verify the browser screens too.)`);
  }
}

// Exit non-zero if anything needs attention, so this can gate a pipeline.
process.exitCode = plain.allClear ? 0 : 1;
