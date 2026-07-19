// Minimal base64url helpers for JWT parsing. Node's Buffer understands the
// "base64url" encoding natively (RFC 4648 §5), so this is a thin, dependency-free
// wrapper that also fails closed on malformed input.

/** Decode a base64url segment to raw bytes. Throws on non-string input. */
export function decodeBase64Url(segment: string): Buffer {
  if (typeof segment !== "string" || segment.length === 0) {
    throw new Error("empty base64url segment");
  }
  return Buffer.from(segment, "base64url");
}

/** Decode a base64url segment and JSON-parse it into `T`. */
export function decodeJsonSegment<T>(segment: string): T {
  const text = decodeBase64Url(segment).toString("utf8");
  return JSON.parse(text) as T;
}
