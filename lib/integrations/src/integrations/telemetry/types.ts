// FleetDM Telemetry Types
// Integrates with FleetDM for osquery-style device telemetry and compliance signals

export interface FleetDMHost {
  id: number;
  uuid: string;
  hostname: string;
  platform: 'darwin' | 'linux' | 'windows' | 'chrome';
  os_version: string;
  os_build: string;
  uptime: number;
  memory: number;
  cpu_type: string;
  cpu_brand: string;
  hardware_model: string;
  // Fleet's field is `hardware_serial`. This was declared as `serial_number`, a
  // key a real Fleet never sends — so it was typed non-optional while always
  // being `undefined` at runtime. Measured against Fleet 4.89.2 by
  // `proof:live-fleet`.
  hardware_serial: string;
  last_enrolled_at: string;
  seen_time: string;
  distributed_interval: number;
  config_tls_refresh: number;
  logger_tls_period: number;
  team_id: number | null;
  team_name: string | null;
}

export interface FleetDMPolicy {
  id: number;
  name: string;
  description: string;
  query: string;
  resolution: string;
  platform: 'darwin' | 'linux' | 'windows' | 'chrome' | null;
  team_id: number | null;
}

// A real Fleet reports a policy a host has not yet answered as the EMPTY STRING,
// not as 'fail' (measured on 4.89.2). That third state is kept rather than folded
// into either side: 'pass' would grade an unobserved policy as observed-good — the
// exact fail-open this repo keeps removing — and 'fail' would assert a failure
// that was never observed. `unknown` is not compliant, but it is also not a claim.
export type FleetDMPolicyResponse = 'pass' | 'fail' | 'unknown';

export interface FleetDMPolicyResult {
  host_id: number;
  policy_id: number;
  policy_name: string;
  policy_response: FleetDMPolicyResponse;
  policy_updated_at: string;
}

export interface FleetDMQueryResult {
  host_id: number;
  rows: Record<string, unknown>[];
  error: string | null;
}

export interface FleetDMPostureSignal {
  hostUuid: string;
  platform: string;
  compliant: boolean;
  lastCheckAt: string;
  policies: {
    id: number;
    name: string;
    response: FleetDMPolicyResponse;
    updatedAt: string;
  }[];
  rawSignals?: Record<string, unknown>;
}

export interface FleetDMConfig {
  enabled: boolean;
  baseUrl: string;
  apiToken: string;
  teamId?: number;
  syncIntervalMs: number;
}

export type TelemetryMode = 'off' | 'optional' | 'required';

export interface TelemetryConfig {
  mode: TelemetryMode;
  fleetdm?: FleetDMConfig;
  mde?: MDEConfig;
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  mode: 'off',
};

// ============================================================================
// Microsoft Defender for Endpoint (MDE) Types
// ============================================================================

export interface MDEConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud?: 'public' | 'gov' | 'china';
}

export interface MDEDevice {
  id: string;
  deviceName: string;
  operatingSystem: string;
  osVersion: string;
  complianceState: 'compliant' | 'non_compliant' | 'unknown';
  deviceHealthStatus: string;
  securityBaselineComplianceState: string;
  threatAgentShielding: string;
  jailBroken: string;
  encryptionStatus: string;
  lastSyncDateTime: string;
  enrolledDateTime: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
}

export interface MDEPostureSignal {
  deviceId: string;
  hostname: string;
  compliant: boolean;
  lastCheckAt: string;
  osVersion: string;
  platform: string;
  securityBaselineStatus: string;
  threatDefenseStatus: string;
  jailbroken: boolean;
  encryptionStatus: string;
}
