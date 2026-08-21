// MCP ANSWER DISCIPLINE — is what the server serves EARNED?
//
// WHY THERE ARE TWO MCP PROOFS, because that looks like duplication and is not.
// Both lanes independently found the MCP server under-covered on the same day and
// both wrote a proof; the add/add conflict is recorded in `docs/LANE_COORDINATION.md`
// as the second collision of exactly the kind that file exists to prevent. They were
// kept as a pair rather than one being discarded, because they ask different
// questions and each is blind to the other's failure:
//
//   proof:mcp-server (Mac lane, scripts/src/mcp-server-proof.ts)
//       Does the PUBLISHED plugin path boot, complete a real handshake through the
//       vendor's own SDK client, and serve exactly the tools the live-sync manifest
//       declares to external builders? Catches: a server that does not start, a
//       handler that throws, a manifest that has drifted from the served surface.
//
//   proof:mcp-answer-discipline (this file)
//       Given that it serves, is the ANSWER earned? Catches: a tool that boots
//       perfectly, serves its declared name, returns well-formed JSON — and
//       manufactures an affirmative the caller never asserted.
//
// A server can pass either one while failing the other. This file speaks the wire
// directly rather than through the SDK, deliberately: the SDK is the right tool for
// proving a consumer can talk to us, and the wrong one for proving the bytes are
// honest, since it would only demonstrate that the vendor's client and the vendor's
// server agree with each other.
//
// WHY THIS ONE EXISTS. `scripts/check-mcp-surface.mjs` covers the server too, but
// that gate is a NAME-drift check: it asserts the server, the ready message,
// `docs/RUN_ON_MAC.md` and the live-sync manifest all list the same eight tool
// names. A tool can pass that gate while returning a confidently wrong answer,
// and one did — see THE HEADLINE below.
//
// The gap was not academic. `evaluate_location_certainty` defaulted two optional
// inputs before handing them to the decision library:
//
//     map_version:   input.map_version   ?? FIXTURE_HOSPITAL_GRAPH.mapVersion
//     source_health: input.source_health ?? "healthy"
//
// The caller of an MCP tool is an assistant in a chat. It has no way to know an
// RTLS source's health, so omitting the field is the NORMAL case — and the server
// answered every one of those calls as though the source had been confirmed
// healthy. `normalizeLocationObservation` grades an absent source_health as
// "unknown", which raises to step_up and names the axis in `unknownSignals`; the
// default denied it the chance. Two calls in opposite epistemic states — one that
// asserted nothing, one that asserted everything — returned byte-identical
// verdicts of SUFFICIENT_CERTAINTY / none / known, with `unknownSignals` empty.
// That is the unearned affirmative, on the surface that answers questions
// directly, and it is the exact shape this repository keeps finding.
//
// WHAT THIS PROOF DOES. It speaks newline-delimited JSON-RPC to a spawned
// `artifacts/mcp-server`, over the same transport a chat client uses. No MCP SDK
// dependency is added to `@workspace/scripts` — the wire IS the contract, and
// testing it through the vendor's client object would prove the client agrees with
// the server rather than that the server is right.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM. It covers the location tool deeply (the
// dimension that had the defect), plus the wire surface, determinism and error
// honesty across the registered set. It does NOT yet enumerate the optional-input
// space of `evaluate_room_entry` or `evaluate_decision`; both were read during this
// work and their optional inputs default FAIL-CLOSED (`confirmedActionIds ?? []`,
// `stepUpSatisfied ?? false`), which is the safe direction, but "was read once" is
// not a gate. Recorded here so a future lane reads this as scope not yet covered
// rather than scope already proven.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// DERIVED, not hardcoded: the casing pin below asserts the tool's snake_case inputs are
// exactly the observation keys the library recognizes. Importing the list means the pin
// tracks the type it mirrors instead of becoming a second copy that can drift from it.
import { LOCATION_OBSERVATION_KEYS } from "@workspace/facility-trust-graph";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MCP_DIR = resolve(REPO_ROOT, "artifacts/mcp-server");
const PROTOCOL_VERSION = "2025-06-18";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}${detail === undefined ? "" : `  [${detail}]`}`); }
};

console.log("MCP server behavioural proof (real stdio wire)");

// ── a minimal MCP stdio client ───────────────────────────────────────────────
//
// MCP's stdio transport is newline-delimited JSON-RPC 2.0 (NOT the Content-Length
// framing LSP uses). One message per line, no embedded newlines. That is the whole
// protocol surface this proof needs, which is why it can be written without a
// dependency.
interface Rpc { jsonrpc: "2.0"; id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }

class McpStdio {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Rpc) => void; reject: (e: Error) => void }>();
  private exited: string | null = null;

  constructor() {
    const local = resolve(MCP_DIR, "node_modules/.bin/tsx");
    if (!existsSync(local)) {
      throw new Error(`tsx not found at ${local} — run \`pnpm install\` before this proof`);
    }
    this.child = spawn(local, ["src/index.ts"], {
      cwd: MCP_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    // The server writes its human-readable ready banner to stderr; it is not part
    // of the protocol stream and must never be parsed as one.
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", () => { /* banner + logs, deliberately ignored */ });
    this.child.on("exit", (code, signal) => {
      this.exited = `server exited early (code=${code} signal=${signal})`;
      for (const [, p] of this.pending) p.reject(new Error(this.exited));
      this.pending.clear();
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length === 0) continue;
      let msg: Rpc;
      try { msg = JSON.parse(line) as Rpc; } catch { continue; }
      if (typeof msg.id === "number") {
        const waiter = this.pending.get(msg.id);
        if (waiter) { this.pending.delete(msg.id); waiter.resolve(msg); }
      }
    }
  }

  private write(payload: unknown): void {
    if (this.exited !== null) throw new Error(this.exited);
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  notify(method: string, params: unknown = {}): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown = {}): Promise<Rpc> {
    const id = this.nextId++;
    return new Promise<Rpc>((res, rej) => {
      // A hung server must fail this proof, never hang CI behind the job timeout
      // where the cause is invisible.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`no response to ${method} within 30s`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); res(r); },
        reject: (e) => { clearTimeout(timer); rej(e); },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  async handshake(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "signalgrid-mcp-proof", version: "0" },
    });
    this.notify("notifications/initialized");
  }

  close(): void { this.child.kill("SIGTERM"); }
}

