import { CoreError } from "@workspace/signalgrid-core";
import { mapClaimsToPrincipal, type PrincipalInput } from "./claims";
import { looksLikeJwt, type EnterpriseAuthConfig } from "./config";
import { createJwksCache, type JwksCache, type JwksFetch } from "./jwks";
import { verifyJwtRs256 } from "./jwt";

/**
 * End-to-end enterprise bearer authentication: fetch (and cache) the IdP's
 * signing keys, verify the RS256 signature + registered claims, then map the
 * verified claims to an internal principal. Every failure is returned as a
 * typed, fail-closed `{ ok: false, reason }` — never a thrown 500 and never a
 * silent default identity.
 */

export interface EnterpriseAuthOutcome {
  ok: boolean;
}
export type AuthenticateResult =
  | { ok: true; principal: PrincipalInput; keyReference: string }
  | { ok: false; reason: string };

export interface VerifiedIdentity {
  principal: PrincipalInput;
  keyReference: string;
}

export interface EnterpriseAuthenticator {
  /** Result-returning form — used by tests/proofs to assert the accept/reject matrix. */
  authenticate(token: string, nowMs: number): Promise<AuthenticateResult>;
  /**
   * Throw-based form for request handlers: returns a verified identity, or throws
   * a fail-closed `CoreError(401)`. The caller stays purely linear (no boolean
   * guard on the caller-supplied token), mirroring the demo-key resolver.
   */
  authenticateOrThrow(token: string, nowMs: number): Promise<VerifiedIdentity>;
}

export function createEnterpriseAuthenticator(
  config: EnterpriseAuthConfig,
  jwksFetch: JwksFetch,
  jwksCacheOverride?: JwksCache,
): EnterpriseAuthenticator {
  const jwks: JwksCache = jwksCacheOverride ?? createJwksCache(config.jwksUri, jwksFetch);

  return {
    async authenticate(token: string, nowMs: number): Promise<AuthenticateResult> {
      // Cheap structural pre-check so a non-JWT bearer (e.g. a demo key) is
      // rejected here WITHOUT a JWKS fetch. This is not a security gate — the
      // signature/claim verification below is — it just avoids needless network.
      if (!looksLikeJwt(token)) {
        return { ok: false, reason: "bearer is not a JWT" };
      }
      let keys;
      try {
        keys = await jwks.get(nowMs);
      } catch (err) {
        return { ok: false, reason: `could not load signing keys: ${(err as Error).message}` };
      }

      const verified = verifyJwtRs256(token, {
        jwks: keys,
        issuer: config.issuer,
        audience: config.audience,
        nowMs,
        clockToleranceSec: config.clockToleranceSec,
      });
      if (!verified.ok) {
        return { ok: false, reason: verified.reason };
      }

      const mapped = mapClaimsToPrincipal(verified.claims, config.mapping);
      if (!mapped.ok) {
        return { ok: false, reason: mapped.reason };
      }

      // Non-secret display reference for logs/audit — the subject, never the token.
      const keyReference = `oidc:${mapped.principal.subjectId}`;
      return { ok: true, principal: mapped.principal, keyReference };
    },

    async authenticateOrThrow(token: string, nowMs: number): Promise<VerifiedIdentity> {
      const outcome = await this.authenticate(token, nowMs);
      if (!outcome.ok) {
        throw new CoreError("unauthorized", `Enterprise authentication failed: ${outcome.reason}`, 401);
      }
      return { principal: outcome.principal, keyReference: outcome.keyReference };
    },
  };
}
