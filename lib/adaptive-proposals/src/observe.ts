// observe → correlate → explain → recommend (steps 1–4).
//
// `deriveProposals` mines SYNTHETIC audit history — the tamper-evident ledger the
// fabric already keeps (`@workspace/signalgrid-core` audit chain) — for repeated
// (signals → manual-resolution) patterns, and emits a DRAFT proposal per pattern with
// its provenance, `observedIncidentCount`, and a human-readable `correlationSummary`
// (the "explain"). It is pure and deterministic: no Date.now / Math.random, no I/O,
// output ordered by proposalId so two runs over identical input are byte-identical.
//
// It never applies anything. A draft proposal is a description an operator will later
// simulate and — only with a human approval — activate.

import type { AuditEvent, AuditEventType } from "@workspace/signalgrid-core";
import { deepFreeze, type AdaptiveProposal } from "./types";

/** The audit event types that mark a MANUAL resolution — a human closing the loop.
 *  A remediation that a person requested/approved is exactly the toil the loop exists
 *  to notice and (with approval) automate. `decision.evaluated` and the rest are the
 *  fabric's own bookkeeping, not human resolutions, so they are not mined as patterns. */
const MANUAL_RESOLUTION_TYPES: readonly AuditEventType[] = [
  "remediation.requested",
  "remediation.approved",
];

/** The pattern floor. A pattern is emitted only when the SAME subject was manually
 *  resolved at least this many times.
 *
 *  WHY A FLOOR AT ALL. One manual resolution is an incident, not a pattern. Promoting a
 *  single event into a policy proposal would be noise at best; at worst it would let a
 *  single staged event manufacture a governance artifact that an owner then has to
 *  triage. Repetition is what makes "these signals keep preceding this manual fix"
 *  worth an owner's attention. Three is the smallest count that is unambiguously "again,
 *  and again" rather than coincidence. A subject below the floor yields NO proposal. */
export const PATTERN_FLOOR = 3;

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Mine synthetic audit history into draft adaptive proposals.
 *
 * Deterministic. Groups manual-resolution events by their `subject` (the workflow /
 * pattern being resolved), and for each subject resolved >= `PATTERN_FLOOR` times emits
 * one draft proposal whose provenance records the mined event ids, the distinct signal
 * refs those events carried, and the observed incident count.
 */
export function deriveProposals(auditEvents: readonly AuditEvent[]): AdaptiveProposal[] {
  // Group manual-resolution events by subject, preserving determinism.
  const bySubject = new Map<string, AuditEvent[]>();
  for (const event of auditEvents) {
    if (!MANUAL_RESOLUTION_TYPES.includes(event.type)) continue;
    const bucket = bySubject.get(event.subject);
    if (bucket) bucket.push(event);
    else bySubject.set(event.subject, [event]);
  }

  const proposals: AdaptiveProposal[] = [];
  for (const [subject, events] of bySubject) {
    // DISTINCT incidents, not raw event multiplicity. Adversarial review caught the
    // gap: counting events.length let one event repeated three times clear the floor
    // and inflated the provenance count above sourceEventRefs.length, contradicting
    // the field's own doc ("how many DISTINCT incidents"). The wired path (the real
    // appendAudit ledger) guarantees unique ids so it never triggered there, but the
    // public function's contract must hold for any caller. Count what we cite.
    const sourceEventRefs = stableUnique(events.map((e) => e.id));
    const observedIncidentCount = sourceEventRefs.length;
    // The floor: below it, a subject is an incident, not a pattern — emit nothing.
    if (observedIncidentCount < PATTERN_FLOOR) continue;
    // The "signals" that preceded/accompanied the manual resolutions: the distinct
    // opaque refs those events carried. These are handles into the ledger, never the
    // event bodies.
    const signalRefs = stableUnique(events.flatMap((e) => e.references));
    const signalList = signalRefs.length > 0 ? signalRefs.join(", ") : "(no referenced signals)";

    const correlationSummary =
      `these ${signalRefs.length} signal(s) [${signalList}] preceded a manual resolution of ` +
      `"${subject}" ${observedIncidentCount} times`;

    proposals.push(
      deepFreeze({
        proposalId: `prop-${subject}`,
        provenance: { observedIncidentCount, sourceEventRefs, correlationSummary },
        recommendation: {
          kind: "automate_action",
          target: subject,
          description:
            `Route "${subject}" incidents matching [${signalList}] to an automated resolution flow, ` +
            `pending owner approval. Descriptive only — this proposal enacts nothing.`,
        },
        simulation: null,
        status: "draft",
        approval: null,
        measurement: null,
        // A freshly minted draft is version 1; every transition advances it.
        version: 1,
      }),
    );
  }

  // Deterministic order — two runs over identical input are byte-identical.
  proposals.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
  return proposals;
}
