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

// The api-server is not the only package that boot-reads configuration:
// @workspace/enterprise-auth reads the OIDC variables (as `env.NAME` off a
// parameter, not `process.env.NAME`), and a var that moves into any imported
// workspace package would otherwise vanish from this gate while it kept
// reporting success. Resolve the server's TRANSITIVE @workspace/* runtime
// dependencies to their source dirs and scan those too.
export function resolveWorkspaceSrcRoots(pkgDir = "artifacts/api-server") {
  const byName = new Map();
  for (const base of ["lib", "artifacts"]) {
    for (const n of readdirSync(base)) {
      const pj = join(base, n, "package.json");
      try {
        byName.set(JSON.parse(readFileSync(pj, "utf8")).name, join(base, n));
      } catch { /* not a package dir */ }
    }
  }
  const roots = new Set();
  const visit = (dir) => {
    let deps;
    try {
      deps = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies ?? {};
    } catch { return; }
    for (const name of Object.keys(deps).filter((d) => d.startsWith("@workspace/"))) {
      const depDir = byName.get(name);
      if (!depDir || roots.has(join(depDir, "src"))) continue;
      roots.add(join(depDir, "src"));
      visit(depDir);
    }
  };
  visit(pkgDir);
  return [join(pkgDir, "src"), ...roots];
}

export function collectBootEnvVars(root = SRC) {
  const roots = Array.isArray(root) ? root : [root];
  const vars = new Set();
  for (const f of roots.flatMap((r) => walk(r)).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env(?:\.([A-Z_]{3,})|\[\s*"([A-Z_]{3,})"\s*\])/g)) {
      vars.add(m[1] ?? m[2]);
    }
    // Helper-mediated reads: limitFromEnv("SIGNALGRID_V1_RATE_LIMIT", …) reads
    // process.env[name] through a parameter, invisible to the literal pattern
    // above — which is exactly how the two rate-limit knobs escaped the first
    // version of this gate. Any *env*-named call taking an ALL_CAPS literal
    // first argument counts as a boot-read.
    for (const m of src.matchAll(/\w*[Ee]nv\w*\(\s*"([A-Z][A-Z0-9_]{2,})"/g)) {
      vars.add(m[1]);
    }
    // Parameter-mediated member reads: loadEnterpriseAuthConfig(env = process.env)
    // then `env.OIDC_TENANT_MAP` — no `process.` prefix, no helper call, and the
    // pattern that hid the two REQUIRED OIDC maps from this gate's first two
    // versions. Any ALL_CAPS property read off an identifier ending in `env`
    // counts (process.env.X matches too; the Set dedupes).
    for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/gi)) {
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(m[1])) vars.add(m[1]);
    }
  }
  return vars;
}

/** The api service's environment block, or null when it cannot be found —
 *  scoped by indentation so a key under db (or anywhere else in the file)
 *  never satisfies the api-side pass-through requirement. */
