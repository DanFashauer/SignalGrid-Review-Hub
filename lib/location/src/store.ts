import type { LocationSignal } from "./types";

export type StoreBackend = {
  upsert(signal: LocationSignal): Promise<void>;
  getLast(deviceId: string): Promise<LocationSignal | null>;
};

class InMemoryLocationStore implements StoreBackend {
  private lastByDevice = new Map<string, LocationSignal>();
  private maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  async upsert(signal: LocationSignal) { 
    this.lastByDevice.set(signal.deviceId, signal);
    this.cleanup();
  }
  
  async getLast(deviceId: string) { 
    const signal = this.lastByDevice.get(deviceId);
    if (!signal) return null;
    
    // Check if signal is too old
    if (Date.now() - new Date(signal.observedAt).getTime() > this.maxAge) {
      this.lastByDevice.delete(deviceId);
      return null;
    }
    
    return signal;
  }
  
  private cleanup() {
    const cutoff = Date.now() - this.maxAge;
    for (const [deviceId, signal] of this.lastByDevice) {
      if (new Date(signal.observedAt).getTime() < cutoff) {
        this.lastByDevice.delete(deviceId);
      }
    }
  }
}

let singleton: StoreBackend | null = null;

// Presence is held in-memory only: single-process, lost on restart, not shared
// across instances. That is deliberate for this fixture-safe build — presence is
// derived, short-lived (24h TTL), and never a system of record. A distributed
// backend (e.g. Redis) would implement the same `StoreBackend` interface and be
// selected here; it is intentionally not wired, rather than stubbed, so the code
// never implies durability it does not provide.
export async function createLocationStore(): Promise<StoreBackend> {
  if (singleton) return singleton;
  singleton = new InMemoryLocationStore();
  return singleton;
}
