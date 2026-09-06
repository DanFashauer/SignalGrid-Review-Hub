import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CoreError, type Principal } from "@workspace/signalgrid-core";
import {
  createEnterpriseAuthenticator,
  loadEnterpriseAuthConfig,
  type EnterpriseAuthenticator,
  type JwksFetch,
} from "@workspace/enterprise-auth";
import { core } from "../lib/core";
import { demoSurfacesEnabled } from "../lib/profile";
import { logger } from "../lib/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      bearerToken?: string;
      principal?: Principal;
    }
  }
}

/** The only shape a caller-supplied x-request-id is echoed in: 1–128 chars of
 *  [A-Za-z0-9._-]. Exported so the api test can assert the boundary by value. */
export const REQUEST_ID_SHAPE = /^[A-Za-z0-9._-]{1,128}$/;

/** Attach a request id and standard security headers to every response. */
export const requestContext: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // A caller-supplied id is honoured only when it is shaped like an id. The
  // value is echoed on every response, written into the envelope, and HASHED
  // INTO THE AUDIT CHAIN as the row's provenance — so an unbounded, free-form
  // header let a caller choose the correlation id of a tamper-evident record
  // (COMPANY_BUILD_PLAN row: caller-chosen correlation id; measured with a
  // 429-character forged header landing verbatim in the ledger, 2026-09-05).
  // Anything outside the shape is REPLACED with a minted uuid, not rejected:
  // correlation is a courtesy, never a way to write into the ledger.
  const supplied = req.headers["x-request-id"];
  const requestId =
    typeof supplied === "string" && REQUEST_ID_SHAPE.test(supplied) ? supplied : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "cache-control",
    "no-store, no-cache, must-revalidate, private",
  );
  next();
};

// Enterprise (OIDC) auth is GATED: it initializes only when OIDC_ISSUER +
// OIDC_AUDIENCE + OIDC_JWKS_URI are configured. Unconfigured — the fixture build
// and CI default — leaves `enterpriseAuth` null and the /v1 surface keeps using
// the public-safe demo bearer keys, exactly as before. An INVALID partial config
// stays disabled and logs a warning, so a misconfiguration fails closed to the
// fixture path rather than silently trusting unverified tokens.
// Fetch the IdP's JWKS with a hard timeout, so a hung IdP can't stall requests.
//
// DECLARED BEFORE ITS USE, AND THAT IS LOAD-BEARING. This sat 21 lines BELOW
// the initEnterpriseAuth() call at module load. `function` hoists; `const` does
// not — so when the authenticator was constructed this was still in the
// temporal dead zone, and it was built with an undefined fetch. Every
// enterprise token then failed with "could not load signing keys: fetchImpl is
// not a function", i.e. ENTERPRISE OIDC AUTHENTICATION NEVER WORKED IN
// PRODUCTION. It was invisible because the positive OIDC branch had never
// executed in any test — the exact gap docs/COMPANY_BUILD_PLAN.md row 46
// named, with the exact kind of defect an unexecuted path hides.
//
// Second instance of this class in one day: signalgrid-grid-proof.ts had
// `allowedSignalTypes` declared ~650 lines below the loop that read it. Both
// were silent. Keep initialisation above first use in module scope.
const defaultJwksFetch: JwksFetch = (uri: string) =>
  fetch(uri, { signal: AbortSignal.timeout(5000) });

const enterpriseAuth: EnterpriseAuthenticator | null = initEnterpriseAuth();

function initEnterpriseAuth(): EnterpriseAuthenticator | null {
  const result = loadEnterpriseAuthConfig();
  if (result.status === "enabled") {
    logger.info(
      { issuer: result.config.issuer, jwksUri: result.config.jwksUri },
      "Enterprise OIDC authentication enabled for /v1.",
    );
    return createEnterpriseAuthenticator(result.config, defaultJwksFetch);
  }
  if (result.status === "invalid") {
    logger.warn(
      { reason: result.reason },
      "Enterprise OIDC config is incomplete — staying on demo-key auth (fail-closed).",
    );
  }
  return null;
}


/**
 * Tenant-context + authentication middleware for the /v1 product surface.
 * Resolves `Authorization: Bearer <token>` to a tenant-scoped principal and
 * attaches it to the request. Fail-closed: a missing or unknown token is a 401,
 * never a default tenant.
 *
 * Exactly ONE credential type is accepted, chosen by SERVER configuration (never
 * by the caller): when enterprise OIDC is configured, the bearer MUST be a valid
 * OIDC JWT — it is verified (RS256 signature + issuer/audience/expiry) by
 * `@workspace/enterprise-auth` and its claims mapped to a tenant-scoped principal;
 * anything else is a 401. There is deliberately NO demo-key fallback in that mode,
 * so a caller cannot present a non-JWT to route around OIDC. When OIDC is not
 * configured (the fixture/CI default), the bearer is resolved as a public-safe
 * demo key. Either way the tenant comes only from the authenticated credential.
 */
export const requireTenantContext: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = extractBearer(req);
    if (!token) {
      throw new CoreError(
        "unauthorized",
        "A Bearer token is required.",
        401,
      );
    }

    if (enterpriseAuth) {
      // OIDC is configured ⇒ it is the ONLY accepted credential. This path is
      // linear and fail-closed: `authenticateOrThrow` returns a verified identity
      // or throws a 401 (caught below) — no boolean branch on the caller-supplied
      // token and no fallback to a weaker path, mirroring `core.context`.
      const verified = await enterpriseAuth.authenticateOrThrow(token, Date.now());
      // The raw bearer is consumed ONLY by verification above; it is never stored
      // and never used as the downstream credential. We bind the verified
      // principal under a fresh SERVER-MINTED opaque id and hand that to the rest
      // of the request, so the caller's token cannot flow into the core registry
      // or any later handler.
      const sessionCredential = `oidc_${randomUUID()}`;
      const principal = core.registerVerifiedPrincipal(sessionCredential, {
        tenantId: verified.principal.tenantId,
        role: verified.principal.role,
        subjectId: verified.principal.subjectId,
        principalType: verified.principal.principalType,
        keyReference: verified.keyReference,
      });
      req.bearerToken = sessionCredential;
      req.principal = principal;
      next();
      return;
    }

    // OIDC not configured. Under the review-demo profile that is the fixture/CI
    // default and the public-safe demo keys are the credential. Under any other
    // profile it means a deployment that intends to serve real callers has no identity
    // provider configured — so there is no credential it can legitimately accept, and
    // falling back to a demo key would accept exactly the tokens `/v1/keys` publishes.
    // Refuse rather than degrade. (Mirrors the OIDC branch above, which is already
    // linear and fail-closed with no fallback to a weaker path.)
    if (!demoSurfacesEnabled()) {
      throw new CoreError(
        "unauthorized",
        "This deployment accepts only verified enterprise credentials; no identity provider is configured.",
        401,
      );
    }

    // Fail-closed — an unknown token is a 401, never a default tenant.
    const { principal } = core.context(token);
    req.bearerToken = token;
    req.principal = principal;
    next();
  } catch (err) {
    next(err);
  }
};

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  // Parse without a backtracking-prone regex (avoids ReDoS on crafted headers).
  const prefix = "bearer ";
  if (
    header.length <= prefix.length ||
    header.slice(0, prefix.length).toLowerCase() !== prefix
  ) {
    return null;
  }
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}