/** One tool call, returned both as raw text (for byte-identity assertions) and parsed. */
interface ToolResult { isError: boolean; text: string; json: Record<string, unknown> | null }

async function callTool(mcp: McpStdio, name: string, args: unknown): Promise<ToolResult> {
  const rpc = await mcp.request("tools/call", { name, arguments: args });
  const result = (rpc.result ?? {}) as { isError?: boolean; content?: { type: string; text?: string }[] };
  const text = result.content?.map((c) => c.text ?? "").join("") ?? "";
  const rpcErrored = rpc.error !== undefined;
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
  return { isError: rpcErrored || result.isError === true, text, json };
}

const LOCATION_TOOL = "evaluate_location_certainty";
/** The observation every case below varies from: a room-confirmed fix meeting a
 *  room-confirmed requirement. Every axis the tool grades is otherwise satisfied,
 *  so any raise is attributable to the field under test. */
const BASE = { space_id: "SG-RM0312", accuracy_class: "room_confirmed", requiredClass: "room_confirmed" } as const;
const FIXTURE_MAP_VERSION = "2026.07.14";

const norm = (r: ToolResult): Record<string, unknown> =>
  (r.json?.["normalized"] as Record<string, unknown> | undefined) ?? {};
const verdict = (r: ToolResult): Record<string, unknown> =>
  (r.json?.["verdict"] as Record<string, unknown> | undefined) ?? {};
const unknownSignals = (r: ToolResult): string[] => {
  const v = verdict(r)["unknownSignals"] ?? norm(r)["unknownSignals"];
  return Array.isArray(v) ? (v as string[]) : [];
};

