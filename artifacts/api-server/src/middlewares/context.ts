import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CoreError, type Principal } from "@workspace/signalgrid-core";
import { core } from "../lib/core";

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

/**
 * Tenant-context + authentication middleware for the /v1 product surface.
 * Resolves `Authorization: Bearer <token>` to a tenant-scoped principal and
 * attaches it to the request. Fail-closed: a missing or unknown token is a 401,
 * never a default tenant.
 */
export const requireTenantContext: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractBearer(req);
  if (!token) {
    throw new CoreError(
      "unauthorized",
      "A Bearer token is required. Use one of the public-safe demo keys.",
      401,
    );
  }
  // Resolve the principal now so downstream logging and handlers share it.
  const { principal } = core.context(token);
  req.bearerToken = token;
  req.principal = principal;
  next();
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
