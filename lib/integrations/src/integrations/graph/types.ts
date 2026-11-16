// Types for the read-only Microsoft Graph posture connector.
//
// The connector reads identity + device posture from Microsoft Graph (users and
// deviceManagement/managedDevices) and normalizes the vendor's enum strings into
// the small, stable posture vocabulary the SignalGrid decision core consumes.
// It is READ-ONLY by construction: only GET requests are ever issued.

/** Raw Graph `user` fields we read (a read-only subset). */
export interface GraphUserRaw {
  id: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
  /** From Identity Protection riskyUsers, when the read scope is granted. */
}

/**
 * Raw Graph `riskyUser` fields we read (a read-only subset of
 * `/identityProtection/riskyUsers`). User risk does NOT live on `/users` —
 * `GraphUserRaw` carried a `riskLevel` the live `$select` never asked for, so
 * fixtures exercised a value the live path could never produce and every live
 * subject graded `unknown` (ninth audit round, 2026-09-06).
 */
export interface GraphRiskyUserRaw {
  id: string;
  riskLevel?: string;
  riskState?: string;
}

/** Raw Graph `managedDevice` fields we read (a read-only subset). */
export interface GraphManagedDeviceRaw {
  id: string;
  azureADDeviceId?: string;
  userId?: string;
  userPrincipalName?: string;
  deviceName?: string;
  complianceState?: string;
  managementState?: string;
  managementAgent?: string;
  deviceRegistrationState?: string;
  lastSyncDateTime?: string;
  operatingSystem?: string;
  osVersion?: string;
}

/** A Graph collection response (`{ value: [...], "@odata.nextLink"?: "..." }`). */
export interface GraphCollection<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

export type IdentityStatus = "enabled" | "disabled" | "unknown";
export type UserRisk = "none" | "low" | "medium" | "high" | "unknown";
export type DeviceComplianceState =
  | "compliant"
  | "non_compliant"
  | "in_grace_period"
  | "missing"
  | "unknown";
export type DeviceManagementState = "managed" | "unmanaged" | "retire_pending" | "unknown";
export type DeviceRegistrationState = "registered" | "not_registered" | "unknown";

/**
 * The normalized posture signal the connector emits — a vendor-neutral shape the
 * SignalGrid core can turn into a decision. Carries provenance so evidence is
 * traceable back to the source read.
 */
export interface GraphPostureSignal {
  sourceSystem: "microsoft-graph";
  correlationId: string;
  observedAt: string;
  /**
   * The owning user's id, or NULL when no user could be resolved for the device.
   * Never the literal "unknown": an unresolved identity rendered as an identity
   * gave every ownerless device one shared synthetic subject.
   */
  subjectId: string | null;
  identityStatus: IdentityStatus;
  userRisk: UserRisk;
  deviceId: string;
  deviceComplianceState: DeviceComplianceState;
  deviceManagementState: DeviceManagementState;
  deviceRegistrationState: DeviceRegistrationState;
  deviceLastSeenAt: string | null;
}

export type GraphConnectorErrorCode =
  | "incomplete_read"
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class GraphConnectorError extends Error {
  readonly code: GraphConnectorErrorCode;
  readonly status: number;
  constructor(code: GraphConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "GraphConnectorError";
    this.code = code;
    this.status = status;
  }
}
