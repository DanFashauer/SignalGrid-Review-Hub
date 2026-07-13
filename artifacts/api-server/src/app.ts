import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestContext } from "./middlewares/context";
import { errorHandler } from "./middlewares/errors";
import { globalRateLimiter } from "./middlewares/rateLimit";

const app: Express = express();

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
  allowedHeaders: ["authorization", "content-type", "x-request-id"],
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
// Coarse limiter ahead of everything so unauthenticated public routes are
// covered; the per-key /v1 limiter still applies its tighter bound downstream.
app.use(globalRateLimiter);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(requestContext);

app.use("/api", router);

// Structured error translation must be registered after the routes.
app.use(errorHandler);

export default app;
