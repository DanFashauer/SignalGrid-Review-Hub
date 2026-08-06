// Aruba ClearPass → endpoint lookup. READ-ONLY.
//
// WHAT WAS REMOVED. `quarantineEndpoint` (POST /api/endpoint), `clearQuarantine`
// (PATCH /api/endpoint/{id}) and the `quarantineDevice` alias changed an
// endpoint's enforcement state to cut it off the network — a DEVICE ACTION over
// the network, the same class deleted from uem/ in #150. "Quarantine this
// endpoint" has no read-only-disciplined form, and AGENTS.md requires high-risk
// actions to be simulated and approval-required, so these are gone rather than
// gated. What remains reads: look an endpoint up, and check connectivity.

import { resolveEmission } from '../adapters/emit-gate';
import type {
  NACAdapter,
  NACEndpointInfo
} from '../adapters/types';

/**
 * Aruba ClearPass NAC Adapter Configuration
 * 
 * Uses the ClearPass Policy Manager REST API
 */
export interface ArubaClearPassConfig {
  /** ClearPass instance URL (e.g., https://clearpass.example.com) */
  baseUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** Default role for quarantine */
  defaultQuarantineRole?: string;
  /** Default auth profile for quarantine */
  defaultQuarantineProfile?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Aruba ClearPass NAC Adapter
 * 
 * Manages network access control via ClearPass Policy Manager
 */
export class ArubaClearPassAdapter implements NACAdapter {
  readonly name = 'clearpass';
  readonly vendor = 'Aruba';
  readonly config: Required<ArubaClearPassConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: ArubaClearPassConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      defaultQuarantineRole: config.defaultQuarantineRole || 'Quarantine',
      defaultQuarantineProfile: config.defaultQuarantineProfile || '[Quarantine]',
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Look up an endpoint by MAC, serial, or certificate
   */
  async lookupEndpoint(identifier: string, type: 'mac' | 'serial' | 'cert'): Promise<NACEndpointInfo | null> {
    await this.ensureAuthenticated();

    let filter = '';
    switch (type) {
      case 'mac':
        filter = `mac_address='${identifier}'`;
        break;
      case 'serial':
        filter = `device_id='${identifier}'`;
        break;
      case 'cert':
        filter = `certificate='${identifier}'`;
        break;
    }

    const url = `${this.config.baseUrl}/api/endpoint?filter=${encodeURIComponent(filter)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`Aruba ClearPass API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      _embedded?: {
        items?: Array<{
          id: number;
          mac_address: string;
          device_id?: string;
          name?: string;
          status: string;
        }>;
      };
    };

    const items = data._embedded?.items;
    if (!items || items.length === 0) {
      return null;
    }

    const endpoint = items[0];

    return {
      endpointId: String(endpoint.id),
      macAddress: endpoint.mac_address,
      serialNumber: endpoint.device_id,
      name: endpoint.name,
      status: this.mapStatus(endpoint.status),
    };
  }


  /**
   * Health check - verify ClearPass connectivity
   */
  async healthCheck(): Promise<boolean> {
    // GATED. A health check is still a live call — see check-ungated-fetch.mjs.
    const emission = resolveEmission();
    if (emission.mode !== "live") return false;

    try {
      await this.ensureAuthenticated();
      
      const url = `${this.config.baseUrl}/api/endpoint?page=1&size=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return;
    }

    const tokenUrl = `${this.config.baseUrl}/api/oauth/token`;
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'api-token',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ClearPass OAuth error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
  }

  /**
   * Map ClearPass status to standard status
   */
  private mapStatus(status: string): 'unknown' | 'registered' | 'authenticated' | 'disconnected' {
    const statusMap: Record<string, 'unknown' | 'registered' | 'authenticated' | 'disconnected'> = {
      'Known': 'registered',
      'Unknown': 'unknown',
      'Authenticated': 'authenticated',
      'Disconnected': 'disconnected',
    };
    return statusMap[status] || 'unknown';
  }
}
