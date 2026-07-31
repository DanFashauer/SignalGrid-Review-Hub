import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { CONSOLE_HTML } from "./console-html";
import { logger } from "./lib/logger";
import { requestContext } from "./middlewares/context";
import { errorHandler } from "./middlewares/errors";
import { globalRateLimiter } from "./middlewares/rateLimit";
import { metricsMiddleware } from "./middlewares/metrics";
import { renderMetrics } from "./lib/metrics";

const app: Express = express();

// Don't advertise the framework — remove the default `X-Powered-By: Express`
// header (minor information disclosure surfaced by the adversarial pass).
app.disable("x-powered-by");

// Explicit CORS allow-list. A bare `cors()` emits `Access-Control-Allow-Origin:
// *`, which would let any web origin script the authenticated /v1 surface from a
// victim's browser. Instead we reflect ONLY origins named in
// `CORS_ALLOWED_ORIGINS` (comma-separated). Requests with no Origin header
// (curl, server-to-server, same-origin) are unaffected; unknown browser origins
// receive no ACAO header and are blocked by the browser. Default: deny all
// cross-origin, which is the safe posture for a review deployment.
const allowedOrigins = (process.env["CORS_ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    // Not on the allow-list: succeed without emitting ACAO so the browser blocks
    // the cross-origin read (never throw — that would surface as a 500).
    callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  // x-enrollment-authorization: the out-of-band enrollment secret header. Without it
  // here, a browser console on an allowed cross-origin deployment with
  // SIGNALGRID_ENROLLMENT_SECRET set would have every correctly-authorized enrollment
  // request blocked at CORS preflight, before the server-side check could even run.
  allowedHeaders: ["authorization", "content-type", "x-request-id", "x-enrollment-authorization"],
  maxAge: 600,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors(corsOptions));
// Record request count + latency for every request (before rate limiting so
// throttled requests are still counted).
app.use(metricsMiddleware);
// Coarse limiter ahead of everything so unauthenticated public routes are
// covered; the per-key /v1 limiter still applies its tighter bound downstream.
app.use(globalRateLimiter);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(requestContext);

// Trusted Room Entry simulation console (Phase 1 smart-hospital demo). Served at
// the root for a friendly local URL: http://localhost:8080/console
app.get(["/", "/console"], (_req, res) => {
  res.type("html").send(CONSOLE_HTML);
});

// Prometheus scrape endpoint (operational metrics). Global AGGREGATE only —
// counters/latencies with no tenant label and no request payloads, so the
// endpoint can never become a cross-tenant side channel. Open by default per
// Prometheus convention; setting METRICS_TOKEN requires scrapers to present it
// as a bearer, without breaking deployments that never set it.
app.get("/metrics", (req, res) => {
  const required = process.env.METRICS_TOKEN?.trim();
  if (required && req.headers.authorization !== `Bearer ${required}`) {
    res.status(401).type("text/plain").send("metrics: bearer token required");
    return;
  }
  res.type("text/plain; version=0.0.4").send(renderMetrics(Date.now()));
});

app.use("/api", router);

// Structured error translation must be registered after the routes.
app.use(errorHandler);

export default app;
