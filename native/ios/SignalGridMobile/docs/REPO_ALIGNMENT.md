# Repository alignment

This build was derived from the current `SignalGrid_Alpha` branch of `DanFashauer/SignalGrid-Review-Hub`.

## Product framing

The repository defines SignalGrid as an operational trust orchestration and runtime decision layer for shared, mobile, and frontline environments. It combines identity, device posture, custody, workflow, integration health, routing, audit, and verification context while leaving systems of record external.

The native app preserves that framing.

## Hard UX law

The repository’s `docs/EMBEDDED_UX_PRINCIPLE.md` says the frontline user never opens or logs into a SignalGrid app. SignalGrid is embedded beneath the host application, and step-up uses the platform’s native authenticator.

The comparison build therefore has two targets:

| Target | Intended user | Branding |
| --- | --- | --- |
| `SignalGridOperator` | operator, support lead, reviewer, security/platform team | SignalGrid-branded |
| `WardlinkDemo` | synthetic frontline clinical worker using a host app | Wardlink-branded; SignalGrid appears only in reviewer instrumentation |

## Decision model

Mapped from `lib/signalgrid-core`:

- outcomes: `allow`, `step_up`, `restrict`, `deny`;
- tenant-scoped identities, devices, workflows, connectors, signals, policies, decisions, and audit;
- versioned policies and matched rules;
- evidence snapshots with deterministic digests;
- review status and reason codes;
- approval-aware downstream actions;
- session lifecycle.

## Fixture mapping

The offline native core mirrors the Northwind Health scenario family:

| Native scenario | Repo concept | Expected outcome |
| --- | --- | --- |
| Trusted clinical session | compliant nurse + shared managed iPad + fresh posture | allow |
| Non-compliant device | Intune-shaped compliance failure | restrict |
| Stale posture | posture outside freshness window | step-up |
| Unmanaged personal device | device outside management authority | restrict |
| Disabled identity | disabled Entra-shaped identity | deny |
| Missing posture | no current posture evidence | restrict |
| Security baseline drift | hardening baseline drift | step-up |
| Badge withdrawn | credential binding removed | restrict |
| Forced badge removal | reader/tamper failure | deny |
| Overdue device return | custody state overdue | restrict |

## API alignment

`LiveSignalGridAPI` follows the current `/api/v1` routes in `artifacts/api-server/src/routes/v1.ts`:

- context and tenant resolution;
- decisions and evidence;
- sessions;
- connectors and sync runs;
- policies and versions;
- audit chain;
- embedded app-workflow evaluation.

The tenant is derived from the bearer credential. The client never supplies a tenant identifier for object lookup.

## Embedded Assist model

`WardlinkDemo` mirrors `@workspace/app-workflows`:

- low-risk actions may proceed automatically;
- sensitive actions require host-app confirmation even when trust is established;
- step-up uses native local authentication;
- restricted or denied actions stay blocked;
- the host app owns all worker-facing copy;
- the client does not claim to complete a server-side security gate by sending a fabricated signal.

When native authentication is unavailable in a simulator, the app offers a separately labeled **demo verification** path. That fallback is explicitly not a security control.

## Visual alignment

The operator target maps the web product’s existing design system:

- warm charcoal/black surfaces;
- off-white typography;
- muted teal accent;
- green allow;
- amber step-up;
- orange restrict;
- red deny;
- compact enterprise evidence presentation.

Wardlink intentionally uses a familiar light-blue clinical host-app style instead of SignalGrid styling.

## Deliberate exclusions

This package does not add:

- production authentication configuration;
- live Entra/Intune calls;
- live credential-reader or locker integration;
- customer tenant data;
- PHI/PII;
- production enforcement;
- vendor certification or partnership claims;
- autonomous remediation.
