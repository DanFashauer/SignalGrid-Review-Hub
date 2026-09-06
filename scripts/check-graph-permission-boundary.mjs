#!/usr/bin/env node
// Graph permission boundary — the page that tells a tenant administrator what to
// grant must name every endpoint and every scope the connector actually reads.
//
// WHY THIS EXISTS. `docs/connectors/MICROSOFT_GRAPH_PERMISSION_BOUNDARY.md` was
// rewritten on 2026-08-25 because every permission on it had been invented. It
// then said, correctly, "No gate currently reads this document, so nothing catches
// it drifting from the connector again." On 2026-09-06 (Batch K, #463) the
// connector gained a third read — `/identityProtection/riskyUsers`, needing
// `IdentityRiskyUser.Read.All`, answering 403 → `unknown` without it — and the
// commit updated seven records and not this page. An administrator following the
// page ("Grant nothing else") would provision a connector that grades every
// subject's risk `unknown` forever, and the page would present that as complete.
// The code fails closed; the document loosened the deployment. Drift window: the
// hours between that merge and this gate.
//
// THE RULE, both directions, mechanical:
//   · every Graph URL literal the connector builds (`${this.baseUrl}/<path>`)
//     appears, query stripped, in the page's endpoint table;
//   · every `<Name>.Read.All` scope the connector names appears in the page's
//     scope table;
//   · and the page's tables name nothing the connector does not — "grant nothing
//     else" is only true if the tables hold nothing else.
// Prose outside the tables (the deferred `User-LifeCycleInfo.Read.All` paragraph)
// is not a grant instruction and is not read.
//
//   node scripts/check-graph-permission-boundary.mjs [--self-test]

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONNECTOR = "lib/integrations/src/integrations/graph/posture-connector.ts";
export const DOC = "docs/connectors/MICROSOFT_GRAPH_PERMISSION_BOUNDARY.md";

/** Pure: distinct endpoint paths the connector builds, query strings stripped. */
export function connectorEndpoints(src) {
  const out = new Set();
  for (const m of src.matchAll(/\$\{this\.baseUrl\}(\/[A-Za-z0-9_./-]+)/g)) out.add(m[1]);
  return [...out].sort();
}

/** Pure: distinct `Something.Read.All` scopes the connector names (comments included — they are the contract). */
export function connectorScopes(src) {
  return [...new Set([...src.matchAll(/\b([A-Za-z][A-Za-z0-9-]*\.Read\.All)\b/g)].map((m) => m[1]))].sort();
}

/** Pure: backticked `/path` cells in the page's tables, query strings stripped. */
export function docEndpoints(md) {
  const out = new Set();
  for (const line of md.split("\n")) {
    const m = /^\|\s*`(\/[A-Za-z0-9_./-]+)(?:\?[^`]*)?`\s*\|/.exec(line);
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

/** Pure: backticked scope cells in the page's tables. */
export function docScopes(md) {
  const out = new Set();
  for (const line of md.split("\n")) {
    const m = /^\|\s*`([A-Za-z][A-Za-z0-9-]*\.Read\.All)`\s*\|/.exec(line);
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

/** Pure audit over the two texts. */
export function auditBoundary(connectorSrc, docMd) {
  const fatal = [];
  const ce = connectorEndpoints(connectorSrc);
  const cs = connectorScopes(connectorSrc);
  const de = docEndpoints(docMd);
  const ds = docScopes(docMd);
  if (ce.length === 0) fatal.push("the connector source yields no `${this.baseUrl}/…` endpoint — the parser or the connector changed shape; refusing to conclude anything");
  if (cs.length === 0) fatal.push("the connector source names no `*.Read.All` scope — the parser or the connector changed shape");
  for (const e of ce) if (!de.includes(e)) fatal.push(`the connector reads ${e} and the page's endpoint table does not list it — an administrator following the page under-provisions`);
  for (const s of cs) if (!ds.includes(s)) fatal.push(`the connector needs ${s} and the page's scope table does not list it — "grant nothing else" would leave that read answering 403`);
  for (const e of de) if (!ce.includes(e)) fatal.push(`the page lists ${e} and the connector does not read it — a grant the code cannot justify`);
  for (const s of ds) if (!cs.includes(s)) fatal.push(`the page lists ${s} and the connector never names it — a grant the code cannot justify`);
  return { fatal, connectorEndpoints: ce, connectorScopes: cs, docEndpoints: de, docScopes: ds };
}

