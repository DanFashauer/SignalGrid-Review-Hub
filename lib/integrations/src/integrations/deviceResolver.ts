import type { NACAdapter, NACEndpointInfo, UEMAdapter } from './adapters/types';

/**
 * Method names that would make an injected adapter an ACTUATOR rather than a reader.
 *
 * WHY A RUNTIME CHECK AND NOT JUST A TYPE. The NAC quarantine actuators were removed
 * and `NACAdapter` narrowed to `lookupEndpoint` — but TypeScript is structurally
 * typed, so an object carrying `lookupEndpoint` AND `quarantineEndpoint` still
 * satisfies the interface. Excess-property checking only applies to object literals
 * assigned directly, never to a value arriving through a variable, which is how every
 * real adapter arrives. The narrowed interface therefore documents the contract
 * without enforcing it at the one place an adapter actually enters the system.
 *
 * This closes that at the boundary: an adapter exposing a write method is REFUSED,
 * loudly, at injection time — before it can be called. Fail-closed, and it fails
 * where a human is looking rather than mid-decision.
 */
const ACTUATOR_METHODS = [
  'quarantineEndpoint', 'unquarantineEndpoint', 'quarantine', 'unquarantine',
  'lockDevice', 'remoteLock', 'wipeDevice', 'eraseDevice', 'disconnectEndpoint',
  'setTag', 'sendCommand', 'applyPolicy',
] as const;

/** Names of any actuator methods this adapter exposes. Empty means read-only. */
export function actuatorMethodsOn(adapter: unknown): string[] {
  if (typeof adapter !== 'object' || adapter === null) return [];
  return ACTUATOR_METHODS.filter(
    (m) => typeof (adapter as Record<string, unknown>)[m] === 'function',
  );
}

/** Reports a source fault. Defaults to a warning rather than silence — see the note
 *  on resolveFromUEM. Mirrors the `onFault` reporter in `nac/store.ts`. */
export type ResolverFaultReporter = (message: string) => void;

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
  // TYPED, not `any`. It was `Map<string, any>`, which meant the read-only NACAdapter
  // interface was not enforced at the one call site that consumes it — the narrowing
  // done when the quarantine actuators were removed had no effect here.
  private nacAdapters: Map<string, NACAdapter> = new Map();
  private onFault: ResolverFaultReporter;

  constructor(options?: {
    uemAdapter?: UEMAdapter;
    nacAdapters?: Map<string, NACAdapter>;
    /** Where source faults are reported. Defaults to a console warning — never to
     *  silence, which is what the previous bare `catch {}` amounted to. */
    onFault?: ResolverFaultReporter;
  }) {
    this.uemAdapter = options?.uemAdapter || null;
    this.onFault = options?.onFault ?? ((m) => console.warn(`[deviceResolver] ${m}`));
    this.nacAdapters = new Map();
    for (const [name, adapter] of options?.nacAdapters ?? new Map()) {
      // Constructor-injected adapters go through the SAME guard as addNACAdapter.
      // A check only one of two entry points performs is a check with a door beside it.
      this.addNACAdapter(name, adapter);
    }
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
  addNACAdapter(name: string, adapter: NACAdapter): void {
    const actuators = actuatorMethodsOn(adapter);
    if (actuators.length > 0) {
      // REFUSED, not warned-about-and-accepted. This resolver reads identity; an
      // adapter that can also act on a device does not belong in it, and accepting
      // one "just to look things up" is how the write path came back last time.
      throw new Error(
        `deviceResolver: refusing NAC adapter "${name}" — it exposes device-action ` +
        `method(s): ${actuators.join(', ')}. This resolver is read-only; identity ` +
        `lookup must not be handed an object that can act on a device.`,
      );
    }
    if (typeof adapter?.lookupEndpoint !== 'function') {
      throw new Error(
        `deviceResolver: refusing NAC adapter "${name}" — no lookupEndpoint(). An ` +
        `adapter that cannot answer the only question this resolver asks would fail ` +
        `silently at decision time instead of loudly here.`,
      );
    }
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
      } catch (err) {
        // resolveFromNAC reports its own faults through onFault and returns null,
        // so this arm is unreachable today. It is kept — and REPORTED rather than
        // swallowed — because it is exactly the arm that would silently resume if
        // that contract ever changes: a bare `continue` here would turn a thrown
        // adapter fault back into "no such device" with no line in any log.
        this.onFault(`NAC adapter "${name}" threw while resolving ${deviceId}: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch (err) {
      // THE FAULT IS REPORTED, NOT SWALLOWED. This was a bare `catch { return null }`,
      // and `null` from this method means "no such device" — so an unreachable UEM, an
      // expired credential or a 500 all rendered as a confident "that device does not
      // exist". That is the failure this repository forbids everywhere else: an
      // unknown must never read as an answer.
      //
      // The return value stays `null` on purpose — resolution legitimately falls
      // through to the next source, and throwing here would make one flaky vendor
      // API break identity resolution entirely. What changes is that the fault is now
      // AUDIBLE, so "we could not ask" is distinguishable from "we asked and it said
      // no" by anyone reading the log or supplying an onFault reporter.
      this.onFault(`UEM lookup failed for "${deviceId}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Resolve from NAC adapter
   */
  private async resolveFromNAC(adapter: NACAdapter, identifier: string): Promise<DeviceIdentity | null> {
    // Fault handling now MATCHES resolveFromUEM. It did not: that path swallowed
    // every error while this one let them propagate, so the same vendor outage either
    // returned null or crashed the resolver depending purely on which source was
    // tried first. Two sources, two behaviours, one caller — that is not a policy.
    try {
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
    } catch (err) {
      this.onFault(`NAC lookup failed for "${identifier}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
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
