import {
  CredentialConnectorError,
  type CredentialCollection,
  type CredentialExposureRaw,
  type ExposureValidity,
  type NormalizedCredentialExposure,
  type NormalizedSecretFinding,
  type RemediationState,
  type SecretFindingRaw,
  type SecretKind,
  type SecretLocation,
  type SecretSeverity,
} from "./types";

/**
 * Read-only credential-exposure connector. Reads per-device scanner state +
 * recent secret findings and normalizes them. READ-ONLY by construction (GET-only,
 * guarded) — it never revokes a key, rotates a credential, or deletes a file;
 * those stay explicit, separately-authorized actions. Injectable transport for
 * offline proofs.
 */

export interface CredentialRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface CredentialHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type CredentialTransport = (req: CredentialRequest) => Promise<CredentialHttpResponse>;

export interface CredentialConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new CredentialConnectorError("read_only_violation", `The credential-exposure connector is read-only; refused a ${method} request.`);
  }
}

export class CredentialExposureConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: CredentialTransport;

  constructor(config: CredentialConnectorConfig, transport: CredentialTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.secrets.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/device-secrets?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listDevices(): Promise<CredentialExposureRaw[]> {
    return this.getAllPages<CredentialExposureRaw>(`${this.baseUrl}/device-secrets`);
  }

  async fetchDevices(): Promise<NormalizedCredentialExposure[]> {
    const devices = await this.listDevices();
    return devices.map(normalizeDevice);
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: CredentialCollection<T>;
      try {
        body = (await res.json()) as CredentialCollection<T>;
      } catch {
        throw new CredentialConnectorError("bad_response", "Credential-exposure response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new CredentialConnectorError("bad_response", "Credential-exposure collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    return out;
  }

  private async rawGet(url: string): Promise<CredentialHttpResponse> {
    const req: CredentialRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): CredentialConnectorError {
  if (status === 401 || status === 403) {
    return new CredentialConnectorError("auth_failed", `Secrets platform returned ${status}.`, status);
  }
  return new CredentialConnectorError("upstream_error", `Secrets platform returned HTTP ${status}.`, status);
}

const HIGH_VALUE_KINDS: ReadonlySet<SecretKind> = new Set<SecretKind>(["cloud_key", "private_key", "db_credential", "oauth_token"]);

export function normalizeDevice(device: CredentialExposureRaw): NormalizedCredentialExposure {
  return {
    sourceSystem: "credential-exposure",
    deviceId: device.deviceId,
    scannerEnrolled: typeof device.scannerEnrolled === "boolean" ? device.scannerEnrolled : null,
    // `?? []` here made "the source never reported this" indistinguishable from
    // "the source reported nothing". Absence is preserved and graded downstream.
    findings: device.findings == null ? null : device.findings.map(normalizeFinding),
    source: device.source ?? "unknown",
  };
}

export function normalizeFinding(f: SecretFindingRaw): NormalizedSecretFinding {
  const kind = normalizeKind(f.kind);
  const severity = normalizeSeverity(f.severity);
  const validity = normalizeValidity(f.validity);
  const remediation = normalizeRemediation(f.remediation);
  return {
    findingId: f.findingId ?? null,
    location: normalizeLocation(f.location),
    kind,
    severity,
    validity,
    remediation,
    detectedAt: f.detectedAt ?? null,
    exposed: isExposed(remediation, validity),
    highValue: HIGH_VALUE_KINDS.has(kind) || severity === "critical" || severity === "high",
  };
}

/**
 * "Exposed" = the secret is NOT provably contained. A finding is contained ONLY
 * when it was explicitly remediated OR the credential was explicitly revoked;
 * every other state lets the secret keep sitting on the endpoint, usable. An
 * unknown/unmapped remediation or validity can't be trusted to have contained it.
 * All fail-safe to exposed — we never assume an unconfirmed finding was cleaned up.
 */
function isExposed(remediation: RemediationState, validity: ExposureValidity): boolean {
  return !(remediation === "remediated" || validity === "revoked");
}

function normalizeLocation(location: string | undefined): SecretLocation {
  switch ((location ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "shell_history":
    case "bash_history":
    case "zsh_history":
    case "history":
      return "shell_history";
    case "dotenv":
    case "env":
    case "env_file":
    case ".env":
      return "dotenv";
    case "cli_cache":
    case "cli_config":
    case "credential_cache":
    case "aws_credentials":
      return "cli_cache";
    case "agent_config":
    case "cursor_config":
    case "copilot_config":
    case "claude_config":
    case "mcp_config":
      return "agent_config";
    case "agent_log":
    case "terminal_log":
    case "session_log":
    case "output_log":
      return "agent_log";
    case "source_tree":
    case "repo":
    case "working_tree":
    case "code":
      return "source_tree";
    case "keychain":
    case "keyring":
    case "credential_store":
      return "keychain";
    default:
      return "unknown";
  }
}

function normalizeKind(kind: string | undefined): SecretKind {
  switch ((kind ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "cloud_key":
    case "aws_key":
    case "aws_secret_key":
    case "gcp_key":
    case "azure_key":
      return "cloud_key";
    case "private_key":
    case "ssh_key":
    case "pem":
    case "rsa_key":
      return "private_key";
    case "db_credential":
    case "database":
    case "connection_string":
    case "db_password":
      return "db_credential";
    case "oauth_token":
    case "oauth":
    case "refresh_token":
    case "access_token":
      return "oauth_token";
    case "api_token":
    case "api_key":
    case "pat":
    case "token":
      return "api_token";
    case "password":
    case "passwd":
    case "secret_password":
      return "password";
    case "generic_secret":
    case "secret":
    case "generic":
      return "generic_secret";
    default:
      return "unknown";
  }
}

function normalizeSeverity(severity: string | undefined): SecretSeverity {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
    case "moderate":
      return "medium";
    case "low":
      return "low";
    default:
      return "unknown";
  }
}

function normalizeValidity(validity: string | undefined): ExposureValidity {
  switch ((validity ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "active":
    case "valid":
    case "live":
    case "confirmed_valid":
      return "active";
    case "revoked":
    case "rotated":
    case "invalid":
    case "expired":
      return "revoked";
    default:
      return "unknown";
  }
}

function normalizeRemediation(remediation: string | undefined): RemediationState {
  switch ((remediation ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    // Only UNAMBIGUOUS terminal states contain a secret. "closed" is deliberately
    // NOT here: trackers use "closed" for dismissed / won't-fix / accepted-risk /
    // false-positive, where the secret is still live on the endpoint. Fail-safe —
    // it falls through to "unknown" → exposed.
    case "remediated":
    case "resolved":
    case "fixed":
      return "remediated";
    case "open":
    case "unresolved":
    case "detected":
    case "active":
      return "open";
    default:
      return "unknown";
  }
}
