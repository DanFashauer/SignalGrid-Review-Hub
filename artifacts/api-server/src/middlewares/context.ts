import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CoreError, type Principal } from "@workspace/signalgrid-core";
import {
  createEnterpriseAuthenticator,
  loadEnterpriseAuthConfig,
  looksLikeJwt,
  type EnterpriseAuthenticator,
  type JwksFetch,
} from "@workspace/enterprise-auth";
import { core } from "../lib/core";
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

/** Attach a request id and standard security headers to every response. */
export const requestContext: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const requestId =
    typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : randomUUID();
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

// Fetch the IdP's JWKS with a hard timeout, so a hung IdP can't stall requests.
const defaultJwksFetch: JwksFetch = (uri: string) =>
  fetch(uri, { signal: AbortSignal.timeout(5000) });

/**
 * Tenant-context + authentication middleware for the /v1 product surface.
 * Resolves `Authorization: Bearer <token>` to a tenant-scoped principal and
 * attaches it to the request. Fail-closed: a missing or unknown token is a 401,
 * never a default tenant.
 *
 * Two credential types are accepted. When enterprise OIDC is configured and the
 * bearer is a JWT, it is verified (RS256 signature + issuer/audience/expiry) by
 * `@workspace/enterprise-auth`, its claims are mapped to a tenant-scoped
 * principal, and that principal is bound to the token for the rest of the
 * request. Otherwise the bearer is resolved as a public-safe demo key. Either
 * way the tenant comes only from the authenticated credential, never the client.
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
        "A Bearer token is required. Use one of the public-safe demo keys.",
        401,
      );
    }

    if (enterpriseAuth && looksLikeJwt(token)) {
      const outcome = await enterpriseAuth.authenticate(token, Date.now());
      if (!outcome.ok) {
        throw new CoreError("unauthorized", `Enterprise authentication failed: ${outcome.reason}`, 401);
      }
      // Bind the externally-verified principal to the token so every downstream
      // core method resolves it, then attach for logging + handlers.
      const principal = core.registerVerifiedPrincipal(token, {
        tenantId: outcome.principal.tenantId,
        role: outcome.principal.role,
        subjectId: outcome.principal.subjectId,
        principalType: outcome.principal.principalType,
        keyReference: outcome.keyReference,
      });
      req.bearerToken = token;
      req.principal = principal;
      next();
      return;
    }

    // Resolve the demo key now so downstream logging and handlers share it.
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
