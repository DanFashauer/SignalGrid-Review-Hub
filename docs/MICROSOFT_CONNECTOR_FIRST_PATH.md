# Microsoft Connector First Path

The first connector path should be Microsoft Entra ID plus Microsoft Intune because it fits the recommended wedge: frontline and shared-device workflow access decisions based on identity, device posture, and context.

## Scope

- Start with read-only Microsoft Graph, Intune, and Entra-shaped connector contracts.
- Use sandbox/mock fixtures first.
- Keep all public Review Hub examples deterministic and credential-free.
- Store credential references only in future private contexts; never commit credentials, tenant IDs, customer data, PHI, or PII.
- Model connector sync runs as job records with status, started/finished timestamps, source, counts, warnings, and errors.
- Normalize Microsoft posture signals into the v0.2 signal model.
- Expose operator connector health before exposing richer connector controls.
- Do not add write/remediation actions in v0.2 connector scaffolding.

## Initial normalized Microsoft posture signals

- identity status and group/app assignment context;
- device compliance state;
- device management state;
- platform and ownership classification where available;
- stale check-in or missing posture evidence;
- connector health, freshness, and last successful sync;
- evidence source and retrieval timestamp.

## Non-goals

- No live Microsoft Graph calls in the public repo.
- No production tenant onboarding.
- No write actions, device commands, remediation pushes, or policy changes.
- No claim of Microsoft partnership, marketplace certification, or endorsement.
