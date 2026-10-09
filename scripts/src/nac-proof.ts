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

import { createServer, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyVendorCallLine, scanForVendorCalls, vendorCallScanSelfTest } from "./lib/no-vendor-call.js";
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
  // store.ts is EXEMPT and named, not silently skipped. It talks to Redis to persist
  // which NAC provider is configured — configuration storage, not a vendor API call
  // and not a device action. THE EXEMPTION IS SCOPED TO THE REASON, NOT TO THE FILE:
  // it used to switch all nine patterns off for store.ts, and a live ISE ANC quarantine
  // call planted there was invisible. A line in an exempted file is now skipped only
  // when it loads a Redis client and matches nothing else; each skip is printed.
  const CONFIG_STORAGE_FILES = new Set(["store.ts"]);
  // The scan is the SHARED one (scripts/src/lib/no-vendor-call.ts, row 119): five
  // proofs carried five copies of this pattern list and one drifted permissive.
  // RECURSIVE over every file, with a non-empty floor — a scan of nothing is green.
  const { files, offenders, exempted } = scanForVendorCalls(dir, CONFIG_STORAGE_FILES);
  if (offenders.length) console.log(`      offenders: ${offenders.join(", ")}`);
  // REPORTED, not gated: every line the config-storage exemption swallowed, so a reader
  // can see exactly what the claim below does not cover.
  console.log(`      config-storage exemptions taken (REPORTED): ${exempted.length ? exempted.join(", ") : "none"}`);
  check(`no VENDOR-API call in any nac/ source — an actuator cannot return (${files.length} files scanned recursively)`,
    files.length > 0 && offenders.length === 0);
  // NON-VACUITY: the scan must be able to FAIL — against one planted control PER
  // PATTERN CLASS, not a single `fetch(`. The shared self-test also requires the drifted
  // six-pattern list to fail those controls (scripts/src/lib/no-vendor-call.ts, row 119).
  const selfTest = vendorCallScanSelfTest();
  check(`...and the scan actually detects a planted vendor call of every pattern class${selfTest.length ? `: ${selfTest.join("; ")}` : ""}`,
    selfTest.length === 0);
  // SELF-TEST of the EXEMPTION, run through the same classifier the scan uses. The old
  // whole-file form grades the planted ISE quarantine call in store.ts "clean".
  const classify = (rel: string, line: string) => classifyVendorCallLine(rel, line, CONFIG_STORAGE_FILES);
  check("...and the store.ts exemption is scoped to the REASON: a planted vendor call in the EXEMPT file is still an offender",
    classify("store.ts", `  await fetch("https://ise.vendor/ers/config/ancendpoint/apply", { method: "POST" });`) === "offender" &&
    classify("store.ts", `  await adapter.quarantineEndpoint(mac, { method: "POST" });`) === "offender" &&
    classify("index.ts", `  await fetch("https://ise.vendor/ers/config/ancendpoint/apply", { method: "POST" });`) === "offender" &&
    classify("index.ts", `  const { Redis } = await import("ioredis");`) === "offender" &&
    classify("store.ts", `  const r = await import("redis"); const a = require("axios");`) === "offender" &&
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



// BRACE-LESS GUARDS IN THE IDENTIFIER VALIDATOR (joined the brace-less sweep, wave 9).
// `nac/identifier.ts` lines 48, 49 and 58 survived `if (false)` with this proof green: the
// per-kind regex refuses the same hostile value a moment later, so every earlier check saw
// `ok === false` either way. What differs is WHICH refusal answered, and the reason is what an
// operator reads. So each guard is pinned by its reason, and by the boundary it draws.
{
  const reason = (v: unknown, t: "mac" | "serial" | "cert"): string | null => {
    const r = validateNacIdentifier(v, t);
    return r.ok ? null : r.reason;
  };
  for (const t of ["mac", "serial", "cert"] as const) {
    check(`nac: an empty or all-whitespace ${t} identifier is refused as EMPTY, not as malformed`,
      reason("", t) === "identifier is empty" && reason("   ", t) === "identifier is empty");
    check(`nac: a ${t} identifier over 256 characters is refused as TOO LONG, not as malformed`,
      reason("a".repeat(257), t) === "identifier exceeds 256 characters");
  }
  check("nac: the 256-character bound is inclusive — 256 passes the length guard and meets the kind check instead",
    reason("a".repeat(256), "mac") === "not a well-formed MAC address" &&
    reason("a".repeat(256), "serial") === "not a well-formed serial");
  check("nac: a serial with a character outside [0-9a-z_-] is refused, with the serial reason",
    ["sn 123", "sn;drop", "sn'x", "sn/../x", "ser\u00e9ial"].every((v) => reason(v, "serial") === "not a well-formed serial"));
  check("nac: a 65-character serial is refused (the bound is 64) and a 64-character one is accepted",
    reason("a".repeat(65), "serial") === "not a well-formed serial" && validateNacIdentifier("a".repeat(64), "serial").ok === true);
}

// THE REDIS READ-HIT PATH — `nac/store.ts` line 81 (`if (data) return ...parse(...)`) survived
// `if (false)`: every earlier check ran with NO Redis (client null) or a CLOSED port (fault), so
// the branch where Redis HAS the config never executed, and a store that always fell through to
// the process-local map would have passed. Driven here against a loopback RESP server that holds
// one value in a Map: no real Redis, no clock, no randomness (OS-assigned port).
{
  const kv = new Map<string, string>();
  const sockets = new Set<Socket>();
  const parseCommands = (buf: Buffer): { cmds: string[][]; rest: Buffer } => {
    const cmds: string[][] = [];
    let off = 0;
    for (;;) {
      if (buf[off] !== 0x2a) break; // "*"
      let nl = buf.indexOf("\r\n", off);
      if (nl < 0) break;
      const n = Number.parseInt(buf.toString("utf8", off + 1, nl), 10);
      let cur = nl + 2;
      const args: string[] = [];
      let complete = true;
      for (let i = 0; i < n; i += 1) {
        nl = buf.indexOf("\r\n", cur);
        if (nl < 0) { complete = false; break; }
        const len = Number.parseInt(buf.toString("utf8", cur + 1, nl), 10);
        if (buf.length < nl + 2 + len + 2) { complete = false; break; }
        args.push(buf.toString("utf8", nl + 2, nl + 2 + len));
        cur = nl + 2 + len + 2;
      }
      if (!complete) break;
      cmds.push(args);
      off = cur;
    }
    return { cmds, rest: buf.subarray(off) };
  };
  const server = createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => undefined);
    let pending: Buffer = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      const { cmds, rest } = parseCommands(Buffer.concat([pending, chunk]));
      pending = Buffer.from(rest);
      for (const [cmd, ...args] of cmds) {
        switch (cmd?.toLowerCase()) {
          case "info": { const b = "# Server\r\nloading:0\r\n"; sock.write(`$${Buffer.byteLength(b)}\r\n${b}\r\n`); break; }
          case "get": { const v = kv.get(args[0] ?? ""); sock.write(v === undefined ? "$-1\r\n" : `$${Buffer.byteLength(v)}\r\n${v}\r\n`); break; }
          case "set": kv.set(args[0] ?? "", args[1] ?? ""); sock.write("+OK\r\n"); break;
          case "quit": sock.write("+OK\r\n"); sock.end(); break;
          default: sock.write("+OK\r\n");
        }
      }
    });
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const priorUrl = process.env["REDIS_URL"];
  process.env["REDIS_URL"] = `redis://127.0.0.1:${port}`;
  const faults: string[] = [];
  try {
    __resetNacConfigForTests();
    await setNACConfig("tenant-redis", { provider: "clearpass", enabled: false }, (m) => faults.push(m));
    check("nac: a config written through Redis lands in the Redis store (the fake server received the SET)",
      [...kv.keys()].length === 1 && faults.length === 0);
    // Drop the process-local copy: the ONLY place the config now lives is Redis.
    __resetNacConfigForTests();
    const fromRedis = await getNACConfig("tenant-redis", (m) => faults.push(m));
    check("nac: a config present in Redis is READ from Redis when the process-local copy is gone",
      fromRedis?.provider === "clearpass" && fromRedis?.enabled === false && faults.length === 0);
    check("nac: a key Redis does not hold falls through to the (empty) process-local map, as null",
      (await getNACConfig("tenant-absent", (m) => faults.push(m))) === null && faults.length === 0);
    // A stored value that fails the strict schema is a FAULT (audible), never a silent default.
    kv.set([...kv.keys()][0]!, JSON.stringify({ provider: "ise", enabld: true }));
    __resetNacConfigForTests();
    const bad = await getNACConfig("tenant-redis", (m) => faults.push(m));
    check("nac: a corrupt stored config is reported as a read fault and yields null, not a default-on config",
      bad === null && faults.some((f) => f.startsWith("read failed")));
  } finally {
    if (priorUrl === undefined) delete process.env["REDIS_URL"];
    else process.env["REDIS_URL"] = priorUrl;
    for (const sk of sockets) sk.destroy();
    await new Promise<void>((res) => server.close(() => res()));
    __resetNacConfigForTests();
  }
}

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
