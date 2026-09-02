import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { TIMEOUT_PRESETS } from '../../utils/timeoutPresets';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';

/**
 * Jira Service Management Adapter Configuration
 */
export interface JiraConfig {
  /** Jira instance URL (e.g., https://your-domain.atlassian.net) */
  baseUrl: string;
  /** Jira email for authentication */
  email: string;
  /** Jira API token */
  apiToken: string;
  /** Service Desk ID (for JSM) */
  serviceDeskId: string;
  /** Request type ID (for JSM) */
  requestTypeId?: string;
  /** Project key (for Jira Core) */
  projectKey?: string;
  /** Issue type (for Jira Core) - default: Bug */
  issueType?: string;
  /** Use JSM (true) or Jira Core (false) - default: true */
  useJSM?: boolean;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Jira Service Management ITSM Adapter
 * 
 * Creates requests in Jira Service Management via REST API
 */
export class JiraAdapter implements ITSMAdapter {
  readonly name = 'jira';
  readonly vendor = 'Atlassian';
  readonly config: Required<JiraConfig>;

  constructor(config: JiraConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      email: config.email,
      apiToken: config.apiToken,
      serviceDeskId: config.serviceDeskId,
      requestTypeId: config.requestTypeId || '',
      projectKey: config.projectKey || '',
      issueType: config.issueType || 'Bug',
      useJSM: config.useJSM !== false,
      // READ on every request path below. It was declared, defaulted, and read by
      // nothing — a configurable that configured nothing.
      timeout: config.timeout || 30000,
    };
  }

  /** The credential this adapter holds, named so the gate's refusal names it back.
   *  Passed at every resolveEmission() site in this class — see adapters/emit-gate.ts. */
  private emissionCredential(): EmissionCredential {
    return { name: 'Jira apiToken', value: this.config.apiToken };
  }

  /**
   * Create a new request in Jira
   */
  async createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
    if (this.config.useJSM) {
      return this.createJSMRequest(request);
    } else {
      return this.createJiraIssue(request);
    }
  }

  /**
   * Create JSM request
   */
  private async createJSMRequest(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
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
    const url = `${this.config.baseUrl}/rest/servicedesk/1/servicedesk/${this.config.serviceDeskId}/request`;

    const payload = {
      serviceDeskId: this.config.serviceDeskId,
      requestTypeId: this.config.requestTypeId,
      requestFieldValues: {
        summary: request.title,
        description: this.buildDescription(request),
        customField_10202: request.severity, // Example: Priority field
        customField_10203: request.category,  // Example: Category field
      },
      requester: {
        email: request.userEmail,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jira JSM API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      issueId: string;
      issueKey: string;
      _links: {
        web: string;
      };
    };

    return {
      ticketId: data.issueKey,
      ticketUrl: data._links.web,
      status: 'Open',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create Jira Core issue
   */
  private async createJiraIssue(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
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
    const url = `${this.config.baseUrl}/rest/api/3/issue`;

    const payload = {
      fields: {
        project: {
          key: this.config.projectKey,
        },
        summary: request.title,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: this.buildDescription(request),
                },
              ],
            },
          ],
        },
        issuetype: {
          name: this.config.issueType,
        },
        priority: {
          name: this.mapPriority(request.severity),
        },
        labels: [request.category, request.source],
      },
    };

    if (request.userEmail) {
      // Note: Would need to look up user accountId from email
      // This is a simplified version
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jira API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      id: string;
      key: string;
      fields: {
        created: string;
        status: {
          name: string;
        };
      };
    };

    return {
      ticketId: data.key,
      ticketUrl: `${this.config.baseUrl}/browse/${data.key}`,
      status: data.fields.status.name,
      createdAt: data.fields.created,
    };
  }

  /**
   * Health check - verify connectivity
   */
  async healthCheck(): Promise<boolean> {
    // GATED, like every other outbound path — see the note on ServiceNow's healthCheck.
    // `/rest/api/3/myself` looks like the most harmless call in the file and is still a
    // credentialed request to a customer's Atlassian tenant from wherever this runs.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode !== "live") return false;

    try {
      const url = `${this.config.baseUrl}/rest/api/3/myself`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_PRESETS.short),
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Map severity to Jira priority
   */
  private mapPriority(severity: string): string {
    const priorityMap: Record<string, string> = {
      critical: 'Highest',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      informational: 'Lowest',
    };
    return priorityMap[severity] || 'Medium';
  }

  /**
   * Build description from request
   */
  private buildDescription(request: ITSMTicketRequest): string {
    const lines: string[] = [];

    lines.push(`**Source:** ${request.source}`);
    lines.push(`**Category:** ${request.category}`);
    lines.push(`**Severity:** ${request.severity}`);
    
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

    if (request.rawEvent) {
      lines.push('');
      lines.push('---');
      lines.push('**Raw Event Data**');
      lines.push('```json');
      lines.push(JSON.stringify(request.rawEvent, null, 2));
      lines.push('```');
    }

    return lines.join('\n');
  }
}
