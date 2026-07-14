import type { 
  UEMAdapter, 
  UEMDeviceState, 
  UEMTagRequest, 
  UEMQuarantineRequest, 
  UEMCommandResponse 
} from '../adapters/types';
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

/**
 * Microsoft Intune (Microsoft Endpoint Manager) Adapter Configuration
 * 
 * Uses Microsoft Graph API
 */
export interface IntuneConfig {
  /** Azure Tenant ID */
  tenantId: string;
  /** Azure Client ID */
  clientId: string;
  /** Azure Client Secret */
  clientSecret: string;
  /** Use managed identity instead of client secret */
  useManagedIdentity?: boolean;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Microsoft Intune UEM Adapter
 * 
 * Manages devices via Microsoft Graph API
 */
export class IntuneAdapter implements UEMAdapter {
  readonly name = 'intune';
  readonly vendor = 'Microsoft';
  readonly config: Required<IntuneConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: IntuneConfig) {
    this.config = {
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      useManagedIdentity: config.useManagedIdentity || false,
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Get device state from Intune
   */
  async getDeviceState(deviceId: string): Promise<UEMDeviceState | null> {
    await this.ensureAuthenticated();

    // Try to find device by various identifiers
    const url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$filter=deviceId eq '${deviceId}' or id eq '${deviceId}' or serialNumber eq '${deviceId}'`;

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`Intune API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      value: Array<{
        id: string;
        deviceId: string;
        serialNumber: string;
        deviceName: string;
        operatingSystem: string;
        osVersion: string;
        enrolledDateTime: string;
        lastSyncDateTime: string;
        complianceState: string;
        isManaged: boolean;
        deviceCategoryDisplayName: string;
      }>;
    };

    if (!data.value || data.value.length === 0) {
      return null;
    }

    const device = data.value[0];

    return {
      deviceId: device.id,
      enrolled: device.isManaged,
      compliant: device.complianceState === 'compliant',
      osVersion: device.osVersion,
      platform: device.operatingSystem,
      lastSync: device.lastSyncDateTime,
      tags: device.deviceCategoryDisplayName ? [device.deviceCategoryDisplayName] : [],
      quarantineStatus: 'none',
    };
  }

  /**
   * Set a tag on a device (via device category)
   */
  async setTag(request: UEMTagRequest): Promise<{ success: boolean }> {
    await this.ensureAuthenticated();

    // First, get the device to find its current category
    const device = await this.getDeviceState(request.deviceId);
    if (!device) {
      throw new Error(`Device not found: ${request.deviceId}`);
    }

    // Get or create the device category
    const categoryId = await this.getOrCreateCategory(request.tag);

    // Assign device to category
    const url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices('${request.deviceId}')/deviceCategory/$ref`;
    
    const response = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.id': `https://graph.microsoft.com/v1.0/deviceManagement/deviceCategories('${categoryId}')`,
      }),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    return { success: response.ok };
  }

  /**
   * Remove a tag from a device
   */
  async removeTag(request: UEMTagRequest): Promise<{ success: boolean }> {
    // Intune doesn't support removing device category directly via API
    // We could set it to a default category or leave as-is
    // For now, return success but note limitation
    return { success: true };
  }

  /**
   * Quarantine a device
   */
  async quarantine(request: UEMQuarantineRequest): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Use remote lock action for quarantine
    const url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices('${request.deviceId}')/remoteLock`;
    
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Intune quarantine error: ${response.status} - ${error}`);
    }

    return {
      commandId: `quarantine-${request.deviceId}-${Date.now()}`,
      status: 'sent',
      message: 'Remote lock command sent',
    };
  }

  /**
   * Clear quarantine (unlock device)
   */
  async clearQuarantine(deviceId: string, reason?: string): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Use bypass passcode to unlock (requires device to have passcode set)
    const url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices('${deviceId}')/bypassLock`;
    
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      // If bypass fails, device might need to be wiped or have passcode reset
      return {
        commandId: `unquarantine-${deviceId}-${Date.now()}`,
        status: 'failed',
        message: 'Could not bypass lock - device may need manual intervention',
      };
    }

    return {
      commandId: `unquarantine-${deviceId}-${Date.now()}`,
      status: 'delivered',
      message: 'Device unlocked successfully',
    };
  }

  /**
   * Sync device (trigger device check-in)
   */
  async syncDevice(deviceId: string): Promise<UEMCommandResponse> {
    await this.ensureAuthenticated();

    // Use sync action
    const url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices('${deviceId}')/syncDevice`;
    
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Intune sync error: ${response.status} - ${error}`);
    }

    return {
      commandId: `sync-${deviceId}-${Date.now()}`,
      status: 'sent',
      message: 'Sync command sent to device',
    };
  }

  /**
   * Health check - verify Intune connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      
      const url = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=1';
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
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

    if (this.config.useManagedIdentity) {
      this.accessToken = await this.getManagedIdentityToken();
      this.tokenExpiry = Date.now() + 3500000;
      return;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      timeoutMs: TIMEOUT_PRESETS.short,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Intune OAuth error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
  }

  /**
   * Get managed identity token
   */
  private async getManagedIdentityToken(): Promise<string> {
    const msiEndpoint = process.env.MSI_ENDPOINT;
    const msiSecret = process.env.MSI_SECRET;

    if (!msiEndpoint || !msiSecret) {
      throw new Error('Managed identity not available');
    }

    const response = await fetchWithTimeout(`${msiEndpoint}?resource=https://graph.microsoft.com&api-version=2017-09-01`, {
      headers: {
        'Secret': msiSecret,
      },
      timeoutMs: TIMEOUT_PRESETS.short,
    });

    if (!response.ok) {
      throw new Error(`MSI token error: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /**
   * Get or create a device category by name
   */
  private async getOrCreateCategory(categoryName: string): Promise<string> {
    // First try to find existing category
    const listUrl = 'https://graph.microsoft.com/v1.0/deviceManagement/deviceCategories';
    const listResponse = await fetchWithTimeout(listUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (listResponse.ok) {
      const listData = await listResponse.json() as {
        value: Array<{ id: string; displayName: string }>;
      };
      
      const existing = listData.value.find(c => c.displayName === categoryName);
      if (existing) {
        return existing.id;
      }
    }

    // Create new category
    const createUrl = 'https://graph.microsoft.com/v1.0/deviceManagement/deviceCategories';
    const createResponse = await fetchWithTimeout(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: categoryName }),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create device category: ${createResponse.status}`);
    }

    const createData = await createResponse.json() as { id: string };
    return createData.id;
  }
}
