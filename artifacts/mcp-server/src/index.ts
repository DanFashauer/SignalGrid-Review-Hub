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

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEMO_CLOCK_ISO, SignalGridCore } from "@workspace/signalgrid-core";
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
    inputSchema: z.object({}).strict(),
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
      "sensitive actions held for human confirmation). " +
      "`stepUpSatisfied` and `confirmedActionIds` are SIMULATION INPUTS you assert, not ceremonies this " +
      "tool performs: passing stepUpSatisfied:true tells the planner to answer as if a badge tap had " +
      "already succeeded, so the released plan it returns is a what-if and never evidence that anyone " +
      "authenticated. The shipped product path is deliberately stricter — POST /v1/app-workflows/evaluate " +
      "refuses to release on a request-supplied signal at all, and the only release is " +
      "POST /v1/app-workflows/complete-step-up with a verified WebAuthn assertion. Omit both to see the " +
      "fail-closed answer, which is what the grid actually returns until a real ceremony happens.",
    inputSchema: z.object({
      scenarioId: z.string().describe("A scenario id from list_room_scenarios"),
      confirmedActionIds: z.array(z.string()).optional().describe("Ids of assist actions a clinician has confirmed"),
      stepUpSatisfied: z.boolean().optional().describe("True once a badge tap / biometric step-up is satisfied"),
    }).strict(),
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
    inputSchema: z.object({}).strict(),
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
    inputSchema: z.object({
      signals: z
        .array(z.object({ category: z.string(), sourceReference: z.string().optional() }))
        .describe("Incoming signals, each with a category string"),
    }).strict(),
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
    inputSchema: z.object({
      identityRef: z.string().describe("e.g. nurse.compliant"),
      deviceRef: z.string().describe("e.g. ipad-ward-01"),
      workflowKey: z.string().describe("e.g. clinical-session, med-admin, general-lookup"),
    }).strict(),
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
    inputSchema: z.object({
      spaceId: z.string().optional().describe("A SignalGrid spaceId to fetch (with its ancestor path)"),
      vendorNamespace: z.string().optional().describe("Vendor namespace, e.g. cisco, physical_access, ehr, rtls"),
      vendorKey: z.string().optional().describe("Vendor key, e.g. zone_id, reader_id, bed"),
      vendorId: z.string().optional().describe("The vendor's identifier value to resolve"),
    }).strict(),
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
      "TWO NAMING CONVENTIONS, and the split is deliberate rather than sloppy: snake_case fields " +
      "(space_id, accuracy_class, observed_at, map_version, source_health, observation_source) are what " +
      "the SOURCE reported, and camelCase fields (requiredClass, minConfidence, maxObservationAgeSeconds, " +
      "referenceTime) are what YOU require — observation versus policy. Spell them exactly; unknown keys " +
      "are rejected rather than ignored, so a mis-spelled bound can never silently become no bound at all. " +
      "Try: space_id SG-RM0312, accuracy_class room_candidate, requiredClass bed_confirmed.",
    inputSchema: z.object({
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
      source_health: z
        .enum(["healthy", "degraded", "unavailable"])
        .optional()
        .describe("The SOURCE's own reported health. Omit it if the source did not report one — omitted grades as unknown and raises."),
      observation_source: z.string().optional().describe("e.g. cisco_spaces, rtls, scan"),
    }).strict(),
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
    inputSchema: z.object({}).strict(),
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

// ── Agent-plane read surface ─────────────────────────────────────────────────
//
// Everything from here down is EVIDENCE COLLECTION / INSPECTION ONLY — it
// grants nothing. No tool below mutates the core, activates a policy version,
// approves a remediation, or writes to any vendor surface. The core HAS those
// methods (`activatePolicyVersion`, `approveRemediation`, `createPolicyDraft`);
// they are deliberately not registered here, because an agent reading evidence
// must never be one typo away from acting on it. The read paths reuse the
// core's own tenant-scoped, permission-checked methods — there is no side door
// into the store.

