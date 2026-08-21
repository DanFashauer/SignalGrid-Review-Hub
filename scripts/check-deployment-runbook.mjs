#!/usr/bin/env node
// The deployment runbook (docs/DEPLOYMENT.md) is the path a CUSTOMER follows.
// It drifted from the code once with real consequences: the compose file never
// set SIGNALGRID_PRODUCT_PROFILE, so a stack booted from the documented
// command served the review-demo surfaces — an anonymous caller received nine
// demo bearer tokens (measured 2026-08-21) — and the schema section described
// a first-connect table creation the role split had made impossible. This
// gate holds the runbook against the code in three directions:
//   1. every env var the server boot-reads appears in the runbook's table;
//   2. the compose file sets the profile, defaulting to shared-device-gateway;
//   3. the runbook's database path names db:migrate and signalgrid_runtime.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "artifacts/api-server/src";

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function collectBootEnvVars(root = SRC) {
  const vars = new Set();
  for (const f of walk(root).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env(?:\.([A-Z_]{3,})|\[\s*"([A-Z_]{3,})"\s*\])/g)) {
      vars.add(m[1] ?? m[2]);
    }
  }
  return vars;
}

/** Pure over file CONTENTS so the self-test can drive the same code path. */
export function auditRunbook({ envVars, runbook, compose }) {
  const problems = [];
  if (envVars.size === 0) {
    problems.push("vacuity: zero boot-read env vars collected — the scanner, not the server, is broken");
  }
  for (const v of envVars) {
    if (!runbook.includes("`" + v + "`")) {
      problems.push(`the server boot-reads ${v}; the runbook's env table never mentions it`);
    }
  }
  if (!/SIGNALGRID_PRODUCT_PROFILE:\s*\$\{SIGNALGRID_PRODUCT_PROFILE:-shared-device-gateway\}/.test(compose)) {
    problems.push(
      "docker-compose.prod.yml does not set SIGNALGRID_PRODUCT_PROFILE with the shared-device-gateway default — the unset profile serves the demo surfaces (the measured leak)",
    );
  }
  if (!runbook.includes("db:migrate")) {
    problems.push("the runbook's database path never names db:migrate — first-connect creation is impossible under the role split");
  }
  if (!runbook.includes("signalgrid_runtime")) {
    problems.push("the runbook never names the signalgrid_runtime role the API must run as");
  }
  return problems;
}

function selfTest() {
  const checks = [];
  const goodCompose = "SIGNALGRID_PRODUCT_PROFILE: ${SIGNALGRID_PRODUCT_PROFILE:-shared-device-gateway}";
  const goodBook = "`PORT` db:migrate signalgrid_runtime";
  let p = auditRunbook({ envVars: new Set(["PORT"]), runbook: goodBook, compose: goodCompose });
  checks.push(["a coherent runbook/compose/env trio passes", p.length === 0]);
  p = auditRunbook({ envVars: new Set(["PORT", "NEW_VAR"]), runbook: goodBook, compose: goodCompose });
  checks.push(["a boot-read var missing from the runbook FAILS", p.some((x) => x.includes("NEW_VAR"))]);
  p = auditRunbook({ envVars: new Set(["PORT"]), runbook: goodBook, compose: "environment: {}" });
  checks.push(["a compose file without the profile default FAILS", p.some((x) => x.includes("PRODUCT_PROFILE"))]);
  p = auditRunbook({ envVars: new Set(["PORT"]), runbook: "`PORT` signalgrid_runtime", compose: goodCompose });
  checks.push(["a runbook without db:migrate FAILS", p.some((x) => x.includes("db:migrate"))]);
  p = auditRunbook({ envVars: new Set(), runbook: goodBook, compose: goodCompose });
  checks.push(["zero collected env vars is a scanner failure, not a pass", p.some((x) => x.includes("vacuity"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const envVars = collectBootEnvVars();
const problems = auditRunbook({
  envVars,
  runbook: readFileSync("docs/DEPLOYMENT.md", "utf8"),
  compose: readFileSync("docker-compose.prod.yml", "utf8"),
});
console.log(`Deployment-runbook check — ${envVars.size} boot-read env vars held against the runbook`);
if (problems.length > 0) {
  console.error(`Deployment-runbook check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("Deployment-runbook check passed — the documented path and the code agree.");
