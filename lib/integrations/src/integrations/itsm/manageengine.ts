import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';

/**
 * ManageEngine ServiceDesk Plus / ServiceNow Plus Adapter Configuration
 * 
 * Uses the ServiceDesk Plus REST API
 */
export interface ManageEngineConfig {
  /** ServiceDesk Plus instance URL (e.g., https://yourcompany:8080) */
  instanceUrl: string;
  /** Technician key for authentication */
  technicianKey: string;
  /** Default site ID (optional) */
  siteId?: string;
  /** Default impact (1-5, where 1 is highest) */
  defaultImpact?: number;
  /** Default urgency (1-5, where 1 is highest) */
  defaultUrgency?: number;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * ManageEngine ServiceDesk Plus ITSM Adapter
 * 
 * Creates requests in ServiceDesk Plus via REST API
 */
export class ManageEngineAdapter implements ITSMAdapter {
  readonly name = 'manageengine';
  readonly vendor = 'ManageEngine';
  readonly config: Required<ManageEngineConfig>;

  constructor(config: ManageEngineConfig) {
    this.config = {
      instanceUrl: config.instanceUrl.replace(/\/$/, ''),
      technicianKey: config.technicianKey,
      siteId: config.siteId || '',
      defaultImpact: config.defaultImpact || 3,
      defaultUrgency: config.defaultUrgency || 3,
      timeout: config.timeout || 30000,
    };
  }

  /** The credential this adapter holds, named so the gate's refusal names it back.
   *  Passed at every resolveEmission() site in this class — see adapters/emit-gate.ts. */
  private emissionCredential(): EmissionCredential {
    return { name: 'ManageEngine technicianKey', value: this.config.technicianKey };
  }

  /**
   * Create a new request in ServiceDesk Plus
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
    const workOrder = this.buildWorkOrderPayload(request);
    
    const url = `${this.config.instanceUrl}/api/v3/requests`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `TechnicianKey ${this.config.technicianKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(workOrder),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ServiceDesk Plus API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      request: {
        id: number;
        request_id: string;
        status: {
          name: string;
        };
        created_time: number;
      };
    };

    return {
      ticketId: String(data.request.request_id),
      ticketUrl: `${this.config.instanceUrl}/workOrderDetails.do?requestId=${data.request.id}`,
      status: data.request.status.name,
      createdAt: new Date(data.request.created_time).toISOString(),
    };
  }

  /**
   * Health check - verify ServiceDesk Plus connectivity
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
      const url = `${this.config.instanceUrl}/api/v3/requests?page=1&page_size=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `TechnicianKey ${this.config.technicianKey}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Map severity to impact/urgency (1=highest, 5=lowest)
   */
  private mapSeverity(severity: string): { impact: number; urgency: number; priority: number } {
    const severityMap: Record<string, { impact: number; urgency: number; priority: number }> = {
      critical: { impact: 1, urgency: 1, priority: 1 },
      high: { impact: 2, urgency: 2, priority: 2 },
      medium: { impact: 3, urgency: 3, priority: 3 },
      low: { impact: 4, urgency: 4, priority: 4 },
      informational: { impact: 5, urgency: 5, priority: 5 },
    };
    return severityMap[severity] || { 
      impact: this.config.defaultImpact, 
      urgency: this.config.defaultUrgency, 
      priority: 3 
    };
  }

  /**
   * Build request payload from request
   */
  private buildWorkOrderPayload(request: ITSMTicketRequest): Record<string, unknown> {
    const severity = this.mapSeverity(request.severity);

    const workOrder: Record<string, unknown> = {
      subject: request.title,
      description: this.buildDescription(request),
      impact: severity.impact,
      urgency: severity.urgency,
      priority: severity.priority,
      requestType: {
        name: 'Incident',
      },
    };

    // Add category
    if (request.category) {
      workOrder.category = request.category;
    }

    // Add site
    if (this.config.siteId) {
      workOrder.site = { id: this.config.siteId };
    }

    // Add requester
    if (request.userEmail) {
      workOrder.requester = { email: request.userEmail };
    } else if (request.userId) {
      workOrder.requester = { user_id: request.userId };
    }

    // Add affected resource (device)
    if (request.deviceId) {
      workOrder.affected_resource = { device_id: request.deviceId };
    }

    // Add tags/custom fields
    const customFields: Record<string, string> = {};
    if (request.correlationId) {
      customFields.correlation_id = request.correlationId;
    }
    if (request.source) {
      customFields.source = request.source;
    }

    if (Object.keys(customFields).length > 0) {
      workOrder.custom_fields = customFields;
    }

    return workOrder;
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
