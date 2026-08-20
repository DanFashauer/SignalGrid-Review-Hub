import {
  IdentityRiskConnectorError,
  type DetectionGrade,
  type NormalizedPrincipalRisk,
  type NormalizedRiskDetection,
  type PrincipalRiskRaw,
  type RiskCollection,
  type RiskDetectionRaw,
  type RiskDetectionType,
  type RiskLevel,
  type RiskState,
} from "./types";

/**
 * Read-only identity / SSO sign-in-risk connector. Reads per-principal risk
 * state + detections from an IdP's risk engine and normalizes them. READ-ONLY by
 * construction (GET-only, guarded) — it never confirms-compromise, dismisses,
 * revokes a session, or forces a password reset; those stay explicit, separately-
 * authorized actions. Injectable transport for offline proofs.
 */

export interface IdentityRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface IdentityHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type IdentityTransport = (req: IdentityRequest) => Promise<IdentityHttpResponse>;

export interface IdentityConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new IdentityRiskConnectorError("read_only_violation", `The identity-risk connector is read-only; refused a ${method} request.`);
  }
}

export class IdentityRiskConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: IdentityTransport;

  constructor(config: IdentityConnectorConfig, transport: IdentityTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.identity.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/risky-principals?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listPrincipals(): Promise<PrincipalRiskRaw[]> {
    return this.getAllPages<PrincipalRiskRaw>(`${this.baseUrl}/risky-principals`);
  }

  async fetchPrincipals(): Promise<NormalizedPrincipalRisk[]> {
    const principals = await this.listPrincipals();
    return principals.map(normalizePrincipal);
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: RiskCollection<T>;
      try {
        body = (await res.json()) as RiskCollection<T>;
      } catch {
        throw new IdentityRiskConnectorError("bad_response", "Identity-risk response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new IdentityRiskConnectorError("bad_response", "Identity-risk collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    // Exiting the cap with a next-page cursor still in hand means the inventory is
    // INCOMPLETE, and a short list is indistinguishable from a complete one — for a
    // posture fabric, a device missing from the result reads as a device with no
    // problem. Refuse rather than pass a partial inventory off as a whole one; the
    // cap itself stays, because it is the loop/DoS guard against an endless cursor.
    if (url) {
      throw new IdentityRiskConnectorError(
        "incomplete_read",
        `Identity-risk read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<IdentityHttpResponse> {
    const req: IdentityRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): IdentityRiskConnectorError {
  if (status === 401 || status === 403) {
    return new IdentityRiskConnectorError("auth_failed", `Identity provider returned ${status}.`, status);
  }
  return new IdentityRiskConnectorError("upstream_error", `Identity provider returned HTTP ${status}.`, status);
}

export function normalizePrincipal(principal: PrincipalRiskRaw): NormalizedPrincipalRisk {
  return {
    sourceSystem: "identity-risk",
    principalId: principal.principalId,
    riskLevel: normalizeRiskLevel(principal.riskLevel),
    riskState: normalizeRiskState(principal.riskState),
    mfaSatisfied: typeof principal.mfaSatisfied === "boolean" ? principal.mfaSatisfied : null,
    // `?? []` here made "the source never reported this" indistinguishable from
    // "the source reported nothing". Absence is preserved and graded downstream.
    detections: principal.detections == null ? null : principal.detections.map(normalizeDetection),
    lastSignInAt: principal.lastSignInAt ?? null,
    source: principal.source ?? "unknown",
  };
}

export function normalizeDetection(detection: RiskDetectionRaw): NormalizedRiskDetection {
  const detectionType = normalizeDetectionType(detection.detectionType);
  return {
    detectionType,
    grade: gradeForDetection(detectionType),
    riskLevel: normalizeRiskLevel(detection.riskLevel),
    detectedAt: detection.detectedAt ?? null,
    source: detection.source ?? "unknown",
  };
}

function normalizeRiskLevel(level: string | undefined): RiskLevel {
  switch ((level ?? "").toLowerCase()) {
    case "high":
      return "high";
    case "medium":
    case "moderate":
      return "medium";
    case "low":
      return "low";
    case "none":
      return "none";
    default:
      // "hidden" / "unknownfuturevalue" / missing → unknown (not "none").
      return "unknown";
  }
}

function normalizeRiskState(state: string | undefined): RiskState {
  switch ((state ?? "").toLowerCase()) {
    case "atrisk":
    case "at_risk":
      return "at_risk";
    case "confirmedcompromised":
    case "confirmed_compromised":
      return "confirmed_compromised";
    case "remediated":
      return "remediated";
    case "dismissed":
      return "dismissed";
    case "confirmedsafe":
    case "confirmed_safe":
      return "confirmed_safe";
    // Entra's value for a clean principal — the MOST COMMON value in a healthy
    // tenant. Without this arm it fell to the default below, so every clean
    // principal and every unparseable vendor state normalized to the same
    // "unknown". The two must part ways here, because downstream they grade
    // very differently: "none" can earn trusted, "unknown" never can.
    case "none":
      return "none";
    default:
      return "unknown";
  }
}

function normalizeDetectionType(type: string | undefined): RiskDetectionType {
  switch ((type ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "leakedcredentials":
    case "leaked_credentials":
      return "leaked_credentials";
    case "maliciousipaddress":
    case "malicious_ip":
    case "malware_linked_ip":
    case "malwareinfectedipaddress":
      return "malicious_ip";
    case "anomaloustoken":
    case "token_anomaly":
    case "tokenissueranomaly":
      return "token_anomaly";
    case "admin_confirmed_compromised":
    case "adminconfirmedusercompromised":
      return "admin_confirmed_compromised";
    case "impossibletravel":
    case "impossible_travel":
    case "mcasimpossibletravel":
      return "impossible_travel";
    case "anonymizedipaddress":
    case "anonymous_ip":
    case "tor":
      return "anonymous_ip";
    case "passwordspray":
    case "password_spray":
      return "password_spray";
    case "unfamiliarfeatures":
    case "unfamiliar_sign_in":
    case "unfamiliarsigninproperties":
      return "unfamiliar_sign_in";
    case "new_country":
    case "newcountry":
      return "new_country";
    case "mfa_failed":
    case "mfafailed":
      return "mfa_failed";
    case "suspicious_activity":
    case "suspiciousbrowser":
    case "suspiciousinboxmanipulation":
      return "suspicious_activity";
    default:
      return "unknown";
  }
}

/**
 * Severity of a detection TYPE, independent of the IdP's numeric level. An
 * unknown/unmapped type is graded "medium" — fail-safe: a risk detection we can't
 * classify is never treated as benign.
 */
function gradeForDetection(type: RiskDetectionType): DetectionGrade {
  switch (type) {
    case "leaked_credentials":
    case "malicious_ip":
    case "token_anomaly":
    case "admin_confirmed_compromised":
      return "compromise";
    case "impossible_travel":
    case "anonymous_ip":
    case "password_spray":
      return "high";
    default:
      return "medium";
  }
}
