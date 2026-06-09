# SignalGrid Real-Life Simulator

The SignalGrid real-life simulator is a public-safe, deterministic demonstration of the product direction. It shows how SignalGrid can correlate identity, device posture, operational health, RTLS/location, DockBridge/shared-device events, workflow ownership, integration health, and audit evidence to decide what should happen next.

This simulator uses fixture data only. It contains no credentials, tenant IDs, customer data, proprietary screenshots, real Microsoft Graph calls, or real vendor API calls. It is a local simulator foundation, not a production claim or compliance certification.

## Purpose

- Demonstrate runtime trust and operational orchestration with deterministic scenarios.
- Show signal normalization, decision output, owner routing, ticket or alert simulation, and audit evidence.
- Keep public documentation and code safe for review without exposing private-core implementation details.
- Provide a CI-compatible proof script that validates the simulator rules.

## Simulator layers

1. Identity Trust Layer.
2. Device Trust Layer.
3. Operational Health / DEX Layer.
4. RTLS / Location Layer.
5. DockBridge / Physical Shared-Device Layer.
6. Workflow Ownership / ITSM Layer.
7. Network / Cloud Trust Layer as future-only.
8. SignalGrid Runtime Decision Engine.
9. Audit Evidence Layer.

## What it demonstrates

The simulator demonstrates how SignalGrid could consume signals from systems of record, normalize them, evaluate runtime trust, route ownership, and record evidence. It does not execute production changes, enforce access in a live environment, or call external systems.

## Included scenarios

- Healthy shared device checkout.
- Non-compliant clinical shared device.
- Stale check-in on a shared device.
- Wrong-zone RTLS event.
- Dock missing or overdue device.
- Low battery workflow impact.
- Operational health degradation.
- EDR or security risk.
- API or integration outage.
- Remediation verified.

## Public-safe boundaries

- No customer data.
- No real tenant identifiers.
- No secrets or credentials.
- No real vendor API calls.
- No production enforcement.
- No vendor partnership or certification claim.
- No autonomous production remediation claim.