const asError = (message: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: message }],
});

/** Shared read-only annotations for the agent-plane tools. `openWorldHint:
 *  false` is a claim the tools can actually keep: every read below is the
 *  in-memory demo core or a committed repository file — nothing leaves the
 *  process. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const INSPECTION_ONLY = "Evidence collection / inspection only — grants nothing.";

const DEFAULT_TENANT = "tenant_northwind";
const DEMO_TENANT_IDS = [...new Set(demoKeys.map((k) => k.tenantId))].sort();
const tenantParam = z
  .string()
  .optional()
  .describe(`Seeded demo tenant to read (default ${DEFAULT_TENANT}). One of: ${DEMO_TENANT_IDS.join(", ")}`);

// ── Reason-code catalog (docs/REASON_CODES.md), parsed at call time ─────────

const REASON_CODES_DOC = "docs/REASON_CODES.md";

interface ReasonCatalogEntry {
  code: string;
  /** Which partition of the catalog the code lives in — launch-surface,
   *  draft-policy-tests-only, or deferred-route-only. The partition matters as
   *  much as the prose: reading a deferred code as launch surface is exactly
   *  the mistake the catalog's own history section documents. */
  section: "launch" | "draft_policy_tests" | "deferred";
  verdicts: string;
  resolutionClass: string;
  workerAction: string;
  operatorAction: string;
  fixture: string;
}

/** Parse the generated reason-code catalog's tables. The document is minted
 *  from the engine by `scripts/gen-reason-codes.mjs` and byte-pinned by
 *  `scripts/check-reason-codes.mjs`, so the table shape is stable — but this
 *  parse still refuses to guess: a row that does not match the pinned shape is
 *  skipped, and the caller sees its code as "not in the catalog" rather than
 *  paired with invented prose. */
function parseReasonCatalog(markdown: string): ReasonCatalogEntry[] {
  const entries: ReasonCatalogEntry[] = [];
  let section: ReasonCatalogEntry["section"] | null = null;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      if (line.includes("Launch-surface codes")) section = "launch";
      else if (line.includes("Draft-policy codes")) section = "draft_policy_tests";
      else if (line.includes("Deferred-path codes")) section = "deferred";
      else section = null;
      continue;
    }
    if (!section) continue;
    const code = line.match(/^\|\s*`([A-Z0-9_]+)`\s*\|/)?.[1];
    if (!code) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;
    entries.push({
      code,
      section,
      verdicts: cells[2] ?? "",
      resolutionClass: cells[3] ?? "",
      workerAction: cells[4] ?? "",
      operatorAction: cells[5] ?? "",
      fixture: cells[6] ?? "",
    });
  }
  return entries;
}

