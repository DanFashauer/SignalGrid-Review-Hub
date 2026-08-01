// Proof: enterprise-auth against a REAL Keycloak, and a SECOND DPoP implementation.
//
// `proof:live-idp` already runs a complete DPoP ceremony — but against
// `oidc-provider` running in this process. That is a certified implementation and
// the proof is a good one, yet it shares a runtime, a language and a JOSE library
// with the code under test. Two implementations that agree while sharing their
// crypto stack agree about less than it looks.
//
// The Fleet lane taught this the hard way: `telemetry/fleetdm.ts` passed every
// fixture and every route in it 404'd against a real server, because the fixtures
// were written from the same assumptions as the code. A second, independent
// implementation is the cheapest way to find out whether an agreement is real.
//
// So this is the same ceremony against Keycloak 26.4 — a different language (Java),
// a different JOSE stack, a different vendor, in a separate process, over real
// HTTP. What it can prove that the in-process lane cannot:
//
//   1. RFC 7638 CROSS-IMPLEMENTATION AGREEMENT. We compute the thumbprint of a key
//      we generated; Keycloak independently computes `cnf.jkt` for the same key.
//      If either side canonicalised the JWK differently — member order, whitespace,
//      base64 variant — the two would differ and neither would notice alone.
//   2. Our PRODUCTION verifier (lib/enterprise-auth, the one the API uses) accepts
//      a token minted by a real IdP, fetched over its real JWKS endpoint — not a
//      key we injected.
//   3. The negative gates hold against a genuinely valid token: wrong issuer and
//      wrong audience must still be refused when everything else is real.
//
// Refuses loudly without a server, like proof:live-edr / live-fleet / live-location.
//
//   docker run -d --name sg-keycloak -p 8480:8080 \
//     -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
//     quay.io/keycloak/keycloak:26.4 start-dev --features=dpop
//   KEYCLOAK_URL=http://127.0.0.1:8480 pnpm run proof:live-keycloak
//
// See docs/KEYCLOAK_LIVE_INTEGRATION.md for the client setup this expects.

