// WebAuthn Store
// Credential storage for WebAuthn/FIDO2 (Redis with in-memory fallback).
//
// Redis backend requirement: challenge consumption uses GETDEL, so a configured
// REDIS_URL must point at Redis >= 6.2. On an older server the step-up completion
// throws (fails closed) rather than degrading to a racy GET+DEL. Managed Redis
// (AWS/GCP/Azure/Upstash) is 6.2+/7.x, so this holds by default.

import type { WebAuthnUser, WebAuthnCredential, WebAuthnChallenge, StepUpSession } from './types';

const USER_PREFIX = 'webauthn:user:';
const CHALLENGE_PREFIX = 'webauthn:challenge:';
const STEPUP_PREFIX = 'webauthn:stepup:';

function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
}

/** Whether Redis is CONFIGURED (not merely reachable). The authoritative store
 *  for single-use challenges is chosen by configuration, never by runtime
 *  reachability — a transient connect failure must not silently flip a challenge
 *  into a second (in-memory) store, which is exactly the divergence that lets a
 *  single-use challenge be replayed. */
function redisConfigured(): boolean {
  return !!getRedisUrl();
}

async function getRedisClient() {
  const { Redis } = await import('ioredis');
  const url = getRedisUrl();
  if (!url) return null;
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
}

// In-memory fallback
const inMemoryUsers: Map<string, WebAuthnUser> = new Map();
const inMemoryChallenges: Map<string, { challenge: WebAuthnChallenge; userId?: string }> = new Map();
const inMemoryStepUps: Map<string, StepUpSession> = new Map();

// ============================================================================
// User Credentials
// ============================================================================

export async function getUser(userId: string): Promise<WebAuthnUser | null> {
  const redis = await getRedisClient();
  const key = `${USER_PREFIX}${userId}`;

  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }

  return inMemoryUsers.get(userId) ?? null;
}

