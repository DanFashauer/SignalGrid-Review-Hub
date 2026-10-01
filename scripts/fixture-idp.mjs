// CI-ONLY fixture identity provider for the packaged-gateway smoke.
//
// WHY THIS EXISTS. The deploy-stack job boots the shared-device-gateway profile
// against a placeholder `.invalid` OIDC issuer, so `scripts/smoke-stack.mjs`
// could only assert the fence (demo bearer 401, /v1/keys 404, readyz 200). No
// signed, mapped token ever completed an allowed /v1 request against the
// PACKAGED container, so a broken JWKS fetch or claim mapping in the packaged
// composition rode under a green job. The positive path was proven only
// in-process (scripts/src/enterprise-auth-proof.ts, artifacts/api-server/test).
//
// WHAT IT IS. A dependency-free (node builtins only) HTTP server that
//   - generates an RSA keypair AT RUNTIME (no key and no token is committed),
//   - serves /jwks and /.well-known/openid-configuration,
//   - mints tokens on /mint?kind=<valid|wrong-audience|expired|unmapped-role>
//     whose iss/aud/tid/roles the CI OIDC_* variables are set to accept.
//
// WHAT IT MUST NEVER BE. Part of any production profile. It is reachable only
// through scripts/fixture-idp.compose.yml (a CI overlay); docker-compose.prod.yml does
// not mention it, and /mint hands anyone a valid credential by design.
//
// `FIXTURE_IDP_JWKS_KEY=other` serves a JWKS whose key (same kid) is NOT the
// signing key. It exists so the smoke's positive branch can be shown to go RED
// when the IdP's published key does not match the tokens it minted.
//
//   node scripts/fixture-idp.mjs serve
//
// Time here is wall-clock on purpose: this is a test double for an external
// IdP, not a decision path, and the api verifies exp/nbf against its own clock.
import { createServer } from "node:http";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { fileURLToPath } from "node:url";

export const KID = "sg-fixture-idp-key-1";

export const MINT_KINDS = ["valid", "wrong-audience", "expired", "unmapped-role"];

const b64url = (input) => Buffer.from(input).toString("base64url");

export function createFixtureIdp({
  issuer,
  audience = "signalgrid-ci",
  idpTenant = "ci-tenant",
  idpRole = "ci-role",
  jwksKey = "signing",
  nowSec = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (!issuer) throw new Error("createFixtureIdp: issuer is required");
  if (jwksKey !== "signing" && jwksKey !== "other") {
    throw new Error(`createFixtureIdp: jwksKey must be "signing" or "other", got "${jwksKey}"`);
  }
  const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const published = jwksKey === "other" ? generateKeyPairSync("rsa", { modulusLength: 2048 }) : signing;
  const jwks = {
    keys: [{ ...published.publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" }],
  };
  const discovery = {
    issuer,
    jwks_uri: `${issuer}/jwks`,
    id_token_signing_alg_values_supported: ["RS256"],
  };

  function mint(kind = "valid") {
    if (!MINT_KINDS.includes(kind)) throw new Error(`unknown mint kind "${kind}"`);
    const now = nowSec();
    const claims = {
      iss: issuer,
      aud: kind === "wrong-audience" ? `${audience}-someone-else` : audience,
      sub: "ci-fixture-user",
      tid: idpTenant,
      roles: [kind === "unmapped-role" ? `${idpRole}-intruder` : idpRole],
      iat: now - 10,
      nbf: now - 10,
      exp: kind === "expired" ? now - 3600 : now + 600,
    };
    const input = `${b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
    const sig = cryptoSign("RSA-SHA256", Buffer.from(input, "ascii"), signing.privateKey);
    return `${input}.${b64url(sig)}`;
  }

  function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://fixture-idp.local");
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
    if (url.pathname === "/healthz") return json(200, { status: "ok" });
    if (url.pathname === "/jwks") return json(200, jwks);
    if (url.pathname === "/.well-known/openid-configuration") return json(200, discovery);
    if (url.pathname === "/mint") {
      const kind = url.searchParams.get("kind") ?? "valid";
      if (!MINT_KINDS.includes(kind)) return json(400, { error: "unknown_kind", kinds: MINT_KINDS });
      return json(200, { token: mint(kind) });
    }
    return json(404, { error: "not_found" });
  }

  return { jwks, discovery, mint, handler };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "serve") {
    console.error("usage: node scripts/fixture-idp.mjs serve");
    process.exit(2);
  }
  const port = Number(process.env.FIXTURE_IDP_PORT ?? 9000);
  const idp = createFixtureIdp({
    issuer: (process.env.FIXTURE_IDP_ISSUER ?? `http://idp:${port}`).replace(/\/$/, ""),
    audience: process.env.FIXTURE_IDP_AUDIENCE ?? "signalgrid-ci",
    idpTenant: process.env.FIXTURE_IDP_TENANT ?? "ci-tenant",
    idpRole: process.env.FIXTURE_IDP_ROLE ?? "ci-role",
    jwksKey: process.env.FIXTURE_IDP_JWKS_KEY ?? "signing",
  });
  createServer(idp.handler).listen(port, "0.0.0.0", () => {
    console.log(`fixture-idp listening on :${port} (issuer ${idp.discovery.issuer}, jwks key: ${process.env.FIXTURE_IDP_JWKS_KEY ?? "signing"})`);
  });
}
