// Enterprise (OIDC) authentication proof — fully OFFLINE and deterministic.
//
// Generates a throwaway RSA keypair, publishes it as a JWKS, then mints a matrix
// of JWTs and asserts the gated enterprise auth path ACCEPTS exactly the valid
// one and REJECTS every attack/degenerate variant (bad signature, expiry,
// not-yet-valid, issuer/audience mismatch, `alg:none`, HS256 algorithm-confusion,
// unknown kid, unmapped tenant/role, missing subject). It then proves the core
// binding end to end: a verified OIDC identity resolves to the RIGHT tenant, can
// evaluate a real decision, and still CANNOT read another tenant's records.
//
// No network, no wall clock (time is injected), no real IdP — so this runs in the
// standard CI job alongside the other proofs.
import {
  createHmac,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import {
  createEnterpriseAuthenticator,
  createJwksCache, loadEnterpriseAuthConfig, verifyJwtRs256, MAX_CLOCK_TOLERANCE_SEC,
  type EnterpriseAuthConfig,
  type JwksFetch,
  type Jwks,
  type JwkKey,
} from "@workspace/enterprise-auth";
import { SignalGridCore, CoreError } from "@workspace/signalgrid-core";

// ── fixed clock + keypair ──────────────────────────────────────────────────────
const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const KID = "sg-test-key-1";
const ISSUER = "https://login.example-idp.com/contoso/v2.0";
const AUDIENCE = "api://signalgrid";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
const jwks: Jwks = { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" } as JwkKey] };
const jwksFetch: JwksFetch = async () => ({ ok: true, status: 200, json: async () => jwks });

const config: EnterpriseAuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: "https://login.example-idp.com/contoso/discovery/v2.0/keys",
  clockToleranceSec: 60,
  mapping: {
    tenantClaim: "tid",
    roleClaim: "roles",
    subjectClaim: "sub",
    tenantByClaimValue: { "contoso-tenant-guid": "tenant_northwind" },
    roleByClaimValue: { "SignalGrid.Operator": "operator", "SignalGrid.Owner": "owner" },
    principalType: "user",
  },
};

const authenticator = createEnterpriseAuthenticator(config, jwksFetch);

// ── JWT minting helpers ────────────────────────────────────────────────────────
const b64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");
const secBase = Math.floor(NOW_MS / 1000);

interface Parts { header: Record<string, unknown>; payload: Record<string, unknown>; }

function validParts(): Parts {
  return {
    header: { alg: "RS256", kid: KID, typ: "JWT" },
    payload: {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "user-nurse-42",
      tid: "contoso-tenant-guid",
      roles: ["SignalGrid.Operator"],
      iat: secBase - 30,
      nbf: secBase - 30,
      exp: secBase + 3600,
    },
  };
}

function signRs256({ header, payload }: Parts, key: KeyObject = privateKey): string {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = cryptoSign("RSA-SHA256", Buffer.from(signingInput, "ascii"), key);
  return `${signingInput}.${b64url(sig)}`;
}

// ── the accept/reject matrix ───────────────────────────────────────────────────
interface Case { name: string; token: string; expectAccept: boolean; }

const validToken = signRs256(validParts());

const cases: Case[] = [
  { name: "valid RS256 token", token: validToken, expectAccept: true },
  {
    name: "tampered payload (signature no longer matches)",
    token: (() => {
      const [h, , s] = validToken.split(".");
      const forged = { ...validParts().payload, roles: ["SignalGrid.Owner"] };
      return `${h}.${b64url(JSON.stringify(forged))}.${s}`;
    })(),
    expectAccept: false,
  },
  {
    name: "expired token",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, exp: secBase - 120, nbf: secBase - 300, iat: secBase - 300 } }),
    expectAccept: false,
  },
  {
    name: "expired ~30s past exp but within 60s clock tolerance (accepted)",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, exp: secBase - 30, nbf: secBase - 300, iat: secBase - 300 } }),
    expectAccept: true,
  },
  {
    name: "expired ~90s past exp, beyond 60s clock tolerance (rejected)",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, exp: secBase - 90, nbf: secBase - 300, iat: secBase - 300 } }),
    expectAccept: false,
  },
  {
    name: "not-yet-valid token (nbf in the future)",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, nbf: secBase + 600, iat: secBase + 600 } }),
    expectAccept: false,
  },
  {
    name: "wrong issuer",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, iss: "https://evil-idp.example/v2.0" } }),
    expectAccept: false,
  },
  {
    name: "wrong audience",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, aud: "api://someone-else" } }),
    expectAccept: false,
  },
  {
    name: "alg:none downgrade",
    token: signRs256({ header: { alg: "none", kid: KID, typ: "JWT" }, payload: validParts().payload }),
    expectAccept: false,
  },
  {
    name: "HS256 algorithm-confusion (public key as HMAC secret)",
    token: (() => {
      const header = { alg: "HS256", kid: KID, typ: "JWT" };
      const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(validParts().payload))}`;
      const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
      const mac = createHmac("sha256", pubPem).update(signingInput).digest();
      return `${signingInput}.${b64url(mac)}`;
    })(),
    expectAccept: false,
  },
  {
    name: "unknown kid",
    token: signRs256({ header: { alg: "RS256", kid: "not-a-real-kid", typ: "JWT" }, payload: validParts().payload }),
    expectAccept: false,
  },
  {
    name: "unmapped tenant claim",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, tid: "some-other-tenant" } }),
    expectAccept: false,
  },
  {
    name: "unmapped role claim",
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, roles: ["SignalGrid.Intruder"] } }),
    expectAccept: false,
  },
  {
    name: "missing subject claim",
    token: (() => {
      const p = { ...validParts().payload };
      delete (p as Record<string, unknown>).sub;
      return signRs256({ header: validParts().header, payload: p });
    })(),
    expectAccept: false,
  },
  { name: "not a JWT (demo-key shape)", token: "sgk_demo_northwind_operator", expectAccept: false },
  // A present nbf/iat that is not a finite number is REFUSED, as exp already is.
  // Skipping it let an unparseable claim loosen the answer; absent still passes.
  ...([["nbf", "1893456000"], ["nbf", null], ["iat", "0"], ["iat", {}]] as const).map(([claim, value]) => ({
    name: `malformed ${claim} ${JSON.stringify(value)} is refused, not skipped`,
    token: signRs256({ header: validParts().header, payload: { ...validParts().payload, [claim]: value } }),
    expectAccept: false,
  })),
  {
    name: "absent nbf and iat (both optional) still accepted",
    token: (() => {
      const p = { ...validParts().payload };
      delete p.nbf;
      delete p.iat;
      return signRs256({ header: validParts().header, payload: p });
    })(),
    expectAccept: true,
  },
  {
    // Signed from a RAW payload string: JSON.stringify would turn Infinity into
    // null, which the "missing exp" branch already refuses — proving nothing.
    name: "exp 1e999 (parses to Infinity, never expires) is refused",
    token: (() => {
      const [h] = validToken.split(".");
      const raw = JSON.stringify(validParts().payload).replace(/"exp":\d+/, '"exp":1e999');
      const input = `${h}.${b64url(raw)}`;
      return `${input}.${b64url(cryptoSign("RSA-SHA256", Buffer.from(input, "ascii"), privateKey))}`;
    })(),
    expectAccept: false,
  },
];

let passed = 0;
const failures: string[] = [];

console.log("Enterprise OIDC authentication proof");
console.log(`issuer=${ISSUER} audience=${AUDIENCE} nowMs=${NOW_MS}`);

for (const c of cases) {
  const outcome = await authenticator.authenticate(c.token, NOW_MS);
  const ok = outcome.ok === c.expectAccept;
  if (ok) {
    passed += 1;
  } else {
    failures.push(c.name);
  }
  const detail = outcome.ok ? `accept (${outcome.principal.tenantId}/${outcome.principal.role})` : `reject (${outcome.reason})`;
  console.log(`  ${ok ? "ok" : "FAIL"} — ${c.name}: ${detail}`);
}

// ── end-to-end core binding: verified identity → real, tenant-scoped decision ──
const core = SignalGridCore.demo();
const accepted = await authenticator.authenticate(validToken, NOW_MS);
if (!accepted.ok) {
  failures.push("core-binding: valid token unexpectedly rejected");
} else {
  const principal = core.registerVerifiedPrincipal(validToken, {
    tenantId: accepted.principal.tenantId,
    role: accepted.principal.role,
    subjectId: accepted.principal.subjectId,
    principalType: accepted.principal.principalType,
    keyReference: accepted.keyReference,
  });
  check("verified identity resolves to the mapped tenant", principal.tenantId === "tenant_northwind");
  check("verified identity carries the mapped role", principal.role === "operator");

  // The JWT now works as a bearer against every tenant-scoped core method.
  const ctx = core.context(validToken);
  check("core.context(jwt) resolves the same tenant", ctx.tenant.id === "tenant_northwind");

  const decision = core.evaluate(validToken, {
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    workflowKey: "clinical-session",
  });
  check("verified identity can evaluate a real decision", typeof decision.decisionId === "string" && decision.decisionId.length > 0);
  const readBack = core.getDecision(validToken, decision.decisionId);
  check("verified identity can read back its own decision", readBack.id === decision.decisionId);

  // Cross-tenant isolation still holds: an Atlas demo key cannot read the
  // Northwind decision this OIDC identity just produced.
  let denied = false;
  try {
    core.getDecision("sgk_demo_atlas_owner", decision.decisionId);
  } catch (err) {
    denied = err instanceof CoreError && (err.code === "not_found" || err.code === "cross_tenant_denied");
  }
  check("cross-tenant read of the OIDC identity's decision is denied", denied);
}

// ── JWKS ROTATION SURVIVAL ───────────────────────────────────────────────────
//
// The suite above proves an unknown kid is REJECTED, which is right for a forged
// token and was silently also the behaviour for a LEGITIMATE rotated one. The
// cache refreshed on its TTL alone, so when an IdP rotated its signing key —
// something Entra ID and Okta do on their own schedule, with no notice — every
// request 401'd for up to the full ten-minute window. A total authentication
// outage, from a routine vendor action, with no code change on our side.
//
// These four assertions pin both halves: rotation must survive, and a forged kid
// must not become an outbound-request amplifier against the customer's IdP.
{
  const jwksOf = (...kids: string[]) => ({
    ok: true,
    status: 200,
    json: async () => ({
      keys: kids.map((kid) => ({ kty: "RSA", kid, n: "x", e: "AQAB", alg: "RS256", use: "sig" })),
    }),
  });

  let served = ["old"];
  let fetches = 0;
  const cache = createJwksCache("https://idp.example/jwks", async () => {
    fetches += 1;
    return jwksOf(...served);
  }, 10 * 60 * 1000);

  const T = 1_000_000;
  await cache.get(T, "old");
  const firstFetch = fetches;
  await cache.get(T + 1_000, "old");
  check("a KNOWN kid inside the TTL is served from cache — no needless IdP traffic", fetches === firstFetch);

  served = ["old", "new"];
  const rotated = await cache.get(T + 2_000, "new");
  check(
    "a rotated (UNKNOWN) kid refetches even though the TTL is fresh — the outage is closed",
    fetches === firstFetch + 1 && rotated.keys.some((k) => k.kid === "new"),
  );

  const beforeForged = fetches;
  for (let i = 0; i < 50; i += 1) {
    await cache.get(T + 3_000 + i, `forged-${i}`);
  }
  check(
    "50 forged kids inside the cooldown cause ZERO extra IdP fetches — not an amplifier",
    fetches === beforeForged,
  );

  await cache.get(T + 2_000 + 61_000, "still-unknown");
  check("after the cooldown lapses, exactly ONE more refetch is allowed", fetches === beforeForged + 1);
}

// ── JSON-NULL JOSE PARTS FAIL CLOSED ─────────────────────────────────────────
//
// `JSON.parse` returns `null` happily, and the verifier read `header.alg`,
// `k.kty` and `claims.exp` off whatever came back. Each shape below threw a
// TypeError that `authenticate()` never caught — an unauthenticated 500 for the
// null header, which needs no signature at all. Called directly, so a throw
// reads as a throw.
{
  const opts = { jwks, issuer: ISSUER, audience: AUDIENCE, nowMs: NOW_MS, clockToleranceSec: 60 };
  const outcome = (token: string, keys: Jwks = jwks): boolean | "threw" => {
    try {
      return verifyJwtRs256(token, { ...opts, jwks: keys }).ok;
    } catch {
      return "threw";
    }
  };
  const payloadSeg = validToken.split(".")[1];
  check("a JSON-null header (`bnVsbA`) is refused, not thrown", outcome(`bnVsbA.${payloadSeg}.x`) === false);
  check(
    "a signed token whose payload decodes to null is refused, not thrown",
    outcome(signRs256({ header: validParts().header, payload: null as unknown as Record<string, unknown> })) === false,
  );
  const withNull: Jwks = { keys: [null as unknown as JwkKey, ...jwks.keys] };
  check("a JWKS holding a null element still verifies a valid token through the real key", outcome(validToken, withNull) === true);

  const nullCache = createJwksCache("https://idp.example/jwks", async () => ({ ok: true, status: 200, json: async () => withNull }));
  let warmKids: Array<string | undefined> = [];
  try {
    await nullCache.get(NOW_MS, KID);
    warmKids = (await nullCache.get(NOW_MS + 1, KID)).keys.map((k) => k.kid);
  } catch {
    // a throw is the defect; warmKids stays empty
  }
  check("a JWKS cache fed a null element serves the real key on a warm kid lookup", warmKids.includes(KID));
}

// ── NON-FINITE VERIFIER INPUTS FAIL CLOSED ───────────────────────────────────
//
// `now > exp * 1000 + tolMs` is false when `now` or `tolMs` is NaN, and never
// true for a tolerance that is Infinity or so large it overflows to Infinity
// (Number.MAX_VALUE * 1000), so a correctly signed, EXPIRED token was accepted.
// Today config parsing keeps clockToleranceSec finite and capped, and context.ts
// passes Date.now(), so only a direct caller of verifyJwtRs256 or authenticate()
// reaches it, which is why it is called directly here.
{
  const base = { jwks, issuer: ISSUER, audience: AUDIENCE, nowMs: NOW_MS, clockToleranceSec: 60 };
  const outcome = (token: string, over: Partial<typeof base>): boolean | "threw" => {
    try {
      return verifyJwtRs256(token, { ...base, ...over }).ok;
    } catch {
      return "threw";
    }
  };
  const expiredToken = signRs256({
    header: validParts().header,
    payload: { ...validParts().payload, exp: secBase - 120, nbf: secBase - 300, iat: secBase - 300 },
  });
  check("control: the signed, expired token is refused with finite inputs", outcome(expiredToken, {}) === false);
  check("an expired token is refused when clockToleranceSec is NaN", outcome(expiredToken, { clockToleranceSec: NaN }) === false);
  check("an expired token is refused when clockToleranceSec is Infinity", outcome(expiredToken, { clockToleranceSec: Infinity }) === false);
  check("an expired token is refused when clockToleranceSec is Number.MAX_VALUE (finite, overflows to Infinity in ms)", outcome(expiredToken, { clockToleranceSec: Number.MAX_VALUE }) === false);
  check("an expired token is refused when clockToleranceSec is 1e9 (31 years of skew)", outcome(expiredToken, { clockToleranceSec: 1e9 }) === false);
  check("an expired token is refused when clockToleranceSec is 301 (one past the cap)", outcome(expiredToken, { clockToleranceSec: 301 }) === false);
  check("a token 120s past exp still verifies at the 300s cap itself", outcome(expiredToken, { clockToleranceSec: 300 }) === true);
  check("a valid token still verifies with clockToleranceSec 0", outcome(validToken, { clockToleranceSec: 0 }) === true);
  check("the library cap is 300s, the same bound config.ts enforces", MAX_CLOCK_TOLERANCE_SEC === 300);
  check("an expired token is refused when nowMs is NaN", outcome(expiredToken, { nowMs: NaN }) === false);
  check("a valid token is refused when nowMs is NaN — no clock, no verdict", outcome(validToken, { nowMs: NaN }) === false);
  check("a valid token is refused when nowMs is missing (a JS caller)", outcome(validToken, { nowMs: undefined as unknown as number }) === false);
  check("a valid token still verifies with finite inputs", outcome(validToken, {}) === true);
  check("a valid token still verifies with clockToleranceSec omitted (default applies)", outcome(validToken, { clockToleranceSec: undefined }) === true);
}

// ── OIDC_CLOCK_TOLERANCE_SEC IS BOUNDED ──────────────────────────────────────
//
// The knob is skew allowance, not token lifetime: `1000000000` kept a token alive
// 31 years past its exp. Over the cap the config is `invalid`, which the server
// answers by refusing to boot (context.ts) — the rule for a bad security knob.
{
  const toleranceFor = (raw?: string): number | "invalid" | "disabled" => {
    const result = loadEnterpriseAuthConfig({
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: config.jwksUri,
      OIDC_TENANT_MAP: JSON.stringify({ "contoso-tenant-guid": "tenant_northwind" }),
      OIDC_ROLE_MAP: JSON.stringify({ "SignalGrid.Operator": "operator" }),
      ...(raw === undefined ? {} : { OIDC_CLOCK_TOLERANCE_SEC: raw }),
    });
    return result.status === "enabled" ? result.config.clockToleranceSec : result.status;
  };
  check("an unset OIDC_CLOCK_TOLERANCE_SEC is 60", toleranceFor() === 60);
  check("a blank OIDC_CLOCK_TOLERANCE_SEC is 60, not zero", toleranceFor("  ") === 60);
  check("OIDC_CLOCK_TOLERANCE_SEC at the 300s cap is accepted", toleranceFor("300") === 300);
  check("OIDC_CLOCK_TOLERANCE_SEC=301 is refused as invalid", toleranceFor("301") === "invalid");
  check("OIDC_CLOCK_TOLERANCE_SEC=1000000000 is refused as invalid", toleranceFor("1000000000") === "invalid");
  check("OIDC_CLOCK_TOLERANCE_SEC=Infinity is not finite, so it falls back to 60 (tighter than asked, never looser)", toleranceFor("Infinity") === 60);
}

// ── JWKS SINGLE-FLIGHT AND FAILURE BACKOFF ───────────────────────────────────
//
// The cooldown above guards only a FRESH cache. Cold or past its TTL, every
// bearer request started its own fetch, so an unauthenticated burst became one
// IdP request per API request for as long as the IdP stayed down. One shared
// in-flight fetch per cache, and a short backoff after a failed one.
{
  const T = 2_000_000;
  const uri = "https://idp.example/jwks";
  const keyset = { keys: [{ kty: "RSA", kid: "k", n: "x", e: "AQAB" }] };
  const slowOk = (count: () => void) => async () => {
    count();
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, status: 200, json: async () => keyset };
  };
  const settled = (p: Promise<unknown>) => p.then(() => "resolved", () => "rejected");

  let burstFetches = 0;
  const burst = createJwksCache(uri, slowOk(() => { burstFetches += 1; }));
  await Promise.all(Array.from({ length: 50 }, () => settled(burst.get(T))));
  check("50 concurrent gets on a cold cache make exactly ONE IdP fetch", burstFetches === 1);

  let idpUp = false;
  let downFetches = 0;
  const down = createJwksCache(uri, async () => {
    downFetches += 1;
    return idpUp ? { ok: true, status: 200, json: async () => keyset } : { ok: false, status: 503, json: async () => ({}) };
  });
  await settled(down.get(T));
  const inBackoff = await settled(down.get(T + 1_000));
  check("a get() 1s after a failed fetch refuses with ZERO extra IdP fetches", downFetches === 1 && inBackoff === "rejected");
  idpUp = true;
  const afterBackoff = await settled(down.get(T + 11_000));
  check("after the backoff lapses, exactly ONE more fetch is made, and it recovers", downFetches === 2 && afterBackoff === "resolved");

  let stepFetches = 0;
  const stepped = createJwksCache(uri, async () => {
    stepFetches += 1;
    return stepFetches === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => keyset };
  });
  await settled(stepped.get(T));
  const afterStepBack = await settled(stepped.get(T - 60_000));
  check("a clock stepped back after a failure does not stretch the backoff — it fetches", stepFetches === 2 && afterStepBack === "resolved");

  let joinFetches = 0;
  const join = createJwksCache(uri, slowOk(() => { joinFetches += 1; }));
  const [a, b] = await Promise.all([join.get(T), join.get(T + 5)]);
  check("a get() issued while a fetch is pending joins it — one fetch, the same keyset", joinFetches === 1 && a === b);
}

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
