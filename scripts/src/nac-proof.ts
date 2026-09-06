// NAC dimension proof — OFFLINE and deterministic.
//
// `nac/` was the one family the connector-discipline gate flagged as breaking a
// WRITTEN rule: it POSTed to the Cisco ISE ANC API and to ClearPass to quarantine an
// endpoint, ungated and unproven. This is the proof that was missing.
//
// Asserted, in order of how much each matters:
//   1. THE LIVE-CALL GATE refuses unless every condition holds, each gate isolated so
//      a control on any one of them fires.
//   2. IDENTIFIER VALIDATION — the reads interpolated caller-supplied strings into
//      vendor query filters. An injection attempt must be REFUSED, not escaped.
//   3. NO UNEARNED STATUS — ISE endpoint search does not report auth state, so it must
//      not claim one.
//   4. NO NETWORK I/O in the family, so a quarantine actuator cannot return.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearPassStatus,
  lookupNacFixture,
  nacFilterFor,
  normalizeClearPassEndpoint,
  normalizeIseEndpoint,
  normalizeNacEndpoint,
  resolveNacConnector,
  validateNacIdentifier,
  NAC_FIXTURES,
  getNACConfig,
  setNACConfig,
  __resetNacConfigForTests,
} from "@workspace/integrations/nac";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("NAC dimension proof — read-only, gated, deterministic\n");

// ── 1. The live-call gate, each condition ISOLATED ───────────────────────────
const T = { readEndpoint: async () => ({}) };
check("default env (dev tier) refuses live", resolveNacConnector({}, T).mode === "fixture");
check("ISOLATED: tier alone blocks live",
  resolveNacConnector({ SIGNALGRID_TIER: "dev", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_VENDOR: "ise", NAC_ACCESS_TOKEN: "t" }, T).mode === "fixture");
check("ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live",
  resolveNacConnector({ SIGNALGRID_TIER: "prod", NAC_VENDOR: "ise", NAC_ACCESS_TOKEN: "t" }, T).mode === "fixture");
check("ISOLATED: an unrecognised vendor alone blocks live",
  resolveNacConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_VENDOR: "nope", NAC_ACCESS_TOKEN: "t" }, T).mode === "fixture");
check("ISOLATED: a missing credential alone blocks live",
  resolveNacConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_VENDOR: "ise" }, T).mode === "fixture");
check("no transport refuses even with every gate satisfied — this repo ships none",
  resolveNacConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_VENDOR: "ise", NAC_ACCESS_TOKEN: "t" }).mode === "fixture");
// Non-vacuity: the live branch must be reachable or every refusal above is trivial.
check("...and the live branch IS reachable when a transport is injected",
  resolveNacConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_VENDOR: "ise", NAC_ACCESS_TOKEN: "t" }, T).mode === "live");

// ── 2. Identifier validation — the filter-injection surface ──────────────────
//
// Both vendors built `MacAddress eq '${identifier}'` / `mac_address='${identifier}'`
// from unvalidated input. These assert the hostile shapes are REFUSED, and — crucially
// — that the refusal reaches the FILTER BUILDER, not just the validator. A validator
// nobody calls is decoration.
const HOSTILE = [
  "aa:bb:cc:dd:ee:ff' or '1'='1",
  "aa:bb:cc:dd:ee:ff'; DROP",
  "' or MacAddress ne ''",
  "aa:bb:cc:dd:ee:ff\u0000",   // NUL truncation vector, ESCAPED so this file stays TEXT
  "../../etc/passwd",
  "a".repeat(300),
  "",
  "   ",
];
check("every hostile identifier is refused by the validator",
  HOSTILE.every((h) => validateNacIdentifier(h, "mac").ok === false));
check("...and the ISE filter builder returns null for each — no filter is emitted",
  HOSTILE.every((h) => nacFilterFor("ise", h, "mac") === null));
check("...and the ClearPass filter builder returns null for each",
  HOSTILE.every((h) => nacFilterFor("clearpass", h, "mac") === null));