server.registerTool(
  "explain_decision",
  {
    title: "Explain a decision's reason codes",
    description:
      "Given a decision id (minted by THIS process — the demo core is in-memory, so ids do not survive a " +
      "restart) or a bare list of reason codes from an evaluate result, return each code with its catalog " +
      "entry from docs/REASON_CODES.md: verdicts, resolution class, worker- and operator-facing action " +
      "text, and which catalog partition it lives in (launch / draft-policy-tests-only / deferred). The " +
      "catalog is read at call time, never cached. A code absent from the catalog is reported as absent — " +
      "the reason-code set is open by construction (tenant policy rules carry custom codes verbatim), so " +
      "absence means 'not engine-emitted', never 'invalid'. " + INSPECTION_ONLY,
    inputSchema: z.object({
      decisionId: z.string().optional().describe("A decision id minted in this process (e.g. from evaluate_decision)"),
      reasonCodes: z.array(z.string()).optional().describe("Reason codes to explain directly, if you have no decision id"),
      tenantId: tenantParam,
    }).strict(),
    annotations: READ_ONLY,
  },
  async ({ decisionId, reasonCodes, tenantId }) => {
    try {
      if (!decisionId && (!reasonCodes || reasonCodes.length === 0)) {
        return asError("Provide decisionId or a non-empty reasonCodes list — there is nothing to explain otherwise.");
      }
      const doc = readText(REASON_CODES_DOC);
      if (!doc.ok) {
        // Fail loudly: explaining codes WITHOUT the catalog would mean inventing
        // the prose this tool exists to quote.
        return asError(doc.error);
      }
      const catalog = parseReasonCatalog(doc.value);
      let decision: Record<string, unknown> | undefined;
      let codes = reasonCodes ?? [];
      if (decisionId) {
        const d = core.getDecision(tokenForTenant(tenantId ?? DEFAULT_TENANT), decisionId);
        decision = {
          id: d.id,
          outcome: d.outcome,
          explanation: d.explanation,
          policyVersionId: d.policyVersionId,
          createdAt: d.createdAt,
        };
        codes = d.reasonCodes;
      }
      return asText({
        decision,
        reasonCodes: codes.map((code) => {
          const entry = catalog.find((e) => e.code === code) ?? null;
          return {
            code,
            catalog: entry,
            note: entry
              ? undefined
              : "Not in the engine-emitted catalog. The set is open by construction (tenant-authored policy rules push custom codes verbatim), so absence here means 'not engine-emitted', never 'invalid'.",
          };
        }),
        catalogSource: REASON_CODES_DOC,
        catalogCodeCount: catalog.length,
      });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "explain failed");
    }
  },
);

server.registerTool(
  "evidence_freshness",
  {
    title: "Evidence freshness for a decision",
    description:
      "Report when a decision's evidence snapshot was captured, its age, whether its tamper-evident digest " +
      "still verifies, and which core-normalization build stamped it. The demo core runs on a FIXED clock, " +
      "so age is measured against the clock the core itself decided with (" + DEMO_CLOCK_ISO + ") — a " +
      "wall-clock age of a fixture snapshot would be noise, not freshness, and no wall clock is consulted. " +
      INSPECTION_ONLY,
    inputSchema: z.object({
      decisionId: z.string().describe("A decision id minted in this process (e.g. from evaluate_decision)"),
      tenantId: tenantParam,
    }).strict(),
    annotations: READ_ONLY,
  },
  async ({ decisionId, tenantId }) => {
    try {
      const token = tokenForTenant(tenantId ?? DEFAULT_TENANT);
      const decision = core.getDecision(token, decisionId);
      const snapshot = core.getSnapshot(token, decision.evidenceSnapshotId);
      const digestVerified = core.verifyEvidence(token, snapshot.id);
      return asText({
        decisionId: decision.id,
        snapshotId: snapshot.id,
        capturedAt: snapshot.capturedAt,
        decisionCreatedAt: decision.createdAt,
        referenceClock: DEMO_CLOCK_ISO,
        ageSecondsAtReferenceClock: Math.round((Date.parse(DEMO_CLOCK_ISO) - Date.parse(snapshot.capturedAt)) / 1000),
        digestVerified,
        signalsUsed: snapshot.signalsUsed.length,
        sourceReferences: snapshot.sourceReferences,
        policyVersionId: snapshot.policyVersionId,
        // Absence is surfaced as exactly what it means, never coerced to 0 —
        // the field's own contract in the core types.
        coreNormalizationVersion: snapshot.coreNormalizationVersion ?? "unstamped (snapshot predates the provenance stamp)",
      });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "freshness lookup failed");
    }
  },
);

