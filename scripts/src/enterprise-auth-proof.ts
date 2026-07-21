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
