import type { 
  UEMAdapter, 
  UEMDeviceState, 
  UEMTagRequest, 
  UEMQuarantineRequest, 
  UEMCommandResponse 
} from '../adapters/types';
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

/**
 * Jamf Pro (formerly Casper Suite) Adapter Configuration
 * 
 * Uses the Jamf Pro REST API
 */
export interface JamfConfig {
  /** Jamf Pro instance URL (e.g., https://yourcompany.jamfcloud.com) */
  instanceUrl: string;
  /** Jamf Pro username */
  username: string;
  /** Jamf Pro password or API token */
  password: string;
  /** Use API token instead of password */
  useApiToken?: boolean;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Jamf Pro UEM Adapter
 * 
 * Manages Apple devices via Jamf Pro REST API
 */
export class JamfAdapter implements UEMAdapter {
  readonly name = 'jamf';
  readonly vendor = 'Jamf';
  readonly config: Required<JamfConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: JamfConfig) {
    this.config = {
      instanceUrl: config.instanceUrl.replace(/\/$/, ''),
      username: config.username,
      password: config.password,
      useApiToken: config.useApiToken || false,
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Get device state from Jamf Pro
   */
  async getDeviceState(deviceId: string): Promise<UEMDeviceState | null> {
    await this.ensureAuthenticated();

    // Try to find device by ID, serial number, or UDID
    let url = `${this.config.instanceUrl}/JSSResource/machines/id/${deviceId}`;
    let response = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (response.status === 404) {
      // Try by serial number
      url = `${this.config.instanceUrl}/JSSResource/machines/serialnumber/${deviceId}`;
      response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });
    }

    if (response.status === 404) {
      // Try by UDID
      url = `${this.config.instanceUrl}/JSSResource/machines/udid/${deviceId}`;
      response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });
    }

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`Jamf API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      machine: {
        id: number;
        udid: string;
        serial_number: string;
        computer_name: string;
        platform: string;
        os_version: string;
        last_contact_time: string;
        report_date: string;
        enrolled: boolean;
        management_status: {
          managed: boolean;
          mdm_capable: boolean;
        };
        extension_attributes?: Array<{
          name: string;
          value: string;
        }>;
      };
    };

    const machine = data.machine;

    return {
      deviceId: String(machine.id),
      enrolled: machine.enrolled || machine.management_status.managed,
      compliant: true, // Jamf uses compliance items, would need separate check
      osVersion: machine.os_version,
      platform: machine.platform,
      lastSync: machine.last_contact_time || machine.report_date,
      tags: machine.extension_attributes
        ?.filter(ea => ea.name.includes('Group') || ea.name.includes('Tag'))
        .map(ea => ea.value) || [],
      quarantineStatus: 'none',
    };
  }

  /**
   * Set a tag on a device (via extension attribute or smart group)
   */
  async setTag(request: UEMTagRequest): Promise<{ success: boolean }> {
    await this.ensureAuthenticated();

    // Use computer group membership to "tag" device
    // Add device to a static group
    const url = `${this.config.instanceUrl}/JSSResource/computergroups/name/${encodeURIComponent(request.tag)}`;

    // First check if group exists
    const groupResponse = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (groupResponse.ok) {
      const groupData = await groupResponse.json() as {
        computer_group: {
          id: number;
          device_ids?: number[];
        };
      };

      // Add device to group (if not already member)
      const deviceId = parseInt(request.deviceId, 10);
      if (!groupData.computer_group.device_ids?.includes(deviceId)) {
        const addUrl = `${this.config.instanceUrl}/JSSResource/computergroups/id/${groupData.computer_group.id}`;
        
        const updateResponse = await fetch(addUrl, {
          method: 'PUT',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/xml',
          },
          body: this.buildGroupUpdateXML(deviceId, true),
        });

        return { success: updateResponse.ok };
      }
    }

    return { success: true };
  }

  /**
   * Remove a tag from a device
   */
  async removeTag(request: UEMTagRequest): Promise<{ success: boolean }> {
    await this.ensureAuthenticated();

    // Remove device from computer group
    const url = `${this.config.instanceUrl}/JSSResource/computergroups/name/${encodeURIComponent(request.tag)}`;

    const groupResponse = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!groupResponse.ok) {
      return { success: true }; // Group doesn't exist
    }

    const groupData = await groupResponse.json() as {
      computer_group: {
        id: number;
        device_ids?: number[];
      };
    };

    const deviceId = parseInt(request.deviceId, 10);
    if (groupData.computer_group.device_ids?.includes(deviceId)) {
      const removeUrl = `${this.config.instanceUrl}/JSSResource/computergroups/id/${groupData.computer_group.id}`;
      
      const updateResponse = await fetch(removeUrl, {
        method: 'PUT',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/xml',
        },
        body: this.buildGroupUpdateXML(deviceId, false),
      });

      return { success: updateResponse.ok };
    }

    return { success: true };
  }

  /**
   * Quarantine a device (lock or wipe)
   */
  async quarantine(request: UEMQuarantineRequest): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Use Jamf remote commands - lock device
    const url = `${this.config.instanceUrl}/JSSResource/computercommands/command/LockDevice/id/${request.deviceId}`;

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jamf quarantine error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { command_uuid: string };

    return {
      commandId: data.command_uuid,
      status: 'sent',
      message: 'Device lock command sent',
    };
  }

  /**
   * Clear quarantine (unlock device)
   */
  async clearQuarantine(deviceId: string, reason?: string): Promise<UEMCommandResponse> {
    // Jamf doesn't have a direct "unlock" - the device must be unlocked with PIN
    // We can send a "Disable Lost Mode" if in lost mode, or just return success
    return {
      commandId: `unquarantine-${deviceId}-${Date.now()}`,
      status: 'failed',
      message: 'Jamf does not support remote unlock - device must be unlocked with PIN',
    };
  }

  /**
   * Sync device (trigger inventory update)
   */
  async syncDevice(deviceId: string): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Send "Update Inventory" command
    const url = `${this.config.instanceUrl}/JSSResource/computercommandscommand/InventoryCollection/id/${deviceId}`;

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jamf sync error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { command_uuid: string };

    return {
      commandId: data.command_uuid,
      status: 'sent',
      message: 'Inventory update command sent',
    };
  }

  /**
   * Health check - verify Jamf connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      
      const url = `${this.config.instanceUrl}/JSSResource/machines`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
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

    // For Jamf Cloud, we use basic auth or API token
    if (this.config.useApiToken) {
      // API token doesn't expire - just use it
      this.accessToken = this.config.password;
      this.tokenExpiry = Date.now() + 86400000; // 24 hours
      return;
    }

    // Get OAuth token using password
    const tokenUrl = `${this.config.instanceUrl}/api/v1/auth/token`;
    
    const response = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        'Accept': 'application/json',
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jamf auth error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { token: string; expires: string };
    
    this.accessToken = data.token;
    this.tokenExpiry = new Date(data.expires).getTime() - 60000;
  }

  /**
   * Get authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    if (this.config.useApiToken) {
      return {
        'Authorization': `Bearer ${this.config.password}`,
        'Accept': 'application/json',
      };
    }

    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
    };
  }

  /**
   * Build XML for updating computer group membership
   */
  private buildGroupUpdateXML(deviceId: number, add: boolean): string {
    return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<computer_group>
  <device_ids>
    ${add ? `<device_id>${deviceId}</device_id>` : ''}
  </device_ids>
</computer_group>`;
  }
}
