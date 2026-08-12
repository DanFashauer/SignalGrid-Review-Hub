# Partner Onboarding — bring your lab, then your tenant

The evaluation path is staged so the cheapest step comes first (plan §12,
lab-first). Each stage is optional-forward: a partner can stop at any stage and
still have seen the real product, because every stage runs the same decision
engine — `proof:evidence-adapter` fails the build unless Fleet-shaped,
Headwind-shaped, and Intune-shaped evidence decide identically.

Boundaries, stated up front: nothing in this repository is a production system;
verdicts are advisory at this tier; there are no credentials or customer data
here and none are ever required for stages 1–2. Any live integration happens in
a partner-controlled environment with separate owner approval.

## Stage 1 — the fixture demo (zero install, zero accounts)

What the [Demo Script for Partners](DEMO_SCRIPT_FOR_PARTNERS.md) walks: the
launch console against the served `/v1` API in fixture mode — synthetic
devices, real paging, real evidence digests, real audit chain, offline by
construction. This is the default state of the repository; there is nothing to
configure.

## Stage 2 — your own lab: self-hosted Fleet (open source, no Microsoft)

Fleet (fleetdm/fleet, MIT) is the named open-source lab source. The connector
is already shaped for Fleet's real REST API — `FleetClient.listHostPosture()`
reads `GET /api/v1/fleet/hosts` with an injected transport, and
`toHostReport` maps Fleet's own host JSON (`mdm.enrollment_status`,
`hardware_serial`, `seen_time`) into the evidence contract.

What a lab looks like (validated privately by the owner against Fleet v4.89.2
with a real `osqueryd` agent — see
[FLEET_LIVE_INTEGRATION.md](FLEET_LIVE_INTEGRATION.md) for the design
findings):

1. Stand up Fleet self-hosted (Docker Compose or built from source) with MySQL
   and Redis; enroll a host or two with osquery.
2. Point the connector at it: base URL + an API-only user's token, read-only.
   The public package deliberately ships **no live transport** — the committed,
   CI-gated evidence stays fixture-backed; a partner exercise injects its own
   transport out of tree, exactly as the owner's validation did.
3. Read host posture, watch the same normalization the fixture proof pins:
   an unenrolled or unsupervised host RAISES assurance (step-up), never lowers
   it; disk-encryption-off grades affirmatively noncompliant; a silent host
   goes stale → missing on the connector's own clock windows.

Known boundary, so nobody discovers it mid-pilot: Fleet **team transfer** (the
enforcement half) is a Fleet Premium feature — on open-source Fleet the API
returns 422 and the connector fails closed rather than claiming an enforcement
that did not happen. Evidence reads, which are what SignalGrid consumes, work
on open-source Fleet.

For shared rugged Android (scanners, kiosks), the Headwind-shaped lab fixture
demonstrates the same contract today; a live Headwind exercise would follow the
same pattern as Fleet's when a partner wants it.

## Stage 3 — the enterprise chapter: bring your Entra/Intune tenant

Microsoft Graph is the first enterprise production connector: read-only, and
off by default behind **three independently required gates** — remove any one
and everything falls back to fixtures:

| Gate | Setting |
| --- | --- |
| Deployment tier | `SIGNALGRID_TIER` in `beta` or `prod` (dev/alpha can never make a live vendor call) |
| Explicit switch | `SIGNALGRID_LIVE_INTEGRATIONS=true` |
| Credential | `GRAPH_ACCESS_TOKEN` — a read-only token (`DeviceManagementManagedDevices.Read.All` scope class); never committed, never stored in this repository |

To route the management-health grading through Graph as well, set
`DEVICE_MANAGEMENT_HEALTH_TRANSPORT=graph` (its default is a generic bridge —
a declared gap in the launch profile until the default flips).

Run shadow mode first: SignalGrid evaluates alongside your operators'
judgment; verdicts stay advisory; you compare the decision ledger against what
your team would have done. Wiring this is configuration, not code — the same
contract, the same engine, new provenance strings.

## The feedback loop

After any stage, we want three answers, in your words:

1. Which workflow did you evaluate, and did the verdict match what your own
   operators would have decided? Where it differed, which evidence was missing
   or wrong?
2. Which evidence source matters most to you next (Fleet, Headwind, Intune,
   Jamf, Omnissa, something else) — and which single screen earned or lost
   your trust?
3. What would have to be true for you to run this against a real workflow?

File it as a GitHub issue with the **Partner feedback** template
(`.github/ISSUE_TEMPLATE/partner-feedback.md`) so it lands in the intake
ledger with a recorded disposition — every submission gets an answer with a
reason, per the operating method — or send it directly to the owner if it
should stay private.