server.registerTool(
  "list_connectors",
  {
    title: "Connector registry and health",
    description:
      "List a demo tenant's seeded connectors with their health fields (status: healthy / degraded / " +
      "never_synced, lastSyncAt, mode, ingestion path, least-privilege permission scope). Pass connectorId " +
      "to also get that connector's sync-run history. All state is the seeded fixture state — 'never_synced' " +
      "means exactly that, and nothing here reaches a live vendor. " + INSPECTION_ONLY,
    inputSchema: z.object({
      tenantId: tenantParam,
      connectorId: z.string().optional().describe("Also return this connector's sync-run history"),
    }).strict(),
    annotations: READ_ONLY,
  },
  async ({ tenantId, connectorId }) => {
    try {
      const token = tokenForTenant(tenantId ?? DEFAULT_TENANT);
      const connectors = core.listConnectors(token).map((c) => ({
        id: c.id,
        kind: c.kind,
        mode: c.mode,
        ingestionMode: c.ingestionMode,
        status: c.status,
        lastSyncAt: c.lastSyncAt,
        permissionScope: c.permissionScope,
      }));
      if (connectorId) {
        return asText({
          connector: connectors.find((c) => c.id === connectorId) ?? null,
          syncRuns: core.listSyncRuns(token, connectorId),
        });
      }
      return asText({ count: connectors.length, connectors });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "connector read failed");
    }
  },
);

server.registerTool(
  "list_policies",
  {
    title: "Policy inventory (seeded versions)",
    description:
      "List a demo tenant's seeded policies, or pass policyId to get one policy with all of its versions " +
      "(status draft / active / superseded, rule count, created-at, content digest). Read-only by " +
      "construction: activation and drafting exist on the core but are deliberately not exposed over MCP. " +
      INSPECTION_ONLY,
    inputSchema: z.object({
      tenantId: tenantParam,
      policyId: z.string().optional().describe("Return this policy with its full version history"),
    }).strict(),
    annotations: READ_ONLY,
  },
  async ({ tenantId, policyId }) => {
    try {
      const token = tokenForTenant(tenantId ?? DEFAULT_TENANT);
      if (policyId) {
        const policy = core.listPolicies(token).find((p) => p.id === policyId);
        if (!policy) return asError(`Policy "${policyId}" not found in ${tenantId ?? DEFAULT_TENANT}.`);
        return asText({
          policy,
          versions: core.listPolicyVersions(token, policyId).map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            createdAt: v.createdAt,
            ruleCount: v.rules.length,
            digest: v.digest,
          })),
        });
      }
      const policies = core.listPolicies(token);
      return asText({ count: policies.length, policies });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "policy read failed");
    }
  },
);

server.registerTool(
  "query_audit",
  {
    title: "Query the audit ledger",
    description:
      "Read a demo tenant's tamper-evident audit chain: filter events by type/subject substring, cap with " +
      "limit (most recent first when capped), and get the chain verification verdict alongside — so a " +
      "filtered read can never quietly outrun the chain's own integrity. Totals are always reported, so a " +
      "capped result cannot be mistaken for the whole ledger. " + INSPECTION_ONLY,
    inputSchema: z.object({
      tenantId: tenantParam,
      type: z.string().optional().describe("Substring match on the event type, e.g. 'policy.' or 'decision.evaluated'"),
      subject: z.string().optional().describe("Substring match on the event subject id"),
      limit: z.number().int().min(1).max(500).optional().describe("Return only the most recent N matching events"),
    }).strict(),
    annotations: READ_ONLY,
  },
  async ({ tenantId, type, subject, limit }) => {
    try {
      const token = tokenForTenant(tenantId ?? DEFAULT_TENANT);
      const all = core.listAudit(token);
      const matching = all.filter(
        (e) => (!type || e.type.includes(type)) && (!subject || e.subject.includes(subject)),
      );
      const events = limit ? matching.slice(-limit) : matching;
      return asText({
        totalRecorded: all.length,
        totalMatching: matching.length,
        returned: events.length,
        chainVerification: core.verifyAudit(token),
        events,
      });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "audit read failed");
    }
  },
);

