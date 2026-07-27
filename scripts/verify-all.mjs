// verify:all — ONE command to run the Review-Hub gate AND the signalgrid-mcp
// pytest, tied together by the shared posture-report contract.
//
// The two repos stay SEPARATE (signalgrid-mcp is the public open-source piece; the
// private-core boundary stays intact). This wrapper just removes the friction of
// running them by hand:
//   1. runs the Review-Hub preflight (the full local gate);
//   2. locates a signalgrid-mcp checkout (SIGNALGRID_MCP_PATH, a sibling clone, or
//      /workspace/signalgrid-mcp), points its contract test at THIS repo's
//      canonical contract file, and runs its pytest;
//   3. prints one unified pass/fail.
//
// If the MCP checkout is not found it prints how to get it and continues with the
// Review-Hub side (pass --require-mcp to make its absence fatal). This is a DEV
// convenience command, not a CI gate — each repo's own CI still guards its half of
// the contract independently.
//
// --emit-evidence (the live-sync loop's real-hardware half — docs/LIVE_SYNC_LOOP.md):
//   After a FULLY-GREEN run — Review-Hub preflight passed AND the signalgrid-mcp
//   checkout was found, its pytest ran, and it passed — write
//   `artifacts/live-evidence/mac-run.json`. That file is committed as proof that a
//   real machine ran BOTH halves against the current repo contracts. It carries:
//     manifestFingerprint  — copied from the COMMITTED artifacts/sync/live-sync-manifest.json,
//                            so `scripts/check-live-sync.mjs` can later report the
//                            evidence FRESH or STALE as the repo's contracts move on;
//     reviewHubPass / mcpPass / mcpCheckoutFound — the gate outcomes (all true by
//                            construction: emission is refused otherwise);
//     mcpCommit / mcpDirty — WHICH signalgrid-mcp code produced the passing run,
//                            and whether its tracked files were modified. Without
//                            these, a mint from an unmerged branch or a stale
//                            checkout is indistinguishable from one against
//                            published main. Recorded, not enforced — minting from
//                            a branch is legitimate as long as the evidence says so;
//     contractSha          — sha256 of the shared posture-report contract file,
//                            cross-checked against the manifest before emitting;
//     summary              — public-safe counts only (signal kinds, categories, MCP
//                            tools, documented proofs), copied from the manifest body.
//   Deliberately ABSENT: hostnames, usernames, serials, local paths, timestamps —
//   the file is committed to a public repo, and git history already dates it.
//   Emission is refused (with a message) when any half is not green, when the MCP
//   side merely SKIPPED, or when the committed manifest is missing/stale — a skip
//   or a red run must never mint "evidence".

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(
  repoRoot,
  "lib/integrations/src/integrations/macos-posture/contract/posture-report.contract.json",
);
const requireMcp = process.argv.includes("--require-mcp");
const emitEvidence = process.argv.includes("--emit-evidence");

