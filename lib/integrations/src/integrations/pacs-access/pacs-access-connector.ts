// Read-only normalization + transport for the physical access-control connector.
//
// The source is a PACS bridge that has already evaluated the controlled entry the
// shared device sits behind — the access-log result (granted/denied), the credential
// type, the holder's authorization against the access rules + time zones, the
// anti-passback state, the physical door state, and whether the PACS holder matches
// the checked-out device holder. This connector normalizes that already-evaluated
// result. Every operation here is a read; there is no write path (it opens no door,
// unlocks no turnstile, and revokes no credential — those stay with the PACS).

import {
  PacsAccessConnectorError,
  type PacsAccessReportRaw,
  type AccessAuthorization,
  type AccessResult,
  type AntipassbackState,
  type ControllerHealth,
  type CredentialTechnology,
  type CredentialType,
  type DoorState,
  type NormalizedPacsAccess,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new PacsAccessConnectorError("read_only_violation", `pacs access is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** A strict ISO-8601 UTC (Zulu) instant, verbatim, or null. Never a coerced date. */
function instantStringOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
}

function readableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const lower = s.toLowerCase();
  if (lower.startsWith("not found") || lower.startsWith("unavailable") || lower.startsWith("error")) return null;
  return s;
}

/** Normalize a PACS report. Defensive throughout: a missing/errored field yields
 *  the fail-safe unknown/null, never a fabricated "granted"/"authorized". */
export function normalizeReport(
  deviceId: string,
  report: PacsAccessReportRaw,
  source = "pacs-access-bridge",
): NormalizedPacsAccess {
  const pacsSubject = readableString(report.pacsSubject);
  const expectedSubject = readableString(report.expectedSubject);
  let identityMatched = boolOrNull(report.identityMatched);
  // The subject comparison corroborates the reported match, and only ever makes the
  // verdict MORE conservative — it never upgrades a reported mismatch to a match:
  //  - both subjects readable and DIFFER → force identityMatched=false (a mislabeled
  //    entry; a `true` flag that contradicts the subjects is not trusted);
  //  - both readable and EQUAL, and the flag was NOT explicitly false → confirm true
  //    (the subjects positively corroborate the match);
  //  - both readable and EQUAL but the flag is explicitly `false` → a self-
  //    contradictory report (flag says mismatch, subjects say match): keep false
  //    (fail closed — a contradiction never resolves toward a grant).
  if (pacsSubject !== null && expectedSubject !== null) {
    if (pacsSubject !== expectedSubject) {
      identityMatched = false;
    } else if (identityMatched === null) {
      identityMatched = true;
    }
  }
  return {
    sourceSystem: "pacs-access",
    deviceId,
    accessResult: oneOf<AccessResult>(report.accessResult, ["granted", "denied", "unknown"], "unknown"),
    credentialType: oneOf<CredentialType>(report.credentialType, ["biometric", "card", "mobile", "pin", "unknown"], "unknown"),
    credentialTechnology: oneOf<CredentialTechnology>(report.credentialTechnology, ["cryptographic", "static_identifier", "unknown"], "unknown"),
    authorization: oneOf<AccessAuthorization>(report.authorization, ["authorized", "out_of_schedule", "out_of_zone", "revoked", "unknown"], "unknown"),
    antipassback: oneOf<AntipassbackState>(report.antipassback, ["ok", "violation", "unknown"], "unknown"),
    doorState: oneOf<DoorState>(report.doorState, ["secured", "forced", "held_open", "unknown"], "unknown"),
    observedAt: instantStringOf(report.observedAt),
    controllerHealth: oneOf<ControllerHealth>(report.controllerHealth, ["online", "degraded", "offline", "unknown"], "unknown"),
    identityMatched,
    pacsSubject,
    expectedSubject,
    bridgeReachable: boolOrNull(report.bridgeReachable),
    source,
  };
}

export interface PacsAccessRequest {
  deviceId: string;
  token: string;
}

/** Fetch one controlled entry's evaluated PACS state from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type PacsAccessTransport = (req: PacsAccessRequest) => Promise<PacsAccessReportRaw>;

export interface PacsAccessConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class PacsAccessConnector {
  constructor(
    private readonly config: PacsAccessConnectorConfig,
    private readonly transport: PacsAccessTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof PacsAccessConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchAccess(deviceId: string): Promise<NormalizedPacsAccess> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
