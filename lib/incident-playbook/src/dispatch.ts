/**
 * Cascade join 1 — the ticket actually opens.
 *
 * `@workspace/incident-playbook` turns a composed posture or a cross-domain
 * detection into a prioritized, SLA-bound, routed `Incident`, and it is pure.
 * `lib/integrations/src/integrations/itsm` holds eight vendor adapters behind the
 * emission gate. Until now there was no code path from one to the other: the
 * fabric could decide a ticket was warranted and had no way to say so.
 *
 * Two halves, deliberately separable:
 *
 *   incidentToTicketRequest()  PURE. Total. No env, no clock, no I/O. Every field
 *                              of the request is derived from the incident, so the
 *                              same incident always produces the same ticket.
 *   dispatchIncident()         The seam. Resolves the emission gate FIRST, and in
 *                              this tree that resolution is always `suppressed`,
 *                              so the result says so and names why.
 *
 * FAIL-CLOSED, and each of these leaves the incident OPEN rather than recording a
 * ticket that does not exist:
 *
 *   · an unknown vendor            — `requiredCredential`'s default branch names it
 *   · an absent credential         — the gate's third condition, by field name
 *   · a non-emitting tier          — dev/test never reaches a customer's ITSM
 *   · an adapter that cannot build — `createITSMAdapter` returns null
 *   · an unreachable backend       — the adapter throws; the throw is the reason
 *   · a 2xx-shaped non-answer      — a blank ticket id is NOT a ticket
 *
 * The last one is why this file does not simply trust `createTicket`. The generic
 * webhook adapter already refuses an empty body, a non-JSON body and a 2xx that
 * names no id (`ITSM_WEBHOOK_REFUSALS`); the other seven vendors return whatever
 * their client parsed. A dispatch seam that recorded `ticketId: ""` as success
 * would hand the operator a ticket number that opens nothing — the precise shape
 * golden rule 2 forbids, since an unanswerable result would be reading as the
 * good one.
 *
 * DETERMINISTIC: no `Date.now()`, no `Math.random()`. The correlation id is the
 * incident's, which the playbook derives from the decision id.
 */

import type { Incident, Priority } from "./types";
import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from "@workspace/integrations/adapters/types";
import { resolveEmission } from "@workspace/integrations/emit-gate";
import { createITSMAdapter, requiredCredential } from "@workspace/integrations/itsm";
import type { ITSMFullConfig, ITSMVendor } from "@workspace/integrations/itsm/store";

/**
 * Priority → the adapters' severity vocabulary.
 *
 * `informational` is deliberately unreachable: the playbook's lowest priority is
 * P4, which is still a thing somebody must action. A severity nothing maps to is
 * better than folding P4 into "informational" and having a real backlog item
 * arrive looking like a notice.
 */
const SEVERITY_BY_PRIORITY: Record<Priority, ITSMTicketRequest["severity"]> = {
  P1: "critical",
  P2: "high",
  P3: "medium",
  P4: "low",
};

/** Every reason this seam can refuse with, named so a proof asserts the reason. */
export const ITSM_DISPATCH_REFUSALS = {
  gateSuppressed: (reason: string) => `ITSM dispatch refused: ${reason}`,
  adapterUnavailable: (vendor: string) =>
    `ITSM dispatch refused: no adapter could be built for vendor "${vendor}" — the incident stays open`,
  backendUnreachable: (vendor: string, detail: string) =>
    `ITSM dispatch refused: ${vendor} did not accept the ticket (${detail}) — the incident stays open`,
  blankTicketId: (vendor: string) =>
    `ITSM dispatch refused: ${vendor} answered without a ticket id, which names no ticket — the incident stays open`,
} as const;

/**
 * How the adapter is built. Defaults to the real factory; a proof passes its own.
 *
 * THIS IS NOT ONLY A TEST SEAM. `createITSMAdapter` resolves the emission gate
 * against `process.env`, while this function resolves it against the `env` it was
 * handed — so the two can disagree, and a ticket opens only when BOTH say live.
 * That conjunction is fail-closed in either direction and is the behaviour to
 * keep, but it was accidental before it was written down: the `env` parameter
 * looked like it governed the whole path and governed only the first half.
 *
 * It also makes the last two refusals PROVABLE. An unreachable backend and a
 * 2xx-shaped non-answer live past the factory, so with the real factory in a tree
 * whose gate is always shut, no test can reach them — and a refusal nothing can
 * reach is a comment, not a guard.
 */
export type AdapterFactory = (vendor: ITSMVendor, config: ITSMFullConfig) => ITSMAdapter | null;

/** The outcome of asking for a ticket. The request is carried either way. */
export type TicketDispatch =
  | { readonly opened: true; readonly request: ITSMTicketRequest; readonly response: ITSMTicketResponse }
  | { readonly opened: false; readonly request: ITSMTicketRequest; readonly reason: string };

/**
 * Incident → the adapters' ticket-request shape. Pure and total.
 *
 * `source` is fixed rather than passed: every ticket on this path is opened by
 * the same fabric, and an operator reading their queue should be able to filter
 * on it without depending on a caller having remembered to set it.
 */
export function incidentToTicketRequest(incident: Incident): ITSMTicketRequest {
  const drivers = incident.drivers.length > 0 ? incident.drivers.join(", ") : "none recorded";
  return {
    title: `[${incident.priority}] ${incident.shortDescription}`,
    description: [
      incident.shortDescription,
      "",
      `Priority ${incident.priority} (impact ${incident.impact} × urgency ${incident.urgency}).`,
      `Assignment group: ${incident.assignmentGroup}.`,
      `Response ${incident.sla.responseLabel}, resolution ${incident.sla.resolutionLabel}.`,
      incident.majorIncident
        ? "Major incident: the war-room process applies."
        : incident.escalate
          ? "Escalation: routes to the on-call path."
          : "No escalation.",
      "",
      `Drivers, most severe first: ${drivers}.`,
    ].join("\n"),
    severity: SEVERITY_BY_PRIORITY[incident.priority],
    category: incident.category,
    source: "signalgrid",
    correlationId: incident.correlationId,
  };
}

/**
 * Ask a vendor to open the ticket this incident describes.
 *
 * Never throws: an adapter that rejects, times out or answers with nothing is a
 * refusal carrying the reason, because a thrown dispatch would abort the cascade
 * that this join exists to continue.
 *
 * `env` is a parameter rather than a read of `process.env` so the gate can be
 * driven per call — the reason `resolveEmission` takes one too.
 */
export async function dispatchIncident(
  incident: Incident,
  vendor: ITSMVendor,
  config: ITSMFullConfig,
  env: NodeJS.ProcessEnv,
  buildAdapter: AdapterFactory = createITSMAdapter,
): Promise<TicketDispatch> {
  const request = incidentToTicketRequest(incident);

  const emission = resolveEmission(env, requiredCredential(vendor, config));
  if (emission.mode === "suppressed") {
    return { opened: false, request, reason: ITSM_DISPATCH_REFUSALS.gateSuppressed(emission.reason) };
  }

  const adapter = buildAdapter(vendor, config);
  if (!adapter) {
    return { opened: false, request, reason: ITSM_DISPATCH_REFUSALS.adapterUnavailable(vendor) };
  }

  let response: ITSMTicketResponse;
  try {
    response = await adapter.createTicket(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { opened: false, request, reason: ITSM_DISPATCH_REFUSALS.backendUnreachable(vendor, detail) };
  }

  if (!response?.ticketId?.trim()) {
    return { opened: false, request, reason: ITSM_DISPATCH_REFUSALS.blankTicketId(vendor) };
  }

  return { opened: true, request, response };
}
