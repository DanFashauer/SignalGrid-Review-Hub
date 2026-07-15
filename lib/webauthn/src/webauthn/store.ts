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

  inMemoryChallenges.set(key, { challenge, userId });
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

  if (!result) {
    result = inMemoryChallenges.get(key) ?? null;
    if (result) {
      inMemoryChallenges.delete(key);
    }
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
