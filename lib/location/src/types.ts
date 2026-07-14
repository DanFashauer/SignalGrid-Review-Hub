export type LocationMode = "presence" | "coarse" | "precise";

export type LocationSource =
  | "device.gps"
  | "device.wifi"
  | "device.ble"
  | "device.uwb"
  | "nac"
  | "nac-radius"
  | "nac-dhcp"
  | "mdm"
  | "rtls"
  | "manual";

export type LocationSignal = {
  deviceId: string;
  observedAt: number; // epoch ms
  source: LocationSource;
  mode: LocationMode;

  // Presence / coarse identifiers
  siteId?: string;
  buildingId?: string;
  floorId?: string;
  zoneId?: string;

  // Precise (only if mode=precise)
  lat?: number;
  lon?: number;
  accuracyM?: number;

  // Optional network context
  ip?: string;
  wifiBssid?: string;
  apName?: string;

  // Additional metadata
  metadata?: Record<string, unknown>;
};
