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
  createJwksCache,
  verifyJwtRs256,
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

// ── NULL / NON-OBJECT SEGMENTS REFUSE, NEVER THROW ───────────────────────────
//
// A segment that is valid base64url JSON but not an object (`null`, a number, an
// array) used to reach `header.alg` / `key.kty` unguarded and throw a TypeError
// out of `verifyJwtRs256` — an unauthenticated HTTP 500 instead of the refusal the
// file's contract names. Each case below must come back `{ ok: false }`.
function refuses(name: string, run: () => ReturnType<typeof verifyJwtRs256>): void {
  let threw: unknown;
  let result: ReturnType<typeof verifyJwtRs256> | undefined;
  try {
    result = run();
  } catch (err) {
    threw = err;
  }
  check(
    `${name}: refuses with { ok: false }, never throws${threw ? ` (threw ${String(threw)})` : ""}`,
    threw === undefined && result !== undefined && result.ok === false,
  );
}
const verifyOpts = { jwks, issuer: ISSUER, audience: AUDIENCE, nowMs: NOW_MS };
const validPayloadSeg = b64url(JSON.stringify(validParts().payload));

refuses("null JOSE header (bnVsbA)", () => verifyJwtRs256(`${b64url("null")}.${validPayloadSeg}.x`, verifyOpts));
for (const [label, literal] of [["number", "42"], ["string", '"RS256"'], ["array", "[]"]] as const) {
  refuses(`${label} JOSE header`, () => verifyJwtRs256(`${b64url(literal)}.${validPayloadSeg}.x`, verifyOpts));
}
refuses("JWKS holding only a null element", () =>
  verifyJwtRs256(validToken, { ...verifyOpts, jwks: { keys: [null] as unknown as JwkKey[] } }),
);
refuses("validly signed token whose payload decodes to null", () => {
  const headerSeg = b64url(JSON.stringify(validParts().header));
  const signingInput = `${headerSeg}.${b64url("null")}`;
  const sig = cryptoSign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey);
  return verifyJwtRs256(`${signingInput}.${b64url(sig)}`, verifyOpts);
});
// A header that IS an object but carries an object-valued `alg`/`kid` with a hostile
// `toString` used to throw when the refusal message stringified it (String()/template).
for (const [label, header] of [
  ["object-valued alg", { alg: { toString: 1 }, kid: KID }],
  ["object-valued kid", { alg: "RS256", kid: { toString: 1 } }],
  ["array-valued kid", { alg: "RS256", kid: [KID] }],
  ["numeric alg", { alg: 256, kid: KID }],
] as const) {
  const tok = `${b64url(JSON.stringify(header))}.${validPayloadSeg}.x`;
  refuses(`${label} JOSE header`, () => verifyJwtRs256(tok, verifyOpts));
  let viaAuth = "threw";
  try {
    const out = await authenticator.authenticate(tok, NOW_MS);
    viaAuth = out.ok ? "accepted" : "refused";
  } catch {
    viaAuth = "threw";
  }
  check(`${label} JOSE header: the authenticator refuses and never throws`, viaAuth === "refused");
}

{
  let acceptedDespiteNull = false;
  try {
    acceptedDespiteNull =
      verifyJwtRs256(validToken, { ...verifyOpts, jwks: { keys: [null, ...jwks.keys] as unknown as JwkKey[] } }).ok === true;
  } catch {
    // a throw is a failed check, reported below, never an aborted run
  }
  check("a null JWKS element does not hide a good key (valid token still accepted)", acceptedDespiteNull);
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

// ── JWKS CACHE: a null element on the fresh-hit path refuses, never throws ────
{
  const nullKeyFetch: JwksFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ keys: [null, ...jwks.keys] }),
  });
  const nullCache = createJwksCache("https://idp.example/keys", nullKeyFetch);
  let cacheThrew: unknown;
  try {
    await nullCache.get(NOW_MS, KID);
    await nullCache.get(NOW_MS + 1_000, KID);
    await nullCache.get(NOW_MS + 2_000, "kid-that-is-absent");
  } catch (err) {
    cacheThrew = err;
  }
  check(
    `JWKS cache with a null element serves and misses without throwing${cacheThrew ? ` (threw ${String(cacheThrew)})` : ""}`,
    cacheThrew === undefined,
  );
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
