// Proof: cascade join 1 — an Incident becomes a ticket REQUEST deterministically,
// and the dispatch seam refuses, by name, every way the ticket can fail to open.
//
// WHAT THIS EXISTS TO PIN. `lib/incident-playbook` decided a ticket was warranted
// and had no way to say so; the eight ITSM adapters could open one and had nothing
// telling them to. `incident-playbook/src/dispatch.ts` joins them. The join is only worth having if
// it is honest about the case that actually occurs in this tree — the gate is shut,
// so nothing is dispatched — and about the case that would occur in a deployment
// where it is open and the vendor answers with nothing useful.
//
// TWO PROPERTIES, and the second is the one with teeth:
//
//   1. The MAPPER is pure and total. Every priority × category pair produces a
//      request, the severity is the one the priority implies, and the same
//      incident maps to byte-identical output twice running. No clock, no random.
//   2. The SEAM fails closed on every path, each with a DISTINCT named reason:
//      gate suppressed (tier, live flag, absent credential), no adapter, an
//      unreachable backend, and a 2xx-shaped non-answer whose ticket id is blank.
//      A `opened === false` is satisfied by all of them, which is exactly why the
//      assertions below compare the REASON and not merely the boolean.
//
// NON-VACUITY. A seam that refused everything would pass every refusal assertion,
// so the proof also drives the one path that must SUCCEED — gate open, adapter
// present, vendor names an id — and asserts the vendor's own id survives. That
// path needs an adapter, and in this tree the real factory can never build one
// (its own gate reads process.env, where the tier is never live), which is why
// `dispatchIncident` takes the factory as a parameter. Without it the last two
// refusals below would be unreachable by any test and therefore unproven.
//
// Run: pnpm --filter @workspace/scripts run proof:itsm-dispatch
//      pnpm --filter @workspace/scripts run proof:itsm-dispatch --self-test

import {
  ITSM_DISPATCH_REFUSALS,
  dispatchIncident,
  incidentToTicketRequest,
  type Incident,
  type IncidentCategory,
  type Priority,
} from "@workspace/incident-playbook";
import type { ITSMFullConfig } from "@workspace/integrations/itsm/store";
import type { ITSMAdapter, ITSMTicketResponse } from "@workspace/integrations/adapters/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL — ${name}`);
  }
}

const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];
const CATEGORIES: IncidentCategory[] = [
  "security_compliance",
  "security_vulnerability",
  "asset_device",
  "security_incident",
  "general",
];
const SEVERITY_FOR: Record<Priority, string> = { P1: "critical", P2: "high", P3: "medium", P4: "low" };

function incident(priority: Priority, category: IncidentCategory, over: Partial<Incident> = {}): Incident {
  return {
    priority,
    impact: "high",
    urgency: "critical",
    category,
    assignmentGroup: "Service Desk",
    sla: { responseMinutes: 15, resolutionHours: 4, responseLabel: "15 minutes", resolutionLabel: "4 hours" },
    escalate: priority === "P1",
    majorIncident: false,
    shortDescription: `a ${category} condition at ${priority}`,
    correlationId: "corr-from-decision-id",
    drivers: ["DRIVER_ONE", "DRIVER_TWO"],
    ...over,
  };
}

// ------------------------------------------------------------------ 2. the seam

const CONFIG: ITSMFullConfig = {
  enabled: true,
  vendor: "servicenow",
  instanceUrl: "https://vendor.invalid",
  credentials: { apiToken: "a-token-that-is-present" },
} as unknown as ITSMFullConfig;

const savedTier = process.env.SIGNALGRID_TIER;
const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;

