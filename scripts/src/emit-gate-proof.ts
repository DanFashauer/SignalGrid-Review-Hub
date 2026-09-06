// Proof: the outbound emitter families cannot send from a non-emitting tier.
//
// SIEM, syslog and telemetry all reach real customer systems — Sentinel/Splunk
// ingest, a syslog collector, and Fleet's live-query endpoint, which POSTs
// arbitrary osquery SQL to real hosts. None of them had a tier gate: an
// operator flag was the only thing standing between a dev process and a
// production SIEM.
//
// Unlike a device actuator (deleted from nac/ and uem/ because "quarantine this
// endpoint" has no read-only form), an emitter has an obviously correct
// disciplined behaviour — send nothing — so these are GATED.
//
// One shared resolver rather than four copies: four copies of a policy is four
// chances for one to drift permissive, and the drifted one is the one that
// ships. This asserts the shared gate AND that each family routes through it.
//
// Pure and offline: the gate is a function of the environment.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEmission, EMIT_SUPPRESSED, NO_CREDENTIAL } from "@workspace/integrations/emit-gate";
import {
  createITSMAdapter,
  ZendeskAdapter,
  JiraAdapter,
  ServiceNowAdapter,
  FreshserviceAdapter,
  BMCHelixAdapter,
  IvantiAdapter,
  ManageEngineAdapter,
  GenericWebhookAdapter,
} from "@workspace/integrations/itsm";
import { ITSMVendorSchema } from "@workspace/integrations/itsm/store";
import { WebhookSIEMAdapter } from "@workspace/integrations/siem";
import { SyslogAdapter } from "@workspace/integrations/syslog";
import { setFleetDMConfig } from "@workspace/integrations/telemetry/store";
import { FleetDMAdapter } from "@workspace/integrations/telemetry";
// Not re-exported by their family index.ts — the barrels export ./webhook and
// ./fleetdm only — so these three reach them through explicit package subpaths rather
// than through `export *`, which would widen each family's public surface to make a
// proof convenient.
import { SplunkAdapter } from "@workspace/integrations/siem/splunk";
import { SentinelAdapter } from "@workspace/integrations/siem/sentinel";
import { MDEAdapter } from "@workspace/integrations/telemetry/mde";
import type { SIEMEventRequest, SIEMEventResponse, ITSMTicketRequest } from "@workspace/integrations/adapters/types";
// The DECLARED outbound field set — what may leave, per builder. Section 13 asserts
// the key set actually emitted against it; scripts/check-emit-payload-discipline.mjs
// reads the same file lexically. Two readers, one source.
import {
  OUTBOUND_BUILDERS,
  DECLARED_FAMILIES,
  SIEM_TYPED_SUBOBJECTS,
  builderFor,
  permittedTopLevel,
} from "@workspace/integrations/adapters/payload-fields";
import { buildTemplateContext } from "@workspace/integrations/itsm";
import { buildCaepClaims } from "@workspace/integrations/caep-events";
import { dispatchEvent, DEFAULT_DISPATCHER_CONFIG, WEBHOOK_ENVELOPE_INVALID } from "@workspace/integrations/webhooks";
import { createWebhook, getDeliveryLogs } from "@workspace/integrations/webhooks/store";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The DERIVED emitter-family set, hoisted out of section 5's block so section 14
 *  can hold payload-fields.ts to it. Derived, never listed: a directory whose
 *  resolve.ts imports createEmitterResolver. */
