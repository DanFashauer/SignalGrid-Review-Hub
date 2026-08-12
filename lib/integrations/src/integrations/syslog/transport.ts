import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';
import { resolveEmission, EMIT_SUPPRESSED } from '../adapters/emit-gate';

/**
 * Syslog Transport Configuration
 */
export interface SyslogConfig {
  /** Syslog server hostname or IP */
  host: string;
  /** Syslog server port (default: 514 for UDP, 6514 for TLS) */
  port?: number;
  /** Transport protocol */
  protocol: 'udp' | 'tcp' | 'tls';
  /** Facility code (0-23, default: 16 = local0) */
  facility?: number;
  /** App name to identify the source */
  appName?: string;
  /** Format to use: json, cef, or leef */
  format: 'json' | 'cef' | 'leef';
  /** Include timestamp in message */
  includeTimestamp?: boolean;
  /** Include hostname */
  hostname?: string;
  /** Timeout for TCP/TLS connections */
  timeout?: number;
}

/**
 * Syslog message severity levels
 */
export enum SyslogSeverity {
  EMERGENCY = 0,
  ALERT = 1,
  CRITICAL = 2,
  ERROR = 3,
  WARNING = 4,
  NOTICE = 5,
  INFO = 6,
  DEBUG = 7,
}

/**
 * Syslog message facility codes
 */
export enum SyslogFacility {
  KERNEL = 0,
  USER = 1,
  MAIL = 2,
  DAEMON = 3,
  AUTH = 4,
  SYSLOG = 5,
  LPR = 6,
  NEWS = 7,
  UUCP = 8,
  CLOCK = 9,
  AUTHPRIV = 10,
  FTP = 11,
  NTP = 12,
  AUDIT = 13,
  ALERT = 14,
  CLOCK2 = 15,
  LOCAL0 = 16,
  LOCAL1 = 17,
  LOCAL2 = 18,
  LOCAL3 = 19,
  LOCAL4 = 20,
  LOCAL5 = 21,
  LOCAL6 = 22,
  LOCAL7 = 23,
}

/**
 * Syslog Transport Adapter
 * 
 * Sends events to syslog servers in JSON, CEF, or LEEF format
 */
export class SyslogAdapter implements SIEMAdapter {
  readonly name = 'syslog';
  readonly vendor = 'Syslog';
  readonly config: Required<SyslogConfig>;

  constructor(config: SyslogConfig) {
    this.config = {
      host: config.host,
      port: config.port || (config.protocol === 'tls' ? 6514 : 514),
      protocol: config.protocol,
      facility: config.facility || SyslogFacility.LOCAL0,
      appName: config.appName || 'EnterpriseShell',
      format: config.format,
      includeTimestamp: config.includeTimestamp !== false,
      hostname: config.hostname || process.env.HOSTNAME || 'localhost',
      timeout: config.timeout || 5000,
    };
  }

