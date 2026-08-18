/**
 * Microsoft Defender for Endpoint (MDE) Telemetry Adapter
 * 
 * Provides device posture and security state from MDE.
 * Uses Microsoft Graph API to fetch device information.
 * 
 * Features:
 * - Device compliance status
 * - Security baseline assessment
 * - Threat detection status
 * - Device health metrics
 */

import { MDEDevice, MDEConfig, MDEPostureSignal } from './types';
import { resolveEmission } from '../adapters/emit-gate';

export class MDEAdapter {
  private config: MDEConfig | null = null;

  async initialize(): Promise<void> {
    // Load config from store or environment
    this.config = await this.getConfig();
  }

  private async getConfig(): Promise<MDEConfig | null> {
    const tenantId = process.env.MDE_TENANT_ID;
    const clientId = process.env.MDE_CLIENT_ID;
    const clientSecret = process.env.MDE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      return null;
    }

    return {
      enabled: true,
      tenantId,
      clientId,
      clientSecret,
      cloud: 'public', // or 'gov', 'china'
    };
  }

  /**
   * May this adapter reach Microsoft Graph right now?
   *
   * BOTH conditions, not just the local one. Every outbound method in this class
   * already guards on `isEnabled()`, so this single point covers all five fetch sites
   * — the token fetch included.
   *
   * It used to return `config.enabled` alone. That is a value a tenant's own stored
   * configuration controls, not the deployment boundary: with it true, this adapter
   * reached graph.microsoft.com from dev and alpha with no SIGNALGRID_LIVE_INTEGRATIONS
   * check — the one connector outside the three-condition rule the security-review
   * package tells an assessor to verify first. The file even IMPORTED resolveEmission
   * and never called it, which is how the gap read as intentional for so long.
   *
   * `check-ungated-fetch.mjs` carried an EXEMPT entry describing exactly this, printed
   * on every run and explicitly labelled "an OPEN QUESTION, not a clearance". It was
   * disclosed, never hidden. Now it is closed, and the exemption is deleted.
   */
  isEnabled(): boolean {
    if (!(this.config?.enabled ?? false)) return false;
    return resolveEmission().mode === 'live';
  }

  private getGraphUrl(): string {
    const cloud = this.config?.cloud ?? 'public';
    const cloudMap: Record<string, string> = {
      public: 'https://graph.microsoft.com',
      gov: 'https://graph.microsoft.us',
      china: 'https://graph.chinacloudapi.cn',
    };
    return cloudMap[cloud] || cloudMap.public;
  }

  private async getAccessToken(): Promise<string> {
    // Reached only via isEnabled()-gated methods today — but "today" is a
    // circumstance, and a token fetch is a live call in its own right. The same
    // chokepoint holds here so a future direct caller cannot bypass it.
    if (!this.isEnabled()) {
      throw new Error('refused: token fetch with the fixture/live boundary closed.');
    }
    if (!this.config) {
      throw new Error('MDE not configured');
    }

    const tokenUrl = `${this.getGraphUrl()}/oauth2/v2.0/token`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        tenant_id: this.config.tenantId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get MDE access token: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /**
   * Get all managed devices from MDE
   */
  async getDevices(): Promise<MDEDevice[]> {
    if (!this.isEnabled()) {
      return [];
    }

    try {
      const token = await this.getAccessToken();
      const graphUrl = this.getGraphUrl();
      
      const response = await fetch(`${graphUrl}/v1.0/deviceManagement/managedDevices`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`MDE getDevices failed: ${response.status}`);
      }

      const data = await response.json() as { value: MDEDevice[] };
      return data.value;
    } catch (error) {
      // NOT swallowed. This used to log and `return []`, which turned an auth
      // failure, a 5xx, or malformed JSON into "this tenant has zero devices" — and
      // for a posture fabric a device that is not in the result reads as a device
      // with no problem. The throw above was decorative: it was caught two lines
      // later by its own handler.
      //
      // A read that failed is not a read that found nothing. Callers already handle
      // rejections from every sibling connector in this package.
      console.error('[MDE] Failed to get devices:', error);
      throw error;
    }
  }

  /**
   * Get a specific device by ID
   */
  async getDevice(deviceId: string): Promise<MDEDevice | null> {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      const token = await this.getAccessToken();
      const graphUrl = this.getGraphUrl();
      
      const response = await fetch(`${graphUrl}/v1.0/deviceManagement/managedDevices/${deviceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`MDE getDevice failed: ${response.status}`);
      }

      return response.json() as Promise<MDEDevice>;
    } catch (error) {
      // Rethrown: `null` here is the documented "no such device" answer (the 404
      // branch above returns it deliberately), so returning it on a FAILED lookup
      // made "we could not ask" indistinguishable from "it is not there".
      console.error('[MDE] Failed to get device:', error);
      throw error;
    }
  }

  /**
   * Get device compliance state
   */
  async getDeviceCompliance(deviceId: string): Promise<Record<string, unknown> | null> {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      const token = await this.getAccessToken();
      const graphUrl = this.getGraphUrl();
      
      const response = await fetch(
        `${graphUrl}/v1.0/deviceManagement/deviceCompliancePolicies/${deviceId}/deviceStatus`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 404) {
        return null;
      }

      return response.json() as Promise<Record<string, unknown>>;
    } catch (error) {
      // Rethrown, same reason: a failed compliance read must not be reported as an
      // absent compliance record.
      console.error('[MDE] Failed to get device compliance:', error);
      throw error;
    }
  }

  /**
   * Get full posture signal for a device
   */
  async getPostureForDevice(deviceId: string): Promise<MDEPostureSignal | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const device = await this.getDevice(deviceId);
    if (!device) {
      return null;
    }

    const compliance = await this.getDeviceCompliance(deviceId);

    const signal: MDEPostureSignal = {
      deviceId: device.id,
      hostname: device.deviceName,
      compliant: device.complianceState === 'compliant',
      lastCheckAt: new Date().toISOString(),
      osVersion: device.osVersion,
      platform: device.operatingSystem,
      securityBaselineStatus: device.securityBaselineComplianceState,
      threatDefenseStatus: device.threatAgentShielding,
      jailbroken: device.jailBroken === 'Yes',
      encryptionStatus: device.encryptionStatus,
    };

    return signal;
  }

  /**
   * Test connection to MDE
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isEnabled()) {
      return { success: false, message: 'MDE integration is disabled' };
    }

    try {
      await this.getAccessToken();
      return { success: true, message: 'Successfully connected to Microsoft Defender for Endpoint' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to connect to MDE: ${message}` };
    }
  }
}

// Singleton instance
let mdeAdapter: MDEAdapter | null = null;

export async function getMDEAdapter(): Promise<MDEAdapter> {
  if (!mdeAdapter) {
    mdeAdapter = new MDEAdapter();
    await mdeAdapter.initialize();
  }
  return mdeAdapter;
}
