import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  // `||`, not `??`: the compose pass-through injects "" when the host leaves
  // LOG_LEVEL unset, and pino throws on an empty level at import time — the
  // whole api crash-looped on exactly that (CI, 2026-08-21).
  level: process.env.LOG_LEVEL || "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
