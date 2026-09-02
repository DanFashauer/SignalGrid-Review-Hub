import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { TIMEOUT_PRESETS } from '../../utils/timeoutPresets';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';
import { isRedirectStatus, redirectRefusal } from '../adapters/redirect';
import { asNonEmptyString, asPositiveNumber, asVendorInstant } from '../adapters/vendor-values';

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
 * A ServiceNow `sys_id`, VALIDATED against the vendor's own shape.
 *
 * THE SHAPE, documented rather than assumed: a ServiceNow `sys_id` is a GUID with
 * the hyphens removed — exactly 32 hexadecimal characters
 * (`6816f79cc0a8016401c5a33be04be441`). Nothing else is one.
 *
 * WHY IT IS CHECKED. `getSysIdByNumber` returned `data.result[0]?.sys_id` straight
 * out of the vendor's JSON and `updateTicket` interpolated it into a REST path
 * unencoded. Measured on this tree: a vendor response whose `sys_id` was
 * `../../../../api/now/table/sys_user/<id>` produced a PATCH whose path NORMALISED
 * — `fetch` resolves `..` segments before the request leaves — to
 * `/api/now/table/sys_user/<id>`. The adapter believed it was updating an incident
 * and wrote to the user table. A compromised or merely buggy vendor response chose
 * which table SignalGrid wrote to.
 *
 * ENCODING ALONE WOULD NOT HAVE BEEN ENOUGH to make the value meaningful, and
 * validation alone would not survive a shape change, so this file does BOTH: the
 * value must be a sys_id, and it is percent-encoded at the interpolation site.
 */
const SERVICENOW_SYS_ID = /^[0-9a-f]{32}$/i;

/** Thrown when a vendor id will not pass {@link SERVICENOW_SYS_ID}. Exported so a
 *  proof can assert the REASON rather than merely that something failed. */
export class ServiceNowSysIdInvalid extends Error {
  constructor(readonly where: string, received: unknown) {
    super(
      `ServiceNow sys_id from ${where} is not 32 hexadecimal characters ` +
        `(received ${typeof received === 'string' ? `a ${received.length}-character string` : `a ${typeof received}`})`,
    );
    this.name = 'ServiceNowSysIdInvalid';
  }
}

export function asServiceNowSysId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !SERVICENOW_SYS_ID.test(value)) {
    throw new ServiceNowSysIdInvalid(where, value);
  }
  return value;
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
    // `timeout: 30000` sat here as a literal with `...config` spread AFTER it, so a
    // caller-supplied timeout did survive — and then nothing read the field at all.
    // The request paths below now read it; healthCheck keeps the SHORT preset on
    // purpose (a reachability probe that waits as long as a ticket write is not a
    // probe), which is why that one site is not `this.config.timeout`.
    this.config = {
      table: 'incident',
      timeout: 30000,
      ...config,
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
    // Derived from the auth union rather than hand-picked: whichever secret this
    // adapter would authenticate WITH is the one whose absence must refuse. An auth
    // type with no rule here is refused rather than silently cleared.
    switch (this.config.auth.type) {
      case 'oauth':
        return { name: 'ServiceNow auth.clientSecret', value: this.config.auth.clientSecret };
      case 'basic':
        return { name: 'ServiceNow auth.password', value: this.config.auth.password };
      case 'api_token':
        return { name: 'ServiceNow auth.apiToken', value: this.config.auth.apiToken };
      default:
        return { name: `ServiceNow auth.type "${String(this.config.auth.type)}" declares no credential rule`, value: undefined };
    }
  }

  /**
   * Create a new incident in ServiceNow
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
    const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(incident),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
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

    const ticketId = asServiceNowSysId(data.result.sys_id, 'the create response');
    const ticketNumber = data.result.number;

    return {
      ticketId: ticketNumber,
      // ENCODED, like every other interpolated segment in this file. The value is
      // validated above as well; encoding is what stops a shape change from becoming
      // a query-parameter injection in the link an operator clicks.
      ticketUrl: `${this.config.instanceUrl}/nav_to.do?uri=incident.do?sys_id=${encodeURIComponent(ticketId)}`,
      status: this.mapState(data.result.state),
      // NAMED, not a bare RangeError. `new Date(undefined).toISOString()` throws
      // `Invalid time value` from inside the adapter and says nothing about which
      // vendor field was absent. See ../adapters/vendor-values.ts.
      createdAt: asVendorInstant(data.result.sys_created_on, 'result.sys_created_on'),
    };
  }

  /**
   * Update an existing incident
   */
  async updateTicket(ticketId: string, updates: Partial<ITSMTicketRequest>): Promise<ITSMTicketResponse> {
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

    // First, get the sys_id from the ticket number
    const sysId = await this.getSysIdByNumber(ticketId);
    if (!sysId) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    // ENCODED. `sysId` came off the vendor's wire; `getSysIdByNumber` now validates
    // its shape, and this encodes it, so neither a `..` segment nor a `?` can change
    // which resource this PATCH addresses. `this.config.table` is operator
    // configuration rather than vendor data and is interpolated as configured.
    const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}/${encodeURIComponent(sysId)}`;
    const incident = this.buildIncidentPayload(updates as ITSMTicketRequest);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(incident),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
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
      ticketUrl: `${this.config.instanceUrl}/nav_to.do?uri=incident.do?sys_id=${encodeURIComponent(
        asServiceNowSysId(data.result.sys_id, 'the update response'),
      )}`,
      status: this.mapState(data.result.state),
      createdAt: asVendorInstant(data.result.sys_updated_on, 'result.sys_updated_on'),
    };
  }

  /**
   * Health check - verify connectivity and authentication
   */
  async healthCheck(): Promise<boolean> {
    // GATED, like every other outbound path. A health check is still a LIVE CALL: it
    // resolves a configured hostname and opens a connection from wherever the process
    // runs. Note the gate goes BEFORE ensureAuthenticated() — that helper performs its
    // own OAuth token fetch, so gating after it would still have reached the network.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode !== "live") return false;

    try {
      await this.ensureAuthenticated();

      const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}?sysparm_limit=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_PRESETS.short),
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
      // For basic/auth, we don't need to authenticate separately
      // The credentials are sent with each request
      this.accessToken = btoa(`${this.config.auth.username}:${this.config.auth.password || this.config.auth.apiToken || ''}`);
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
    const tokenUrl = `${this.config.instanceUrl}/oauth_token.do`;
    
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
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
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
      throw new Error(`ServiceNow OAuth error: ${response.status} - ${error}`);
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
   * Get sys_id from ticket number
   */
  private async getSysIdByNumber(ticketNumber: string): Promise<string | null> {
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
    // ENCODED. `ticketNumber` is the CALLER's string and was interpolated raw into a
    // query, so a value containing `&` or `^` rewrote the ServiceNow encoded query
    // this URL is built from.
    const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}?sysparm_query=number=${encodeURIComponent(
      ticketNumber,
    )}&sysparm_fields=sys_id`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
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
      return null;
    }

    const data = await response.json() as {
      result?: Array<{ sys_id?: unknown }>;
    };

    // NOT FOUND stays null — an empty result set is a legitimate answer and the
    // caller already turns it into `Ticket not found`. A PRESENT id of the wrong
    // shape is different in kind and throws by name: it means the vendor sent
    // something this adapter must not put in a URL.
    const first = Array.isArray(data.result) ? data.result[0] : undefined;
    if (first === undefined || first.sys_id === undefined || first.sys_id === null) return null;
    return asServiceNowSysId(first.sys_id, 'the number→sys_id lookup');
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
