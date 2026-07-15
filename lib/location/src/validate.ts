import { LOCATION_MAX_AGE_SECONDS, LOCATION_MODE } from "./config";
import type { LocationSignal } from "./types";

export function validateLocationSignal(input: LocationSignal): { ok: true } | { ok: false; error: string } {
  if (!input.deviceId || input.deviceId.length < 4) return { ok: false, error: "Invalid deviceId" };
  if (!Number.isFinite(input.observedAt)) return { ok: false, error: "Invalid observedAt" };

  const ageMs = Date.now() - input.observedAt;
  if (ageMs < -30_000) return { ok: false, error: "observedAt is in the future" };
  if (ageMs > LOCATION_MAX_AGE_SECONDS * 1000) return { ok: false, error: "Location signal too old" };

  if (input.mode !== LOCATION_MODE) {
    return { ok: false, error: `Mode mismatch. Expected ${LOCATION_MODE}, got ${input.mode}` };
  }

  if (LOCATION_MODE === "presence" || LOCATION_MODE === "coarse") {
    if (!input.zoneId && !input.floorId && !input.buildingId && !input.siteId) {
      return { ok: false, error: "Missing zone identifiers for presence/coarse mode" };
    }
  }

  if (LOCATION_MODE === "precise") {
    if (typeof input.lat !== "number" || typeof input.lon !== "number") return { ok: false, error: "Missing lat/lon" };
    if (typeof input.accuracyM !== "number") return { ok: false, error: "Missing accuracyM" };
  }

  return { ok: true };
}
