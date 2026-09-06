# PIM Activation Live Runbook

## Purpose

`lib/pim-activation` is proven offline — `pnpm run proof:pim-activation` (51 checks), three exhaustive enumerations, zero
mismatches. None of that proves it works against a real tenant. This runbook is the
procedure for the first live test, and the honest list of what must be settled *before*
that test rather than discovered during it.

Everything here is operator-run from a private environment against a **sandbox tenant**.
Review Hub does not authenticate to Entra, does not call Graph in CI, and stores no
tenant credentials.

---

## Read this first: the failure mode that decides whether this is safe to pilot

Entra PIM's custom extension makes SignalGrid a **synchronous dependency of privileged
role activation**. That is the source of its value and of its only serious operational
risk, and they are the same property.

**Question that must be answered before any live wiring:** when the custom-extension
endpoint is unreachable, times out, or returns a malformed body, what does PIM do —
fail open (activate anyway), fail closed (refuse), or fall back to the configured
approver flow?

This is not a detail. If it fails **closed**, an outage of this service blocks every
emergency elevation in the tenant, and SignalGrid has made an incident worse at exactly
the moment it matters most. If it fails **open**, the control is advisory and the
security claim must be stated far more modestly.

The answer is a property of Microsoft's implementation, not of this code, and it is
**not recorded here because it has not been verified against a live tenant**. Verify it
in the sandbox — deliberately take the endpoint down and observe — and write the
observed behaviour into this file before any production consideration. Do not infer it
from documentation alone; preview behaviour changes.

Mitigations to have ready regardless of the answer:

- a documented **break-glass path** that does not traverse this extension (a separate
  eligible role, excluded from the custom extension, with heavy alerting);
- an availability target for the endpoint that is at least as strong as the tenant's
  expectation for role activation;
- alerting on extension error rate and latency, not just on decisions.

---

## Prerequisites

| Requirement | Why |
| --- | --- |
| Entra tenant with **PIM** (requires a P2-class licence) | Custom extensions are a PIM feature |
| A **sandbox** tenant with no customer, patient, or production data | Same boundary as every other live runbook here |
| An eligible role assignment to test with | The activation is what triggers the call |
| A publicly reachable HTTPS endpoint for the decision API | PIM calls *in*; this is not an outbound integration |
| Graph **beta** access | The custom-extension surface is preview |

**Verify the contract before building against it.** The three-outcome shape
(`Denied` / `Approved` / `AutoApproved`) and the request payload are taken from public
material, not from a tenant this repo has touched. Preview APIs move. Reconcile
`lib/pim-activation/src/types.ts` against Microsoft's current published schema as step
zero, and treat any mismatch as a blocker rather than adapting silently.

---

## Least privilege

The endpoint SignalGrid exposes is a **decision** surface. It needs no Graph write
permission, no directory role, and no ability to activate anything — PIM performs the
activation itself based on the answer. If a proposed configuration asks for
role-assignment write scope, that is a signal the design has drifted; stop.

Inbound authentication is the part to get right, because anything that can call this
endpoint can influence privileged elevation. Require the caller to be Microsoft's PIM
service and nothing else. Do not ship a shared secret in a query string. Do not rely on
network position alone.

---

## Sequence

1. Confirm the tenant is a sandbox and carries no production, patient, or private
   employee data.
2. Reconcile the request/response types against Microsoft's current beta schema.
3. Stand the decision endpoint up and confirm it is reachable over HTTPS with the
   inbound authentication enforced — verify an unauthenticated call is rejected *before*
   any PIM wiring exists.
4. Register the custom extension against **one** eligible role. Not a broadly-held one.
5. Confirm the break-glass path is in place and excluded from the extension.
6. Run the outcome matrix below.
7. Deliberately take the endpoint down and record what PIM does. Write the result into
   the section at the top of this file.
8. Remove the extension registration. Confirm activation reverts to normal PIM
   behaviour.

---

## Outcome matrix to verify live

Each row is already proven offline; the point of running it live is to confirm the wire
contract and that PIM enforces what it is told.

| Scenario | Expected | Proves |
| --- | --- | --- |
| Valid ticket, emergency change, verified on-call, device `ok`, signals fresh | `AutoApproved`, time-bound | The happy path is reachable; PIM honours an auto-approval |
| Same, but no valid change ticket | `Denied` | PIM honours a refusal |
| Same, but routine change | `Approved` → approver group | PIM honours a routing decision |
| **Valid P1 ticket, verified on-call, but device at `blocked`** | `Denied` | **The whole claim.** A ticket check alone cannot reach this |
| Device not onboarded / grid returns no signals | `Approved` | Absence of signal never auto-approves |
| Endpoint returns a malformed body | *unknown — record it* | Determines the fail-open/fail-closed answer |

The fourth row is the one to demonstrate to anyone evaluating this. Everything else PIM
and ServiceNow can already do between them.

---

## What to capture

- The exact request payload PIM sends, sanitized, converted to a fixture. If it differs
  from `PimActivationRequestRaw`, that is a real finding — fix the type, do not coerce.
- Observed latency. PIM is waiting on this call during a human's elevation attempt.
- The full audit trail Entra records for each outcome, to confirm the `explanation`
  string surfaces somewhere a responder will actually see it.

Sanitize before saving anything: no tenant ids, no principal ids, no ticket numbers, no
device identifiers. Discard raw output after fixtures are derived.

---

## Rollback

Removing the custom-extension registration returns activation to standard PIM behaviour
immediately. That is the rollback, and it should be rehearsed **before** the first real
activation attempt rather than during an incident — confirm you can remove it, and how
long it takes to take effect.

---

## Status

Not yet run. No live tenant has been connected to this code. Every claim in
`docs/INTEGRATION_CATALOG.md` about this dimension is an offline-proof claim, and the
catalog says so; keep it that way until this runbook has actually been executed and the
fail-mode section above has a real answer in it.
