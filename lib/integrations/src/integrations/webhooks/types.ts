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

/** Create webhook request */
export const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(32).max(256).optional(),
  // TODO: Add secret rotation fields
});

export type CreateWebhookRequest = z.infer<typeof CreateWebhookSchema>;

/** Update webhook request */
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

/** Webhook payload sent to endpoints */
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
});

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
