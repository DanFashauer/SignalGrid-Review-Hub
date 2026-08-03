/**
 * Webhooks Store
 * 
 * Persists webhook configurations in Redis (production) or in-memory (development).
 * Supports CRUD operations, delivery logs, and DLQ management.
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import { 
  WebhookConfig, 
  WebhookConfigSchema, 
  WebhookEventType,
  DeliveryLog,
  DeliveryLogSchema,
  DLQEntry,
  DLQEntrySchema,
  CreateWebhookRequest,
  UpdateWebhookRequest,
} from './types';

// Environment
const REDIS_URL = process.env.REDIS_URL;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Redis client (lazy init)
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
  }
  return redis;
}

// Keys
const WEBHOOK_KEY_PREFIX = 'webhooks:config';
const DELIVERY_LOG_PREFIX = 'webhooks:delivery';
const DLQ_PREFIX = 'webhooks:dlq';
const WEBHOOK_INDEX_KEY = 'webhooks:index';

// In-memory fallback for development
const memoryStore: {
  webhooks: Map<string, WebhookConfig>;
  deliveryLogs: Map<string, DeliveryLog[]>;
  dlq: DLQEntry[];
} = {
  webhooks: new Map(),
  deliveryLogs: new Map(),
  dlq: [],
};

/** Generate secure secret hash */
function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Generate UUID */
function generateId(): string {
  return crypto.randomUUID();
}

/** Get current timestamp */
function now(): string {
  return new Date().toISOString();
}

/**
 * Create a new webhook.
 *
 * ⚠️ BEFORE YOU GIVE THIS FUNCTION A ROUTE, READ THIS.
 *
 * It takes a `CreateWebhookRequest` and never parses one. `CreateWebhookSchema` is a
 * TYPE SOURCE here, not a validator — nothing in the repository calls `.parse()` on it,
 * so `url: z.string().url()` is a URL in the type system and an arbitrary string at
 * runtime. The same is true of `updateWebhook` below. Today that costs nothing: both
 * functions have ZERO callers, and `artifacts/api-server` exposes only
 * `GET /v1/webhooks` and `GET /v1/webhooks/deliveries` — there is no write route, so
 * nothing untrusted can reach either one.
 *
 * The moment a POST/PATCH route exists, that changes shape completely: whatever the
 * route hands in lands in Redis unvalidated, and the delivery path then POSTs to the
 * stored `url`. That is the SSRF shape, latent behind a missing route rather than
 * behind a check.
 *
 * So the route and the validation are ONE change, not two:
 *   1. `CreateWebhookSchema.parse(input)` / `UpdateWebhookSchema.parse(input)` at the
 *      top of each function — the boundary is here, not in the handler, because an
 *      exported function cannot assume its only caller is the one you are writing.
 *   2. THEN `.strict()` on both schemas. Not before: a schema nobody parses cannot
 *      reject anything, so strictness added on its own is decorative. With a parse in
 *      place it is load-bearing, and it is the same asymmetry the `uem`/`nac` config
 *      schemas were tightened for — an operator writing `secrets` for `secret` gets an
 *      UNSIGNED webhook, and one writing `state` for `status` gets a webhook that stays
 *      ENABLED. Both silent, both in the permissive direction.
 *
 * Recorded rather than pre-fixed on the `lib/dual-control` precedent
 * (`scripts/check-package-reachability.mjs`): a repair shipped into a path nothing calls
 * is proven by a proof and reachable by nothing, and it makes the next reader believe
 * the boundary is defended when the boundary does not exist yet. See
 * `docs/BUILD_BACKLOG.md`.
 */
export async function createWebhook(
  input: CreateWebhookRequest
): Promise<WebhookConfig> {
  const r = getRedis();
  
  const id = generateId();
  const secret = input.secret || crypto.randomBytes(32).toString('hex');
  const nowTimestamp = now();
  
  const webhook: WebhookConfig = {
    id,
    name: input.name,
    url: input.url,
    events: input.events,
    status: 'enabled',
    secretHash: hashSecret(secret),
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
  };

  if (r) {
    // Redis storage
    await r.hset(`${WEBHOOK_KEY_PREFIX}:${id}`, toRedisHash(webhook));
    await r.sadd(WEBHOOK_INDEX_KEY, id);
  } else {
    // In-memory storage
    memoryStore.webhooks.set(id, webhook);
  }

  // Return webhook (without secret hash for security)
  const { secretHash: _, ...safeWebhook } = webhook;
  return safeWebhook as WebhookConfig;
}

