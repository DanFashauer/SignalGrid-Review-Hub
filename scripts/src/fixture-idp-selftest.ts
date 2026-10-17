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
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
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
  // Refused for the RIGHT reason: a token that fails for some other cause
  // (bad signature, malformed claims) must not satisfy a negative control.
  const reasons: Record<string, RegExp> = {
    "wrong-audience": /audience/i,
    "expired": /expired/i,
    "unmapped-role": /no role claim value in \[ci-role-intruder\]/,
  };
  for (const kind of MINT_KINDS.filter((k: string) => k !== "valid")) {
    const out = await auth.authenticate(idp.mint(kind), NOW_MS);
    check(`${kind} token is refused by the same key, for its own reason`, !out.ok && reasons[kind].test(out.reason));
  }
  check("every non-valid mint kind has a pinned reason", MINT_KINDS.filter((k: string) => k !== "valid").every((k: string) => k in reasons));
  check("discovery document names the issuer and the jwks_uri", idp.discovery.issuer === ISSUER && idp.discovery.jwks_uri === `${ISSUER}/jwks`);
  let threw = false;
  try { idp.mint("not-a-kind"); } catch { threw = true; }
  check("an unknown mint kind throws (no silent default)", threw);
}
{
  const { idp, auth } = authFor("other");
  const out = await auth.authenticate(idp.mint("valid"), NOW_MS);
  // The reason matters: a kid miss ("no JWKS key matches kid") would also
  // refuse the token without testing key drift at all.
  check("JWKS serving a different key REFUSES the otherwise-valid token, on the signature", !out.ok && /signature/i.test(out.reason));
}

// ── the SERVED process: env knob + HTTP handler, end to end ───────────────────
// Everything above calls createFixtureIdp() in-process. The deploy-stack job
// runs `serve`, which reads FIXTURE_IDP_JWKS_KEY and answers /mint and /jwks
// over HTTP — a path no in-process check touches. Spawn it for real, fetch its
// own /jwks and /mint, and verify through lib/enterprise-auth. Wall-clock time
// is used here on purpose: the served IdP mints against the wall clock.
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    // Bind the WILDCARD, as `fixture-idp.mjs serve` does (0.0.0.0): a port free on
    // 127.0.0.1 can be held on <eth0> by an outbound connection, and the served IdP
    // then reads EADDRINUSE and never comes up (2026-10-02, cloud box).
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });

async function withServedIdp<T>(jwksKey: string, fn: (issuer: string) => Promise<T>): Promise<T> {
  const port = await freePort();
  const issuer = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../fixture-idp.mjs", import.meta.url)), "serve"], {
    env: {
      ...process.env,
      FIXTURE_IDP_PORT: String(port),
      FIXTURE_IDP_ISSUER: issuer,
      FIXTURE_IDP_AUDIENCE: AUDIENCE,
      FIXTURE_IDP_JWKS_KEY: jwksKey,
    },
    stdio: "ignore",
  });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i += 1) {
      try { up = (await fetch(`${issuer}/healthz`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    if (!up) throw new Error("served fixture IdP did not come up");
    return await fn(issuer);
  } finally {
    child.kill();
  }
}

async function servedOutcome(issuer: string, kind: string) {
  const token = ((await (await fetch(`${issuer}/mint?kind=${kind}`)).json()) as { token: string }).token;
  const served = createEnterpriseAuthenticator(
    { ...config, issuer, jwksUri: `${issuer}/jwks` },
    (uri: string) => fetch(uri),
  );
  return served.authenticate(token, Date.now());
}

await withServedIdp("signing", async (issuer) => {
  const ok = await servedOutcome(issuer, "valid");
  check("served (signing): /mint?kind=valid verifies against the served /jwks", ok.ok);
  const expired = await servedOutcome(issuer, "expired");
  check("served: /mint honours ?kind= (expired is refused as expired)", !expired.ok && /expired/i.test(expired.reason));
});
await withServedIdp("other", async (issuer) => {
  const out = await servedOutcome(issuer, "valid");
  check("served (FIXTURE_IDP_JWKS_KEY=other): the env knob reaches the server — valid token refused on the signature", !out.ok && /signature/i.test(out.reason));
});

console.log(`Fixture IdP proof: ${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.error("Failed:", failures.join("; "));
  process.exit(1);
}
