import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';
import { isRedirectStatus, redirectRefusal } from '../adapters/redirect';
import { asNonEmptyString, asPositiveNumber } from '../adapters/vendor-values';

/**
 * BMC Helix ITSM / BMC Helix Recovery / BMC Helix BusinessWorkflows Adapter Configuration
 * 
 * Uses the BMC Helix REST API
 */
export interface BMCHelixConfig {
  /** BMC Helix instance URL (e.g., https://myinstance.bmc.com) */
  instanceUrl: string;
  /** Authentication type */
  auth: {
    type: 'oauth' | 'basic' | 'api_token';
    // OAuth
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
    // Basic/API Token
    username?: string;
    password?: string;
    apiToken?: string;
  };
  /** Tenant ID (for multi-tenant deployments) */
  tenantId?: string;
  /** API version (default: v3) */
  apiVersion?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * BMC Helix ITSM Adapter
 * 
 * Creates incidents/requests in BMC Helix ITSM via REST API
 */
export class BMCHelixAdapter implements ITSMAdapter {
  readonly name = 'bmc_helix';
  readonly vendor = 'BMC Software';
  readonly config: Required<BMCHelixConfig>;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: BMCHelixConfig) {
    this.config = {
      instanceUrl: config.instanceUrl.replace(/\/$/, ''),
      auth: config.auth,
      tenantId: config.tenantId || '',
      apiVersion: config.apiVersion || 'v3',
      timeout: config.timeout || 30000,
    };
  }

  /**
   * The credential this adapter holds, named so the gate's refusal can name it back.
   *
   * Passed at EVERY resolveEmission() site in this class. The parameter was optional
   * until 2026-09-02 and every site here omitted it, so the third clause of the
   * boundary — tier AND live flag AND a credential — was not enforced on this path:
   * an adapter built with an empty secret reached the vendor with an empty auth
   * header. The gate cannot read this itself; the shape is per-vendor, so the caller
   * names what it holds.
   */
  private emissionCredential(): EmissionCredential {
    // Derived from the auth union, like servicenow.ts: the secret authentication would
    // actually use is the one whose absence refuses.
    switch (this.config.auth.type) {
      case 'oauth':
        return { name: 'BMC Helix auth.clientSecret', value: this.config.auth.clientSecret };
      case 'basic':
        return { name: 'BMC Helix auth.password', value: this.config.auth.password };
      case 'api_token':
        return { name: 'BMC Helix auth.apiToken', value: this.config.auth.apiToken };
      default:
        return { name: `BMC Helix auth.type "${String(this.config.auth.type)}" declares no credential rule`, value: undefined };
    }
  }

  /**
   * Create a new incident in BMC Helix ITSM
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
    const url = `${this.config.instanceUrl}/api/${this.config.apiVersion}/itsm/incidents`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
        'Tenant-Id': this.config.tenantId,
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
      throw new Error(`BMC Helix API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      incidentId: string;
      incidentNumber: string;
      status: string;
      createdDateTime: string;
    };

    return {
      ticketId: data.incidentNumber,
      // ENCODED. The id came off the vendor's wire and this link is what an operator
      // clicks; interpolated raw, a value containing `?`, `#` or `..` builds a link to
      // somewhere other than the ticket. Same rule as the request paths.
      ticketUrl: `${this.config.instanceUrl}/#incidents/${encodeURIComponent(data.incidentId)}`,
      status: data.status,
      createdAt: data.createdDateTime,
    };
  }

  /**
   * Health check - verify connectivity and authentication
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
      
      const url = `${this.config.instanceUrl}/api/${this.config.apiVersion}/itsm/incidents?pageSize=1`;
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
    // freshness: local-by-design — not the sighting-freshness rule — an OAuth token EXPIRY, which runs the opposite direction: `tokenExpiry` is a locally minted forward instant (`Date.now() + expires_in * 1000`, initialised to 0), never a parsed sighting, so nothing here needs a skew tolerance. A false comparison — including against a NaN expiry — re-fetches the token, which is the closed direction; that is the guard, not a gate.
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return;
    }

    if (this.config.auth.type === 'oauth') {
      await this.authenticateOAuth();
    } else {
      // For basic/auth, use the credentials as bearer token or basic auth
      if (this.config.auth.type === 'api_token') {
        this.accessToken = this.config.auth.apiToken || '';
      } else {
        this.accessToken = btoa(`${this.config.auth.username}:${this.config.auth.password || ''}`);
      }
      this.tokenExpiry = Date.now() + 3600000; // 1 hour
    }

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
   * Authenticate using OAuth client credentials
   */
  private async authenticateOAuth(): Promise<void> {
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
    const tokenUrl = this.config.auth.tokenUrl || `${this.config.instanceUrl}/api/v3/auth/oauth2/token`;
    
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.auth.clientId || '',
      client_secret: this.config.auth.clientSecret || '',
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
      throw new Error(`BMC Helix OAuth error: ${response.status} - ${error}`);
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
  }

