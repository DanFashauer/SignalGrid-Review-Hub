// Deterministic fixture dataset for the read-only Graph posture connector's
// FIXTURE MODE — the mode every tier below beta runs in, and the mode a partner
// demo runs in before any tenant credential exists.
//
// The seven synthetic cases MIRROR `fixtures/microsoft-graph/
// identity-device-posture.json` (fixtureVersion 2026-06-15.1) case for case:
// same subject ids, same device ids, same identity/compliance/management/
// registration states, same last-seen instants. The JSON stays the reviewable
// source of record; this module is the same data in the raw wire shapes the
// mock Graph serves, so `resolveGraphPostureConnector` can hand back a WORKING
// connector with no filesystem read and no network call. `proof:launch-seam`
// asserts the two do not drift.
//
// Everything here is synthetic and public-safe: no real tenant, user, device,
// or credential. The token is an obviously-fake demo string the mock transport
// checks only so the auth path is exercised.

import { createMockGraphTransport } from "./mock-transport";
import { GraphPostureConnector } from "./posture-connector";
import type { GraphManagedDeviceRaw, GraphUserRaw } from "./types";

/** Obviously-fake token the fixture transport expects. Never a real secret. */
export const FIXTURE_GRAPH_TOKEN = "fixture-demo-token-not-a-secret";

export const FIXTURE_GRAPH_USERS: readonly GraphUserRaw[] = [
  { id: "synthetic-user-001", userPrincipalName: "synthetic-user-001@fixture.example", accountEnabled: true, riskLevel: "low" },
  { id: "synthetic-user-002", userPrincipalName: "synthetic-user-002@fixture.example", accountEnabled: false, riskLevel: "high" },
  { id: "synthetic-user-003", userPrincipalName: "synthetic-user-003@fixture.example", accountEnabled: true, riskLevel: "medium" },
  { id: "synthetic-user-004", userPrincipalName: "synthetic-user-004@fixture.example", accountEnabled: true, riskLevel: "medium" },
  { id: "synthetic-user-005", userPrincipalName: "synthetic-user-005@fixture.example", accountEnabled: true, riskLevel: "medium" },
  { id: "synthetic-user-006", userPrincipalName: "synthetic-user-006@fixture.example", accountEnabled: true, riskLevel: "medium" },
  { id: "synthetic-user-007", userPrincipalName: "synthetic-user-007@fixture.example", accountEnabled: true, riskLevel: "medium" },
];

export const FIXTURE_GRAPH_DEVICES: readonly GraphManagedDeviceRaw[] = [
  {
    id: "synthetic-device-001",
    userId: "synthetic-user-001",
    deviceName: "Fixture Device 001",
    complianceState: "compliant",
    managementState: "managed",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-06-15T11:45:00.000Z",
  },
  {
    id: "synthetic-device-002",
    userId: "synthetic-user-002",
    deviceName: "Fixture Device 002",
    complianceState: "compliant",
    managementState: "managed",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-06-15T11:40:00.000Z",
  },
  {
    id: "synthetic-device-003",
    userId: "synthetic-user-003",
    deviceName: "Fixture Device 003",
    complianceState: "non_compliant",
    managementState: "managed",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-06-15T11:30:00.000Z",
  },
  {
    id: "synthetic-device-004",
    userId: "synthetic-user-004",
    deviceName: "Fixture Device 004",
    complianceState: "compliant",
    managementState: "managed",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-05-01T08:00:00.000Z",
  },
  {
    id: "synthetic-device-005",
    userId: "synthetic-user-005",
    deviceName: "Fixture Device 005",
    complianceState: "not_applicable",
    managementState: "unmanaged",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-06-15T10:30:00.000Z",
  },
  {
    id: "synthetic-device-006",
    userId: "synthetic-user-006",
    deviceName: "Fixture Device 006",
    // Graph's WIRE spelling for an absent compliance evaluation; the connector
    // normalizes it to "missing" — the state the JSON fixture case records.
    complianceState: "unknown",
    managementState: "managed",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-06-15T09:30:00.000Z",
  },
  {
    id: "synthetic-device-007",
    userId: "synthetic-user-007",
    deviceName: "Fixture Device 007",
    complianceState: "compliant",
    managementState: "managed",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-06-15T11:00:00.000Z",
  },
];

/**
 * A WORKING, fully-offline Graph posture connector over the fixture dataset.
 * Same class, same code paths (paging, auth, normalization) as a live read —
 * only the transport is the in-memory mock. Page size 3 on purpose, so every
 * fixture-mode fetch exercises real `@odata.nextLink` pagination.
 */
export function createFixtureGraphPostureConnector(): GraphPostureConnector {
  const transport = createMockGraphTransport({
    users: [...FIXTURE_GRAPH_USERS],
    devices: [...FIXTURE_GRAPH_DEVICES],
    expectedToken: FIXTURE_GRAPH_TOKEN,
    pageSize: 3,
  });
  return new GraphPostureConnector({ accessToken: FIXTURE_GRAPH_TOKEN }, transport);
}