check("a non-string identifier is refused, not coerced",
  [null, undefined, 42, {}, []].every((v) => validateNacIdentifier(v, "mac").ok === false));
// Non-vacuity: a legitimate identifier must still work, in all three forms.
check("legitimate MACs still validate and normalize (colon / hyphen / bare)",
  ["AA:BB:CC:DD:EE:01", "aa-bb-cc-dd-ee-01", "AABBCCDDEE01"].every(
    (m) => validateNacIdentifier(m, "mac").ok &&
      (validateNacIdentifier(m, "mac") as { normalized: string }).normalized === "aa:bb:cc:dd:ee:01"));
check("...and a built filter contains the NORMALIZED value, never the raw input",
  nacFilterFor("ise", "AA-BB-CC-DD-EE-01", "mac") === "MacAddress eq 'aa:bb:cc:dd:ee:01'");
check("a refused identifier never reaches a fixture lookup either",
  HOSTILE.every((h) => lookupNacFixture(h, "mac") === null));
// SURROUNDING WHITESPACE IS NOT AN ATTACK, and asserting that it is was a mistake.
// An earlier version of this proof listed a trailing space and a trailing newline under
// HOSTILE and duly failed: `validateNacIdentifier` trims first, so both normalise to a
// well-formed MAC. The test was over-claiming, not the validator under-performing —
// padded values are ordinary in vendor payloads and operator input, and refusing them
// would be a bug. Filed as the benign-normalisation case it actually is.
check("surrounding whitespace is trimmed, not treated as an attack",
  ["  aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:01  ", "\taa:bb:cc:dd:ee:01\t"].every(
    (m) => validateNacIdentifier(m, "mac").ok &&
      (validateNacIdentifier(m, "mac") as { normalized: string }).normalized === "aa:bb:cc:dd:ee:01"));
check("...and a filter built from a padded input carries the TRIMMED value",
  nacFilterFor("ise", "  aa:bb:cc:dd:ee:01  ", "mac") === "MacAddress eq 'aa:bb:cc:dd:ee:01'");

check("serial and cert kinds validate independently",
  validateNacIdentifier("SN-12345_ab", "serial").ok && validateNacIdentifier("de:ad:be:ef", "cert").ok);

// ── 3. No unearned status ────────────────────────────────────────────────────
check("ISE endpoint search does NOT claim an auth state it cannot read",
  normalizeIseEndpoint({ SearchResult: { resources: [{ id: "1", name: "n" }] } })?.status === "unknown");
check("an empty ISE result is null (no such endpoint), not a fabricated record",
  normalizeIseEndpoint({ SearchResult: { resources: [] } }) === null);

// ── IDENTITY COMES FROM THE RESPONSE ─────────────────────────────────────────
//
// THESE ASSERTIONS DID NOT EXIST until an audit went looking for them. The fabrication
// defect in `normalizeIseEndpoint` — writing the CALLER'S query into the record's
// identity fields, so it reported "ISE says this endpoint's MAC is X" when ISE had said
// no such thing — was found by review, fixed, and then covered by nothing. Reverting
// the fix would have left `proof:nac` passing at exactly the same count. A fix whose
// proof cannot tell whether it is present is a green gate over an unchecked claim,
// which is the failure mode this whole PR is about.
//
// The parameters are now gone from the signature, so the echo is unrepresentable rather
// than merely untested. What remains testable — and is tested here — is that the fields
// are genuinely READ from the payload, which is the non-vacuity half: a normalizer that
// returned `undefined` for every identity field would also never fabricate, and would
// also be useless.
check("ISE reads macAddress FROM THE RESPONSE, not from the caller's query",
  normalizeIseEndpoint({ SearchResult: { resources: [{ id: "1", mac: "de:ad:be:ef:00:01" }] } })?.macAddress
    === "de:ad:be:ef:00:01");
check("...and when ISE reports no mac, the field is ABSENT rather than back-filled",
  normalizeIseEndpoint({ SearchResult: { resources: [{ id: "1", name: "n" }] } })?.macAddress === undefined);