function selfTest() {
  const checks = [];
  const src = [
    "const a = `${this.baseUrl}/users?$select=id`;",
    "const b = `${this.baseUrl}/deviceManagement/managedDevices`;",
    "// Needs the IdentityRiskyUser.Read.All scope",
    "const c = `${this.baseUrl}/identityProtection/riskyUsers?$select=id`;",
    "/** e.g. User.Read.All, DeviceManagementManagedDevices.Read.All */",
  ].join("\n");
  const md = [
    "| Endpoint | Why |", "| --- | --- |",
    "| `/users?$select=id,userPrincipalName` | identity |",
    "| `/deviceManagement/managedDevices` | devices |",
    "| `/identityProtection/riskyUsers?$select=id` | risk |",
    "| Scope | Needed for |", "| --- | --- |",
    "| `User.Read.All` | users |", "| `DeviceManagementManagedDevices.Read.All` | devices |", "| `IdentityRiskyUser.Read.All` | risk |",
    "A third scope, `User-LifeCycleInfo.Read.All`, is declared by a deferred family — prose, not a table row.",
  ].join("\n");
  let r = auditBoundary(src, md);
  checks.push(["a page naming exactly what the connector reads passes (positive control)", r.fatal.length === 0 && r.connectorEndpoints.length === 3 && r.connectorScopes.length === 3]);
  checks.push(["query strings are stripped on both sides, so `$select` churn is not drift", r.docEndpoints.includes("/users") && r.connectorEndpoints.includes("/users")]);
  checks.push(["a scope named only in PROSE is not a grant instruction (the deferred family's scope)", !r.docScopes.includes("User-LifeCycleInfo.Read.All")]);
  r = auditBoundary(src, md.split("\n").filter((l) => !l.includes("riskyUsers")).join("\n"));
  checks.push(["THE PLANTED MISS: an endpoint the connector reads that the page omits is FATAL", r.fatal.some((f) => f.includes("/identityProtection/riskyUsers") && f.includes("under-provisions"))]);
  r = auditBoundary(src, md.split("\n").filter((l) => !l.includes("IdentityRiskyUser")).join("\n"));
  checks.push(["…and a scope the connector needs that the page omits is FATAL — the 2026-09-06 drift, reproduced", r.fatal.some((f) => f.includes("IdentityRiskyUser.Read.All") && f.includes("403"))]);
  r = auditBoundary(src, md + "\n| `Directory.Read.All` | everything |");
  checks.push(["a scope the page lists that the connector never names is FATAL — a grant the code cannot justify", r.fatal.some((f) => f.includes("Directory.Read.All"))]);
  r = auditBoundary("const x = 1;", md);
  checks.push(["a connector that yields no endpoints refuses to conclude (never a vacuous pass)", r.fatal.some((f) => f.includes("refusing"))]);
  const live = auditBoundary(readFileSync(join(repoRoot, CONNECTOR), "utf8"), readFileSync(join(repoRoot, DOC), "utf8"));
  checks.push(["LIVE: the connector reads at least three endpoints and the page names every one of them", live.connectorEndpoints.length >= 3 && live.fatal.length === 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const r = auditBoundary(readFileSync(join(repoRoot, CONNECTOR), "utf8"), readFileSync(join(repoRoot, DOC), "utf8"));
  console.log(`Graph permission boundary — connector reads ${r.connectorEndpoints.join(", ")}; needs ${r.connectorScopes.join(", ")}`);
  console.log(`  page tables: ${r.docEndpoints.length} endpoint(s), ${r.docScopes.length} scope(s)`);
  if (r.fatal.length > 0) {
    console.error(`\nGraph-permission-boundary check FAILED: ${r.fatal.length} problem(s).`);
    for (const f of r.fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`Graph-permission-boundary check passed — ${DOC} names exactly what ${CONNECTOR} reads.`);
}