// ── Bruno contract-plane bridge ──────────────────────────────────────────────
//
// The Bruno collection under artifacts/api-collection is the executable
// contract for the /v1 and control-plane HTTP surfaces. Two tools READ it;
// bruno_collection_run EXECUTES it — not request-by-request against whatever
// server happens to be up, but by delegating to scripts/run-bruno-collection.mjs,
// which boots its own fixture-mode api-server, runs the WHOLE collection under
// both product profiles, and tears the server down. One deterministic harness,
// no partial state, nothing external touched: the only network traffic is
// localhost to a process the harness itself started.

const BRUNO_ROOT = resolve(REPO_ROOT, "artifacts/api-collection");

function listBrunoCollection(): {
  folders: Array<{ path: string; requests: Array<{ file: string; name: string | null }> }>;
} {
  const folders: Array<{ path: string; requests: Array<{ file: string; name: string | null }> }> = [];
  const walk = (rel: string) => {
    const abs = resolve(BRUNO_ROOT, rel);
    const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const requests: Array<{ file: string; name: string | null }> = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".bru")) continue;
      // A request's display name lives in its `meta { name: … }` block; the
      // filename is reported alongside so a missing meta block reads as null,
      // never as a guessed name.
      const text = readFileSync(resolve(abs, e.name), "utf8");
      const meta = text.match(/meta\s*\{([\s\S]*?)\}/);
      const name = meta?.[1]?.match(/^\s*name:\s*(.+?)\s*$/m)?.[1] ?? null;
      requests.push({ file: rel ? `${rel}/${e.name}` : e.name, name });
    }
    if (requests.length > 0 || rel === "") folders.push({ path: rel === "" ? "." : rel, requests });
    for (const d of entries) {
      if (d.isDirectory() && d.name !== "node_modules") walk(rel ? `${rel}/${d.name}` : d.name);
    }
  };
  walk("");
  return { folders };
}

server.registerTool(
  "bruno_collection_list",
  {
    title: "List the Bruno API collection",
    description:
      "Walk artifacts/api-collection (the executable contract for the /v1 and control-plane HTTP surfaces) " +
      "and return every folder with its .bru request files and display names. Listing only — " +
      "bruno_collection_run executes the collection as one harnessed run. " + INSPECTION_ONLY,
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY,
  },
  async () => {
    try {
      return asText({ root: "artifacts/api-collection", ...listBrunoCollection() });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "collection walk failed");
    }
  },
);

server.registerTool(
  "bruno_request_get",
  {
    title: "Get one Bruno request file",
    description:
      "Return the raw content of one .bru request file from artifacts/api-collection, by its " +
      "collection-relative path (from bruno_collection_list). The collection is public-safe by " +
      "construction — sgk_demo_* tokens are intentionally-public fixtures. " + INSPECTION_ONLY,
    inputSchema: z.object({
      path: z.string().describe("Collection-relative path, e.g. v1/decisions-list.bru"),
    }).strict(),
    annotations: READ_ONLY,
  },
  async ({ path }) => {
    try {
      // Containment guard. The collection is public-safe INSIDE its own
      // directory; a relative path that resolves outside it would turn this
      // tool into an arbitrary-file reader, so the resolved path is checked
      // against the collection root before any read happens.
      const target = resolve(BRUNO_ROOT, path);
      if (target !== BRUNO_ROOT && !target.startsWith(BRUNO_ROOT + "/")) {
        return asError(`Path "${path}" resolves outside artifacts/api-collection — refused.`);
      }
      if (!target.endsWith(".bru")) {
        return asError("Only .bru request files are served by this tool.");
      }
      return asText({ path, content: readFileSync(target, "utf8") });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "request read failed");
    }
  },
);

