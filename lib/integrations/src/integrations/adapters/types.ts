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

export interface UEMDeviceState {
  deviceId: string;
  enrolled: boolean;
  compliant: boolean;
  osVersion?: string;
  platform?: string;
  lastSync?: string;
  tags?: string[];
  quarantineStatus?: 'none' | 'quarantined' | 'clearing';
}

export interface UEMTagRequest {
  deviceId: string;
  tag: string;
  reason?: string;
  correlationId?: string;
}

export interface UEMQuarantineRequest {
  deviceId: string;
  action: 'quarantine' | 'unquarantine';
  reason?: string;
  correlationId?: string;
}

export interface UEMCommandRequest {
  deviceId: string;
  command: string;
  payload?: Record<string, unknown>;
  reason?: string;
  correlationId?: string;
}

export interface UEMCommandResponse {
  commandId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  message?: string;
}

export interface UEMAdapter {
  readonly name: string;
  readonly vendor: string;
  
  // Universal UEM Surface
  getDeviceState(deviceId: string): Promise<UEMDeviceState | null>;
  setTag(request: UEMTagRequest): Promise<{ success: boolean }>;
  removeTag(request: UEMTagRequest): Promise<{ success: boolean }>;
  quarantine(request: UEMQuarantineRequest): Promise<UEMCommandResponse>;
  clearQuarantine(deviceId: string, reason?: string): Promise<UEMCommandResponse>;
  syncDevice?(deviceId: string): Promise<UEMCommandResponse>;
  
  // Legacy support
  pushCommand?(request: UEMCommandRequest): Promise<UEMCommandResponse>;
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

export interface NACAdapter {
  readonly name: string;
  readonly vendor: string;
  
  // Universal NAC Surface
  lookupEndpoint(identifier: string, type: 'mac' | 'serial' | 'cert'): Promise<NACEndpointInfo | null>;
  quarantineEndpoint(request: NACQuarantineRequest): Promise<NACQuarantineResponse>;
  clearQuarantine(endpointId: string, reason?: string): Promise<NACQuarantineResponse>;
  
  // Legacy support
  quarantineDevice?(request: NACQuarantineRequest): Promise<NACQuarantineResponse>;
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