/**
 * Get webhook by ID
 */
export async function getWebhook(id: string): Promise<WebhookConfig | null> {
  const r = getRedis();
  
  if (r) {
    const data = await r.hgetall(`${WEBHOOK_KEY_PREFIX}:${id}`);
    if (!data || Object.keys(data).length === 0) return null;
    return parseWebhookFromRedis(data);
  }
  
  const webhook = memoryStore.webhooks.get(id);
  if (!webhook) return null;
  const { secretHash: _, ...safe } = webhook;
  return safe as WebhookConfig;
}

/**
 * Get all webhooks
 */
export async function listWebhooks(): Promise<WebhookConfig[]> {
  const r = getRedis();
  
  if (r) {
    const ids = await r.smembers(WEBHOOK_INDEX_KEY);
    if (!ids || ids.length === 0) return [];
    
    const pipeline = r.pipeline();
    for (const id of ids) {
      pipeline.hgetall(`${WEBHOOK_KEY_PREFIX}:${id}`);
    }
    const results = await pipeline.exec();
    if (!results) return [];
    
    return results
      .map(([err, data]) => {
        if (err || !data) return null;
        return parseWebhookFromRedis(data as Record<string, string>);
      })
      .filter((w): w is WebhookConfig => w !== null);
  }
  
  return Array.from(memoryStore.webhooks.values()).map(({ secretHash: _, ...w }) => w as WebhookConfig);
}

/**
 * Get webhooks subscribed to an event
 */
export async function getWebhooksForEvent(event: WebhookEventType): Promise<WebhookConfig[]> {
  const all = await listWebhooks();
  return all.filter(w => w.status === 'enabled' && w.events.includes(event));
}

/**
 * Update webhook.
 *
 * ⚠️ Unvalidated for the same reason as `createWebhook` — read the note there before
 * adding a route. `rotateSecret` is the field that makes this one worse than the create
 * path: a caller that misspells it gets a successful update and a secret that was NOT
 * rotated, while believing a compromised one has just been retired.
 */
export async function updateWebhook(
  id: string,
  input: UpdateWebhookRequest
): Promise<WebhookConfig | null> {
  const existing = await getWebhook(id);
  if (!existing) return null;
  
  const r = getRedis();
  const nowTimestamp = now();
  
  let newSecretHash = existing.secretHash;
  let newSecret: string | undefined;
  
  // Handle secret rotation
  if (input.rotateSecret) {
    newSecret = crypto.randomBytes(32).toString('hex');
    newSecretHash = hashSecret(newSecret);
  }
  
  const updated: WebhookConfig = {
    ...existing,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.url !== undefined && { url: input.url }),
    ...(input.events !== undefined && { events: input.events }),
    ...(input.status !== undefined && { status: input.status }),
    secretHash: newSecretHash,
    updatedAt: nowTimestamp,
  };

  if (r) {
    await r.hset(`${WEBHOOK_KEY_PREFIX}:${id}`, toRedisHash(updated));
  } else {
    memoryStore.webhooks.set(id, updated);
  }

  const { secretHash: _, ...safe } = updated;
  
  // Return new secret if rotated (only this one time)
  if (newSecret) {
    return { ...safe, _newSecret: newSecret } as unknown as WebhookConfig;
  }
  
  return safe as WebhookConfig;
}

/**
 * Delete webhook
 */
export async function deleteWebhook(id: string): Promise<boolean> {
  const r = getRedis();
  
  if (r) {
    const deleted = await r.del(`${WEBHOOK_KEY_PREFIX}:${id}`);
    await r.srem(WEBHOOK_INDEX_KEY, id);
    return deleted > 0;
  }
  
  return memoryStore.webhooks.delete(id);
}

/**
 * Get webhook secret hash (internal use only)
 */
export async function getWebhookSecretHash(id: string): Promise<string | null> {
  const r = getRedis();
  
  if (r) {
    return await r.hget(`${WEBHOOK_KEY_PREFIX}:${id}`, 'secretHash');
  }
  
  const webhook = memoryStore.webhooks.get(id);
  return webhook?.secretHash || null;
}

/**
 * Record delivery attempt
 */
