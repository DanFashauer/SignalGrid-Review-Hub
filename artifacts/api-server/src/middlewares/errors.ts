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

  // Body-parser failures (malformed JSON, oversized payload, unsupported
  // charset) are client errors, not server faults. `express.json` throws errors
  // carrying `type`/`status`; map them to a stable 4xx instead of a misleading
  // 500, without echoing the raw parser message (which can include body bytes).
  const parseError = classifyBodyError(err);
  if (parseError) {
    req.log?.info({ code: parseError.error }, "Malformed request body");
    res.status(parseError.status).json({ requestId, ...parseError.payload });
    return;
  }

  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({
    requestId,
    error: "internal",
    message: "An unexpected error occurred.",
  });
};

interface ClassifiedBodyError {
  status: number;
  error: string;
  payload: { error: string; message: string };
}

/**
 * Recognise `express.json()` / body-parser errors and translate them to a safe
 * 4xx with a fixed, non-leaky message. Returns null for anything that isn't a
 * body-parse error so it falls through to the generic 500 handler.
 */
function classifyBodyError(err: unknown): ClassifiedBodyError | null {
  if (!err || typeof err !== "object") {
    return null;
  }
  const candidate = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  const type = typeof candidate.type === "string" ? candidate.type : undefined;
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;

  if (type === "entity.too.large" || status === 413) {
    return {
      status: 413,
      error: "payload_too_large",
      payload: {
        error: "payload_too_large",
        message: "Request body exceeds the allowed size.",
      },
    };
  }

  // entity.parse.failed (bad JSON), charset.unsupported, encoding.unsupported.
  if (
    type === "entity.parse.failed" ||
    type === "charset.unsupported" ||
    type === "encoding.unsupported" ||
    (err instanceof SyntaxError && status === 400)
  ) {
    return {
      status: 400,
      error: "bad_request",
      payload: {
        error: "bad_request",
        message: "Request body could not be parsed as valid JSON.",
      },
    };
  }

  return null;
}
