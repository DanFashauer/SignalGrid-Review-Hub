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
// SECOND RECORD SET (plan row 30, part a — this is that row's "transport abstraction
// check"). The page is not the only consent record. `artifacts/lab-collections/
// microsoft-graph/` transcribes the connector's OWN transport as Bruno requests and
// carries `permissions.json`, which its README calls "the record a tenant admin
// consents from". When the connector gained `/identityProtection/riskyUsers` neither
// was updated, and nothing read them: a tenant admin consenting from permissions.json
// under-provisioned, and the connector graded every subject's risk `unknown`. So this
// gate also holds that folder to the connector, both directions:
//   · every request literal the connector builds, query INCLUDED, has a .bru file;
//   · every .bru request is a connector request (a request there asserts "the product
//     uses this"; it must not assert more);
//   · the permission names in permissions.json equal the scopes the connector names;
//   · every connector request sits under at least one `usedBy`, and every `usedBy`
//     entry is a connector request;
//   · floors (3 connector requests, 3 request files, 2 permissions) so a parser that
//     goes blind cannot pass vacuously; a missing folder or unreadable file is FATAL.
// It does NOT prove (a) that a request needs the permission its `usedBy` pairs it with
// — that is Microsoft's published fact, not derivable from the connector (part b,
// the msgraph-metadata OpenAPI cross-diff, would catch a wrong pairing), nor (b) that
// the request answers on a real tenant (the live-tenant milestone).
//
//   node scripts/check-graph-permission-boundary.mjs [--self-test] [--root <dir>]

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REQUEST_BLOCK } from "./check-lab-collections.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONNECTOR = "lib/integrations/src/integrations/graph/posture-connector.ts";
export const COLLECTION_DIR = "artifacts/lab-collections/microsoft-graph";
export const PERMISSIONS = `${COLLECTION_DIR}/permissions.json`;
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

/** Floors: below these the parsers have gone blind, and "nothing missing" would be a vacuous pass. */
export const FLOORS = { connectorRequests: 3, collectionFiles: 3, permissions: 2 };