function run(label, cmd, args, opts = {}) {
  console.log(`\n=== ${label} ===\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return r.status === 0;
}

// 1) Review-Hub gate (the full local preflight, mirroring CI).
const rhOk = run("Review-Hub preflight", "pnpm", ["run", "preflight"], { cwd: repoRoot });

// 2) Locate the signalgrid-mcp checkout (repos stay separate). An EXPLICIT
// SIGNALGRID_MCP_PATH is AUTHORITATIVE: if it's set we use exactly that and fail if
// it isn't a valid MCP checkout, rather than silently falling through to a sibling
// clone (which could be the wrong branch and validate nothing the caller selected).
const isMcpCheckout = (p) => Boolean(p) && existsSync(resolve(p, "pyproject.toml"));
const explicitMcp = process.env.SIGNALGRID_MCP_PATH?.trim();
const siblingCandidates = [
  resolve(repoRoot, "../signalgrid-mcp"),
  resolve(repoRoot, "signalgrid-mcp"),
  "/workspace/signalgrid-mcp",
];

let mcpRan = false;
let mcpOk = true;
let mcpPath;
let explicitPathError = false;

if (explicitMcp) {
  if (isMcpCheckout(explicitMcp)) {
    mcpPath = explicitMcp;
  } else {
    // The caller named a path explicitly — honor it. Do NOT fall back to a sibling
    // clone (which might be a different branch); an explicit-but-invalid path is a
    // failure, so the contract check can't silently validate the wrong checkout.
    explicitPathError = true;
    console.log(
      [
        "\n=== signalgrid-mcp ===",
        `SIGNALGRID_MCP_PATH is set to '${explicitMcp}', but that is not a signalgrid-mcp`,
        "checkout (no pyproject.toml). Refusing to fall back to another clone — fix the",
        "path or unset SIGNALGRID_MCP_PATH to auto-discover a sibling clone.",
      ].join("\n"),
    );
    mcpOk = false;
    mcpRan = true;
  }
} else {
  mcpPath = siblingCandidates.find(isMcpCheckout);
}

if (!explicitPathError && !mcpPath) {
  console.log(
    [
      "\n=== signalgrid-mcp ===",
      "signalgrid-mcp checkout not found. Looked in:",
      ...siblingCandidates.map((c) => `  - ${c}`),
      "Set SIGNALGRID_MCP_PATH=/path/to/signalgrid-mcp, or clone it as a sibling:",
      "  git clone https://github.com/DanFashauer/signalgrid-mcp.git ../signalgrid-mcp",
      requireMcp ? "(--require-mcp set → treating this as a failure)" : "(continuing with the Review-Hub side only)",
    ].join("\n"),
  );
  if (requireMcp) mcpOk = false;
} else if (mcpPath) {
  // verify:all exists to PREVENT contract drift — running the rest of the suite and
  // reporting PASS while the producer-side contract test never executed would defeat
  // the point. A missing contract test means the checkout predates it (or is on an
  // older branch): that is a failure, not a pass.
  const contractTest = resolve(mcpPath, "tests/test_posture_contract.py");
  if (!existsSync(contractTest)) {
    console.log(
      [
        `\nsignalgrid-mcp found at ${mcpPath}, but its posture-report contract test is MISSING:`,
        `  ${contractTest}`,
        "This checkout predates the cross-repo contract (or is on an older branch), so the",
        "producer side cannot be verified. Refusing to report PASS without it.",
        `  git -C ${mcpPath} pull    # update to a main that includes the contract test`,
      ].join("\n"),
    );
    mcpOk = false;
    mcpRan = true;
  } else {
    // Prefer the repo's own venv python (verify.sh sets it up); fall back to python3.
    const venvPy = resolve(mcpPath, ".venv/bin/python");
    const py = existsSync(venvPy) ? venvPy : "python3";
    console.log(`\nsignalgrid-mcp found at ${mcpPath} (python: ${py})`);
    mcpOk = run("signalgrid-mcp pytest (+ posture-report contract)", py, ["-m", "pytest", "-q"], {
      cwd: mcpPath,
      env: { ...process.env, SIGNALGRID_CONTRACT_PATH: contractPath },
    });
    mcpRan = true;
    if (!mcpOk) {
      console.log("  (if this is a missing-pytest error, run the MCP repo's ./verify.sh once to set up its venv)");
    }
  }
}

// 3) Unified summary.
console.log("\n=== verify:all summary ===");
console.log(`  Review-Hub preflight: ${rhOk ? "PASS" : "FAIL"}`);
console.log(`  signalgrid-mcp:       ${mcpRan ? (mcpOk ? "PASS" : "FAIL") : "SKIPPED (not found)"}`);
console.log(`  shared contract:      ${contractPath}`);
if (!rhOk || !mcpOk) process.exitCode = 1;

