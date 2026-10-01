// Fixture IdP proof — OFFLINE, in-process (docs/COMPANY_BUILD_PLAN.md row 28).
//
// scripts/fixture-idp.mjs is the CI-only IdP the deploy-stack gateway smoke
// presents tokens from. Before that smoke is trusted, prove the fixture does
// what the smoke assumes, against lib/enterprise-auth with the SAME claim
// mapping the workflow's OIDC_* variables configure:
//   - a "valid" token verifies and maps to the internal tenant + role;
//   - wrong-audience / expired / unmapped-role tokens are each REFUSED by the
//     same key (the smoke's negative controls are not vacuous);
//   - when the published JWKS key is not the signing key ("other"), the valid
//     token is REFUSED — the property that turns the smoke red on key drift.
import {
  createEnterpriseAuthenticator,
  type EnterpriseAuthConfig,
  type JwksFetch,
} from "@workspace/enterprise-auth";
import { createFixtureIdp, MINT_KINDS } from "../fixture-idp.mjs";

const ISSUER = "http://idp:9000";
const AUDIENCE = "signalgrid-ci";
const NOW_MS = Date.parse("2026-10-01T12:00:00.000Z");

const config: EnterpriseAuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: `${ISSUER}/jwks`,
  clockToleranceSec: 60,
  mapping: {
    tenantClaim: "tid",
    roleClaim: "roles",
    subjectClaim: "sub",
    tenantByClaimValue: { "ci-tenant": "tenant_northwind" },
    roleByClaimValue: { "ci-role": "operator" },
    principalType: "user",
  },
};

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) passed += 1;
  else failures.push(name);
  console.log(`  ${ok ? "ok" : "FAIL"} — ${name}`);
};

function authFor(jwksKey: "signing" | "other") {
  const idp = createFixtureIdp({ issuer: ISSUER, audience: AUDIENCE, jwksKey, nowSec: () => Math.floor(NOW_MS / 1000) });
  const fetchImpl: JwksFetch = async () => ({ ok: true, status: 200, json: async () => idp.jwks });
  return { idp, auth: createEnterpriseAuthenticator(config, fetchImpl) };
}

console.log("Fixture IdP proof");
{
  const { idp, auth } = authFor("signing");
  const valid = await auth.authenticate(idp.mint("valid"), NOW_MS);
  check("valid token verifies", valid.ok);
  check(
    "valid token maps to tenant_northwind / operator",
    valid.ok && valid.principal.tenantId === "tenant_northwind" && valid.principal.role === "operator",
  );
  for (const kind of MINT_KINDS.filter((k: string) => k !== "valid")) {
    const out = await auth.authenticate(idp.mint(kind), NOW_MS);
    check(`${kind} token is refused by the same key`, !out.ok);
  }
  check("discovery document names the issuer and the jwks_uri", idp.discovery.issuer === ISSUER && idp.discovery.jwks_uri === `${ISSUER}/jwks`);
  let threw = false;
  try { idp.mint("not-a-kind"); } catch { threw = true; }
  check("an unknown mint kind throws (no silent default)", threw);
}
{
  const { idp, auth } = authFor("other");
  const out = await auth.authenticate(idp.mint("valid"), NOW_MS);
  check("JWKS serving a different key REFUSES the otherwise-valid token", !out.ok);
}

console.log(`Fixture IdP proof: ${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.error("Failed:", failures.join("; "));
  process.exit(1);
}