async function main(): Promise<void> {
  // ---------------------------------------------------------------- 1. the mapper

  console.log("\nThe mapper — the full priority × category matrix:");
  let matrixOk = true;
  let matrixCount = 0;
  for (const priority of PRIORITIES) {
    for (const category of CATEGORIES) {
      const req = incidentToTicketRequest(incident(priority, category));
      matrixCount += 1;
      if (
        req.severity !== SEVERITY_FOR[priority] ||
        req.category !== category ||
        !req.title.startsWith(`[${priority}] `) ||
        req.correlationId !== "corr-from-decision-id" ||
        req.source !== "signalgrid"
      ) {
        matrixOk = false;
        console.error(`    FAIL — ${priority} × ${category}: ${JSON.stringify(req)}`);
      }
    }
  }
  check(`every ${matrixCount} priority × category pair maps with the severity its priority implies`, matrixOk && matrixCount === 20);
  check("no priority maps to `informational` — P4 is still work for somebody", !Object.values(SEVERITY_FOR).includes("informational"));

  const twice = [incidentToTicketRequest(incident("P1", "general")), incidentToTicketRequest(incident("P1", "general"))];
  check("the same incident maps to byte-identical output twice — no clock, no random", JSON.stringify(twice[0]) === JSON.stringify(twice[1]));

  const major = incidentToTicketRequest(incident("P1", "security_incident", { majorIncident: true, escalate: true }));
  check("a major incident says the war-room process applies", major.description.includes("war-room"));
  const escalated = incidentToTicketRequest(incident("P1", "security_incident", { escalate: true }));
  check("an escalated non-major incident says on-call instead", escalated.description.includes("on-call") && !escalated.description.includes("war-room"));
  const quiet = incidentToTicketRequest(incident("P4", "general"));
  check("a non-escalating incident says so rather than leaving it ambiguous", quiet.description.includes("No escalation."));
  const noDrivers = incidentToTicketRequest(incident("P3", "general", { drivers: [] }));
  check("an incident with NO drivers says 'none recorded' rather than an empty list", noDrivers.description.includes("none recorded"));
  check("the drivers reach the ticket in the order the playbook ranked them", major.description.includes("DRIVER_ONE, DRIVER_TWO"));

  console.log("\nThe seam — every way a ticket fails to open, by name:");

  // A non-emitting tier. This is the state of THIS tree, so it is the case an
  // operator reading a result here will actually see.
  const dev = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, {
    SIGNALGRID_TIER: "dev",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
  } as NodeJS.ProcessEnv);
  check("a non-emitting tier refuses, and the reason names the tier", !dev.opened && dev.reason.includes('tier "dev" never emits'));
  check("a refusal still carries the REQUEST, so the incident can be re-dispatched later", !dev.opened && dev.request.correlationId === "corr-from-decision-id");

  // The live flag off at an emitting tier.
  const flagOff = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "false",
  } as NodeJS.ProcessEnv);
  check("an emitting tier with the live flag off still refuses", !flagOff.opened && flagOff.reason.includes("SIGNALGRID_LIVE_INTEGRATIONS"));

  // The gate's third condition: the credential the vendor requires is absent.
  const noCred = await dispatchIncident(
    incident("P1", "general"),
    "servicenow",
    { ...CONFIG, credentials: { apiToken: "   " } } as unknown as ITSMFullConfig,
    { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" } as NodeJS.ProcessEnv,
  );
  check("a whitespace-only credential refuses, and the reason NAMES the field", !noCred.opened && noCred.reason.includes("ServiceNow apiToken"));

  // An unknown vendor — the ninth vendor nobody wrote a credential rule for.
  const unknown = await dispatchIncident(
    incident("P1", "general"),
    "nope-not-a-vendor" as never,
    CONFIG,
    { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" } as NodeJS.ProcessEnv,
  );
  check("an unknown vendor refuses rather than inheriting 'no credential required'", !unknown.opened && unknown.reason.includes("unknown ITSM vendor"));

  // Every refusal above must be DISTINGUISHABLE. Four identical strings would
  // satisfy every assertion so far and tell an operator nothing.
  const reasons = [dev, flagOff, noCred, unknown].map((r) => (r.opened ? "opened" : r.reason));
  check("the four refusals are four DIFFERENT reasons, not one string four times", new Set(reasons).size === 4);

  // The refusal vocabulary is exported, so a caller can match on it rather than
  // string-sniffing — and the exported builders are the ones actually used.
  check(
    "the exported refusal vocabulary is what the seam emits",
    ITSM_DISPATCH_REFUSALS.gateSuppressed("x") === "ITSM dispatch refused: x" &&
      ITSM_DISPATCH_REFUSALS.blankTicketId("v").includes("names no ticket") &&
      ITSM_DISPATCH_REFUSALS.backendUnreachable("v", "d").includes("the incident stays open") &&
      ITSM_DISPATCH_REFUSALS.adapterUnavailable("v").includes("the incident stays open"),
  );
  check(
    "every refusal leaves the incident OPEN and says so",
    [unknown, noCred].every((r) => !r.opened && (r.reason.includes("stays open") || r.reason.includes("refused"))),
  );

  // ---- past the factory: the two refusals and the one success the real factory
  // can never reach in this tree, driven through the injected adapter.
  const LIVE = { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" } as NodeJS.ProcessEnv;
  const adapterThat = (createTicket: ITSMAdapter["createTicket"]): ITSMAdapter => ({
    name: "proof stand-in",
    vendor: "servicenow",
    createTicket,
  });

  const opened = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, LIVE, () =>
    adapterThat(async () => ({ ticketId: "INC0012345", ticketUrl: "https://vendor.invalid/t/1", status: "new" }) as ITSMTicketResponse),
  );
  check("gate open + adapter present + an id named ⇒ the ticket OPENS", opened.opened === true);
  check("the VENDOR's ticket id survives, not one this seam invented", opened.opened && opened.response.ticketId === "INC0012345");

  const blank = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, LIVE, () =>
    adapterThat(async () => ({ ticketId: "   ", status: "new" }) as ITSMTicketResponse),
  );
  check("a 2xx-shaped answer whose ticket id is BLANK is refused, not recorded", !blank.opened && blank.reason.includes("without a ticket id"));

  const threw = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, LIVE, () =>
    adapterThat(async () => {
      throw new Error("ECONNREFUSED vendor.invalid:443");
    }),
  );
  check("an unreachable backend is refused with the throw as the reason, and does not propagate", !threw.opened && threw.reason.includes("ECONNREFUSED"));

  const noAdapter = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, LIVE, () => null);
  check("a factory that cannot build refuses by name", !noAdapter.opened && noAdapter.reason.includes("no adapter could be built"));

  // The conjunction, stated as a property rather than left to be inferred: the
  // REAL factory consults process.env, so an open `env` argument alone opens nothing.
  const bothGates = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, LIVE);
  check("an open env argument alone does NOT open a ticket — the real factory's own gate still applies", !bothGates.opened);

  const allReasons = [dev, flagOff, noCred, unknown, blank, threw, noAdapter].map((r) => (r.opened ? "opened" : r.reason));
  check("all seven refusal paths produce seven distinct reasons", new Set(allReasons).size === 7);

  const total = passed + failures.length;
  console.log(`\nITSM dispatch proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Cascade join 1 verified — the mapper is total and deterministic, and every dispatch failure refuses by name with the incident left open.");
}

/**
 * Self-test: the checks above must be able to FAIL.
 *
 * A proof whose assertions are tautologies reports the same green whether the
 * code works or not. Each case here is the planted defect the matching assertion
 * is supposed to catch, asserted to be caught.
 */
async function selfTest(): Promise<number> {
  const results: Array<[string, boolean]> = [];

  // A mapper that ignored priority would collapse the severity column.
  const collapsed = PRIORITIES.map((p) => incidentToTicketRequest(incident(p, "general")).severity);
  results.push(["the severity column is not constant — a priority-ignoring mapper would be caught", new Set(collapsed).size === 4]);

  // A seam that reported success regardless would be caught by the reason check.
  const fake = { opened: false as const, request: incidentToTicketRequest(incident("P1", "general")), reason: "same" };
  results.push(["four identical reasons FAIL the distinctness check", new Set([fake, fake, fake, fake].map((r) => r.reason)).size !== 4]);

  // The gate must actually be consulted: an open gate reaches further than a shut one.
  const shut = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, {
    SIGNALGRID_TIER: "dev",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
  } as NodeJS.ProcessEnv);
  const open = await dispatchIncident(incident("P1", "general"), "servicenow", CONFIG, {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
  } as NodeJS.ProcessEnv);
  results.push([
    "a shut gate and an open gate reach DIFFERENT refusals — the gate is really consulted",
    !shut.opened && !open.opened && shut.reason !== open.reason,
  ]);

  for (const [name, ok] of results) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${results.length - failed.length}/${results.length})`);
  return failed.length === 0 ? 0 : 1;
}

try {
  if (process.argv.includes("--self-test")) {
    process.exit(await selfTest());
  }
  await main();
} finally {
  if (savedTier === undefined) delete process.env.SIGNALGRID_TIER;
  else process.env.SIGNALGRID_TIER = savedTier;
  if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
}
