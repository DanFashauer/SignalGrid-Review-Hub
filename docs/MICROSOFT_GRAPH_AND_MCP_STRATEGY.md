# Microsoft Graph and MCP Strategy

Microsoft Graph / Graph SDK is the first proof path for SignalGrid's Microsoft identity and posture work. MCP-style and agentic connector surfaces are later strategy, not the first proof.

## First proof path: Microsoft Graph / Graph SDK

The first concrete proof remains:

```text
User/device identity
  -> Microsoft Graph / Entra ID / Intune posture read, or deterministic public fixture
  -> normalized SignalGrid identity + posture signal
  -> runtime trust decision input
  -> allow / step-up / deny / unknown candidate outcome
  -> audit evidence
```

For production-facing proof design, prefer Microsoft Graph v1.0 endpoints and Graph SDK / REST reads for deterministic Entra ID identity context, Intune posture, and compliance context. Microsoft Graph beta APIs may be useful for exploration, but Review Hub must not depend on beta APIs for production-facing claims.

Graph SDK / REST should come before MCP for these identity and posture-read concerns:

- User and device lookup.
- Group/role context where authorized.
- MFA, Conditional Access, risk, or session context where available and appropriately scoped.
- Compliance state.
- Management state.
- Last check-in and freshness classification.
- User/device relationship where available.
- Audit-ready source evidence and request correlation.

The eventual backend connector design should use app-only Microsoft Graph authentication when a service needs to read identity or posture without a signed-in operator. That belongs in private-core or sandbox implementation, not in this public repo.

## Later path: Microsoft MCP / enterprise MCP

Microsoft MCP or enterprise MCP-style endpoints are a future agentic connector path. They should not become the first proof, and they should not displace Microsoft Graph as the deterministic identity/posture-read foundation.

Future MCP framing, if validated, should stay limited to:

- Read-only investigation.
- Bounded tool/action requests.
- Simulation before execution.
- Operator approval.
- Audit records.
- Policy-bound permissions.

## SignalGrid principle

SignalGrid should keep a clear source-of-record boundary:

```text
Graph reads trusted Microsoft source data.
Entra ID authenticates identity.
Intune proves posture.
SignalGrid normalizes and decides.
MCP/agents may assist later.
Operators approve risky actions.
Existing systems execute.
SignalGrid records evidence.
```

That means Microsoft Entra ID remains authoritative for identity and Conditional Access context, while Microsoft Intune remains authoritative for device and compliance context. SignalGrid consumes, normalizes, evaluates runtime trust, and records; it does not replace Microsoft Graph, Intune, Entra ID, Conditional Access, MFA, IAM, IGA, PAM, or device-management systems. See [Identity Trust Layer strategy](IDENTITY_TRUST_LAYER_STRATEGY.md) for the broader identity roadmap.

## Public-repo guardrails

Review Hub must preserve these constraints:

- No production tenant calls in the public repo.
- No Microsoft credentials, tenant IDs, client secrets, certificates, or customer identifiers.
- No customer data.
- No autonomous remediation.
- No production-ready claims.
- No replacement claims.
- No claim that Microsoft MCP integration exists today.

## References for future implementation planning

Use official Microsoft documentation when moving from fixtures to private sandbox design:

- Microsoft Graph SDK overview: https://learn.microsoft.com/en-us/graph/sdks/sdks-overview
- Microsoft Graph versioning and support: https://learn.microsoft.com/graph/versioning-and-support
- Microsoft Graph beta endpoint reference: https://learn.microsoft.com/graph/api/overview?view=graph-rest-beta
- Microsoft identity platform app-only access: https://learn.microsoft.com/azure/active-directory/develop/app-only-access-primer
- Microsoft Graph SDK authentication providers: https://learn.microsoft.com/graph/sdks/choose-authentication-providers/
