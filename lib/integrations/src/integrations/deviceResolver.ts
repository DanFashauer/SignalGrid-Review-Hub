import type { UEMAdapter } from './adapters/types';
import type { NACEndpointInfo } from './adapters/types';

/**
 * Device Identity Resolution
 * 
 * Resolves deviceId to physical identifiers (serial, MAC, certificate)
 * for NAC adapter lookups.
 */

export interface DeviceIdentity {
  deviceId: string;
  serialNumber?: string;
  macAddress?: string;
  certSubject?: string;
  platform?: string;
  source: 'registry' | 'uem' | 'nac';
}

/**
 * Device Identity Resolver
 * 
 * Aggregates device identity from multiple sources:
 * 1. Local device registry
 * 2. UEM/MDM (Intune, Workspace ONE, Jamf)
 * 3. NAC (Cisco ISE, Aruba ClearPass)
 * 4. FleetDM (posture/telemetry)
 */
export class DeviceIdentityResolver {
  private uemAdapter: UEMAdapter | null = null;
  private nacAdapters: Map<string, any> = new Map();

  constructor(options?: { uemAdapter?: UEMAdapter; nacAdapters?: Map<string, any> }) {
    this.uemAdapter = options?.uemAdapter || null;
    this.nacAdapters = options?.nacAdapters || new Map();
  }

  /**
   * Set UEM adapter for device lookups
   */
  setUEMAdapter(adapter: UEMAdapter): void {
    this.uemAdapter = adapter;
  }

  /**
   * Add NAC adapter for identity lookups
   */
  addNACAdapter(name: string, adapter: any): void {
    this.nacAdapters.set(name, adapter);
  }

  /**
   * Resolve device identity from deviceId
   * 
   * Tries multiple sources in order of reliability
   */
  async resolve(deviceId: string): Promise<DeviceIdentity | null> {
    // Try local registry first
    const fromRegistry = await this.resolveFromRegistry(deviceId);
    if (fromRegistry) {
      return fromRegistry;
    }

    // Try UEM if available
    if (this.uemAdapter) {
      const fromUEM = await this.resolveFromUEM(deviceId);
      if (fromUEM) {
        return fromUEM;
      }
    }

    // Try NAC adapters
    for (const [name, adapter] of this.nacAdapters) {
      try {
        const fromNAC = await this.resolveFromNAC(adapter, deviceId);
        if (fromNAC) {
          return fromNAC;
        }
      } catch {
        // Try next adapter
        continue;
      }
    }

    return null;
  }

  /**
   * Resolve from local device registry
   */
  private async resolveFromRegistry(deviceId: string): Promise<DeviceIdentity | null> {
    // Import dynamically to avoid circular dependencies
    const { deviceRegistry } = await import('../deviceRegistry');
    
    const device = await deviceRegistry.get(deviceId);
    if (!device) {
      return null;
    }

    return {
      deviceId: device.deviceId,
      serialNumber: device.deviceSerial,
      platform: device.osVersion,
      source: 'registry',
    };
  }

  /**
   * Resolve from UEM/MDM
   */
  private async resolveFromUEM(deviceId: string): Promise<DeviceIdentity | null> {
    if (!this.uemAdapter) {
      return null;
    }

    try {
      const state = await this.uemAdapter.getDeviceState(deviceId);
      if (!state) {
        return null;
      }

      return {
        deviceId: state.deviceId,
        serialNumber: state.platform === 'iOS' || state.platform === 'macOS' 
          ? state.deviceId 
          : undefined,
        platform: state.platform,
        source: 'uem',
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve from NAC adapter
   */
  private async resolveFromNAC(adapter: any, identifier: string): Promise<DeviceIdentity | null> {
    if (!adapter.lookupEndpoint) {
      return null;
    }

    // Try by MAC address
    const byMac = await adapter.lookupEndpoint(identifier, 'mac');
    if (byMac) {
      return this.mapNACEndpoint(byMac);
    }

    // Try by serial number
    const bySerial = await adapter.lookupEndpoint(identifier, 'serial');
    if (bySerial) {
      return this.mapNACEndpoint(bySerial);
    }

    return null;
  }

  /**
   * Map NAC endpoint to DeviceIdentity
   */
  private mapNACEndpoint(endpoint: NACEndpointInfo): DeviceIdentity {
    return {
      deviceId: endpoint.endpointId,
      serialNumber: endpoint.serialNumber,
      macAddress: endpoint.macAddress,
      certSubject: endpoint.certSubject,
      source: 'nac',
    };
  }

  /**
   * Get all identities for a device (aggregate from all sources)
   */
  async aggregate(deviceId: string): Promise<DeviceIdentity[]> {
    const identities: DeviceIdentity[] = [];

    // Try all sources
    const registry = await this.resolveFromRegistry(deviceId);
    if (registry) identities.push(registry);

    const uem = await this.resolveFromUEM(deviceId);
    if (uem) identities.push(uem);

    // Try NAC adapters
    for (const [, adapter] of this.nacAdapters) {
      const nac = await this.resolveFromNAC(adapter, deviceId);
      if (nac) identities.push(nac);
    }

    // Deduplicate by source
    const unique = new Map<string, DeviceIdentity>();
    for (const identity of identities) {
      unique.set(identity.source, identity);
    }

    return Array.from(unique.values());
  }
}

/**
 * Singleton instance
 */
let resolverInstance: DeviceIdentityResolver | null = null;

export function getDeviceResolver(): DeviceIdentityResolver {
  if (!resolverInstance) {
    resolverInstance = new DeviceIdentityResolver();
  }
  return resolverInstance;
}

export function setDeviceResolver(resolver: DeviceIdentityResolver): void {
  resolverInstance = resolver;
}
