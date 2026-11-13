import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs");
export const EVIDENCE_COVERAGE_FIXTURE = path.join(fixtureRoot, "evidence-coverage.html");
const DOCUMENT_PATH = "/evidence-coverage.html";

/** Serve one public artifact, never a URL-derived filesystem path or directory. */
export async function startEvidenceCoverageFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  if (!lstatSync(fixtureRoot).isDirectory() || realpathSync(fixtureRoot) !== fixtureRoot) {
    throw new Error("The public fixture root must be a physical directory");
  }
  const fd = openSync(EVIDENCE_COVERAGE_FIXTURE, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error("The public fixture must be a regular file");
    bytes = readFileSync(fd);
    const named = lstatSync(EVIDENCE_COVERAGE_FIXTURE);
    if (!named.isFile() || named.dev !== opened.dev || named.ino !== opened.ino
      || realpathSync(EVIDENCE_COVERAGE_FIXTURE) !== EVIDENCE_COVERAGE_FIXTURE) {
      throw new Error("The public fixture changed while opening it");
    }
  } finally {
    closeSync(fd);
  }

  let host = "";
  const server = createServer((request, response) => {
    // Match the raw request target; decoding/normalizing it could admit a
    // sibling file, traversal, a query string, or an absolute-form URL.
    if (request.headers.host !== host) {
      response.writeHead(403).end();
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
    } else if (request.url !== DOCUMENT_PATH) {
      response.writeHead(404).end();
    } else {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    }
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The public fixture did not bind a loopback port");
  }
  host = `127.0.0.1:${address.port}`;
  return {
    url: `http://${host}${DOCUMENT_PATH}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