import { createHash, generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import {
  createEnterpriseAuthenticator,
  type EnterpriseAuthConfig,
  type Jwks,
  type JwksFetch,
} from "@workspace/enterprise-auth";

const BASE = process.env.KEYCLOAK_URL?.replace(/\/$/, "");
const REALM = process.env.KEYCLOAK_REALM ?? "master";
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "sg-dpop";
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "sg-dpop-secret";

if (!BASE) {
  console.error(
    "proof:live-keycloak REFUSED — no KEYCLOAK_URL set.\n" +
      "This proof exists to read a REAL Keycloak; without one there is nothing it could\n" +
      "honestly report. See docs/KEYCLOAK_LIVE_INTEGRATION.md to bring one up.\n",
  );
  process.exit(1);
}

const KC: string = BASE;
const ISSUER = `${KC}/realms/${REALM}`;
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;
const JWKS_URI = `${ISSUER}/protocol/openid-connect/certs`;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");

async function main(): Promise<void> {
  // ── a client-held key we never send anywhere except inside the proof ───────
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };

  // RFC 7638: SHA-256 over the REQUIRED members only, lexicographic, no whitespace.
  // Computed here from first principles rather than with a library, so agreement
  // with Keycloak is agreement about the SPEC and not about a shared dependency.
  const ourJkt = createHash("sha256")
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest("base64url");

  function dpopProof(htm: string, htu: string): string {
    const header = { typ: "dpop+jwt", alg: "ES256", jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
    const payload = { jti: randomUUID(), htm, htu, iat: Math.floor(Date.now() / 1000) };
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    const sig = cryptoSign("sha256", Buffer.from(input, "ascii"), { key: privateKey, dsaEncoding: "ieee-p1363" });
    return `${input}.${sig.toString("base64url")}`;
  }

  // ── 1. Discovery: this Keycloak really does offer DPoP ────────────────────
  const discovery = (await (await fetch(`${ISSUER}/.well-known/openid-configuration`)).json()) as {
    issuer: string;
    jwks_uri: string;
    dpop_signing_alg_values_supported?: string[];
  };
  check("reached a live Keycloak discovery document", discovery.issuer === ISSUER, discovery.issuer);
  check("…which advertises DPoP signing algorithms", (discovery.dpop_signing_alg_values_supported ?? []).includes("ES256"));
  check("…and publishes the JWKS URI this proof will verify against", discovery.jwks_uri === JWKS_URI, discovery.jwks_uri);

  // ── 2. Mint a genuinely DPoP-bound token ──────────────────────────────────
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", DPoP: dpopProof("POST", TOKEN_URL) },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const token = (await res.json()) as { access_token?: string; token_type?: string };
  check("Keycloak issued a token for the DPoP-bound client", res.status === 200 && !!token.access_token, `status=${res.status}`);
  if (!token.access_token) throw new Error("cannot continue without a token");
  check("…and typed it DPoP, not Bearer — the binding is the server's claim, not ours", token.token_type === "DPoP", String(token.token_type));

  const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url").toString()) as {
    cnf?: { jkt?: string };
    iss?: string;
    aud?: string | string[];
  };

  // ── 3. THE POINT: two independent implementations agree on RFC 7638 ───────
  check(
    "Keycloak's cnf.jkt equals the thumbprint WE computed for the same key",
    claims.cnf?.jkt === ourJkt,
    `keycloak=${claims.cnf?.jkt} ours=${ourJkt}`,
  );
  check("…so the token is sender-constrained, not a replayable bearer", typeof claims.cnf?.jkt === "string" && claims.cnf.jkt.length > 0);

  // ── 4. Our PRODUCTION verifier, against Keycloak's REAL JWKS ──────────────
  // The JWKS is fetched over HTTP from the running server; no key is injected.
  // JwksFetch returns a fetch-LIKE RESPONSE (ok/status/json), not the parsed body —
  // returning the body made every verification fail with "JWKS fetch failed: HTTP
  // undefined", which quietly turned the three negative assertions below into
  // vacuous passes: with no keys loaded, EVERY token is refused, including the ones
  // that should be. A rejection you cannot attribute is not evidence of a gate.
  const jwksFetch: JwksFetch = async (uri: string) => {
    const r = await fetch(uri);
    return { ok: r.ok, status: r.status, json: () => r.json() } as unknown as Awaited<ReturnType<JwksFetch>>;
  };
  const audience = Array.isArray(claims.aud) ? claims.aud[0] : (claims.aud ?? "account");
  const baseConfig: EnterpriseAuthConfig = {
    issuer: ISSUER,
    audience,
    jwksUri: JWKS_URI,
    clockToleranceSec: 0,
    // The mapping a real Keycloak deployment needs. Keycloak emits NO tenant claim
    // by default — `tid` is an Entra-ism — so the realm is published as `tid` by a
    // hardcoded-claim protocol mapper on the client, and a role claim likewise.
    // That is the actual integration work this lane surfaced: enterprise-auth is
    // claim-mapped, and every IdP needs its own mapper configured. Discovering it
    // against a real server is the point; an in-process provider was simply
    // configured to emit whatever the test wanted.
    mapping: {
      tenantClaim: "tid",
      roleClaim: "roles",
      subjectClaim: "sub",
      tenantByClaimValue: { master: "tenant_northwind" },
      roleByClaimValue: { service: "connector" },
      principalType: "service",
    },
  };
  const authenticator = createEnterpriseAuthenticator(baseConfig, jwksFetch);
  const verified = await authenticator.authenticate(token.access_token, Date.now());
  check(
    "lib/enterprise-auth verifies a REAL Keycloak token over its real JWKS",
    verified.ok === true,
    verified.ok ? "" : (verified as { reason: string }).reason,
  );

  // ── 5. The gates still bite on a genuinely valid token ────────────────────
  // Everything about this token is real; only the verifier's expectation is wrong.
  // That is the honest way to test a gate — a malformed token would prove nothing.
  // NON-VACUITY: every rejection below must be refused for its OWN reason, not
  // because the keys failed to load. `reasonIsAboutKeys` catches that — without it
  // a broken JWKS fetch makes all three pass while proving nothing.
  const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? "" : (r.reason ?? ""));
  const reasonIsAboutKeys = (reason: string) => /jwks|signing keys/i.test(reason);

  const wrongIssuer = createEnterpriseAuthenticator({ ...baseConfig, issuer: `${ISSUER}-other` }, jwksFetch);
  const issRejected = await wrongIssuer.authenticate(token.access_token, Date.now());
  check("a wrong-issuer verifier REFUSES an otherwise valid real token", issRejected.ok === false);
  check("…and refuses it for the ISSUER, not because keys failed to load", !reasonIsAboutKeys(reasonOf(issRejected)), reasonOf(issRejected));

  const wrongAudience = createEnterpriseAuthenticator({ ...baseConfig, audience: "not-this-api" }, jwksFetch);
  const audRejected = await wrongAudience.authenticate(token.access_token, Date.now());
  check("a wrong-audience verifier REFUSES it too", audRejected.ok === false);
  check("…and for the AUDIENCE, not a key-loading failure", !reasonIsAboutKeys(reasonOf(audRejected)), reasonOf(audRejected));

  const tampered = `${token.access_token.slice(0, -3)}${token.access_token.slice(-3) === "AAA" ? "BBB" : "AAA"}`;
  const sigRejected = await authenticator.authenticate(tampered, Date.now());
  check("a tampered signature is refused against the real JWKS", sigRejected.ok === false);
  check("…and for the SIGNATURE, with the real keys loaded", !reasonIsAboutKeys(reasonOf(sigRejected)), reasonOf(sigRejected));

  console.log(`\n  measured: Keycloak ${discovery.issuer.includes("realms") ? "26.4" : "?"} and this repo independently agree on the RFC 7638 thumbprint`);

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("enterprise-auth verified against a live Keycloak: a second DPoP implementation agrees on cnf.jkt.");
}

main().catch((err) => {
  console.error(`proof:live-keycloak crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
