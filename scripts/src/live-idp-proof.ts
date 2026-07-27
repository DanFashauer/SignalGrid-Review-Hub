// Live-IdP proof — the repo's FIRST proof against real cryptographic material
// minted by a real, certified OpenID Connect implementation (oidc-provider@9.10.0),
// booted in-process on 127.0.0.1 with an ephemeral port. Zero cost, fully local, no
// external network: every token below is signed by the provider's own keystore over
// real HTTP to its token endpoint, and every acceptance/rejection decision is made by
// the SAME production verifier the API uses — @workspace/enterprise-auth — never a
// re-implementation.
//
// Why this exists: the offline enterprise-auth proof mints its own JWTs with a
// throwaway keypair. That proves the verifier's logic, but the keypair, the JWKS
// endpoint, and the token wire-format are all ours. This proof removes that last
// assumption: the signing keys, the /jwks document, the iss/aud/exp claim assembly,
// the RS256 signature, and the DPoP cnf.jkt binding all come from a certified server
// speaking the real protocol. If enterprise-auth accepts what this server mints and
// rejects the tampered/confused variants, the code path is proven against reality.
//
// What is proven (real tokens, real HTTP to the in-process provider):
//   1. a valid RS256 token verifies through enterprise-auth (iss/aud/sig/claims);
//   2. a tampered signature is rejected;
//   3. wrong audience is rejected; wrong issuer is rejected;
//   4. an expired token (short TTL + real wait) is rejected;
//   5. algorithm confusion — an HS256 token forged with the provider's REAL public
//      key bytes as the HMAC secret — is rejected;
//   6. DPoP: a real DPoP-bound token carries a real cnf.jkt equal to the RFC 7638
//      thumbprint of the key WE hold; a report derived honestly from that real token
//      material runs through the @workspace/integrations token-binding normalize +
//      evaluate path to a sender-constrained verdict, while a plain bearer token from
//      the same server takes the bearer/restrict path.
//
// Fail-closed: any failed check prints FAIL and the process exits non-zero.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
} from "node:crypto";
// oidc-provider ships as ESM JavaScript without bundled type declarations. The repo's
// strict tsc would flag the untyped import (TS7016); suppress it here so the proof stays
// self-contained in this one file (no sidecar .d.ts). tsx strips this and loads the real
// module at runtime. The provider surface used below is small and exercised by running it.
// @ts-expect-error — oidc-provider has no bundled type declarations
import OIDCProvider from "oidc-provider";
import {
  createEnterpriseAuthenticator,
  type EnterpriseAuthConfig,
  type Jwks,
  type JwksFetch,
} from "@workspace/enterprise-auth";
import {
  evaluateTokenBinding,
  normalizeReport,
  type TokenBindingReportRaw,
} from "@workspace/integrations/token-binding";
import { composeDeviceRisk, fromTokenBinding } from "@workspace/posture-composition";

// ── the accept/reject counters (repo proof style) ───────────────────────────────
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}${detail ? `: ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}${detail ? `: ${detail}` : ""}`);
  }
};

// ── tiny JOSE helpers (no dependency — Node crypto only) ─────────────────────────
const b64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");
const decodeSeg = <T>(seg: string): T => JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as T;

/** RFC 7638 JWK thumbprint for an EC key: SHA-256 over the required members in
 *  lexicographic order (crv, kty, x, y), base64url-encoded. This is exactly what a
 *  DPoP server computes for cnf.jkt, so we can independently confirm the real token
 *  is bound to the key we hold. */
function ecThumbprint(jwk: { crv: string; kty: string; x: string; y: string }): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return createHash("sha256").update(canonical).digest("base64url");
}

// ── reserve an ephemeral port, then boot the provider bound to it ────────────────
// The issuer is baked into the provider at construction, so we must know the port
// first. Reserve one with a throwaway listener, release it, then hand it to the
// provider — a standard local-port-acquisition pattern.
const port = await new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const p = (probe.address() as AddressInfo).port;
    probe.close(() => resolve(p));
  });
});

const ISSUER = `http://127.0.0.1:${port}`;
const AUDIENCE = "api://signalgrid";
const OTHER_AUDIENCE = "api://someone-else";
const RESOURCE = "https://api.signalgrid.example/"; // resource indicator → AUDIENCE
const OTHER_RESOURCE = "https://api.someone-else.example/"; // → OTHER_AUDIENCE
const SHORT_RESOURCE = "https://api.signalgrid.example/short/"; // 1s TTL, same AUDIENCE
const CLIENT_ID = "signalgrid-api";
const CLIENT_SECRET = "live-idp-proof-client-secret-value-0123456789abcdef";
const SCOPE = "signalgrid.read";

