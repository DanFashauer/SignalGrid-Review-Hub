# Microsoft Graph — the launch-subset contract collection

**This is not a lab-lane collection.** Graph is the launch profile's one
`PRODUCTION_CONNECTOR_TARGET` (registry row
`microsoftgraph/msgraph-sdk-javascript`): there is no container to start,
and these requests answer only against a real Entra/Intune tenant the owner
authorizes. Never run in CI; nothing here executes without a pasted
application token.

## What is in it — and why exactly this

The three requests are the launch connector's REAL transport, transcribed
from `lib/integrations/src/integrations/graph/posture-connector.ts` — not
from the research report's wider proposal and not from memory:

| Request | Source line | Permission (application, least-privilege) |
| --- | --- | --- |
| `GET /deviceManagement/managedDevices?$top=1` | :75 (health probe) | `DeviceManagementManagedDevices.Read.All` |
| `GET /deviceManagement/managedDevices` (paged) | :92 | `DeviceManagementManagedDevices.Read.All` |
| `GET /users?$select=id,userPrincipalName,accountEnabled` | :85 | `User.Read.All` |

The machine form of that permission list is `permissions.json` beside this
file — the record a tenant admin consents from, and the record an assessor
checks the app registration against.

## What is deliberately NOT in it

The owner's research report proposed compliance policies
(`/deviceManagement/deviceCompliancePolicies`) and group membership
(`/groups/{id}/transitiveMembers`). The launch connector does not call
them, so this collection does not contain them — a request here asserts
"the product uses this", and it must not assert more than
`posture-connector.ts` does. When the connector grows a call, the request
lands here in the same commit (the collection tracks the transport, both
directions by review).

Cross-diffing this subset against `microsoftgraph/msgraph-metadata`'s
OpenAPI remains open on backlog row 30 — the full metadata artifact is too
large to vendor here, and fetching it belongs in a CI job, not a checkout.

## Fixture parity

`mock-transport.ts` in the same directory serves these exact paths to the
fixture pipeline, which is what `proof:evidence-adapter` drives — swap the
fleet/headwind/intune adapters and the decisions must not change. Live
tenant validation is a milestone that arrives with the tenant
(`docs/RELEASE_EVIDENCE.md` pattern: evidence when it exists, never before).
