/**
 * Cascade join 5 — one durable outbound queue for the cascade emitters.
 *
 * Serves *"notify the proper protocol and teams that are assign to that resource"*.
 *
 * The retry, backoff-with-jitter and dead-letter shapes already existed
 * (`lib/integrations/.../webhooks/retry.ts`, `dispatch.ts`, `store.ts`, and the
 * deterministic model in `./webhooks.ts`), but they were PER-EMITTER and per-backend.
 * A cascade that spans a ticket, a change draft and an audience notification could
 * therefore fail to notify while the ticket path looked clean, and nobody had one
 * place to look. This is that one place: one queue, one dead-letter view, one
 * summary — so a failure to notify is visible where a failure to ticket is.
 *
 * WHAT THIS IS NOT. No broker, no Redis, no transport. It is the record of what was
 * asked for and what happened to it; the caller owns the sending. That is the whole
 * point of the row — one durable VIEW, not Kafka.
 *
 * FAIL-CLOSED, and each of these is a property a proof drives:
 *   · an unreachable backend leaves the item QUEUED, with the reason recorded;
 *   · a dead-letter entry is a visible failure and never a silent drop — it stays in
 *     the queue and is counted;
 *   · a pending item NEVER counts as delivered;
 *   · `delivered` needs a receipt AND an instant. A backend that answers "fine" and
 *     names nothing has not delivered anything, and recording it as delivered would
 *     hand an operator a reference that opens nothing (the same 2xx-shaped non-answer
 *     the itsm family already refuses by name).
 *
 * DETERMINISTIC. No clock and no randomness: every instant is an argument, the id is
 * a digest of the request, and the backoff schedule is COMPUTED AND RECORDED, never
 * awaited — `nextBackoffSeconds` says what a sender should wait, and nothing here
 * waits. Jitter is deliberately absent: a jittered schedule cannot be asserted, and a
 * sender that wants jitter can apply it to the recorded value.
 */

import { deterministicId } from "./util";

/** Which limb of the cascade an item belongs to. One queue, four kinds of traffic. */
export type OutboundChannel = "ticket" | "change_draft" | "notice" | "suspend";

/** Queued until proven otherwise; dead-lettered when the attempts run out. */
export type OutboundStatus = "queued" | "delivered" | "dead_letter";

/** One recorded send attempt. `ok` is what the sender reported; the queue grades it. */
export interface OutboundAttempt {
  readonly attempt: number;
  readonly outcome: "delivered" | "refused";
  readonly reason: string;
  readonly at: string;
  /** What a sender should wait before the next attempt. Recorded, never awaited. */
  readonly backoffSeconds: number;
}

export interface OutboundItem {
  readonly id: string;
  readonly tenantId: string;
  readonly decisionId: string;
  readonly channel: OutboundChannel;
  /** What this item is about — a remediation id, a draft id, a notice id. */
  readonly subjectRef: string;
  /** The receipt the backend gave, once there is one. Null while there is not. */
  readonly receiptRef: string | null;
  readonly status: OutboundStatus;
  readonly maxAttempts: number;
  readonly attempts: readonly OutboundAttempt[];
  /** Seconds a sender should wait before retrying; null when there is nothing to wait for. */
  readonly nextBackoffSeconds: number | null;
  readonly enqueuedAt: string;
  readonly note: string;
}

