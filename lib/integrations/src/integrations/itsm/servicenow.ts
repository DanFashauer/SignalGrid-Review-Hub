import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

/**
 * ServiceNow Adapter Configuration
 */
export interface ServiceNowConfig {
  /** ServiceNow instance URL (e.g., https://instance.service-now.com) */
  instanceUrl: string;
  /** Authentication type */
  auth: {
    type: 'oauth' | 'basic' | 'api_token';
    // OAuth
    clientId?: string;
    clientSecret?: string;
    // Basic/API Token
    username?: string;
    password?: string;
    apiToken?: string;
  };
  /** Table to create incidents in (default: incident) */
  table?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * ServiceNow ITSM Adapter
 * 
 * Creates incidents in ServiceNow via REST API
 */
export class ServiceNowAdapter implements ITSMAdapter {
  readonly name = 'servicenow';
  readonly vendor = 'ServiceNow';
  readonly config: ServiceNowConfig;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: ServiceNowConfig) {
    this.config = {
      table: 'incident',
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Create a new incident in ServiceNow
   */
  async createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
    await this.ensureAuthenticated();

    const incident = this.buildIncidentPayload(request);
    const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}`;

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(incident),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ServiceNow API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      result: {
        sys_id: string;
        number: string;
        state: string;
        sys_created_on: string;
      };
    };

    const ticketId = data.result.sys_id;
    const ticketNumber = data.result.number;

    return {
      ticketId: ticketNumber,
      ticketUrl: `${this.config.instanceUrl}/nav_to.do?uri=incident.do?sys_id=${ticketId}`,
      status: this.mapState(data.result.state),
      createdAt: new Date(data.result.sys_created_on).toISOString(),
    };
  }

  /**
   * Update an existing incident
   */
  async updateTicket(ticketId: string, updates: Partial<ITSMTicketRequest>): Promise<ITSMTicketResponse> {
    await this.ensureAuthenticated();

    // First, get the sys_id from the ticket number
    const sysId = await this.getSysIdByNumber(ticketId);
    if (!sysId) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}/${sysId}`;
    const incident = this.buildIncidentPayload(updates as ITSMTicketRequest);

    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(incident),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ServiceNow API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      result: {
        sys_id: string;
        number: string;
        state: string;
        sys_updated_on: string;
      };
    };

    return {
      ticketId: data.result.number,
      ticketUrl: `${this.config.instanceUrl}/nav_to.do?uri=incident.do?sys_id=${data.result.sys_id}`,
      status: this.mapState(data.result.state),
      createdAt: new Date(data.result.sys_updated_on).toISOString(),
    };
  }

  /**
   * Health check - verify connectivity and authentication
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      
      const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}?sysparm_limit=1`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
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

    if (this.config.auth.type === 'oauth') {
      await this.authenticateOAuth();
    } else {
      // For basic/auth, we don't need to authenticate separately
      // The credentials are sent with each request
      this.accessToken = btoa(`${this.config.auth.username}:${this.config.auth.password || this.config.auth.apiToken || ''}`);
      this.tokenExpiry = Date.now() + 3600000; // 1 hour
    }
  }

  /**
   * Authenticate using OAuth client credentials
   */
  private async authenticateOAuth(): Promise<void> {
    const tokenUrl = `${this.config.instanceUrl}/oauth_token.do`;
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.auth.clientId || '',
      client_secret: this.config.auth.clientSecret || '',
    });

    const response = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ServiceNow OAuth error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 minute buffer
  }

  /**
   * Get sys_id from ticket number
   */
  private async getSysIdByNumber(ticketNumber: string): Promise<string | null> {
    const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}?sysparm_query=number=${ticketNumber}&sysparm_fields=sys_id`;

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
      timeoutMs: TIMEOUT_PRESETS.normal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      result: Array<{ sys_id: string }>;
    };

    return data.result[0]?.sys_id || null;
  }

  /**
   * Map severity to ServiceNow impact/urgency values
   */
  private mapSeverity(severity: string): { impact: number; urgency: number } {
    const severityMap: Record<string, { impact: number; urgency: number }> = {
      critical: { impact: 1, urgency: 1 },
      high: { impact: 2, urgency: 2 },
      medium: { impact: 2, urgency: 3 },
      low: { impact: 3, urgency: 3 },
      informational: { impact: 3, urgency: 3 },
    };
    return severityMap[severity] || { impact: 2, urgency: 3 };
  }

  /**
   * Map category to ServiceNow category/subcategory
   */
  private mapCategory(category: string): { category: string; subcategory: string } {
    const categoryMap: Record<string, { category: string; subcategory: string }> = {
      access_issue: { category: 'Access', subcategory: 'Password' },
      authentication_failure: { category: 'Authentication', subcategory: 'Login' },
      device_quarantine: { category: 'Software', subcategory: 'Security' },
      location_violation: { category: 'Physical', subcategory: 'Location' },
      policy_violation: { category: 'Software', subcategory: 'Policy' },
      security_incident: { category: 'Security', subcategory: 'Incident' },
      session_anomaly: { category: 'Software', subcategory: 'Session' },
      hardware_issue: { category: 'Hardware', subcategory: 'Other' },
      software_issue: { category: 'Software', subcategory: 'Other' },
      network_issue: { category: 'Network', subcategory: 'Connectivity' },
      other: { category: 'Software', subcategory: 'Other' },
    };
    return categoryMap[category] || { category: 'Software', subcategory: 'Other' };
  }

  /**
   * Build incident payload from request
   */
  private buildIncidentPayload(request: ITSMTicketRequest): Record<string, unknown> {
    const severity = this.mapSeverity(request.severity);
    const category = this.mapCategory(request.category);

    const incident: Record<string, unknown> = {
      short_description: request.title,
      description: request.description,
      impact: severity.impact,
      urgency: severity.urgency,
      category: category.category,
      subcategory: category.subcategory,
      source: request.source,
      correlation_id: request.correlationId,
    };

    // Add caller info if available
    if (request.userEmail) {
      // Note: In production, you'd map email to ServiceNow user sys_id
      // This is a simplified version
      incident.description += `\n\nUser Email: ${request.userEmail}`;
    }

    // Add device info if available
    if (request.deviceId) {
      incident.description += `\nDevice ID: ${request.deviceId}`;
      incident.cmdb_ci = request.deviceId; // Would need to map to CI sys_id
    }

    return incident;
  }

  /**
   * Map ServiceNow state to status string
   */
  private mapState(state: string): string {
    const stateMap: Record<string, string> = {
      '1': 'New',
      '2': 'In Progress',
      '3': 'On Hold',
      '4': 'Awaiting User Info',
      '5': 'Awaiting Vendor',
      '6': 'Resolved',
      '7': 'Closed',
    };
    return stateMap[state] || `State ${state}`;
  }
}
