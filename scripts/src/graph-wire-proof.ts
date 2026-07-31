// Proof: the Graph posture connector over a REAL socket, against hostile responses.
//
// Every other graph assertion runs through an injected mock transport, so the
// connector never touches a network stack: no real status codes, no real headers,
// no real chunked JSON. The matrix's recommended lane here is Microsoft's Dev
// Proxy; this achieves the same end — Graph-authentic 429 / 5xx / paging over a
// real wire — with a local http.Server instead of a new external dependency, and
// it can therefore run in CI unattended.
//
// The interesting case is not the errors. It is PAGE-CAP TRUNCATION.
// `getAllPages` follows `@odata.nextLink` while `pages < pageLimit`, then returns
// what it has. A tenant with more pages than the cap yields a SHORT list that is
// indistinguishable from a complete one — and for a posture connector, a device
// missing from the result reads as "no such device", i.e. no problem. This proof
// pins that the cap holds (it must — it is a loop/DoS guard) and measures exactly
// what the caller can and cannot tell afterwards, so the limitation is recorded
// rather than discovered in production.
//
// Pure and offline: the server is local and deterministic. No account, no vendor.

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { GraphPostureConnector, type GraphTransport, type GraphRequest, type GraphHttpResponse } from "@workspace/integrations/graph";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/** Route table the test server answers from; each case is one hostile behaviour. */
type Mode =
  | { kind: "throttle"; retryAfter: string }
  | { kind: "server-error"; status: number }
  | { kind: "auth"; status: number }
  | { kind: "bad-json" }
  | { kind: "no-value-array" }
  | { kind: "endless-pages" };

let mode: Mode = { kind: "endless-pages" };
let requestCount = 0;

function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      requestCount += 1;
      const send = (status: number, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(body);
      };
      switch (mode.kind) {
        case "throttle":
          return send(429, JSON.stringify({ error: { code: "TooManyRequests" } }), { "retry-after": mode.retryAfter });
        case "server-error":
          return send(mode.status, JSON.stringify({ error: { code: "ServiceUnavailable" } }));
        case "auth":
          return send(mode.status, JSON.stringify({ error: { code: "InvalidAuthenticationToken" } }));
        case "bad-json":
          return send(200, "{ this is not json");
        case "no-value-array":
          return send(200, JSON.stringify({ notValue: [] }));
        case "endless-pages": {
          // Always hands back another nextLink — an unbounded tenant. Each page
          // carries one device so the returned count equals the pages followed.
          const n = requestCount;
          const host = (req.headers.host ?? "").toString();
          return send(
            200,
            JSON.stringify({
              value: [{ id: `dev-${n}`, complianceState: "compliant", managementState: "managed" }],
              "@odata.nextLink": `http://${host}/next/${n + 1}`,
            }),
          );
        }
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function main(): Promise<void> {
  const { server, base } = await startServer();
  const PAGE_LIMIT = 5;

  // A REAL-fetch transport, mirroring the connector's own module-private default
  // (which is not exported). The point is that bytes cross a real socket and the
  // connector sees genuine status codes — passing a mock here would re-test what
  // the mock proofs already cover.
  const realTransport: GraphTransport = async (req: GraphRequest): Promise<GraphHttpResponse> => {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
    return { status: res.status, ok: res.ok, json: () => res.json() };
  };

  const connector = new GraphPostureConnector(
    { accessToken: "test-token", baseUrl: base, pageLimit: PAGE_LIMIT },
    realTransport,
  );

  // ── 1. Page-cap truncation ────────────────────────────────────────────────
  mode = { kind: "endless-pages" };
  requestCount = 0;
  const devices = await connector.listManagedDevices();
  check(
    `the page cap holds against an endless tenant (followed ${devices.length}, cap ${PAGE_LIMIT})`,
    devices.length === PAGE_LIMIT,
    `got ${devices.length}`,
  );
  check(
    "the loop/DoS guard stops the connector — it does not follow nextLink forever",
    requestCount === PAGE_LIMIT,
    `requests=${requestCount}`,
  );
  // RECORDED LIMITATION, asserted so it cannot change unnoticed: the result is a
  // plain array. There is no truncation flag, so a caller CANNOT distinguish a
  // capped read from a complete one. For posture, an absent device reads as "no
  // device" — the caller must treat a full-length result as possibly incomplete.
  check(
    "a capped read returns a plain array with no truncation signal (known limitation)",
    Array.isArray(devices) && !("truncated" in (devices as unknown as Record<string, unknown>)),
  );

  // ── 2. Throttling is surfaced, not silently swallowed ─────────────────────
  // The connector does NOT retry or honour Retry-After; it maps to upstream_error
  // and fails closed. Pinned so that behaviour is a decision, not an accident.
  mode = { kind: "throttle", retryAfter: "30" };
  let threw = false;
  let code = "";
  try {
    await connector.listManagedDevices();
  } catch (e) {
    threw = true;
    code = (e as { code?: string }).code ?? "";
  }
  check("a real 429 over the wire throws rather than returning empty", threw);
  check("429 maps to upstream_error (no silent empty result)", code === "upstream_error", `code=${code}`);

  // ── 3. Server errors ──────────────────────────────────────────────────────
  for (const status of [500, 503]) {
    mode = { kind: "server-error", status };
    let c = "";
    try {
      await connector.listManagedDevices();
    } catch (e) {
      c = (e as { code?: string }).code ?? "";
    }
    check(`HTTP ${status} maps to upstream_error`, c === "upstream_error", `code=${c}`);
  }

  // ── 4. Auth failures are distinguished from generic upstream faults ───────
  for (const status of [401, 403]) {
    mode = { kind: "auth", status };
    let c = "";
    try {
      await connector.listManagedDevices();
    } catch (e) {
      c = (e as { code?: string }).code ?? "";
    }
    check(`HTTP ${status} maps to auth_failed, not upstream_error`, c === "auth_failed", `code=${c}`);
  }

  // ── 5. Malformed payloads fail closed, never yield partial truth ──────────
  mode = { kind: "bad-json" };
  let badJsonCode = "";
  try {
    await connector.listManagedDevices();
  } catch (e) {
    badJsonCode = (e as { code?: string }).code ?? "";
  }
  check("a 200 with unparseable JSON fails closed", badJsonCode === "bad_response", `code=${badJsonCode}`);

  mode = { kind: "no-value-array" };
  let noValueCode = "";
  try {
    await connector.listManagedDevices();
  } catch (e) {
    noValueCode = (e as { code?: string }).code ?? "";
  }
  check(
    "a 200 whose collection has no `value` array fails closed (never treated as zero devices)",
    noValueCode === "bad_response",
    `code=${noValueCode}`,
  );

  server.close();

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Graph connector verified over a real socket: throttling, 5xx, auth and malformed bodies all fail closed.");
}

main().catch((err) => {
  console.error(`proof:graph-wire crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
