// WebAuthn Store
// Credential storage for WebAuthn/FIDO2 (Redis with in-memory fallback)

import type { WebAuthnUser, WebAuthnCredential, WebAuthnChallenge, StepUpSession } from './types';

const USER_PREFIX = 'webauthn:user:';
const CHALLENGE_PREFIX = 'webauthn:challenge:';
const STEPUP_PREFIX = 'webauthn:stepup:';

function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
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
  const redis = await getRedisClient();
  const key = `${CHALLENGE_PREFIX}${challengeId}`;

  if (redis) {
    try {
      await redis.connect();
      await redis.set(key, JSON.stringify({ challenge, userId }), 'EX', 60); // 60s
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }

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
  const redis = await getRedisClient();
  const key = `${CHALLENGE_PREFIX}${challengeId}`;

  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data) as { challenge: WebAuthnChallenge; userId?: string };
        return { context: parsed.challenge.context, userId: parsed.userId };
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
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
  const redis = await getRedisClient();
  const key = `${CHALLENGE_PREFIX}${challengeId}`;

  let result: { challenge: WebAuthnChallenge; userId?: string } | null = null;

  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        result = JSON.parse(data);
        await redis.del(key);
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }

  // Always consume the in-memory copy, even when Redis served the read. The
  // challenge is written to BOTH stores, so if only Redis is cleared the
  // in-memory copy survives and a single-use challenge could be replayed. Delete
  // it unconditionally; use it as the fallback value only when Redis had nothing.
  const memResult = inMemoryChallenges.get(key) ?? null;
  inMemoryChallenges.delete(key);
  if (!result) {
    result = memResult;
  }

  return result;
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
