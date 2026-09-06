/**
 * Device Registry
 *
 * Manages device enrollment and lookup for the badge authentication system.
 * Provides allowlist mode for device control.
 *
 * Features:
 * - Device enrollment/update
 * - Device lookup by ID
 * - Allowlist mode (ENFORCED unless explicitly switched off — see below)
 * - Redis-backed for production multi-instance deployments
 * - In-memory fallback for development
 *
 * Environment variables:
 * - REDIS_URL: Redis connection URL (optional - uses in-memory if not set)
 * - DEVICE_ALLOWLIST_MODE: "true" enforces the allowlist, "false" opens it.
 *   ABSENT or any other value ENFORCES. Until 2026-09-06 the read was
 *   `=== 'true'`, so "TRUE", "1", "yes" and an unset variable all silently
 *   OPENED the allowlist — an operator who believed the allowlist was on had
 *   every device admitted, with no log line saying so. A policy default is
 *   never derived from the absence of configuration (the same rule
 *   `scripts/check-ios-policy-defaults.mjs` holds on the phone).
 * - DEVICE_ALLOWLIST_STALE_SECONDS: how long an enrolled device stays allowed
 *   without being seen (default 30 days). `lastSeenAt` was stamped on every
 *   check-in and never consulted; a device enrolled once and silent for a
 *   year stayed allowed for the whole one-year record TTL.
 *
 * The pure helpers (`deviceKey`, `isValidHardwareId`, `validateEnrollmentRequest`,
 * `parseAllowlistMode`, `parseStaleSeconds`, `isAllowedByPolicy`) are exported
 * so `proof:device-registry` can drive them without Redis and prove each
 * fail-closed edge by mutation.
 */

import Redis from 'ioredis';
import { ageMs, FUTURE_SKEW_TOLERANCE_MS } from './utils/freshness';

// ============================================================================
// Types
// ============================================================================

export interface Device {
  /** Unique device identifier */
  deviceId: string;
  /** Device serial number */
  deviceSerial: string;
  /** Device model */
  deviceModel: string;
  /** OS version */
  osVersion: string;
  /** Enrollment status */
  enrolled: boolean;
  /** Enrollment timestamp */
  enrolledAt?: string;
  /** Last seen timestamp */
  lastSeenAt?: string;
  /** MDM management ID (if enrolled) */
  managementId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface EnrollmentRequest {
  deviceId: string;
  deviceSerial: string;
  deviceModel: string;
  osVersion: string;
  mdmEnrolled: boolean;
  managementId?: string;
}

export type AllowlistMode = 'enforced' | 'open';

export interface AllowlistModeReading {
  mode: AllowlistMode;
  /** How the mode was arrived at — surfaced so an operator can see a typo. */
  source: 'explicit' | 'absent' | 'unrecognized';
}

// ============================================================================
// Pure helpers (exported for the proof)
// ============================================================================

/** Alphanumerics, hyphens, underscores and colons; 4–64 characters. */
export const HARDWARE_ID_PATTERN = /^[a-zA-Z0-9\-_:]+$/;

export function isValidHardwareId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length < 4 || id.length > 64) return false;
  return HARDWARE_ID_PATTERN.test(id);
}

/**
 * The storage key for a device id — INJECTIVE over valid ids.
 *
 * The Redis backend used to write `deviceId.replace(/[\s:]/g, '_')`, while the
 * validator admits both ':' and '_'. So `AA:BB:CC:DD:EE:FF` and
 * `AA_BB_CC_DD_EE_FF` — two distinct, individually valid ids — shared ONE
 * record: enrolling the first made the second "allowed", and the resolver
 * handed the wrong device's serial and platform to NAC/UEM lookups. The rule
 * `store-scope.ts` states and proves for connector-config keys ("INJECTIVE over
 * valid ids") applies here the same way. `encodeURIComponent` maps ':' to
 * '%3A' and leaves every other admitted character untouched; '%' is not an
 * admitted character, so no two valid ids can encode alike.
 */
export function deviceKey(prefix: string, deviceId: string): string {
  return `${prefix}:${encodeURIComponent(deviceId)}`;
}

/** Throws the first problem with an enrollment request; shared by BOTH backends. */
export function validateEnrollmentRequest(request: EnrollmentRequest): void {
  if (!isValidHardwareId(request.deviceId)) {
    throw new Error(`Invalid device ID format: ${String(request.deviceId)}`);
  }
  if (!isValidHardwareId(request.deviceSerial)) {
    throw new Error(`Invalid device serial format: ${String(request.deviceSerial)}`);
  }
  if (typeof request.deviceModel !== 'string' || request.deviceModel.length === 0) {
    throw new Error('Device model is required');
  }
  if (typeof request.osVersion !== 'string' || request.osVersion.length === 0) {
    throw new Error('OS version is required');
  }
}

