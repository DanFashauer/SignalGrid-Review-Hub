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
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  // Every use of this client awaits connect()/commands, so failures surface as
  // promise rejections the callers handle (and now propagate — see getUser).
  // Without a listener ioredis ALSO emits an unhandled 'error' event for the
  // same failure, spamming "[ioredis] Unhandled error event" into logs for a
  // condition that is already being handled deliberately.
  client.on("error", () => undefined);
  return client;
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
    // Redis configured ⇒ Redis is AUTHORITATIVE for credential reads (review
    // finding): a credential removed via removeCredential on another instance
    // still lingered in this process's inMemoryUsers mirror, and the old
    // miss-falls-through-to-memory read let a sticky challenge/completion pair
    // verify the REVOKED authenticator and release the held action. A Redis miss
    // is therefore a miss (drop the stale mirror entry too) — never a silent
    // downgrade to per-process state. A Redis FAILURE, however, must PROPAGATE,
    // not read as null (review finding): `null` means "this user has no
    // credentials", and addCredential answers that by constructing a REPLACEMENT
    // user containing only the new credential — so a transient read failure
    // during enrollment, followed by Redis recovering before saveUser, silently
    // overwrote every previously enrolled credential. An unavailable store is an
    // error, not an empty credential set. The in-memory map remains the store
    // only when no Redis is configured, matching saveUser's durability contract.
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
      inMemoryUsers.delete(userId);
      return null;
    } catch (err) {
      throw err instanceof Error ? err : new Error("WebAuthn credential read failed");
    } finally {
      // quit() on a broken connection can itself reject — never let that mask
      // the real result/error of the read.
      await redis.quit().catch(() => undefined);
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
      // Credentials are DURABLE enrollment records, not sessions — persist them with NO
      // TTL. A 24h expiry meant an enrolled credential vanished from Redis after a day,
      // so a challenge request on another instance (or any instance after a restart)
      // found no credential and returned 409 despite enrollment having succeeded; the
      // per-process in-memory mirror only masked that on the one surviving instance.
      // Removal is explicit, via removeCredential (which DELs the key). (Adversarial
      // review finding.) Ephemeral records — challenges (60s) and step-up sessions —
      // keep their TTLs below; only the credential store is durable.
      await redis.set(key, JSON.stringify(user));
    } catch (err) {
      // When Redis IS configured it is the authoritative shared store (review
      // finding): swallowing a write failure here stored the credential only in
      // this process's memory while the enrollment endpoint answered
      // `enrolled: true` — and the single-use registration challenge was already
      // consumed, so another instance (or this one after a restart) rejected the
      // next challenge with no way to retry the ceremony. Propagate the failure so
      // enrollment fails loudly instead of acknowledging a non-durable write. The
      // in-memory fallback remains the store ONLY when no Redis is configured.
      await redis.quit().catch(() => undefined);
      throw err instanceof Error ? err : new Error("WebAuthn credential persistence failed");
    }
    await redis.quit();
  }

  inMemoryUsers.set(user.userId, user);
}

/**
 * Append a credential to a user's enrollment record ATOMICALLY.
 *
 * The naive getUser→push→saveUser sequence loses enrollments (review finding).
 * Two enrollment ceremonies for the same identity — easy to hit across Redis-backed
 * API instances, or from one operator enrolling a replacement authenticator while
 * another finishes the first — each read the same record, each append their own
 * credential, and each write the whole thing back. The later SET erases the earlier
 * credential. Both requests still answer `enrolled: true`, so the loser walks away
 * believing they hold a working step-up authenticator that the store no longer knows
 * about; they discover otherwise at the moment they are asked to step up.
 *
 * WHY A LOCK AND NOT THE WATCH/MULTI USED BY advanceCredentialCounter. Optimistic
 * locking is right for the counter, where losing the race MUST fail closed — the loser
 * has nothing valid left to do. Here both appends are legitimate and commutative, so a
 * loser has to retry, and retrying is where WATCH breaks down: under concurrent writers
 * on one key the aborts cascade and some writers exhaust their attempts having done
 * nothing wrong. `proof:enrollment-race` measured exactly that against a real Redis —
 * a WATCH/MULTI version with 5 attempts persisted 7 of 12 concurrent enrollments and
 * threw for the rest. Raising the retry count would move the failure, not remove it:
 * optimistic locking under contention is livelock-prone by construction. A mutual
 * exclusion lock serialises the appends instead, so every writer commits exactly once.
 *
 * The lock is correct rather than merely present: acquisition is `SET NX PX` (atomic,
 * self-expiring so a crashed holder cannot wedge enrollment forever), and release is a
 * compare-and-delete against a per-caller token so a slow holder whose lock already
 * expired cannot delete the NEXT holder's lock. Failing to acquire throws — reporting a
 * successful enrollment over a credential that was not persisted is the one outcome
 * this function must never produce.
 */
