import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { CONSOLE_HTML } from "./console-html";
import { logger } from "./lib/logger";
import { requestContext } from "./middlewares/context";
import { demoSurfacesEnabled } from "./lib/profile";
import { errorHandler } from "./middlewares/errors";
import { globalRateLimiter } from "./middlewares/rateLimit";
import { deprecationHeaders } from "./middlewares/deprecation";
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
// Request id + security headers BEFORE the limiter. This order is load-bearing:
// when the limiter ran first, a global-limit 429 carried NO x-request-id and
// none of the security headers — the one response an operator most needs to
// correlate was the one response that could not be. requestContext is
// header-only and does no auth, so running it for to-be-throttled requests
// costs nothing.
app.use(requestContext);
// Deprecation/Sunset announcements (docs/API_VERSIONING_POLICY.md). Beside the
// other header-only middleware, before the limiter for the same reason as
// requestContext: a throttled caller on a deprecated route still deserves the
// warning headers. The registry is EMPTY today and the tests assert that.
app.use(deprecationHeaders);
// Coarse limiter next, so unauthenticated public routes are covered; the
// per-key /v1 limiter still applies its tighter bound downstream.
app.use(globalRateLimiter);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// Trusted Room Entry simulation console (Phase 1 smart-hospital demo). Served at
// the root for a friendly local URL: http://localhost:8080/console
// Not registered under `shared-device-gateway`: a customer deployment has no
// reason to serve a demo console at its root, and the page renders verdicts with
// no enforced/observed label (Blocker 10).
if (demoSurfacesEnabled()) {
  app.get(["/", "/console"], (_req, res) => {
    res.type("html").send(CONSOLE_HTML);
  });
}

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
