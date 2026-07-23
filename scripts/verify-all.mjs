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

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(
  repoRoot,
  "lib/integrations/src/integrations/macos-posture/contract/posture-report.contract.json",
);
const requireMcp = process.argv.includes("--require-mcp");

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
