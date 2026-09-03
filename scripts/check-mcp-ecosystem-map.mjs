#!/usr/bin/env node
// MCP-ecosystem source-independence map gate — every externally-sourced family
// SignalGrid decides on top of must have a row in the ecosystem map, and the map
// may not invent a family the tree does not have.
//
//   node scripts/check-mcp-ecosystem-map.mjs             # the gate
//   node scripts/check-mcp-ecosystem-map.mjs --self-test # prove the gate can fail
//
// WHY THIS EXISTS. `docs/research/MCP_ECOSYSTEM_SIGNAL_SOURCES.md` makes the
// source-independence claim concrete: for each SignalGrid signal-source family,
// which Model Context Protocol servers in the ecosystem expose that system's
// signals. A map like that rots the instant a connector family lands with no row
// — the reader concludes SignalGrid ingests fewer systems than it does, or worse,
// a NEW external category ships with no ecosystem entry and nobody notices. This
// gate makes that drift fail the build.
//
// THE SUBSET, DEFINED WITH A REASON, NEVER HAND-LISTED ARBITRARILY. Almost every
// family under lib/integrations/src/integrations/ reads SOME external bridge (the
// `from<X>` normalizers each "consume a read-only bridge"), so "ingests an
// external system" alone is too broad to be the subset — it would demand a row
// for the token-inspection RFC dimension and the WMS task plane alike. The subset
// this map indexes is narrower and stated: a family whose signal is a read of an
// external enterprise system that constitutes a DISTINCT PRODUCT CATEGORY the MCP
// ecosystem addresses — identity/SSO/IAM, EDR/endpoint, SIEM/log, ITSM,
// NAC/network, physical-access/RTLS/custody, UEM/MDM, vulnerability scanning,
// observability, and the three named GAP categories (DLP, peripheral control,
// carrier). Every directory is classified below `{ mapped, reason }`, and the
// classification is cross-checked against the tree BOTH ways: a new directory
// nobody classified is FATAL (it forces the decision "is this a new external
// category?"), and a CLASSIFY key that is no longer a directory is FATAL (a
// fossil). Families that read an external system but are NOT their own row —
// because a sibling family's category already represents that infrastructure, or
// the category has no consumer MCP ecosystem — carry `mapped:false` WITH the
// reason, and are named in the doc's own scope section rather than silently
// dropped.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INTEGRATIONS_DIR = "lib/integrations/src/integrations";
const DOC = "docs/research/MCP_ECOSYSTEM_SIGNAL_SOURCES.md";
const BEGIN = "<!-- MCP-ECOSYSTEM-MAP:BEGIN -->";
const END = "<!-- MCP-ECOSYSTEM-MAP:END -->";