export function extractApiEnvironment(compose) {
  const api = compose.match(/^ {2}api:\n((?: {4,}.*\n|\n)*)/m);
  if (!api) return null;
  const env = api[1].match(/^ {4}environment:\n((?: {6,}.*\n?)*)/m);
  return env ? env[1] : null;
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
  // Direction 4: documented is not enough — the compose file must PASS the
  // variable into the API CONTAINER, as an interpolation the host can set. A
  // key under the db service, or a fixed value, leaves the documented knob
  // dead while a whole-file regex stays green. The three PINNED values are
  // the compose file's own design decisions, not knobs: the image listens on
  // 8080, the stack is the prod tier, NODE_ENV is production.
  const PINNED = new Set(["NODE_ENV", "PORT", "SIGNALGRID_TIER"]);
  const apiEnv = extractApiEnvironment(compose);
  if (apiEnv === null) {
    problems.push("could not locate the api service's environment block in docker-compose.prod.yml — the pass-through direction cannot be verified");
  } else {
    for (const v of envVars) {
      const line = apiEnv.match(new RegExp(`^\\s+${v}:\\s*(.*)$`, "m"));
      if (!line) {
        problems.push(`the server boot-reads ${v}; the api service's environment never passes it into the container — exporting it on the host is silently ignored`);
      } else if (!PINNED.has(v) && !line[1].includes("${" + v)) {
        problems.push(`the api service sets ${v} to a fixed value (${line[1].trim()}) instead of interpolating \${${v}…} — the documented knob is dead`);
      }
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
  const composeWith = (apiLines, dbLines = "") =>
    `services:\n  db:\n    environment:\n      POSTGRES_USER: sg\n${dbLines}  api:\n    environment:\n${apiLines}    ports:\n      - "8080:8080"\n`;
  const goodCompose = composeWith(
    "      SIGNALGRID_PRODUCT_PROFILE: ${SIGNALGRID_PRODUCT_PROFILE:-shared-device-gateway}\n      PORT: 8080\n      METRICS_TOKEN: ${METRICS_TOKEN:-}\n",
  );
  const goodBook = "`PORT` `METRICS_TOKEN` db:migrate signalgrid_runtime";
  let p = auditRunbook({ envVars: new Set(["PORT", "METRICS_TOKEN"]), runbook: goodBook, compose: goodCompose });
  checks.push(["a coherent runbook/compose/env trio passes", p.length === 0]);
  p = auditRunbook({ envVars: new Set(["PORT", "NEW_VAR"]), runbook: goodBook, compose: goodCompose });
  checks.push(["a boot-read var missing from the runbook FAILS", p.some((x) => x.includes("NEW_VAR"))]);
  p = auditRunbook({
    envVars: new Set(["PORT", "DOCUMENTED_BUT_DROPPED"]),
    runbook: goodBook + " `DOCUMENTED_BUT_DROPPED`",
    compose: goodCompose,
  });
  checks.push([
    "a var documented in the runbook but not passed through compose FAILS (dead knob)",
    p.some((x) => x.includes("DOCUMENTED_BUT_DROPPED") && x.includes("never passes it")),
  ]);
  p = auditRunbook({
    envVars: new Set(["PORT", "METRICS_TOKEN"]),
    runbook: goodBook,
    compose: composeWith("      SIGNALGRID_PRODUCT_PROFILE: ${SIGNALGRID_PRODUCT_PROFILE:-shared-device-gateway}\n      PORT: 8080\n", "      METRICS_TOKEN: ${METRICS_TOKEN:-}\n"),
  });
  checks.push([
    "a var passed only under the DB service FAILS (api-side scoping)",
    p.some((x) => x.includes("METRICS_TOKEN") && x.includes("never passes it")),
  ]);
  p = auditRunbook({
    envVars: new Set(["PORT", "METRICS_TOKEN"]),
    runbook: goodBook,
    compose: composeWith("      SIGNALGRID_PRODUCT_PROFILE: ${SIGNALGRID_PRODUCT_PROFILE:-shared-device-gateway}\n      PORT: 8080\n      METRICS_TOKEN: fixed-value\n"),
  });
  checks.push([
    "a non-pinned var set to a FIXED value FAILS (interpolation required)",
    p.some((x) => x.includes("METRICS_TOKEN") && x.includes("fixed value")),
  ]);
  p = auditRunbook({ envVars: new Set(["PORT"]), runbook: goodBook, compose: "environment: {}" });
  checks.push(["a compose file without the profile default FAILS", p.some((x) => x.includes("PRODUCT_PROFILE"))]);
  p = auditRunbook({ envVars: new Set(["PORT"]), runbook: "`PORT` signalgrid_runtime", compose: goodCompose });
  checks.push(["a runbook without db:migrate FAILS", p.some((x) => x.includes("db:migrate"))]);
  p = auditRunbook({ envVars: new Set(), runbook: goodBook, compose: goodCompose });
  checks.push(["zero collected env vars is a scanner failure, not a pass", p.some((x) => x.includes("vacuity"))]);
  const roots = resolveWorkspaceSrcRoots();
  checks.push([
    "the scan traverses into @workspace runtime deps (enterprise-auth present)",
    roots.some((r) => r.includes("enterprise-auth")),
  ]);
  const memberVars = collectBootEnvVars(["lib/enterprise-auth/src"]);
  checks.push([
    "parameter-mediated env.NAME reads are collected (OIDC_TENANT_MAP found)",
    memberVars.has("OIDC_TENANT_MAP") && memberVars.has("OIDC_ROLE_MAP"),
  ]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const srcRoots = resolveWorkspaceSrcRoots();
const envVars = collectBootEnvVars(srcRoots);
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
