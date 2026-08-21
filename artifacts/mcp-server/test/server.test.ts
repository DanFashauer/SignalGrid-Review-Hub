// Tests for the SignalGrid MCP server's agent-plane read surface.
//
// The server module is imported WITHOUT starting stdio (its entry point is
// main-guarded), then bound to an in-memory transport and driven through a
// real MCP client — so what is asserted here is the wire-visible contract
// (registration, annotations, results), not implementation internals.
//
// Run: pnpm --filter @workspace/mcp-server run test

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server, core, tokenForTenant, DEFAULT_TENANT } from "../src/index.ts";

const client = new Client({ name: "test-harness", version: "0.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

interface TextContent {
  type: string;
  text: string;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = ((res.content as TextContent[] | undefined) ?? [])[0]?.text ?? "";
  return { res, text, json: () => JSON.parse(text) as Record<string, unknown> };
}

/** The agent-plane tools this change adds. Every one must be registered,
 *  carry the read-only annotations, and say so in its description. */
const NEW_TOOLS = [
  "explain_decision",
  "evidence_freshness",
  "list_connectors",
  "list_policies",
  "query_audit",
  "bruno_collection_list",
  "bruno_request_get",
];

const PREEXISTING_TOOLS = [
  "list_room_scenarios",
  "evaluate_room_entry",
  "signal_catalog",
  "scan_signals",
  "evaluate_decision",
  "facility_graph",
  "evaluate_location_certainty",
  "fabric_status",
];

test("every tool is registered, and no pre-existing tool was dropped", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of [...PREEXISTING_TOOLS, ...NEW_TOOLS]) {
    assert.ok(names.includes(name), `tool "${name}" is not registered`);
  }
});

