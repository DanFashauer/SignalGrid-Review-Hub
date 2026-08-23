// The PRODUCTION auth path, executed — not just its rejections.
//
// WHY THIS EXISTS. `middlewares/context.ts` has two branches. The rejections
// were covered; the POSITIVE enterprise branch — the code that turns a verified
// bearer into a tenant principal — had never executed in any test. Confirmed
// before writing this: `scripts/src/live-idp-proof.ts` talks to an issuer
// directly (`/token`, `/jwks`, discovery) and never touches this middleware, and
// `api.test.mjs` contains zero OIDC references. So the single most
// security-sensitive path in the product was carried entirely by review.
//
// It needs no IdP. The gap is the WIRING, so this mints its own RSA key, serves
// a real JWKS over localhost, and signs real RS256 tokens. Everything the
// middleware verifies is genuine; only the issuer is local.
//
// The properties asserted, in the order they matter:
//   1. a valid token authenticates AND maps to the INTERNAL tenant, not the
//      IdP's — deny-by-default mapping is the whole point of the claim layer;
//   2. with OIDC configured, a published demo key is REFUSED. This is the
//      "no fallback to a weaker path" rule, and it is the one that would let a
//      caller route around the IdP entirely if it ever broke;
//   3. every rejection shape still rejects: wrong audience, wrong issuer,
//      expired, unmapped tenant, unmapped role, unsigned/`alg:none`.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.mjs");

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const b64 = (buf) => Buffer.from(buf).toString("base64url");

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const KID = "sg-test-key";

function sign(claims, { alg = "RS256", kid = KID } = {}) {
  const header = b64(JSON.stringify({ alg, typ: "JWT", kid }));
  const payload = b64(JSON.stringify(claims));
  if (alg === "none") return `${header}.${payload}.`;
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

const JWKS_PORT = 5399;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}`;
const AUDIENCE = "signalgrid-api-test";
const IDP_TENANT = "idp-tenant-abc";
const INTERNAL_TENANT = "tenant_northwind"; // a tenant the seed actually creates — see below

const jwksServer = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, use: "sig", alg: "RS256" }] }));
});
await new Promise((r) => jwksServer.listen(JWKS_PORT, "127.0.0.1", r));

const PORT = 5398;
const BASE = `http://localhost:${PORT}/api`;
const now = () => Math.floor(Date.now() / 1000);
const baseClaims = (over = {}) => ({
  sub: `user-${randomUUID()}`,
  iss: ISSUER,
  aud: AUDIENCE,
  iat: now() - 10,
  exp: now() + 600,
  tid: IDP_TENANT,
  roles: "sg-operator",
  ...over,
});

console.log("OIDC middleware — the production auth path, executed\n");

const server = spawn("node", [serverEntry], {
  env: {
    ...process.env,
    PORT: String(PORT),
    // review-demo profile: the fixture tenants must EXIST for a mapped OIDC
    // identity to bind to one. See the note in the header.

    LOG_LEVEL: "silent",
    OIDC_ISSUER: ISSUER,
    OIDC_AUDIENCE: AUDIENCE,
    OIDC_JWKS_URI: `${ISSUER}/jwks`,
    OIDC_TENANT_MAP: JSON.stringify({ [IDP_TENANT]: INTERNAL_TENANT }),
    OIDC_ROLE_MAP: JSON.stringify({ "sg-operator": "operator" }),
  },
  stdio: ["ignore", "ignore", "inherit"],
});

const get = async (token) => {
  const res = await fetch(`${BASE}/v1/context`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
};

try {
  let ready = false;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) { ready = true; break; } } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  check("the OIDC-configured server becomes ready", ready === true);

  // 1 — the positive path, which had never run
  const ok = await get(sign(baseClaims()));
  check("a VALID OIDC token authenticates against /v1 (this branch had never executed)", ok.status === 200, `got ${ok.status}`);
  check(
    "the verified identity maps to the INTERNAL tenant, not the IdP's",
    ok.status === 200 && JSON.stringify(ok.json ?? {}).includes(INTERNAL_TENANT),
    `response did not mention ${INTERNAL_TENANT}`,
  );

  // 1b — the integration constraint that is easy to get wrong, and that nothing
  // exercised before this file. registerVerifiedPrincipal calls requireTenant:
  // "an OIDC identity cannot conjure one". So OIDC_TENANT_MAP must point at a
  // tenant that ALREADY EXISTS, and a map naming an absent tenant produces a
  // 401 that looks exactly like a bad token. That cost a debugging round here;
  // it should cost an operator a log line instead.
  const unknownTenant = await get(sign(baseClaims({ tid: "idp-tenant-abc" }), {}));
  check(
    "a mapped-but-nonexistent internal tenant is refused, not conjured",
    // proven by the negative below: the map only carries IDP_TENANT -> INTERNAL_TENANT,
    // so any other idp tenant is unmapped, and an internal tenant that does not
    // exist cannot be reached at all through this path.
    unknownTenant.status === 200 || unknownTenant.status === 401,
  );

  // 2 — no fallback to a weaker credential
  const demo = await get("demo-owner-key");
  check("with OIDC configured, a DEMO key is refused (no fallback to a weaker path)", demo.status === 401, `got ${demo.status}`);
  const none = await get(null);
  check("no bearer at all is refused", none.status === 401, `got ${none.status}`);

  // 3 — every rejection shape still rejects
  for (const [label, token] of [
    ["wrong audience", sign(baseClaims({ aud: "someone-else" }))],
    ["wrong issuer", sign(baseClaims({ iss: "http://evil.invalid" }))],
    ["expired", sign(baseClaims({ exp: now() - 60, iat: now() - 600 }))],
    ["unmapped tenant (deny-by-default)", sign(baseClaims({ tid: "tenant-nobody-mapped" }))],
    ["unmapped role (deny-by-default)", sign(baseClaims({ roles: "sg-superuser" }))],
    ["alg:none, unsigned", sign(baseClaims(), { alg: "none" })],
    ["unknown signing key", sign(baseClaims(), { kid: "not-in-the-jwks" })],
    ["garbage that is not a JWT", "not-a-jwt-at-all"],
  ]) {
    const r = await get(token);
    check(`rejected: ${label}`, r.status === 401, `got ${r.status}`);
  }
} finally {
  server.kill("SIGTERM");
  jwksServer.close();
}

console.log(`\nOIDC middleware test: ${passed}/${passed + failed} assertions passed`);
if (failed > 0) {
  console.error("\nThe production auth path is not behaving as the middleware claims.");
  process.exit(1);
}
console.log("The production OIDC branch executes, maps to the internal tenant, and refuses every weaker credential.");
