// Proof: the Graph posture connector over a REAL socket, against hostile responses.
//
// Every other graph assertion runs through an injected mock transport, so the
// connector never touches a network stack: no real status codes, no real headers,
// no real chunked JSON. The matrix's recommended lane here is Microsoft's Dev
// Proxy; this achieves the same end — Graph-authentic 429 / 5xx / paging over a
// real wire — with a local http.Server instead of a new external dependency, and
// it can therefore run in CI unattended.
//
// The interesting case is not the errors. It is PAGE-CAP TRUNCATION, and this
// proof is what found it. `getAllPages` follows `@odata.nextLink` while
// `pages < pageLimit`; it USED TO return what it had, so a tenant with more pages
// than the cap yielded a SHORT list indistinguishable from a complete one — and for
// a posture connector a device missing from the result reads as "no such device",
// i.e. no problem. That measurement drove the fix across all eleven paginating
// connectors: a capped read now REFUSES (`incomplete_read`) rather than passing a
// partial inventory off as a whole one. Both halves are asserted here — the refusal,
// and that a tenant which FITS still reads normally, so the cap never became a wall.
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
  | { kind: "endless-pages" }
  | { kind: "finite-pages" };

const FINITE_PAGES = 3;
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
        case "finite-pages": {
          // A tenant that FITS: stops handing back nextLink before the cap.
          const host = (req.headers.host ?? "").toString();
          const more = requestCount < FINITE_PAGES;
          return send(
            200,
            JSON.stringify({
              value: [{ id: `fin-${requestCount}`, complianceState: "compliant", managementState: "managed" }],
              ...(more ? { "@odata.nextLink": `http://${host}/next/${requestCount + 1}` } : {}),
            }),
          );
        }
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
  let cappedCode = "";
  let cappedMessage = "";
  try {
    await connector.listManagedDevices();
  } catch (e) {
    cappedCode = (e as { code?: string }).code ?? "";
    cappedMessage = e instanceof Error ? e.message : "";
  }
  check(
    "the loop/DoS guard still stops the connector — it does not follow nextLink forever",
    requestCount === PAGE_LIMIT,
    `requests=${requestCount}`,
  );
  // This assertion used to record the OPPOSITE, and that is the history worth
  // keeping: it pinned "a capped read returns a plain array with no truncation
  // signal (known limitation)" — a caller could not tell a capped read from a
  // complete one, and for posture an absent device reads as "no device". This proof
  // is what surfaced that defect; when the fix landed across all eleven paginating
  // connectors, this assertion failed and said so.
  check(
    "a capped read now REFUSES rather than returning a partial inventory as a whole one",
    cappedCode === "incomplete_read",
    `code=${cappedCode || "(no throw — the silent-truncation fail-open is back)"}`,
  );
  check(
    "…and the refusal names the remedy instead of just failing",
    /pageLimit/.test(cappedMessage),
    cappedMessage.slice(0, 80),
  );

  // The cap must not become a wall: a tenant that FITS still reads normally.
  mode = { kind: "finite-pages" };
  requestCount = 0;
  const finite = await connector.listManagedDevices();
  check(
    "a tenant inside the cap still returns its devices, no throw",
    finite.length === FINITE_PAGES,
    `got ${finite.length}`,
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
