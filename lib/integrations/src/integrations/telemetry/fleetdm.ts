// FleetDM Telemetry Adapter
// Provides osquery-style device telemetry and compliance signals

import {
  FleetDMConfig,
  FleetDMHost,
  FleetDMPolicy,
  FleetDMPolicyResult,
  FleetDMPostureSignal,
} from './types';
import { getFleetDMConfig, setPostureForHost } from './store';
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

export class FleetDMAdapter {
  private config: FleetDMConfig | null = null;

  async initialize(): Promise<void> {
    this.config = await getFleetDMConfig();
  }

  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  // `Record<string, string>` rather than the DOM-lib `HeadersInit` alias: this is one
  // of HeadersInit's member shapes (so every fetch call site is unchanged), and it
  // keeps this module — and therefore the package root — typecheckable from programs
  // compiled against the node lib alone, which do not declare `HeadersInit`.
  private getHeaders(): Record<string, string> {
    if (!this.config?.apiToken) {
      throw new Error('FleetDM API token not configured');
    }
    return {
      'Authorization': `Bearer ${this.config.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private getBaseUrl(): string {
    if (!this.config?.baseUrl) {
      throw new Error('FleetDM base URL not configured');
    }
    return this.config.baseUrl.replace(/\/$/, '');
  }

  /**
   * Get all hosts from FleetDM
   */
  async getHosts(): Promise<FleetDMHost[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const response = await fetchWithTimeout(`${this.getBaseUrl()}/api/v1/fleet/hosts`, {
      method: 'GET',
      headers: this.getHeaders(),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`FleetDM getHosts failed: ${response.status} ${error}`);
    }

    const data = await response.json() as { hosts: FleetDMHost[] };
    return data.hosts;
  }

  /**
   * Get a specific host by UUID
   */
  async getHost(hostUuid: string): Promise<FleetDMHost | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const response = await fetchWithTimeout(
      `${this.getBaseUrl()}/api/v1/fleet/hosts/${hostUuid}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        timeoutMs: TIMEOUT_PRESETS.normal,
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`FleetDM getHost failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<FleetDMHost>;
  }

  /**
   * Get all policies (global or team-specific)
   */
  async getPolicies(): Promise<FleetDMPolicy[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const url = this.config?.teamId
      ? `${this.getBaseUrl()}/api/v1/fleet/teams/${this.config.teamId}/policies`
      : `${this.getBaseUrl()}/api/v1/fleet/policies`;

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: this.getHeaders(),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`FleetDM getPolicies failed: ${response.status} ${error}`);
    }

    const data = await response.json() as { policies: FleetDMPolicy[] };
    return data.policies;
  }

  /**
   * Get policy results for a specific host
   */
  async getPolicyResultsForHost(hostUuid: string): Promise<FleetDMPolicyResult[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const response = await fetchWithTimeout(
      `${this.getBaseUrl()}/api/v1/fleet/hosts/${hostUuid}/policies`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        timeoutMs: TIMEOUT_PRESETS.normal,
      }
    );

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`FleetDM getPolicyResultsForHost failed: ${response.status} ${error}`);
    }

    const data = await response.json() as { results: FleetDMPolicyResult[] };
    return data.results;
  }

  /**
   * Get full posture signal for a host (combines host info + policy results)
   */
  async getPostureForHost(hostUuid: string): Promise<FleetDMPostureSignal | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const [host, policyResults] = await Promise.all([
      this.getHost(hostUuid),
      this.getPolicyResultsForHost(hostUuid),
    ]);

    if (!host) {
      return null;
    }

    const policies = policyResults.map((result) => ({
      id: result.policy_id,
      name: result.policy_name,
      response: result.policy_response,
      updatedAt: result.policy_updated_at,
    }));

    const signal: FleetDMPostureSignal = {
      hostUuid,
      platform: host.platform,
      // Fail closed: a host with NO policy results is "unknown", not compliant —
      // `[].every(...)` is vacuously true, so require at least one policy AND all
      // passing before treating the host as compliant.
      compliant: policies.length > 0 && policies.every((p) => p.response === 'pass'),
      lastCheckAt: host.seen_time,
      policies,
      rawSignals: {
        os_version: host.os_version,
        hardware_model: host.hardware_model,
        serial_number: host.serial_number,
        uptime: host.uptime,
        memory: host.memory,
      },
    };

    // Cache the posture signal
    await setPostureForHost(hostUuid, signal, 300); // 5 min TTL

    return signal;
  }

  /**
   * Test connection to FleetDM
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isEnabled()) {
      return { success: false, message: 'FleetDM integration is disabled' };
    }

    try {
      const response = await fetchWithTimeout(`${this.getBaseUrl()}/api/v1/fleet/config`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeoutMs: TIMEOUT_PRESETS.short,
      });

      if (response.ok) {
        return { success: true, message: 'Successfully connected to FleetDM' };
      }

      return {
        success: false,
        message: `FleetDM API returned status ${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to connect to FleetDM: ${message}` };
    }
  }

  /**
   * Run a live query against FleetDM (for additional telemetry)
   */
  async runQuery(sql: string, hostIds?: number[]): Promise<Record<string, unknown>[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const response = await fetchWithTimeout(`${this.getBaseUrl()}/api/v1/fleet/queries/run`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        query: sql,
        host_ids: hostIds,
      }),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`FleetDM runQuery failed: ${response.status} ${error}`);
    }

    const data = await response.json() as { results: Record<string, unknown>[] };
    return data.results;
  }
}

// Singleton instance
let fleetDMAdapter: FleetDMAdapter | null = null;

export async function getFleetDMAdapter(): Promise<FleetDMAdapter> {
  if (!fleetDMAdapter) {
    fleetDMAdapter = new FleetDMAdapter();
    await fleetDMAdapter.initialize();
  }
  return fleetDMAdapter;
}