check("...and ISE never invents a serial or a cert subject — it reports neither",
  (() => {
    const r = normalizeIseEndpoint({ SearchResult: { resources: [{ id: "1", mac: "de:ad:be:ef:00:01" }] } });
    return r?.serialNumber === undefined && r?.certSubject === undefined;
  })());
check("ClearPass reads macAddress and serialNumber FROM THE RESPONSE too",
  (() => {
    const r = normalizeClearPassEndpoint({
      _embedded: { items: [{ id: 9, mac_address: "de:ad:be:ef:00:02", device_id: "SN-9", status: "Known" }] },
    });
    return r?.macAddress === "de:ad:be:ef:00:02" && r?.serialNumber === "SN-9";
  })());
check("ClearPass status mapping is preserved for known values",
  clearPassStatus("Authenticated") === "authenticated" && clearPassStatus("Disconnected") === "disconnected" && clearPassStatus("Known") === "registered");
check("an unrecognised ClearPass status falls to unknown, never something more confident",
  clearPassStatus("SomeNewVendorState") === "unknown" && clearPassStatus(undefined) === "unknown" && clearPassStatus(42) === "unknown");
check("a ClearPass payload with no items is null",
  normalizeClearPassEndpoint({ _embedded: { items: [] } }) === null);
check("a numeric ClearPass id normalizes to a string id",
  normalizeClearPassEndpoint({ _embedded: { items: [{ id: 77, status: "Known" }] } })?.endpointId === "77");
check("normalization is deterministic",
  JSON.stringify(normalizeNacEndpoint("clearpass", { _embedded: { items: [{ id: 1, status: "Known" }] } })) ===
  JSON.stringify(normalizeNacEndpoint("clearpass", { _embedded: { items: [{ id: 1, status: "Known" }] } })));
// The dispatcher's arity is itself the guarantee: with no identifier parameter there is
// no query for a normalizer to echo. Asserted so that re-adding one is a failing change
// rather than a silent widening of the surface.
check("normalizeNacEndpoint takes NO identifier — the echo is unrepresentable, not merely unused",
  normalizeNacEndpoint.length === 2 && normalizeIseEndpoint.length === 1);
check("no fixture carries a wall-clock timestamp",
  Object.values(NAC_FIXTURES).every((f) => f.lastSeen === undefined));

