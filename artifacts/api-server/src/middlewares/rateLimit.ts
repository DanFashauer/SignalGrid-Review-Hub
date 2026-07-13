import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CoreError } from "@workspace/signalgrid-core";

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory fixed-window rate limiter. Public-safe and dependency-free;
 * a production deployment would use a shared/distributed limiter. Keyed by
 * bearer token when present, else by client address.
 */
export function rateLimit(
  limit: number,
  windowMs: number,
): RequestHandler {
  const windows = new Map<string, Window>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.bearerToken ?? req.ip ?? "anonymous";
    const now = Date.now();
    const existing = windows.get(key);
    if (!existing || now >= existing.resetAt) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      setHeaders(res, limit, limit - 1);
      next();
      return;
    }
    existing.count += 1;
    const remaining = Math.max(0, limit - existing.count);
    setHeaders(res, limit, remaining);
    if (existing.count > limit) {
      res.setHeader(
        "retry-after",
        String(Math.ceil((existing.resetAt - now) / 1000)),
      );
      throw new CoreError(
        "validation",
        "Rate limit exceeded. Slow down and retry shortly.",
        429,
      );
    }
    next();
  };
}

function setHeaders(res: Response, limit: number, remaining: number): void {
  res.setHeader("x-ratelimit-limit", String(limit));
  res.setHeader("x-ratelimit-remaining", String(remaining));
}
