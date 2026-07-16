// SignalGrid MCP server — the "plugin" path.
//
// Exposes the deterministic decision core + smart-hospital orchestration +
// Signal Radar as Model Context Protocol tools over stdio, so an AI assistant or
// agent can query the grid directly. Runs against the public-safe in-memory demo
// core: no database, no live vendor calls, no real credentials.
//
//   Dev:   pnpm --filter @workspace/mcp-server run dev
//   Build: pnpm --filter @workspace/mcp-server run build   # → dist/index.mjs
//
// MCP client config example:
//   { "command": "node", "args": ["<repo>/artifacts/mcp-server/dist/index.mjs"] }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SignalGridCore } from "@workspace/signalgrid-core";
import { listScenarios, runRoomEntry, tenantForScenario } from "@workspace/room-sim";
import { scanSignals, signalCatalog } from "@workspace/signal-radar";

const core = SignalGridCore.demo();
const demoKeys = core.demoApiKeys();

// One demo token per tenant, so hospital and warehouse scenarios each evaluate
// under their own tenant (cross-tenant evaluation is refused by design).
function tokenForTenant(tenantId: string): string {
  const preferred = demoKeys.find((k) => k.tenantId === tenantId && (k.role === "operator" || k.role === "owner"));
  return (preferred ?? demoKeys.find((k) => k.tenantId === tenantId))?.token ?? "";
}

const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: "signalgrid", version: "0.1.0" });

server.registerTool(
  "list_room_scenarios",
  {
    title: "List trusted-entry scenarios",
    description:
      "List the synthetic Trusted-Entry scenarios across verticals — smart-hospital (a nurse approaching " +
      "a room), warehouse (a picker at a zone), and global-fleet (a driver at a vehicle). Public-safe fixtures.",
    inputSchema: {},
  },
  async () => asText({ scenarios: listScenarios() }),
);

server.registerTool(
  "evaluate_room_entry",
  {
    title: "Evaluate a trusted room entry",
    description:
      "Run the real decision core (identity, device posture, custody, badge, baseline, workflow risk) " +
      "for a scenario, then the orchestration plan (allow/step-up/restrict/deny → downstream actions, " +
      "sensitive actions held for human confirmation). Optionally confirm assist actions or complete a step-up.",
    inputSchema: {
      scenarioId: z.string().describe("A scenario id from list_room_scenarios"),
      confirmedActionIds: z.array(z.string()).optional().describe("Ids of assist actions a clinician has confirmed"),
      stepUpSatisfied: z.boolean().optional().describe("True once a badge tap / biometric step-up is satisfied"),
    },
  },
  async ({ scenarioId, confirmedActionIds, stepUpSatisfied }) => {
    try {
      return asText(
        runRoomEntry(core, tokenForTenant(tenantForScenario(scenarioId)), scenarioId, {
          confirmedActionIds: confirmedActionIds ?? [],
          stepUpSatisfied: stepUpSatisfied ?? false,
        }),
      );
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : "evaluation failed" }],
      };
    }
  },
);

server.registerTool(
  "signal_catalog",
  {
    title: "Signal catalog",
    description: "List the signal categories the grid evaluates today plus known candidate (roadmap) categories.",
    inputSchema: {},
  },
  async () => asText(signalCatalog()),
);

server.registerTool(
  "scan_signals",
  {
    title: "Scan signals (new-signal radar)",
    description:
      "Classify a batch of incoming signals as evaluated / candidate / novel and raise a first-seen alert for " +
      "signal types the grid does not yet use — for discovering new signals to bring into the grid.",
    inputSchema: {
      signals: z
        .array(z.object({ category: z.string(), sourceReference: z.string().optional() }))
        .describe("Incoming signals, each with a category string"),
    },
  },
  async ({ signals }) => asText(scanSignals(signals)),
);

server.registerTool(
  "evaluate_decision",
  {
    title: "Evaluate a decision directly",
    description:
      "Run the decision core for an explicit identity/device/workflow (advanced). Returns the outcome, reason " +
      "codes, and explanation. Uses the public-safe demo tenant.",
    inputSchema: {
      identityRef: z.string().describe("e.g. nurse.compliant"),
      deviceRef: z.string().describe("e.g. ipad-ward-01"),
      workflowKey: z.string().describe("e.g. clinical-session, med-admin, general-lookup"),
    },
  },
  async ({ identityRef, deviceRef, workflowKey }) => {
    try {
      const r = core.evaluate(tokenForTenant("tenant_northwind"), { identityRef, deviceRef, workflowKey });
      return asText({ outcome: r.outcome, reasonCodes: r.reasonCodes, explanation: r.explanation, latencyMs: r.latencyMs });
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : "evaluation failed" }] };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logs; stdout is the MCP transport.
console.error("SignalGrid MCP server ready (stdio). Tools: list_room_scenarios, evaluate_room_entry, signal_catalog, scan_signals, evaluate_decision.");
