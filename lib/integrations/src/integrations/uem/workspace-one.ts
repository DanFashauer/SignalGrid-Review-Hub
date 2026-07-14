import type { 
  UEMAdapter, 
  UEMDeviceState, 
  UEMTagRequest, 
  UEMQuarantineRequest, 
  UEMCommandResponse 
} from '../adapters/types';
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

/**
 * Omnissa Workspace ONE UEM (formerly VMware Workspace ONE UEM) Adapter Configuration
 * 
 * Uses the Workspace ONE UEM REST API
 */
export interface WorkspaceONEConfig {
  /** Workspace ONE UEM API base URL */
  baseUrl: string;
  /** API Client ID */
  clientId: string;
  /** API Client Secret */
  clientSecret: string;
  /** Tenant ID (API Key) */
  tenantId: string;
  /** Group ID (organization group) */
  groupId?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Workspace ONE UEM Adapter
 * 
 * Manages devices via Workspace ONE UEM REST API
 */
export class WorkspaceONEAdapter implements UEMAdapter {
  readonly name = 'workspace_one';
  readonly vendor = 'Omnissa';
  readonly config: Required<WorkspaceONEConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: WorkspaceONEConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tenantId: config.tenantId,
      groupId: config.groupId || '',
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Get device state from Workspace ONE
   */
  async getDeviceState(deviceId: string): Promise<UEMDeviceState | null> {
    await this.ensureAuthenticated();

    // Search by device UUID or serial number
    const url = `${this.config.baseUrl}/api/v1/mdm/devices?searchBy=${deviceId}&id=${deviceId}`;

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
        'Accept': 'application/json',
        'aw-tenant-identifier': this.config.tenantId,
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`Workspace ONE API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      Devices?: Array<{
        DeviceUUID: string;
        SerialNumber: string;
        DeviceName: string;
        Platform: string;
        OSVersion: string;
        LastSeen: string;
        EnrollmentStatus: string;
        ComplianceStatus: string;
        DeviceGroups?: Array<{ Name: string }>;
      }>;
    };

    if (!data.Devices || data.Devices.length === 0) {
      return null;
    }

    const device = data.Devices[0];

    return {
      deviceId: device.DeviceUUID,
      enrolled: device.EnrollmentStatus === 'Enrolled',
      compliant: device.ComplianceStatus === 'Compliant',
      osVersion: device.OSVersion,
      platform: device.Platform,
      lastSync: device.LastSeen,
      tags: device.DeviceGroups?.map(g => g.Name) || [],
      quarantineStatus: 'none',
    };
  }

  /**
   * Set a tag on a device (via smart group or custom attribute)
   */
  async setTag(request: UEMTagRequest): Promise<{ success: boolean }> {
    await this.ensureAuthenticated();

    // Use custom attribute to set tag
    const url = `${this.config.baseUrl}/api/v1/mdm/devices/${request.deviceId}/customattribute`;

    const attribute = {
      name: 'EnterpriseShellTag',
      value: request.tag,
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
        'Content-Type': 'application/json',
        'aw-tenant-identifier': this.config.tenantId,
      },
      body: JSON.stringify(attribute),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    return { success: response.ok };
  }

  /**
   * Remove a tag from a device
   */
  async removeTag(request: UEMTagRequest): Promise<{ success: boolean }> {
    await this.ensureAuthenticated();

    // Delete custom attribute
    const url = `${this.config.baseUrl}/api/v1/mdm/devices/${request.deviceId}/customattribute/EnterpriseShellTag`;

    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
        'aw-tenant-identifier': this.config.tenantId,
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    return { success: response.ok || response.status === 404 };
  }

  /**
   * Quarantine a device
   */
  async quarantine(request: UEMQuarantineRequest): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Use device commands API to quarantine
    const url = `${this.config.baseUrl}/api/v1/mdm/devices/${request.deviceId}/commands`;

    const command = {
      commandType: 'DEVICE_LOCK',
      commandId: 'quarantine',
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
        'Content-Type': 'application/json',
        'aw-tenant-identifier': this.config.tenantId,
      },
      body: JSON.stringify(command),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Workspace ONE quarantine error: ${response.status} - ${error}`);
    }

    return {
      commandId: `quarantine-${request.deviceId}-${Date.now()}`,
      status: 'sent',
      message: 'Device lock command sent',
    };
  }

  /**
   * Clear quarantine (unlock device)
   */
  async clearQuarantine(deviceId: string, reason?: string): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Send unlock command
    const url = `${this.config.baseUrl}/api/v1/mdm/devices/${deviceId}/commands`;

    const command = {
      commandType: 'UNLOCK',
      commandId: 'unquarantine',
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
        'Content-Type': 'application/json',
        'aw-tenant-identifier': this.config.tenantId,
      },
      body: JSON.stringify(command),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      return {
        commandId: `unquarantine-${deviceId}-${Date.now()}`,
        status: 'failed',
        message: 'Failed to send unlock command',
      };
    }

    return {
      commandId: `unquarantine-${deviceId}-${Date.now()}`,
      status: 'sent',
      message: 'Unlock command sent',
    };
  }

  /**
   * Sync device (trigger check-in)
   */
  async syncDevice(deviceId: string): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Send ping command to trigger check-in
    const url = `${this.config.baseUrl}/api/v1/mdm/devices/${deviceId}/commands`;

    const command = {
      commandType: 'PING',
      commandId: 'sync',
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
        'Content-Type': 'application/json',
        'aw-tenant-identifier': this.config.tenantId,
      },
      body: JSON.stringify(command),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Workspace ONE sync error: ${response.status} - ${error}`);
    }

    return {
      commandId: `sync-${deviceId}-${Date.now()}`,
      status: 'sent',
      message: 'Ping command sent to device',
    };
  }

  /**
   * Health check - verify Workspace ONE connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      
      const url = `${this.config.baseUrl}/api/v1/mdm/devices?page=1&pageSize=1`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.tenantId}:${this.accessToken}`,
          'aw-tenant-identifier': this.config.tenantId,
        },
        timeoutMs: TIMEOUT_PRESETS.short,
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

    const tokenUrl = `${this.config.baseUrl}/api/v1/oauth/token`;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'aw-tenant-identifier': this.config.tenantId,
      },
      body: params.toString(),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Workspace ONE OAuth error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
  }
}
