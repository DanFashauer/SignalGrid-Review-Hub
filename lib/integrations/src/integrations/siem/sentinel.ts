import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';
import { resolveEmission, EMIT_SUPPRESSED, type EmissionCredential } from '../adapters/emit-gate';
import { isRedirectStatus, redirectRefusal } from '../adapters/redirect';
import { asNonEmptyString } from '../adapters/vendor-values';

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
    // Mirrors getAccessToken()'s own branch order, so the credential named here is the
    // one that authentication would actually use. Managed identity's secret is the MSI
    // endpoint's, read from the environment exactly where getManagedIdentityToken()
    // requires it.
    if (this.config.useManagedIdentity) {
      return { name: 'Sentinel managed-identity secret (MSI_SECRET)', value: process.env.MSI_SECRET };
    }
    if (this.config.tenantId && this.config.clientId) {
      return { name: 'Sentinel clientSecret', value: this.config.clientSecret };
    }
    return { name: 'Sentinel primaryKey (workspace key)', value: this.config.primaryKey };
  }

  /**
   * Send a single event to Sentinel
   */
  async sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse> {
    // Gate first: dev/alpha never emit outbound. See ../adapters/emit-gate.ts.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode === 'suppressed') {
      return {
        eventId: `suppressed-${Date.now()}`,
        status: EMIT_SUPPRESSED,
        // The reason, carried onto the response. `SIEMEventResponse.reason` is
        // documented as present on every non-'sent' status the adapter decided, and it
        // was set on none of the suppressed branches: a caller saw status 'suppressed'
        // with nothing saying whether the tier, the flag or a missing credential
        // withheld it — the same "nothing was sent" / "nothing to send" ambiguity the
        // gate's own refusal text exists to remove.
        reason: emission.reason,
        receivedAt: new Date().toISOString(),
      };
    }

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

    // Gate first, exactly as sendEvent() above does. This method did NOT, and it was
    // the only sendEvents in the repo that failed to — splunk.ts gates both the single
    // and the batch path. So the singular call was suppressed in dev/alpha while the
    // batch call, carrying MORE data, fetched an Azure AD token and POSTed to the
    // customer's Log Analytics workspace with none of the three conditions checked.
    //
    // Suppressing per event rather than returning [] keeps the caller's contract: it
    // asked about N events and gets N answers, each honestly labelled as not sent.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode === 'suppressed') {
      return events.map((event) => ({
        eventId: `suppressed-${event.type}-${event.timestamp}`,
        status: EMIT_SUPPRESSED,
        // Per event, from the one resolution above: N answers, each carrying WHY.
        reason: emission.reason,
        receivedAt: new Date().toISOString(),
      }));
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
    // GATED. A health check is still a live call — see check-ungated-fetch.mjs.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode !== "live") return false;

    try {
      const token = await this.getAccessToken();
      
      const url = `https://${this.config.workspaceId}.ods.opinsights.azure.com/api/health`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.config.timeout),
        // Never followed — see ../adapters/redirect.ts. The default `follow` handed the
        // second hop to whatever the vendor's `Location` header named, unvalidated.
        redirect: 'manual',
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
    // freshness: local-by-design — not the sighting-freshness rule — an OAuth token EXPIRY, which runs the opposite direction: `tokenExpiry` is a locally minted forward instant (`Date.now() + expires_in * 1000`, initialised to 0), never a parsed sighting, so nothing here needs a skew tolerance. A false comparison — including against a NaN expiry — re-fetches the token, which is the closed direction; that is the guard, not a gate.
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
    const msiEndpoint = process.env.MSI_ENDPOINT;
    const msiSecret = process.env.MSI_SECRET;

    if (!msiEndpoint || !msiSecret) {
      throw new Error('Managed identity not available');
    }

    const response = await fetch(`${msiEndpoint}?resource=https://management.azure.com&api-version=2017-09-01`, {
      headers: {
        'Secret': msiSecret,
      },
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
      throw new Error(`MSI token error: ${response.status}`);
    }

    // CHECKED, NOT CAST. A 200 whose body carries no `access_token` used to return
    // `undefined` from this method and interpolate as `Bearer undefined` on the next
    // request; an empty string returned a bare `Bearer `. The reader throws naming the
    // vendor's own field, so the caller's refusal says which field was missing.
    const data = await response.json() as Record<string, unknown>;
    return asNonEmptyString(data.access_token, 'access_token');
  }

  /**
   * Get token using client credentials
   */
  private async getClientCredentialsToken(): Promise<string> {
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
      throw new Error(`OAuth token error: ${response.status}`);
    }

    // CHECKED, NOT CAST. A 200 whose body carries no `access_token` used to return
    // `undefined` from this method and interpolate as `Bearer undefined` on the next
    // request; an empty string returned a bare `Bearer `. The reader throws naming the
    // vendor's own field, so the caller's refusal says which field was missing.
    const data = await response.json() as Record<string, unknown>;
    return asNonEmptyString(data.access_token, 'access_token');
  }

  /**
   * Build Sentinel event payload (Custom Log format).
   *
   * WRITE ORDER IS THE SECURITY PROPERTY HERE, and it was the wrong way round.
   *
   * Sentinel's Custom Log format is FLAT, so this family is the only one that
   * MERGES the caller's `customFields` into the payload's top level instead of
   * carrying it under its own key. That merge used to be the LAST write before
   * `return`, which meant a caller key named `ActorEmail`, `TimeGenerated` or
   * `Evidence` silently OVERWROTE the column SignalGrid derived — a row in a
   * customer's SIEM asserting an actor, an instant or an evidence set that this
   * fabric never observed. Nothing stated the direction: the only ordering
   * sentence in the tree is `itsm/generic-webhook.ts`'s, and it documents the
   * OPPOSITE order for exactly this reason ("rawEvent is untrusted passthrough,
   * so it goes FIRST and the sanctioned fields overwrite it").
   *
   * So the two now agree. The open slot is written FIRST, and every sanctioned
   * column is written AFTER it — UNCONDITIONALLY, not inside an `if`, because a
   * column written only when the fabric has a value leaves the caller's key
   * standing whenever it does not. `undefined` is dropped by JSON.stringify, so
   * the wire body is unchanged for every honest caller; what changed is that a
   * caller can no longer occupy a sanctioned column.
   *
   * The typed sub-objects are named field by field for the same reason they are
   * everywhere else in this batch. Declared in ../adapters/payload-fields.ts.
   */
  private buildEventPayload(event: SIEMEventRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    // DECLARED OPEN SLOT, slot "*" — the caller's own Record<string, unknown>,
    // flattened because the Custom Log format has no nesting. FIRST, so that
    // everything below overwrites it rather than the other way round.
    if (event.customFields) {
      for (const [key, value] of Object.entries(event.customFields)) {
        payload[key] = value;
      }
    }

    // ── Sanctioned columns. Written after the open slot, so a sanctioned field
    //    always wins. Unconditional, so it wins even when the value is absent.
    payload.TimeGenerated = event.timestamp;
    payload.EventType = event.type;
    payload.Severity = event.severity;

    payload.CaseId = event.caseId;
    payload.RequestId = event.requestId;
    payload.CorrelationId = event.correlationId;

    payload.ActorUserId = event.actor?.userId;
    payload.ActorBadgeUid = event.actor?.badgeUid;
    payload.ActorEmail = event.actor?.email;
    payload.ActorName = event.actor?.name;

    payload.DeviceId = event.device?.deviceId;
    payload.DevicePlatform = event.device?.platform;
    payload.DeviceIp = event.device?.ip;
    payload.DeviceMac = event.device?.mac;
    payload.DeviceTags = event.device?.tags?.join(',');

    payload.SessionId = event.session?.sessionId;
    payload.SessionStartedAt = event.session?.startedAt;
    payload.SessionEndedAt = event.session?.endedAt;
    payload.SessionDuration = event.session?.duration;

    payload.LocationZone = event.location?.zone;
    payload.LocationBuilding = event.location?.building;
    payload.LocationFloor = event.location?.floor;
    payload.LocationLat = event.location?.coordinates?.lat;
    payload.LocationLng = event.location?.coordinates?.lng;

    // Evidence — the ELEMENT SHAPE is closed. This was
    // `JSON.stringify(event.evidence)`, the whole array by reference, so a field
    // added to the evidence element type upstream would have started crossing to a
    // customer's Sentinel workspace with no edit here. Named fields only; the one
    // map inside is a DECLARED OPEN SLOT (`data`, Record<string, unknown> on the
    // request type).
    payload.Evidence =
      event.evidence && event.evidence.length > 0
        ? JSON.stringify(event.evidence.map((e) => ({ type: e.type, timestamp: e.timestamp, data: e.data })))
        : undefined;

    return payload;
  }
}
