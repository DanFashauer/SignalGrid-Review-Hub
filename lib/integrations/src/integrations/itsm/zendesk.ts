import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';

/**
 * Zendesk ITSM Adapter Configuration
 * 
 * Uses the Zendesk Support API
 */
export interface ZendeskConfig {
  /** Zendesk instance URL (e.g., https://yourcompany.zendesk.com) */
  instanceUrl: string;
  /** Zendesk email for authentication */
  email: string;
  /** Zendesk API token */
  apiToken: string;
  /** Default ticket subject prefix */
  subjectPrefix?: string;
  /** Default ticket priority */
  defaultPriority?: 'urgent' | 'high' | 'normal' | 'low';
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Zendesk ITSM Adapter
 * 
 * Creates tickets in Zendesk via REST API
 */
export class ZendeskAdapter implements ITSMAdapter {
  readonly name = 'zendesk';
  readonly vendor = 'Zendesk';
  readonly config: Required<ZendeskConfig>;

  constructor(config: ZendeskConfig) {
    this.config = {
      instanceUrl: config.instanceUrl.replace(/\/$/, ''),
      email: config.email,
      apiToken: config.apiToken,
      subjectPrefix: config.subjectPrefix || '[Enterprise Shell]',
      defaultPriority: config.defaultPriority || 'normal',
      timeout: config.timeout || 30000,
    };
  }

  /** The credential this adapter holds, named so the gate's refusal names it back.
   *  Passed at every resolveEmission() site in this class — see adapters/emit-gate.ts. */
  private emissionCredential(): EmissionCredential {
    return { name: 'Zendesk apiToken', value: this.config.apiToken };
  }

  /**
   * Create a new ticket in Zendesk
   */
  async createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
    // GATED like healthCheck() above: this method reaches the network, and the
    // fixture/live boundary either covers every outbound path or it is not a
    // boundary. Nothing constructs this adapter in fixture mode today; the gate
    // makes that a property instead of a circumstance.
    {
      const emission = resolveEmission(process.env, this.emissionCredential());
      if (emission.mode !== "live") {
        throw new Error("refused: outbound call with the fixture/live boundary closed (mode is not live).");
      }
    }
    const ticket = this.buildTicketPayload(request);
    
    const url = `${this.config.instanceUrl}/api/v2/tickets.json`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeout),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.config.email}/token:${this.config.apiToken}`).toString('base64')}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ ticket }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zendesk API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      ticket: {
        id: number;
        subject: string;
        status: string;
        created_at: string;
        url: string;
      };
    };

    return {
      ticketId: String(data.ticket.id),
      ticketUrl: `${this.config.instanceUrl}/agent/tickets/${data.ticket.id}`,
      status: data.ticket.status,
      createdAt: data.ticket.created_at,
    };
  }

  /**
   * Health check - verify Zendesk connectivity
   */
  async healthCheck(): Promise<boolean> {
    // GATED, like every other outbound path. A health check is still a LIVE CALL:
    // it resolves a configured hostname and opens a connection from wherever the
    // process runs. Ungated, it reached the network in dev/alpha with no credential
    // — outside the three-condition boundary the security-review package tells an
    // assessor to verify FIRST. Found by review taking that document at its word.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode !== "live") return false;

    try {
      const url = `${this.config.instanceUrl}/api/v2/tickets.json?page=1&per_page=1`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeout),
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.email}/token:${this.config.apiToken}`).toString('base64')}`,
          'Accept': 'application/json',
        },
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Map severity to Zendesk priority
   */
  private mapPriority(severity: string): string {
    const priorityMap: Record<string, string> = {
      critical: 'urgent',
      high: 'high',
      medium: 'normal',
      low: 'low',
      informational: 'low',
    };
    return priorityMap[severity] || this.config.defaultPriority;
  }

  /**
   * Map category to Zendesk tags
   */
  private mapTags(category: string): string[] {
    const tags = [category];
    
    // Map common categories to more specific tags
    const categoryTagMap: Record<string, string> = {
      access_issue: 'access-issue',
      authentication_failure: 'authentication-failure',
      device_quarantine: 'device-quarantine',
      location_violation: 'location-violation',
      policy_violation: 'policy-violation',
      security_incident: 'security-incident',
      session_anomaly: 'session-anomaly',
      hardware_issue: 'hardware-issue',
      software_issue: 'software-issue',
      network_issue: 'network-issue',
    };
    
    if (categoryTagMap[category]) {
      tags.push(categoryTagMap[category]);
    }
    
    return tags;
  }

  /**
   * Build ticket payload from request
   */
  private buildTicketPayload(request: ITSMTicketRequest): Record<string, unknown> {
    const ticket: Record<string, unknown> = {
      subject: `${this.config.subjectPrefix} ${request.title}`,
      description: this.buildDescription(request),
      priority: this.mapPriority(request.severity),
      tags: this.mapTags(request.category),
    };

    // Add requester
    if (request.userEmail) {
      ticket.requester = { email: request.userEmail };
    }

    // Add custom fields for correlation
    const customFields: Array<{ id: number; value: string }> = [];
    
    // Note: In production, you'd need to look up the actual custom field IDs
    // from your Zendesk instance. These are example IDs.
    if (request.correlationId) {
      customFields.push({ id: 360012345678, value: request.correlationId });
    }
    if (request.deviceId) {
      customFields.push({ id: 360012345679, value: request.deviceId });
    }
    if (request.devicePlatform) {
      customFields.push({ id: 360012345680, value: request.devicePlatform });
    }

    if (customFields.length > 0) {
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
