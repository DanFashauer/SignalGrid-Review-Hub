// ============================================================================
// NAC RADIUS Accounting / DHCP Lease Location Ingest
// Provides MDM/UEM agnostic network-derived location presence
// Connects to existing Location Signals module
// ============================================================================

import { isIP } from 'node:net';
import { z } from 'zod';
import { createLocationStore } from './store';
import { validateLocationSignal } from './validate';
import type { LocationSignal, LocationMode, LocationSource } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * RADIUS Accounting Request (RFC 2866)
 * Can be sent by NAS (Network Access Server) like Cisco ISE, Aruba ClearPass
 */
// Zod 3 spells this `z.string()` + `.ip()`; Zod 4 removed it in favour of `z.ipv4()` /
// `z.ipv6()`. Neither spelling compiles under both, and this schema must survive the
// dependency bump without changing what it ACCEPTS — so validation is delegated to
// node's own parser instead. That is also simply more correct: a hand-rolled IPv6
// regex (compressed forms, zone ids, v4-mapped addresses) is a classic source of
// validators that are subtly wrong in the direction of accepting junk.
//
// `isIP` returns 4, 6, or 0 — matching Zod 3's `.ip()`, which accepted both families.
const ipAddress = () => z.string().refine((v) => isIP(v) !== 0, { message: 'Invalid IP address' });

export const RADIUSAccountingSchema = z.object({
  // Event type
  eventType: z.enum(['Start', 'Stop', 'Interim-Update', 'Accounting-On', 'Accounting-Off']),
  
  // NAS identification
  nasIpAddress: z.string().optional(),
  nasIdentifier: z.string().optional(),
  nasPort: z.number().optional(),
  
  // User/MAC identification
  userName: z.string().optional(),
  callingStationId: z.string().optional(), // MAC address
  calledStationId: z.string().optional(), // SSID or AP MAC
  framedIPAddress: z.string().optional(), // Assigned IP
  macAddress: z.string().optional(), // Alternative MAC field
  
  // Session info
  sessionId: z.string().optional(),
  sessionTime: z.number().optional(), // Seconds
  inputOctets: z.number().optional(),
  outputOctets: z.number().optional(),
  terminateCause: z.string().optional(),
  
  // VLAN/Network info (for location inference)
  tunnelType: z.string().optional(),
  tunnelMediumType: z.string().optional(),
  tunnelPrivateGroupId: z.string().optional(), // VLAN ID
  
  // Timestamp
  eventTimestamp: z.string().datetime(),
  receivedAt: z.string().datetime().optional(),
});

export type RADIUSAccounting = z.infer<typeof RADIUSAccountingSchema>;

/**
 * DHCP Lease Information
 * Can be obtained from DHCP server logs or syslog
 */
export const DHCPLeaseSchema = z.object({
  // Event type
  eventType: z.enum(['lease', 'release', 'expire']),
  
  // Device identification
  macAddress: z.string(), // Required - format: aa:bb:cc:dd:ee:ff
  hostname: z.string().optional(), // DHCP hostname option
  
  // IP assignment
  ipAddress: ipAddress(), // Required
  leaseTime: z.number().optional(), // Seconds
  
  // DHCP Server info
  serverIp: ipAddress().optional(),
  relayAgent: ipAddress().optional(), // Circuit ID for location
  
  // Circuit/Location info (Option 82)
  circuitId: z.string().optional(), // VLAN/subnet info
  remoteId: z.string().optional(), // MAC of relay
  
  // Timestamp
  timestamp: z.string().datetime(),
});

export type DHCPLease = z.infer<typeof DHCPLeaseSchema>;

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse RADIUS accounting record to location signal
 */
export function parseRADIUSToLocation(
  radius: RADIUSAccounting
): Omit<LocationSignal, 'deviceId' | 'observedAt' | 'source' | 'mode'> & { deviceId: string } {
  // Extract MAC address (normalize format)
  const macAddress = radius.callingStationId || radius.macAddress;
  const normalizedMac = macAddress?.toLowerCase().replace(/[:-]/g, '');
  
  // Determine device ID from MAC or username. Leave it EMPTY when neither is
  // present — do not fabricate an 'unknown' identifier that would be stored as a
  // real presence signal; the ingest path validates and drops an empty deviceId.
  const deviceId = normalizedMac || radius.userName || '';
  
  // Infer location from network info
  // VLAN ID can be mapped to zone/building
  const zoneId = radius.tunnelPrivateGroupId;
  
  // SSID for wireless location
  const ssid = radius.calledStationId?.split(':')[0]; // Often format: SSID:MAC
  
  // AP MAC for more precise location
  const apName = radius.calledStationId?.split(':')[1];
  
  return {
    deviceId,
    zoneId,
    ip: radius.framedIPAddress,
    apName,
    wifiBssid: macAddress,
    metadata: {
      vlan: radius.tunnelPrivateGroupId,
      ssid,
      apMac: radius.calledStationId?.split(':')[1],
      sessionId: radius.sessionId,
      nasIp: radius.nasIpAddress,
    },
  };
}

