import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';
import { isRedirectStatus, redirectRefusal } from '../adapters/redirect';
import { asNonEmptyString, asPositiveNumber } from '../adapters/vendor-values';

/**
 * Ivanti Neurons for ITSM / Ivanti Service Manager Adapter Configuration
 * 
 * Uses the Ivanti Neurons / ISM REST API
 */
export interface IvantiConfig {
  /** Ivanti Neurons / ISM instance URL (e.g., https://yourcompany.ivanti.com) */
  instanceUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** Tenant ID (for Ivanti Neurons) */
  tenantId?: string;
  /** Business Unit ID (optional) */
  businessUnitId?: string;
  /** Default template ID for incidents */
  templateId?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Ivanti Neurons ITSM Adapter
 * 
 * Creates incidents in Ivanti Neurons / ISM via REST API
 */
export class IvantiAdapter implements ITSMAdapter {
  readonly name = 'ivanti';
  readonly vendor = 'Ivanti';
  readonly config: Required<IvantiConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: IvantiConfig) {
    this.config = {
      instanceUrl: config.instanceUrl.replace(/\/$/, ''),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tenantId: config.tenantId || '',
      businessUnitId: config.businessUnitId || '',
      templateId: config.templateId || '',
      timeout: config.timeout || 30000,
    };
  }

  /** The credential this adapter holds, named so the gate's refusal names it back.
   *  Passed at every resolveEmission() site in this class — see adapters/emit-gate.ts. */
  private emissionCredential(): EmissionCredential {
    return { name: 'Ivanti clientSecret', value: this.config.clientSecret };
  }

