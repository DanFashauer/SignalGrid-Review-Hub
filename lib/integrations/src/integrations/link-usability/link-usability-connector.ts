// Read-only normalization + transport for the link-usability connector.
//
// The source is a wireless controller or cloud dashboard (Meraki / Mist / Aruba /
// Ruckus-class, or any WLAN exposing per-client connection-ladder counters, roaming
// behaviour and latency banding) that has already evaluated the client. This connector
// normalizes that evaluated result. Every operation here is a read; there is no write
// path — it joins no network, steers no client, changes no radio setting, and
// deauthenticates nobody.
//
// The hardened-normalizer pattern below is carried in from `device-management-health`
// and `agent-identity` rather than rediscovered. It cost eight adversarial reviews to
// arrive at, and every clause is here for a failure that actually happened: own-only
// reads, a prototype-chain key scan that flags ANY inherited key, `null` as absence in
// both the enum and boolean paths, `reportIntegrity` tracked apart from field values,
// and a bounded, try/catch-wrapped walk.

import {
  LINK_USABILITY_REPORT_KEYS,
  LinkUsabilityConnectorError,
  type AssociationState,
  type LinkLatencyClass,
  type LinkProgress,
  type LinkUsabilityReportRaw,
  type NormalizedLinkUsability,
  type ReportIntegrity,
  type RoamCapability,
  type RoamHealth,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new LinkUsabilityConnectorError(
      "read_only_violation",
      `link usability is read-only; refused ${method}`,
    );
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

/** Did the report ASSERT something here that we could not parse?
 *
 *  `oneOf` and `boolOrNull` are lossy by design — they collapse "absent" and
 *  "unreadable" into one sentinel. That is right for choosing a value and wrong for
 *  deciding whether the report was UNDERSTOOD. Presence, not parsed value, is what makes
 *  something an assertion. `null` counts as ABSENT in both, matching the sibling
 *  connectors: it is the standard wire spelling of "no value", and a bridge emitting a
 *  fixed row shape with nulls rather than omitting keys is being honest, not unreadable. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, so it must not read as a confirmation, and
 *  a polluted `Object.prototype` is invisible here. This governs READS only — the
 *  unrecognized-key scan below still walks the chain, because an inherited key is an
 *  assertion even though its value is not read. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all?
 *
 *  `report !== Object.prototype` is the non-obvious clause and it closes a real hole
 *  found by review in the sibling connector: the key scan's stop condition is
 *  `o !== Object.prototype`, evaluated before the first iteration, so a report that IS
 *  `Object.prototype` was never scanned and a polluted prototype normalized to clean and
 *  granted. "Have we reached the chain terminus" is not the same question as "is this
 *  the report". `!Array.isArray` is belt-and-braces — an array already fails the scan on
 *  its own `length` — and is labelled redundant so nobody mistakes it for load-bearing. */
function isPlainReport(report: unknown): report is object {
  return (
    // Redundant, established by mutation testing: a primitive or a function reaching the
    // key scan makes `Reflect.ownKeys` throw or return unrecognized keys, so it ends at
    // `malformed` either way. Kept as a plain statement of the transport contract.
    typeof report === "object" &&
    // Redundant: `hasOwnProperty.call(null, …)` throws, which the wrapped read below
    // catches into `readFailed`, which forces malformed anyway. Kept for legibility.
    report !== null &&
    !Array.isArray(report) &&
    report !== Object.prototype
  );
}

/** Depth bound for the prototype scan. A Proxy may return a fresh object from
 *  `getPrototypeOf` on every call, so the walk must be bounded rather than trusting it
 *  to terminate. Exceeding the bound means we could not establish what the report
 *  carries — a failure to understand it, so it fails closed. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand?
 *
 *  Walks the PROTOTYPE CHAIN even though every VALUE read is own-only. The asymmetry is
 *  deliberate and was learned by breaking it: reading own-only is right, because an
 *  inherited value is the prototype's claim; but *scanning* own-only is wrong, because
 *  an inherited `roam_health` is still an assertion in a spelling we ignore, and this
 *  scan is the only thing that notices. Beyond the report's own level ANY key counts,
 *  including one we recognize — a correctly-spelled inherited key is a STRONGER
 *  assertion than a misspelled one, and since values are read own-only it would
 *  otherwise be asserted by the report and read by nobody. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        // Redundant by construction — `known` holds only strings, so the `includes`
        // below already rejects every symbol. Kept as an explicit statement of intent.
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    // A hostile Proxy can throw from `ownKeys` or `getPrototypeOf`. We learned nothing.
    return true;
  }
}

const ASSOCIATION = ["associated", "not_associated", "unknown"] as const;
const PROGRESS = [
  "carrying_traffic",
  "dns_failing",
  "dhcp_failing",
  "associated_only",
  "not_associated",
  "unknown",
] as const;
const ROAM_CAPABILITY = ["fast_transition", "basic", "not_applicable", "unknown"] as const;
const ROAM_HEALTH = ["stable", "sticky", "excessive", "not_applicable", "unknown"] as const;
const LATENCY = ["nominal", "degraded", "unknown"] as const;

/** Normalize a link report. Defensive throughout: a missing/errored field yields the
 *  fail-safe unknown/null, never a fabricated "carrying_traffic"/"stable". */
export function normalizeReport(
  deviceId: string,
  report: LinkUsabilityReportRaw,
  source = "link-usability-bridge",
): NormalizedLinkUsability {
  // Reads are OWN-ONLY and wrapped: a property can be an ACCESSOR that throws, and an
  // unguarded read would escape as a bare `Error` rather than landing where every other
  // unreadable shape lands.
  const plain = isPlainReport(report);
  let readFailed = false;
  const read = (key: string): unknown => {
    // Redundant: `!plain` already forces `malformed` below, so short-circuiting here
    // changes no verdict. Kept so a non-object never reaches `hasOwnProperty`.
    if (!plain) return undefined;
    try {
      return ownValue(report, key);
    } catch {
      readFailed = true;
      return undefined;
    }
  };
  const raw = {
    associationState: read("associationState"),
    linkProgress: read("linkProgress"),
    roamCapability: read("roamCapability"),
    roamHealth: read("roamHealth"),
    linkLatencyClass: read("linkLatencyClass"),
    controllerReachable: read("controllerReachable"),
  };

  const associationState = oneOf<AssociationState>(raw.associationState, ASSOCIATION, "unknown");
  const linkProgress = oneOf<LinkProgress>(raw.linkProgress, PROGRESS, "unknown");
  const roamCapability = oneOf<RoamCapability>(raw.roamCapability, ROAM_CAPABILITY, "unknown");
  const roamHealth = oneOf<RoamHealth>(raw.roamHealth, ROAM_HEALTH, "unknown");
  const linkLatencyClass = oneOf<LinkLatencyClass>(raw.linkLatencyClass, LATENCY, "unknown");

  const malformed =
    !plain ||
    readFailed ||
    hasUnrecognizedKey(report, LINK_USABILITY_REPORT_KEYS) ||
    enumMalformed(raw.associationState, ASSOCIATION) ||
    enumMalformed(raw.linkProgress, PROGRESS) ||
    enumMalformed(raw.roamCapability, ROAM_CAPABILITY) ||
    enumMalformed(raw.roamHealth, ROAM_HEALTH) ||
    enumMalformed(raw.linkLatencyClass, LATENCY) ||
    boolMalformed(raw.controllerReachable);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // The normalizer resolves no contradiction between `associationState` and
  // `linkProgress` by rewriting either — it reports both and lets the EVALUATOR raise
  // the disagreement with its own reason code. Rewriting here would erase the fields an
  // operator needs in order to know which side of the bridge mapping to fix, and the
  // sibling connector has a documented case where exactly that made its motivating
  // diagnosis unreachable at the wire layer.
  return {
    sourceSystem: "link-usability",
    deviceId,
    associationState,
    linkProgress,
    roamCapability,
    roamHealth,
    linkLatencyClass,
    controllerReachable: boolOrNull(raw.controllerReachable),
    reportIntegrity,
    source,
  };
}

export interface LinkUsabilityRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's evaluated link state from a bridge. Injectable so tests/fixtures
 *  never touch the network. */
export type LinkUsabilityTransport = (req: LinkUsabilityRequest) => Promise<LinkUsabilityReportRaw>;

export interface LinkUsabilityConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class LinkUsabilityConnector {
  constructor(
    private readonly config: LinkUsabilityConnectorConfig,
    private readonly transport: LinkUsabilityTransport,
  ) {}

  /**
   * NOTE ON `status: null`. The success path returns null, NOT 200.
   *
   * This connector is handed an INJECTED transport that resolves a payload — there is
   * no HTTP response here and therefore no status code to read. The old `status: 200`
   * was invented: a 201, 202 or 204 upstream reported as 200, and a reviewer reading
   * the field believed a server had said it. `null` is the honest value — "the
   * transport resolved; no status was observed" — and the type can now say it.
   *
   * The failure path keeps a real number because the error carries one.
   *
   * NOT FIXED HERE, and stated so the remaining gap is not mistaken for closed:
   * `healthy: true` still means "the injected transport resolved", which in fixture
   * mode is true without anything being contacted. That fix belongs at the resolution
   * layer, which already reports `mode: "fixture"` with a reason — see the backlog.
   */
  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number | null }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: null };
    } catch (err) {
      const status = err instanceof LinkUsabilityConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchLink(deviceId: string): Promise<NormalizedLinkUsability> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