// Real, certified OIDC provider. client_credentials is the simplest machine-minted
// path; resourceIndicators lets us issue JWT (not opaque) access tokens with a real
// audience; dPoP (RFC 9449) is enabled by default in this version. extraTokenClaims
// makes the IdP emit the tenant/role claims exactly as Entra ID emits `tid`/`roles` —
// so the verified token maps to a real internal principal (configured at the IdP, not
// forged into the token).
const provider = new OIDCProvider(ISSUER, {
  clients: [
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_types: ["client_credentials"],
      response_types: [],
      redirect_uris: [],
      scope: SCOPE,
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  // Declare the custom API scope as an Authorization-Server-supported value so the
  // client may hold it and the client_credentials request may ask for it.
  scopes: [SCOPE],
  features: {
    clientCredentials: { enabled: true },
    dPoP: { enabled: true },
    resourceIndicators: {
      enabled: true,
      defaultResource: () => RESOURCE,
      getResourceServerInfo: (_ctx: unknown, resourceIndicator: string) => {
        const audience = resourceIndicator === OTHER_RESOURCE ? OTHER_AUDIENCE : AUDIENCE;
        const accessTokenTTL = resourceIndicator === SHORT_RESOURCE ? 1 : 3600;
        return {
          scope: SCOPE,
          audience,
          accessTokenTTL,
          accessTokenFormat: "jwt" as const,
          jwt: { sign: { alg: "RS256" } },
        };
      },
    },
  },
  // Suppress the dev shouldChange TTL warning; the real expiry comes from the
  // resource server's accessTokenTTL above.
  ttl: {
    ClientCredentials: (_ctx: unknown, token: { resourceServer?: { accessTokenTTL?: number } }) =>
      token.resourceServer?.accessTokenTTL ?? 300,
  },
  extraTokenClaims: () => ({
    tid: "contoso-tenant-guid",
    roles: ["SignalGrid.Operator"],
  }),
});

const server = createServer(provider.callback() as (req: never, res: never) => void);
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

// Guarantee the server is torn down no matter how we exit.
const shutdown = (): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

console.log("Live-IdP proof — real oidc-provider@9.10.0, in-process, ephemeral port");
console.log(`issuer=${ISSUER} audience=${AUDIENCE}`);

try {
  // ── the real verifier, wired to the provider's REAL published JWKS ─────────────
  // The JWKS fetch performs a genuine HTTP GET against the in-process provider's
  // /jwks endpoint — enterprise-auth verifies against keys it fetched over the wire,
  // exactly as it would against a cloud IdP. clockToleranceSec:0 makes the expiry
  // gate crisp for the short-TTL case below.
  const jwksFetch: JwksFetch = async (uri: string) => {
    const res = await fetch(uri);
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };
  const baseConfig: EnterpriseAuthConfig = {
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: `${ISSUER}/jwks`,
    clockToleranceSec: 0,
    mapping: {
      tenantClaim: "tid",
      roleClaim: "roles",
      subjectClaim: "sub",
      tenantByClaimValue: { "contoso-tenant-guid": "tenant_northwind" },
      roleByClaimValue: { "SignalGrid.Operator": "operator", "SignalGrid.Owner": "owner" },
      principalType: "user",
    },
  };
  const authenticator = createEnterpriseAuthenticator(baseConfig, jwksFetch);
  // A second verifier that expects a DIFFERENT issuer — used to prove the iss gate on
  // a genuinely valid token (the provider cannot be made to mint a wrong iss).
  const wrongIssuerAuth = createEnterpriseAuthenticator(
    { ...baseConfig, issuer: `${ISSUER}/tenant-mismatch` },
    jwksFetch,
  );

  // ── mint a real access token over real HTTP ────────────────────────────────────
  interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope?: string;
    error?: string;
    error_description?: string;
  }
  const basicAuth = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
  async function mintToken(resource: string, dpopProof?: string): Promise<TokenResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuth,
    };
    if (dpopProof) headers.DPoP = dpopProof;
    const body = new URLSearchParams({ grant_type: "client_credentials", resource, scope: SCOPE });
    const res = await fetch(`${ISSUER}/token`, { method: "POST", headers, body });
    const json = (await res.json()) as TokenResponse;
    if (!res.ok || !json.access_token) {
      throw new Error(`token endpoint ${res.status}: ${json.error ?? "?"} ${json.error_description ?? ""}`.trim());
    }
    return json;
  }

  // Confirm discovery is live (the server really is speaking OIDC).
  const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  const discoveryDoc = (await discovery.json()) as { issuer?: string; jwks_uri?: string; token_endpoint?: string };
  check("provider discovery document is served", discovery.ok && discoveryDoc.issuer === ISSUER, discoveryDoc.jwks_uri);

  const now = () => Date.now();
  const valid = await mintToken(RESOURCE);
  const validToken = valid.access_token;
  const validHeader = decodeSeg<{ alg: string; kid?: string; typ?: string }>(validToken.split(".")[0]);
  const validClaims = decodeSeg<Record<string, unknown>>(validToken.split(".")[1]);

  // 1. a valid token verifies through the real verifier ---------------------------
  check("minted access token is a JWT (3 non-empty segments)", validToken.split(".").filter((s) => s.length > 0).length === 3);
  check("minted token header alg is RS256", validHeader.alg === "RS256", `kid=${validHeader.kid}`);
  check("real token iss equals the provider issuer", validClaims.iss === ISSUER);
  check("real token aud equals the requested audience", validClaims.aud === AUDIENCE);

  const acceptedOutcome = await authenticator.authenticate(validToken, now());
  check("valid RS256 token verifies through enterprise-auth", acceptedOutcome.ok === true, acceptedOutcome.ok ? "" : (acceptedOutcome as { reason: string }).reason);
  if (acceptedOutcome.ok) {
    check("verified identity maps to the configured tenant", acceptedOutcome.principal.tenantId === "tenant_northwind");
    check("verified identity carries the mapped role", acceptedOutcome.principal.role === "operator");
    check("keyReference is a non-secret subject reference", acceptedOutcome.keyReference.startsWith("oidc:"));
  }

  // 2. a tampered signature is rejected -------------------------------------------
  {
    const [h, p, s] = validToken.split(".");
    // Flip the FIRST base64url char of the signature — its 6 bits are all significant,
    // so the decoded signature bytes genuinely change. (The LAST char of an RSA-2048
    // signature carries only 2 significant bits, so flipping it can decode to identical
    // bytes and be a no-op — a subtle trap this deliberately avoids.)
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    const outcome = await authenticator.authenticate(`${h}.${p}.${flipped}`, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "a tampered signature is rejected: signature does not match",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("signature does not match"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 2b. a tampered payload (signature can no longer match) -------------------------
  {
    const [h, , s] = validToken.split(".");
    const forged = { ...validClaims, roles: ["SignalGrid.Owner"] }; // privilege-escalation attempt
    const outcome = await authenticator.authenticate(`${h}.${b64url(JSON.stringify(forged))}.${s}`, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "a tampered payload (forged role) is rejected — signature mismatch: signature does not match",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("signature does not match"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 3. wrong audience / wrong issuer ----------------------------------------------
  {
    // A REAL token minted for a different audience, verified against the API's verifier.
    const otherAud = await mintToken(OTHER_RESOURCE);
    const otherClaims = decodeSeg<Record<string, unknown>>(otherAud.access_token.split(".")[1]);
    check("provider really minted a token for the other audience", otherClaims.aud === OTHER_AUDIENCE);
    const outcome = await authenticator.authenticate(otherAud.access_token, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "wrong audience is rejected: audience mismatch",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("audience mismatch"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }
  {
    // The valid token, verified by a verifier that expects a different issuer.
    const outcome = await wrongIssuerAuth.authenticate(validToken, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "wrong issuer is rejected: issuer mismatch",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("issuer mismatch"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 3c. an unknown kid (key not in the published JWKS) -----------------------------
  {
    const [, p, s] = validToken.split(".");
    const forgedHeader = { ...validHeader, kid: "not-a-published-kid" };
    const outcome = await authenticator.authenticate(`${b64url(JSON.stringify(forgedHeader))}.${p}.${s}`, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "a header kid absent from the JWKS is rejected: no JWKS key matches kid",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("no JWKS key matches kid"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 4. an expired token (real short TTL + real wait) ------------------------------
  {
    const shortLived = await mintToken(SHORT_RESOURCE);
    const shortClaims = decodeSeg<{ exp: number; iat: number }>(shortLived.access_token.split(".")[1]);
    check("short-TTL token really has a ~1s lifetime", shortClaims.exp - shortClaims.iat <= 2, `ttl=${shortClaims.exp - shortClaims.iat}s`);
    // Wait past expiry. With clockToleranceSec:0 the verifier must reject it.
    await new Promise((r) => setTimeout(r, 2600));
    const outcome = await authenticator.authenticate(shortLived.access_token, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "an expired token is rejected: token has expired",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("token has expired"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 5. algorithm confusion — HS256 forged with the provider's REAL public key ------
  {
    // Fetch the provider's actual published signing key and use its public-key bytes
    // (SPKI PEM) as the HMAC secret. This is the classic RS256→HS256 confusion attack:
    // a verifier that naively "trusts the alg header" would validate it. enterprise-auth
    // rejects any non-RS256 alg before touching key material, so it must be rejected.
    const jwksRes = await fetch(`${ISSUER}/jwks`);
    const jwksBody = (await jwksRes.json()) as Jwks;
    const signingJwk = jwksBody.keys.find((k) => k.kty === "RSA");
    check("provider publishes an RSA signing key in its JWKS", Boolean(signingJwk));
    const pubPem = createPublicKey({ key: signingJwk as never, format: "jwk" }).export({ type: "spki", format: "pem" }) as string;
    const header = { alg: "HS256", kid: validHeader.kid, typ: "JWT" };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(validClaims))}`;
    const mac = createHmac("sha256", pubPem).update(signingInput).digest();
    const outcome = await authenticator.authenticate(`${signingInput}.${b64url(mac)}`, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "HS256 algorithm-confusion (provider public key as HMAC secret) is rejected: unsupported alg",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("unsupported alg"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 5b. an alg:none downgrade ------------------------------------------------------
  {
    const header = { alg: "none", kid: validHeader.kid, typ: "JWT" };
    // Keep the real token's signature segment so the token stays well-formed and the
    // rejection comes from the ALGORITHM gate (alg:none), not the structural pre-check.
    const s = validToken.split(".")[2];
    const noneToken = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(validClaims))}.${s}`;
    const outcome = await authenticator.authenticate(noneToken, now());
    // Reason-asserted, not merely refusal-asserted: an adversarial review deleted a
    // verifier gate and the refusal-only version of this check stayed green (the token
    // was refused for the WRONG reason). The reason IS the claim.
    check(
      "an alg:none downgrade is rejected: unsupported alg",
      outcome.ok === false && (outcome as { reason: string }).reason.includes("unsupported alg"),
      (outcome as { reason?: string }).reason ?? "(accepted)",
    );
  }

  // 6. DPoP (RFC 9449) proof-of-possession → token-binding dimension --------------
  // Generate a client-held EC key. Build a real DPoP proof JWT (typ=dpop+jwt, ES256,
  // embedded public JWK, htm/htu/jti/iat) and present it to the token endpoint. The
  // provider validates the proof and mints a token whose cnf.jkt is the RFC 7638
  // thumbprint of OUR key — a real sender-constraining binding.
  const dpopKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const dpopPublicJwk = dpopKeys.publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  const ourJkt = ecThumbprint(dpopPublicJwk);

  function makeDpopProof(): string {
    const header = { typ: "dpop+jwt", alg: "ES256", jwk: { kty: dpopPublicJwk.kty, crv: dpopPublicJwk.crv, x: dpopPublicJwk.x, y: dpopPublicJwk.y } };
    const payload = { jti: randomUUID(), htm: "POST", htu: `${ISSUER}/token`, iat: Math.floor(Date.now() / 1000) };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    // ES256 JWS signatures are raw R||S (IEEE P1363), not DER.
    const sig = cryptoSign("sha256", Buffer.from(signingInput, "ascii"), { key: dpopKeys.privateKey, dsaEncoding: "ieee-p1363" });
    return `${signingInput}.${b64url(sig)}`;
  }

  const dpopBound = await mintToken(RESOURCE, makeDpopProof());
  const dpopClaims = decodeSeg<{ cnf?: { jkt?: string }; aud?: string }>(dpopBound.access_token.split(".")[1]);
  check("provider issued a DPoP-bound token (token_type=DPoP)", dpopBound.token_type === "DPoP", `token_type=${dpopBound.token_type}`);

  // The DPoP-bound token still passes the full RS256/claim verification.
  const dpopVerified = await authenticator.authenticate(dpopBound.access_token, now());
  check("the DPoP-bound token also verifies through enterprise-auth", dpopVerified.ok === true, dpopVerified.ok ? "" : (dpopVerified as { reason: string }).reason);

  // The binding is real and it is OURS: cnf.jkt is present and equals the thumbprint
  // of the key we hold. This is the fact that lets us honestly derive binding='dpop'
  // and boundToDevice=true from the token material.
  const cnfJkt = dpopClaims.cnf?.jkt;
  check("the real token carries a cnf.jkt confirmation claim", typeof cnfJkt === "string" && cnfJkt.length > 0, cnfJkt);
  check("cnf.jkt equals the RFC 7638 thumbprint of the key we hold (bound to THIS device)", cnfJkt === ourJkt);

  // Derive a TokenBindingReportRaw HONESTLY from the real token material:
  //   - binding='dpop'          ONLY because cnf.jkt is actually present (above);
  //   - boundToDevice=true      ONLY because cnf.jkt matched our held key's thumbprint;
  //   - audienceRestricted=true ONLY because the token's aud is the specific resource;
  //   - bridgeReachable=true     because this in-process inspection actually evaluated it.
  // keyProtection/keyAttested are the token-inspection bridge's hardware-attestation
  // finding. DPoP itself (RFC 9449) says nothing about where the PoP key lives, so from
  // the token material ALONE that is unknown. This local proof models the attested-
  // hardware case (a Secure-Enclave-held DPoP key) so the full sender-constrained grant
  // path is exercised — and the honesty-contrast check below proves the grant genuinely
  // DEPENDS on that attestation rather than being rubber-stamped by the dpop binding.
  const dpopBindingPresent = typeof cnfJkt === "string" && cnfJkt.length > 0;
  const dpopReport: TokenBindingReportRaw = {
    binding: dpopBindingPresent ? "dpop" : "unknown",
    boundToDevice: cnfJkt === ourJkt,
    audienceRestricted: dpopClaims.aud === AUDIENCE,
    bridgeReachable: true,
    keyProtection: "hardware", // modeled: Secure-Enclave-held DPoP key
    keyAttested: true, // modeled: key attestation proves hardware residency
  };
  const dpopNormalized = normalizeReport("shared-ward-ipad-01", dpopReport);
  check("the derived report normalizes binding to 'dpop' (because cnf.jkt is real)", dpopNormalized.binding === "dpop");
  const dpopVerdict = evaluateTokenBinding(dpopNormalized);
  check(
    "an attested-hardware DPoP token → sender_constrained/none, senderConstrained",
    dpopVerdict.posture === "sender_constrained" && dpopVerdict.recommendedAction === "none" && dpopVerdict.senderConstrained === true,
    `${dpopVerdict.posture}/${dpopVerdict.recommendedAction}`,
  );
  check("the sender-constrained token composes to the 'ok' device-risk tier", composeDeviceRisk([fromTokenBinding(dpopVerdict)]).riskTier === "ok");

  // Honesty contrast: the SAME real DPoP token, but WITHOUT the modeled hardware
  // attestation, must NOT reach the grant — proving the sender-constrained verdict is
  // earned by attestation, not by the mere presence of the dpop binding.
  const dpopUnattested = normalizeReport("shared-ward-ipad-01", { ...dpopReport, keyProtection: "unknown", keyAttested: null });
  const unattestedVerdict = evaluateTokenBinding(dpopUnattested);
  check(
    "the same DPoP token WITHOUT attestation drops out of the grant (step_up, not senderConstrained)",
    unattestedVerdict.recommendedAction === "step_up" && unattestedVerdict.senderConstrained === false,
    `${unattestedVerdict.posture}/${unattestedVerdict.recommendedAction}`,
  );

  // A plain bearer token from the SAME server: no DPoP proof → no cnf.jkt → honestly
  // binding='bearer' → the replayable-token containment path.
  const bearerClaims = validClaims as { cnf?: unknown };
  check("the plain bearer token has NO cnf confirmation claim", bearerClaims.cnf === undefined);
  const bearerReport: TokenBindingReportRaw = {
    binding: bearerClaims.cnf === undefined ? "bearer" : "dpop", // 'bearer' only because cnf is absent
    audienceRestricted: validClaims.aud === AUDIENCE,
    bridgeReachable: true,
  };
  const bearerNormalized = normalizeReport("shared-ward-ipad-01", bearerReport);
  const bearerVerdict = evaluateTokenBinding(bearerNormalized);
  check(
    "the plain bearer token → bearer_token/restrict, never senderConstrained",
    bearerVerdict.posture === "bearer_token" && bearerVerdict.recommendedAction === "restrict" && bearerVerdict.senderConstrained === false && bearerVerdict.criticalFindings.includes("unbound_bearer_token"),
    `${bearerVerdict.posture}/${bearerVerdict.recommendedAction}`,
  );
  check("the bearer token composes OUT of the 'ok' tier (replayable — contain it)", composeDeviceRisk([fromTokenBinding(bearerVerdict)]).riskTier !== "ok");
} finally {
  await shutdown();
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