export async function saveUser(user: WebAuthnUser): Promise<void> {
  const redis = await getRedisClient();
  const key = `${USER_PREFIX}${user.userId}`;

  if (redis) {
    try {
      await redis.connect();
      await redis.set(key, JSON.stringify(user), 'EX', 86400); // 24h
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }

  inMemoryUsers.set(user.userId, user);
}

export async function addCredential(userId: string, credential: WebAuthnCredential): Promise<void> {
  const user = await getUser(userId);
  
  if (user) {
    user.credentials.push(credential);
    await saveUser(user);
  } else {
    await saveUser({
      userId,
      credentials: [credential],
      createdAt: new Date().toISOString(),
    });
  }
}

export async function removeCredential(userId: string, credentialId: string): Promise<boolean> {
  const user = await getUser(userId);
  
  if (!user) {
    return false;
  }

  const index = user.credentials.findIndex(c => c.id === credentialId);
  if (index === -1) {
    return false;
  }

  user.credentials.splice(index, 1);
  
  if (user.credentials.length === 0) {
    // Remove user entirely
    const redis = await getRedisClient();
    const key = `${USER_PREFIX}${userId}`;
    
    if (redis) {
      try {
        await redis.connect();
        await redis.del(key);
      } catch {
        // Fall through
      } finally {
        await redis.quit();
      }
    }
    
    inMemoryUsers.delete(userId);
  } else {
    await saveUser(user);
  }

  return true;
}

export async function getCredentialsForUser(userId: string): Promise<WebAuthnCredential[]> {
  const user = await getUser(userId);
  return user?.credentials ?? [];
}

/**
 * Atomically advance a credential's signature counter — but ONLY if it still holds the
 * value the caller verified against (`expectedCounter`) and the new value is strictly
 * greater. Returns true if the advance was applied; false if the stored counter no
 * longer matches (a concurrent completion already advanced it), the new value is not an
 * increase, or the row is gone.
 *
 * The caller MUST fail closed on false: the counter it ran the clone-regression check
 * against is stale, so it can no longer prove this assertion is not a replay of an
 * already-used count. This closes the read-modify-write race the naive
 * getUser→mutate→saveUser sequence left open — two valid challenges for the same
 * credential both passing the regression check against the same stored counter, then
 * their separate writes landing out of order so the LOWER counter overwrites the higher
 * (after which a clone can re-present the already-used higher count and pass). A
 * compare-and-advance makes exactly one writer win and forces the other to fail closed.
 * Same discipline, and same Redis-version requirement, as getAndDeleteChallenge's GETDEL.
 */
export async function advanceCredentialCounter(
  userId: string,
  credentialId: string,
  expectedCounter: number,
  newCounter: number,
  usedAtIso: string,
): Promise<boolean> {
  // Never a no-op or a regression: only a strict increase is a legitimate advance.
  if (!(newCounter > expectedCounter)) return false;

  const key = `${USER_PREFIX}${userId}`;

  if (redisConfigured()) {
    const redis = await getRedisClient();
    try {
      await redis!.connect();
      // Optimistic lock: WATCH the row, verify the counter is still what we checked the
      // regression against, then commit inside a MULTI. If another completion advanced
      // the row after our WATCH, EXEC returns null and we fail closed.
      await redis!.watch(key);
      const data = await redis!.get(key);
      if (!data) { await redis!.unwatch(); return false; }
      const user = JSON.parse(data) as WebAuthnUser;
      const cred = user.credentials.find((c) => c.id === credentialId);
      if (!cred || cred.counter !== expectedCounter) { await redis!.unwatch(); return false; }
      cred.counter = newCounter;
      cred.lastUsedAt = usedAtIso;
      const execRes = await redis!.multi().set(key, JSON.stringify(user), 'EX', 86400).exec();
      if (execRes === null) return false; // WATCHed key changed mid-transaction → lost the race
      inMemoryUsers.set(userId, user); // keep the in-memory mirror consistent (as saveUser does)
      return true;
    } finally {
      await redis!.quit();
    }
  }

  // No Redis configured: single-process in-memory mode. The read-check-write below runs
  // to completion with NO await between the check and the mutation, so it cannot
  // interleave — the same guarantee getAndDeleteChallenge relies on in this mode.
  const user = inMemoryUsers.get(userId);
  if (!user) return false;
  const cred = user.credentials.find((c) => c.id === credentialId);
  if (!cred || cred.counter !== expectedCounter) return false;
  cred.counter = newCounter;
  cred.lastUsedAt = usedAtIso;
  return true;
}

// ============================================================================
// Challenges
// ============================================================================

/** Purge expired entries from the in-memory challenge map. Redis entries expire via
 *  EX; without this sweep the in-memory fallback grew one entry per request forever
 *  (adversarial-review finding). Called on every save, so the map is self-cleaning
 *  and bounded by the 60s TTL regardless of backend. */
function purgeExpiredInMemoryChallenges(): void {
  const now = Date.now();
  for (const [key, entry] of inMemoryChallenges) {
    const exp = Date.parse(entry.challenge.expiresAt);
    if (!Number.isNaN(exp) && exp <= now) inMemoryChallenges.delete(key);
  }
}

export async function saveChallenge(
  challengeId: string,
  challenge: WebAuthnChallenge,
  userId?: string
): Promise<void> {
  const key = `${CHALLENGE_PREFIX}${challengeId}`;

  // A single-use challenge must live in exactly ONE store. When Redis is
  // configured it is the SOLE authoritative store shared across every API
  // instance; we do NOT also mirror into per-process memory. A mirrored copy on
  // the minting instance would survive a completion consumed on another instance
  // (which clears only Redis + its own memory) and let the challenge be replayed
  // — fatal for authenticators whose signature counter stays 0. A Redis failure
  // here is deliberately NOT swallowed: the challenge simply is not saved, so the
  // later completion fails closed (403) rather than degrading to a second store.
  if (redisConfigured()) {
    const redis = await getRedisClient();
    try {
      await redis!.connect();
      await redis!.set(key, JSON.stringify({ challenge, userId }), 'EX', 60); // 60s
    } finally {
      await redis!.quit();
    }
    return;
  }

  // No Redis configured: single-process in-memory mode is the only store.
  purgeExpiredInMemoryChallenges();
  inMemoryChallenges.set(key, { challenge, userId });
}

/** Non-consuming read of a stored challenge's action context. Used by the completion
 *  route to verify the request matches the action the challenge was MINTED for,
 *  BEFORE the (single-use, consuming) cryptographic verification runs. Returns null
 *  for an unknown or expired challenge — the caller fails closed on null. */
export async function getChallengeContext(
  challengeId: string
): Promise<{ context: Record<string, string> | undefined; userId?: string } | null> {
  const key = `${CHALLENGE_PREFIX}${challengeId}`;

  // Read from the SAME single authoritative store saveChallenge wrote to. When
  // Redis is configured, a miss means the challenge is gone (expired or already
  // consumed) — fail closed on null rather than falling back to a stale
  // in-memory copy that Redis-mode never populates.
  if (redisConfigured()) {
    const redis = await getRedisClient();
    try {
      await redis!.connect();
      const data = await redis!.get(key);
      if (!data) return null;
      const parsed = JSON.parse(data) as { challenge: WebAuthnChallenge; userId?: string };
      return { context: parsed.challenge.context, userId: parsed.userId };
    } finally {
      await redis!.quit();
    }
  }

  const entry = inMemoryChallenges.get(key);
  if (!entry) return null;
  const exp = Date.parse(entry.challenge.expiresAt);
  if (!Number.isNaN(exp) && exp <= Date.now()) return null;
  return { context: entry.challenge.context, userId: entry.userId };
}

export async function getAndDeleteChallenge(
  challengeId: string
): Promise<{ challenge: WebAuthnChallenge; userId?: string } | null> {
  const key = `${CHALLENGE_PREFIX}${challengeId}`;

  // Atomic read-and-delete. When Redis is authoritative, GETDEL guarantees that
  // exactly one caller ever receives the challenge: a non-atomic GET-then-DEL
  // lets two concurrent completions both read it before either delete lands, and
  // for a 0-counter authenticator neither would be caught downstream. In-memory
  // is never populated in Redis mode, so there is no second copy to consume.
  if (redisConfigured()) {
    const redis = await getRedisClient();
    try {
      await redis!.connect();
      const data = await redis!.getdel(key);
      return data ? (JSON.parse(data) as { challenge: WebAuthnChallenge; userId?: string }) : null;
    } finally {
      await redis!.quit();
    }
  }

  // No Redis configured: single-process in-memory mode. get-then-delete is
  // atomic here because Node runs this to completion without interleaving.
  const entry = inMemoryChallenges.get(key) ?? null;
  inMemoryChallenges.delete(key);
  return entry;
}

// ============================================================================
// Step-up Sessions
// ============================================================================

export async function createStepUpSession(session: StepUpSession): Promise<void> {
  const redis = await getRedisClient();
  const key = `${STEPUP_PREFIX}${session.sessionId}`;
  const ttlSeconds = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);

  if (redis) {
    try {
      await redis.connect();
      await redis.set(key, JSON.stringify(session), 'EX', ttlSeconds);
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }

  inMemoryStepUps.set(session.sessionId, session);
}

export async function getStepUpSession(sessionId: string): Promise<StepUpSession | null> {
  const redis = await getRedisClient();
  const key = `${STEPUP_PREFIX}${sessionId}`;

  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }

  return inMemoryStepUps.get(sessionId) ?? null;
}

export async function deleteStepUpSession(sessionId: string): Promise<void> {
  const redis = await getRedisClient();
  const key = `${STEPUP_PREFIX}${sessionId}`;

  if (redis) {
    try {
      await redis.connect();
      await redis.del(key);
    } catch {
      // Fall through
    } finally {
      await redis.quit();
    }
  }

  inMemoryStepUps.delete(sessionId);
}

// ============================================================================
// Utility
// ============================================================================

export async function hasWebAuthnCredentials(userId: string): Promise<boolean> {
  const user = await getUser(userId);
  return (user?.credentials.length ?? 0) > 0;
}
