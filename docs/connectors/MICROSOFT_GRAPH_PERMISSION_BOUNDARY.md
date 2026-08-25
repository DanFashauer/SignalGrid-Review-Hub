# Microsoft Graph permission boundary

The read-only Graph connector is one of the three families in Limited GA
(`scripts/launch-profile.mjs`). This page states the exact scopes it needs, so a
tenant administrator can grant them without guessing and refuse anything else.

**Rewritten 2026-08-25.** Every permission on this page until then was invented.
Fifteen names of the form `Placeholder.Graph.*` were listed as the connector's
permission set, and a search of the whole repository found them in exactly one
file — this one. None can be granted in any tenant. Meanwhile the real scopes
were sitting in the shipped connector three directories away. The page was
hedged as "intentionally generic placeholders", which is why it survived: the
hedge made a fictional list read as a deliberate one. An Entra administrator
handed it would have discovered inside a minute that nothing on it exists.

## What the connector reads

Two endpoints, both GET, both on `https://graph.microsoft.com/v1.0`, both in
`lib/integrations/src/integrations/graph/posture-connector.ts`:

| Endpoint | Why |
| --- | --- |
| `/users?$select=id,userPrincipalName,accountEnabled` | identity state for the decision |
| `/deviceManagement/managedDevices` | device compliance, management and registration state |

Only those three user fields are selected. The connector follows `@odata.nextLink`
paging with a bounded loop, and holds a read-only bearer token it never mints.

## Scopes to grant

| Scope | Needed for |
| --- | --- |
| `User.Read.All` | the `/users` read above |
| `DeviceManagementManagedDevices.Read.All` | the `/deviceManagement/managedDevices` read above |

These two are what the connector names in code (`posture-connector.ts`,
`lib/signalgrid-core/src/seed.ts`). Grant nothing else for this family.

A third scope, `User-LifeCycleInfo.Read.All`, is declared by the separate
`service-lifecycle` family (`lib/integrations/src/integrations/service-lifecycle/index.ts`).
That family is **deferred** under DR-005 and is not part of Limited GA. Do not
grant it for the posture connector.

## Writes

**There are none, and there is no approval path that enables one.** This
connector has no write path: it enrolls no device, assigns no policy, pushes no
profile, wipes nothing, disables no account and revokes no session. That is not a
configuration choice a deployment can flip — `check-connector-discipline.mjs`
fails the build on a mutating request in a connector family, and the NAC write
actuators that once existed were deleted rather than deferred
(`lib/integrations/src/integrations/nac/aruba-clearpass.ts`).

If a future family needs a Graph write, it arrives with its own decision record,
its own approval gate and its own page. It does not arrive by widening this grant.

## What a granted token still cannot do

Read-only scopes bound the blast radius but do not describe intent, so state it:
SignalGrid reads Entra and Intune evidence and replaces neither. It is not an
MDM, not an IdP, and not an EDR. Quarantine, policy change, Conditional Access
change, account disablement, session revocation and app deployment all remain
the owning system's job.

## Verify rather than trust this page

```bash
grep -rn "Read.All" lib/integrations/src/integrations/graph/       # the scopes in code
pnpm run proof:graph-connector                                     # read-only boundary proof
pnpm run proof:graph-wire                                          # throttling, 5xx, auth, malformed bodies fail closed
```

No gate currently reads this document, so nothing catches it drifting from the
connector again. That gap is recorded in `docs/COMPANY_BUILD_PLAN.md`.