  /**
   * Map severity to BMC Helix impact/urgency values
   */
  private mapSeverity(severity: string): { impact: number; urgency: number; priority: number } {
    const severityMap: Record<string, { impact: number; urgency: number; priority: number }> = {
      critical: { impact: 1, urgency: 1, priority: 1 },
      high: { impact: 2, urgency: 2, priority: 2 },
      medium: { impact: 2, urgency: 3, priority: 3 },
      low: { impact: 3, urgency: 3, priority: 4 },
      informational: { impact: 3, urgency: 3, priority: 5 },
    };
    return severityMap[severity] || { impact: 2, urgency: 3, priority: 3 };
  }

  /**
   * Map category to BMC Helix category/subcategory
   */
  private mapCategory(category: string): { category: string; subcategory: string } {
    const categoryMap: Record<string, { category: string; subcategory: string }> = {
      access_issue: { category: 'Access Management', subcategory: 'Password' },
      authentication_failure: { category: 'Authentication', subcategory: 'Login' },
      device_quarantine: { category: 'Security', subcategory: 'Quarantine' },
      location_violation: { category: 'Physical Security', subcategory: 'Location' },
      policy_violation: { category: 'Compliance', subcategory: 'Policy' },
      security_incident: { category: 'Security', subcategory: 'Incident' },
      session_anomaly: { category: 'Security', subcategory: 'Session' },
      hardware_issue: { category: 'Hardware', subcategory: 'Asset' },
      software_issue: { category: 'Software', subcategory: 'Installation' },
      network_issue: { category: 'Network', subcategory: 'Connectivity' },
      other: { category: 'General', subcategory: 'Other' },
    };
    return categoryMap[category] || { category: 'General', subcategory: 'Other' };
  }

  /**
   * Build incident payload from request
   */
  private buildIncidentPayload(request: ITSMTicketRequest): Record<string, unknown> {
    const severity = this.mapSeverity(request.severity);
    const category = this.mapCategory(request.category);

    const incident: Record<string, unknown> = {
      Summary: request.title,
      Description: request.description,
      Impact: severity.impact,
      Urgency: severity.urgency,
      Priority: severity.priority,
      Category: category.category,
      Subcategory: category.subcategory,
      Source: request.source || 'Enterprise Shell',
    };

    // Add correlation ID
    if (request.correlationId) {
      incident.CorrelationId = request.correlationId;
    }

    // Add requester info
    if (request.userEmail) {
      incident.RequesterEmail = request.userEmail;
    }
    if (request.userName) {
      incident.RequesterFullName = request.userName;
    }
    if (request.userId) {
      incident.RequesterId = request.userId;
    }

    // Add affected service/ci info
    if (request.deviceId) {
      incident.AffectedService = request.deviceId;
      incident.ConfigurationItem = request.deviceId;
    }

    // Links — NAMED FIELD BY FIELD, like every other typed sub-object in this
    // batch. This was `JSON.stringify(request.links)`: a closed typed object, so
    // it broke no rule the gate enforces, but it broke the RULE THE BATCH STATES
    // ("typed sub-objects are copied field by field, so an upstream addition never
    // crosses unchosen") — and `links` is exactly the kind of shape that grows a
    // fifth URL. Serialising it by reference would have carried that fifth URL to a
    // customer's ITSM the day it was added. The four fields are adapters/types.ts:22-27.
    if (request.links) {
      incident.Links = JSON.stringify({
        dashboard: request.links.dashboard,
        auditLog: request.links.auditLog,
        device: request.links.device,
        session: request.links.session,
      });
    }

    return incident;
  }
}
