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
import {
  ACCURACY_CLASSES,
  FIXTURE_HOSPITAL_GRAPH,
  evaluateLocationCertainty,
  normalizeLocationObservation,
  type AccuracyClass,
  type LocationObservationRaw,
} from "@workspace/facility-trust-graph";

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

server.registerTool(
  "facility_graph",
  {
    title: "Facility Trust Graph (fixture hospital)",
    description:
      "Inspect the canonical space model: list the fixture hospital's spaces, get one space with its " +
      "root-first path, or resolve a VENDOR identifier (cisco / physical_access / ehr / rtls) to the " +
      "space it is attached to. Vendor ids are attachments, never keys — an unmapped id returns null, " +
      "never a guess. Public-safe fixture; no real facility is described.",
    inputSchema: {
      spaceId: z.string().optional().describe("A SignalGrid spaceId to fetch (with its ancestor path)"),
      vendorNamespace: z.string().optional().describe("Vendor namespace, e.g. cisco, physical_access, ehr, rtls"),
      vendorKey: z.string().optional().describe("Vendor key, e.g. zone_id, reader_id, bed"),
      vendorId: z.string().optional().describe("The vendor's identifier value to resolve"),
    },
  },
  async ({ spaceId, vendorNamespace, vendorKey, vendorId }) => {
    const g = FIXTURE_HOSPITAL_GRAPH;
    if (vendorNamespace && vendorKey && vendorId) {
      const hit = g.resolveVendorRef(vendorNamespace, vendorKey, vendorId);
      return asText({ resolved: hit, note: hit === null ? "unmapped vendor id — null, never a guess" : undefined });
    }
    if (spaceId) {
      const node = g.get(spaceId);
      return asText(node === null ? { space: null } : { space: node, path: g.path(spaceId).map((n) => `${n.kind}:${n.spaceId}`) });
    }
    return asText({ mapVersion: g.mapVersion, derived: g.derived, spaces: g.spaces });
  },
);

server.registerTool(
  "evaluate_location_certainty",
  {
    title: "Evaluate location certainty (the multi-bed rule)",
    description:
      "Grade ONE location observation against the precision a workflow requires, over the fixture " +
      "hospital graph. accuracy_class is an ordered ladder (site … room_candidate, room_confirmed, " +
      "bed_candidate, bed_confirmed) and a candidate class never satisfies a confirmed requirement: a " +
      "Wi-Fi room fix against a bed_confirmed workflow steps up (scan the wristband) — 'open every " +
      "patient in the room' is unrepresentable. Wrong map version restricts; unmapped space alerts; " +
      "stale/degraded/unavailable step up. Try: space_id SG-RM0312, accuracy_class room_candidate, " +
      "requiredClass bed_confirmed.",
    inputSchema: {
      space_id: z.string().describe("The observed space, e.g. SG-RM0312 or SG-RM0312-BED-B"),
      accuracy_class: z.enum(ACCURACY_CLASSES as unknown as [string, ...string[]]).describe("Achieved precision"),
      requiredClass: z
        .enum(ACCURACY_CLASSES.filter((c) => c !== "unknown") as unknown as [string, ...string[]])
        .describe("The precision floor this workflow requires"),
      confidence: z.number().min(0).max(1).optional().describe("Source-reported confidence (0..1)"),
      minConfidence: z.number().min(0).max(1).optional().describe("Caller's minimum acceptable confidence"),
      observed_at: z.string().optional().describe("ISO-8601 UTC instant the observation was made"),
      referenceTime: z.string().optional().describe("The caller's 'now' (ISO-8601 UTC) for staleness"),
      maxObservationAgeSeconds: z.number().optional().describe("Maximum acceptable observation age"),
      map_version: z.string().optional().describe("The map the source located against (fixture graph is 2026.07.14)"),
      source_health: z.enum(["healthy", "degraded", "unavailable"]).optional(),
      observation_source: z.string().optional().describe("e.g. cisco_spaces, rtls, scan"),
    },
  },
  async (input) => {
    try {
      const requirement = {
        requiredClass: input.requiredClass as Exclude<AccuracyClass, "unknown">,
        maxObservationAgeSeconds: input.maxObservationAgeSeconds,
        minConfidence: input.minConfidence,
      };
      const raw: LocationObservationRaw = {
        space_id: input.space_id,
        accuracy_class: input.accuracy_class,
        confidence: input.confidence,
        observed_at: input.observed_at,
        map_version: input.map_version ?? FIXTURE_HOSPITAL_GRAPH.mapVersion,
        source_health: input.source_health ?? "healthy",
        observation_source: input.observation_source,
      };
      const normalized = normalizeLocationObservation("mcp-subject", FIXTURE_HOSPITAL_GRAPH, raw, {
        requirement,
        referenceTime: input.referenceTime,
      });
      return asText({ normalized, verdict: evaluateLocationCertainty(normalized, requirement) });
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : "evaluation failed" }] };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logs; stdout is the MCP transport.
console.error("SignalGrid MCP server ready (stdio). Tools: list_room_scenarios, evaluate_room_entry, signal_catalog, scan_signals, evaluate_decision, facility_graph, evaluate_location_certainty.");
