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

// Package-level roots over-collect the moment a dependency is a LIBRARY of
// families: on 2026-09-18 the server gained `@workspace/integrations` for one
// subpath (`./graph`, the posture read behind SIGNALGRID_CORE=estate) and the
// whole-package scan reported 25 env vars — RTLS_*, MDE_*, FLEETDM_*, … — that
// the served bundle never contains. Passing them through compose to satisfy
// this gate would have created exactly the dead knobs it exists to catch. So
// the scan follows the server's OWN import specifiers: `@workspace/<pkg>[/sub]`
// resolves through that package's `exports` map to a source file, and the
// relative imports beneath it are walked transitively. Type-only imports
// (`import type`) carry no code and are not followed.
function workspacePackages() {
  const byName = new Map();
  for (const base of ["lib", "artifacts"]) {
    for (const n of readdirSync(base)) {
      const dir = join(base, n);
      try {
        const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        byName.set(pj.name, { dir, exports: pj.exports });
      } catch { /* not a package dir */ }
    }
  }
  return byName;
}
function exportTarget(exportsMap, subpath) {
  if (!exportsMap) return subpath === "." ? "./src/index.ts" : null;
  if (typeof exportsMap === "string") return subpath === "." ? exportsMap : null;
  const entry = exportsMap[subpath];
  if (entry === undefined) return null;
  if (typeof entry === "string") return entry;
  return entry.import ?? entry.default ?? null;
}
function resolveRelative(fromFile, spec) {
  const base = join(fromFile, "..", spec).replace(/\.js$/, "");
  for (const cand of [base, `${base}.ts`, join(base, "index.ts")]) {
    try {
      if (statSync(cand).isFile() && cand.endsWith(".ts")) return cand;
    } catch { /* try the next shape */ }
  }
  return null;
}
const IMPORT_RX = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^"'\n]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
export function resolveReachableSources(pkgDir = "artifacts/api-server") {
  const packages = workspacePackages();
  const reached = new Set();
  const queue = walk(join(pkgDir, "src")).filter((f) => f.endsWith(".ts"));
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RX)) {
      if (m[1]) continue; // `import type … from` — no code, nothing to boot-read
      const spec = m[2] ?? m[3] ?? m[4];
      let target = null;
      if (spec.startsWith("@workspace/")) {
        const [, name, ...rest] = spec.split("/");
        const pkg = packages.get(`@workspace/${name}`);
        if (!pkg) continue;
        const subpath = rest.length === 0 ? "." : `./${rest.join("/")}`;
        const rel = exportTarget(pkg.exports, subpath);
        if (rel) target = join(pkg.dir, rel);
      } else if (spec.startsWith(".")) {
        target = resolveRelative(file, spec);
      }
      if (target && !reached.has(target)) queue.push(target);
    }
  }
  return [...reached].sort();
}
export function collectBootEnvVars(root = SRC) {
  const roots = Array.isArray(root) ? root : [root];
  const vars = new Set();
  const files = roots.flatMap((r) => (r.endsWith(".ts") ? [r] : walk(r))).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
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

/**
 * The SECRETS REGISTRY is a second source of boot-read names, and it had to become
 * one the moment the reads moved behind an accessor.
 *
 * `@workspace/secrets` (DR-010) reads every registered secret as `env[name]` through a
 * parameter, so the literal patterns above see NOTHING — and that is exactly how
 * SIGNALGRID_ENROLLMENT_SECRET and the two estate bearer tokens dropped out of this
 * gate's collected set the day they were routed through it: still boot-read, still
 * documented, and silently no longer HELD to being documented. A gate that gets
 * quieter when the code gets tidier is the failure mode this file was written about.
 *
 * Each registered name also implies its `_NEXT` successor, which is a real knob: it is
 * what makes a rotation window exist, and an operator who cannot set it through the
 * compose file cannot rotate anything.
 */
export function collectRegisteredSecrets(source) {
  const src = source ?? readFileSync("lib/secret-model/src/index.ts", "utf8");
  const block = src.match(/export const REGISTRY[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) return new Set();
  const out = new Set();
  for (const m of block[1].matchAll(/name:\s*"([A-Z][A-Z0-9_]{2,})"/g)) {
    out.add(m[1]);
    out.add(`${m[1]}_NEXT`);
  }
  return out;
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
  // 8080, the stack is the prod tier, NODE_ENV is production — and
  // SIGNALGRID_LIVE_INTEGRATIONS is pinned FALSE because the image has no
  // live-integration wiring; interpolating it would let an export make the
  // health/context surfaces claim live signals a fixture stack cannot produce.
  const PINNED = new Set(["NODE_ENV", "PORT", "SIGNALGRID_TIER", "SIGNALGRID_LIVE_INTEGRATIONS"]);
  const apiEnv = extractApiEnvironment(compose);
  if (apiEnv === null) {
    problems.push("could not locate the api service's environment block in docker-compose.prod.yml — the pass-through direction cannot be verified");
  } else {
    for (const v of envVars) {
      // `[ \t]*`, not `\s*`: with the multiline flag `\s*` swallows the newline after a
      // KEY-ONLY entry (`METRICS_TOKEN:`) and captures the NEXT line as its value — the
      // gate then read a comment as a "fixed value". A key-only entry is Compose's own
      // pass-through form (present in the container only when the host sets it), which
      // is exactly the interpolation this direction asks for.
      const line = apiEnv.match(new RegExp(`^\\s+${v}:[ \\t]*(.*)$`, "m"));
      if (!line) {
        problems.push(`the server boot-reads ${v}; the api service's environment never passes it into the container — exporting it on the host is silently ignored`);
      } else if (!PINNED.has(v) && line[1].trim() !== "" && !line[1].includes("${" + v)) {
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

/** The reference .sql files are NOT executed (lib/persistence/src/migrations.ts
 *  is, and it alone applies the v2 role split) — each must say so, or a reader
 *  provisions a schema with no role split and believes the docs told them to. */
export function auditMigrationBanners(sqlFiles) {
  const problems = [];
  for (const [path, content] of Object.entries(sqlFiles)) {
    if (!content.includes("NON-AUTHORITATIVE")) {
      problems.push(`${path} lacks the NON-AUTHORITATIVE banner — a reference schema that reads as executable is the mis-citation the platform review found`);
    }
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
  p = auditRunbook({
    envVars: new Set(["PORT", "METRICS_TOKEN"]),
    runbook: goodBook,
    compose: composeWith("      SIGNALGRID_PRODUCT_PROFILE: ${SIGNALGRID_PRODUCT_PROFILE:-shared-device-gateway}\n      PORT: 8080\n      METRICS_TOKEN:\n      # a comment on the next line must not be read as the value\n"),
  });
  checks.push([
    "a KEY-ONLY entry (Compose pass-through) PASSES, and the next line is not read as its value",
    !p.some((x) => x.includes("METRICS_TOKEN")),
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
  const reachable = resolveReachableSources();
  checks.push([
    "the reachable scan follows a root import into its package (enterprise-auth reached)",
    reachable.some((f) => f.startsWith("lib/enterprise-auth/src/")),
  ]);
  checks.push([
    "…and a SUBPATH import reaches only that subpath (integrations/graph reached, rtls-custody not)",
    reachable.some((f) => f.startsWith("lib/integrations/src/integrations/graph/")) &&
      !reachable.some((f) => f.includes("/rtls-custody/")),
  ]);
  const reachableVars = collectBootEnvVars(reachable);
  checks.push([
    "the reachable scan still collects the OIDC and Graph knobs (OIDC_TENANT_MAP, GRAPH_ACCESS_TOKEN) and not a library family's (RTLS_ACCESS_TOKEN)",
    reachableVars.has("OIDC_TENANT_MAP") && reachableVars.has("GRAPH_ACCESS_TOKEN") && !reachableVars.has("RTLS_ACCESS_TOKEN"),
  ]);
  const regSrc = 'export const REGISTRY = [\n  { name: "A_TOKEN", direction: "inbound", purpose: "x" },\n  { name: "B_SECRET", direction: "outbound", purpose: "y" },\n];\n';
  const reg = collectRegisteredSecrets(regSrc);
  checks.push([
    "the secrets registry yields each name AND its _NEXT successor",
    reg.has("A_TOKEN") && reg.has("A_TOKEN_NEXT") && reg.has("B_SECRET") && reg.has("B_SECRET_NEXT") && reg.size === 4,
  ]);
  checks.push([
    "a registry the parser cannot find yields nothing (so the vacuity check fires rather than a false pass)",
    collectRegisteredSecrets("const SOMETHING_ELSE = [];").size === 0,
  ]);
  checks.push([
    "the REAL registry is non-empty and carries the accessor's own secrets",
    collectRegisteredSecrets().has("METRICS_TOKEN") && collectRegisteredSecrets().has("METRICS_TOKEN_NEXT"),
  ]);
  let bp = auditMigrationBanners({ "lib/persistence/migrations/001_decisions.sql": "-- NON-AUTHORITATIVE reference\nCREATE TABLE x ();" });
  checks.push(["a bannered reference schema passes", bp.length === 0]);
  bp = auditMigrationBanners({ "lib/persistence/migrations/001_decisions.sql": "-- canonical schema for migration tooling\nCREATE TABLE x ();" });
  checks.push(["a reference schema WITHOUT the banner fails (the mis-citation)", bp.length === 1]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const registeredSecrets = collectRegisteredSecrets();
if (registeredSecrets.size === 0) {
  console.error("✗ the secrets registry parsed to zero entries — the parser drifted, not the registry.");
  process.exit(1);
}
const envVars = new Set([...collectBootEnvVars(resolveReachableSources()), ...registeredSecrets]);
const SQL_REFS = [
  "lib/persistence/migrations/001_decisions.sql",
  "lib/persistence/migrations/002_sessions.sql",
  "lib/audit/migrations/001_audit_ledger.sql",
];
const problems = [
  ...auditRunbook({
    envVars,
    runbook: readFileSync("docs/DEPLOYMENT.md", "utf8"),
    compose: readFileSync("docker-compose.prod.yml", "utf8"),
  }),
  ...auditMigrationBanners(Object.fromEntries(SQL_REFS.map((f) => [f, readFileSync(f, "utf8")]))),
];
console.log(
  `Deployment-runbook check — ${envVars.size} boot-read env vars held against the runbook ` +
    `(${registeredSecrets.size} of them from the secrets registry, successors included)`,
);
if (problems.length > 0) {
  console.error(`Deployment-runbook check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("Deployment-runbook check passed — the documented path and the code agree.");