// ── The classification of every connector family ─────────────────────────────
// mapped:true  — an external product category the ecosystem map indexes as its
//                own row (grounded MCP servers, or a stated gap).
// mapped:false — reads no distinct external product category the map indexes: it
//                is folded into a sibling row's category, is a niche/emerging
//                category with no consumer MCP ecosystem this survey found, is a
//                control/workflow/assurance plane rather than a signal-source
//                product category, or is an outbound formatter that names no
//                product. Each reason is the honest one; the external readers
//                among them are named in the doc's scope section.
export const CLASSIFY = {
  // Identity / SSO / IAM — Okta, Auth0, Keycloak, Entra ID, Casdoor MCP servers.
  "identity-risk": { mapped: true, reason: "IdP sign-in risk (Entra ID Protection, Okta ThreatInsight) — Identity/SSO/IAM category." },
  "sso-session": { mapped: true, reason: "live IdP session state on a shared device — Identity/SSO/IAM category." },
  "platform-sso": { mapped: true, reason: "Apple/Microsoft Platform SSO extension state — Identity/SSO/IAM category." },
  "passkey-assurance": { mapped: true, reason: "WebAuthn/passkey authenticator assurance — Identity/SSO/IAM category." },
  "oauth-consent": { mapped: true, reason: "OAuth/consent grants (Entra enterprise apps, Okta, Google) — Identity/SSO/IAM category." },
  // EDR / endpoint threat — CrowdStrike, SentinelOne, Defender, Tanium, Velociraptor.
  "edr-threat": { mapped: true, reason: "endpoint detection/response risk — EDR category." },
  "macos-posture": { mapped: true, reason: "grid-collected macOS hardening posture — endpoint posture category." },
  "device-attestation": { mapped: true, reason: "hardware-rooted device attestation — endpoint attestation category (stated gap)." },
  // SIEM / log / telemetry — Splunk, Microsoft Sentinel, Elastic; Defender/Fleet.
  siem: { mapped: true, reason: "SIEM event envelope (Splunk HEC, Sentinel) — SIEM category." },
  syslog: { mapped: true, reason: "JSON/CEF/LEEF log records — SIEM/log category." },
  telemetry: { mapped: true, reason: "endpoint telemetry query (Defender, FleetDM) — SIEM/telemetry category." },
  // ITSM — ServiceNow, Jira, PagerDuty MCP servers.
  itsm: { mapped: true, reason: "ticket/incident/change surfaces (ServiceNow, Jira, PagerDuty) — ITSM category." },
  // NAC / network — Cisco Meraki, RADIUS CoA.
  nac: { mapped: true, reason: "network access-control posture — NAC/network category." },
  "network-nac": { mapped: true, reason: "network admission/segmentation posture — NAC/network category." },
  // Physical access / RTLS / custody — Seam MCP (smart locks & access codes).
  "rtls-custody": { mapped: true, reason: "RTLS/badge custody of the device — physical-access/RTLS/custody category." },
  "pacs-access": { mapped: true, reason: "physical access-control (badge/door) — physical-access/RTLS/custody category." },
  "custody-beacon": { mapped: true, reason: "dock/cabinet custody beacon — physical-access/RTLS/custody category." },
  // UEM / MDM — Fleet, Jamf, Intune, Kandji; osquery.
  uem: { mapped: true, reason: "device compliance/management state — UEM/MDM category." },
  "device-management-health": { mapped: true, reason: "management-channel health / config drift — UEM/MDM category." },
  // Vulnerability scanning — Trivy, Snyk; Grype.
  "vuln-scan": { mapped: true, reason: "vulnerability/CVE posture — vulnerability-scanning category." },
  // Observability / integrity — Grafana, Datadog, Honeycomb.
  "observability-integrity": { mapped: true, reason: "observability/integrity posture — observability category." },
  // The three named GAP categories — real families, no widely-adopted MCP server yet.
  "data-protection": { mapped: true, reason: "DLP/data-protection posture — data-protection category (stated gap)." },
  "peripheral-control": { mapped: true, reason: "removable-media/peripheral control — peripheral-control category (stated gap)." },
  carrier: { mapped: true, reason: "carrier/connectivity posture — carrier category (stated gap)." },

  // ── mapped:false — reads an external system but is not its own ecosystem row ──
  "access-governance": { mapped: false, reason: "IGA/PAM authorization verdict over the identity-governance infrastructure the Identity/SSO/IAM row maps; no dedicated IGA-governance MCP server surveyed — folded into that row's scope note." },
  "entitlement-binding": { mapped: false, reason: "entitlement/least-privilege dimension over the same directory/IGA infrastructure the Identity/SSO/IAM row maps." },
  "token-binding": { mapped: false, reason: "RFC 9449/8705 token proof-of-possession inspection over the IdP-issued token the Identity/SSO/IAM row maps; not a product category with an MCP ecosystem." },
  "agent-identity": { mapped: false, reason: "non-human/agent-identity governance; an emerging category with no consumer MCP ecosystem this survey found." },
  "agent-behavior": { mapped: false, reason: "UEBA/behaviour-analytics verdict over the identity and endpoint evidence the map already represents; no dedicated MCP category surveyed." },
  "credential-exposure": { mapped: false, reason: "endpoint secret-exposure state; adjacent to the vulnerability-scanning row's secret-scanning surface, not a separate product category." },
  "ot-posture": { mapped: false, reason: "OT/ICS edge-gateway posture; a distinct plane the enterprise-security stack map keeps out of consumer-IT scope, and no widely-adopted OT MCP server was surveyed." },
  "sse-egress": { mapped: false, reason: "SASE/secure-service-edge egress posture; the coverage map places SASE out of scope and no adopted SASE MCP server was surveyed." },
  graph: { mapped: false, reason: "Microsoft Graph directory read; it IS the Entra ID identity infrastructure the Identity/SSO/IAM row maps." },
  "location-services": { mapped: false, reason: "RTLS/location-provider read; folded into the physical-access/RTLS/custody row." },
  "app-update": { mapped: false, reason: "app-version / update-eligibility reading; a control-plane input folded under UEM/MDM." },
  "change-window": { mapped: false, reason: "change-management window reading; a change-record input folded under ITSM." },
  "shift-context": { mapped: false, reason: "workforce/shift schedule reading; workforce management, not a security-stack signal-source category." },
  "task-exception": { mapped: false, reason: "WMS/task-system exception reading (Oracle WMS Cloud / SAP EWM); warehouse execution, not a security-stack signal-source category." },
  "caep-events": { mapped: false, reason: "outbound CAEP/Shared-Signals formatter; a protocol, not a product category with an MCP ecosystem." },
  webhooks: { mapped: false, reason: "generic outbound signed-HTTPS emitter; names no specific external system category." },
  "break-glass": { mapped: false, reason: "emergency-access assurance mechanic over the host's own break-glass record; a control plane, not a signal-source product." },
  "challenge-capability": { mapped: false, reason: "authenticator-capability inventory read; an assurance mechanic, not a distinct product category." },
  "benchmark-selection": { mapped: false, reason: "consumes a grading run; an assessment-selection mechanic, not a signal-source product." },
  "credential-rotation": { mapped: false, reason: "credential-rotation record read; a secrets-lifecycle mechanic folded under the identity/secrets planes." },
  "bootstrap-credential": { mapped: false, reason: "bootstrap-credential record read; a provisioning mechanic, not a signal-source product category." },
  "service-lifecycle": { mapped: false, reason: "service-lifecycle assurance mechanic; not an external signal-source product category." },
  "session-readiness": { mapped: false, reason: "session-readiness assurance mechanic; composed over the identity/device dimensions, not an external product." },
  "link-usability": { mapped: false, reason: "network link-usability banding; a connectivity-quality mechanic folded under the network/observability planes." },
  "local-authority": { mapped: false, reason: "local protected-store / authority reading; a device assurance mechanic, not a distinct product category." },
  "policy-binding": { mapped: false, reason: "internal policy-binding mechanic; reads no external system." },
  "response-accountability": { mapped: false, reason: "internal response-accountability routing mechanic; reads no external system." },
};