/** "true" opens nothing; "false" is the only value that opens the allowlist. */
export function parseAllowlistMode(raw: string | undefined): AllowlistModeReading {
  if (raw === undefined) return { mode: 'enforced', source: 'absent' };
  if (raw === 'true') return { mode: 'enforced', source: 'explicit' };
  if (raw === 'false') return { mode: 'open', source: 'explicit' };
  return { mode: 'enforced', source: 'unrecognized' };
}

export const DEFAULT_STALE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** A positive integer number of seconds; anything else is the default, never "forever". */
export function parseStaleSeconds(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_STALE_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_STALE_SECONDS;
  return n;
}

/**
 * The future-skew tolerance is the repository's ONE shared value, not a local
 * copy: `utils/freshness.ts` holds the single body of the rule "a sighting
 * timestamped in the future, beyond an allowed skew, is not evidence of freshness"
 * (`scripts/check-freshness-divergence.mjs` refuses a hand-rolled copy). Re-exported
 * under the name the proof reads.
 */
export const FUTURE_SKEW_MS = FUTURE_SKEW_TOLERANCE_MS;

/**
 * The allow decision, pure: the device record (or null), the parsed mode, the
 * clock, and the freshness bound. Every unknown falls to `false`.
 */
export function isAllowedByPolicy(
  device: Device | null,
  mode: AllowlistMode,
  nowMs: number,
  staleSeconds: number,
): boolean {
  if (mode === 'open') return true;
  if (!device || device.enrolled !== true) return false;
  // One body for the age: absent, unparseable, an unreadable clock, or a stamp
  // further ahead than the shared skew tolerance all come back `null` — never a
  // number, never negative — and null is not fresh.
  const age = ageMs(device.lastSeenAt ?? null, nowMs);
  if (age === null) return false;
  return age <= staleSeconds * 1000;
}

// ============================================================================
// Configuration
// ============================================================================

const ALLOWLIST = parseAllowlistMode(process.env.DEVICE_ALLOWLIST_MODE);

const CONFIG = {
  redisUrl: process.env.REDIS_URL,
  allowlistMode: ALLOWLIST.mode,
  allowlistSource: ALLOWLIST.source,
  keyPrefix: 'device',
  ttlSeconds: 60 * 60 * 24 * 365, // 1 year for enrolled devices
  staleSeconds: parseStaleSeconds(process.env.DEVICE_ALLOWLIST_STALE_SECONDS),
};

if (ALLOWLIST.source === 'unrecognized') {
  console.warn(
    `[DeviceRegistry] DEVICE_ALLOWLIST_MODE=${JSON.stringify(process.env.DEVICE_ALLOWLIST_MODE)} is not "true" or "false" — allowlist ENFORCED (an unrecognized setting never opens it)`,
  );
}

// ============================================================================
// DeviceRegistry Interface
// ============================================================================

interface DeviceRegistry {
  /**
   * Enroll or update a device
   */
  enroll(request: EnrollmentRequest): Promise<Device>;

  /**
   * Lookup a device by ID
   */
  get(deviceId: string): Promise<Device | null>;

  /**
   * Update last seen timestamp
   */
  updateLastSeen(deviceId: string): Promise<void>;

  /**
   * List all enrolled devices (for admin)
   */
  list(): Promise<Device[]>;

  /**
   * Check if device is allowed (for allowlist mode)
   */
  isAllowed(deviceId: string): Promise<boolean>;

  /**
   * Remove a device from registry
   */
  remove(deviceId: string): Promise<boolean>;
}

// ============================================================================
// In-Memory Implementation (Development)
// ============================================================================

class InMemoryDeviceRegistry implements DeviceRegistry {
  private devices = new Map<string, Device>();

  constructor() {
    // Initialize test data
    this.initializeTestData();
  }

  private initializeTestData(): void {
    const testDevices: Device[] = [
      {
        deviceId: 'test-device-001',
        deviceSerial: 'SN001234',
        deviceModel: 'iPhone 14',
        osVersion: 'iOS 17.0',
        enrolled: true,
        enrolledAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        lastSeenAt: new Date().toISOString(),
      },
      {
        deviceId: 'test-device-002',
        deviceSerial: 'SN005678',
        deviceModel: 'Samsung Galaxy S23',
        osVersion: 'Android 13',
        enrolled: true,
        enrolledAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        lastSeenAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      },
      {
        deviceId: 'test-device-003',
        deviceSerial: 'SN009876',
        deviceModel: 'iPad Pro',
        osVersion: 'iOS 16.5',
        enrolled: false,
        enrolledAt: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
        lastSeenAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      },
    ];

    testDevices.forEach(device => {
      this.devices.set(device.deviceId, device);
    });

    console.log(`[DeviceRegistry] Initialized with ${testDevices.length} test devices`);
  }