  /**
   * Create a new incident in Ivanti
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
    await this.ensureAuthenticated();

    const incident = this.buildIncidentPayload(request);
    
    const url = `${this.config.instanceUrl}/api/v1/incidents`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
        'Tenant-Id': this.config.tenantId,
        'BusinessUnit-Id': this.config.businessUnitId,
      },
      body: JSON.stringify(incident),
      signal: AbortSignal.timeout(this.config.timeout),
      // Never followed — see ../adapters/redirect.ts. The default `follow` handed the
      // second hop to whatever the vendor's `Location` header named, unvalidated.
      redirect: 'manual',
    });

    // A 3xx IS A REFUSAL, NAMED — decided before any other status test so it can
    // never fall through to a generic "API error" or a retry. Permanent by
    // construction: no retry re-routes a configured host.
    if (isRedirectStatus(response.status)) {
      throw new Error(redirectRefusal(response.status, response.headers.get('location')));
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ivanti API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      id: string;
      uid: string;
      status: string;
      createdDateTime: string;
    };

    return {
      ticketId: data.uid,
      // ENCODED. The id came off the vendor's wire and this link is what an operator
      // clicks; interpolated raw, a value containing `?`, `#` or `..` builds a link to
      // somewhere other than the ticket. Same rule as the request paths.
      ticketUrl: `${this.config.instanceUrl}/Nav/${encodeURIComponent(data.id)}`,
      status: data.status,
      createdAt: data.createdDateTime,
    };
  }

  /**
   * Health check - verify Ivanti connectivity
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
      await this.ensureAuthenticated();
      
      const url = `${this.config.instanceUrl}/api/v1/incidents?$top=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
          'Tenant-Id': this.config.tenantId,
        },
        signal: AbortSignal.timeout(this.config.timeout),
        // Never followed — see ../adapters/redirect.ts. The default `follow` handed the
        // second hop to whatever the vendor's `Location` header named, unvalidated.
        redirect: 'manual',
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
    // freshness: local-by-design — not the sighting-freshness rule — an OAuth token EXPIRY, which runs the opposite direction: `tokenExpiry` is a locally minted forward instant (`Date.now() + expires_in * 1000`, initialised to 0), never a parsed sighting, so nothing here needs a skew tolerance. A false comparison — including against a NaN expiry — re-fetches the token, which is the closed direction; that is the guard, not a gate.
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return;
    }

    const tokenUrl = `${this.config.instanceUrl}/oauth2/token`;
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'enterprise',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(this.config.timeout),
      // Never followed — see ../adapters/redirect.ts. The default `follow` handed the
      // second hop to whatever the vendor's `Location` header named, unvalidated.
      redirect: 'manual',
    });

    // A 3xx IS A REFUSAL, NAMED — decided before any other status test so it can
    // never fall through to a generic "API error" or a retry. Permanent by
    // construction: no retry re-routes a configured host.
    if (isRedirectStatus(response.status)) {
      throw new Error(redirectRefusal(response.status, response.headers.get('location')));
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ivanti OAuth error: ${response.status} - ${error}`);
    }

    // CHECKED, NOT CAST. `await response.json() as { access_token: string }` asserted
    // a shape at COMPILE time and verified nothing at run time: a 200 whose body was
    // `{"ok":true}` produced `Bearer undefined` on the next request, and
    // `{"access_token":""}` produced a bare `Bearer ` — both inside the boundary the
    // security-review package tells an assessor is closed. The readers throw with the
    // vendor's own field name, so the refusal says which field was missing.
    const data = await response.json() as Record<string, unknown>;
    this.accessToken = asNonEmptyString(data.access_token, 'access_token');
    // The numeric twin. `Date.now() + (undefined * 1000)` is NaN, and `Date.now() <
    // NaN` is false forever — so every request re-ran the whole OAuth dance.
    this.tokenExpiry = Date.now() + (asPositiveNumber(data.expires_in, 'expires_in') * 1000) - 60000; // 1 minute buffer

    // GUARDED AFTER MINTING, not only at the vendor read. Whichever arm above ran,
    // the very next thing that happens to this value is `Bearer ${this.accessToken}`
    // in an outbound header, so the assertion belongs where the value is finished
    // rather than only where one of its sources is parsed.
    //
    // SAID EXACTLY: this catches absent, empty and whitespace. It does NOT catch a
    // structurally-empty basic credential — `btoa("user:")` is a non-empty string —
    // and claiming otherwise would be the overclaim this repository gates against.
    // That case is the emit gate's, which refuses when the named credential is empty.
    this.accessToken = asNonEmptyString(this.accessToken, 'accessToken (after authentication)');
  }

  /**
   * Map severity to Ivanti impact/urgency values
   */
  private mapSeverity(severity: string): { impact: number; urgency: number } {
    const severityMap: Record<string, { impact: number; urgency: number }> = {
      critical: { impact: 1, urgency: 1 },
      high: { impact: 2, urgency: 2 },
      medium: { impact: 3, urgency: 3 },
      low: { impact: 4, urgency: 4 },
      informational: { impact: 5, urgency: 5 },
    };
    return severityMap[severity] || { impact: 3, urgency: 3 };
  }

  /**
   * Build incident payload from request
   */
  private buildIncidentPayload(request: ITSMTicketRequest): Record<string, unknown> {
    const severity = this.mapSeverity(request.severity);

    const incident: Record<string, unknown> = {
      Subject: request.title,
      Description: this.buildDescription(request),
      Impact: severity.impact,
      Urgency: severity.urgency,
      Category: request.category,
      Source: request.source || 'Enterprise Shell',
    };

    // Add template if specified
    if (this.config.templateId) {
      incident.TemplateId = this.config.templateId;
    }

    // Add correlation ID
    if (request.correlationId) {
      incident.ExternalCorrelationId = request.correlationId;
    }

    // Add requester info
    if (request.userEmail) {
      incident.Email = request.userEmail;
    }
    if (request.userName) {
      incident.FullName = request.userName;
    }
    if (request.userId) {
      incident.EmployeeId = request.userId;
    }

    // Add affected CI (device)
    if (request.deviceId) {
      incident.AssetId = request.deviceId;
      incident.Asset = {
        SerialNumber: request.deviceId,
      };
    }

    return incident;
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
