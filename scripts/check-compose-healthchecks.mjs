// Compose healthchecks — every service that publishes a port declares one.
//
//   node scripts/check-compose-healthchecks.mjs               # gate
//   node scripts/check-compose-healthchecks.mjs --self-test   # a planted port-without-healthcheck must fail
//
// WHY THIS EXISTS. docker-compose.prod.yml carries twenty-two lines explaining why
// `api` needs a healthcheck: "`docker compose ps` printed 'Up' the moment the
// container started, which is a statement about the process existing, not about
// the server answering. Anyone reading that (me, twice) treats it as ready." Then
// it adds one — to that file. docker-compose.yml, the review topology a reviewer
// actually runs, defined api, web and nginx with no healthcheck on any of them,
// and `up -d --wait` waited on container state alone. The same defect, fixed in
// one copy of a file family, is exactly what a gate is for.
//
// RULE. In every tracked docker-compose*.yml, a service with a `ports:` block
// must have a `healthcheck:` block. A service that publishes nothing is not held
// to it (a job container, a migration runner). Exemptions are named, carry a
// reason, and must still match a service, or they are holes.
//
// The parser is line-based over the indentation compose uses (two spaces per
// level); it does not need a YAML library, and a compose file that does not
// follow that indentation is reported as unparseable rather than passed.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** service name → reason it may publish a port without a healthcheck. */
const EXEMPT = new Map([
  [
    "docker-compose.migrate.yml:db",
    "an OVERLAY on docker-compose.prod.yml's db (`-f prod -f migrate`): it only publishes the port on loopback for a migration run, and the base service carries the pg_isready healthcheck",
  ],
]);

/** Parse the `services:` map of a compose file into {name → {ports, healthcheck}}. */
function parseServices(text) {
  const lines = text.split("\n");
  const services = new Map();
  let inServices = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inServices) continue;
    const svc = /^  ([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (svc) {
      current = svc[1];
      services.set(current, { ports: false, healthcheck: false });
      continue;
    }
    if (!current) continue;
    if (/^    ports:\s*$/.test(line) || /^    ports:\s*\[/.test(line)) services.get(current).ports = true;
    if (/^    healthcheck:\s*$/.test(line)) services.get(current).healthcheck = true;
  }
  return services;
}

function audit(root, files, exempt) {
  const problems = [];
  const rows = [];
  const exemptHits = new Map([...exempt.keys()].map((k) => [k, 0]));
  for (const f of files) {
    const text = readFileSync(join(root, f), "utf8");
    if (!/^services:\s*$/m.test(text)) {
      problems.push(`${f}: no top-level services: block found — unparseable, not passed`);
      continue;
    }
    const services = parseServices(text);
    if (services.size === 0) problems.push(`${f}: services: block parsed to zero services — unparseable, not passed`);
    for (const [name, s] of services) {
      rows.push({ file: f, name, ...s });
      if (!s.ports) continue;
      const key = `${f}:${name}`;
      if (exempt.has(key)) {
        exemptHits.set(key, exemptHits.get(key) + 1);
        continue;
      }
      if (!s.healthcheck) problems.push(`${f}: service "${name}" publishes ports but declares no healthcheck — "Up" will mean the process exists, not that it answers`);
    }
  }
  for (const [k, n] of exemptHits) if (n === 0) problems.push(`exemption ${k} matches no published-port service — remove it`);
  return { rows, problems };
}

function trackedCompose(root) {
  const out = execFileSync("git", ["-C", root, "ls-files", "--", "docker-compose*.yml", "docker-compose*.yaml"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function selfTest() {
  const checks = [];
  const temp = mkdtempSync(join(tmpdir(), "sg-compose-hc-"));
  try {
    const good = ["services:", "  api:", "    image: x", "    ports:", '      - "8080:8080"', "    healthcheck:", '      test: ["CMD", "true"]', "  job:", "    image: y", ""].join("\n");
    writeFileSync(join(temp, "docker-compose.yml"), good);
    const clean = audit(temp, ["docker-compose.yml"], new Map());
    checks.push(["a published port with a healthcheck passes; a service without ports is not held to it", clean.problems.length === 0 && clean.rows.length === 2]);

    const bad = good.replace('    healthcheck:\n      test: ["CMD", "true"]\n', "");
    writeFileSync(join(temp, "docker-compose.yml"), bad);
    const drift = audit(temp, ["docker-compose.yml"], new Map());
    checks.push(["a published port WITHOUT a healthcheck FAILS by service name", drift.problems.length === 1 && /"api"/.test(drift.problems[0])]);

    checks.push(["an exemption with a reason silences it", audit(temp, ["docker-compose.yml"], new Map([["docker-compose.yml:api", "test"]])).problems.length === 0]);
    writeFileSync(join(temp, "docker-compose.yml"), good);
    checks.push(["a stale exemption is itself a failure", /matches no published-port service/.test(audit(temp, ["docker-compose.yml"], new Map([["docker-compose.yml:gone", "x"]])).problems[0] ?? "")]);

    writeFileSync(join(temp, "docker-compose.yml"), "version: '3'\nvolumes:\n  x: {}\n");
    checks.push(["a file with no services: block is unparseable, not passed", /unparseable/.test(audit(temp, ["docker-compose.yml"], new Map()).problems[0] ?? "")]);

    const real = audit(repo, trackedCompose(repo), EXEMPT);
    checks.push(["the real tree has at least two compose files with published ports", real.rows.filter((r) => r.ports).length >= 2]);
    checks.push(["…and the real tree is clean right now (the positive control)", real.problems.length === 0]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const failed = checks.filter(([, k]) => !k);
  for (const [n, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const files = trackedCompose(repo);
if (files.length === 0) {
  console.error("✗ no tracked docker-compose*.yml found — the scan is not reaching the tree.");
  process.exit(1);
}
const { rows, problems } = audit(repo, files, EXEMPT);
for (const p of problems) console.error(`  ✗ ${p}`);
const published = rows.filter((r) => r.ports);
console.log(`compose healthchecks: ${files.length} file(s), ${rows.length} service(s), ${published.length} publish ports, ${published.filter((r) => r.healthcheck).length} with a healthcheck, ${EXEMPT.size} exemption(s), ${problems.length} problem(s)`);
if (problems.length > 0) {
  console.error("\nCompose healthcheck gate FAILED — a container that boots and never listens must not read as Up.");
  process.exit(1);
}
console.log("Compose healthcheck gate passed — every published port has a service that says whether it answers.");
