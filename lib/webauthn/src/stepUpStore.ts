/**
 * Step-Up Session Store
 * 
 * Manages WebAuthn/FIDO2 step-up authentication sessions for high-risk admin operations.
 * Provides time-limited step-up verification with user binding.
 * 
 * Features:
 * - Step-up session creation with expiration
 * - Session verification by ID
 * - User binding (step-up is tied to specific user)
 * - Request ID binding (prevents session hijacking across requests)
 * - Redis-backed for production, in-memory for development
 * 
 * Environment variables:
 * - REDIS_URL: Redis connection URL (optional - uses in-memory if not set)
 * - STEPUP_TTL_SECONDS: Step-up session time-to-live (default: 5 minutes)
 */

import { randomBytes } from 'crypto';
import Redis from 'ioredis';

// ============================================================================
// Types
// ============================================================================

export interface StepUpSession {
  /** Unique step-up session ID */
  stepUpSessionId: string;
  /** User ID that initiated the step-up */
  userId: string;
  /** Request ID that initiated the step-up (binds to specific request) */
  requestId: string;
  /** Step-up challenge/operation type */
  challenge: StepUpChallenge;
  /** Step-up verified timestamp */
  verifiedAt?: string;
  /** Session created timestamp */
  createdAt: string;
  /** Session expires timestamp */
  expiresAt: string;
}

export type StepUpChallenge = 
  | 'webhook_secret_rotate'
  | 'integration_credential_set'
  | 'integration_credential_update'
  | 'policy_edit'
  | 'policy_enable'
  | 'device_quarantine'
  | 'allowlist_toggle'
  | 'admin_delete'
  | 'device_unenroll';

/** Operations that require step-up authentication */
export const STEPUP_REQUIRED_OPERATIONS: StepUpChallenge[] = [
  'webhook_secret_rotate',
  'integration_credential_set',
  'integration_credential_update',
  'policy_edit',
  'policy_enable',
  'device_quarantine',
  'allowlist_toggle',
  'admin_delete',
  'device_unenroll',
];

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  redisUrl: process.env.REDIS_URL,
  keyPrefix: 'stepup',
  ttlSeconds: parseInt(process.env.STEPUP_TTL_SECONDS ?? '300'), // 5 minutes default
};

// ============================================================================
// Redis Client (lazy initialization)
// ============================================================================

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!CONFIG.redisUrl) {
    return null;
  }
  
  if (!redis) {
    redis = new Redis(CONFIG.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      console.error('[StepUpStore] Redis error:', err.message);
    });
  }
  return redis;
}

// ============================================================================
// In-Memory Fallback Store
// ============================================================================