let DERIVED_EMITTER_FAMILIES: string[] = [];

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}`);
  }
}

function suppressedWithReason(env: NodeJS.ProcessEnv, label: string): void {
  const r = resolveEmission(env, NO_CREDENTIAL);
  check(`${label} → suppressed`, r.mode === "suppressed");
  check(`${label} → states a reason`, r.mode === "suppressed" && r.reason.length > 0);
}

// ── 1. Tiers that must never emit ────────────────────────────────────────────
// Each asserted WITH the live flag set to "true", so these pin the TIER check
// rather than passing for the unrelated reason that the flag was unset.
for (const tier of ["dev", "alpha", "test", "staging", "local", ""]) {
  suppressedWithReason(
    { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "true" },
    `tier "${tier || "(empty)"}" with flag true`,
  );
}
suppressedWithReason({}, "empty environment (defaults to dev)");

// ── 2. Beta/prod still require the explicit flag, matched exactly ────────────
for (const tier of ["beta", "prod"]) {
  suppressedWithReason({ SIGNALGRID_TIER: tier }, `tier "${tier}" without the flag`);
  for (const almost of ["false", "TRUE", "True", "1", "yes", " true", "true "]) {
    suppressedWithReason(
      { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: almost },
      `tier "${tier}" with flag "${almost}"`,
    );
  }
}

// ── 3. The allow path exists ─────────────────────────────────────────────────
// A gate that can never open is a wall: it would satisfy every assertion above
// while silently breaking every integration in production.
for (const tier of ["beta", "prod", "PROD", "Beta"]) {
  const r = resolveEmission({ SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "true" }, NO_CREDENTIAL);
  check(`tier "${tier}" + flag true → live`, r.mode === "live");
}

// ── 4. The suppressed status is neither "sent" nor "failed" ─────────────────
// "sent" would be the damaging lie — a compliance reader treats a forwarded
// audit event as delivered. "failed" would invite an operator to chase a
// non-problem. The honest third state says what actually happened.
// Compared through a widened `string`: with the literal type these read as
// tautologies the compiler can discharge, and an assertion that cannot fail
// proves nothing. Widened, they are real runtime guards against someone
// redefining the constant to "sent" — which would restore exactly the lie this
// whole change removes.
const suppressedStatus: string = EMIT_SUPPRESSED;
check("suppressed status is not 'sent'", suppressedStatus !== "sent");
check("suppressed status is not 'failed'", suppressedStatus !== "failed");
check("suppressed status is the literal 'suppressed'", suppressedStatus === "suppressed");

// ── 5. Each family actually ROUTES through the shared gate ──────────────────
// The gate existing proves nothing if a family bypasses it. Asserted against the
// source so a newly-added emitter that forgets the gate is caught here.
const ROUTED: Array<[string, string]> = [
  ["syslog", "lib/integrations/src/integrations/syslog/transport.ts"],
  ["siem/sentinel", "lib/integrations/src/integrations/siem/sentinel.ts"],
  ["siem/splunk", "lib/integrations/src/integrations/siem/splunk.ts"],
  ["siem/webhook", "lib/integrations/src/integrations/siem/webhook.ts"],
  ["telemetry/fleetdm", "lib/integrations/src/integrations/telemetry/fleetdm.ts"],
  ["itsm/adapter", "lib/integrations/src/integrations/itsm/adapter.ts"],
];
for (const [label, rel] of ROUTED) {
  const src = readFileSync(resolve(repo, rel), "utf8");
  check(`${label} imports the shared emit gate`, /from ['"][^'"]*adapters\/emit-gate['"]/.test(src));
  check(`${label} calls resolveEmission()`, /resolveEmission\(/.test(src));
}

// ── 6. syslog no longer claims to have sent what it never sent ──────────────
// It opens no UDP, TCP or TLS socket anywhere; it previously returned
// status 'sent' regardless. That is the single most misleading thing an audit
// forwarder can report. The composed design (both lanes' protections, merged):
// suppressed → the honest `suppressed` status like every other emitter; LIVE —
// where the caller explicitly configured delivery and a quiet status is at its
// most dangerous — the adapter THROWS rather than reporting any status at all.
// proof:emitter-discipline holds the behavioral pin for that throw.
const syslogSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/syslog/transport.ts"), "utf8");
check("syslog opens no socket (still unimplemented)", !/dgram|net\.Socket|tls\.connect/.test(syslogSrc));
check("syslog does not report status 'sent'", !/status:\s*'sent'/.test(syslogSrc));
check("syslog refuses loudly when live: throws rather than reporting a status", /throw new Error\(\s*\n?\s*["']syslog: no transport is implemented/.test(syslogSrc));

// ── syslog's HEALTH CHECK does not claim reachability either ─────────────────
//
// This is the half the block above missed for as long as it existed. It asserted
// that syslog opens no socket, never reports 'sent', and throws when live — all
// true — and said NOTHING about `healthCheck`, which returned
// `!!(this.config.host && this.config.port)`. `port` is defaulted in the
// constructor and `host` is required, so it was `true` for every adapter that can
// be constructed. Measured at dev tier against a hostname that does not resolve:
// healthCheck() true, sendEvent() suppressed, same process.
//
// A forwarder that reports itself healthy while it cannot deliver defeats the
// audit trail it exists to produce, and does so most convincingly during an
// incident — which is what the `status: 'sent'` line one assertion above was
// written about. The lie moved rather than left.
//
// Two assertions, because one alone would pass on the wrong thing: the gate must
// be consulted (matching splunk/sentinel/webhook), AND the config-truthiness
// shortcut must be gone. A future gate-then-probe implementation keeps the first
// and is free to change the second.
check(
  "syslog healthCheck consults the emit gate before answering",
  /async healthCheck\(\)[\s\S]{0,400}?resolveEmission\(/.test(syslogSrc),
);
check(
  "syslog healthCheck no longer answers from config truthiness alone",
  !/async healthCheck\(\)[\s\S]{0,400}?return !!\(this\.config\.host/.test(syslogSrc),
);

// itsm gates at the FACTORY, which every one of its eight vendor adapters passes
// through. Assert the gate runs BEFORE the pre-existing "no credentials" branch:
// placed after it, a fully-configured dev process would still build an adapter.
const itsmSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/itsm/adapter.ts"), "utf8");
const gateAt = itsmSrc.indexOf("resolveEmission(");
const credsAt = itsmSrc.indexOf("const credentials = config.credentials");
check("itsm: the tier gate precedes the credentials branch", gateAt > 0 && credsAt > 0 && gateAt < credsAt);

// ── 7. The four paths that were reaching the network without the gate ───────
// Found by an audit of the boundary in August 2026. Each is asserted the way that
// can actually FAIL: the gate token must appear in the method body BEFORE the
// first outbound call. "The file mentions resolveEmission somewhere" is the
// assertion that let three of these hide — sentinel.ts named the gate in
// sendEvent() while sendEvents() beside it POSTed ungated.
//
// The regex for an outbound call matches any "fetch"-containing callee, because
// the fourth defect here was precisely that: servicenow.ts and jira.ts reach the
// network only through `fetchWithTimeout`, and every check looking for the literal
// `fetch(` skipped them entirely and reported green.
const OUTBOUND_CALL = /(?<![\w$])[\w$]*[Ff]etch[\w$]*\s*\(/;

// Comments are blanked before searching. The first draft of this proof did not do
// that and failed on servicenow.healthCheck() — because the explanatory comment
// ABOVE the gate contains the word "fetch", so the "first outbound call" landed on
// prose. Worth keeping as a note: the failure was in the assertion, not the code,
// and a proof that cannot tell a comment from a call is measuring the wrong thing.
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
          .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * @param callRe the first OUTBOUND expression for this method. Defaults to a direct
 *   fetch; `nac.lookupEndpoint()` reaches the network by delegating to an adapter it
 *   builds, so it passes the builder instead. Naming the real outbound step per site
 *   keeps each assertion falsifiable rather than approximately true.
 */
function gateBeforeFirstCall(rel: string, methodRe: RegExp, label: string, callRe: RegExp = OUTBOUND_CALL): void {
  const src = stripComments(readFileSync(resolve(repo, rel), "utf8"));
  const m = src.match(methodRe);
  if (!m || m.index === undefined) {
    check(`${label}: method located in source`, false);
    return;
  }
  const body = src.slice(m.index);
  const gateAt = body.search(/resolveEmission\s*\(/);
  // Search AFTER the declaration line, so a method whose own name contains "fetch"
  // does not match itself.
  const afterDecl = body.indexOf("\n");
  const callOffset = body.slice(afterDecl).search(callRe);
  const callAt = callOffset === -1 ? -1 : callOffset + afterDecl;
  check(`${label}: reaches the network at all (assertion is not vacuous)`, callAt > 0);
  check(`${label}: gated BEFORE its first outbound call`, gateAt > 0 && callAt > 0 && gateAt < callAt);
}

gateBeforeFirstCall(
  "lib/integrations/src/integrations/itsm/servicenow.ts",
  /async healthCheck\s*\(/,
  "servicenow.healthCheck()",
);
gateBeforeFirstCall(
  "lib/integrations/src/integrations/itsm/jira.ts",
  /async healthCheck\s*\(/,
  "jira.healthCheck()",
);
gateBeforeFirstCall(
  "lib/integrations/src/integrations/siem/sentinel.ts",
  /async sendEvents\s*\(/,
  "sentinel.sendEvents()",
);
// ── nac: a STRONGER claim than "gated before the call" ─────────────────────
//
// This assertion used to be `gateBeforeFirstCall(nac/store.ts, lookupEndpoint, …,
// getNACAdapter)` — correct for a design where the family owned an HTTP adapter and
// had to decide to be live before constructing it. The launch lane rebuilt nac
// around an INJECTED transport instead, so that assertion no longer describes the
// code: there is no `lookupEndpoint` in the store and no adapter to build.
//
// Rewritten rather than deleted, and rewritten UP. The property now true of nac is
// the one uem already has and the one worth having: the family makes no outbound
// call at all, so there is nothing to gate. Its failure mode is "there is no code",
// which is stronger than "a correctly-ordered flag check".
//
// Kept falsifiable in both directions — a family that reaches the network would
// fail the first check, and a `resolveNacConnector` that stopped refusing an absent
// transport would fail the second.
{
  const NAC_DIR = "lib/integrations/src/integrations/nac";
  const nacFiles = readdirSync(resolve(repo, NAC_DIR)).filter((f) => f.endsWith(".ts"));
  check("nac: the family has source files to check (assertion is not vacuous)", nacFiles.length >= 4);
  const reaching = nacFiles.filter((f) =>
    OUTBOUND_CALL.test(stripComments(readFileSync(resolve(repo, NAC_DIR, f), "utf8"))),
  );
  check(
    `nac: NO file in the family makes an outbound call — nothing to gate (${nacFiles.length} files checked)`,
    reaching.length === 0,
  );
  if (reaching.length) console.error(`    reaching the network: ${reaching.join(", ")}`);

  // And the live path stays unreachable: every condition must hold AND a transport
  // must be injected, which this repository does not ship.
  const idx = stripComments(readFileSync(resolve(repo, NAC_DIR, "index.ts"), "utf8"));
  check(
    "nac: resolveNacConnector refuses live mode without an injected transport",
    /if \(!transportOverride\)/.test(idx) && /mode:\s*"fixture"/.test(idx),
  );
  check(
    "nac: the live path also requires tier + live flag + vendor + token (unanimous, fail-closed)",
    /SIGNALGRID_TIER/.test(idx) &&
      /SIGNALGRID_LIVE_INTEGRATIONS/.test(idx) &&
      /NAC_VENDOR/.test(idx) &&
      /NAC_ACCESS_TOKEN/.test(idx),
  );
}

// mde gates at its single `isEnabled()` choke point, which all five of its outbound
// methods already guard on — so assert the choke point itself, not each caller.
// Asserted as "config flag AND emission gate": returning `config.enabled` alone was
// the defect, and a tenant-controlled value is not a deployment boundary.
const mdeSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/telemetry/mde.ts"), "utf8");
const mdeEnabled = mdeSrc.slice(mdeSrc.indexOf("isEnabled(): boolean"));
const mdeBody = mdeEnabled.slice(0, mdeEnabled.indexOf("\n  }"));
check("mde.isEnabled(): requires the local config flag", /config\?\.enabled/.test(mdeBody));
check("mde.isEnabled(): ALSO requires the emission gate", /resolveEmission\s*\([^;]*\)\.mode === ['"]live['"]/.test(mdeBody));
check(
  "mde: every outbound method still routes through isEnabled()",
  (mdeSrc.match(/if \(!this\.isEnabled\(\)\)/g) ?? []).length >= 5,
);

// ── 8. DERIVED coverage of the four routed families ─────────────────────────
//
// Section 5 above is a HAND-WRITTEN list of six modules, and for as long as it was
// the only routing assertion it was advertised — in adapters/emit-gate.ts — as
// deriving the family set. It does not. Fifteen modules import the gate; six were
// listed. Measured, not argued: deleting the import from itsm/zendesk.ts left this
// proof at 84/84.
//
// The named six stay, because they carry a claim a sweep cannot make (the gate sits
// BEFORE the first outbound call, section 7). This adds the claim the sweep CAN
// make: walk the four routed family directories and require the gate import on every
// module that reaches a vendor. A seventh ITSM adapter added tomorrow is covered
// without editing a list.
//
// SCOPE, stated so the silence is not read as coverage: exactly siem/, syslog/,
// telemetry/ and itsm/. webhooks/ and caep-events/ are deliberately OUT — they hold
// the identical policy in their own resolve*Emitter() and import nothing from
// adapters/, so sweeping them would demand an import that must not exist. That
// exclusion is asserted below rather than left to this comment.
{
  const FAMILY_ROOT = "lib/integrations/src/integrations";

  // DERIVED, not hand-listed — these two arrays were literal string lists, and a
  // seventh emitter family would have joined neither, leaving this sweep reporting
  // green over a family it had never looked at. Two rules, both mechanical:
  //
  //   an EMITTER FAMILY is a directory whose resolve.ts imports createEmitterResolver;
  //   it is ROUTED iff some module in it imports adapters/emit-gate.
  //
  // OUT_OF_SCOPE is then the remainder by construction, so the two sets cannot
  // overlap and cannot both drift the same way.
  const GATE_IMPORT_RE = /from ['"][^'"]*adapters\/emit-gate['"]/;
  const emitterFamilies = readdirSync(resolve(repo, FAMILY_ROOT), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      // ABSENT AND UNREADABLE ARE DIFFERENT ANSWERS. A directory with no resolve.ts is
      // simply not an emitter family — a negative result. A resolve.ts that EXISTS and
      // cannot be read is a measurement failure, and the old catch-all turned it into
      // the same negative: the family dropped silently out of the derived set and every
      // "across all N families" claim quietly covered one fewer. The floors below would
      // catch a drop today, but they would report it as a count that moved rather than
      // as a file that could not be read.
      const resolvePath = resolve(repo, FAMILY_ROOT, name, "resolve.ts");
      if (!existsSync(resolvePath)) return false;
      let source: string;
      try {
        source = readFileSync(resolvePath, "utf8");
      } catch (err) {
        throw new Error(
          `unreadable resolve.ts for integration family "${name}" (${resolvePath}): ` +
          `${err instanceof Error ? err.message : String(err)} — a family whose definition ` +
          `cannot be read is a measurement failure, not a negative result`,
        );
      }
      return /createEmitterResolver/.test(source)
    })
    .sort();
  const importsGate = (family: string): boolean =>
    readdirSync(resolve(repo, FAMILY_ROOT, family))
      .filter((f) => f.endsWith(".ts"))
      .some((f) => GATE_IMPORT_RE.test(readFileSync(resolve(repo, FAMILY_ROOT, family, f), "utf8")));
  const ROUTED_FAMILIES = emitterFamilies.filter(importsGate);
  const OUT_OF_SCOPE = emitterFamilies.filter((f) => !importsGate(f));

  // FLOORS AND THE COUNT PIN. A derivation that stops matching agrees with an empty
  // expectation and calls the agreement coverage. The counts are asserted because
  // this file's own header states them in prose ("Six resolve.ts files, four callers
  // of this one") — the prose and the derivation now fail together or not at all.
  DERIVED_EMITTER_FAMILIES = [...emitterFamilies];
  check(
    `derived: six emitter families in the tree (found ${emitterFamilies.length}: ${emitterFamilies.join(", ")})`,
    emitterFamilies.length === 6,
  );
  check(
    `derived: FOUR of them route through adapters/emit-gate (found ${ROUTED_FAMILIES.length}: ${ROUTED_FAMILIES.join(", ")})`,
    ROUTED_FAMILIES.length === 4,
  );
  check(
    `derived: the other TWO carry the policy in their own resolve.ts (found ${OUT_OF_SCOPE.length}: ${OUT_OF_SCOPE.join(", ")})`,
    OUT_OF_SCOPE.length === 2,
  );
  check(
    "derived: routed and out-of-scope partition the emitter families — no family is in both or neither",
    ROUTED_FAMILIES.length + OUT_OF_SCOPE.length === emitterFamilies.length &&
      !ROUTED_FAMILIES.some((f) => OUT_OF_SCOPE.includes(f)),
  );
  // Not adapters: the family's own gate wiring (resolve.ts), its type surface
  // (types.ts), its re-export barrel (index.ts) and any fixture module. None of
  // them reaches a vendor, so none of them is asked to import the gate — and the
  // qualifier below would exclude them anyway. Named so the exclusion is visible.
  const NOT_AN_ADAPTER = /^(resolve|types|index)\.ts$|fixture/i;
  const GATE_IMPORT = GATE_IMPORT_RE;
  const VENDOR_HOST = /https?:\/\//;
  // stripComments() above blanks from the first `//` to end of line, which eats the
  // `//` of a URL and turns `https://acme.zendesk.com` into `https:` — so the host
  // probe uses a stripper that spares a protocol separator. Without it itsm/adapter.ts,
  // whose only vendor signal is two `https://${subdomain}...` template literals in
  // live code, dropped out of the sweep entirely. Same borrowed shape as
  // scripts/check-ungated-fetch.mjs, and for the same reason.
  const stripCommentsSparingUrls = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

  const swept: string[] = [];
  const reaching: Array<[string, string]> = [];
  for (const family of ROUTED_FAMILIES) {
    for (const file of readdirSync(resolve(repo, FAMILY_ROOT, family)).sort()) {
      if (!file.endsWith(".ts") || NOT_AN_ADAPTER.test(file)) continue;
      const rel = `${FAMILY_ROOT}/${family}/${file}`;
      swept.push(rel);
      // Comments stripped first, for the reason section 7 records: a comment that
      // says "fetch" or quotes a vendor URL is prose, not a network call, and a
      // sweep that cannot tell them apart would demand a gate on an honest file.
      const raw = readFileSync(resolve(repo, rel), "utf8");
      const code = stripComments(raw);
      if (OUTBOUND_CALL.test(code) || VENDOR_HOST.test(stripCommentsSparingUrls(raw))) reaching.push([rel, code]);
    }
  }

  // FLOOR. A sweep that finds nothing asserts nothing, and would report every
  // module gated while scanning an empty set. 12 is just below the 14 the tree
  // holds today, so one adapter may legitimately be deleted without tripping it;
  // a derivation that has drifted fails here instead of passing quietly.
  check(
    `derived: the four routed families yield >= 12 vendor-reaching modules (found ${reaching.length} of ${swept.length} swept)`,
    reaching.length >= 12,
  );

  for (const [rel, code] of reaching) {
    check(`derived: ${rel.slice(FAMILY_ROOT.length + 1)} imports the shared emit gate`, GATE_IMPORT.test(code));
  }

  // The sweep must not reach the two families that correctly do NOT import this
  // file — asserted from the other side too: neither of them imports it today, so
  // a future sweep that widened onto them would fail loudly rather than silently
  // demand the wrong thing.
  check(
    "derived: the sweep covers neither webhooks/ nor caep-events/ (they carry the policy in their own resolve*Emitter)",
    !swept.some((rel) => /\/(webhooks|caep-events)\//.test(rel)),
  );
  for (const family of OUT_OF_SCOPE) {
    const files = readdirSync(resolve(repo, FAMILY_ROOT, family)).filter((f) => f.endsWith(".ts"));
    check(`derived: ${family}/ exists and is a real family (${files.length} modules)`, files.length >= 3);
    check(
      `derived: no ${family}/ module imports adapters/emit-gate — its policy lives in its own resolve.ts`,
      files.every((f) => !GATE_IMPORT.test(readFileSync(resolve(repo, FAMILY_ROOT, family, f), "utf8"))),
    );
  }

  // The classifier itself, exercised against a planted module. Without this, a
  // qualifier that stopped matching would report "every vendor-reaching module is
  // gated" over an empty set — the exact shape of the defect this section fixes.
  const plantedUngated = 'export async function ping(u: string) { return fetchWithTimeout(u); }';
  const plantedGated = 'import { resolveEmission } from "../adapters/emit-gate";\n' + plantedUngated;
  const plantedComment = "// see https://example.service.com/docs\nexport const x = 1;";
  check("derived: a planted module calling fetchWithTimeout IS classified as vendor-reaching", OUTBOUND_CALL.test(plantedUngated));
  check("derived: a planted module with no gate import IS classified ungated", !GATE_IMPORT.test(plantedUngated));
  check("derived: the same module WITH the import is classified gated (the check is not always-fail)", GATE_IMPORT.test(plantedGated));
  check(
    "derived: a comment naming a vendor URL alone does NOT make a module vendor-reaching",
    !VENDOR_HOST.test(stripCommentsSparingUrls(plantedComment)) && !OUTBOUND_CALL.test(stripComments(plantedComment)),
  );
  check(
    "derived: a vendor URL in LIVE code IS still seen after comment-stripping (the sparing strip works)",
    VENDOR_HOST.test(stripCommentsSparingUrls('const u = `https://${sub}.zendesk.com`;')),
  );
}

// ── 9. THE THIRD CLAUSE: a credential must be present ───────────────────────
//
// Seven comments in lib/, `scripts/check-ungated-fetch.mjs:8` and
// `docs/SECURITY_REVIEW_PACKAGE.md` all describe the boundary as THREE conditions
// — tier AND SIGNALGRID_LIVE_INTEGRATIONS AND a credential. `resolveEmission`
// checked two. The third lived only in `createEmitterResolver()`, which the four
// resolveEmission-routed families' ADAPTER paths never call, so at beta/prod with
// the flag on, `createITSMAdapter('zendesk', {credentials: {}})` returned a live
// adapter carrying an EMPTY Basic header aimed at a customer's ITSM.
//
// Both halves are pinned here: the clause in the gate, and the ITSM factory
// passing it for every vendor in the union — DERIVED from ITSMVendorSchema, so a
// ninth vendor added without a credential rule fails this proof instead of
// shipping ungated.
{
  const beta = { SIGNALGRID_TIER: "beta", SIGNALGRID_LIVE_INTEGRATIONS: "true" };
  for (const [label, value] of [["absent", undefined], ["empty", ""], ["whitespace-only", "   "]] as ReadonlyArray<readonly [string, string | undefined]>) {
    const r = resolveEmission({ ...beta }, { name: "Zendesk apiToken", value });
    check(`beta + flag true + ${label} credential → suppressed, never live`, r.mode === "suppressed");
    check(
      `beta + flag true + ${label} credential → the refusal NAMES the credential`,
      r.mode === "suppressed" && r.reason.includes("Zendesk apiToken"),
    );
  }
  check(
    "prod + flag true + a present credential → live (the clause is not a wall)",
    resolveEmission({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }, { name: "X", value: "tok" }).mode === "live",
  );
  check(
    "the credential clause is checked LAST — a dev tier still refuses on tier, not on the token",
    (() => {
      const r = resolveEmission({ SIGNALGRID_TIER: "dev" }, { name: "X", value: "tok" });
      return r.mode === "suppressed" && r.reason.includes("tier");
    })(),
  );

  // Per-vendor fixtures: everything a vendor needs EXCEPT the credential. Derived
  // membership is asserted below, so this table cannot fall behind the union.
  const VENDOR_FIXTURES: Record<string, { config: Record<string, unknown>; credential: Record<string, string> }> = {
    servicenow: { config: { instanceUrl: "https://acme.service-now.com" }, credential: { apiToken: "tok" } },
    jira: { config: { instanceUrl: "https://acme.atlassian.net", projectKey: "OPS" }, credential: { username: "a@b.test", apiToken: "tok" } },
    zendesk: { config: { subdomain: "acme" }, credential: { username: "a@b.test", apiToken: "tok" } },
    freshservice: { config: { subdomain: "acme" }, credential: { apiToken: "tok" } },
    "bmc-helix": { config: { instanceUrl: "https://acme.bmc.test" }, credential: { apiToken: "tok" } },
    ivanti: { config: { instanceUrl: "https://acme.ivanti.test" }, credential: { clientId: "cid", clientSecret: "sec" } },
    manageengine: { config: { instanceUrl: "https://acme.me.test" }, credential: { apiToken: "tok" } },
    generic_webhook: {
      config: { genericWebhook: { url: "https://hooks.example.test/x", method: "POST", bodyTemplate: '{"t":"{{title}}"}' } },
      credential: { signingSecret: "s".repeat(32) },
    },
  };

  const vendors = ITSMVendorSchema.options as readonly string[];
  check("derived: the ITSM vendor union is non-empty (assertion is not vacuous)", vendors.length >= 8);
  check(
    `derived: every vendor in ITSMVendorSchema has a fixture here (${vendors.length} in the union, ${Object.keys(VENDOR_FIXTURES).length} fixtures)`,
    vendors.every((v) => v in VENDOR_FIXTURES) && Object.keys(VENDOR_FIXTURES).every((k) => vendors.includes(k)),
  );

  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  process.env.SIGNALGRID_TIER = "beta";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
  try {
    for (const vendor of vendors) {
      const fx = VENDOR_FIXTURES[vendor];
      if (!fx) continue; // the membership check above already failed
      const base = { vendor, name: `${vendor} test`, enabled: true, lastTestResult: "not_tested", ...fx.config };
      // EMPTY credential: the whole point. beta tier, live flag on, every non-secret
      // field present — the ONLY thing missing is the token.
      const empty = createITSMAdapter(vendor as never, { ...base, credentials: {} } as never);
      check(`${vendor}: beta + flag true + EMPTY credential → no adapter is built`, empty === null);
      // NON-VACUITY: with the credential, the same config DOES build. Without this,
      // a factory that returned null for everything would satisfy the eight above.
      const armed = createITSMAdapter(vendor as never, { ...base, credentials: fx.credential } as never);
      check(`${vendor}: the same config WITH the credential builds an adapter (not always-null)`, armed !== null);
    }
  } finally {
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
  }
}

// ── 10. THE RESIDUAL HOLE: an OMITTED credential skipped the clause entirely ──
//
// Section 9 proves the clause and proves the ITSM FACTORY passes one. It could not
// see the hole one level down, because the parameter was OPTIONAL: 36 of the 37
// `resolveEmission(` call sites in lib/ omitted it, so on every path that does not
// go through createITSMAdapter — every vendor class constructed directly, every SIEM
// adapter, both telemetry adapters — the third condition was not checked at all.
//
// Reproduced before the fix, on the real classes, at prod + SIGNALGRID_LIVE_INTEGRATIONS=true:
//
//     new ZendeskAdapter({ instanceUrl, email: "", apiToken: "" }).createTicket(req)
//
// attempted a real POST to the configured host carrying `Authorization: Basic
// L3Rva2VuOg==` — the base64 of "/token:", an empty credential, inside a boundary
// three documents describe as closed.
//
// The fix is a TYPE change (credential is required; a family holding no secret says
// NO_CREDENTIAL out loud), and a type change is erased at runtime, so it is pinned
// here BEHAVIOURALLY: one vector per family, built straight from the class with an
// empty or whitespace credential, with `globalThis.fetch` replaced by a spy that
// records and throws. The assertion is that the spy is never called.
{
  const realFetch = globalThis.fetch;
  let attempts: string[] = [];
  const installSpy = (): void => {
    attempts = [];
    globalThis.fetch = ((input: unknown): never => {
      attempts.push(String(input));
      throw new Error("FETCH ATTEMPTED — an outbound call escaped the gate");
    }) as unknown as typeof globalThis.fetch;
  };

  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedMde = {
    tenant: process.env.MDE_TENANT_ID,
    client: process.env.MDE_CLIENT_ID,
    secret: process.env.MDE_CLIENT_SECRET,
  };
  const savedFleet = { base: process.env.FLEETDM_BASE_URL, token: process.env.FLEETDM_API_TOKEN };

  const ticket = {
    title: "gate vector",
    description: "must never leave the process",
    severity: "low" as const,
    category: "test",
  };
  const event: SIEMEventRequest = {
    type: "gate.vector",
    severity: "low",
    timestamp: "2026-09-02T00:00:00.000Z",
  };

  // Everything a vendor needs EXCEPT the secret. The empty string is the shape the
  // adapters actually shipped (`credentials.apiToken || ''`).
  const ITSM_VECTORS: Array<[string, () => Promise<unknown>]> = [
    ["zendesk", () => new ZendeskAdapter({ instanceUrl: "https://acme.zendesk.com", email: "agent@acme.test", apiToken: "" }).createTicket(ticket)],
    ["jira", () => new JiraAdapter({ baseUrl: "https://acme.atlassian.net", email: "agent@acme.test", apiToken: "", serviceDeskId: "1" }).createTicket(ticket)],
    ["servicenow", () => new ServiceNowAdapter({ instanceUrl: "https://acme.service-now.com", auth: { type: "api_token", apiToken: "" } }).createTicket(ticket)],
    ["freshservice", () => new FreshserviceAdapter({ instanceUrl: "https://acme.freshservice.com", apiKey: "" }).createTicket(ticket)],
    ["bmc-helix", () => new BMCHelixAdapter({ instanceUrl: "https://acme.bmc.test", auth: { type: "api_token", apiToken: "" } }).createTicket(ticket)],
    ["ivanti", () => new IvantiAdapter({ instanceUrl: "https://acme.ivanti.test", clientId: "cid", clientSecret: "" }).createTicket(ticket)],
    ["manageengine", () => new ManageEngineAdapter({ instanceUrl: "https://acme.me.test", technicianKey: "" }).createTicket(ticket)],
    ["generic_webhook", () => new GenericWebhookAdapter({ url: "https://hooks.example.test/x", method: "POST", headers: {}, bodyTemplate: '{"t":"{{title}}"}', signingSecret: "" }).createTicket(ticket)],
  ];

  try {
    process.env.SIGNALGRID_TIER = "prod";
    process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";

    // NON-VACUITY FIRST. If the spy could never fire, every assertion below would
    // pass over an adapter that simply does nothing. With the credential PRESENT the
    // same class at the same tier DOES reach for the network — the spy records the
    // URL and throws, which is how we know the vectors mean something.
    installSpy();
    try {
      await new ZendeskAdapter({ instanceUrl: "https://acme.zendesk.com", email: "agent@acme.test", apiToken: "tok" }).createTicket(ticket);
    } catch { /* the spy throws by design */ }
    check(
      "control: zendesk WITH a credential at prod+live does attempt a fetch (the spy can fire)",
      attempts.length === 1 && new URL(attempts[0]).hostname === "acme.zendesk.com",
    );

    for (const [label, run] of ITSM_VECTORS) {
      installSpy();
      let refused = false;
      try { await run(); } catch { refused = true; }
      check(`${label}: an EMPTY credential at prod+live refuses`, refused);
      check(`${label}: and no fetch was attempted — refused AT THE GATE`, attempts.length === 0);
    }

    // SIEM: these return a status rather than throwing, so both halves are asserted —
    // nothing sent, and the response says why (SIEMEventResponse.reason, section 11).
    const SIEM_VECTORS: Array<[string, () => Promise<SIEMEventResponse>, string]> = [
      ["siem/webhook", () => new WebhookSIEMAdapter({ url: "https://siem.example.test/hook", method: "POST", signingSecret: "" }).sendEvent(event), "SIEM webhook signingSecret"],
      ["siem/splunk", () => new SplunkAdapter({ hecUrl: "https://splunk.example.test", hecToken: "" }).sendEvent(event), "Splunk hecToken"],
      ["siem/sentinel", () => new SentinelAdapter({ workspaceId: "ws-1", primaryKey: "" }).sendEvent(event), "Sentinel primaryKey"],
    ];
    for (const [label, run, credentialName] of SIEM_VECTORS) {
      installSpy();
      const res = await run();
      check(`${label}: an EMPTY credential at prod+live → suppressed, not sent`, res.status === EMIT_SUPPRESSED);
      check(`${label}: and no fetch was attempted`, attempts.length === 0);
      check(`${label}: the response carries the reason, naming the credential`, (res.reason ?? "").includes(credentialName));
    }

    // sentinel's BATCH path, which was the one that used to POST while its singular
    // sibling was suppressed. Every element carries the reason.
    installSpy();
    const batch = await new SentinelAdapter({ workspaceId: "ws-1", primaryKey: "" }).sendEvents([event, event]);
    check("siem/sentinel sendEvents: N events in, N suppressed answers out", batch.length === 2 && batch.every((r) => r.status === EMIT_SUPPRESSED));
    check("siem/sentinel sendEvents: every answer carries the reason", batch.every((r) => (r.reason ?? "").includes("Sentinel primaryKey")));
    check("siem/sentinel sendEvents: no fetch was attempted", attempts.length === 0);

    // telemetry/mde — WHITESPACE-ONLY secret. `getConfig()` accepts it (it is truthy),
    // so before the fix isEnabled() was true at prod+live and getDevices() fetched a
    // token from login.microsoftonline.com. The gate's own `.trim()` now refuses it.
    process.env.MDE_TENANT_ID = "tenant";
    process.env.MDE_CLIENT_ID = "client";
    process.env.MDE_CLIENT_SECRET = "   ";
    const mde = new MDEAdapter();
    await mde.initialize();
    installSpy();
    const devices = await mde.getDevices();
    check("telemetry/mde: a whitespace-only clientSecret at prod+live → isEnabled() false", mde.isEnabled() === false);
    check("telemetry/mde: getDevices() returns nothing and attempts no fetch", devices.length === 0 && attempts.length === 0);

    // telemetry/fleetdm — same shape, driven through the real config store so the
    // adapter is ENABLED by the operator flag and refused by the credential alone.
    await setFleetDMConfig({ enabled: true, baseUrl: "https://fleet.example.test", apiToken: "", syncIntervalMs: 300000 });
    process.env.FLEETDM_BASE_URL = "https://fleet.example.test";
    process.env.FLEETDM_API_TOKEN = "   ";
    const fleet = new FleetDMAdapter();
    await fleet.initialize();
    installSpy();
    const hosts = await fleet.getHosts();
    check("telemetry/fleetdm: enabled=true with a whitespace apiToken at prod+live → isEnabled() false", fleet.isEnabled() === false);
    check("telemetry/fleetdm: getHosts() returns nothing and attempts no fetch", hosts.length === 0 && attempts.length === 0);
  } finally {
    globalThis.fetch = realFetch;
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
    for (const [k, v] of [["MDE_TENANT_ID", savedMde.tenant], ["MDE_CLIENT_ID", savedMde.client], ["MDE_CLIENT_SECRET", savedMde.secret], ["FLEETDM_BASE_URL", savedFleet.base], ["FLEETDM_API_TOKEN", savedFleet.token]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ── 11. NO_CREDENTIAL is a statement, not a bypass ──────────────────────────
//
// The sentinel exists so a family that genuinely holds no secret (syslog: a host and
// a port) can say so in source instead of leaving an argument off. Two properties
// must both hold, or it becomes the old hole with a name: it must CLEAR the third
// clause, and it must clear NOTHING ELSE.
{
  const beta = { SIGNALGRID_TIER: "beta", SIGNALGRID_LIVE_INTEGRATIONS: "true" };
  check("NO_CREDENTIAL at beta + flag true → live (it clears the credential clause)", resolveEmission(beta, NO_CREDENTIAL).mode === "live");
  check("NO_CREDENTIAL does NOT clear the tier clause", resolveEmission({ SIGNALGRID_TIER: "dev", SIGNALGRID_LIVE_INTEGRATIONS: "true" }, NO_CREDENTIAL).mode === "suppressed");
  check("NO_CREDENTIAL does NOT clear the live-flag clause", resolveEmission({ SIGNALGRID_TIER: "prod" }, NO_CREDENTIAL).mode === "suppressed");
  check("NO_CREDENTIAL is not a string an env value could impersonate", typeof NO_CREDENTIAL === "symbol");

  // syslog is the one family that passes it, and its suppressed response now carries
  // the reason — the field its own type documents as present on every non-sent status.
  const syslogSrc2 = readFileSync(resolve(repo, "lib/integrations/src/integrations/syslog/transport.ts"), "utf8");
  check("syslog states NO_CREDENTIAL rather than omitting the argument", /resolveEmission\(process\.env, NO_CREDENTIAL\)/.test(syslogSrc2));
}

// ── 12. A suppressed response SAYS WHY, on every family that returns one ────
//
// `SIEMEventResponse.reason` is documented as "present on every non-'sent' status
// that the adapter itself decided". It was set on none of the suppressed branches.
// Asserted at dev tier, where the refusal is the TIER rather than a credential — so
// this pins the field being populated from the resolution, not from one clause.
{
  const savedTier = process.env.SIGNALGRID_TIER;
  process.env.SIGNALGRID_TIER = "dev";
  delete process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const event: SIEMEventRequest = { type: "gate.vector", severity: "low", timestamp: "2026-09-02T00:00:00.000Z" };
  try {
    const responses: Array<[string, SIEMEventResponse]> = [
      ["siem/webhook", await new WebhookSIEMAdapter({ url: "https://siem.example.test/hook", method: "POST", signingSecret: "s" }).sendEvent(event)],
      ["siem/splunk", await new SplunkAdapter({ hecUrl: "https://splunk.example.test", hecToken: "tok" }).sendEvent(event)],
      ["siem/sentinel", await new SentinelAdapter({ workspaceId: "ws-1", primaryKey: "key" }).sendEvent(event)],
      ["syslog", await new SyslogAdapter({ host: "collector.example.test", protocol: "udp", format: "json" }).sendEvent(event)],
    ];
    for (const [label, res] of responses) {
      check(`${label}: dev tier → suppressed`, res.status === EMIT_SUPPRESSED);
      check(`${label}: the suppressed response states the reason`, (res.reason ?? "").includes("never emits to live systems"));
    }
  } finally {
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
  }
}


// ── 13. WHAT MAY LEAVE — the declared field set, asserted off the wire ───────
//
// Sections 1-12 answer ONE question: MAY anything be sent (tier, live flag,
// credential). The gate's own header says so out loud — "the vendor modules type
// their own payloads; the gate decides WHETHER anything may leave, not what it
// looks like." Nothing answered the second question, and the answer was worse than
// nobody had checked: `siem/webhook.ts` ran `JSON.stringify(event)` on the entire
// inbound SIEMEventRequest and POSTed it to a customer-configured URL, jira dumped
// the untrusted `rawEvent` map into a ticket description, and splunk / sentinel /
// syslog copied `actor`, `device`, `session`, `location`, `evidence` and
// `customFields` as whole objects. Every one of them would have carried a field
// added upstream tomorrow, with no edit at the boundary and nothing to review.
//
// (A fail-closed read on 2026-09-02 put the census at 27 construction sites and 17
// whole-object copies at 7 sites. That figure is THAT READ'S, cited and not
// re-measured here — nothing in this file holds it. What this file holds is the
// vector count printed in its own summary line and the per-vendor assertions below.)
//
// THE VECTOR. One request per vendor carrying a PLANTED key at every level — top
// level, inside `actor`, inside `rawEvent`, inside `customFields`, inside
// `evidence[].data`. The assertion is that the emitted key set is a subset of the
// set declared in `adapters/payload-fields.ts`, and that the planted key surfaces
// ONLY where an open slot declares it may. The failure NAMES THE KEY, because "a
// check failed" does not tell the next person what crossed.
//
// NON-VACUITY IS ASSERTED, NOT ASSUMED. A planted key that never reached the
// builder would satisfy every subset assertion for the wrong reason, so each vector
// also asserts that the OPEN-SLOT plant DOES cross. Both directions, every vector.
//
// These run at prod + SIGNALGRID_LIVE_INTEGRATIONS=true with the spy installed
// exactly as the non-vacuity control in section 10 does — the fetch must be
// ATTEMPTED for there to be a body to read. The spy throws before any socket
// opens; nothing leaves this process.
{
  const realFetch = globalThis.fetch;
  let captured: Array<{ url: string; body: string }> = [];
  const installBodySpy = (): void => {
    captured = [];
    globalThis.fetch = ((input: unknown, init?: { body?: unknown }): never => {
      const body = init?.body;
      captured.push({
        url: String(input),
        body: typeof body === "string" ? body : body === undefined ? "" : String(body),
      });
      throw new Error("FETCH ATTEMPTED — the spy records the body and stops here; no socket opens");
    }) as unknown as typeof globalThis.fetch;
  };

  const PLANT = {
    top: "__planted_top__",
    actor: "__planted_actor__",
    raw: "__planted_raw__",
    custom: "__planted_custom__",
    evidence: "__planted_evidence__",
  };

  // Obviously synthetic throughout: example.test hosts, RFC 5737 documentation IPs,
  // no tenant ids, no real identifiers.
  const plantedEvent = {
    type: "payload.vector",
    severity: "low",
    timestamp: "2026-09-02T00:00:00.000Z",
    caseId: "case-synthetic-1",
    requestId: "req-synthetic-1",
    correlationId: "corr-synthetic-1",
    actor: {
      userId: "user-synthetic-1",
      badgeUid: "badge-synthetic-1",
      email: "worker@example.test",
      name: "Synthetic Worker",
      [PLANT.actor]: "must-not-cross",
    },
    device: { deviceId: "device-synthetic-1", platform: "ios", ip: "203.0.113.5", mac: "00:00:5e:00:53:01", tags: ["synthetic"] },
    session: { sessionId: "session-synthetic-1", startedAt: "2026-09-02T00:00:00.000Z", endedAt: "2026-09-02T00:05:00.000Z", duration: 300 },
    location: { zone: "zone-synthetic", building: "building-synthetic", floor: "3", coordinates: { lat: 0, lng: 0 } },
    evidence: [{ type: "synthetic", timestamp: "2026-09-02T00:00:00.000Z", data: { [PLANT.evidence]: "declared open slot" } }],
    customFields: { [PLANT.custom]: "declared open slot" },
    [PLANT.top]: "must-not-cross",
  } as unknown as SIEMEventRequest;

  const plantedTicket = {
    title: "payload vector",
    description: "must never carry an undeclared field",
    severity: "low" as const,
    category: "synthetic",
    source: "proof",
    correlationId: "corr-synthetic-1",
    userId: "user-synthetic-1",
    userEmail: "worker@example.test",
    userName: "Synthetic Worker",
    deviceId: "device-synthetic-1",
    deviceName: "device-synthetic",
    devicePlatform: "ios",
    links: { dashboard: "https://console.example.test/d" },
    rawEvent: { [PLANT.raw]: "untrusted vendor passthrough" },
    [PLANT.top]: "must-not-cross",
  } as unknown as ITSMTicketRequest;

  const CUSTOM_KEYS = new Set(Object.keys((plantedEvent as { customFields?: Record<string, unknown> }).customFields ?? {}));

  /** Resolve payload-fields.ts's `bodyPath` against a parsed body. */
  const atPath = (body: unknown, path: string): unknown => {
    if (path === "") return body;
    if (Array.isArray(body)) return body[Number(path)];
    return (body as Record<string, unknown>)[path];
  };

  /**
   * The assertion, for one builder. Three claims, and the first two NAME THE KEY:
   *   · the emitted top-level key set is a subset of the declared closed set (plus
   *     any declared open slot, plus — for sentinel alone — the flattened slot);
   *   · no planted key crosses anywhere in the body except through an open slot;
   *   · NON-VACUITY: the open-slot plant DOES cross, so the vector reached here.
   */
  const assertDeclared = (
    label: string,
    moduleName: string,
    builderName: string,
    emitted: unknown,
    opts: { openPlant?: string; flattenedAllowed?: Set<string> } = {},
  ): void => {
    const decl = builderFor(moduleName, builderName);
    if (!decl || typeof emitted !== "object" || emitted === null) {
      check(`${label}: a declared builder and an object to check it against`, false);
      return;
    }
    const { closed, flattened } = permittedTopLevel(decl);
    const openSlots = new Set(decl.open.map((o) => o.slot));
    const allowFlat = opts.flattenedAllowed ?? new Set<string>();
    const keys = Object.keys(emitted as Record<string, unknown>);
    const unexpected = keys.filter(
      (k) => !closed.has(k) && !openSlots.has(k) && !(flattened && allowFlat.has(k)),
    );
    check(
      `${label}: emitted top-level keys ⊆ declared — unexpected: ${unexpected.length > 0 ? unexpected.join(", ") : "none"}`,
      unexpected.length === 0,
    );

    const serialized = JSON.stringify(emitted);
    for (const [where, key] of [["top level", PLANT.top], ["actor", PLANT.actor], ["rawEvent", PLANT.raw]] as const) {
      if (opts.openPlant === key) continue;
      check(`${label}: the key planted at ${where} (${key}) does NOT appear anywhere in the body`, !serialized.includes(key));
    }
    if (opts.openPlant) {
      check(
        `${label}: NON-VACUITY — the DECLARED OPEN SLOT plant (${opts.openPlant}) does cross, so this vector reached the builder`,
        serialized.includes(opts.openPlant),
      );
    }
  };

  /** Nested typed sub-objects: actor/device/session/location must carry exactly the
   *  fields adapters/types.ts declares — no more. This is the half a top-level key
   *  check cannot see, and it is where four of the seventeen copies lived. */
  const assertNested = (label: string, container: unknown): void => {
    if (typeof container !== "object" || container === null) {
      check(`${label}: nested sub-objects are readable`, false);
      return;
    }
    const obj = container as Record<string, unknown>;
    for (const name of ["actor", "device", "session", "location"]) {
      const sub = obj[name];
      if (typeof sub !== "object" || sub === null) continue;
      const allowed = new Set(SIEM_TYPED_SUBOBJECTS[name] ?? []);
      const extra = Object.keys(sub as Record<string, unknown>).filter((k) => !allowed.has(k));
      check(
        `${label}.${name}: keys ⊆ the declared typed shape — unexpected: ${extra.length > 0 ? extra.join(", ") : "none"}`,
        extra.length === 0,
      );
    }
  };

  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedMde = { tenant: process.env.MDE_TENANT_ID, client: process.env.MDE_CLIENT_ID, secret: process.env.MDE_CLIENT_SECRET };
  const savedFleetEnv = { base: process.env.FLEETDM_BASE_URL, token: process.env.FLEETDM_API_TOKEN, allow: process.env.SIGNALGRID_ALLOW_LIVE_QUERY };

  /** Drive one adapter with the spy installed and hand back the parsed body. */
  const bodyOf = async (run: () => Promise<unknown>): Promise<unknown> => {
    installBodySpy();
    try { await run(); } catch { /* the spy throws by design */ }
    if (captured.length === 0) return undefined;
    try { return JSON.parse(captured[0].body); } catch { return captured[0].body; }
  };

  try {
    process.env.SIGNALGRID_TIER = "prod";
    process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";

    // ── siem ────────────────────────────────────────────────────────────────
    {
      const body = await bodyOf(() =>
        new SplunkAdapter({ hecUrl: "https://splunk.example.test", hecToken: "tok" }).sendEvent(plantedEvent),
      );
      check("siem/splunk: the spy captured a body (the vector reached the wire)", body !== undefined);
      assertDeclared("siem/splunk", "siem/splunk.ts", "SplunkAdapter.buildEventPayload", atPath(body, ""));
      assertDeclared("siem/splunk#event", "siem/splunk.ts", "SplunkAdapter.buildEventPayload#event", atPath(body, "event"), {
        openPlant: PLANT.custom,
      });
      assertNested("siem/splunk#event", atPath(body, "event"));
    }
    {
      const body = await bodyOf(() =>
        new SentinelAdapter({ workspaceId: "ws-synthetic", primaryKey: "key" }).sendEvent(plantedEvent),
      );
      check("siem/sentinel: the spy captured a body", body !== undefined);
      assertDeclared("siem/sentinel", "siem/sentinel.ts", "SentinelAdapter.buildEventPayload", atPath(body, "0"), {
        openPlant: PLANT.custom,
        flattenedAllowed: CUSTOM_KEYS,
      });
    }
    // SENTINEL'S WRITE ORDER — the flattened open slot must never occupy a
    // sanctioned column. Sentinel is the one family that MERGES customFields into
    // the payload's top level, and the merge used to be the last write before
    // `return`, so a caller key named `ActorEmail` or `TimeGenerated` overwrote the
    // column SignalGrid derived: a row in a customer's SIEM asserting an actor and
    // an instant this fabric never observed. Nothing stated the direction — the only
    // ordering sentence in the tree was generic-webhook's, documenting the opposite.
    // Driven with a hostile customFields map, asserting the SANCTIONED value arrives.
    {
      const hostile = {
        ...(plantedEvent as unknown as Record<string, unknown>),
        customFields: {
          ActorEmail: "attacker@example.test",
          TimeGenerated: "1970-01-01T00:00:00Z",
          Evidence: "[]",
          [PLANT.custom]: "declared open slot",
        },
      } as unknown as SIEMEventRequest;
      const body = await bodyOf(() =>
        new SentinelAdapter({ workspaceId: "ws-synthetic", primaryKey: "key" }).sendEvent(hostile),
      );
      const row = atPath(body, "0") as Record<string, unknown> | undefined;
      check(
        `siem/sentinel write order: a customFields key named ActorEmail does NOT occupy the sanctioned column (got "${String(row?.ActorEmail)}")`,
        row?.ActorEmail === "worker@example.test",
      );
      check(
        `siem/sentinel write order: a customFields key named TimeGenerated does NOT occupy the sanctioned column (got "${String(row?.TimeGenerated)}")`,
        row?.TimeGenerated === "2026-09-02T00:00:00.000Z",
      );
      check(
        "siem/sentinel write order: a customFields key named Evidence does NOT occupy the sanctioned column",
        typeof row?.Evidence === "string" && (row.Evidence as string).includes("synthetic"),
      );
      check(
        `siem/sentinel write order: NON-VACUITY — a customFields key that collides with NOTHING still arrives (${PLANT.custom})`,
        row !== undefined && Object.prototype.hasOwnProperty.call(row, PLANT.custom),
      );
    }
    {
      const body = await bodyOf(() =>
        new WebhookSIEMAdapter({ url: "https://siem.example.test/hook", method: "POST", signingSecret: "s".repeat(32) }).sendEvent(plantedEvent),
      );
      check("siem/webhook: the spy captured a body", body !== undefined);
      assertDeclared("siem/webhook", "siem/webhook.ts", "WebhookSIEMAdapter.buildEventPayload", atPath(body, ""), {
        openPlant: PLANT.custom,
      });
      assertNested("siem/webhook", atPath(body, ""));
    }

    // ── itsm, off the wire ──────────────────────────────────────────────────
    const ITSM_WIRE: Array<[string, string, string, string, () => Promise<unknown>]> = [
      ["itsm/zendesk", "itsm/zendesk.ts", "ZendeskAdapter.buildTicketPayload", "ticket",
        () => new ZendeskAdapter({ instanceUrl: "https://acme.zendesk.example.test", email: "agent@example.test", apiToken: "tok" }).createTicket(plantedTicket)],
      ["itsm/jira (JSM)", "itsm/jira.ts", "JiraAdapter.createJSMRequest", "",
        () => new JiraAdapter({ baseUrl: "https://acme.atlassian.example.test", email: "agent@example.test", apiToken: "tok", serviceDeskId: "1", requestTypeId: "2", useJSM: true } as never).createTicket(plantedTicket)],
      ["itsm/jira (issue)", "itsm/jira.ts", "JiraAdapter.createJiraIssue", "",
        () => new JiraAdapter({ baseUrl: "https://acme.atlassian.example.test", email: "agent@example.test", apiToken: "tok", projectKey: "SG", useJSM: false } as never).createTicket(plantedTicket)],
      ["itsm/servicenow", "itsm/servicenow.ts", "ServiceNowAdapter.buildIncidentPayload", "",
        () => new ServiceNowAdapter({ instanceUrl: "https://acme.service-now.example.test", auth: { type: "api_token", apiToken: "tok" } }).createTicket(plantedTicket)],
      ["itsm/freshservice", "itsm/freshservice.ts", "FreshserviceAdapter.buildTicketPayload", "",
        () => new FreshserviceAdapter({ instanceUrl: "https://acme.freshservice.example.test", apiKey: "key" }).createTicket(plantedTicket)],
      ["itsm/bmc-helix", "itsm/bmc-helix.ts", "BMCHelixAdapter.buildIncidentPayload", "",
        () => new BMCHelixAdapter({ instanceUrl: "https://acme.bmc.example.test", auth: { type: "api_token", apiToken: "tok" } }).createTicket(plantedTicket)],
      ["itsm/manageengine", "itsm/manageengine.ts", "ManageEngineAdapter.buildWorkOrderPayload", "",
        () => new ManageEngineAdapter({ instanceUrl: "https://acme.me.example.test", technicianKey: "key" }).createTicket(plantedTicket)],
    ];
    for (const [label, moduleName, builderName, path, run] of ITSM_WIRE) {
      const body = await bodyOf(run);
      check(`${label}: the spy captured a body (the vector reached the wire)`, body !== undefined);
      assertDeclared(label, moduleName, builderName, atPath(body, path));
      // rawEvent is the plant this family had a live leak for: jira printed the whole
      // map into the ticket DESCRIPTION, which is a string, so the subset check above
      // could never have seen it. Search the raw body text.
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      check(`${label}: the untrusted rawEvent plant (${PLANT.raw}) is nowhere in the body, description included`, !raw.includes(PLANT.raw));
    }

    // ── itsm/generic-webhook — the family's ONE declared open slot ───────────
    //
    // Asserted differently on purpose. The body here is the OPERATOR's own
    // bodyTemplate after substitution, so what crosses is decided by the template,
    // not by the caller's rawEvent. Both directions:
    {
      const closedTemplate = '{"title":"{{title}}","user":"{{userEmail}}"}';
      const body = await bodyOf(() =>
        new GenericWebhookAdapter({ url: "https://hooks.example.test/x", method: "POST", headers: {}, bodyTemplate: closedTemplate, signingSecret: "s".repeat(32) }).createTicket(plantedTicket),
      );
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      check("itsm/generic-webhook: a template naming only sanctioned variables carries NO planted key", !raw.includes(PLANT.raw) && !raw.includes(PLANT.top));
      const ctx = buildTemplateContext(plantedTicket, "req-synthetic-1", "2026-09-02T00:00:00.000Z") as Record<string, unknown>;
      check(
        `itsm/generic-webhook: NON-VACUITY — the template CONTEXT does carry the rawEvent plant (${PLANT.raw}), which is why it is a declared open slot and not a silent copy`,
        Object.prototype.hasOwnProperty.call(ctx, PLANT.raw),
      );
      const decl = builderFor("itsm/generic-webhook.ts", "buildTemplateContext");
      const sanctioned = new Set(decl?.closed ?? []);
      const fromRaw = Object.keys(ctx).filter((k) => !sanctioned.has(k));
      check(
        `itsm/generic-webhook: every context key outside the declared closed set came from the open slot — found: ${fromRaw.join(", ") || "none"}`,
        fromRaw.length > 0 && fromRaw.every((k) => Object.prototype.hasOwnProperty.call(plantedTicket.rawEvent ?? {}, k)),
      );
    }

    // ── syslog — no socket, by design, so the FORMATTER is the wire ──────────
    //
    // `sendEvent` formats and then throws on the live path (there is no transport in
    // this repository and it refuses to pretend otherwise), so there is no body to
    // capture. The formatter's own output is what a transport would carry, and it is
    // read here through an explicit cast rather than by widening the class's public
    // surface to make a proof convenient.
    {
      const syslog = new SyslogAdapter({ host: "collector.example.test", protocol: "udp", format: "json" });
      const formatted = (syslog as unknown as { formatJSON(e: SIEMEventRequest): string }).formatJSON(plantedEvent);
      const parsed = JSON.parse(formatted) as Record<string, unknown>;
      assertDeclared("syslog/json", "syslog/transport.ts", "SyslogAdapter.formatJSON", parsed, { openPlant: PLANT.custom });
      assertNested("syslog/json", parsed);
    }

    // ── itsm/ivanti — the OAuth token request precedes the incident ──────────
    //
    // Ivanti always fetches a token first, so the spy's first body is the token
    // request, not the payload. Asserted off the builder for that reason, and the
    // reason is stated rather than left as an unexplained difference.
    {
      const ivanti = new IvantiAdapter({ instanceUrl: "https://acme.ivanti.example.test", clientId: "cid", clientSecret: "secret" });
      const incident = (ivanti as unknown as { buildIncidentPayload(r: ITSMTicketRequest): Record<string, unknown> }).buildIncidentPayload(plantedTicket);
      assertDeclared("itsm/ivanti", "itsm/ivanti.ts", "IvantiAdapter.buildIncidentPayload", incident);
      check(`itsm/ivanti: the rawEvent plant (${PLANT.raw}) is nowhere in the incident`, !JSON.stringify(incident).includes(PLANT.raw));
    }

    // ── webhooks ────────────────────────────────────────────────────────────
    {
      const hook = await createWebhook({
        name: "payload-vector",
        url: "https://hooks.example.test/wh",
        events: ["session.start"],
        secret: "s".repeat(48),
      });
      process.env[`WEBHOOK_SECRET_${hook.id.slice(0, 8)}`] = "s".repeat(48);
      const oneAttempt = { ...DEFAULT_DISPATCHER_CONFIG, retry: { ...DEFAULT_DISPATCHER_CONFIG.retry, maxAttempts: 1 } };
      installBodySpy();
      // Wrapped, so a REFUSAL to build the envelope reports as a failed assertion
      // naming what happened rather than as an uncaught stack. buildPayload now
      // `.strict()`-parses, so an undeclared key throws here — which is the intended
      // behaviour, and it must still be legible when it fires.
      let buildRefusal: string | null = null;
      try {
        await dispatchEvent("session.start", { [PLANT.custom]: "declared open slot", probe: true }, oneAttempt);
      } catch (e) {
        buildRefusal = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 160);
      }
      check(
        `webhooks/dispatch: the envelope built without refusal (${buildRefusal ?? "no refusal"})`,
        buildRefusal === null,
      );
      const body = captured.length > 0 ? JSON.parse(captured[0].body) : undefined;
      check("webhooks/dispatch: the spy captured a body", body !== undefined);
      assertDeclared("webhooks/dispatch", "webhooks/dispatch.ts", "buildPayload", body, { openPlant: PLANT.custom });
      const data = (body as { data?: Record<string, unknown> } | undefined)?.data ?? {};
      check(
        `webhooks/dispatch: the planted key appears ONLY under the declared open slot \`data\` (found there: ${Object.prototype.hasOwnProperty.call(data, PLANT.custom)})`,
        Object.prototype.hasOwnProperty.call(data, PLANT.custom),
      );

      // THE ENVELOPE REFUSAL IS RECORDED, NOT THROWN AWAY. `buildPayload` parses
      // through a `.strict()` schema, and an uncaught throw there left the worst
      // trace available: zero delivery rows, no summary, and an exception surfacing
      // in whatever raised the event — a refusal nobody can see, which this file has
      // already fixed twice under other names. Driven through the one
      // caller-reachable rejection (`data` that is not an object).
      //
      // THE REASON IS ASSERTED, NOT `success === false`: a failed delivery is equally
      // consistent with a network error, a 500, and a missing secret, and an
      // assertion that cannot tell those apart is not holding this behaviour.
      //
      // CAUGHT, NOT LET FLY. The behaviour under test is precisely "does this throw
      // out of dispatchEvent" — so the call is wrapped here too. Without the wrap
      // the falsification (delete the try/catch in dispatch.ts) ends the proof with
      // an unhandled ZodError at check 194 and the remaining hundred-odd assertions
      // never run: a crash, not a named failure, and a crash tells a reader which
      // file broke but not which PROPERTY did.
      const before = (await getDeliveryLogs(hook.id)).length;
      let refusedSummary: Awaited<ReturnType<typeof dispatchEvent>> | undefined;
      let refusalThrew: string | undefined;
      try {
        refusedSummary = await dispatchEvent("session.start", "not-an-object" as never, oneAttempt);
      } catch (error) {
        refusalThrew = error instanceof Error ? error.constructor.name : String(error);
      }
      check(
        `webhooks/dispatch: an unbuildable envelope does NOT throw out of dispatchEvent (threw: ${refusalThrew ?? "no"})`,
        refusalThrew === undefined,
      );
      check(
        `webhooks/dispatch: an unbuildable envelope still returns a summary (dispatched=${refusedSummary?.dispatched}, failed=${refusedSummary?.failed})`,
        refusedSummary !== undefined &&
          refusedSummary.dispatched === 1 &&
          refusedSummary.failed === 1 &&
          refusedSummary.succeeded === 0,
      );
      const logs = await getDeliveryLogs(hook.id);
      const refusalRow = logs.find((l) => (l.error ?? "").startsWith(WEBHOOK_ENVELOPE_INVALID));
      check(
        `webhooks/dispatch: one delivery row per subscribed webhook records the refusal (rows ${before} → ${logs.length})`,
        logs.length === before + 1,
      );
      check(
        "webhooks/dispatch: and the row names the REASON — the schema refusal, not a bare failure",
        refusalRow !== undefined && refusalRow.status === "failed" && (refusalRow.error ?? "").includes("WebhookPayloadSchema"),
      );

      delete process.env[`WEBHOOK_SECRET_${hook.id.slice(0, 8)}`];
    }

    // ── telemetry/mde — an OAuth token body, no caller-controlled map ────────
    {
      process.env.MDE_TENANT_ID = "tenant-synthetic";
      process.env.MDE_CLIENT_ID = "client-synthetic";
      process.env.MDE_CLIENT_SECRET = "secret-synthetic";
      const mde = new MDEAdapter();
      await mde.initialize();
      installBodySpy();
      try { await mde.getDevices(); } catch { /* the spy throws by design */ }
      const decl = builderFor("telemetry/mde.ts", "MDEAdapter.getAccessToken");
      const sent = new Set([...new URLSearchParams(captured[0]?.body ?? "").keys()]);
      const unexpected = [...sent].filter((k) => !(decl?.closed ?? []).includes(k));
      check("telemetry/mde: the spy captured the token request body", captured.length > 0 && sent.size > 0);
      check(
        `telemetry/mde: token-request keys ⊆ declared — unexpected: ${unexpected.length > 0 ? unexpected.join(", ") : "none"}`,
        unexpected.length === 0,
      );
      // REPORTED, not gated: there is no caller-supplied map on this path, so there
      // is nothing to plant. Saying so is the honest form of "this vector is weaker".
      console.log("  — telemetry/mde carries no caller-controlled map, so no key could be planted (reported, not gated)");
    }

    // ── telemetry/fleetdm — the live-query body, the other telemetry write ───
    //
    // Driven through the real approval chain (tier + operator flag + the separate
    // SIGNALGRID_ALLOW_LIVE_QUERY approval + a non-empty host list), because a
    // vector that skipped those would be asserting about a call this repository
    // does not permit.
    {
      await setFleetDMConfig({ enabled: true, baseUrl: "https://fleet.example.test", apiToken: "token-synthetic", syncIntervalMs: 300000 });
      process.env.FLEETDM_BASE_URL = "https://fleet.example.test";
      process.env.FLEETDM_API_TOKEN = "token-synthetic";
      process.env.SIGNALGRID_ALLOW_LIVE_QUERY = "true";
      const fleet = new FleetDMAdapter();
      await fleet.initialize();
      installBodySpy();
      try { await fleet.runQuery("select 1 as synthetic;", [1]); } catch { /* the spy throws by design */ }
      const body = captured.length > 0 ? JSON.parse(captured[0].body) : undefined;
      check("telemetry/fleetdm: the spy captured the live-query body", body !== undefined);
      assertDeclared("telemetry/fleetdm", "telemetry/fleetdm.ts", "FleetDMAdapter.runLiveQuery", body);
      console.log("  — telemetry/fleetdm carries no caller-controlled map either: the body is the caller's SQL and an explicit host list (reported, not gated)");
    }

    // ── caep-events — closed by construction, declared for completeness ──────
    {
      const result = buildCaepClaims({
        issuer: "https://issuer.example.test",
        audience: "https://relying-party.example.test",
        jti: "decision-synthetic-1",
        issuedAt: "2026-09-02T00:00:00.000Z",
        subjectPseudonym: "pseudonym-synthetic-1",
        eventKind: "session_revoked",
        occurredAt: "2026-09-02T00:00:00.000Z",
        reasonCodes: ["SYNTHETIC_REASON"],
        [PLANT.top]: "must-not-cross",
      } as never);
      check("caep-events: the planted vector still builds a claims set", result.claims !== null);
      assertDeclared("caep-events", "caep-events/format.ts", "buildCaepClaims", result.claims);
    }
  } finally {
    globalThis.fetch = realFetch;
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
    for (const [k, v] of [
      ["MDE_TENANT_ID", savedMde.tenant],
      ["MDE_CLIENT_ID", savedMde.client],
      ["MDE_CLIENT_SECRET", savedMde.secret],
      ["FLEETDM_BASE_URL", savedFleetEnv.base],
      ["FLEETDM_API_TOKEN", savedFleetEnv.token],
      ["SIGNALGRID_ALLOW_LIVE_QUERY", savedFleetEnv.allow],
    ] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ── 14. The declaration itself must not fossilise ────────────────────────────
//
// Section 13 is only as good as `adapters/payload-fields.ts`. Two ways it could
// quietly stop meaning anything: a family appearing in the tree that it never
// heard of, and a builder count that drifts to zero without failing. Both are the
// same shape as the hand-written list section 5's comment apologises for.
{
  check(
    `payload-fields declares every DERIVED emitter family (declared: ${[...DECLARED_FAMILIES].sort().join(", ")})`,
    DERIVED_EMITTER_FAMILIES.every((f) => DECLARED_FAMILIES.includes(f)) &&
      DECLARED_FAMILIES.every((f) => DERIVED_EMITTER_FAMILIES.includes(f)),
  );
  // A FLOOR, AND ONLY A FLOOR — labelled as one because it was read as more.
  // `>= 18` is satisfied by any declaration with 18 entries, including one that has
  // stopped describing the tree: a reviewer added an entire undeclared vendor module
  // and this assertion, the gate, and every vector above all stayed green. The
  // question it actually answers is "has the declaration been emptied", which is
  // worth asking and is not completeness. Completeness — every scanned outbound
  // module declares a builder, and every builder-shaped function in a declared module
  // is declared — is rules 6 and 7 of scripts/check-emit-payload-discipline.mjs,
  // which can see the tree; this file only sees what was imported.
  check(
    `payload-fields is not empty — a FLOOR, not completeness (found ${OUTBOUND_BUILDERS.length} builders; rules 6-7 of the lexical gate hold the correspondence)`,
    OUTBOUND_BUILDERS.length >= 28,
  );
  check(
    "every declared builder names a closed set and every open slot states why",
    OUTBOUND_BUILDERS.every((b) => b.closed.length > 0 && b.open.every((o) => o.why.trim().length > 20)),
  );
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound emitters are gated: dev/alpha never send, every refusal explains itself.");