const LOCK_TTL_MS = 5_000;
const LOCK_ATTEMPTS = 100;
const LOCK_RETRY_MS = 25;

/** Release only OUR lock: a plain DEL would free a lock another caller now holds. */
const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export async function addCredential(userId: string, credential: WebAuthnCredential): Promise<void> {
  const key = `${USER_PREFIX}${userId}`;

  if (redisConfigured()) {
    const redis = await getRedisClient();
    const lockKey = `${key}:lock`;
    const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let held = false;
    try {
      await redis!.connect();

      for (let attempt = 0; attempt < LOCK_ATTEMPTS && !held; attempt += 1) {
        const acquired = await redis!.set(lockKey, lockToken, "PX", LOCK_TTL_MS, "NX");
        if (acquired === "OK") {
          held = true;
          break;
        }
        // Jitter so contending writers do not retry in lockstep.
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS)));
      }
      if (!held) {
        throw new Error(
          "WebAuthn credential enrollment could not acquire the per-user lock; not reporting an enrollment that was not persisted",
        );
      }

      // ── critical section ────────────────────────────────────────────────────
      const data = await redis!.get(key);
      const user: WebAuthnUser = data
        ? (JSON.parse(data) as WebAuthnUser)
        : { userId, credentials: [], createdAt: new Date().toISOString() };
      // Re-entrant safety: a retried request or a duplicate delivery must not append
      // the same credential twice.
      if (!user.credentials.some((c) => c.id === credential.id)) {
        user.credentials.push(credential);
        // Durable, no TTL — matching saveUser. A credential is an enrollment record,
        // not a session.
        const setRes = await redis!.set(key, JSON.stringify(user));
        if (setRes !== "OK") {
          throw new Error("WebAuthn credential persistence failed");
        }
      }
      inMemoryUsers.set(userId, user); // keep the mirror consistent, as saveUser does
    } finally {
      if (held) {
        await redis!.eval(RELEASE_LOCK_LUA, 1, lockKey, lockToken).catch(() => undefined);
      }
      await redis!.quit().catch(() => undefined);
    }
    return;
  }

  // No Redis configured: single-process in-memory mode. Read-check-write with NO await
  // between the read and the mutation, so it cannot interleave — the same guarantee
  // advanceCredentialCounter and getAndDeleteChallenge rely on in this mode. (The old
  // code awaited getUser() here, which opened exactly the interleave it needed to avoid.)
  const existing = inMemoryUsers.get(userId);
  if (existing) {
    if (!existing.credentials.some((c) => c.id === credential.id)) {
      existing.credentials.push(credential);
    }
    inMemoryUsers.set(userId, existing);
    return;
  }
  inMemoryUsers.set(userId, {
    userId,
    credentials: [credential],
    createdAt: new Date().toISOString(),
  });
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
      // Persist durably (no TTL), matching saveUser — a counter advance must not
      // re-introduce a 24h expiry on the credential record it just updated.
      const execRes = await redis!.multi().set(key, JSON.stringify(user)).exec();
      if (execRes === null) return false; // WATCHed key changed mid-transaction → lost the race
      // A non-null EXEC can still carry a PER-COMMAND failure (review finding):
      // ioredis resolves exec() with [error, result] pairs rather than rejecting,
      // so a SET refused by a read-only replica, an ACL, or OOM would otherwise
      // read as a successful advance — the step-up releases while Redis retains
      // the OLD counter, weakening every subsequent clone/replay check. Only a
      // clean "OK" on the SET is an advance; anything else fails closed.
      const [setErr, setRes] = execRes[0] ?? [new Error("empty EXEC result"), null];
      if (setErr || setRes !== "OK") return false;
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