// 4) Optional live-evidence emission (see header). Gated HARD on a fully-green
// run of BOTH halves: reviewHubPass AND mcpCheckoutFound AND mcpPass — a skipped
// MCP side is not a passing one, so a sandbox without the checkout can never
// fabricate a "real Mac run".
if (emitEvidence) {
  const mcpCheckoutFound = Boolean(mcpPath);
  const fullyGreen = rhOk && mcpCheckoutFound && mcpRan && mcpOk;
  // GREEN-NESS IS NOT HARDWARE. The first dry run of the live-sync bot caught a
  // sandbox-minted evidence file claiming a "real Mac run": a Linux container
  // holding an MCP checkout passed both halves and emitted. Evidence exists to
  // record the OWNER'S REAL MACHINE, so emission requires a condition a cloud
  // sandbox cannot satisfy by accident: the process must actually be running on
  // macOS. There is no override flag on purpose — an override would be the lie
  // with extra steps.
  if (process.platform !== "darwin") {
    console.error(
      [
        "\n--emit-evidence: REFUSED — this process is not running on macOS (platform=" + process.platform + ").",
        "  Live evidence records the owner's real Mac running both halves against the shared",
        "  contract. A green run in a cloud sandbox is a rehearsal, not evidence, and a",
        "  fabricated 'real Mac run' is exactly what the live-sync loop exists to prevent.",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else
  if (!fullyGreen) {
    console.log(
      [
        "\n--emit-evidence: NOT emitting live evidence — the run was not fully green on both halves.",
        `  reviewHubPass=${rhOk} mcpCheckoutFound=${mcpCheckoutFound} mcpRan=${mcpRan} mcpPass=${mcpRan ? mcpOk : "n/a"}`,
        "  Evidence records a real machine running the Review-Hub gate AND the signalgrid-mcp",
        "  pytest against the shared contract; a skip or a failure must never mint it.",
      ].join("\n"),
    );
  } else {
    const manifestPath = resolve(repoRoot, "artifacts/sync/live-sync-manifest.json");
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
    const contractSha = createHash("sha256").update(readFileSync(contractPath)).digest("hex");
    if (!manifest?.fingerprint || !manifest?.body) {
      console.error(
        "\n--emit-evidence: committed artifacts/sync/live-sync-manifest.json is missing or unreadable." +
          "\n  Run: node scripts/generate-sync-manifest.mjs   (and commit it) before emitting evidence.",
      );
      process.exitCode = 1;
    } else if (manifest.body?.contract?.sha256 !== contractSha) {
      console.error(
        "\n--emit-evidence: the committed manifest's contract sha256 does not match the contract file on disk —" +
          "\n  the manifest is stale. Run: node scripts/generate-sync-manifest.mjs, commit it, and re-run.",
      );
      process.exitCode = 1;
    } else {
      // Which signalgrid-mcp code actually produced the passing run. Without this
      // the evidence says only "mcpPass: true", so a mint from an unmerged branch,
      // an old checkout, or a dirty tree is indistinguishable from one against
      // published main — and unverifiable evidence is not evidence. Recorded, not
      // enforced: a legitimate mint from a branch is fine as long as it SAYS so.
      const mcpGit = (args) => {
        const r = spawnSync("git", args, { cwd: mcpPath, encoding: "utf8" });
        return r.status === 0 ? r.stdout.trim() : null;
      };
      const mcpCommit = mcpGit(["rev-parse", "HEAD"]);
      const mcpDirty = mcpGit(["status", "--porcelain"]);
      // Public-safe by construction: fingerprints, booleans, and counts only.
      const evidence = {
        schema: "signalgrid-live-evidence/v1",
        manifestFingerprint: manifest.fingerprint,
        manifestVersion: manifest.manifestVersion,
        platform: process.platform,
        reviewHubPass: true,
        mcpPass: true,
        mcpCheckoutFound: true,
        mcpCommit,
        // Tracked-file modifications only; untracked scratch (venvs, lockfiles)
        // does not make a run untrustworthy.
        mcpDirty: mcpDirty === null ? null : mcpDirty.split("\n").filter((l) => l && !l.startsWith("??")).length > 0,
        contractSha,
        summary: {
          signalKinds: manifest.body.signalKinds?.length ?? 0,
          signalCategories: manifest.body.signalCategories?.length ?? 0,
          taskExceptionReasonCodes: manifest.body.taskExceptionReasonCodes?.length ?? 0,
          handoffSimRefusalCodes: manifest.body.handoffSimRefusalCodes?.length ?? 0,
          mcpTools: manifest.body.mcpTools?.length ?? 0,
          proofsDocumented: Object.keys(manifest.body.proofCounts ?? {}).length,
        },
      };
      const evidenceDir = resolve(repoRoot, "artifacts/live-evidence");
      mkdirSync(evidenceDir, { recursive: true });
      const evidencePath = resolve(evidenceDir, "mac-run.json");
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(`\n--emit-evidence: wrote ${evidencePath} (manifestFingerprint=${manifest.fingerprint.slice(0, 12)}…).`);
      console.log("  Commit artifacts/live-evidence/ to publish the run as repo evidence.");
    }
  }
}
