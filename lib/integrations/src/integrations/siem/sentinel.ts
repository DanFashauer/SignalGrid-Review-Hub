import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';

/**
 * Microsoft Sentinel (Azure Log Analytics) Adapter Configuration
 */
export interface SentinelConfig {
  /** Azure Log Analytics Workspace ID */
  workspaceId: string;
  /** Azure Log Analytics Primary Key (or managed identity token) */
  primaryKey?: string;
  /** Azure Tenant ID (for managed identity) */
  tenantId?: string;
  /** Azure Client ID (for managed identity) */
  clientId?: string;
  /** Azure Client Secret (for managed identity) */
  clientSecret?: string;
  /** Custom Log Table name (without _CL suffix) */
  tableName?: string;
  /** Use managed identity instead of primary key */
  useManagedIdentity?: boolean;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Microsoft Sentinel SIEM Adapter
 * 
 * Sends security events to Azure Log Analytics / Microsoft Sentinel
 * via the Data Collection API
 */
export class SentinelAdapter implements SIEMAdapter {
  readonly name = 'sentinel';
  readonly vendor = 'Microsoft';
  readonly config: Required<SentinelConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: SentinelConfig) {
    this.config = {
      workspaceId: config.workspaceId || '',
      primaryKey: config.primaryKey || '',
      tenantId: config.tenantId || '',
      clientId: config.clientId || '',
      clientSecret: config.clientSecret || '',
      tableName: config.tableName || 'EnterpriseShellEvents',
      useManagedIdentity: config.useManagedIdentity || false,
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Send a single event to Sentinel
   */
  async sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse> {
    const payload = this.buildEventPayload(event);
    
    // For Sentinel, we need to get an access token
    const token = await this.getAccessToken();
    
    const url = `https://${this.config.workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2023-01-01`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Log-Type': `${this.config.tableName}_CL`,
        'x-ms-date': new Date().toUTCString(),
      },
      body: JSON.stringify([payload]),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sentinel API error: ${response.status} - ${error}`);
    }

    return {
      eventId: `${event.type}-${event.timestamp}`,
      status: 'sent',
      receivedAt: new Date().toISOString(),
    };
  }

  /**
   * Send multiple events (batch)
   */
  async sendEvents(events: SIEMEventRequest[]): Promise<SIEMEventResponse[]> {
    if (events.length === 0) {
      return [];
    }

    // Build batch payload
    const payloads = events.map(e => this.buildEventPayload(e));
    
    const token = await this.getAccessToken();
    const url = `https://${this.config.workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2023-01-01`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Log-Type': `${this.config.tableName}_CL`,
        'x-ms-date': new Date().toUTCString(),
      },
      body: JSON.stringify(payloads),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sentinel API error: ${response.status} - ${error}`);
    }

    return events.map(e => ({
      eventId: `${e.type}-${e.timestamp}`,
      status: 'sent',
      receivedAt: new Date().toISOString(),
    }));
  }

  /**
   * Health check - verify Sentinel connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      
      const url = `https://${this.config.workspaceId}.ods.opinsights.azure.com/api/health`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      return response.ok || response.status === 401; // 401 is OK - means we can authenticate
    } catch {
      return false;
    }
  }

  /**
   * Get Azure access token
   */
  private async getAccessToken(): Promise<string> {
    // Check cached token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Use managed identity
    if (this.config.useManagedIdentity) {
      const token = await this.getManagedIdentityToken();
      this.accessToken = token;
      this.tokenExpiry = Date.now() + 3500000; // ~1 hour
      return token;
    }

    // Use client credentials
    if (this.config.tenantId && this.config.clientId && this.config.clientSecret) {
      const token = await this.getClientCredentialsToken();
      this.accessToken = token;
      this.tokenExpiry = Date.now() + 3500000; // ~1 hour
      return token;
    }

    // Fall back to primary key (for workspace keys)
    if (this.config.primaryKey) {
      return this.config.primaryKey;
    }

    throw new Error('No authentication method configured for Sentinel');
  }

  /**
   * Get token using managed identity
   */
  private async getManagedIdentityToken(): Promise<string> {
    const msiEndpoint = process.env.MSI_ENDPOINT;
    const msiSecret = process.env.MSI_SECRET;

    if (!msiEndpoint || !msiSecret) {
      throw new Error('Managed identity not available');
    }

    const response = await fetch(`${msiEndpoint}?resource=https://management.azure.com&api-version=2017-09-01`, {
      headers: {
        'Secret': msiSecret,
      },
    });

    if (!response.ok) {
      throw new Error(`MSI token error: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /**
   * Get token using client credentials
   */
  private async getClientCredentialsToken(): Promise<string> {
    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId || '',
      client_secret: this.config.clientSecret || '',
      scope: 'https://management.azure.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`OAuth token error: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /**
   * Build Sentinel event payload (Custom Log format)
   */
  private buildEventPayload(event: SIEMEventRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      // Required TimeGenerated (Sentinel will use ingestion time if not provided)
      TimeGenerated: event.timestamp,
      
      // Event type
      EventType: event.type,
      Severity: event.severity,
      
      // Correlation IDs
      CaseId: event.caseId,
      RequestId: event.requestId,
      CorrelationId: event.correlationId,
    };

    // Add actor info
    if (event.actor) {
      payload.ActorUserId = event.actor.userId;
      payload.ActorBadgeUid = event.actor.badgeUid;
      payload.ActorEmail = event.actor.email;
      payload.ActorName = event.actor.name;
    }

    // Add device info
    if (event.device) {
      payload.DeviceId = event.device.deviceId;
      payload.DevicePlatform = event.device.platform;
      payload.DeviceIp = event.device.ip;
      payload.DeviceMac = event.device.mac;
      payload.DeviceTags = event.device.tags?.join(',');
    }

    // Add session info
    if (event.session) {
      payload.SessionId = event.session.sessionId;
      payload.SessionStartedAt = event.session.startedAt;
      payload.SessionEndedAt = event.session.endedAt;
      payload.SessionDuration = event.session.duration;
    }

    // Add location info
    if (event.location) {
      payload.LocationZone = event.location.zone;
      payload.LocationBuilding = event.location.building;
      payload.LocationFloor = event.location.floor;
      if (event.location.coordinates) {
        payload.LocationLat = event.location.coordinates.lat;
        payload.LocationLng = event.location.coordinates.lng;
      }
    }

    // Add evidence
    if (event.evidence && event.evidence.length > 0) {
      payload.Evidence = JSON.stringify(event.evidence);
    }

    // Add custom fields
    if (event.customFields) {
      for (const [key, value] of Object.entries(event.customFields)) {
        payload[key] = value;
      }
    }

    return payload;
  }
}
