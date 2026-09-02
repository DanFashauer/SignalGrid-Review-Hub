import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';
import { resolveEmission, EMIT_SUPPRESSED, type EmissionCredential } from '../adapters/emit-gate';

/**
 * Splunk HEC (HTTP Event Collector) Adapter Configuration
 */
export interface SplunkConfig {
  /** Splunk HEC endpoint URL */
  hecUrl: string;
  /** HEC token */
  hecToken: string;
  /** Index to send events to */
  index?: string;
  /** Source field for events */
  source?: string;
  /** Source type for events */
  sourcetype?: string;
  /** Skip SSL certificate verification (dev only) */
  insecure?: boolean;
  /** Timeout for requests in ms */
  timeout?: number;
}

/**
 * Splunk SIEM Adapter
 * 
 * Sends security events to Splunk via HTTP Event Collector (HEC)
 */
export class SplunkAdapter implements SIEMAdapter {
  readonly name = 'splunk';
  readonly vendor = 'Splunk';
  readonly config: Required<SplunkConfig>;

  constructor(config: SplunkConfig) {
    this.config = {
      hecUrl: config.hecUrl.replace(/\/$/, ''),
      hecToken: config.hecToken,
      index: config.index || 'main',
      source: config.source || 'enterprise_shell',
      sourcetype: config.sourcetype || 'enterprise_shell:event',
      insecure: config.insecure || false,
      timeout: config.timeout || 30000,
    };
  }

  /** The credential this adapter holds, named so the gate's refusal names it back.
   *  Passed at every resolveEmission() site in this class — see adapters/emit-gate.ts. */
  private emissionCredential(): EmissionCredential {
    return { name: 'Splunk hecToken', value: this.config.hecToken };
  }

  /**
   * Send a single event to Splunk
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
    
    const response = await fetch(`${this.config.hecUrl}/services/collector`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Splunk ${this.config.hecToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Splunk HEC error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      code: number;
      text: string;
    };

    if (data.code !== 0) {
      throw new Error(`Splunk HEC error: ${data.text}`);
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
    const results: SIEMEventResponse[] = [];
    
    for (const event of events) {
      const result = await this.sendEvent(event);
      results.push(result);
    }

    return results;
  }

  /**
   * Health check - verify Splunk connectivity
   */
  async healthCheck(): Promise<boolean> {
    // GATED. A health check is still a live call — see check-ungated-fetch.mjs.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode !== "live") return false;

    try {
      // Try to get server info
      const url = new URL('/services/server/info', this.config.hecUrl);
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Splunk ${this.config.hecToken}`,
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Build HEC event payload — the CLOSED set of fields this adapter sends.
   *
   * The five sub-objects below were whole-object copies (`actor: event.actor`), so
   * anything ever added to `SIEMEventRequest.actor` / `.device` / `.session` /
   * `.location`, or to an evidence element, would have started reaching a
   * customer's Splunk index the day the type was widened — with no edit here and
   * no review. They are copied FIELD BY FIELD now; adding a field is a deliberate
   * act in this file.
   *
   * THE ONE OPEN SLOT is `customFields`, open BY DECLARATION: it is
   * `Record<string, unknown>` on the request type, the caller's own escape hatch.
   * `evidence[].data` is the second declared-open map, nested inside a closed
   * element shape. Both are named in ../adapters/payload-fields.ts and in
   * docs/DATA_RETENTION_AND_PERSONAL_DATA.md.
   */
  private buildEventPayload(event: SIEMEventRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      time: this.timestampToUnix(event.timestamp || new Date().toISOString()),
      host: event.device?.deviceId || 'unknown',
      index: this.config.index,
      source: this.config.source,
      sourcetype: this.config.sourcetype,
      event: {
        // Event metadata
        type: event.type,
        severity: event.severity,
        timestamp: event.timestamp || new Date().toISOString(),

        // Correlation IDs
        caseId: event.caseId,
        requestId: event.requestId,
        correlationId: event.correlationId,

        // Actor — named fields only
        actor: event.actor
          ? {
              userId: event.actor.userId,
              badgeUid: event.actor.badgeUid,
              email: event.actor.email,
              name: event.actor.name,
            }
          : undefined,

        // Device — named fields only
        device: event.device
          ? {
              deviceId: event.device.deviceId,
              platform: event.device.platform,
              ip: event.device.ip,
              mac: event.device.mac,
              tags: event.device.tags,
            }
          : undefined,

        // Session — named fields only
        session: event.session
          ? {
              sessionId: event.session.sessionId,
              startedAt: event.session.startedAt,
              endedAt: event.session.endedAt,
              duration: event.session.duration,
            }
          : undefined,

        // Location — named fields only
        location: event.location
          ? {
              zone: event.location.zone,
              building: event.location.building,
              floor: event.location.floor,
              coordinates: event.location.coordinates
                ? { lat: event.location.coordinates.lat, lng: event.location.coordinates.lng }
                : undefined,
            }
          : undefined,

        // Evidence — closed element shape around one DECLARED OPEN SLOT (`data`,
        // which is Record<string, unknown> on the request type).
        evidence: event.evidence?.map((e) => ({
          type: e.type,
          timestamp: e.timestamp,
          data: e.data,
        })),

        // DECLARED OPEN SLOT — the caller's own Record<string, unknown>, carried
        // under its own key rather than merged into the event.
        customFields: event.customFields,
      },
    };

    // Add host if available
    if (event.device?.ip) {
      payload.host = event.device.ip;
    }

    return payload;
  }

  /**
   * Convert ISO timestamp to Unix epoch (Splunk expects this)
   */
  private timestampToUnix(timestamp: string): number {
    return Math.floor(new Date(timestamp).getTime() / 1000);
  }
}
