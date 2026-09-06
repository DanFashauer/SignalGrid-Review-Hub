# Operational Health / DEX Layer Strategy

SignalGrid's Operational Health / Digital Employee Experience (DEX) layer is a future signal layer for turning endpoint health, user experience, monitoring, alerting, API health, and ITSM signals into runtime trust decisions and routed actions. It is intended to close the operational gap between tools that observe problems and workflows that need the correct decision, owner, escalation path, ticket, notification, or audit record.

## Definition

The Operational Health / DEX layer consumes endpoint performance, endpoint health, monitoring, alerting, digital employee experience, observability, and ITSM signals, then correlates them with identity, device posture, session context, RTLS/DockBridge context, and workflow state.

SignalGrid is not the system of record for DEX, RMM, EDR, SIEM, monitoring, ITSM, observability, or UEM data. It sits above those systems as what `docs/PURPOSE.md` §2 states the product is: SignalGrid connects the systems a building already runs into one grid that decides and acts on the person's behalf — here, evaluating the combined operational context and deciding what should happen next. No category label is ratified (DR-019/DR-020); this layer is described by that product sentence, not by a coined name.

## Why this belongs in SignalGrid

Many healthcare, frontline, and shared-device organizations already deploy endpoint management, DEX, monitoring, alerting, EDR, observability, and ITSM platforms. The gap is often not data collection. The gap is operationalizing those signals in the exact workflow moment when a user, shared device, clinical app, API integration, or service is at risk.

SignalGrid should use this layer to:

- Normalize operational health signals from DEX, monitoring, endpoint, security, and ITSM platforms.
- Correlate health with identity, posture, session, shared-device, RTLS/DockBridge, workflow, and service context.
- Decide whether to allow, step up, deny, restrict, alert, ticket, escalate, or route remediation.
- Create audit evidence for the decision, signal source, owner, severity, and routed action.
- Route issues to the correct team based on source system, workflow, owner, severity, and impacted service.

## Candidate signal sources

Candidate systems include, but are not limited to:

- ControlUp.
- Nexthink.
- Riverbed Aternity.
- Lakeside SysTrack.
- TeamViewer DEX.
- Tanium.
- Ivanti Neurons.
- Microsoft Intune / Endpoint Analytics.
- Microsoft Defender for Endpoint.
- CrowdStrike.
- SentinelOne.
- Datadog.
- Splunk.
- Azure Monitor.
- ServiceNow.
- Jira Service Management.
- PagerDuty.
- Opsgenie.

These are ecosystem and integration-category candidates only. Public documentation should not imply current partnerships, certifications, validated integrations, marketplace listings, or production deployments.

## Endpoint health signals SignalGrid may consume

Operational health signals may include:

- Device online/offline state.
- Last check-in age.
- CPU, memory, and disk pressure.
- Battery and thermal health.
- Boot and login duration.
- App crash rate.
- Service crash events.
- Network latency and packet loss.
- VPN, Wi-Fi, and DNS health.
- EDR/AV disabled state.
- Missing patches.
- Posture freshness.
- Teams or unified communications quality indicators where available.
- VDI/DaaS session health where available.

## API and service health signals SignalGrid may consume

Service and integration health signals may include:

- Health endpoint status.
- Uptime.
- Latency percentiles such as P90, P95, and P99.
- 4xx and 5xx error rate.
- Request volume and throughput.
- Integration failure rate.
- Webhook delivery failure.
- API authentication failure.
- Stale sync or stale connector data.

## Actions SignalGrid may route

SignalGrid may route decisions and action requests such as:

- Create an ITSM ticket.
- Update an existing ticket.
- Send an email notification.
- Send a mobile operator alert.
- Notify Slack, Teams, PagerDuty, or Opsgenie.
- Request device remediation.
- Request posture refresh.
- Request MDM sync.
- Request EDR investigation.
- Request endpoint isolation.
- Route to the endpoint team.
- Route to the IAM team.
- Route to the network team.
- Route to the app/API owner.
- Record audit evidence.

High-risk actions require explicit approval gates and should remain requests or recommendations unless a private-core production implementation has been validated, authorized, and governed.

## Decision examples

| Scenario                                                                            | SignalGrid decisioning pattern                                                                                        | Routed action                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Compliant device with severe health degradation during an active clinical workflow. | Treat posture as acceptable but operational risk as high because the workflow is active and user impact is immediate. | Alert the operator and create a priority ticket for the owning team. |
| Non-compliant device with stale check-in during a shared-device session.            | Treat trust as degraded because posture is stale and the device is actively shared.                                   | Restrict or review access and route to the endpoint team.            |
| API integration failure with webhook retries exhausted.                             | Treat the connector or integration path as unhealthy and potentially blocking downstream decisions.                   | Alert the platform owner and create an incident.                     |
| EDR disabled for a privileged user with an active session.                          | Treat the combination of privileged identity, active session, and missing endpoint defense as high risk.              | Deny or review access and escalate to security.                      |
| Repeated app crash on a shared device pool.                                         | Treat the problem as an application or mobility reliability issue rather than only a security event.                  | Route to the app owner and mobility team.                            |
| Poor Teams or VDI session quality.                                                  | Treat the issue as user-experience or EUC/DEX degradation when security posture is otherwise acceptable.              | Route to the EUC/DEX team, not security.                             |

## Routing model

A future private-core implementation should separate signal ingestion from action execution:

1. Source system emits a health, alert, incident, endpoint, service, or ITSM event.
2. SignalGrid normalizes the signal into a common operational-health model.
3. SignalGrid correlates the signal with identity, device posture, session, RTLS/DockBridge, workflow, service, and ownership context.
4. SignalGrid evaluates policy and produces a decision such as allow, step-up, deny, restrict, alert, ticket, escalate, route remediation, or record evidence.
5. SignalGrid routes the action request to the correct tool or team.
6. Source systems execute, remain authoritative, and preserve their own records.
7. SignalGrid records audit evidence for the signal, decision, policy version, owner, severity, action request, and outcome.

## Boundaries and claim discipline

SignalGrid must preserve clear boundaries:

- SignalGrid does not replace DEX, RMM, EDR, SIEM, monitoring, ITSM, observability, UEM, MDM, or endpoint-management platforms.
- SignalGrid consumes signals from these systems and orchestrates runtime decisions and routed actions.
- Existing tools remain systems of record for telemetry, enforcement, ticket records, remediation execution, and product-specific controls.
- Public docs must not claim autonomous production remediation.
- High-risk actions require approval gates, scoped permissions, simulation or validation where appropriate, and audit evidence.
- Public docs must avoid vendor partnership, certification, validated-integration, marketplace, customer-deployment, or production-readiness claims unless separately approved and evidenced.

## Production-path alignment

Operational Health / DEX should be a follow-on layer after:

1. Entra ID + Intune first proof.
2. Identity Trust Layer.
3. Jamf and broader UEM follow-on posture paths.

It should be placed before:

1. Network / Cloud Trust Layer expansion.
2. Autonomous remediation.
3. Agentic/MCP action execution.

This order keeps SignalGrid grounded in identity and posture first, then adds operational context before moving into broader network/cloud trust or higher-risk action execution.

## Local implementation guidance

Public Review Hub work should document the strategy, signal model, boundaries, and deterministic examples. Real DEX, monitoring, observability, API-health, ITSM, alert-routing, and remediation connector implementation should move to the private/core/local implementation because it may require credentials, API keys, tenant data, webhook secrets, monitoring-tool access, source-system permissions, mobile testing, and private test data.
