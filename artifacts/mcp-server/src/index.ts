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

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

// ── fabric_status: what the grid models TODAY ────────────────────────────────
//
// DERIVED, never hand-maintained. Every number below is read at call time from
// the generated live-sync manifest and the repository's own documents, so this
// tool cannot quietly drift away from the fabric the way a curated list would.
// The repo's absent-collection law applies: a read that FAILS reports the
// failure, never an empty or zeroed answer that would read as "nothing there".
//
// Both `tsx src/index.ts` (dev) and `dist/index.mjs` (built) sit three levels
// below the repository root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

function readJson<T>(relPath: string): ReadResult<T> {
  try {
    return { ok: true, value: JSON.parse(readFileSync(resolve(REPO_ROOT, relPath), "utf8")) as T };
  } catch (err) {
    return { ok: false, error: `could not read ${relPath}: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}

function readText(relPath: string): ReadResult<string> {
  try {
    return { ok: true, value: readFileSync(resolve(REPO_ROOT, relPath), "utf8") };
  } catch (err) {
    return { ok: false, error: `could not read ${relPath}: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}

/** The verdict vocabulary the ledger actually uses. A row may claim several —
 *  "BUILT (one gap) + COVERED" is a real and common shape — so these are counted
 *  as rows CLAIMING each verdict, never as a partition of the rows. */
const LEDGER_VERDICTS = [
  "BUILT",
  "COVERED",
  "OUT OF SCOPE",
  "POSITIONED",
  "FILED",
  "QUEUED",
  "PENDING",
  "documented_roadmap",
  "REFUSAL",
] as const;

/** Tally the intake ledger's dispositions straight from its table rows.
 *  Reports `rowsWithoutParsedDisposition` so an incomplete parse can never be
 *  mistaken for a complete tally — the same law the fabric applies to a failed
 *  read: silence is reported, never rendered as a clean answer. */
function ledgerSummary(): unknown {
  const read = readText("docs/INTAKE_LEDGER.md");
  if (!read.ok) return { unavailable: read.error };
  const rows = read.value.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const verdictCounts: Record<string, number> = {};
  let highest = 0;
  let unparsed = 0;
  for (const row of rows) {
    const n = Number(row.match(/^\|\s*(\d+)\s*\|/)?.[1] ?? 0);
    if (n > highest) highest = n;
    // The disposition is the bolded verdict in the row's final cell; it is often
    // compound, and carries parenthetical qualifiers.
    const cells = row.split("|");
    const finalCell = cells[cells.length - 2] ?? "";
    const bolded = finalCell.match(/\*\*([^*]+)\*\*/)?.[1];
    if (!bolded) {
      unparsed += 1;
      continue;
    }
    let matchedAny = false;
    for (const verdict of LEDGER_VERDICTS) {
      if (bolded.includes(verdict)) {
        verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
        matchedAny = true;
      }
    }
    if (!matchedAny) unparsed += 1;
  }
  return {
    rowsRecorded: rows.length,
    highestRow: highest,
    rowsWithoutParsedDisposition: unparsed,
    note: "A row may claim more than one verdict (e.g. 'BUILT (one gap) + COVERED'), so these counts are rows claiming each verdict, not a partition of the rows.",
    verdictCounts,
  };
}

/** The owner-supplied and repo-compiled reference catalogs actually on disk. */
function filedCatalogs(): unknown {
  try {
    const files = readdirSync(resolve(REPO_ROOT, "docs/inspiration"))
      .filter((f) => f.endsWith("_CATALOG.md") || f.endsWith("CATALOG.md"))
      .sort();
    return { count: files.length, files };
  } catch (err) {
    return { unavailable: `could not list docs/inspiration: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}

interface SyncManifest {
  manifestVersion?: number;
  fingerprint?: string;
  body?: {
    signalKinds?: string[];
    signalCategories?: string[];
    proofCounts?: Record<string, unknown>;
    mcpTools?: string[];
    contract?: { path?: string; sha256?: string };
  };
}

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
      "stale/degraded/unavailable step up. STATE ONLY WHAT YOU KNOW: every optional field is a CLAIM, " +
      "and omitting one is a non-claim rather than a pass. Omit source_health and the observation " +
      "grades as unknown — that steps up and names source_health in unknownSignals, because a source " +
      "nobody vouched for is not a healthy one. Omit map_version and the match reads 'unassessed' " +
      "instead of being assumed correct. Supply either only when the source actually reported it. " +
      "Try: space_id SG-RM0312, accuracy_class room_candidate, requiredClass bed_confirmed.",
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
      // WHAT THE CALLER DID NOT SAY STAYS UNSAID.
      //
      // These two fields previously defaulted — `source_health ?? "healthy"` and
      // `map_version ?? FIXTURE_HOSPITAL_GRAPH.mapVersion` — and that was an unearned
      // affirmative on the one surface that answers questions directly. Both fields are
      // `.optional()`, and the caller here is an assistant in a chat: it has no way to
      // know an RTLS source's health or which map the source located against, so
      // OMITTING them is the normal case, not the exceptional one.
      //
      // `normalizeLocationObservation` already grades absence correctly and fail-closed:
      // an absent source_health reads "unknown", which pushes a step_up candidate AND
      // records "source_health" in `unknownSignals`; an absent map_version reads
      // "unassessed", which is a legitimate non-claim the grant conjunct accepts. The
      // defaults denied it the chance — they made the two calls below indistinguishable:
      //
      //   caller omits everything        -> sourceHealth "healthy", unknownSignals []
      //   caller asserts healthy + map   -> sourceHealth "healthy", unknownSignals []
      //
      // Identical output, opposite epistemic states, and the omitting caller got
      // SUFFICIENT_CERTAINTY / none / known. Passing the values straight through is the
      // whole fix: the library decides what silence means, and it already knew.
      const raw: LocationObservationRaw = {
        space_id: input.space_id,
        accuracy_class: input.accuracy_class,
        confidence: input.confidence,
        observed_at: input.observed_at,
        map_version: input.map_version,
        source_health: input.source_health,
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

server.registerTool(
  "fabric_status",
  {
    title: "Fabric status — what SignalGrid models today",
    description:
      "Report the CURRENT state of the decision fabric, derived at call time from the generated live-sync " +
      "manifest and the repository's own documents — never a hand-maintained list, so it cannot drift. " +
      "Returns the composable signal kinds and categories the grid fuses, the registered MCP tool surface, " +
      "proof counts, the shared posture-report contract hash, the filed reference catalogs, and the intake " +
      "ledger's disposition tally (how many inputs were assessed and what happened to each). Use this to " +
      "answer 'what does SignalGrid cover now?' without reading the repository. Everything reported is " +
      "fixture-backed and public-safe: no live vendor integration, credential, or tenant data exists here.",
    inputSchema: {},
  },
  async () => {
    const manifest = readJson<SyncManifest>("artifacts/sync/live-sync-manifest.json");
    if (!manifest.ok) {
      // Fail loudly. A zeroed answer here would be the exact unearned
      // affirmative this repository exists to refuse.
      return { isError: true, content: [{ type: "text" as const, text: manifest.error }] };
    }
    const body = manifest.value.body ?? {};
    return asText({
      manifestVersion: manifest.value.manifestVersion,
      manifestFingerprint: manifest.value.fingerprint,
      signalKinds: { count: (body.signalKinds ?? []).length, kinds: body.signalKinds ?? [] },
      signalCategories: { count: (body.signalCategories ?? []).length, categories: body.signalCategories ?? [] },
      mcpTools: body.mcpTools ?? [],
      proofCounts: body.proofCounts ?? {},
      sharedPostureContract: body.contract ?? {},
      filedCatalogs: filedCatalogs(),
      intakeLedger: ledgerSummary(),
      boundary:
        "Public-safe and fixture-backed. Every connector is gated behind tier + SIGNALGRID_LIVE_INTEGRATIONS " +
        "+ a credential + an injected transport this repository does not ship. No vendor partnership, " +
        "certification, or compliance claim is made by this surface.",
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logs; stdout is the MCP transport.
console.error("SignalGrid MCP server ready (stdio). Tools: list_room_scenarios, evaluate_room_entry, signal_catalog, scan_signals, evaluate_decision, facility_graph, evaluate_location_certainty, fabric_status.");
