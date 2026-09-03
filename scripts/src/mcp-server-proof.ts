// Proof: the MCP server this repo PUBLISHES actually boots and answers.
//
// `artifacts/mcp-server` is the plugin path — the decision core exposed as Model
// Context Protocol tools over stdio, so an assistant can query the grid directly.
// `artifacts/sync/live-sync-manifest.json` DECLARES its tools to external
// builders, and `check-live-sync` hard-fails if that list drifts from the source.
//
// But the manifest is derived by scraping `server.registerTool("...")` out of the
// file. That proves those string literals exist. It does not prove the server
// starts, speaks the protocol, or that any handler returns something rather than
// throwing — and nothing else did either: the server was typechecked and bundled,
// and never once run. A published integration whose only evidence is that its
// source contains the right strings is exactly the kind of claim this repo
// otherwise refuses to make.
//
// So this boots it as a real subprocess and talks to it with the REAL MCP client
// from `@modelcontextprotocol/sdk` — the same library an actual consumer uses —
// over a real stdio transport. Not an in-process import: importing the module
// would skip the transport, which is the part most likely to be wrong.
//
// It drives `src/index.ts` through tsx rather than `dist/index.mjs`, so it tests
// what is committed rather than whatever was last built, and needs no build step.
//
// Pure and offline: the server runs the in-memory demo core — no database, no
// vendor calls, no credentials.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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

/** Text payload of a tool result, parsed — every tool here answers JSON as text. */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  // cwd is the SERVER's own package, not the repo root: `tsx` is a devDependency
  // of artifacts/mcp-server and is not resolvable from the root, so spawning from
  // there fails with ERR_MODULE_NOT_FOUND before the server ever starts. This is
  // also how a real client would launch it — the published config in the server's
  // header points at that directory.
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "src/index.ts"],
    cwd: resolve(repo, "artifacts/mcp-server"),
  });
  const client = new Client({ name: "signalgrid-proof", version: "0.0.0" });

  await client.connect(transport);
  check("the published MCP server boots and completes a real protocol handshake", true);

  // ── 1. The declared surface is the served surface ──────────────────────────
  // The manifest tells external builders which tools exist. Until now that was
  // asserted from source text; this asks the running server.
  const manifest = JSON.parse(readFileSync(resolve(repo, "artifacts/sync/live-sync-manifest.json"), "utf8")) as {
    body: { mcpTools: string[] };
  };
  const declared = [...manifest.body.mcpTools].sort();
  const served = (await client.listTools()).tools.map((t) => t.name).sort();

  check(
    "every tool the sync manifest DECLARES is actually served",
    declared.every((t) => served.includes(t)),
    `declared=${declared.join(",")} served=${served.join(",")}`,
  );
  check(
    "…and the server serves nothing the manifest does not declare",
    served.every((t) => declared.includes(t)),
    `served=${served.join(",")}`,
  );

  // ── 2. Each tool actually answers ──────────────────────────────────────────
  // The set of tools this proof actually EXERCISES (calls and reads an answer
  // from). It is a subset of the served surface on purpose — bruno_collection_run
  // and the read-only agent-plane tools are covered by other proofs and by
  // artifacts/mcp-server/test/server.test.ts — so the closing sentence names the
  // measured number rather than implying it answered "each one" of the whole set.
  const exercised = new Set<string>();
  const answer = async (name: string, args: Record<string, unknown> = {}) => {
    exercised.add(name);
    return payload(await client.callTool({ name, arguments: args }));
  };
  const scenarios = await answer("list_room_scenarios", {});
  const scenarioList = (scenarios.scenarios ?? []) as { id?: string }[];
  check("list_room_scenarios returns scenarios", Array.isArray(scenarioList) && scenarioList.length > 0,
    `count=${scenarioList.length}`);

  const firstId = scenarioList[0]?.id ?? "";
  check("…and each carries an id the other tools can take", firstId.length > 0, firstId);

  const entry = await answer("evaluate_room_entry", { scenarioId: firstId });
  check(
    "evaluate_room_entry runs the real decision core and returns a verdict",
    JSON.stringify(entry).length > 2 && /allow|step_up|restrict|deny/.test(JSON.stringify(entry)),
    JSON.stringify(entry).slice(0, 90),
  );

  const catalog = await answer("signal_catalog", {});
  check("signal_catalog returns the signal vocabulary", JSON.stringify(catalog).length > 2);

  // scan_signals REQUIRES a signals array — calling it with `{}` is rejected, which
  // is the schema doing its job. (My first version passed `{}` and read the
  // rejection as a broken tool; the server was right and the test was wrong.)
  const scan = await answer("scan_signals", {
    signals: [{ category: "device_compliance" }, { category: "totally_novel_category" }],
  });
  check("scan_signals classifies a batch of incoming signals", JSON.stringify(scan).length > 2, JSON.stringify(scan).slice(0, 80));

  const decision = await answer("evaluate_decision", {
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    workflowKey: "clinical-session",
  });
  check(
    "evaluate_decision returns an outcome with reason codes",
    typeof decision.outcome === "string" && Array.isArray(decision.reasonCodes),
    JSON.stringify(decision).slice(0, 90),
  );

  // A required argument that is missing must be REFUSED, not defaulted into a
  // cheerful answer — the schema is part of the safety surface, not decoration.
  let missingArgRefused = false;
  try {
    const bad = await client.callTool({ name: "scan_signals", arguments: {} });
    missingArgRefused = (bad as { isError?: boolean }).isError === true;
  } catch {
    missingArgRefused = true;
  }
  check("a call missing a required argument is refused by the schema", missingArgRefused);

  // ── 3. A bad input is refused, not answered with a fabricated verdict ──────
  // The failure that would matter: an unknown scenario producing a cheerful
  // allow. Either an error or an explicit refusal is fine; a permissive verdict
  // is not.
  let refused = false;
  let refusalText = "";
  try {
    const bogus = await client.callTool({ name: "evaluate_room_entry", arguments: { scenarioId: "no-such-scenario" } });
    refusalText = JSON.stringify(payload(bogus));
    // Assert the ERROR flag directly. The earlier disjunction accepted "no
    // 'outcome':'allow' in the text" as a pass — and payload() returns {} for a
    // non-JSON body, so that disjunct was satisfiable by garbage (an empty
    // object trivially lacks an allow verdict). The handler catches an unknown
    // scenario and returns isError:true, so that is the exact, non-vacuous claim.
    refused = (bogus as { isError?: boolean }).isError === true;
  } catch (e) {
    refused = true;
    refusalText = e instanceof Error ? e.message : String(e);
  }
  check("an unknown scenario is refused — never answered with an allow", refused, refusalText.slice(0, 90));

  await client.close();

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `The published MCP server boots, serves exactly the declared tools, and answers each of the ${exercised.size} it exercises here.`,
  );
}

main().catch((err) => {
  console.error(`proof:mcp-server crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
