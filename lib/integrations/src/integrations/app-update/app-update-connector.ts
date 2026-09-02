// Read-only normalization + transport for the APP-UPDATE CURRENCY connector.
//
// The sources are an MDM app-inventory row (installed version + install channel,
// as MDM observed them — never the app's own claim about itself) and the tenant's
// release manifest (latest version, min_version floor, force_update flag). This
// connector normalizes those into an enum posture the evaluator can grade. Every
// operation is a read; there is no write path — distribution (itms-services / MDM
// InstallApplication / ABM) is the platform's job, not this package's.
// Defensive normalization is ported from the custody-beacon connector: inventories
// and manifests are external systems and may emit anything in any slot, so the
// normalizer — not the compiler — is what makes a value safe; own-property reads
// only; malformed reports fail closed.

import {
  APP_UPDATE_REPORT_KEYS,
  AppUpdateConnectorError,
  type AppUpdateReportRaw,
  type ForcePolicy,
  type InstallChannel,
  type NormalizedAppUpdate,
  type ReportIntegrity,
  type UpdateCurrency,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new AppUpdateConnectorError("read_only_violation", `app-update is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Did the report ASSERT something here that we could not parse? `null` counts as absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not read as a confirmation. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? An injected transport returning a string
 *  must fail closed, not throw an untyped TypeError out of the normalizer. */
function isPlainReport(report: unknown): report is object {
  // The Object.prototype exclusion is load-bearing (review finding): passing
  // Object.prototype itself as the report would let POLLUTED prototype fields
  // read as own assertions on a "plain" object.
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the PROTOTYPE
 *  CHAIN even though value reads are own-only: an inherited version assertion in a
 *  spelling we ignore is still an assertion, and this scan is the only thing that
 *  notices it. A symbol key counts; a class instance fails closed. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

const CHANNELS = ["managed", "unmanaged", "unknown"] as const;

/** Parse a dotted numeric version ("2.4.0", optional leading "v") into numeric
 *  segments, or null when it cannot be POSITIVELY parsed. Strict on purpose: a
 *  version we cannot read is an unknown, never approximated into a comparison. */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^v/i, "");
  if (s.length === 0) return null;
  const parts = s.split(".");
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    // A segment beyond Number.MAX_SAFE_INTEGER collapses distinct versions onto
    // the same float (review finding): "2.9007199254740992" and "...93" compared
    // equal, positively deriving "current" from a comparison that lost
    // information. A version we cannot compare EXACTLY is a version we cannot
    // read — reject it (asserted-but-unparseable ⇒ malformed).
    if (!Number.isSafeInteger(n)) return null;
    nums.push(n);
  }
  return nums;
}

/** Compare two parsed versions numerically, padding short ones with zeros
 *  ("1.2" == "1.2.0"). Negative = a < b, 0 = equal, positive = a > b. */
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Was a version field ASSERTED but unparseable? Absent/null is silence, not damage. */
function versionMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return parseVersion(v) === null;
}

/** Was a boolean field asserted but not actually boolean? */
function boolMalformed(v: unknown): boolean {
  return v !== undefined && v !== null && typeof v !== "boolean";
}

/** A non-negative finite number, or null. STRICT: no numeric strings, no
 *  negatives, no NaN/Infinity — a count the wire could not state as a number
 *  is an assertion we could not read. */
function countOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/** Was a numeric field asserted but not a usable non-negative number? */
function countMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return countOf(v) === null;
}

/** Normalize one app-update report. Defensive throughout: a missing/errored field
 *  yields the fail-safe unknown, never a fabricated "current" — and the CURRENCY is
 *  COMPUTED here from the raw versions, so the wire can never assert it directly. */
export function normalizeReport(
  deviceRef: string,
  appRef: string,
  report: AppUpdateReportRaw,
  source = "app-update-manifest",
): NormalizedAppUpdate {
  const plain = isPlainReport(report);
  let rawInstalled: unknown;
  let rawLatest: unknown;
  let rawMin: unknown;
  let rawForce: unknown;
  let rawChannel: unknown;
  let rawCrashes: unknown;
  let rawWindow: unknown;
  let readThrew = false;
  try {
    rawInstalled = plain ? ownValue(report, "installed_version") : undefined;
    rawLatest = plain ? ownValue(report, "latest_version") : undefined;
    rawMin = plain ? ownValue(report, "min_version") : undefined;
    rawForce = plain ? ownValue(report, "force_update") : undefined;
    rawChannel = plain ? ownValue(report, "channel") : undefined;
    rawCrashes = plain ? ownValue(report, "crash_count") : undefined;
    rawWindow = plain ? ownValue(report, "stability_window_hours") : undefined;
  } catch {
    readThrew = true;
    rawInstalled = rawLatest = rawMin = rawForce = rawChannel = rawCrashes = rawWindow = undefined;
  }

  const installed = parseVersion(rawInstalled);
  const latest = parseVersion(rawLatest);
  const min = parseVersion(rawMin);

  // A manifest whose floor is ABOVE its own latest release contradicts itself —
  // no installed version could satisfy both. That is a broken manifest, not a
  // gradable posture.
  const contradictoryManifest = latest !== null && min !== null && compareVersions(min, latest) > 0;

  // Currency is a POSITIVE derivation: it needs a parsed installed version and a
  // parsed latest (the manifest's release is the only thing "current" can mean).
  // A floor violation is checked first — it is the affirmative bad fact.
  // A floor violation needs only installed+min to be positively established
  // (review finding): requiring latest first let a MISSING latest_version mask an
  // affirmatively-below-floor device down from restrict to step_up. The known-bad
  // fact wins over the unrelated unknown; a contradictory manifest still voids
  // the derivation entirely.
  let currency: UpdateCurrency;
  if (contradictoryManifest) {
    currency = "unknown";
  } else if (installed !== null && min !== null && compareVersions(installed, min) < 0) {
    currency = "below_floor";
  } else if (installed === null || latest === null) {
    currency = "unknown";
  } else if (compareVersions(installed, latest) < 0) {
    currency = "behind";
  } else {
    currency = "current";
  }

  const forcePolicy: ForcePolicy =
    rawForce === true ? "forced" : rawForce === false ? "not_forced" : "unknown";
  const channel = oneOf<InstallChannel>(rawChannel, CHANNELS, "unknown");

  const malformed =
    readThrew ||
    !plain ||
    hasUnrecognizedKey(report, APP_UPDATE_REPORT_KEYS) ||
    versionMalformed(rawInstalled) ||
    versionMalformed(rawLatest) ||
    versionMalformed(rawMin) ||
    contradictoryManifest ||
    boolMalformed(rawForce) ||
    enumMalformed(rawChannel, CHANNELS) ||
    countMalformed(rawCrashes) ||
    countMalformed(rawWindow) ||
    // A window of zero hours cannot have counted anything — self-contradictory.
    (countOf(rawWindow) !== null && (countOf(rawWindow) as number) === 0);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "app-update",
    deviceRef,
    appRef,
    currency,
    forcePolicy,
    channel,
    crashCount: countOf(rawCrashes),
    stabilityWindowHours: countOf(rawWindow) !== null && (countOf(rawWindow) as number) > 0 ? countOf(rawWindow) : null,
    reportIntegrity,
    source,
  };
}

export interface AppUpdateRequest {
  deviceRef: string;
  appRef: string;
  token: string;
}

export type AppUpdateTransport = (req: AppUpdateRequest) => Promise<AppUpdateReportRaw>;

export interface AppUpdateConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one app's inventory+manifest row and normalizes it. */
export class AppUpdateConnector {
  constructor(
    private readonly config: AppUpdateConnectorConfig,
    private readonly transport: AppUpdateTransport,
  ) {}

  async fetchNormalized(deviceRef: string, appRef: string): Promise<NormalizedAppUpdate> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceRef, appRef, token: this.config.accessToken });
    return normalizeReport(deviceRef, appRef, raw, this.config.source ?? "app-update-manifest");
  }
}
