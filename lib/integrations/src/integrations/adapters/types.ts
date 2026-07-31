// ============================================================================
// Integration Adapter Types - Simplified for v1
// ============================================================================

// ============================================================================
// ITSM Types
// ============================================================================

export interface ITSMTicketRequest {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  category: string;
  source?: string;
  correlationId?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  deviceId?: string;
  deviceName?: string;
  devicePlatform?: string;
  links?: {
    dashboard?: string;
    auditLog?: string;
    device?: string;
    session?: string;
  };
  rawEvent?: Record<string, unknown>;
}

export interface ITSMTicketResponse {
  ticketId: string;
  ticketUrl?: string;
  status: string;
  createdAt: string;
}

export interface ITSMAdapter {
  readonly name: string;
  readonly vendor: string;
  createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse>;
  healthCheck?(): Promise<boolean>;
}

// ============================================================================
// SIEM Types
// ============================================================================

export interface SIEMEventRequest {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  timestamp?: string;
  actor?: {
    userId?: string;
    badgeUid?: string;
    email?: string;
    name?: string;
  };
  device?: {
    deviceId?: string;
    platform?: string;
    ip?: string;
    mac?: string;
    tags?: string[];
  };
  session?: {
    sessionId?: string;
    startedAt?: string;
    endedAt?: string;
    duration?: number;
  };
  location?: {
    zone?: string;
    building?: string;
    floor?: string;
    coordinates?: { lat: number; lng: number };
  };
  evidence?: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
  }>;
  caseId?: string;
  requestId?: string;
  correlationId?: string;
  customFields?: Record<string, unknown>;
}

export interface SIEMEventResponse {
  eventId: string;
  status: string;
  receivedAt: string;
}

export interface SIEMAdapter {
  readonly name: string;
  readonly vendor: string;
  sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse>;
  sendEvents?(events: SIEMEventRequest[]): Promise<SIEMEventResponse[]>;
  healthCheck?(): Promise<boolean>;
}

// ============================================================================
// UEM Types - Universal Surface for MDM/UEM
// ============================================================================

/**
 * Device state as reported by a UEM. READ-ONLY.
 *
 * `enrolled` and `compliant` were `boolean` here. A boolean cannot express "the
 * UEM did not tell us", so an unreadable device silently became `false` — and the
 * Jamf adapter, which had no compliance check at all, filled the gap with a
 * hardcoded `true`. A field that cannot express ignorance gets filled with a guess,
 * and the guess is then read as fact. Both are now tri-state.
 *
 * The richer vendor-neutral shape lives in `../uem/types` (`NormalizedUemDeviceState`);
 * this interface is the narrow one the device resolver consumes.
 */
export interface UEMDeviceState {
  deviceId: string;
  enrolled: 'enrolled' | 'not_enrolled' | 'unknown';
  compliant: 'compliant' | 'non_compliant' | 'not_evaluated' | 'unknown';
  osVersion?: string;
  platform?: string;
  /** Vendor-reported check-in timestamp, verbatim. Deliberately NOT converted to an
   *  age here — that needs a clock, and a clock read in a decision path is forbidden
   *  by golden rule 2. The caller that owns the clock derives freshness. */
  lastSync?: string;
  tags?: string[];
}

/**
 * The UEM read surface.
 *
 * WRITE METHODS REMOVED: `setTag`, `removeTag`, `quarantine`, `clearQuarantine`,
 * `syncDevice`, `pushCommand`. Their implementations fired real device-lock,
 * passcode-bypass and inventory commands at real vendor APIs with no tier gate, no
 * `SIGNALGRID_LIVE_INTEGRATIONS` gate and no approval step — against AGENTS.md
 * ("Keep high-risk actions simulated and approval-required").
 *
 * They are deleted rather than gated because connector discipline in this repo is a
 * READ-ONLY discipline: every disciplined connector reads and returns a verdict,
 * none of them act. Remediation is already modelled correctly elsewhere as an
 * approval-gated request a human executes in the system of record.
 *
 * Nothing consumed them: the only caller, `deviceResolver`, uses `getDeviceState`.
 */
export interface UEMAdapter {
  readonly name: string;
  readonly vendor: string;
  getDeviceState(deviceId: string): Promise<UEMDeviceState | null>;
  healthCheck?(): Promise<boolean>;
}

// ============================================================================
// NAC Types - Network Access Control
// ============================================================================

export interface NACEndpointInfo {
  endpointId: string;
  macAddress?: string;
  serialNumber?: string;
  certSubject?: string;
  name?: string;
  status: 'unknown' | 'registered' | 'authenticated' | 'disconnected';
  profiles?: string[];
  lastSeen?: string;
}

export interface NACQuarantineRequest {
  deviceId: string;
  action: 'quarantine' | 'unquarantine' | 'reauthenticate' | 'notify';
  reason?: string;
  duration?: number;
  vlan?: string;
  networkProfile?: string;
  correlationId?: string;
  caseId?: string;
}

export interface NACQuarantineResponse {
  requestId: string;
  status: 'pending' | 'applied' | 'failed' | 'revoked';
  appliedAt?: string;
  message?: string;
}

// WRITE METHODS REMOVED: `quarantineEndpoint`, `clearQuarantine` and the
// `quarantineDevice` alias. They cut a device off the network through Cisco ISE
// ANC / ClearPass enforcement — a DEVICE ACTION, the class removed from uem/ in
// #150. Declaring them here made the actuator a REQUIRED part of the contract,
// so any new NAC vendor had to implement one; the interface is now read-only and
// a vendor adapter cannot satisfy it by acting on a device.
export interface NACAdapter {
  readonly name: string;
  readonly vendor: string;

  // Universal NAC surface — read-only.
  lookupEndpoint(identifier: string, type: 'mac' | 'serial' | 'cert'): Promise<NACEndpointInfo | null>;
  healthCheck?(): Promise<boolean>;
}

// ============================================================================
// Notify Types
// ============================================================================

export interface NotifyRequest {
  channel: 'email' | 'sms' | 'slack' | 'teams' | 'webhook' | 'push';
  recipients: string[];
  subject?: string;
  message: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  correlationId?: string;
  caseId?: string;
}

export interface NotifyResponse {
  notificationId: string;
  status: 'sent' | 'queued' | 'failed';
  channel: string;
  sentAt?: string;
}

export interface NotifyAdapter {
  readonly name: string;
  readonly vendor: string;
  notify(request: NotifyRequest): Promise<NotifyResponse>;
  healthCheck?(): Promise<boolean>;
}

// ============================================================================
// Adapter Registry
// ============================================================================

export interface AdapterRegistry {
  itsm: ITSMAdapter | null;
  siem: SIEMAdapter | null;
  uem: UEMAdapter | null;
  nac: NACAdapter | null;
  notify: NotifyAdapter | null;
}

export interface AdapterConfig {
  itsm?: {
    provider: 'servicenow' | 'jira' | 'webhook' | 'none';
    config?: Record<string, unknown>;
  };
  siem?: {
    provider: 'splunk' | 'sentinel' | 'elastic' | 'webhook' | 'none';
    config?: Record<string, unknown>;
  };
  uem?: {
    provider: 'intune' | 'workspace_one' | 'webhook' | 'none';
    config?: Record<string, unknown>;
  };
  nac?: {
    provider: 'ise' | 'clearpass' | 'webhook' | 'none';
    config?: Record<string, unknown>;
  };
  notify?: {
    provider: 'smtp' | 'slack' | 'teams' | 'webhook' | 'none';
    config?: Record<string, unknown>;
  };
}
