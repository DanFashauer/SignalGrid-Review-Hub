// api-client-react proof — the generated web client's ONE hand-written file,
// custom-fetch.ts, is the boundary every console query crosses, and until this
// proof it had no test: a package that ships to signalgrid-app with zero proofs and
// zero gates naming it. Two defects lived there for its whole life:
//
//   1. An off-vocabulary `responseType` ("JSON", "xml", a typo from untyped JS)
//      fell out of the switch and RESOLVED `undefined` AS SUCCESS — body never read,
//      no throw, react-query holding a resolved query with no data.
//   2. A 200 with NO content-type was handed back as a raw string on the success
//      path (the error path already tried JSON), so `health.status` read undefined
//      and a captive-portal HTML page typed itself as the caller's result.
//
// Offline: `fetch` is stubbed with a canned Response per case. No network.

import { customFetch, ApiError, ResponseParseError } from "@workspace/api-client-react";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function respond(status: number, body: string | null, headers: Record<string, string> = {}): void {
  // A STRING body makes undici stamp `text/plain;charset=UTF-8` on the response,
  // so "no content-type" has to be built from bytes: a Uint8Array body gets none.
  const payload = body === null ? null : new TextEncoder().encode(body);
  globalThis.fetch = (async () => new Response(payload, { status, headers })) as typeof fetch;
}

async function outcome<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await p };
  } catch (error) {
    return { error };
  }
}

async function main(): Promise<void> {
  console.log("api-client-react proof — the fetch boundary refuses what it cannot vouch for\n");

  // ── the happy path, so the refusals below are not "everything throws" ───────
  respond(200, '{"status":"ok"}', { "content-type": "application/json" });
  const ok = await outcome(customFetch<{ status: string }>("/api/healthz"));
  check("JSON with a JSON content-type parses", ok.value?.status === "ok");

  respond(200, "plain words", { "content-type": "text/plain" });
  const text = await outcome(customFetch<string>("/api/healthz"));
  check("text with a text content-type is returned as text", text.value === "plain words");

  respond(204, null);
  check("204 resolves null (no body to parse)", (await outcome(customFetch("/api/healthz"))).value === null);

  // ── 1. an off-vocabulary responseType is refused, never resolved as success ──
  respond(200, '{"status":"ok"}', { "content-type": "application/json" });
  const bad = await outcome(customFetch("/api/healthz", { responseType: "JSON" as unknown as "json" }));
  check("responseType \"JSON\" (wrong case) THROWS instead of resolving undefined", bad.error instanceof TypeError && "value" in bad === false);
  check("…and the error names the offending value", bad.error instanceof TypeError && bad.error.message.includes('"JSON"'));
  const xml = await outcome(customFetch("/api/healthz", { responseType: "xml" as unknown as "json" }));
  check("responseType \"xml\" throws too", xml.error instanceof TypeError);

  // ── 2. a 200 with NO content-type ────────────────────────────────────────────
  respond(200, '{"status":"degraded","integrations":[]}');
  const untyped = await outcome(customFetch<{ status: string }>("/api/healthz"));
  check("JSON-shaped body with no content-type is PARSED (not handed back as a string)",
    typeof untyped.value === "object" && untyped.value?.status === "degraded");

  respond(200, "<html>captive portal login</html>");
  const portal = await outcome(customFetch<{ status: string }>("/api/healthz"));
  check("non-JSON body with no content-type is REFUSED with ResponseParseError (a captive portal cannot type itself as the result)",
    portal.error instanceof ResponseParseError);
  check("…and the raw body travels with the error for diagnosis",
    portal.error instanceof ResponseParseError && portal.error.rawBody.includes("captive portal"));

  respond(200, "{not json", {});
  const broken = await outcome(customFetch("/api/healthz"));
  check("JSON-shaped but unparseable body with no content-type is refused, not returned", broken.error instanceof ResponseParseError);

  respond(200, "   ");
  check("whitespace-only body with no content-type resolves null", (await outcome(customFetch("/api/healthz"))).value === null);

  // ── explicit responseType still wins over the header ─────────────────────────
  respond(200, "raw text", {});
  check("responseType \"text\" returns the text even with no content-type (the caller said what it wanted)",
    (await outcome(customFetch<string>("/api/healthz", { responseType: "text" }))).value === "raw text");

  // ── non-2xx is always an ApiError, whatever the body says ────────────────────
  respond(503, '{"status":"ok"}', { "content-type": "application/json" });
  const down = await outcome(customFetch("/api/healthz"));
  check("503 throws ApiError even when the body claims status ok", down.error instanceof ApiError && down.error.status === 503);

  const total = passed + failures.length;
  console.log(`\napi-client-react proof: ${passed}/${total} assertions passed`);
  if (failures.length > 0) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("The web client's fetch boundary refuses an unknown responseType and an untyped non-JSON body instead of minting a result.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