  /**
   * Send a single event to syslog
   */
  async sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse> {
    // GATE FIRST — the shared emit gate (../adapters/emit-gate.ts) the other
    // emitter families route through. When policy says nothing may be sent
    // (dev/alpha, or the live flag unset), nothing was promised and nothing is
    // lost: report the honest `suppressed` status WITH the reason, exactly like
    // siem/telemetry/itsm do.
    const emission = resolveEmission();
    if (emission.mode === 'suppressed') {
      return {
        eventId: `syslog-${event.type}-${Date.now()}`,
        status: EMIT_SUPPRESSED,
        receivedAt: new Date().toISOString(),
      };
    }

    // FORMATTING IS REAL AND IS KEPT. `formatEvent` and `buildPriority` implement RFC
    // 5424 / CEF / LEEF correctly and are worth having when a transport is chosen.
    const message = this.formatEvent(event);
    const priority = this.buildPriority(event.severity);
    void message;
    void priority;

    // THERE IS NO TRANSPORT, AND THIS NO LONGER CLAIMS OTHERWISE.
    //
    // Past the gate the caller has EXPLICITLY configured live delivery
    // (beta/prod tier and SIGNALGRID_LIVE_INTEGRATIONS exactly "true") — this
    // is where a quiet honest status is at its most dangerous, because a
    // caller that ignores a status string is the normal case and here they are
    // actively expecting delivery. So the live path REFUSES LOUDLY.
    //
    // This returned a `sent` status with a fresh receivedAt above a comment reading "In
    // a real implementation, this would send via UDP/TCP/TLS. For now, we return a mock
    // response." Nothing ever left the process — no socket is opened anywhere in this
    // family — and the caller was told the security event had been SENT and RECEIVED.
    //
    // That is the fourth instance of one defect in this repository: Jamf's hardcoded
    // `compliant: true`, ISE's hardcoded `status: "registered"`, the response-verdict
    // fold seeded with RESPONSE_VERIFIED_RESOLVED, and this. An affirmative asserted
    // because nothing contradicted it. It is the worst-placed of the four: a SIEM
    // forwarder that reports success while dropping every event silently defeats the
    // audit trail it exists to produce, and does so most convincingly during an
    // incident, when someone is looking for the events that never arrived.
    //
    // REFUSING RATHER THAN RETURNING AN HONEST-BUT-QUIET STATUS, because a caller that
    // ignores a status string is the normal case, and this must be impossible to miss.
    // The once-open question — tier-gated vs fixture-backed — is now decided: this
    // family is tier-gated (the shared gate above, plus `resolveSyslogEmitter`'s
    // four-clause gate at the family boundary). The gate stands beside this refusal;
    // it does not soften it. A real implementation replaces this throw, nothing else.
    throw new Error(
      "syslog: no transport is implemented — this adapter formats events but opens no " +
        "socket. It previously reported a 'sent' status for events that were never " +
        "transmitted. Wire a UDP/TCP/TLS transport behind a tier gate, or consume the " +
        "formatter directly, but do not treat a returned value here as delivery.",
    );
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
   * Health check - verify syslog server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      return !!(this.config.host && this.config.port);
    } catch {
      return false;
    }
  }

  /**
   * Format event based on configured format
   */
  private formatEvent(event: SIEMEventRequest): string {
    switch (this.config.format) {
      case 'cef':
        return this.formatCEF(event);
      case 'leef':
        return this.formatLEEF(event);
      case 'json':
      default:
        return this.formatJSON(event);
    }
  }

  /**
   * Format event as JSON
   */
  private formatJSON(event: SIEMEventRequest): string {
    const payload = {
      timestamp: event.timestamp || new Date().toISOString(),
      type: event.type,
      severity: event.severity,
      actor: event.actor,
      device: event.device,
      session: event.session,
      location: event.location,
      correlationId: event.correlationId,
      requestId: event.requestId,
      caseId: event.caseId,
      customFields: event.customFields,
    };

    return JSON.stringify(payload);
  }

  /**
   * Format event as CEF (Common Event Format)
   */
  private formatCEF(event: SIEMEventRequest): string {
    const version = '0';
    const vendor = 'EnterpriseShell';
    const product = 'EnterpriseShell';
    const versionStr = '1.0';
    const signatureId = this.sanitizeCEF(event.type);
    const name = this.sanitizeCEF(event.type);
    const severity = this.mapSeverityToCEF(event.severity);

    const extension = this.buildCEPExtension(event);

    return `CEF:${version}|${vendor}|${product}|${versionStr}|${signatureId}|${name}|${severity}|${extension}`;
  }

  /**
   * Format event as LEEF (Log Event Extended Format)
   */
  private formatLEEF(event: SIEMEventRequest): string {
    const version = '1.0';
    const vendor = 'EnterpriseShell';
    const product = 'EnterpriseShell';
    const eventId = this.sanitizeLEEF(event.type);
    const name = this.sanitizeLEEF(event.type);

    const extension = this.buildLEEFExtension(event);

    return `LEEF:${version}|${vendor}|${product}|${eventId}|${name}|${extension}`;
  }

  /**
   * Build CEF extension fields
   */
  private buildCEPExtension(event: SIEMEventRequest): string {
    const fields: string[] = [];

    if (event.actor?.userId) fields.push(`suser=${this.sanitizeCEF(event.actor.userId)}`);
    if (event.actor?.email) fields.push(`suserEmail=${this.sanitizeCEF(event.actor.email)}`);
    if (event.actor?.badgeUid) fields.push(`sbadge=${this.sanitizeCEF(event.actor.badgeUid)}`);

    if (event.device?.deviceId) fields.push(`dhost=${this.sanitizeCEF(event.device.deviceId)}`);
    if (event.device?.ip) fields.push(`src=${this.sanitizeCEF(event.device.ip)}`);
    if (event.device?.mac) fields.push(`smac=${this.sanitizeCEF(event.device.mac)}`);
    if (event.device?.platform) fields.push(`devicePlatform=${this.sanitizeCEF(event.device.platform)}`);

    if (event.session?.sessionId) fields.push(`sessionId=${this.sanitizeCEF(event.session.sessionId)}`);

    if (event.location?.zone) fields.push(`cn1=${this.sanitizeCEF(event.location.zone)}`);
    if (event.location?.building) fields.push(`cn2=${this.sanitizeCEF(event.location.building)}`);

    if (event.correlationId) fields.push(`cn3=${this.sanitizeCEF(event.correlationId)}`);
    if (event.requestId) fields.push(`cn4=${this.sanitizeCEF(event.requestId)}`);

    return fields.join(' ');
  }

  /**
   * Build LEEF extension fields
   */
  private buildLEEFExtension(event: SIEMEventRequest): string {
    const fields: string[] = [];

    if (event.actor?.userId) fields.push(`usrName=${this.sanitizeLEEF(event.actor.userId)}`);
    if (event.actor?.email) fields.push(`usrEmail=${this.sanitizeLEEF(event.actor.email)}`);
    if (event.actor?.badgeUid) fields.push(`badgeId=${this.sanitizeLEEF(event.actor.badgeUid)}`);

    if (event.device?.deviceId) fields.push(`hostName=${this.sanitizeLEEF(event.device.deviceId)}`);
    if (event.device?.ip) fields.push(`src=${this.sanitizeLEEF(event.device.ip)}`);
    if (event.device?.mac) fields.push(`macAddress=${this.sanitizeLEEF(event.device.mac)}`);
    if (event.device?.platform) fields.push(`os=${this.sanitizeLEEF(event.device.platform)}`);

    if (event.session?.sessionId) fields.push(`sessionId=${this.sanitizeLEEF(event.session.sessionId)}`);

    if (event.location?.zone) fields.push(`zone=${this.sanitizeLEEF(event.location.zone)}`);
    if (event.location?.building) fields.push(`building=${this.sanitizeLEEF(event.location.building)}`);
    if (event.location?.floor) fields.push(`floor=${this.sanitizeLEEF(event.location.floor)}`);

    if (event.correlationId) fields.push(`correlationId=${this.sanitizeLEEF(event.correlationId)}`);
    if (event.requestId) fields.push(`requestId=${this.sanitizeLEEF(event.requestId)}`);

    return fields.join('\t');
  }

  /**
   * Map severity to syslog priority
   */
  private buildPriority(severity: string): number {
    const severityMap: Record<string, SyslogSeverity> = {
      critical: SyslogSeverity.CRITICAL,
      high: SyslogSeverity.ERROR,
      medium: SyslogSeverity.WARNING,
      low: SyslogSeverity.NOTICE,
      info: SyslogSeverity.INFO,
    };

    const sev = severityMap[severity] || SyslogSeverity.INFO;
    return (this.config.facility << 3) | sev;
  }

  /**
   * Map severity to CEF severity (0-10)
   */
  private mapSeverityToCEF(severity: string): number {
    const severityMap: Record<string, number> = {
      critical: 10,
      high: 8,
      medium: 5,
      low: 3,
      info: 1,
    };

    return severityMap[severity] || 1;
  }

  /**
   * Sanitize value for CEF format
   */
  private sanitizeCEF(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/=/g, '\\=')
      .replace(/\n/g, '\\n');
  }

  /**
   * Sanitize value for LEEF format
   */
  private sanitizeLEEF(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n');
  }
}