export async function recordDelivery(
  webhookId: string,
  eventId: string,
  status: DeliveryLog['status'],
  responseCode?: number,
  responseBody?: string,
  error?: string,
  nextRetryAt?: string
): Promise<DeliveryLog> {
  const r = getRedis();
  const id = generateId();
  const nowTimestamp = now();
  
  // Get existing or create new
  const existingLogs = await getDeliveryLogs(webhookId);
  const attempts = existingLogs.length + 1;
  
  const log: DeliveryLog = {
    id,
    webhookId,
    eventId,
    status,
    attempts,
    responseCode,
    responseBody: responseBody?.slice(0, 1000), // Truncate
    error: error?.slice(0, 500),
    lastAttemptAt: nowTimestamp,
    nextRetryAt,
    createdAt: nowTimestamp,
  };

  if (r) {
    const key = `${DELIVERY_LOG_PREFIX}:${webhookId}`;
    await r.lpush(key, JSON.stringify(log));
    await r.ltrim(key, 0, 99); // Keep last 100
    await r.expire(key, 86400 * 7); // 7 days TTL
  } else {
    const logs = memoryStore.deliveryLogs.get(webhookId) || [];
    logs.unshift(log);
    memoryStore.deliveryLogs.set(webhookId, logs.slice(0, 100));
  }

  return log;
}

/**
 * Get delivery logs for a webhook
 */
export async function getDeliveryLogs(
  webhookId: string,
  limit = 20
): Promise<DeliveryLog[]> {
  const r = getRedis();
  
  if (r) {
    const logs = await r.lrange(`${DELIVERY_LOG_PREFIX}:${webhookId}`, 0, limit - 1);
    return logs.map(l => DeliveryLogSchema.parse(JSON.parse(l)));
  }
  
  return (memoryStore.deliveryLogs.get(webhookId) || []).slice(0, limit);
}

/**
 * Add to DLQ
 */
export async function addToDLQ(
  webhookId: string,
  eventId: string,
  payload: unknown,
  error: string
): Promise<DLQEntry> {
  const r = getRedis();
  const entry: DLQEntry = {
    id: generateId(),
    webhookId,
    eventId,
    payload: payload as DLQEntry['payload'],
    attempts: 6, // After max retries
    lastError: error.slice(0, 500),
    failedAt: now(),
  };

  if (r) {
    await r.lpush(DLQ_PREFIX, JSON.stringify(entry));
    await r.ltrim(DLQ_PREFIX, 0, 999); // Keep last 1000
    await r.expire(DLQ_PREFIX, 86400 * 30); // 30 days TTL
  } else {
    memoryStore.dlq.unshift(entry);
    memoryStore.dlq.splice(1000);
  }

  return entry;
}

/**
 * Get DLQ entries
 */
export async function getDLQ(limit = 50): Promise<DLQEntry[]> {
  const r = getRedis();
  
  if (r) {
    const entries = await r.lrange(DLQ_PREFIX, 0, limit - 1);
    return entries.map(e => DLQEntrySchema.parse(JSON.parse(e)));
  }
  
  return memoryStore.dlq.slice(0, limit);
}

/**
 * Remove from DLQ
 */
export async function removeFromDLQ(id: string): Promise<boolean> {
  const r = getRedis();
  
  if (r) {
    const entries = await r.lrange(DLQ_PREFIX, 0, -1);
    let removed = false;
    for (const entry of entries) {
      const parsed = JSON.parse(entry);
      if (parsed.id === id) {
        await r.lrem(DLQ_PREFIX, 1, entry);
        removed = true;
        break;
      }
    }
    return removed;
  }
  
  const idx = memoryStore.dlq.findIndex(e => e.id === id);
  if (idx >= 0) {
    memoryStore.dlq.splice(idx, 1);
    return true;
  }
  return false;
}

// Note: retryFromDLQ can be implemented if needed

// Helpers

function toRedisHash(webhook: WebhookConfig): Record<string, string> {
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: JSON.stringify(webhook.events),
    status: webhook.status,
    secretHash: webhook.secretHash,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
  };
}

function parseWebhookFromRedis(data: Record<string, string>): WebhookConfig {
  return WebhookConfigSchema.parse({
    id: data.id,
    name: data.name,
    url: data.url,
    events: JSON.parse(data.events),
    status: data.status,
    secretHash: data.secretHash,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  });
}

// Type for response that includes new secret
export interface WebhookWithNewSecret extends Omit<WebhookConfig, '_newSecret'> {
  _newSecret?: string;
}
