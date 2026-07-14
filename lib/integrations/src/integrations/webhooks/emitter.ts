/**
 * Webhook Event Emitter
 * 
 * Central module for emitting events to webhook subscribers.
 * Used by session, badge, auth, and location modules.
 */

import { dispatchEvent, WebhookEventType } from './dispatch';

/**
 * Emit an event to all subscribed webhook endpoints
 * 
 * @param event - The event type (session.start, session.end, etc.)
 * @param data - Event data to send to webhooks
 * @returns Promise with dispatch results
 */
export async function emitWebhookEvent(
  event: WebhookEventType,
  data: Record<string, unknown>
): Promise<{ dispatched: number; succeeded: number; failed: number }> {
  try {
    const result = await dispatchEvent(event, data);
    return result;
  } catch (error) {
    // Log error but don't throw - webhooks should be best-effort
    console.error(`[WebhookEmitter] Failed to emit ${event}:`, error);
    return { dispatched: 0, succeeded: 0, failed: 0 };
  }
}

// Convenience functions for common events

/**
 * Emit session.start event
 */
export async function emitSessionStart(data: {
  sessionId: string;
  userId: string;
  deviceId: string;
  badgeId: string;
  timestamp: string;
}) {
  return emitWebhookEvent('session.start', data);
}

/**
 * Emit session.end event
 */
export async function emitSessionEnd(data: {
  sessionId: string;
  userId: string;
  deviceId: string;
  reason: string;
  timestamp: string;
}) {
  return emitWebhookEvent('session.end', data);
}

/**
 * Emit badge.enroll event
 */
export async function emitBadgeEnroll(data: {
  badgeId: string;
  userId: string;
  enrolledBy: string;
  timestamp: string;
}) {
  return emitWebhookEvent('badge.enroll', data);
}

/**
 * Emit badge.delete event
 */
export async function emitBadgeDelete(data: {
  badgeId: string;
  userId: string;
  deletedBy: string;
  timestamp: string;
}) {
  return emitWebhookEvent('badge.delete', data);
}

/**
 * Emit auth.failure event
 */
export async function emitAuthFailure(data: {
  deviceId: string;
  reason: string;
  code?: string;
  timestamp: string;
}) {
  return emitWebhookEvent('auth.failure', data);
}

/**
 * Emit siem.event event
 */
export async function emitSIEMEvent(data: {
  eventType: string;
  destination: string;
  status: 'sent' | 'failed';
  eventId: string;
  timestamp: string;
  error?: string;
}) {
  return emitWebhookEvent('siem.event', data);
}

/**
 * Emit asset.location.observed event
 */
export async function emitLocationObserved(data: {
  deviceId: string;
  badgeId: string;
  location: {
    mode: string;
    zone?: string;
    building?: string;
    floor?: string;
    coordinates?: { lat: number; lon: number };
    accuracy?: number;
    source?: string;
  };
  timestamp: string;
}) {
  return emitWebhookEvent('asset.location.observed', data);
}
