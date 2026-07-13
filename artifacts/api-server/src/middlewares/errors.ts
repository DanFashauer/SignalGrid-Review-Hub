import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { CoreError } from "@workspace/signalgrid-core";

/**
 * Structured error translator. Maps domain errors from the core to safe HTTP
 * responses with a stable shape, and never leaks internal detail or stack
 * traces to clients. Express 5 forwards rejected promises here automatically.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const requestId = req.requestId ?? null;

  if (err instanceof CoreError) {
    if (err.status >= 500) {
      req.log?.error({ err }, "Core error");
    } else {
      req.log?.info({ code: err.code }, "Request rejected");
    }
    res.status(err.status).json({
      requestId,
      error: err.code,
      message: err.message,
    });
    return;
  }

  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({
    requestId,
    error: "internal",
    message: "An unexpected error occurred.",
  });
};