server.registerTool(
  "bruno_collection_run",
  {
    title: "Run the Bruno collection against a fixture server",
    description:
      "Execute the committed API collection as ONE harnessed run: delegates to " +
      "scripts/run-bruno-collection.mjs, which boots its own fixture-mode api-server " +
      "(in-memory demo core, intentionally-public sgk_demo_* tokens), runs every request " +
      "under both product profiles including the negative tests, tears the server down, " +
      "and fails on any transport error, any 5xx, or any failed assertion. Nothing outside " +
      "localhost is touched and no durable state changes — the run IS the evidence. " +
      "Takes on the order of a minute. " + INSPECTION_ONLY,
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY,
  },
  async () => {
    try {
      // The harness owns the whole lifecycle; this tool only relays its
      // verdict. stdio capture is bounded so a runaway log cannot flood the
      // MCP transport.
      const r = spawnSync("node", [resolve(REPO_ROOT, "scripts/run-bruno-collection.mjs")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 5 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const tail = (text: string | null | undefined) =>
        (text ?? "").trim().split("\n").slice(-25).join("\n");
      return asText({
        passed: r.status === 0,
        exitCode: r.status,
        report: tail(r.stdout),
        problems: r.status === 0 ? null : tail(r.stderr),
      });
    } catch (err) {
      return asError(err instanceof Error ? err.message : "collection run failed");
    }
  },
);

// ── Resources: committed repo truth, read lazily ─────────────────────────────
//
// Every resource below reads its file AT REQUEST TIME. Nothing is cached at
// startup, so a server that outlives an edit to the underlying document serves
// the new doctrine, not a stale snapshot. A read that fails throws, and the
// SDK surfaces that as a request error — the absent-collection law again: a
// missing file must never render as an empty document.

function resourceText(uri: URL, mimeType: string, relPath: string) {
  const read = readText(relPath);
  if (!read.ok) throw new Error(read.error);
  return { contents: [{ uri: uri.href, mimeType, text: read.value }] };
}

server.registerResource(
  "reason-codes",
  "signalgrid://reason-codes",
  {
    title: "Reason-code catalog",
    description:
      "docs/REASON_CODES.md — the engine-generated verdict vocabulary (byte-pinned against a fresh " +
      "generation by scripts/check-reason-codes.mjs), partitioned launch / draft-policy-tests / deferred. " +
      "Read from disk at request time.",
    mimeType: "text/markdown",
  },
  async (uri) => resourceText(uri, "text/markdown", REASON_CODES_DOC),
);

server.registerResource(
  "launch-profile",
  "signalgrid://launch-profile",
  {
    title: "Launch profile (JSON summary)",
    description:
      "A JSON summary of scripts/launch-profile.mjs's exported data — the declared launch edge: product, " +
      "criterion, per-surface launch/deferred ids, and the open gaps. Falls back to docs/LAUNCH_PROFILE.md " +
      "(clearly labeled) if the script is not importable.",
    mimeType: "application/json",
  },
  async (uri) => {
    // scripts/launch-profile.mjs is the machine-checked source (a bijection
    // against the repository is enforced by scripts/check-launch-profile.mjs),
    // so import ITS exports rather than paraphrasing the human document. The
    // import is keyed on the file's mtime: node caches modules by URL, and an
    // unkeyed import would pin the FIRST read for the life of the process —
    // exactly the stale-doctrine cache these resources exist to refuse. The
    // mtime key busts the cache only when the file actually changes, so the
    // read stays deterministic with respect to file state.
    const abs = resolve(REPO_ROOT, "scripts/launch-profile.mjs");
    try {
      const mtime = statSync(abs).mtimeMs;
      const mod = await import(`${pathToFileURL(abs).href}?mtime=${mtime}`);
      const surfaces = ((mod.SURFACES ?? []) as Array<Record<string, unknown>>).map((s) => {
        const out: Record<string, unknown> = { key: s.key, derivedFrom: s.derivedFrom };
        for (const [k, v] of Object.entries(s)) {
          if (Array.isArray(v)) {
            out[k] = {
              count: v.length,
              ids: v.map((e) => (e && typeof e === "object" && "id" in e ? (e as { id: unknown }).id : e)),
            };
          }
        }
        return out;
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                source: "scripts/launch-profile.mjs (exported data, imported at request time)",
                launchProfileVersion: mod.LAUNCH_PROFILE_VERSION,
                product: mod.PRODUCT_NAME,
                target: mod.TARGET,
                criterion: mod.CRITERION,
                deferredRationale: mod.DEFERRED_RATIONALE,
                statuses: mod.STATUSES,
                surfaces,
                gaps: ((mod.GAPS ?? []) as Array<Record<string, unknown>>).map((g) => ({
                  id: g.id,
                  surface: g.surface,
                  whatIsMissing: g.whatIsMissing,
                })),
                note:
                  "Summary only. Authoritative totals are derived by scripts/check-launch-profile.mjs and " +
                  "published by proof:launch-profile — never restated by hand.",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      // Fallback ordered per the ratification: exports if importable, else the
      // human document — clearly labeled as the fallback, never silently
      // swapped in as if it were the machine-checked data.
      const reason = err instanceof Error ? err.message : "unknown error";
      const doc = readText("docs/LAUNCH_PROFILE.md");
      if (!doc.ok) {
        throw new Error(`launch profile unavailable both ways: import failed (${reason}); ${doc.error}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `<!-- FALLBACK: scripts/launch-profile.mjs was not importable (${reason}); serving docs/LAUNCH_PROFILE.md -->\n${doc.value}`,
          },
        ],
      };
    }
  },
);

server.registerResource(
  "agent-routines",
  "signalgrid://agent-routines",
  {
    title: "Scheduled agent routines",
    description:
      "docs/agent/scheduled-routines.json — the committed registry of always-on agent lanes: cadence, " +
      "authorizing human, write scope, stop/escalate boundaries, and where firing evidence lands. " +
      "Held against the heartbeat artifacts by scripts/check-scheduled-routines.mjs.",
    mimeType: "application/json",
  },
  async (uri) => resourceText(uri, "application/json", "docs/agent/scheduled-routines.json"),
);

server.registerResource(
  "lab-registry",
  "signalgrid://lab-registry",
  {
    title: "Open-source lab registry",
    description:
      "docs/agent/open-source-lab-registry.json — the registry of open-source lab systems the live lanes " +
      "run against. Written by a parallel lane; if the file is absent the read fails with the path named, " +
      "never with an empty registry.",
    mimeType: "application/json",
  },
  async (uri) => resourceText(uri, "application/json", "docs/agent/open-source-lab-registry.json"),
);

// ── Entry point ──────────────────────────────────────────────────────────────
//
// Guarded so the test suite can import the fully-registered server (and bind
// it to an in-memory transport) without this module seizing stdin. Both real
// entry paths still connect: `tsx src/index.ts` in dev (argv[1] ends in
// index.ts) and the built `dist/index.mjs` bin (argv[1] ends in index.mjs).
const entryBasename = process.argv[1]?.split("/").pop();
if (entryBasename && import.meta.url.endsWith(entryBasename)) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP transport. The Tools sentence
  // must stay ONE string literal: scripts/check-mcp-surface.mjs parses it with
  // `ready \(stdio\)\. Tools: ([^"]+)\."` and holds it against the registered
  // list, so a wrapped/concatenated literal reads as "no ready message" and
  // fails the gate. Resources get their own line for the same reason.
  console.error("SignalGrid MCP server ready (stdio). Tools: list_room_scenarios, evaluate_room_entry, signal_catalog, scan_signals, evaluate_decision, facility_graph, evaluate_location_certainty, fabric_status, explain_decision, evidence_freshness, list_connectors, list_policies, query_audit, bruno_collection_list, bruno_request_get, bruno_collection_run.");
  console.error("Resources: signalgrid://reason-codes, signalgrid://launch-profile, signalgrid://agent-routines, signalgrid://lab-registry.");
}

// Exported for the test suite (test/server.test.ts binds the server to an
// in-memory transport) — nothing else imports this module.
export { server, core, tokenForTenant, DEFAULT_TENANT };
