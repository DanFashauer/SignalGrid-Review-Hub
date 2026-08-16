// FleetDM Telemetry Adapter
// Provides osquery-style device telemetry and compliance signals

import {
  FleetDMConfig,
  FleetDMHost,
  FleetDMPolicy,
  FleetDMPolicyResult,
  FleetDMPostureSignal,
} from './types';
import { resolveEmission } from '../adapters/emit-gate';
import { getFleetDMConfig, setPostureForHost } from './store';
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

export class FleetDMAdapter {
  private config: FleetDMConfig | null = null;

  async initialize(): Promise<void> {
    this.config = await getFleetDMConfig();
  }

  isEnabled(): boolean {
    // The tier gate is ANDed with the operator's config flag, and it is checked
    // HERE because every live path in this file guards on isEnabled() — making
    // this the one chokepoint that cannot be bypassed by adding a new method.
    //
    // `config.enabled` is an operator preference, not a safety control: a dev or
    // alpha process with enabled=true would otherwise reach the live Fleet API,
    // including runQuery(), which POSTs arbitrary osquery SQL to real hosts.
    if (resolveEmission().mode === 'suppressed') return false;
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
   * Get a specific host by UUID.
   *
   * `/hosts/{x}` takes Fleet's NUMERIC id, so passing a UUID there 404s on every
   * call — the lookup could never succeed. The by-identifier route is the one that
   * accepts a UUID (also hostname, osquery id or serial). Measured against a real
   * Fleet 4.89.2 by `proof:live-fleet`; the old path was fixture-only.
   *
   * The response is also a `{ host: ... }` ENVELOPE, not a bare host. The previous
   * `as Promise<FleetDMHost>` cast asserted otherwise, so `host.platform` and every
   * other field would have been `undefined` at runtime while typechecking cleanly.
   */
  async getHost(hostUuid: string): Promise<FleetDMHost | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const response = await fetchWithTimeout(
      `${this.getBaseUrl()}/api/v1/fleet/hosts/identifier/${encodeURIComponent(hostUuid)}`,
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

    const data = await response.json() as { host?: FleetDMHost };
    // Unwrap deliberately rather than casting: an envelope without `host` is a
    // response we do not understand, and returning it as a host would hand the
    // caller an object whose every field is undefined.
    return data.host ?? null;
  }

  /**
   * Get all policies (global or team-specific)
   */
  async getPolicies(): Promise<FleetDMPolicy[]> {
    if (!this.isEnabled()) {
      return [];
    }

    // Global policies live under /global/policies. Plain /policies does not exist
    // and 404s on a real Fleet (measured on 4.89.2). The TEAM branch is left as it
    // was on purpose: teams are a Fleet PREMIUM feature, so the free server this
    // was verified against cannot create one, and changing an unverified path on
    // the strength of a fixed sibling would be a guess wearing a fix's clothes.
    const url = this.config?.teamId
      ? `${this.getBaseUrl()}/api/v1/fleet/teams/${this.config.teamId}/policies`
      : `${this.getBaseUrl()}/api/v1/fleet/global/policies`;

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
   * Fetch a host together with its policy results in ONE call.
   *
   * Fleet has no `/hosts/{id}/policies` route (it 404s); policy results are
   * returned INSIDE the host object when `populate_policies=true` is asked for.
   * Because both public reads below need the same document, they share this — two
   * separate round-trips to one endpoint would also risk the host and its policies
   * being read at different instants and grading a posture that never existed.
   */
  private async fetchHostWithPolicies(
    hostUuid: string,
  ): Promise<{ host: FleetDMHost; policies: FleetDMPolicyResult[] } | null> {
    // Reached only via isEnabled()-gated methods today — but "today" is a
    // circumstance. The chokepoint holds here too, so a future direct caller
    // cannot reach the live Fleet API around it.
    if (!this.isEnabled()) {
      throw new Error('refused: host fetch with the fixture/live boundary closed.');
    }
    const response = await fetchWithTimeout(
      `${this.getBaseUrl()}/api/v1/fleet/hosts/identifier/${encodeURIComponent(hostUuid)}?populate_policies=true`,
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
      throw new Error(`FleetDM getPolicyResultsForHost failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      host?: FleetDMHost & {
        policies?: { id: number; name: string; response?: string; updated_at?: string }[];
      };
    };
    const host = data.host;
    if (!host) {
      return null;
    }

    const policies: FleetDMPolicyResult[] = (host.policies ?? []).map((p) => ({
      host_id: host.id,
      policy_id: p.id,
      policy_name: p.name,
      // Fleet sends '' for a policy this host has not answered yet. Anything that
      // is not literally 'pass' or 'fail' is reported as `unknown` rather than
      // guessed in either direction — see FleetDMPolicyResponse.
      policy_response:
        p.response === 'pass' ? 'pass' : p.response === 'fail' ? 'fail' : 'unknown',
      policy_updated_at: p.updated_at ?? '',
    }));

    return { host, policies };
  }

  /**
   * Get policy results for a specific host
   */
  async getPolicyResultsForHost(hostUuid: string): Promise<FleetDMPolicyResult[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const result = await this.fetchHostWithPolicies(hostUuid);
    return result?.policies ?? [];
  }

  /**
   * Get full posture signal for a host (combines host info + policy results)
   */
  async getPostureForHost(hostUuid: string): Promise<FleetDMPostureSignal | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const fetched = await this.fetchHostWithPolicies(hostUuid);
    if (!fetched) {
      return null;
    }
    const { host, policies: policyResults } = fetched;

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
        // Sourced from Fleet's real `hardware_serial`; the previous
        // `host.serial_number` is a key Fleet never sends, so this was always
        // undefined.
        serial_number: host.hardware_serial,
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

      if (!response.ok) {
        return {
          success: false,
          message: `FleetDM API returned status ${response.status}`,
        };
      }

      // Config alone is not enough to call this integration healthy. Reaching
      // /fleet/config only proves the host is up and the token is valid — it was
      // returning 200, and reporting "Successfully connected", during the entire
      // period when every host and policy route in this adapter 404'd. A health
      // check that cannot detect a completely non-functional integration does not
      // measure health; it manufactures confidence.
      //
      // So exercise a SUBSTANTIVE read as well. An empty inventory is a legitimate
      // answer (a Fleet with no enrolled hosts is fine) — what matters is that the
      // read path resolves at all rather than throwing on a 404.
      const hosts = await this.getHosts();
      return {
        success: true,
        message: `Successfully connected to FleetDM (inventory read OK, ${hosts.length} host(s))`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to connect to FleetDM: ${message}` };
    }
  }

  /**
   * Run a live query against FleetDM (for additional telemetry).
   *
   * REFUSES, and sends nothing. Measured against Fleet 4.89.2 by
   * `proof:live-fleet`, this method could not work as written and could not be
   * made to work by fixing its request:
   *
   *   1. Its body was `{ query, host_ids }`, which Fleet rejects 400 "no hosts
   *      targeted" — it wants `{ query, selected: { hosts: [...] } }`. So this
   *      has never once executed.
   *   2. More fundamentally, a Fleet live query is ASYNCHRONOUS. A successful
   *      POST returns `{ campaign: ... }` and the per-host rows stream back over
   *      a WEBSOCKET; there is no results array in the response. The old
   *      `data.results` was therefore `undefined` while typed as an array — any
   *      caller reaching for `.length` or `.map` would have thrown.
   *
   * Correcting only the body would ARM the single most dangerous call in this
   * package — it POSTs arbitrary osquery SQL to real production hosts — while
   * still returning nothing usable, because collecting the results needs a
   * websocket client that does not exist here. Full blast radius, zero value.
   *
   * So it refuses in the open, the way syslog now reports `not_implemented`
   * rather than a comforting 'sent'. Implementing the campaign/websocket
   * collector is a feature, tracked in docs/BUILD_BACKLOG.md — not something to
   * fake with a request that merely stops erroring.
   */
  async runQuery(_sql: string, _hostIds?: number[]): Promise<Record<string, unknown>[]> {
    throw new Error(
      'FleetDM runQuery is not implemented: Fleet live queries are asynchronous ' +
        'campaigns whose results arrive over a websocket, so no synchronous result ' +
        'set exists to return. Refusing rather than sending osquery SQL whose output ' +
        'this adapter cannot collect. See docs/BUILD_BACKLOG.md.',
    );
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
