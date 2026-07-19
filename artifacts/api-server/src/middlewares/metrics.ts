// Request-timing middleware: records count + latency for every HTTP request once
// the response finishes. Registered early so it observes the whole pipeline.
import type { Request, Response, NextFunction } from "express";
import { httpRequests, httpDuration, normalizeRoute } from "../lib/metrics";

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = normalizeRoute(req.originalUrl || req.url || "");
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe({ route }, durationSec);
  });
  next();
}
