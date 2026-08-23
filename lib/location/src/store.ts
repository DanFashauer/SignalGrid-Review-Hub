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
    
    // Check if signal is too old. An UNPARSEABLE observedAt yields NaN, and
    // `NaN > maxAge` is false — so a signal of unknown age read as FRESH, which
    // is the fail-closed rule inverted: what we cannot date must be treated as
    // stale, never as current.
    const observedAtMs = new Date(signal.observedAt).getTime();
    if (!Number.isFinite(observedAtMs) || Date.now() - observedAtMs > this.maxAge) {
      this.lastByDevice.delete(deviceId);
      return null;
    }
    
    return signal;
  }
  
  private cleanup() {
    const cutoff = Date.now() - this.maxAge;
    for (const [deviceId, signal] of this.lastByDevice) {
      // The twin of the guard eleven lines above, and it was missed on the first
      // pass precisely because the gate could not see it: every rule required a
      // literal `Date.now()` as the other operand, and here it is the local
      // `cutoff`. Same NaN, same inversion — an undateable signal was never
      // swept, so the sweep leaked exactly the entries it could not read.
      const observedAtMs = new Date(signal.observedAt).getTime();
      if (!Number.isFinite(observedAtMs) || observedAtMs < cutoff) {
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
