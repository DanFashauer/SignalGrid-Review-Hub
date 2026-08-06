// Cisco ISE → endpoint lookup. READ-ONLY. See the removal note below.
import { resolveEmission } from '../adapters/emit-gate';
import type {
  NACAdapter,
  NACEndpointInfo
} from '../adapters/types';

/**
 * Cisco ISE (Identity Services Engine) NAC Adapter Configuration
 * 
 * Uses the Cisco ISE REST API
 */
export interface CiscoISEConfig {
  /** Cisco ISE PAN (Policy Administration Node) address */
  baseUrl: string;
  /** REST API username */
  username: string;
  /** REST API password */
  password: string;
  /** Use X.509 certificate for authentication */
  certPath?: string;
  /** Default network profile to apply for quarantine */
  defaultQuarantineProfile?: string;
  /** Default ACL name for quarantine */
  defaultQuarantineACL?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Cisco ISE NAC Adapter
 * 
 * Manages network access control via Cisco ISE
 */
export class CiscoISEAdapter implements NACAdapter {
  readonly name = 'ise';
  readonly vendor = 'Cisco';
  readonly config: Required<CiscoISEConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: CiscoISEConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      username: config.username,
      password: config.password,
      certPath: config.certPath || '',
      defaultQuarantineProfile: config.defaultQuarantineProfile || 'Quarantine',
      defaultQuarantineACL: config.defaultQuarantineACL || 'ACL_QUARANTINE',
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
        filter = `MacAddress eq '${identifier}'`;
        break;
      case 'serial':
        filter = `DeviceId eq '${identifier}'`;
        break;
      case 'cert':
        filter = `CertificateSerialNumber eq '${identifier}'`;
        break;
    }

    const url = `${this.config.baseUrl}/api/v1/endpoint?filter=${encodeURIComponent(filter)}`;

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
      throw new Error(`Cisco ISE API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      SearchResult?: {
        resources?: Array<{
          id: string;
          name: string;
          description: string;
        }>;
      };
    };

    if (!data.SearchResult?.resources || data.SearchResult.resources.length === 0) {
      return null;
    }

    const endpoint = data.SearchResult.resources[0];

    return {
      endpointId: endpoint.id,
      macAddress: type === 'mac' ? identifier : undefined,
      serialNumber: type === 'serial' ? identifier : undefined,
      certSubject: type === 'cert' ? identifier : undefined,
      name: endpoint.name,
      status: 'registered',
    };
  }

  // WHAT WAS REMOVED. `quarantineEndpoint` (POST /api/v1/anc/apply),
  // `clearQuarantine` (POST /api/v1/anc/clear) and the `quarantineDevice` alias
  // drove Cisco ISE's Adaptive Network Control to cut a device off the network —
  // a DEVICE ACTION over the network, the same class deleted from uem/ in #150.
  // There is no read-only-disciplined form of "quarantine this endpoint", and
  // AGENTS.md requires high-risk actions to be simulated and approval-required,
  // so the actuators are gone rather than gated. What remains is read-only:
  // look an endpoint up, and check connectivity.

  /**
   * Health check - verify Cisco ISE connectivity
   */
  async healthCheck(): Promise<boolean> {
    // GATED. A health check is still a live call — see check-ungated-fetch.mjs.
    const emission = resolveEmission();
    if (emission.mode !== "live") return false;

    try {
      await this.ensureAuthenticated();
      
      const url = `${this.config.baseUrl}/api/v1/anc/policy`;
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
   * Ensure we have a valid access token (ISE uses Basic Auth for ERS API)
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return;
    }

    // Cisco ISE uses basic auth for ERS API
    // Get a session token first
    const authUrl = `${this.config.baseUrl}/api/v1/ers-sdk/session`;
    
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cisco ISE auth error: ${response.status} - ${error}`);
    }

    // Extract session token from cookies or headers
    const cookies = response.headers.get('Set-Cookie');
    if (cookies) {
      this.accessToken = cookies;
      this.tokenExpiry = Date.now() + 1800000; // 30 minutes (typical ISE session)
    } else {
      // Fallback: use basic auth for each request
      this.accessToken = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
      this.tokenExpiry = Date.now() + 1800000;
    }
  }

}
