/**
 * Device Registry
 * 
 * Manages device enrollment and lookup for the badge authentication system.
 * Provides allowlist mode for device control.
 * 
 * Features:
 * - Device enrollment/update
 * - Device lookup by ID
 * - Allowlist mode (optional)
 * - Redis-backed for production multi-instance deployments
 * - In-memory fallback for development
 * 
 * Environment variables:
 * - REDIS_URL: Redis connection URL (optional - uses in-memory if not set)
 * - DEVICE_ALLOWLIST_MODE: Set to "true" to enable allowlist-only mode
 */

import Redis from 'ioredis';
import { randomBytes } from 'crypto';

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

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  redisUrl: process.env.REDIS_URL,
  allowlistMode: process.env.DEVICE_ALLOWLIST_MODE === 'true',
  keyPrefix: 'device',
  ttlSeconds: 60 * 60 * 24 * 365, // 1 year for enrolled devices
};

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
  
  private makeKey(deviceId: string): string {
    return `${CONFIG.keyPrefix}:${deviceId}`;
  }
  
  /**
   * Validate hardware ID format
   * Accepts alphanumeric characters, hyphens, underscores, and colons
   * Must be between 4-64 characters
   */
  private validateHardwareId(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    
    // Check length
    if (id.length < 4 || id.length > 64) {
      return false;
    }
    
    // Check format - alphanumeric, hyphens, underscores, colons only
    const hardwareIdRegex = /^[a-zA-Z0-9\-_:]+$/;
    return hardwareIdRegex.test(id);
  }
  
  async enroll(request: EnrollmentRequest): Promise<Device> {
    // Validate hardware IDs
    if (!this.validateHardwareId(request.deviceId)) {
      throw new Error(`Invalid device ID format: ${request.deviceId}`);
    }
    
    if (!this.validateHardwareId(request.deviceSerial)) {
      throw new Error(`Invalid device serial format: ${request.deviceSerial}`);
    }
    
    if (!request.deviceModel || request.deviceModel.length === 0) {
      throw new Error('Device model is required');
    }
    
    if (!request.osVersion || request.osVersion.length === 0) {
      throw new Error('OS version is required');
    }
    
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
    // In-memory: check if device is enrolled (allowlist uses enrolled status)
    const device = this.devices.get(deviceId);
    if (!CONFIG.allowlistMode) return true; // Allowlist disabled = allow all
    return device?.enrolled ?? false;
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
    const safeId = deviceId.replace(/[\s:]/g, '_');
    return `${CONFIG.keyPrefix}:${safeId}`;
  }
  
  private makeIndexKey(): string {
    return `${CONFIG.keyPrefix}:index`;
  }
  
  async enroll(request: EnrollmentRequest): Promise<Device> {
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
    if (!CONFIG.allowlistMode) return true;
    
    const device = await this.get(deviceId);
    return device?.enrolled ?? false;
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