const bad = [];
const note = (m) => bad.push(m);

/** Pure: every backticked family token in a cell. */
export function familyTokensIn(cell) {
  return [...cell.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map((m) => m[1]);
}

const GAP_MARKER = /no\b[^.|]{0,48}\bMCP server\b/i; // "no widely-adopted MCP server known yet"
const NAMED_MCP = /\bMCP\b/i; // an ecosystem row names at least one "<X> MCP" server

/**
 * Pure: audit the map block against the mapped set and the real directory set.
 * Returns { missing, phantom, invalid, ... } so the self-test can drive it with
 * synthetic inputs and the main path with the real tree.
 */
export function auditMap({ mapped, realDirs, blockText }) {
  const result = { missing: [], phantom: [], invalid: [], rowsSeen: 0, familiesSeen: new Set() };
  const tableLines = blockText.split("\n").filter((l) => l.trim().startsWith("|"));
  if (tableLines.length < 3) {
    result.missing.push("__NO_TABLE__");
    return result;
  }
  // Header → column indices for the family cell and the MCP-servers cell.
  const cellsOf = (line) => line.split("|").map((c) => c.trim());
  const header = cellsOf(tableLines[0]);
  const familyCol = header.findIndex((c) => /famil(y|ies)/i.test(c));
  const serverCol = header.findIndex((c) => /\bMCP\b/i.test(c));
  if (familyCol === -1 || serverCol === -1) {
    result.missing.push("__NO_HEADER__");
    return result;
  }
  for (const line of tableLines.slice(1)) {
    if (/^[\s|:-]+$/.test(line)) continue; // separator row
    const cells = cellsOf(line);
    const fams = familyTokensIn(cells[familyCol] ?? "");
    if (fams.length === 0) continue;
    result.rowsSeen += 1;
    const serverText = cells[serverCol] ?? "";
    const valid = GAP_MARKER.test(serverText) || NAMED_MCP.test(serverText);
    for (const f of fams) {
      result.familiesSeen.add(f);
      if (!realDirs.has(f)) {
        result.phantom.push(`${f} (named in the map, not a family directory under ${INTEGRATIONS_DIR})`);
      } else if (!mapped.has(f)) {
        result.phantom.push(`${f} (named in the map but classified NOT ecosystem-mapped — misclassified row or wrong family)`);
      } else if (!valid) {
        result.invalid.push(`${f} (row names neither an MCP server nor a "no ... MCP server" gap marker)`);
      }
    }
  }
  for (const f of mapped) {
    if (!result.familiesSeen.has(f)) result.missing.push(f);
  }
  return result;
}

// ── self-test — the gate must be able to fail in BOTH directions ──────────────
function selfTest() {
  const mapped = new Set(["identity-risk", "edr-threat", "rtls-custody", "data-protection"]);
  const realDirs = new Set([...mapped, "access-governance", "token-binding"]);
  const header = "| SignalGrid family / families | External category | MCP servers exposing that system | Role |";
  const sep = "| --- | --- | --- | --- |";
  const rowIdentity = "| `identity-risk` | Identity/IAM | Okta MCP, Auth0 MCP | ingests, does not replace |";
  const rowEdr = "| `edr-threat` | EDR | CrowdStrike, SentinelOne via MCP | ingests |";
  const rowCustody = "| `rtls-custody` | Physical/RTLS | Seam MCP | ingests |";
  const rowGap = "| `data-protection` | DLP | no widely-adopted MCP server known yet | gap |";
  const fullBlock = [header, sep, rowIdentity, rowEdr, rowCustody, rowGap].join("\n");

  const checks = [];
  const ok = (label, cond) => checks.push([label, cond]);

  // Baseline: the complete, correct block passes cleanly.
  const clean = auditMap({ mapped, realDirs, blockText: fullBlock });
  ok("a complete, correct map has no missing/phantom/invalid", clean.missing.length === 0 && clean.phantom.length === 0 && clean.invalid.length === 0);

  // Direction 1: a mapped family missing from the doc → red.
  const missingBlock = [header, sep, rowIdentity, rowEdr, rowGap].join("\n"); // rtls-custody dropped
  const d1 = auditMap({ mapped, realDirs, blockText: missingBlock });
  ok("a mapped family missing from the map is reported (direction 1)", d1.missing.includes("rtls-custody"));

  // Direction 2a: a phantom family (not a real directory) in the doc → red.
  const phantomBlock = [header, sep, rowIdentity, rowEdr, rowCustody, rowGap, "| `phantom-family` | Nowhere | Ghost MCP | none |"].join("\n");
  const d2 = auditMap({ mapped, realDirs, blockText: phantomBlock });
  ok("a phantom family (no directory) in the map is reported (direction 2)", d2.phantom.some((p) => p.startsWith("phantom-family")));

  // Direction 2b: a real family classified NOT-mapped, listed as a row → red.
  const misclassBlock = [header, sep, rowIdentity, rowEdr, rowCustody, rowGap, "| `access-governance` | IGA | Some MCP | none |"].join("\n");
  const d3 = auditMap({ mapped, realDirs, blockText: misclassBlock });
  ok("a real but not-mapped family listed as a row is reported", d3.phantom.some((p) => p.startsWith("access-governance")));

  // A row with neither an MCP server nor a gap marker → invalid.
  const emptyServerBlock = [header, sep, rowIdentity, rowEdr, rowCustody, "| `data-protection` | DLP | — | gap |"].join("\n");
  const d4 = auditMap({ mapped, realDirs, blockText: emptyServerBlock });
  ok("a mapped family whose row names neither a server nor a gap is invalid", d4.invalid.some((p) => p.startsWith("data-protection")));

  // The gap phrasing is recognised as valid (not treated as empty).
  ok("the gap marker regex matches the doc's gap phrasing", GAP_MARKER.test("no widely-adopted MCP server known yet"));
  ok("an empty/dash server cell is neither a named server nor a gap", !GAP_MARKER.test("—") && !NAMED_MCP.test("—"));

  console.log("MCP-ecosystem-map gate self-test\n");
  let failed = 0;
  for (const [label, cond] of checks) {
    if (!cond) failed += 1;
    console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  }
  if (failed) {
    console.error(`\n✗ Self-test FAILED: ${failed} case(s) wrong — the gate does not do what it claims.`);
    process.exit(1);
  }
  console.log("\nSelf-test passed — the gate fails on a missing family and on a phantom, and spares a correct map.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) selfTest();

// ── the live gate ─────────────────────────────────────────────────────────────
const absIntegrations = resolve(REPO, INTEGRATIONS_DIR);
let realDirs;
try {
  realDirs = new Set(
    readdirSync(absIntegrations).filter((n) => {
      try {
        return statSync(join(absIntegrations, n)).isDirectory() && n !== "adapters";
      } catch {
        return false;
      }
    }),
  );
} catch (err) {
  console.error(`✗ could not read ${INTEGRATIONS_DIR}: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exit(1);
}
if (realDirs.size < 20) {
  console.error(`✗ found only ${realDirs.size} family directories — the walk drifted, not the tree emptied. Refusing to judge.`);
  process.exit(1);
}

// Classification completeness, both directions.
for (const d of realDirs) {
  if (!(d in CLASSIFY)) {
    note(
      `family directory "${d}" is not classified in check-mcp-ecosystem-map.mjs — decide whether it ingests a DISTINCT external product ` +
        `category the MCP ecosystem map should index (mapped:true, then add its row to ${DOC}) or is folded/internal (mapped:false, with a reason).`,
    );
  }
}
for (const k of Object.keys(CLASSIFY)) {
  if (!realDirs.has(k)) note(`CLASSIFY names "${k}", which is no longer a family directory under ${INTEGRATIONS_DIR} — a fossil; remove it.`);
}

const mapped = new Set(Object.entries(CLASSIFY).filter(([k, v]) => v.mapped && realDirs.has(k)).map(([k]) => k));

// Read the doc and its machine-readable block.
let docText;
try {
  docText = readFileSync(resolve(REPO, DOC), "utf8");
} catch (err) {
  console.error(`✗ could not read ${DOC}: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exit(1);
}
const beginAt = docText.indexOf(BEGIN);
const endAt = docText.indexOf(END);
if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
  console.error(`✗ ${DOC} is missing the "${BEGIN}" / "${END}" markers around the mapping table — the gate parses only between them.`);
  process.exit(1);
}
const blockText = docText.slice(beginAt + BEGIN.length, endAt);

const r = auditMap({ mapped, realDirs, blockText });

for (const m of r.missing) {
  if (m === "__NO_TABLE__") note(`${DOC} has no parseable table between the map markers.`);
  else if (m === "__NO_HEADER__") note(`${DOC} map table has no "family/families" column or no "MCP servers" column in its header.`);
  else note(`ecosystem-mapped family "${m}" has NO row in ${DOC} — every externally-sourced family must appear (add its row, with servers or a gap marker).`);
}
for (const p of r.phantom) note(`phantom in ${DOC}: ${p}`);
for (const v of r.invalid) note(`incomplete row in ${DOC}: ${v}`);

console.log("MCP-ecosystem-map gate\n");
console.log(`  family directories:        ${realDirs.size}`);
console.log(`  ecosystem-mapped families: ${mapped.size}`);
console.log(`  families found in the map:  ${r.familiesSeen.size}   (rows: ${r.rowsSeen})`);

if (bad.length > 0) {
  console.error(`\n✗ MCP-ecosystem-map gate FAILED: ${bad.length} problem(s):\n`);
  for (const b of bad) console.error(`    ✗ ${b}`);
  console.error(
    `\nThe map in ${DOC} must carry a row for every ecosystem-mapped family, each row naming\n` +
      "either an MCP server in the ecosystem or an explicit \"no ... MCP server\" gap marker, and\n" +
      "must not name a family the tree does not have or that is not ecosystem-mapped.",
  );
  process.exit(1);
}
console.log(`\nMCP-ecosystem-map gate passed — every ecosystem-mapped family has a complete row, and the map names no phantom.`);
