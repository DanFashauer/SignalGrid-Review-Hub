/**
 * Webhooks v1 Types
 * 
 * Admin-managed webhook endpoints for external integrations.
 * Supports signing secrets, delivery receipts, retries, and DLQ.
 */

import { z } from 'zod';

/** Supported event types that can trigger webhooks */
export const WEBHOOK_EVENTS = [
  'session.start',
  'session.end',
  'badge.enroll',
  'badge.delete',
  'auth.failure',
  'asset.location.observed',
  'policy.matched',
  'policy.action.executed',
  'siem.event',
  'telemetry.sync.completed',
  'telemetry.sync.failed',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENTS[number];

/** Webhook enabled/disabled status */
export const WebhookStatusSchema = z.enum(['enabled', 'disabled']);
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;

/** Webhook delivery status */
export const DeliveryStatusSchema = z.enum([
  'pending',
  'success',
  'failed',
  'retrying',
  'dead_letter',
  // The tier gate withheld the delivery — nothing was sent. Deliberately NOT
  // folded into 'failed': an operator reading a wall of failures for a tier that
  // is never supposed to emit would either chase a non-problem or learn to
  // ignore the failure column.
  'suppressed',
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

/**
 * Create webhook request.
 *
 * NOT `.strict()`, and that is a decision rather than an omission. The question was
 * raised because the strip default has the familiar asymmetry — a caller writing
 * `secrets` for `secret` gets an UNSIGNED webhook — and it was refused on a measurement:
 * nothing in the repository calls `.parse()` on this schema. It is a type source, and a
 * schema nobody parses cannot reject anything, so `.strict()` here would change no
 * behaviour while making the next reader believe the boundary is defended.
 *
 * It becomes correct — and required — the moment `createWebhook` parses its input. See
 * the note on that function in `./store`.
 */
export const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(32).max(256).optional(),
  // TODO: Add secret rotation fields
});

export type CreateWebhookRequest = z.infer<typeof CreateWebhookSchema>;

/** Update webhook request. Not `.strict()` for the same measured reason as
 *  `CreateWebhookSchema` above — and with a sharper field at stake: a misspelled
 *  `rotateSecret` is dropped, the update succeeds, and the secret the operator believes
 *  they just retired is still live. */
export const UpdateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  status: WebhookStatusSchema.optional(),
  // Secret rotation
  rotateSecret: z.boolean().optional(),
});

export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookSchema>;

/** Webhook configuration (stored) */
export const WebhookConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  status: WebhookStatusSchema,
  secretHash: z.string(), // Store hash, not plain secret
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

/**
 * Webhook payload sent to endpoints.
 *
 * `.strict()`, AND PARSED — unlike the two schemas above, and the difference is the
 * measurement their notes name. Those are type sources nobody calls `.parse()` on, so
 * strictness there would change no behaviour while making the boundary look defended.
 * This one IS parsed now, at the single place a webhook body is constructed
 * (`buildPayload` in ./dispatch), so the condition those notes set is met and the
 * modifier does real work: the six keys below are the six keys that can leave, and an
 * unknown seventh throws instead of being silently stripped.
 *
 * WHAT IT REJECTS, precisely, because the clause above overstates itself if left
 * alone: it rejects a SEVENTH KEY ADDED TO THE OBJECT LITERAL BELOW — a source
 * edit, caught at the next dispatch rather than at review. It is very nearly not
 * input validation at all: all six values are constructed by `buildPayload` itself,
 * and caller data is confined to `data`, which is `z.record(z.unknown())`, so no key
 * a caller puts INSIDE it is validated. The single caller-reachable rejection is
 * `data` not being an object. Mostly a tripwire on our own edits, stated as one.
 *
 * It was unparsed for the whole life of the family. That is why the caller's `data`
 * was copied verbatim with nothing asserting what surrounded it: the emit gate
 * answered "may I send" and nothing answered "what may I send".
 *
 * `data` IS THE DECLARED OPEN SLOT for this family — the caller composes the event
 * body and the dispatcher does not interpret it. Deliberately still `z.record`:
 * pinning it would be a false closure, since the fabric's event bodies are not one
 * shape. Declared in ../adapters/payload-fields.ts.
 */
export const WebhookPayloadSchema = z.object({
  id: z.string().uuid(), // Unique event ID
  type: z.enum(WEBHOOK_EVENTS),
  timestamp: z.string().datetime(),
  source: z.object({
    service: z.string(),
    version: z.string(),
  }),
  data: z.record(z.string(), z.unknown()),
  deliveryId: z.string().uuid(), // For idempotency
}).strict();

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

/** Delivery log entry */
export const DeliveryLogSchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  eventId: z.string().uuid(),
  status: DeliveryStatusSchema,
  attempts: z.number().int().min(0),
  responseCode: z.number().int().optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
  lastAttemptAt: z.string().datetime().optional(),
  nextRetryAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type DeliveryLog = z.infer<typeof DeliveryLogSchema>;

/** Webhook with delivery stats (response) */
export const WebhookWithStatsSchema = WebhookConfigSchema.extend({
  deliveryStats: z.object({
    recentAttempts: z.number().int(),
    recentSuccesses: z.number().int(),
    recentFailures: z.number().int(),
  }),
  recentDeliveries: z.array(DeliveryLogSchema),
});

export type WebhookWithStats = z.infer<typeof WebhookWithStatsSchema>;

/** DLQ entry */
export const DLQEntrySchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  eventId: z.string().uuid(),
  payload: WebhookPayloadSchema,
  attempts: z.number().int(),
  lastError: z.string(),
  failedAt: z.string().datetime(),
});

export type DLQEntry = z.infer<typeof DLQEntrySchema>;

/** Event emitter interface - used by other modules to emit events */
export interface WebhookEmitter {
  emit(event: WebhookEventType, data: Record<string, unknown>): Promise<void>;
}