const EXPECTED_TOOLS = [
  "list_room_scenarios",
  "evaluate_room_entry",
  "signal_catalog",
  "scan_signals",
  "evaluate_decision",
  "facility_graph",
  "evaluate_location_certainty",
  "fabric_status",
  // The DR-008 agent-plane additions (all read-only by doctrine — a tool
  // appearing here without readOnly discipline still fails the checks below):
  "explain_decision",
  "evidence_freshness",
  "list_connectors",
  "list_policies",
  "query_audit",
  "bruno_collection_list",
  "bruno_request_get",
  "bruno_collection_run",
];

const mcp = new McpStdio();
try {
  await mcp.handshake();

  // ── 1. the wire surface actually registers what the static gate reads ──────
  //
  // `check-mcp-surface.mjs` derives the tool list from SOURCE TEXT. This asserts
  // the running server registers exactly those names — a tool that fails to
  // register (a throwing module-level init, a name typo'd in one place only)
  // passes the static gate and disappears here.
  const listed = await mcp.request("tools/list");
  const tools = ((listed.result as { tools?: { name: string }[] } | undefined)?.tools ?? []).map((t) => t.name);
  check(`server registers exactly the ${EXPECTED_TOOLS.length} expected tools over the wire`,
    tools.length === EXPECTED_TOOLS.length && EXPECTED_TOOLS.every((t) => tools.includes(t)),
    `got ${tools.length}: ${tools.join(", ")}`);

  // ── 2. THE HEADLINE — silence is not an affirmative ───────────────────────
  const omitted = await callTool(mcp, LOCATION_TOOL, BASE);
  check("THE HEADLINE: omitting source_health grades the source as unknown, NOT healthy",
    norm(omitted)["sourceHealth"] === "unknown",
    `sourceHealth=${String(norm(omitted)["sourceHealth"])}`);
  check("...and the unstated axis is NAMED in unknownSignals rather than silently passed",
    unknownSignals(omitted).includes("source_health"),
    `unknownSignals=${JSON.stringify(unknownSignals(omitted))}`);
  check("...and the verdict RAISES: a source nobody vouched for cannot yield a grant",
    verdict(omitted)["recommendedAction"] === "step_up" && verdict(omitted)["state"] === "degraded",
    `action=${String(verdict(omitted)["recommendedAction"])} state=${String(verdict(omitted)["state"])}`);

  // ── 3. an unstated map version is RECORDED as unstated ─────────────────────
  //
  // Deliberately NOT asserted as a raise. `positivelyCertain` accepts
  // "unassessed" as a legitimate non-claim: the map version is a property of the
  // source's own frame, not a risk signal, so never claiming one is not held
  // against the caller — while claiming a WRONG one restricts. What must never
  // happen is the server inventing the graph's own version and reporting
  // "matched", because that makes the evidence lie even where the verdict agrees.
  check("an omitted map_version reads 'unassessed' — the server does not silently match it against the graph's own version",
    norm(omitted)["mapVersionMatch"] === "unassessed",
    `mapVersionMatch=${String(norm(omitted)["mapVersionMatch"])}`);

  // ── 4. the direct regression test for the defect ──────────────────────────
  const asserted = await callTool(mcp, LOCATION_TOOL, {
    ...BASE, source_health: "healthy", map_version: FIXTURE_MAP_VERSION,
  });
  check("THE REGRESSION TEST: asserting nothing and asserting everything are DISTINGUISHABLE (a `??` default makes them byte-identical — that is how the defect presented)",
    omitted.text !== asserted.text);

  // ── 5. anti-vacuity: the grant is still reachable when it is EARNED ────────
  //
  // Without this, a tool that stepped up unconditionally would satisfy every
  // assertion above. The affirmative must be available to a caller who states it.
  check("ANTI-VACUITY: a caller that ASSERTS a healthy source and the matching map still earns the grant",
    verdict(asserted)["recommendedAction"] === "none" &&
      verdict(asserted)["reasonCode"] === "SUFFICIENT_CERTAINTY" &&
      verdict(asserted)["state"] === "known",
    `action=${String(verdict(asserted)["recommendedAction"])} reason=${String(verdict(asserted)["reasonCode"])}`);
  check("...and that earned grant reports NO unknown axes",
    unknownSignals(asserted).length === 0,
    `unknownSignals=${JSON.stringify(unknownSignals(asserted))}`);

  // ── 6. per-axis attribution ───────────────────────────────────────────────
  //
  // Sections 2–5 vary two fields at once, so on their own they cannot say WHICH
  // one raised. These isolate each.
  const onlyHealthOmitted = await callTool(mcp, LOCATION_TOOL, { ...BASE, map_version: FIXTURE_MAP_VERSION });
  check("ATTRIBUTION: with the map version stated, omitting source_health ALONE still raises",
    verdict(onlyHealthOmitted)["recommendedAction"] === "step_up" &&
      norm(onlyHealthOmitted)["mapVersionMatch"] === "matched",
    `action=${String(verdict(onlyHealthOmitted)["recommendedAction"])}`);
  const onlyMapOmitted = await callTool(mcp, LOCATION_TOOL, { ...BASE, source_health: "healthy" });
  check("ATTRIBUTION: with the source stated healthy, omitting map_version alone does NOT raise — it is recorded unassessed",
    verdict(onlyMapOmitted)["recommendedAction"] === "none" &&
      norm(onlyMapOmitted)["mapVersionMatch"] === "unassessed",
    `action=${String(verdict(onlyMapOmitted)["recommendedAction"])} match=${String(norm(onlyMapOmitted)["mapVersionMatch"])}`);

  // ── 7. an ASSERTED bad state still raises through the wire ────────────────
  //
  // The unknown path and the asserted-bad path are different branches; proving one
  // says nothing about the other.
  for (const [health, why] of [["degraded", "SOURCE_DEGRADED"], ["unavailable", "SOURCE_UNAVAILABLE"]] as const) {
    const r = await callTool(mcp, LOCATION_TOOL, { ...BASE, source_health: health, map_version: FIXTURE_MAP_VERSION });
    check(`an asserted '${health}' source raises with ${why}`,
      verdict(r)["recommendedAction"] === "step_up" && verdict(r)["reasonCode"] === why,
      `action=${String(verdict(r)["recommendedAction"])} reason=${String(verdict(r)["reasonCode"])}`);
  }

  // ── 8. the multi-bed rule the tool description advertises ─────────────────
  //
  // A candidate class never satisfies a confirmed requirement. This is the claim
  // the tool makes about itself in its own description, checked over the wire.
  const candidate = await callTool(mcp, LOCATION_TOOL, {
    space_id: "SG-RM0312", accuracy_class: "room_candidate", requiredClass: "bed_confirmed",
    source_health: "healthy", map_version: FIXTURE_MAP_VERSION,
  });
  check("THE MULTI-BED RULE: a room_candidate fix never satisfies a bed_confirmed requirement",
    verdict(candidate)["recommendedAction"] === "step_up",
    `action=${String(verdict(candidate)["recommendedAction"])}`);

  // ── 9. a wrong map version is a different failure than an absent one ──────
  const wrongMap = await callTool(mcp, LOCATION_TOOL, {
    ...BASE, source_health: "healthy", map_version: "1999.01.01",
  });
  check("a CLAIMED but wrong map version is refused, and is not conflated with never having claimed one",
    verdict(wrongMap)["recommendedAction"] !== "none" &&
      norm(wrongMap)["mapVersionMatch"] === "mismatched",
    `action=${String(verdict(wrongMap)["recommendedAction"])} match=${String(norm(wrongMap)["mapVersionMatch"])}`);

  // ── 10. determinism: no clock, no randomness on the answer path ───────────
  const again = await callTool(mcp, LOCATION_TOOL, { ...BASE, source_health: "healthy", map_version: FIXTURE_MAP_VERSION });
  check("the same arguments twice return byte-identical text (no clock or randomness in the answer path)",
    again.text === asserted.text);

  // ── 11. error honesty: a bad input errors, it does not answer confidently ──
  const badSpace = await callTool(mcp, LOCATION_TOOL, { ...BASE, space_id: "SG-DOES-NOT-EXIST", source_health: "healthy" });
  check("an unmapped space is surfaced as a conflict, never as a grant",
    verdict(badSpace)["recommendedAction"] !== "none",
    `action=${String(verdict(badSpace)["recommendedAction"])}`);
  const badEnum = await callTool(mcp, LOCATION_TOOL, { ...BASE, accuracy_class: "definitely_a_bed" });
  check("an out-of-enum accuracy_class is REJECTED rather than coerced into an answer",
    badEnum.isError);
  const badScenario = await callTool(mcp, "evaluate_room_entry", { scenarioId: "no-such-scenario" });
  check("evaluate_room_entry reports an unknown scenario as an error rather than inventing a decision",
    badScenario.isError);

  // ── 12. the read-only tools answer without arguments ──────────────────────
  //
  // Cheap, but it is the difference between "registered" and "works": a tool that
  // throws on invocation still appears in tools/list.
  for (const readOnly of ["list_room_scenarios", "signal_catalog", "facility_graph", "fabric_status"]) {
    const r = await callTool(mcp, readOnly, {});
    check(`${readOnly} answers without arguments`, !r.isError && r.json !== null);
  }

  // ── 13. THE STRICTNESS CONTRACT — advertised, and now actually enforced ────
  //
  // Every tool published `additionalProperties: false` and enforced none of it. The
  // SDK wraps a raw shape with `z.object(shape)`, and zod's default for an object is
  // STRIP: an unknown key is silently dropped and the call proceeds.
  //
  // That is not a robustness nit, and it is worse than the `?? "healthy"` defect above,
  // because there the caller said nothing. Here the caller DID pose a bound — correctly
  // deciding the observation needed a freshness limit — and spelled it in the OTHER
  // convention this same tool uses. Measured on the real wire before the fix, against an
  // observation dated 2020 with the caller's own reference instant in 2026:
  //
  //   max_observation_age_seconds: 60  ->  DROPPED. recency "unbounded", SUFFICIENT_CERTAINTY, none
  //   maxObservationAgeSeconds:    60  ->  recency "stale", LOCATION_STALE, step_up
  //
  // A 6.5-year-stale fix graded as sufficient certainty, because a key fell on the floor.
  // Every droppable field is one that would TIGHTEN the verdict (an absent bound reads
  // `unbounded`, which satisfies the grant conjunct), so the loss is one-directional: no
  // mis-spelling can ever raise. And the core already applies exactly this law one layer
  // down — `normalizeLocationObservation` runs `hasUnrecognizedKey` and marks the report
  // `malformed`. The adapter applied it to the observation and not to the requirement.
  //
  // Fixed by publishing `z.object({...}).strict()` instead of a raw shape, so the schema
  // the server enforces is the schema it advertises.
  const strictTargets = [
    { tool: "list_room_scenarios", args: {} },
    { tool: "signal_catalog", args: {} },
    { tool: "fabric_status", args: {} },
    { tool: "facility_graph", args: { spaceId: "SG-RM0312" } },
    { tool: "scan_signals", args: { signals: [{ category: "device_compliance" }] } },
    { tool: "evaluate_room_entry", args: { scenarioId: "no-such-scenario" } },
    { tool: "evaluate_decision", args: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" } },
    { tool: LOCATION_TOOL, args: { ...BASE, source_health: "healthy" } },
  ];
  const listedSchemas = new Map(
    ((listed.result as { tools?: { name: string; inputSchema?: Record<string, unknown> }[] } | undefined)?.tools ?? [])
      .map((t) => [t.name, t.inputSchema ?? {}]),
  );
  for (const { tool, args } of strictTargets) {
    check(`${tool} ADVERTISES additionalProperties:false`,
      listedSchemas.get(tool)?.["additionalProperties"] === false,
      `got ${JSON.stringify(listedSchemas.get(tool)?.["additionalProperties"])}`);
    const bogus = await callTool(mcp, tool, { ...args, totally_bogus_key_xyz: 1 });
    check(`${tool} ENFORCES it — an unrecognized key is refused, not quietly dropped`, bogus.isError);
  }

  // The headline pair, and its negative control. Without the second call the first
  // proves only that the server rejects things, not that it rejects the RIGHT thing.
  const STALE_OBS = {
    ...BASE, source_health: "healthy", map_version: FIXTURE_MAP_VERSION,
    observed_at: "2020-01-01T00:00:00Z", referenceTime: "2026-08-02T00:00:00Z",
  } as const;
  const misCasedAge = await callTool(mcp, LOCATION_TOOL, { ...STALE_OBS, max_observation_age_seconds: 60 });
  check("THE DROPPED BOUND: a mis-cased maxObservationAgeSeconds is an ERROR, not a silent grant on a 6.5-year-stale fix",
    misCasedAge.isError);
  const correctAge = await callTool(mcp, LOCATION_TOOL, { ...STALE_OBS, maxObservationAgeSeconds: 60 });
  check("...and the correctly-spelled bound still grades the same observation stale",
    verdict(correctAge)["recommendedAction"] === "step_up" && norm(correctAge)["recency"] === "stale",
    `action=${String(verdict(correctAge)["recommendedAction"])} recency=${String(norm(correctAge)["recency"])}`);

  const misCasedConf = await callTool(mcp, LOCATION_TOOL, {
    ...BASE, source_health: "healthy", map_version: FIXTURE_MAP_VERSION, confidence: 0.1, min_confidence: 0.99,
  });
  check("the same for the confidence floor: a mis-cased min_confidence is refused rather than dropped",
    misCasedConf.isError);
  const correctConf = await callTool(mcp, LOCATION_TOOL, {
    ...BASE, source_health: "healthy", map_version: FIXTURE_MAP_VERSION, confidence: 0.1, minConfidence: 0.99,
  });
  check("...and the correctly-spelled floor still refuses a 0.1 confidence against a 0.99 requirement",
    verdict(correctConf)["recommendedAction"] === "step_up",
    `action=${String(verdict(correctConf)["recommendedAction"])}`);

  // ── 14. the casing split is DELIBERATE, and pinned so nobody "tidies" it ───
  //
  // This check exists because an adversarial pass over this very surface proposed
  // "assert the schema uses one casing convention" as a fix, and that would have been a
  // regression. The two conventions carry provenance:
  //
  //   snake_case  -> mirrors `LocationObservationRaw` — the wire shape a location SOURCE emits
  //   camelCase   -> mirrors `LocationRequirement`    — the caller's POLICY, "supplied never invented"
  //
  // Renaming `requiredClass` to `required_class` "for consistency" would silently
  // reclassify a policy field as an observation field. Derived from the library's own
  // key list rather than hardcoded, so the pin cannot drift from the types it mirrors.
  // MEMBERSHIP IS THE DISCRIMINATOR, NOT SPELLING — and the first draft of this check
  // got that wrong, which is worth keeping rather than quietly correcting. It classified
  // by "contains an underscore" and failed on `confidence`: a single word, no underscore,
  // and unambiguously an OBSERVATION field (what the source reported). Had the check been
  // written the naive way and passed, it would have licensed exactly the rename it exists
  // to prevent. So the partition is derived from the library's key list.
  const OBS = LOCATION_OBSERVATION_KEYS as readonly string[];
  const locSchema = listedSchemas.get(LOCATION_TOOL) ?? {};
  const locProps = Object.keys((locSchema["properties"] as Record<string, unknown>) ?? {});
  const observationInputs = locProps.filter((k) => OBS.includes(k));
  const posedInputs = locProps.filter((k) => !OBS.includes(k));
  /** The caller-posed half — `LocationRequirement` plus the reference instant. */
  const EXPECTED_POSED = ["requiredClass", "minConfidence", "maxObservationAgeSeconds", "referenceTime"];

  check("the location tool publishes BOTH halves — what the source reported AND what the caller requires",
    observationInputs.length > 0 && posedInputs.length > 0,
    `observation=${observationInputs.join(",")} posed=${posedInputs.join(",")}`);
  check("the caller-posed inputs are exactly the requirement set — nothing has drifted into it",
    posedInputs.length === EXPECTED_POSED.length && EXPECTED_POSED.every((k) => posedInputs.includes(k)),
    `posed=${posedInputs.join(",")}`);
  check("SPELLING IS NOT THE RULE: `confidence` carries no underscore and is still an OBSERVATION field, so a casing-based 'consistency' pass would misfile it",
    OBS.includes("confidence") && observationInputs.includes("confidence"));

  // ── 15. evaluate_room_entry's optional inputs — the release must be EARNED ─
  //
  // `stepUpSatisfied` and `confirmedActionIds` are the only two inputs on this surface
  // that RELEASE something. Both default fail-closed in the library
  // (`input.stepUpSatisfied === true` is a strict comparison, and `?? []` is an empty
  // confirmation set), so the risk is not the default — it is that nothing pinned the
  // default, and a `!== false` or a truthiness check would read identically at a glance.
  //
  // The anti-vacuity half matters as much as the fail-closed half: without proving the
  // flag DOES release when passed, a planner that had stopped releasing entirely would
  // satisfy every negative check here.
  //
  // WHICH MUTATION ACTUALLY TESTS THIS — recorded because two obvious ones do NOT, and
  // finding that out is the only reason these checks are known to be falsifiable at all.
  // Omission is normalized THREE times on the way down:
  //
  //   artifacts/mcp-server/src/index.ts   `stepUpSatisfied ?? false`   <- the only live one
  //   lib/room-sim/src/index.ts           `options.stepUpSatisfied ?? false`
  //   lib/orchestration/src/index.ts      `input.stepUpSatisfied === true`
  //
  // Flipping either of the inner two leaves this proof at full marks, because the layer
  // above has already turned `undefined` into `false` — they are genuinely inert THROUGH
  // THIS SURFACE (measured, not assumed). Flipping the outermost `?? false` to `?? true`
  // drops this section by exactly its two omission checks. A future lane hardening the
  // library comparison should know its change is unobservable from here, and that the
  // adapter is where omission semantics for the chat surface are actually decided.
  const STEP_UP_SCENARIO = "baseline-drift";
  const dispositions = (r: ToolResult): string[] => {
    const plan = (r.json?.["plan"] as { actions?: { disposition?: string }[] } | undefined) ?? {};
    return (plan.actions ?? []).map((a) => String(a.disposition));
  };
  const appliedIds = (r: ToolResult): string[] => {
    const plan = (r.json?.["plan"] as { actions?: { id?: string; disposition?: string }[] } | undefined) ?? {};
    return (plan.actions ?? []).filter((a) => a.disposition === "applied").map((a) => String(a.id));
  };

  const heldRun = await callTool(mcp, "evaluate_room_entry", { scenarioId: STEP_UP_SCENARIO });
  check("the step-up fixture really is a step_up decision (the rest of this section is vacuous otherwise)",
    ((heldRun.json?.["decision"] as { outcome?: string } | undefined) ?? {}).outcome === "step_up",
    `outcome=${String(((heldRun.json?.["decision"] as { outcome?: string } | undefined) ?? {}).outcome)}`);
  check("OMITTING stepUpSatisfied holds every releasable action at step_up — silence never releases",
    dispositions(heldRun).includes("step_up") && !dispositions(heldRun).includes("assist"),
    `dispositions=${dispositions(heldRun).join(",")}`);

  // Byte-identity is the WRONG test here and the first draft used it. Unlike the location
  // tool, this one MINTS a `decisionId` per evaluation, so two identical calls legitimately
  // differ — and the failing check is what surfaced it. Normalising exactly that one field
  // turns the test into the stronger claim: the identifier is the ONLY thing that varies,
  // so no clock or randomness reaches the verdict or the plan.
  const sansDecisionId = (r: ToolResult): string =>
    r.text.replace(/"decisionId":\s*"[^"]*"/g, '"decisionId":"<minted>"');
  const heldAgain = await callTool(mcp, "evaluate_room_entry", { scenarioId: STEP_UP_SCENARIO });
  check("DETERMINISM: two identical evaluations differ ONLY in the minted decisionId — nothing else moves",
    sansDecisionId(heldAgain) === sansDecisionId(heldRun) && heldAgain.text !== heldRun.text);
  const explicitFalse = await callTool(mcp, "evaluate_room_entry", { scenarioId: STEP_UP_SCENARIO, stepUpSatisfied: false });
  check("an explicit stepUpSatisfied:false is indistinguishable from omitting it — no third behaviour hides between them",
    sansDecisionId(explicitFalse) === sansDecisionId(heldRun));

  const released = await callTool(mcp, "evaluate_room_entry", { scenarioId: STEP_UP_SCENARIO, stepUpSatisfied: true });
  check("ANTI-VACUITY: asserting stepUpSatisfied:true DOES release the held actions, so the flag is load-bearing",
    dispositions(released).includes("assist") && !dispositions(released).includes("step_up"),
    `dispositions=${dispositions(released).join(",")}`);

  check("OMITTING confirmedActionIds applies nothing — a sensitive action is never auto-applied",
    appliedIds(released).length === 0,
    `applied=${appliedIds(released).join(",")}`);
  const firstAssist = ((released.json?.["plan"] as { actions?: { id?: string; disposition?: string }[] } | undefined) ?? {})
    .actions?.find((a) => a.disposition === "assist")?.id;
  const confirmed = await callTool(mcp, "evaluate_room_entry", {
    scenarioId: STEP_UP_SCENARIO, stepUpSatisfied: true, confirmedActionIds: [String(firstAssist)],
  });
  check("confirming ONE action id applies exactly that one — confirmation does not spill onto its neighbours",
    appliedIds(confirmed).length === 1 && appliedIds(confirmed)[0] === String(firstAssist),
    `applied=${appliedIds(confirmed).join(",")} expected=${String(firstAssist)}`);

  // ── 16. and the surface SAYS what those inputs are ────────────────────────
  //
  // The two inputs above release actions on a caller-asserted boolean. On a public-safe
  // fixture surface that is the demo mechanism and is fine — but the shipped product path
  // is deliberately stricter (`/v1/app-workflows/evaluate` refuses to release on a
  // request-supplied signal at all; the only release is a verified WebAuthn assertion at
  // `/v1/app-workflows/complete-step-up`). An assistant reads this description to decide
  // what to send and how to report the answer, so the asymmetry has to be IN it. Checked
  // over the wire against the served description, not against the source.
  const roomEntrySchema = ((listed.result as { tools?: { name: string; description?: string }[] } | undefined)?.tools ?? [])
    .find((t) => t.name === "evaluate_room_entry");
  const roomDesc = String(roomEntrySchema?.description ?? "");
  check("evaluate_room_entry discloses that stepUpSatisfied is asserted by the caller, not a ceremony it performs",
    /SIMULATION INPUTS|assert/i.test(roomDesc) && /never evidence/i.test(roomDesc),
    `description=${roomDesc.slice(0, 60)}…`);
  check("...and names the stricter shipped path so the what-if is not mistaken for the product's behaviour",
    roomDesc.includes("/v1/app-workflows/complete-step-up") && /WebAuthn/i.test(roomDesc));

  // ── 17. an unmapped vendor id is null, never a guess ──────────────────────
  const vendor = await callTool(mcp, "facility_graph", {
    vendorNamespace: "cisco", vendorKey: "zone_id", vendorId: "no-such-zone",
  });
  check("an unmapped vendor identifier resolves to null rather than a nearest guess",
    vendor.json !== null && vendor.json["resolved"] === null);
} finally {
  mcp.close();
}

const total = passed + failures.length;
console.log(`figures=toolsRegistered=${EXPECTED_TOOLS.length},locationAxesIsolated=2,assertedBadStates=2`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
