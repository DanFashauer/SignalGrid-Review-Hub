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
import { resolveEmission, EMIT_SUPPRESSED } from '../adapters/emit-gate';

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

  isEnabled(): boolean {
    return this.config?.enabled ?? false;
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
      console.error('[MDE] Failed to get devices:', error);
      return [];
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
      console.error('[MDE] Failed to get device:', error);
      return null;
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
      console.error('[MDE] Failed to get device compliance:', error);
      return null;
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
