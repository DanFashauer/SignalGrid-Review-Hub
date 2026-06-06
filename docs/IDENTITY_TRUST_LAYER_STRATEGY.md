# Identity Trust Layer Strategy

SignalGrid treats identity systems as foundational signal sources, not as systems to replace. IAM authenticates identity, UEM/MDM proves device posture, RTLS/DockBridge proves physical and workflow context, and SignalGrid evaluates runtime trust by combining those signals into an auditable decision.

The Identity Trust Layer is the strategy for consuming IAM, IdP, MFA, IGA, and cloud-identity context so SignalGrid can decide whether a runtime access, shared-device, or frontline workflow should be allowed, stepped up, reviewed, restricted, or denied.

## Core framing

Identity platforms answer who the user is and which identity controls have already evaluated the session. SignalGrid answers whether that authenticated identity should proceed in the current runtime context.

```text
Identity context
  + device posture
  + session state
  + workflow context
  + physical/shared-device context
  -> SignalGrid runtime trust decision
  -> allow / step-up / review / restrict / deny
  -> audit evidence
```

The first practical proof should remain **Entra ID + Intune** because it combines identity, Conditional Access context, and device posture in a single Microsoft path that can be validated with deterministic Graph-backed or fixture-backed evidence before broader connector work begins.

## Candidate identity systems

SignalGrid should document these systems as candidate identity, governance, and cloud-context sources:

- Microsoft Entra ID.
- Okta.
- Ping Identity.
- Duo.
- SailPoint / IGA.
- Auth0.
- Keycloak.
- AWS IAM.
- Google Cloud IAM.
- Azure AD B2C / External ID.

These candidates should not be presented as current production integrations unless a working, validated connector exists. They are roadmap-aligned signal sources for identity trust evaluation.

## Identity signals SignalGrid may consume

Depending on connector maturity and customer-authorized scope, SignalGrid may consume:

- User ID.
- Group or role.
- MFA status.
- Conditional Access result.
- Risk level.
- Privileged identity state.
- Access review or certification state.
- App assignment.
- Session state.
- External or guest identity type.

SignalGrid should normalize these inputs into decision evidence while preserving each connected identity system as the authoritative source of record.

## Runtime decision examples

Identity signals become valuable when combined with posture, session, workflow, and physical context. Example decision patterns include:

| Runtime context                                            | SignalGrid outcome |
| ---------------------------------------------------------- | ------------------ |
| User authenticated + compliant device + approved workflow. | Allow.             |
| High-risk user + stale posture.                            | Step-up or review. |
| Privileged role + unknown device.                          | Deny or review.    |
| Access review failed + shared-device session.              | Deny or restrict.  |

These examples are strategy patterns, not production policy defaults. Private-core implementation should make policy rules explicit, testable, explainable, and tenant-scoped.

## Boundaries

SignalGrid must keep identity ownership boundaries explicit:

- SignalGrid does not replace IAM, IdP, SSO, MFA, IGA, or PAM.
- SignalGrid consumes identity context and makes runtime orchestration decisions.
- Existing IAM, IdP, IGA, MFA, PAM, and cloud-identity systems remain systems of record.
- SignalGrid should not store secrets, privileged connector credentials, tenant identifiers, or customer identity data in the public repo.
- SignalGrid should not claim autonomous identity remediation, production Conditional Access changes, or production identity governance actions from Review Hub artifacts.

The safe public message is: IAM authenticates, governance systems certify, UEM/MDM proves posture, physical/workflow systems add context, and SignalGrid evaluates runtime trust with evidence.

## Sequence

The Identity Trust Layer should progress in this order:

1. **Entra ID + Intune first proof**: validate identity plus device posture using Microsoft Graph / Graph SDK reads or deterministic public fixtures.
2. **Okta / Ping / Duo follow-on**: add broader IdP and MFA context after the Microsoft path proves the normalized signal and decision model.
3. **SailPoint / IGA governance later**: add access review, certification, and entitlement-governance context after runtime identity/posture proof is stable.
4. **Cloud IAM later**: evaluate AWS IAM and Google Cloud IAM context once enterprise identity and device posture flows are grounded.
5. **MCP / agentic connector later**: consider MCP-style or agentic identity connectors only after deterministic read-only connectors, simulation boundaries, approval gates, and audit evidence are validated.

## Validation expectations

Identity Trust Layer work should preserve the existing first-proof validation path:

```bash
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
git diff --check
```

The validation goal is to prove that strategy documentation strengthens the Entra + Intune path without widening the public repo into unsafe production claims.