export interface EnqueueOutboundInput {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly channel: OutboundChannel;
  readonly subjectRef: string;
  readonly enqueuedAt: string;
  /** How many attempts before the item is dead-lettered. Below 1 is coerced to 1. */
  readonly maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

const blank = (value: unknown): boolean => typeof value !== "string" || value.trim().length === 0;

/** Exponential, recorded, never awaited: 1s, 2s, 4s, … — the same schedule webhooks.ts uses. */
export function backoffSecondsFor(attempt: number): number {
  return 2 ** Math.max(0, attempt - 1);
}

/**
 * Put an item on the queue. It starts QUEUED — never "sending", never "assumed
 * delivered". Pure: the id is a digest of the request, so enqueuing the same request
 * twice is the same row rather than two.
 */
export function enqueueOutbound(input: EnqueueOutboundInput): OutboundItem {
  return {
    id: deterministicId("obq", input.tenantId, input.decisionId, input.channel, input.subjectRef),
    tenantId: input.tenantId,
    decisionId: input.decisionId,
    channel: input.channel,
    subjectRef: input.subjectRef,
    receiptRef: null,
    status: "queued",
    maxAttempts: Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    attempts: [],
    nextBackoffSeconds: 0,
    enqueuedAt: input.enqueuedAt,
    note: "queued — nothing has been sent",
  };
}

/** What a sender reports back. `receiptRef` is the backend's own reference for the thing it opened. */
export type SendOutcome =
  | { readonly ok: true; readonly receiptRef: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Record one attempt and return the item's new state. Pure and total.
 *
 * An item that is already `delivered` or `dead_letter` is returned UNCHANGED — a
 * terminal row is not re-graded by a late answer, and a second "ok" cannot resurrect
 * something that was already dead-lettered and escalated.
 */
export function recordOutboundAttempt(item: OutboundItem, outcome: SendOutcome, at: string): OutboundItem {
  if (item.status !== "queued") {
    return item;
  }
  const attempt = item.attempts.length + 1;

  // A claimed success with no receipt is a REFUSAL, not a delivery. This is the arm
  // that exists because a 2xx-shaped non-answer is the most dangerous reply a backend
  // can give: it is the only failure that looks exactly like the good outcome.
  const graded: { outcome: OutboundAttempt["outcome"]; reason: string } =
    !outcome.ok
      ? { outcome: "refused", reason: outcome.reason }
      : blank(outcome.receiptRef)
        ? { outcome: "refused", reason: "the backend accepted it and named nothing — that is not a receipt" }
        : blank(at)
          ? { outcome: "refused", reason: "no instant was supplied, so nothing can be shown to have happened" }
          : { outcome: "delivered", reason: `delivered, receipt ${outcome.receiptRef}` };

  const recorded: OutboundAttempt = {
    attempt,
    outcome: graded.outcome,
    reason: graded.reason,
    at,
    backoffSeconds: graded.outcome === "delivered" ? 0 : backoffSecondsFor(attempt),
  };
  const attempts = [...item.attempts, recorded];

  if (graded.outcome === "delivered") {
    return {
      ...item,
      attempts,
      status: "delivered",
      receiptRef: (outcome as { receiptRef: string }).receiptRef,
      nextBackoffSeconds: null,
      note: graded.reason,
    };
  }
  const exhausted = attempts.length >= item.maxAttempts;
  return {
    ...item,
    attempts,
    status: exhausted ? "dead_letter" : "queued",
    nextBackoffSeconds: exhausted ? null : recorded.backoffSeconds,
    note: exhausted
      ? `dead-letter after ${attempts.length} attempt(s): ${graded.reason}`
      : `still queued after ${attempts.length} attempt(s): ${graded.reason}`,
  };
}

/** Items still owed. A pending item is a failure that has not finished failing yet. */
export function pendingOutbound(items: readonly OutboundItem[]): OutboundItem[] {
  return items.filter((item) => item.status === "queued");
}

/** THE dead-letter view — one list, across every limb of the cascade. */
export function deadLetters(items: readonly OutboundItem[]): OutboundItem[] {
  return items.filter((item) => item.status === "dead_letter");
}

/** Delivered means delivered. A function rather than a field a caller can misread. */
export function deliveredOutbound(items: readonly OutboundItem[]): OutboundItem[] {
  return items.filter((item) => item.status === "delivered");
}

export interface OutboundSummary {
  readonly total: number;
  readonly queued: number;
  readonly delivered: number;
  readonly deadLetter: number;
  /** Channels with at least one item not delivered. What an operator reads first. */
  readonly failingChannels: readonly OutboundChannel[];
  /** True when every item reached a backend. Nothing else may be read as "the cascade landed". */
  readonly allDelivered: boolean;
}

/**
 * One glance at the whole cascade.
 *
 * `allDelivered` is FALSE for an empty queue on purpose. An empty queue has not
 * delivered a cascade; it has not attempted one, and `[].every()` answering true is
 * the vacuous-pass shape this repository has now been bitten by more than once.
 */
export function outboundSummary(items: readonly OutboundItem[]): OutboundSummary {
  const queued = pendingOutbound(items).length;
  const deadLetter = deadLetters(items).length;
  const delivered = deliveredOutbound(items).length;
  const failing = new Set<OutboundChannel>();
  for (const item of items) {
    if (item.status !== "delivered") failing.add(item.channel);
  }
  return {
    total: items.length,
    queued,
    delivered,
    deadLetter,
    failingChannels: [...failing].sort(),
    allDelivered: items.length > 0 && delivered === items.length,
  };
}