const memoryStore = new Map<string, { session: StepUpSession; expiresAt: number }>();

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  // Step-up session IDs are security tokens (they gate high-risk operations),
  // so they must be unguessable — use CSPRNG bytes, never Math.random().
  return `su_${Date.now()}_${randomBytes(16).toString('hex')}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Create a new step-up session
 * This is called after successful WebAuthn verification to record that step-up occurred
 */
export async function createStepUpSession(
  userId: string,
  requestId: string,
  challenge: StepUpChallenge
): Promise<StepUpSession> {
  const now = new Date();
  const session: StepUpSession = {
    stepUpSessionId: generateId(),
    userId,
    requestId,
    challenge,
    verifiedAt: nowISO(),
    createdAt: nowISO(),
    expiresAt: addSeconds(now, CONFIG.ttlSeconds),
  };

  const redis = getRedis();
  if (redis) {
    await redis.setex(
      `${CONFIG.keyPrefix}:${session.stepUpSessionId}`,
      CONFIG.ttlSeconds,
      JSON.stringify(session)
    );
    console.log(`[StepUpStore] Created step-up session ${session.stepUpSessionId} for user ${userId}`);
  } else {
    memoryStore.set(session.stepUpSessionId, {
      session,
      expiresAt: now.getTime() + CONFIG.ttlSeconds * 1000,
    });
    console.log(`[StepUpStore] Created step-up session ${session.stepUpSessionId} for user ${userId} (in-memory)`);
  }

  return session;
}

/**
 * Verify a step-up session is valid and belongs to the correct user/request
 * Returns null if invalid, expired, or doesn't match
 */
export async function verifyStepUpSession(
  stepUpSessionId: string,
  userId: string,
  requestId: string,
  challenge?: StepUpChallenge
): Promise<StepUpSession | null> {
  const redis = getRedis();
  let sessionData: string | null = null;

  if (redis) {
    sessionData = await redis.get(`${CONFIG.keyPrefix}:${stepUpSessionId}`);
  } else {
    const entry = memoryStore.get(stepUpSessionId);
    if (entry && entry.expiresAt > Date.now()) {
      sessionData = JSON.stringify(entry.session);
    }
  }

  if (!sessionData) {
    console.log(`[StepUpStore] Step-up session ${stepUpSessionId} not found or expired`);
    return null;
  }

  const session: StepUpSession = JSON.parse(sessionData);

  // Check expiration
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    console.log(`[StepUpStore] Step-up session ${stepUpSessionId} expired`);
    return null;
  }

  // Check user binding
  if (session.userId !== userId) {
    console.log(`[StepUpStore] Step-up session ${stepUpSessionId} user mismatch: ${session.userId} != ${userId}`);
    return null;
  }

  // Check request binding (prevents session hijacking)
  if (session.requestId !== requestId) {
    console.log(`[StepUpStore] Step-up session ${stepUpSessionId} request mismatch: ${session.requestId} != ${requestId}`);
    return null;
  }

  // Check challenge type if provided
  if (challenge && session.challenge !== challenge) {
    console.log(`[StepUpStore] Step-up session ${stepUpSessionId} challenge mismatch: ${session.challenge} != ${challenge}`);
    return null;
  }

  return session;
}

/**
 * Consume/invalidate a step-up session after use
 * This prevents replay attacks
 */
export async function consumeStepUpSession(stepUpSessionId: string): Promise<boolean> {
  const redis = getRedis();
  
  if (redis) {
    const result = await redis.del(`${CONFIG.keyPrefix}:${stepUpSessionId}`);
    return result > 0;
  } else {
    return memoryStore.delete(stepUpSessionId);
  }
}

/**
 * Check if a step-up session exists and is valid (without consuming it)
 * Useful for checking if user has recently completed step-up
 */
export async function hasValidStepUpSession(
  userId: string,
  challenge?: StepUpChallenge
): Promise<boolean> {
  // This would require scanning - for now, rely on explicit verification
  // In production, you might want to track "recently verified" state differently
  return false;
}

// ============================================================================
// Middleware Helper
// ============================================================================

/**
 * Check if an operation requires step-up authentication
 */
export function requiresStepUp(challenge: string): challenge is StepUpChallenge {
  return STEPUP_REQUIRED_OPERATIONS.includes(challenge as StepUpChallenge);
}

/**
 * Parse step-up requirements from request
 * Returns the challenge type if step-up is required, null otherwise
 */
export function getRequiredChallenge(operation: string): StepUpChallenge | null {
  const op = operation.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  // Map operations to challenges
  const operationToChallenge: Record<string, StepUpChallenge> = {
    'webhook_secret_rotate': 'webhook_secret_rotate',
    'set_integration_credential': 'integration_credential_set',
    'update_integration_credential': 'integration_credential_update',
    'policy_edit': 'policy_edit',
    'policy_enable': 'policy_enable',
    'device_quarantine': 'device_quarantine',
    'toggle_allowlist': 'allowlist_toggle',
    'admin_delete': 'admin_delete',
    'device_unenroll': 'device_unenroll',
  };
  
  return operationToChallenge[op] || null;
}