/**
 * Parse DHCP lease to location signal
 */
export function parseDHCPToLocation(
  dhcp: DHCPLease
): Omit<LocationSignal, 'deviceId' | 'observedAt' | 'source' | 'mode'> & { deviceId: string } {
  // Normalize MAC address
  const normalizedMac = dhcp.macAddress.toLowerCase().replace(/[:-]/g, '');

  // Circuit ID (DHCP Option 82) is vendor-defined and often a single opaque
  // token (hex, an interface name). Only treat it as a structured
  // building/floor pair when it clearly matches the "BUILDING-FLOOR" shape —
  // exactly two non-empty alphanumeric labels. Otherwise leave both undefined
  // rather than reinterpreting an arbitrary string as an authoritative location
  // identifier. No auth decision consumes these fields today; this keeps them
  // honest for when one might.
  const structured = dhcp.circuitId
    ? /^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/.exec(dhcp.circuitId)
    : null;

  return {
    deviceId: normalizedMac,
    zoneId: dhcp.circuitId,
    buildingId: structured?.[1],
    floorId: structured?.[2],
    ip: dhcp.ipAddress,
    metadata: {
      vlan: dhcp.circuitId,
      hostname: dhcp.hostname,
      circuitId: dhcp.circuitId,
      relayAgent: dhcp.relayAgent,
    },
  };
}

// ============================================================================
// Location Store Integration
// ============================================================================

/**
 * Ingest RADIUS accounting data and convert to location signal
 */
export async function ingestRADIUS(
  radius: RADIUSAccounting
): Promise<LocationSignal | null> {
  const store = await createLocationStore();
  
  // Parse to network location
  const networkLocation = parseRADIUSToLocation(radius);
  
  // Only create presence for active sessions
  if (radius.eventType !== 'Start' && radius.eventType !== 'Interim-Update') {
    return null;
  }
  
  // The observation instant is the EVENT's own timestamp, never the ingest clock.
  // Stamping `Date.now()` here made validateLocationSignal's age check compare now
  // against now, so it could never fire: a late-delivered or replayed accounting
  // record from yesterday became a FRESH presence fact. The schema already requires
  // eventTimestamp as an ISO datetime; an unparseable value is NaN and the
  // validator's Number.isFinite guard rejects it — fail closed, never re-stamped.
  const signal: LocationSignal = {
    deviceId: networkLocation.deviceId,
    observedAt: Date.parse(radius.eventTimestamp),
    source: 'nac-radius',
    mode: 'coarse',
    zoneId: networkLocation.zoneId,
    ip: networkLocation.ip,
    apName: networkLocation.apName,
    wifiBssid: networkLocation.wifiBssid,
    metadata: networkLocation.metadata,
  };

  // Fail closed: validate the externally-sourced signal (real deviceId, sane
  // observedAt) before it becomes a stored presence fact. Drop it if invalid.
  if (!validateLocationSignal(signal).ok) {
    return null;
  }

  await store.upsert(signal);

  return signal;
}

/**
 * Ingest DHCP lease data and convert to location signal
 */
export async function ingestDHCP(
  dhcp: DHCPLease
): Promise<LocationSignal | null> {
  const store = await createLocationStore();
  
  // Parse to network location
  const networkLocation = parseDHCPToLocation(dhcp);
  
  // Only track presence for new leases
  if (dhcp.eventType === 'expire') {
    return null;
  }
  
  // Same rule as the RADIUS path: the lease's own timestamp is the observation
  // instant, so a stale or replayed lease cannot re-stamp itself fresh.
  const signal: LocationSignal = {
    deviceId: networkLocation.deviceId,
    observedAt: Date.parse(dhcp.timestamp),
    source: 'nac-dhcp',
    mode: 'coarse',
    zoneId: networkLocation.zoneId,
    buildingId: networkLocation.buildingId,
    floorId: networkLocation.floorId,
    ip: networkLocation.ip,
    metadata: networkLocation.metadata,
  };

  // Fail closed: validate before storing (drops an empty/short deviceId, a
  // future or stale observedAt) so a malformed lease can't become a presence fact.
  if (!validateLocationSignal(signal).ok) {
    return null;
  }

  await store.upsert(signal);

  return signal;
}

// ============================================================================
// Webhook API Handler
// ============================================================================

/**
 * Unified handler for receiving network location data
 * Can be called by NAC systems via webhook
 */
export async function handleNetworkLocationIngest(
  data: RADIUSAccounting | DHCPLease,
  type: 'radius' | 'dhcp'
): Promise<{ success: boolean; location?: LocationSignal; error?: string }> {
  try {
    let location: LocationSignal | null;
    
    if (type === 'radius') {
      const radius = RADIUSAccountingSchema.parse(data);
      location = await ingestRADIUS(radius);
    } else {
      const dhcp = DHCPLeaseSchema.parse(data);
      location = await ingestDHCP(dhcp);
    }
    
    return {
      success: true,
      location: location || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
}
