#!/usr/bin/env node
// Lab source collections — the Bruno maps of the third-party surfaces the lab
// actually runs must be REAL requests, not folders that exist.
//
// `artifacts/lab-collections/` (42 files at the time of writing) had NO gate:
// `check-api-collection.mjs` excludes it by name — correctly, because it maps
// third-party paths that gate has no business cross-checking against the
// api-server's routes — and nothing else looked. A malformed `.bru`, an empty
// service folder, or a folder the README never names was invisible (ninth audit
// round, 2026-09-06). This gate holds the part that IS unambiguous:
//
//   1. every service folder carries `bruno.json`, an `environments/` directory and
//      at least one request file;
//   2. every request file parses to a method + url block (the same recognizer
//      `check-api-collection.mjs` uses), FATAL on an unparseable file;
//   3. every service folder is named in the directory's README table — a folder
//      the README does not account for is an undeclared lane;
//   4. the collection is READ-ONLY EVIDENCE by the README's own rule: the only
//      non-GET requests allowed are auth bootstraps (login/token/session paths).
//
// It deliberately does NOT cross-check urls against any route table: these are
// vendor surfaces, which is exactly why they were split out of the parent
// collection.
//
//   node scripts/check-lab-collections.mjs [--self-test]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "artifacts/lab-collections";

const REQUEST_BLOCK = /(get|post|put|delete|patch)\s*\{[^}]*url:\s*(\S+)/;
/** Auth bootstraps are the ONLY writes the README allows. */
const AUTH_BOOTSTRAP = /(login|token|session|auth)/i;

/**
 * Pure audit over an in-memory model:
 *   folders: { [service]: { hasBrunoJson, hasEnvironments, requests: { [file]: source } } }
 *   readmeText: the directory README
 */
export function auditLabCollections(folders, readmeText) {
  const fatal = [];
  const names = Object.keys(folders);
  if (names.length === 0) fatal.push(`${ROOT} has no service folders — a collection of nothing`);
  // Two readings of the README, on purpose. A folder is DECLARED if the README
  // names it anywhere (the microsoft-graph exception is declared in prose, not in
  // the lane table). A README TABLE ROW, by contrast, is a claim that a lane runs,
  // so every table-row folder must exist; prose mentions of `environments/` or
  // `sources/` are not lane claims and are not held to that.
  const readmeNamed = new Set([...readmeText.matchAll(/`([a-z0-9-]+)\/`/g)].map((m) => m[1]));
  const readmeTableRows = new Set(
    readmeText.split("\n").filter((l) => l.trimStart().startsWith("|")).flatMap((l) => [...l.matchAll(/`([a-z0-9-]+)\/`/g)].map((m) => m[1])),
  );
  for (const svc of names) {
    const f = folders[svc];
    if (!f.hasBrunoJson) fatal.push(`${svc}: no bruno.json — not an openable Bruno collection`);
    if (!f.hasEnvironments) fatal.push(`${svc}: no environments/ — the requests have no baseUrl to resolve`);
    const files = Object.keys(f.requests);
    if (files.length === 0) fatal.push(`${svc}: no request files — a folder is not a map`);
    for (const file of files) {
      const m = f.requests[file].match(REQUEST_BLOCK);
      if (!m) {
        fatal.push(`${svc}/${file}: UNPARSEABLE (no method/url block this checker recognizes)`);
        continue;
      }
      const method = m[1].toLowerCase();
      if (method !== "get" && !AUTH_BOOTSTRAP.test(m[2])) {
        fatal.push(`${svc}/${file}: ${method.toUpperCase()} ${m[2]} is a WRITE that is not an auth bootstrap — the README says read-only evidence only`);
      }
    }
    if (!readmeNamed.has(svc)) fatal.push(`${svc}: folder exists but the README's table never names \`${svc}/\` — an undeclared lane`);
  }
  for (const named of readmeTableRows) {
    if (!names.includes(named)) fatal.push(`README's lane table names \`${named}/\` but no such folder exists`);
  }
  return { fatal, services: names.length, requests: names.reduce((n, s) => n + Object.keys(folders[s].requests).length, 0) };
}