/** Pure: distinct request literals the connector builds, path AND query, cut at the closing backtick. */
export function connectorRequests(src) {
  const out = new Set();
  for (const m of src.matchAll(/\$\{this\.baseUrl\}(\/[^`]*)/g)) out.add(m[1]);
  return [...out].sort();
}

/** Pure: `this.baseUrl` used in any form but the `${this.baseUrl}/…` template or its one constructor assignment — a read the literal scan cannot see. */
export function unseenBaseUrlUses(src) {
  const rest = src.replace(/\$\{this\.baseUrl\}\/[^`]*/g, "").replace(/this\.baseUrl\s*=\s/, "");
  return [...rest.matchAll(/this\.baseUrl\b/g)].length;
}

/** Pure: the connector's default Graph base URL (what `{{baseUrl}}` must resolve to), or null. */
export function connectorDefaultBase(src) {
  const m = /config\.baseUrl\s*\?\?\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
}

/** Pure: one entry per request file ({ file, method, path }); anything but a GET on `{{baseUrl}}/…` is fatal. */
export function collectionRequests(filesByName) {
  const fatal = [];
  const requests = [];
  for (const name of Object.keys(filesByName).sort()) {
    if (!name.endsWith(".bru") || name === "collection.bru") continue;
    const m = REQUEST_BLOCK.exec(filesByName[name]);
    if (!m) { fatal.push(`${name}: no request block (method + url) found — an unparseable request file proves nothing`); continue; }
    const method = m[1].toUpperCase();
    const url = m[2];
    const line = /url:[ \t]*([^\n]*)/.exec(filesByName[name].slice(m.index))?.[1].trim() ?? url;
    if (line !== url) { fatal.push(`${name}: url line \`${line}\` has content after the first space — Bruno sends the whole line, so the gate would see a narrower request than is sent`); continue; }
    if (method !== "GET") { fatal.push(`${name}: ${method} — the Graph connector is read-only; a non-GET request asserts a write the product never makes`); continue; }
    if (!url.startsWith("{{baseUrl}}/")) { fatal.push(`${name}: url ${url} does not start with {{baseUrl}}/ — it is not the connector's transport`); continue; }
    requests.push({ file: name, method, path: url.slice("{{baseUrl}}".length) });
  }
  return { requests, fatal };
}

/** Pure: the permission record. Returns { permissions: [{ permission, kind, usedBy: [path…] }], fatal }. */
export function permissionRecord(jsonText) {
  const fatal = [];
  const permissions = [];
  let doc;
  try { doc = JSON.parse(jsonText); } catch (e) { return { permissions, fatal: [`permissions.json does not parse: ${e.message}`] }; }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return { permissions, fatal: ["permissions.json is not an object"] };
  for (const k of Object.keys(doc)) if (!["$comment", "application", "delegated", "notRequested"].includes(k)) fatal.push(`permissions.json has an unknown top-level key \`${k}\` — a grant placed outside \`application\`/\`delegated\` would be invisible to this gate`);
  for (const kind of ["application", "delegated"]) {
    if (!Array.isArray(doc[kind])) { fatal.push(`permissions.json \`${kind}\` is missing or not an array — the consent record has the wrong shape`); continue; }
    doc[kind].forEach((p, i) => {
      const where = `permissions.json ${kind}[${i}]`;
      if (kind === "delegated") fatal.push(`${where}: the connector holds an application token and consents nothing delegated — a delegated entry is a grant the code cannot justify`);
      if (p === null || typeof p !== "object" || typeof p.permission !== "string" || !p.permission) { fatal.push(`${where}: no \`permission\` string`); return; }
      if (!Array.isArray(p.usedBy)) { fatal.push(`${where} (${p.permission}): \`usedBy\` is not an array`); return; }
      const usedBy = [];
      for (const u of p.usedBy) {
        const m = typeof u === "string" ? /^GET (\/\S*)$/.exec(u) : null;
        if (!m) fatal.push(`${where} (${p.permission}): usedBy entry ${JSON.stringify(u)} is not of the form \`GET <path+query>\``);
        else usedBy.push(m[1]);
      }
      permissions.push({ permission: p.permission, kind, usedBy });
    });
  }
  return { permissions, fatal };
}

/** Pure audit: the connector against the lab collection and permissions.json, both directions. */
export function auditCollection(connectorSrc, bruByName, permissionsText, envText) {
  const fatal = [];
  const cr = connectorRequests(connectorSrc);
  const cs = connectorScopes(connectorSrc);
  const col = collectionRequests(bruByName);
  const rec = permissionRecord(permissionsText);
  fatal.push(...col.fatal, ...rec.fatal);
  const colPaths = new Set(col.requests.map((r) => r.path));
  const perms = new Set(rec.permissions.map((p) => p.permission));
  const usedBy = new Set(rec.permissions.flatMap((p) => p.usedBy));
  const ub = unseenBaseUrlUses(connectorSrc);
  if (ub > 0) fatal.push(`the connector uses \`this.baseUrl\` ${ub} time(s) outside the \`\${this.baseUrl}/…\` template — a read built another way (concatenation, a helper) is invisible to this gate; build it as a literal or extend the gate`);
  const defBase = connectorDefaultBase(connectorSrc);
  const envBase = typeof envText === "string" ? /^\s*baseUrl:[ \t]*(\S+)\s*$/m.exec(envText)?.[1] : undefined;
  if (!defBase) fatal.push("the connector's default base URL could not be read — refusing to conclude the collection targets the same endpoint");
  else if (envBase !== defBase) fatal.push(`environments/Sandbox.bru baseUrl is ${envBase ?? "missing"} and the connector's default is ${defBase} — the collection would send requests to a different endpoint (e.g. /beta)`);
  const usedByCount = rec.permissions.reduce((n, p) => n + p.usedBy.length, 0);
  if (cr.length < FLOORS.connectorRequests) fatal.push(`floor: the connector yields ${cr.length} request literal(s), under ${FLOORS.connectorRequests} — the parser or the connector changed shape; refusing to conclude anything`);
  if (col.requests.length < FLOORS.collectionFiles) fatal.push(`floor: the collection holds ${col.requests.length} request file(s), under ${FLOORS.collectionFiles}`);
  if (rec.permissions.length < FLOORS.permissions) fatal.push(`floor: permissions.json holds ${rec.permissions.length} permission(s), under ${FLOORS.permissions}`);
  for (const r of cr) {
    if (!colPaths.has(r)) fatal.push(`the connector makes GET ${r} and ${COLLECTION_DIR} has no request file for it — the collection no longer transcribes the transport (exact path and query: the $select is the privacy posture)`);
    if (!usedBy.has(r)) fatal.push(`the connector makes GET ${r} and no permissions.json \`usedBy\` names it — the consent record does not cover a read the connector makes`);
  }
  for (const r of col.requests) if (!cr.includes(r.path)) fatal.push(`${r.file} asserts GET ${r.path} and the connector never makes it — a collection request must not assert more than posture-connector.ts does`);
  for (const u of usedBy) if (!cr.includes(u)) fatal.push(`permissions.json usedBy names GET ${u} and the connector never makes it — a grant the code cannot justify`);
  for (const s of cs) if (!perms.has(s)) fatal.push(`the connector needs ${s} and permissions.json does not list it — a tenant admin consenting from it under-provisions, and the read answers 403 so the connector grades every subject \`unknown\``);
  for (const p of perms) if (!cs.includes(p)) fatal.push(`permissions.json lists ${p} and the connector never names it — a grant the code cannot justify`);
  return {
    fatal,
    counts: { connectorRequests: cr.length, collectionFiles: col.requests.length, distinctCollectionRequests: colPaths.size, permissions: rec.permissions.length, usedBy: usedByCount },
  };
}

/** Reads the collection directory (recursively, `environments/` aside) and permissions.json. Missing or unreadable is FATAL, never a skip. */
export function loadCollection(root) {
  const fatal = [];
  const bruByName = {};
  const dir = join(root, COLLECTION_DIR);
  const walk = (rel) => {
    let entries = [];
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); }
    catch (e) { fatal.push(`${COLLECTION_DIR}/${rel}`.replace(/\/$/, "") + `: ${e.code === "ENOENT" ? "missing" : `unreadable (${e.message})`} — the collection is the second consent record; absence is not a skip`); return; }
    for (const d of entries) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) { fatal.push(`${COLLECTION_DIR}/${r}: a symlink — the gate will not follow it, so what it points at would go unchecked`); continue; }
      if (d.isDirectory()) { if (r !== "environments") walk(r); continue; }
      if (!d.name.endsWith(".bru")) continue;
      try { bruByName[r] = readFileSync(join(dir, r), "utf8"); }
      catch (e) { fatal.push(`${COLLECTION_DIR}/${r}: unreadable (${e.message})`); }
    }
  };
  walk("");
  let permissionsText = "";
  try { permissionsText = readFileSync(join(root, PERMISSIONS), "utf8"); }
  catch (e) { fatal.push(`${PERMISSIONS}: ${e.code === "ENOENT" ? "missing" : `unreadable (${e.message})`} — the consent record cannot be skipped`); }
  let envText = "";
  try { envText = readFileSync(join(dir, "environments/Sandbox.bru"), "utf8"); }
  catch (e) { fatal.push(`${COLLECTION_DIR}/environments/Sandbox.bru: ${e.code === "ENOENT" ? "missing" : `unreadable (${e.message})`} — {{baseUrl}} has nothing to resolve to`); }
  return { bruByName, permissionsText, envText, fatal };
}