  async enroll(request: EnrollmentRequest): Promise<Device> {
    validateEnrollmentRequest(request);

    const now = new Date().toISOString();
    const existing = this.devices.get(request.deviceId);

    const device: Device = {
      deviceId: request.deviceId,
      deviceSerial: request.deviceSerial,
      deviceModel: request.deviceModel,
      osVersion: request.osVersion,
      enrolled: true,
      enrolledAt: existing?.enrolledAt || now,
      lastSeenAt: now,
      managementId: request.managementId,
    };

    this.devices.set(request.deviceId, device);
    console.log(`[DeviceRegistry] Enrolled device: ${request.deviceId}`);
    return device;
  }

  async get(deviceId: string): Promise<Device | null> {
    return this.devices.get(deviceId) || null;
  }

  async updateLastSeen(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeenAt = new Date().toISOString();
    }
  }

  async list(): Promise<Device[]> {
    return Array.from(this.devices.values());
  }

  async isAllowed(deviceId: string): Promise<boolean> {
    return isAllowedByPolicy(await this.get(deviceId), CONFIG.allowlistMode, Date.now(), CONFIG.staleSeconds);
  }

  async remove(deviceId: string): Promise<boolean> {
    return this.devices.delete(deviceId);
  }
}

// ============================================================================
// Redis Implementation (Production)
// ============================================================================

class RedisDeviceRegistry implements DeviceRegistry {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      },
    });
  }

  private makeKey(deviceId: string): string {
    return deviceKey(CONFIG.keyPrefix, deviceId);
  }

  private makeIndexKey(): string {
    return `${CONFIG.keyPrefix}:index`;
  }

  async enroll(request: EnrollmentRequest): Promise<Device> {
    // The production backend validated NOTHING until 2026-09-06 while the dev
    // backend validated everything — the stricter store was the one nobody ran.
    validateEnrollmentRequest(request);

    const now = new Date().toISOString();
    const key = this.makeKey(request.deviceId);

    // Get existing device to preserve enrolledAt
    const existingData = await this.redis.get(key);
    const existing = existingData ? JSON.parse(existingData) : null;

    const device: Device = {
      deviceId: request.deviceId,
      deviceSerial: request.deviceSerial,
      deviceModel: request.deviceModel,
      osVersion: request.osVersion,
      enrolled: true,
      enrolledAt: existing?.enrolledAt || now,
      lastSeenAt: now,
      managementId: request.managementId,
    };

    // Store device data
    await this.redis.setex(key, CONFIG.ttlSeconds, JSON.stringify(device));

    // Add to index
    await this.redis.sadd(this.makeIndexKey(), request.deviceId);

    console.log(`[DeviceRegistry] Enrolled device: ${request.deviceId}`);
    return device;
  }

  async get(deviceId: string): Promise<Device | null> {
    const key = this.makeKey(deviceId);
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as Device;
  }

  async updateLastSeen(deviceId: string): Promise<void> {
    const device = await this.get(deviceId);
    if (device) {
      device.lastSeenAt = new Date().toISOString();
      const key = this.makeKey(deviceId);
      await this.redis.setex(key, CONFIG.ttlSeconds, JSON.stringify(device));
    }
  }

  async list(): Promise<Device[]> {
    const indexKey = this.makeIndexKey();
    const deviceIds = await this.redis.smembers(indexKey);

    const devices: Device[] = [];
    for (const deviceId of deviceIds) {
      const device = await this.get(deviceId);
      if (device) {
        devices.push(device);
      }
    }

    return devices;
  }

  async isAllowed(deviceId: string): Promise<boolean> {
    return isAllowedByPolicy(await this.get(deviceId), CONFIG.allowlistMode, Date.now(), CONFIG.staleSeconds);
  }

  async remove(deviceId: string): Promise<boolean> {
    const key = this.makeKey(deviceId);
    const result = await this.redis.del(key);
    await this.redis.srem(this.makeIndexKey(), deviceId);
    return result > 0;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// ============================================================================
// Factory
// ============================================================================

function createDeviceRegistry(): DeviceRegistry {
  if (CONFIG.redisUrl) {
    console.log('[DeviceRegistry] Using Redis backend');
    return new RedisDeviceRegistry(CONFIG.redisUrl);
  }

  console.log('[DeviceRegistry] Using in-memory backend (dev only)');
  return new InMemoryDeviceRegistry();
}

// Export singleton
export const deviceRegistry = createDeviceRegistry();

// Export types
export type { DeviceRegistry };

// Configuration export for testing
export { CONFIG as DEVICE_CONFIG };
