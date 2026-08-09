import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { resolveEmission } from '../adapters/emit-gate';

/**
 * Freshservice ITSM Adapter Configuration
 * 
 * Uses the Freshservice REST API
 */
export interface FreshserviceConfig {
  /** Freshservice instance URL (e.g., https://yourcompany.freshservice.com) */
  instanceUrl: string;
  /** Freshservice API key */
  apiKey: string;
  /** Default requester ID (optional) */
  defaultRequesterId?: string;
  /** Default ticket type: Incident (1) or Service Request (2) */
  ticketType?: number;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Freshservice ITSM Adapter
 * 
 * Creates tickets in Freshservice via REST API
 */
export class FreshserviceAdapter implements ITSMAdapter {
  readonly name = 'freshservice';
  readonly vendor = 'Freshworks';
  readonly config: Required<FreshserviceConfig>;

  constructor(config: FreshserviceConfig) {
    this.config = {
      instanceUrl: config.instanceUrl.replace(/\/$/, ''),
      apiKey: config.apiKey,
      defaultRequesterId: config.defaultRequesterId || '',
      ticketType: config.ticketType || 1, // Default to Incident
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Create a new ticket in Freshservice
   */
  async createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
    const ticket = this.buildTicketPayload(request);
    
    const url = `${this.config.instanceUrl}/api/v2/tickets`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.config.apiKey}:X`).toString('base64')}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(ticket),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Freshservice API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      ticket: {
        id: number;
        display_id: string;
        status: number;
        created_at: string;
      };
    };

    return {
      ticketId: String(data.ticket.display_id),
      ticketUrl: `${this.config.instanceUrl}/a/tickets/${data.ticket.id}`,
      status: this.mapStatus(data.ticket.status),
      createdAt: data.ticket.created_at,
    };
  }

  /**
   * Health check - verify Freshservice connectivity
   */
  async healthCheck(): Promise<boolean> {
    // GATED, like every other outbound path. A health check is still a LIVE CALL:
    // it resolves a configured hostname and opens a connection from wherever the
    // process runs. Ungated, it reached the network in dev/alpha with no credential
    // — outside the three-condition boundary the security-review package tells an
    // assessor to verify FIRST. Found by review taking that document at its word.
    const emission = resolveEmission();
    if (emission.mode !== "live") return false;

    try {
      const url = `${this.config.instanceUrl}/api/v2/tickets?page=1&per_page=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.apiKey}:X`).toString('base64')}`,
          'Accept': 'application/json',
        },
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Map severity to Freshservice priority
   */
  private mapPriority(severity: string): number {
    const priorityMap: Record<string, number> = {
      critical: 4,    // Urgent
      high: 3,        // High
      medium: 2,      // Medium
      low: 1,         // Low
      informational: 1,
    };
    return priorityMap[severity] || 2;
  }

  /**
   * Map severity to Freshservice urgency
   */
  private mapUrgency(severity: string): number {
    const urgencyMap: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      informational: 1,
    };
    return urgencyMap[severity] || 2;
  }

  /**
   * Map Freshservice status to string
   */
  private mapStatus(status: number): string {
    const statusMap: Record<number, string> = {
      2: 'Open',
      3: 'Pending',
      4: 'Resolved',
      5: 'Closed',
      6: 'On Hold',
    };
    return statusMap[status] || `Status ${status}`;
  }

  /**
   * Build ticket payload from request
   */
  private buildTicketPayload(request: ITSMTicketRequest): Record<string, unknown> {
    const ticket: Record<string, unknown> = {
      subject: request.title,
      description: this.buildDescription(request),
      priority: this.mapPriority(request.severity),
      urgency: this.mapUrgency(request.severity),
      status: 2, // Open
      ticket_type: this.config.ticketType,
      source: 2, // API
    };

    // Add category as tags
    const tags = [request.category];
    if (request.source) {
      tags.push(request.source);
    }
    ticket.tags = tags;

    // Add requester
    if (request.userEmail) {
      ticket.requester_email = request.userEmail;
    } else if (this.config.defaultRequesterId) {
      ticket.requester_id = parseInt(this.config.defaultRequesterId, 10);
    }

    // Add custom fields
    const customFields: Record<string, unknown> = {};
    
    if (request.correlationId) {
      customFields.correlation_id = request.correlationId;
    }
    if (request.deviceId) {
      customFields.device_id = request.deviceId;
    }
    if (request.deviceName) {
      customFields.device_name = request.deviceName;
    }
    if (request.devicePlatform) {
      customFields.device_platform = request.devicePlatform;
    }

    if (Object.keys(customFields).length > 0) {
      ticket.custom_fields = customFields;
    }

    return ticket;
  }

  /**
   * Build description from request
   */
  private buildDescription(request: ITSMTicketRequest): string {
    const lines: string[] = [];

    lines.push(`**Category:** ${request.category}`);
    lines.push(`**Severity:** ${request.severity}`);
    lines.push(`**Source:** ${request.source || 'Enterprise Shell'}`);
    
    if (request.correlationId) {
      lines.push(`**Correlation ID:** ${request.correlationId}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(request.description);

    if (request.userId || request.userEmail || request.userName) {
      lines.push('');
      lines.push('---');
      lines.push('**User Information**');
      if (request.userName) lines.push(`- Name: ${request.userName}`);
      if (request.userEmail) lines.push(`- Email: ${request.userEmail}`);
      if (request.userId) lines.push(`- User ID: ${request.userId}`);
    }

    if (request.deviceId || request.devicePlatform || request.deviceName) {
      lines.push('');
      lines.push('---');
      lines.push('**Device Information**');
      if (request.deviceId) lines.push(`- Device ID: ${request.deviceId}`);
      if (request.deviceName) lines.push(`- Hostname: ${request.deviceName}`);
      if (request.devicePlatform) lines.push(`- Platform: ${request.devicePlatform}`);
    }

    if (request.links) {
      lines.push('');
      lines.push('---');
      lines.push('**Related Links**');
      if (request.links.dashboard) lines.push(`- Dashboard: ${request.links.dashboard}`);
      if (request.links.auditLog) lines.push(`- Audit Log: ${request.links.auditLog}`);
      if (request.links.device) lines.push(`- Device: ${request.links.device}`);
      if (request.links.session) lines.push(`- Session: ${request.links.session}`);
    }

    return lines.join('\n');
  }
}