test("every new tool is read-only per its wire-visible metadata", async () => {
  const { tools } = await client.listTools();
  for (const name of NEW_TOOLS) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool "${name}" missing`);
    assert.equal(tool.annotations?.readOnlyHint, true, `"${name}" must carry readOnlyHint: true`);
    assert.equal(tool.annotations?.openWorldHint, false, `"${name}" must carry openWorldHint: false`);
    assert.match(tool.description ?? "", /grants nothing/, `"${name}" description must carry the inspection-only label`);
  }
});

test("all four resources are registered at their signalgrid:// URIs", async () => {
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  for (const uri of [
    "signalgrid://reason-codes",
    "signalgrid://launch-profile",
    "signalgrid://agent-routines",
    "signalgrid://lab-registry",
  ]) {
    assert.ok(uris.includes(uri), `resource "${uri}" is not registered`);
  }
});

test("reason-codes resource serves the committed catalog document", async () => {
  const res = await client.readResource({ uri: "signalgrid://reason-codes" });
  const first = res.contents[0] as { mimeType?: string; text?: string };
  assert.equal(first.mimeType, "text/markdown");
  assert.match(first.text ?? "", /Reason codes/);
  assert.match(first.text ?? "", /BADGE_REMOVED/);
});

test("launch-profile resource serves the JSON summary imported from the script", async () => {
  const res = await client.readResource({ uri: "signalgrid://launch-profile" });
  const first = res.contents[0] as { mimeType?: string; text?: string };
  assert.equal(first.mimeType, "application/json", "expected the import path, not the doc fallback");
  const body = JSON.parse(first.text ?? "{}");
  assert.equal(typeof body.launchProfileVersion, "number");
  assert.match(String(body.source), /launch-profile\.mjs/);
  assert.ok(Array.isArray(body.surfaces) && body.surfaces.length > 0, "surfaces summary missing");
  assert.ok(Array.isArray(body.gaps), "gaps missing");
});

test("agent-routines and lab-registry resources serve parseable committed JSON", async () => {
  for (const uri of ["signalgrid://agent-routines", "signalgrid://lab-registry"]) {
    const res = await client.readResource({ uri });
    const first = res.contents[0] as { text?: string };
    assert.doesNotThrow(() => JSON.parse(first.text ?? ""), `${uri} did not serve valid JSON`);
  }
});

test("explain_decision maps engine codes to catalog entries and refuses to invent prose", async () => {
  const { json } = await call("explain_decision", { reasonCodes: ["BADGE_REMOVED", "TENANT_CUSTOM_CODE"] });
  const body = json() as {
    reasonCodes: Array<{ code: string; catalog: { section?: string; workerAction?: string } | null; note?: string }>;
  };
  const known = body.reasonCodes.find((r) => r.code === "BADGE_REMOVED");
  assert.ok(known?.catalog, "BADGE_REMOVED must resolve from the catalog");
  assert.equal(known.catalog?.section, "launch");
  assert.ok((known.catalog?.workerAction ?? "").length > 0, "catalog worker action text missing");
  const unknown = body.reasonCodes.find((r) => r.code === "TENANT_CUSTOM_CODE");
  assert.equal(unknown?.catalog, null, "an unknown code must map to null, never invented prose");
  assert.match(unknown?.note ?? "", /open by construction/);
});

test("explain_decision with neither input is an error, not an empty success", async () => {
  const { res } = await call("explain_decision", {});
  assert.equal(res.isError, true);
});

test("explain_decision and evidence_freshness work against a decision minted in-process", async () => {
  const minted = core.evaluate(tokenForTenant(DEFAULT_TENANT), {
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    workflowKey: "clinical-session",
  });
  const explained = (await call("explain_decision", { decisionId: minted.decisionId })).json() as {
    decision?: { outcome?: string };
    reasonCodes: unknown[];
  };
  assert.equal(explained.decision?.outcome, minted.outcome);
  assert.ok(explained.reasonCodes.length > 0);

  const fresh = (await call("evidence_freshness", { decisionId: minted.decisionId })).json() as {
    digestVerified?: boolean;
    capturedAt?: string;
    referenceClock?: string;
    ageSecondsAtReferenceClock?: number;
  };
  assert.equal(fresh.digestVerified, true);
  assert.ok(fresh.capturedAt, "capturedAt missing");
  assert.ok(fresh.referenceClock, "referenceClock missing");
  assert.equal(typeof fresh.ageSecondsAtReferenceClock, "number");
});

test("list_connectors reports seeded health and per-connector sync runs", async () => {
  const body = (await call("list_connectors", {})).json() as {
    count: number;
    connectors: Array<{ id: string; status: string }>;
  };
  assert.ok(body.count > 0, "no connectors listed");
  for (const c of body.connectors) assert.ok(c.status, `connector ${c.id} has no status`);
  const one = (await call("list_connectors", { connectorId: body.connectors[0].id })).json() as {
    connector: { id: string } | null;
    syncRuns: unknown[];
  };
  assert.equal(one.connector?.id, body.connectors[0].id);
  assert.ok(Array.isArray(one.syncRuns));
});

test("list_policies returns seeded policies and their version history", async () => {
  const body = (await call("list_policies", {})).json() as { count: number; policies: Array<{ id: string }> };
  assert.ok(body.count > 0, "no policies listed");
  const one = (await call("list_policies", { policyId: body.policies[0].id })).json() as {
    policy: { id: string };
    versions: Array<{ status: string; ruleCount: number }>;
  };
  assert.equal(one.policy.id, body.policies[0].id);
  assert.ok(one.versions.length > 0, "no policy versions listed");
});

test("query_audit reports totals alongside any capped result, plus chain verification", async () => {
  const body = (await call("query_audit", { limit: 1 })).json() as {
    totalRecorded: number;
    totalMatching: number;
    returned: number;
    chainVerification: unknown;
    events: unknown[];
  };
  assert.equal(typeof body.totalRecorded, "number");
  assert.ok(body.returned <= body.totalMatching, "returned must never exceed totalMatching");
  assert.ok(body.returned <= 1, "limit was not applied");
  assert.ok(body.chainVerification !== undefined, "chain verification missing");
});

test("bruno_collection_list walks the real committed collection", async () => {
  const body = (await call("bruno_collection_list", {})).json() as {
    root: string;
    folders: Array<{ path: string; requests: Array<{ file: string; name: string | null }> }>;
  };
  assert.equal(body.root, "artifacts/api-collection");
  const paths = body.folders.map((f) => f.path);
  assert.ok(paths.includes("v1"), "v1 folder missing from the walk");
  assert.ok(paths.includes("review-demo/v1"), "review-demo/v1 folder missing from the walk");
  const v1 = body.folders.find((f) => f.path === "v1");
  assert.ok(
    v1?.requests.some((r) => r.file === "v1/decisions-list.bru"),
    "v1/decisions-list.bru missing from the v1 folder",
  );
});

test("bruno_request_get serves a real request file and refuses escapes", async () => {
  const ok = (await call("bruno_request_get", { path: "v1/decisions-list.bru" })).json() as {
    path: string;
    content: string;
  };
  assert.match(ok.content, /meta\s*\{/, "served file does not look like a .bru request");

  const escape = await call("bruno_request_get", { path: "../../package.json" });
  assert.equal(escape.res.isError, true, "path traversal must be refused");

  const notBru = await call("bruno_request_get", { path: "bruno.json" });
  assert.equal(notBru.res.isError, true, "non-.bru files must be refused");
});

test("no mutating core surface is exposed as a tool", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const forbidden of names.filter((n) => /activate|approve|create|write|delete|update/.test(n))) {
    assert.fail(`mutating-shaped tool name registered: ${forbidden}`);
  }
});