function loadFolders(root) {
  const folders = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const requests = {};
    for (const file of readdirSync(dir)) {
      const full = join(dir, file);
      if (!statSync(full).isFile() || !file.endsWith(".bru") || file === "collection.bru") continue;
      requests[file] = readFileSync(full, "utf8");
    }
    folders[entry.name] = {
      hasBrunoJson: existsSync(join(dir, "bruno.json")),
      hasEnvironments: existsSync(join(dir, "environments")) && statSync(join(dir, "environments")).isDirectory(),
      requests,
    };
  }
  return folders;
}

function selfTest() {
  const checks = [];
  const bru = (method, url) => `meta {\n  name: x\n  type: http\n}\n\n${method} {\n  url: {{baseUrl}}${url}\n  body: none\n}\n`;
  const good = {
    fleet: { hasBrunoJson: true, hasEnvironments: true, requests: { "hosts.bru": bru("get", "/api/v1/fleet/hosts"), "login.bru": bru("post", "/api/v1/fleet/login") } },
    traccar: { hasBrunoJson: true, hasEnvironments: true, requests: { "devices.bru": bru("get", "/api/devices") } },
  };
  const readme = "| Folder | Lane |\n| `fleet/` | fleet |\n| `traccar/` | location |\n";
  let r = auditLabCollections(good, readme);
  checks.push(["a coherent collection set passes clean", r.fatal.length === 0 && r.services === 2 && r.requests === 3]);
  r = auditLabCollections({ ...good, fleet: { ...good.fleet, requests: { ...good.fleet.requests, "bad.bru": "meta {\n  name: y\n}\n" } } }, readme);
  checks.push(["an unparseable request file is FATAL", r.fatal.some((x) => x.includes("UNPARSEABLE"))]);
  r = auditLabCollections({ ...good, traccar: { ...good.traccar, requests: {} } }, readme);
  checks.push(["a service folder with no requests is FATAL", r.fatal.some((x) => x.includes("no request files"))]);
  r = auditLabCollections({ ...good, traccar: { ...good.traccar, hasBrunoJson: false } }, readme);
  checks.push(["a folder without bruno.json is FATAL", r.fatal.some((x) => x.includes("no bruno.json"))]);
  r = auditLabCollections({ ...good, wazuh: good.traccar }, readme);
  checks.push(["a folder the README never names is FATAL — an undeclared lane", r.fatal.some((x) => x.includes("never names"))]);
  r = auditLabCollections(good, readme + "| `keycloak/` | keycloak |\n");
  checks.push(["a README TABLE row with no folder behind it is FATAL", r.fatal.some((x) => x.includes("no such folder"))]);
  r = auditLabCollections(good, readme + "\nSee also `environments/` and `sources/` in prose.\n");
  checks.push(["a prose mention of a non-folder is NOT a lane claim (positive control)", !r.fatal.some((x) => x.includes("no such folder"))]);
  r = auditLabCollections({ ...good, fleet: { ...good.fleet, requests: { ...good.fleet.requests, "transfer.bru": bru("post", "/api/v1/fleet/hosts/transfer") } } }, readme);
  checks.push(["a non-auth WRITE request is FATAL — the collection is read-only evidence", r.fatal.some((x) => x.includes("is a WRITE"))]);
  r = auditLabCollections(good, readme);
  checks.push(["an auth-bootstrap POST is allowed (positive control)", !r.fatal.some((x) => x.includes("is a WRITE"))]);
  r = auditLabCollections({}, readme);
  checks.push(["an empty root is FATAL", r.fatal.some((x) => x.includes("no service folders"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const root = join(repoRoot, ROOT);
  if (!existsSync(root)) {
    console.error(`FAIL: ${ROOT} is missing.`);
    process.exit(1);
  }
  const readme = existsSync(join(root, "README.md")) ? readFileSync(join(root, "README.md"), "utf8") : "";
  const { fatal, services, requests } = auditLabCollections(loadFolders(root), readme);
  console.log(`Lab source collections — ${services} service folder(s), ${requests} request file(s)`);
  if (fatal.length > 0) {
    console.error(`\nLab-collections check FAILED: ${fatal.length} problem(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`Lab-collections check passed — every folder is a declared, openable, read-only Bruno collection of parseable requests (${relative(repoRoot, root)}).`);
}
