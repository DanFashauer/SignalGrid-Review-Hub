# Simulator Decision Engine

The simulator decision engine is deterministic and fixture-based. It maps normalized signals to candidate outcomes, routed actions, and audit evidence.

## Inputs

- Identity: authentication and identity-risk fixture signals.
- Device state and compliance: Apple DDM declared state, Platform SSO status, configuration status, enrollment status, and management audit-event fixtures from Apple/Jamf/Intune-style sources.
- Posture: compliance, posture freshness, EDR/security, and management-state fixture signals.
- Health: CPU, memory, app crash, network, battery, and DEX-style fixture signals.
- Location: expected zone, wrong zone, and future staff-safety fixture signals.
- Dock state: docked, undocked, missing, overdue, and wrong-slot return fixture signals.
- Workflow assignment: active workflow, pool ownership, session state, and criticality.
- Ownership: responsible owner or team used for route simulation.
- Integration state: healthy or degraded route targets such as ITSM/webhook fixtures.

## Outputs

- allow
- step_up
- restrict
- deny
- alert_operator
- create_ticket
- route_to_owner
- request_remediation
- verify_remediation
- record_audit

## Current simulator rules

- A non-compliant device cannot map to allow.
- Apple declared state can support an allow candidate only when identity/session context and audit evidence also align.
- Stale posture cannot be treated as fully trusted.
- High security risk escalates to the security owner.
- A missing or overdue dock event creates an owner-routed action.
- An integration outage degrades or queues the route and does not crash the simulator.
- Verified remediation produces audit evidence.
- Every scenario records audit evidence.

## Boundaries

The decision engine demonstrates deterministic logic only. It does not replace identity, Apple device management, UEM/MDM, ITSM, DEX, SIEM, EDR, RTLS, NAC, or dock systems. Source systems remain authoritative for their own data and actions.
