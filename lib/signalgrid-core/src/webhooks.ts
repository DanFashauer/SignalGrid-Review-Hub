import type { MemoryStore } from "./store";
import { deterministicId } from "./util";
import type { Clock } from "./util";
import type {
  AuditEventType,
  DeliveryAttempt,
  DeliveryStatus,
  WebhookDelivery,
  WebhookEndpoint,
} from "./types";

/**
 * Simulated webhook delivery.
 *
 * PUBLIC-SAFE: no real HTTP request is ever made. Delivery is evaluated against
 * an in-memory fixture "sink" whose reliability is configured per endpoint
 * (`failuresBeforeSuccess`), so retry-with-exponential-backoff can be shown
 * deterministically. The backoff schedule is recorded, never actually awaited.
 * This models the plan's `webhook_deliveries` outbound-routing layer.
 */
export function deliverEvent(
  store: MemoryStore,
  clock: Clock,
  tenantId: string,
  decisionId: string,
  event: AuditEventType,
): WebhookDelivery[] {
  const endpoints = store
    .listWebhookEndpoints(tenantId)
    .filter((endpoint) => endpoint.active && endpoint.events.includes(event));

  const deliveries: WebhookDelivery[] = [];
  for (const endpoint of endpoints) {
    const delivery = attemptDelivery(clock, endpoint, decisionId, event);
    store.putWebhookDelivery(delivery);
    deliveries.push(delivery);
  }
  return deliveries;
}

function attemptDelivery(
  clock: Clock,
  endpoint: WebhookEndpoint,
  decisionId: string,
  event: AuditEventType,
): WebhookDelivery {
  const attempts: DeliveryAttempt[] = [];
  let status: DeliveryStatus = "dead_letter";

  for (let attempt = 1; attempt <= endpoint.maxAttempts; attempt++) {
    const succeeds = attempt > endpoint.failuresBeforeSuccess;
    attempts.push({
      attempt,
      status: succeeds ? "ok" : "error",
      simulatedStatusCode: succeeds ? 200 : 503,
      // Exponential backoff schedule (recorded, not awaited): 1s, 2s, 4s, …
      backoffSeconds: succeeds ? 0 : 2 ** (attempt - 1),
    });
    if (succeeds) {
      status = "delivered";
      break;
    }
    if (attempt === endpoint.maxAttempts) {
      status = "dead_letter";
    }
  }

  return {
    id: deterministicId("whd", endpoint.id, decisionId, event),
    tenantId: endpoint.tenantId,
    endpointId: endpoint.id,
    decisionId,
    event,
    status,
    attempts,
    createdAt: clock.now().toISOString(),
  };
}
