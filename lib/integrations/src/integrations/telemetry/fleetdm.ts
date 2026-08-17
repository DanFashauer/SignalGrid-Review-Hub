// FleetDM Telemetry Adapter
// Provides osquery-style device telemetry and compliance signals

import {
  FleetDMConfig,
  FleetDMHost,
  FleetDMLiveQueryReport,
  FleetDMPolicy,
  FleetDMPolicyResult,
  FleetDMPostureSignal,
  FleetDMQueryResult,
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
   * Run a live osquery campaign against EXPLICITLY NAMED hosts and collect the
   * rows that stream back over Fleet's results websocket.
   *
   * History matters here: this method used to refuse outright, because its old
   * body (`{ query, host_ids }`) was rejected 400 by every real Fleet — it had
   * never once executed — and because a Fleet live query is ASYNCHRONOUS: the
   * POST answers `{ campaign }` and the per-host rows arrive over a WEBSOCKET,
   * so the old `data.results` was `undefined` while typed as an array. Fixing
   * only the body would have armed the most dangerous call in this package
   * while still returning nothing usable. The collector now exists (verified
   * against a live Fleet with a real enrolled osqueryd in `proof:live-fleet`),
   * so the refusal narrows to the gates below.
   *
   * This is the one method that sends arbitrary osquery SQL to real hosts, so
   * it sits behind THREE independent refusals, not just the tier chokepoint:
   *
   *   1. `isEnabled()` — tier AND operator flag, the same chokepoint as every
   *      read path in this file;
   *   2. `SIGNALGRID_ALLOW_LIVE_QUERY=true` — an explicit approval that no
   *      read path requires, so enabling live READS never arms live queries;
   *   3. a non-empty host list — a fleet-wide broadcast is refused outright,
   *      never implied by an omitted argument.
   *
   * The collection window is bounded (`opts.timeoutMs`, default 15s). A window
   * that closes before every targeted host reports returns what arrived with
   * `partial: true` — a partial measurement is reported as partial, never
   * presented as the whole.
   */
  async runQuery(
    sql: string,
    hostIds?: number[],
    opts?: { timeoutMs?: number },
  ): Promise<FleetDMLiveQueryReport> {
    if (!this.isEnabled()) {
      throw new Error(
        'FleetDM live query refused: adapter is not enabled — the deployment tier gate ' +
          'and the operator flag are both required, and neither is bypassed by approval.',
      );
    }
    if (process.env.SIGNALGRID_ALLOW_LIVE_QUERY !== 'true') {
      throw new Error(
        'FleetDM live query refused: SIGNALGRID_ALLOW_LIVE_QUERY is not "true". Live ' +
          'queries send arbitrary osquery SQL to real hosts, so they require this ' +
          'explicit approval in addition to the tier gate — enabling live reads must ' +
          'never arm live queries.',
      );
    }
    if (!hostIds || hostIds.length === 0) {
      throw new Error(
        'FleetDM live query refused: no target hosts named. A fleet-wide broadcast is ' +
          'never implied by an omitted host list.',
      );
    }

    const response = await fetchWithTimeout(`${this.getBaseUrl()}/api/v1/fleet/queries/run`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ query: sql, selected: { hosts: hostIds } }),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });
    if (!response.ok) {
      throw new Error(`FleetDM live query POST failed: ${response.status}`);
    }
    const data = (await response.json()) as { campaign?: { id?: number } };
    const campaignId = data.campaign?.id;
    if (typeof campaignId !== 'number') {
      throw new Error('FleetDM live query: no campaign id in the response — nothing to collect');
    }
    return this.collectCampaignResults(campaignId, hostIds.length, opts?.timeoutMs ?? 15000);
  }

  // Rows for a campaign stream over Fleet's results websocket; there is no REST
  // endpoint to poll for them. Node's built-in WebSocket client is reached via
  // globalThis so this module keeps typechecking against the node lib alone
  // (the same constraint getHeaders() documents for HeadersInit).
  private collectCampaignResults(
    campaignId: number,
    hostsTargeted: number,
    timeoutMs: number,
  ): Promise<FleetDMLiveQueryReport> {
    if (!this.isEnabled()) {
      throw new Error('FleetDM live query refused: adapter disabled before collection began');
    }
    const WebSocketImpl = (globalThis as Record<string, unknown>).WebSocket as
      | (new (url: string) => {
          addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void;
          send(data: string): void;
          close(): void;
        })
      | undefined;
    if (WebSocketImpl === undefined) {
      throw new Error('FleetDM live query: no WebSocket client available in this runtime');
    }
    const wsUrl = `${this.getBaseUrl().replace(/^http/, 'ws')}/api/v1/fleet/results/websocket`;
    const token = this.config?.apiToken ?? '';

    return new Promise((resolveReport, rejectReport) => {
      const results: FleetDMQueryResult[] = [];
      const responded = new Set<number>();
      let settled = false;
      const ws = new WebSocketImpl(wsUrl);
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // already closed
        }
        fn();
      };
      const finish = (partial: boolean) =>
        settle(() =>
          resolveReport({ campaignId, hostsTargeted, hostsResponded: responded.size, results, partial }),
        );
      const timer = setTimeout(() => finish(responded.size < hostsTargeted), timeoutMs);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'auth', data: { token } }));
        ws.send(JSON.stringify({ type: 'select_campaign', data: { campaign_id: campaignId } }));
      });
      ws.addEventListener('error', () =>
        settle(() =>
          rejectReport(new Error('FleetDM live query: websocket failed before the campaign finished')),
        ),
      );
      // A close before finish is a truncated window, not a clean answer: report
      // whatever arrived as partial rather than inventing completeness.
      ws.addEventListener('close', () => finish(responded.size < hostsTargeted));
      ws.addEventListener('message', (ev) => {
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(String(ev.data)) as { type?: string; data?: Record<string, unknown> };
        } catch {
          return; // a non-JSON frame is not a result; ignoring it beats guessing
        }
        if (msg.type === 'result' && msg.data !== undefined) {
          const host = msg.data.host as { id?: number } | undefined;
          const hostId = typeof host?.id === 'number' ? host.id : -1;
          if (hostId !== -1) {
            responded.add(hostId);
          }
          const rows = Array.isArray(msg.data.rows) ? (msg.data.rows as Record<string, unknown>[]) : [];
          const error =
            typeof msg.data.error === 'string' && msg.data.error.length > 0 ? msg.data.error : null;
          results.push({ host_id: hostId, rows, error });
          if (responded.size >= hostsTargeted) {
            finish(false);
          }
        } else if (msg.type === 'status' && msg.data !== undefined && msg.data.status === 'finished') {
          finish(responded.size < hostsTargeted);
        }
      });
    });
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
