import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';
import { resolveEmission, EMIT_SUPPRESSED } from '../adapters/emit-gate';

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

  /**
   * Send a single event to Splunk
   */
  async sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse> {
    // Gate first: dev/alpha never emit outbound. See ../adapters/emit-gate.ts.
    const emission = resolveEmission();
    if (emission.mode === 'suppressed') {
      return {
        eventId: `suppressed-${Date.now()}`,
        status: EMIT_SUPPRESSED,
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
    const emission = resolveEmission();
    if (emission.mode !== "live") return false;

    try {
      // Try to get server info
      const url = new URL('/services/server/info', this.config.hecUrl);
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Splunk ${this.config.hecToken}`,
        },
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Build HEC event payload
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
        
        // Actor
        actor: event.actor,
        
        // Device
        device: event.device,
        
        // Session
        session: event.session,
        
        // Location
        location: event.location,
        
        // Evidence
        evidence: event.evidence,
        
        // Custom fields
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