// ── 4. The actuators stay gone ───────────────────────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, "../../lib/integrations/src/integrations/nac");
  // RECURSIVE. The previous scan used a flat readdirSync, so a subdirectory could
  // hold anything at all and the guarantee would still print green.
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []);
  const files = walk(dir);
  const offenders: string[] = [];

  // WHAT THIS BANS, and the claim is now narrowed to what it actually checks.
  //
  // THE OLD VERSION PRINTED A FALSE GUARANTEE. It said "no network I/O in any
  // source" while matching only fetch/axios/got/undici/https.request and a mutating
  // `method:` literal. Adversarial review found `nac/store.ts` doing
  // `await import("ioredis")` and opening a TCP connection to Redis — real network
  // I/O, invisible to every pattern in the list. The scan was reporting success over
  // something it had stopped looking at, which this repo's own guard-registry header
  // calls WORSE than no guard.
  //
  // Two changes. (1) The claim is now "no VENDOR-API call", which is the property
  // that actually matters here — Redis is configuration storage, not a device
  // actuator, and banning it outright would be theatre. (2) The pattern list gained
  // dynamic import of network clients, node:net/http/https/tls, XHR, WebSocket and
  // aliased fetch, so the next thing that sneaks in has fewer doors.
  // The two client-module patterns are named because the store.ts exemption below is
  // scoped to THEM and to nothing else; an anonymous array index would be a fossil the
  // first reordering breaks.
  const CLIENT_MODULE_REQUIRE = /\brequire\s*\(\s*['"](?:axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb)['"]/i;
  const CLIENT_MODULE_IMPORT = /\bimport\s*\(\s*['"](?:axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb)['"]/i;
  const banned = [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
    /\b(?:const|let|var)\s+\w+\s*=\s*fetch\b/i,            // aliased fetch
    CLIENT_MODULE_REQUIRE,
    CLIENT_MODULE_IMPORT,
    /\bfrom\s+['"](?:axios|got|undici|node-fetch|superagent|request)['"]/i,
    /\bfrom\s+['"]node:(?:net|http|https|tls|dgram)['"]/i,
    /\bhttps?\.(?:request|get)\s*\(/i,
    /\bnet\.(?:connect|createConnection)\s*\(/i,
    /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
  ];
  // store.ts is EXEMPT and named, not silently skipped. It talks to Redis to persist
  // which NAC provider is configured — configuration storage, not a vendor API call
  // and not a device action. Listing it here is the honest form: the exemption is
  // visible, scoped to one file, and a reader can disagree with it.
  //
  // THE EXEMPTION IS SCOPED TO THE REASON, NOT TO THE FILE. It used to be
  // `allowed(rel)`, evaluated BEFORE the pattern test, which switched all nine
  // patterns off for store.ts — `fetch(` and `method: "POST"` included. A live ISE ANC
  // quarantine call planted in store.ts was invisible and this section printed green,
  // in the family whose entire subject is that an actuator cannot return. Now a line in
  // an exempted file is skipped only when EVERY banned pattern it matches is one of the
  // two client-module patterns AND the module it names is a Redis client; anything else
  // in that file is an offender like anywhere else, and each skip is printed.
  const CONFIG_STORAGE_FILES = new Set(["store.ts"]);
  const REDIS_CLIENT_MODULE = /\b(?:require|import)\s*\(\s*['"](?:ioredis|redis)['"]\s*\)/i;
  const CONFIG_STORAGE_PATTERNS = new Set<RegExp>([CLIENT_MODULE_REQUIRE, CLIENT_MODULE_IMPORT]);
  const exempted: string[] = [];
  /** "clean" = no banned pattern; "exempt" = config-storage Redis client only; "offender" = everything else. */
  const classify = (rel: string, line: string): "clean" | "exempt" | "offender" => {
    const hits = banned.filter((re) => re.test(line));
    if (hits.length === 0) return "clean";
    if (
      CONFIG_STORAGE_FILES.has(rel) &&
      REDIS_CLIENT_MODULE.test(line) &&
      hits.every((re) => CONFIG_STORAGE_PATTERNS.has(re))
    ) return "exempt";
    return "offender";
  };
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      const verdict = classify(rel, line);
      if (verdict === "exempt") exempted.push(`${rel}:${i + 1}`);
      else if (verdict === "offender") offenders.push(`${rel}:${i + 1}`);
    });
  }
  if (offenders.length) console.log(`      offenders: ${offenders.join(", ")}`);
  // REPORTED, not gated: every line the config-storage exemption swallowed, so a reader
  // can see exactly what the claim below does not cover.
  console.log(`      config-storage exemptions taken (REPORTED): ${exempted.length ? exempted.join(", ") : "none"}`);
  check(`no VENDOR-API call in any nac/ source — an actuator cannot return (${files.length} files scanned recursively)`,
    offenders.length === 0);
  // NON-VACUITY: the scan must be able to FAIL. Without this, deleting the pattern
  // list would leave the assertion green and nobody would notice.
  check("...and the scan actually detects a planted vendor call",
    banned.some((re) => re.test(`await fetch("https://vendor/api", { method: "POST" })`)) &&
    banned.some((re) => re.test(`const { Redis } = await import("ioredis");`)));
  // SELF-TEST of the EXEMPTION, run through the same `classify` the loop uses. The old
  // whole-file form passes the check above and fails this one: it grades the planted ISE
  // quarantine call in store.ts "clean".
  check("...and the store.ts exemption is scoped to the REASON: a planted vendor call in the EXEMPT file is still an offender",
    classify("store.ts", `  await fetch("https://ise.vendor/ers/config/ancendpoint/apply", { method: "POST" });`) === "offender" &&
    classify("store.ts", `  await adapter.quarantineEndpoint(mac, { method: "POST" });`) === "offender" &&
    classify("index.ts", `  await fetch("https://ise.vendor/ers/config/ancendpoint/apply", { method: "POST" });`) === "offender" &&
    classify("index.ts", `  const { Redis } = await import("ioredis");`) === "offender" &&
    classify("store.ts", `  const { Redis } = await import("ioredis");`) === "exempt");
}

// A CERT-KIND LOOKUP MATCHES NOTHING, ON PURPOSE, AND THAT IS NOW TESTED.
//
// `NACEndpointInfo` carries `certSubject` — a subject DN — not a certificate serial.
// Comparing a supplied serial against a subject would be the same category error the
// ISE normalizer was fixed for, so the `cert` branch returns false unconditionally.
// Real behaviour with a real reason, and nothing pinned it: the mutation guard flipped
// that `return false` to `return true` and no assertion noticed — which would have made
// a cert lookup match whichever fixture happened to come first.
check(
  "a cert-kind fixture lookup matches nothing — a subject DN is not a serial",
  lookupNacFixture("de:ad:be:ef", "cert") === null,
);
check(
  "NON-VACUITY: the same table DOES resolve a mac-kind lookup, so the check above is not passing over an empty table",
  lookupNacFixture(Object.values(NAC_FIXTURES)[0].macAddress ?? "", "mac") !== null,
);


// REDIS FAULT IS AUDIBLE — both `if (redis)` guards in nac/store.ts survived
// mutation until 2026-08-25. The store's own header says "a Redis fault is
// reported, not swallowed", and describes the bug that sentence was written to fix:
// a deployment could serve a stale process-local config indefinitely while Redis was
// down and nothing anywhere said so. Nothing tested it, because the proofs run with
// no REDIS_URL, so the client is always null and the branch never executes.
// A closed port makes the connection fail fast (~70ms) without needing a server.
const priorRedisUrl = process.env["REDIS_URL"];
process.env["REDIS_URL"] = "redis://127.0.0.1:1";
const redisFaults: string[] = [];
__resetNacConfigForTests();
await getNACConfig("tenant-fault", (m) => redisFaults.push(m));
await setNACConfig("tenant-fault", { provider: "ise", enabled: true }, (m) => redisFaults.push(m));
check("a Redis READ fault is reported, never silently swallowed",
  redisFaults.some((f) => f.startsWith("read failed")));
check("a Redis WRITE fault is reported too",
  redisFaults.some((f) => f.startsWith("write failed")));
check("...and the config still falls back to the process-local value, so the fault is audible WITHOUT being fatal",
  (await getNACConfig("tenant-fault", () => undefined))?.provider === "ise");
if (priorRedisUrl === undefined) delete process.env["REDIS_URL"];
else process.env["REDIS_URL"] = priorRedisUrl;
// NON-VACUITY: with no REDIS_URL there is nothing to fault, and silence is correct.
const quietFaults: string[] = [];
await getNACConfig("tenant-fault", (m) => quietFaults.push(m));
check("with no REDIS_URL configured there is no fault to report, so the checks above are not vacuous",
  quietFaults.length === 0);



// CERTIFICATE-SERIAL FORMAT — the `cert` arm's format check survived mutation
// until 2026-08-25: every identifier test here used `mac` or `serial`, so the cert
// branch was never driven with a malformed value. An identifier that reaches a NAC
// lookup unvalidated is the injection surface this validator exists to close.
for (const bad of ["zz:xx", "not a serial", "ab:", ":ab", "0123456789abcdefg", "ab cd"]) {
  const v = validateNacIdentifier(bad, "cert");
  check(`nac: certificate serial ${JSON.stringify(bad)} is refused`, v.ok === false);
}
// NON-VACUITY, and it also pins the documented lowercase normalization.
const goodCert = validateNacIdentifier("AB:cd:0F", "cert");
check("nac: ...while a well-formed certificate serial is accepted and lower-cased",
  goodCert.ok === true && goodCert.normalized === "ab:cd:0f");


console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