/** Everything the gate concludes, in one place so the self-test runs the same aggregation the CLI does. */
export function auditAll(connectorSrc, docMd, lc) {
  const r = auditBoundary(connectorSrc, docMd);
  const cr = auditCollection(connectorSrc, lc.bruByName, lc.permissionsText, lc.envText);
  return { boundary: r, counts: cr.counts, fatal: [...r.fatal, ...lc.fatal, ...cr.fatal] };
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

  // ---- the lab collection and permissions.json ----
  const csrc = [
    'this.baseUrl = (config.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\\/$/, "");',
    "const a = `${this.baseUrl}/deviceManagement/managedDevices?$top=1`;",
    "const b = `${this.baseUrl}/users?$select=id,userPrincipalName,accountEnabled`;",
    "const c = `${this.baseUrl}/deviceManagement/managedDevices`;",
    "// Needs the IdentityRiskyUser.Read.All scope; e.g. User.Read.All, DeviceManagementManagedDevices.Read.All",
    "const d = `${this.baseUrl}/identityProtection/riskyUsers?$select=id,riskLevel,riskState`;",
  ].join("\n");
  const P = { probe: "/deviceManagement/managedDevices?$top=1", users: "/users?$select=id,userPrincipalName,accountEnabled", dev: "/deviceManagement/managedDevices", risky: "/identityProtection/riskyUsers?$select=id,riskLevel,riskState" };
  const bru = (path, method = "get", base = "{{baseUrl}}") => `meta {\n  name: x\n}\n\n${method} {\n  url: ${base}${path}\n  body: none\n  auth: inherit\n}\n\ndocs {\n  x\n}\n`;
  const baseBru = () => ({ "a.bru": bru(P.probe), "b.bru": bru(P.users), "c.bru": bru(P.dev), "d.bru": bru(P.risky), "collection.bru": "auth {\n  mode: bearer\n}\n" });
  const permObj = () => ({
    application: [
      { permission: "DeviceManagementManagedDevices.Read.All", usedBy: [`GET ${P.probe}`, `GET ${P.dev}`], why: "x" },
      { permission: "User.Read.All", usedBy: [`GET ${P.users}`], why: "x" },
      { permission: "IdentityRiskyUser.Read.All", usedBy: [`GET ${P.risky}`], why: "x" },
    ],
    delegated: [],
  });
  const pj = (o) => JSON.stringify(o);
  const ENV = "vars {\n  baseUrl: https://graph.microsoft.com/v1.0\n  graphToken: x\n}\n";
  const audit = (src = csrc, b = baseBru(), p = pj(permObj()), env = ENV) => auditCollection(src, b, p, env);
  const has = (r, ...needles) => r.fatal.some((f) => needles.every((n) => f.includes(n)));
  let c = audit();
  checks.push(["COLLECTION: the connector, four request files and a three-permission record agree (positive control)", c.fatal.length === 0 && c.counts.connectorRequests === 4 && c.counts.collectionFiles === 4 && c.counts.permissions === 3 && c.counts.usedBy === 4]);
  checks.push(["COLLECTION: connectorRequests keeps the query, and connectorEndpoints still strips it", connectorRequests(csrc).includes(P.users) && connectorEndpoints(csrc).includes("/users")]);
  let b = baseBru(); delete b["d.bru"];
  c = audit(csrc, b);
  checks.push(["COLLECTION: a request file missing for a request the connector makes is FATAL and names it", has(c, "identityProtection/riskyUsers", "no request file")]);
  let o = permObj(); o.application = o.application.filter((p) => p.permission !== "IdentityRiskyUser.Read.All");
  c = audit(csrc, baseBru(), pj(o));
  checks.push(["COLLECTION: a scope missing from permissions.json is FATAL and names the 403/unknown consequence", has(c, "IdentityRiskyUser.Read.All", "403", "unknown")]);
  o = permObj(); o.application.push({ permission: "Directory.Read.All", usedBy: [], why: "x" });
  checks.push(["COLLECTION: an extra permission is FATAL — a grant the code cannot justify", has(audit(csrc, baseBru(), pj(o)), "Directory.Read.All")]);
  b = baseBru(); b["e.bru"] = bru("/groups");
  checks.push(["COLLECTION: an extra request file is FATAL — it asserts more than the connector does", has(audit(csrc, b), "e.bru", "asserts")]);
  b = baseBru(); b["b.bru"] = bru(`${P.users},mail`);
  c = audit(csrc, b);
  checks.push(["COLLECTION: a $select widened in a .bru is FATAL (exact path+query, so a path-only compare would miss it)", has(c, "b.bru", ",mail") && has(c, "no request file")]);
  c = audit(csrc.replace("accountEnabled`", "accountEnabled,mail`"));
  checks.push(["COLLECTION: a $select widened in the connector text is FATAL", has(c, "accountEnabled,mail", "no request file")]);
  b = baseBru(); b["b.bru"] = bru(P.users, "post");
  checks.push(["COLLECTION: a POST .bru is FATAL", has(audit(csrc, b), "b.bru", "POST")]);
  b = baseBru(); b["b.bru"] = bru(P.users, "get", "{{other}}");
  checks.push(["COLLECTION: a url not prefixed {{baseUrl}}/ is FATAL", has(audit(csrc, b), "b.bru", "{{baseUrl}}")]);
  o = permObj(); o.application[1].usedBy.push("GET /nope");
  checks.push(["COLLECTION: a usedBy naming a non-request is FATAL", has(audit(csrc, baseBru(), pj(o)), "/nope", "never makes")]);
  o = permObj(); o.application[2].usedBy = [];
  checks.push(["COLLECTION: a request with no usedBy is FATAL", has(audit(csrc, baseBru(), pj(o)), "riskyUsers", "usedBy")]);
  o = permObj(); o.delegated.push({ permission: "Mail.Read.All", usedBy: [], why: "x" });
  checks.push(["COLLECTION: a delegated entry the connector never names is FATAL", has(audit(csrc, baseBru(), pj(o)), "Mail.Read.All")]);
  checks.push(["COLLECTION: unparseable permissions.json is FATAL", has(audit(csrc, baseBru(), "{not json"), "does not parse")]);
  checks.push(["COLLECTION: a wrong-shaped permissions.json is FATAL", has(audit(csrc, baseBru(), pj({ application: {} })), "not an array")]);
  const gone = loadCollection(join(repoRoot, "no-such-root"));
  checks.push(["COLLECTION: a missing directory and a missing permissions.json are each FATAL, never a skip", gone.fatal.length === 3 && gone.fatal.every((f) => f.includes("missing"))]);
  const two = csrc.split("\n").filter((l) => !l.includes("managedDevices`;") && !l.startsWith("const a")).join("\n");
  checks.push(["FLOOR: under three connector request literals is FATAL", has(audit(two), "floor", "connector yields")]);
  b = baseBru(); delete b["c.bru"]; delete b["d.bru"];
  checks.push(["FLOOR: under three request files is FATAL", has(audit(csrc, b), "floor", "request file")]);
  o = permObj(); o.application = o.application.slice(0, 1);
  checks.push(["FLOOR: under two permissions is FATAL", has(audit(csrc, baseBru(), pj(o)), "floor", "permission(s)")]);
  const liveC = loadCollection(repoRoot);
  const liveSrc = readFileSync(join(repoRoot, CONNECTOR), "utf8");
  const liveDoc = readFileSync(join(repoRoot, DOC), "utf8");
  const liveAll = auditAll(liveSrc, liveDoc, liveC);
  checks.push(["LIVE COLLECTION: the real collection and permissions.json match the real connector", liveAll.fatal.length === 0 && liveAll.counts.connectorRequests >= 3]);
  // The CLI's own aggregation (auditAll), not just auditCollection: drift in the loaded collection must reach the exit code.
  const driftB = { ...liveC.bruByName }; delete driftB["identityprotection-risky-users.bru"];
  checks.push(["MAIN PATH: the aggregation the CLI exits on carries a collection finding (a dropped aggregate would pass)", auditAll(liveSrc, liveDoc, { ...liveC, bruByName: driftB }).fatal.some((f) => f.includes("riskyUsers"))]);
  checks.push(["MAIN PATH: a loader fatal (missing folder) reaches the same aggregate", auditAll(liveSrc, liveDoc, { ...liveC, fatal: ["x: missing"] }).fatal.includes("x: missing")]);
  // ---- review round 1 plants ----
  o = permObj(); o.recommended = [{ permission: "Directory.Read.All", usedBy: ["GET /groups"] }];
  checks.push(["ROUND1: a grant under an unknown top-level key of permissions.json is FATAL", has(audit(csrc, baseBru(), pj(o)), "unknown top-level key", "recommended")]);
  checks.push(["ROUND1: a fifth read written as string concatenation is FATAL (the literal scan cannot see it)", has(audit(csrc + "\nconst e = this.baseUrl + \"/groups\";"), "this.baseUrl", "outside")]);
  checks.push(["ROUND1: a fifth read through a graphUrl(path) helper is FATAL", has(audit(csrc + "\nprivate graphUrl(path) { return `${this.baseUrl}${path}`; }"), "this.baseUrl", "outside")]);
  b = baseBru(); b["b.bru"] = bru(P.users + " &$expand=manager");
  checks.push(["ROUND1: a url with content after the first space is FATAL (Bruno sends the whole line)", has(audit(csrc, b), "b.bru", "after the first space")]);
  o = permObj(); o.delegated.push({ permission: "User.Read.All", usedBy: [`GET ${P.users}`] });
  checks.push(["ROUND1: a delegated duplicate of an application scope is FATAL", has(audit(csrc, baseBru(), pj(o)), "delegated[0]", "application token")]);
  checks.push(["ROUND1: Sandbox.bru pointing at /beta is FATAL", has(audit(csrc, baseBru(), pj(permObj()), ENV.replace("v1.0", "beta")), "Sandbox.bru", "beta")]);
  checks.push(["ROUND1: a missing Sandbox baseUrl is FATAL", has(audit(csrc, baseBru(), pj(permObj()), "vars {\n}\n"), "Sandbox.bru", "missing")]);
  b = baseBru(); b["e.bru"] = "meta {\n  name: x\n}\n\ndocs {\n  nothing\n}\n";
  checks.push(["ROUND1: an unparseable request file is FATAL, not skipped", has(audit(csrc, b), "e.bru", "no request block")]);
  b = baseBru(); b["extra/groups.bru"] = bru("/groups");
  checks.push(["ROUND1: a nested request file is read like a top-level one (asserts more -> FATAL)", has(audit(csrc, b), "extra/groups.bru", "asserts")]);
  {
    // The loader itself, on a throwaway tree outside the repo: nested request files are read, `environments/` is not a request, a symlink is fatal.
    const tmp = mkdtempSync(join(tmpdir(), "graph-boundary-"));
    try {
      const d = join(tmp, COLLECTION_DIR);
      mkdirSync(join(d, "extra"), { recursive: true }); mkdirSync(join(d, "environments"), { recursive: true });
      writeFileSync(join(d, "extra/groups.bru"), bru("/groups")); writeFileSync(join(d, "environments/Sandbox.bru"), ENV);
      writeFileSync(join(tmp, PERMISSIONS), pj(permObj())); symlinkSync(join(d, "extra/groups.bru"), join(d, "link.bru"));
      const l = loadCollection(tmp);
      checks.push(["ROUND1: the loader reads a nested .bru, skips environments/, and refuses a symlink", "extra/groups.bru" in l.bruByName && !("environments/Sandbox.bru" in l.bruByName) && l.fatal.some((f) => f.includes("link.bru") && f.includes("symlink"))]);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  checks.push(["ROUND1: unseenBaseUrlUses is 0 on the live connector (every read is a literal)", unseenBaseUrlUses(liveSrc) === 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const ri = process.argv.indexOf("--root");
  const root = ri > -1 && process.argv[ri + 1] ? resolve(process.argv[ri + 1]) : repoRoot;
  const connectorSrc = readFileSync(join(root, CONNECTOR), "utf8");
  const lc = loadCollection(root);
  const all = auditAll(connectorSrc, readFileSync(join(root, DOC), "utf8"), lc);
  const r = all.boundary;
  console.log(`Graph permission boundary — connector reads ${r.connectorEndpoints.join(", ")}; needs ${r.connectorScopes.join(", ")}`);
  console.log(`  page tables: ${r.docEndpoints.length} endpoint(s), ${r.docScopes.length} scope(s)`);
  const n = all.counts;
  console.log(`  lab collection: ${n.connectorRequests} connector request(s), ${n.collectionFiles} collection file(s), ${n.distinctCollectionRequests} distinct collection request(s), ${n.permissions} permission(s), ${n.usedBy} usedBy entr(ies)`);
  const fatal = all.fatal;
  if (fatal.length > 0) {
    console.error(`\nGraph-permission-boundary check FAILED: ${fatal.length} problem(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`Graph-permission-boundary check passed — ${DOC} names exactly what ${CONNECTOR} reads, and ${COLLECTION_DIR} (requests and permissions.json) matches it.`);
}
