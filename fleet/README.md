# SignalGrid × Fleet — deployable artifacts

Ready-to-apply Fleet config for the SignalGrid shared-device model. See
`../native/ios/FLEET_MDM.md` for the full blueprint (the posture→signal /
decision→Fleet-API loop, partnership rationale).

## Files
- `profiles/signalgrid-restrictions.mobileconfig` — supervised restrictions:
  ASAM authorization (kiosk-until-auth), released-device app allowlist, and
  **non-removable** install (`allowAppRemoval=false`).
- `teams/signalgrid-shared-devices.yml` — Fleet GitOps team referencing the profile.

## Apply
```bash
# 1. Local Fleet (needs a Docker runtime):
fleetctl preview

# 2. Point fleetctl at it, then apply the team + profile:
fleetctl apply -f teams/signalgrid-shared-devices.yml
```

## What can be verified where — read this before testing
| Capability | Where it can be tested |
| --- | --- |
| Fleet server + osquery posture (→ SignalGrid signals) | **This Mac** — enroll the Mac as a host once Fleet runs (Docker). |
| Pushing a config profile via API/GitOps | **This Mac** — apply to the enrolled Mac. |
| SignalGrid↔Fleet connector loop (posture in, profile out) | **This Mac** — code + stubbed/live Fleet API. |
| **Kiosk (ASAM), app allowlist, non-removable install** | **A real, SUPERVISED iPhone/iPad only.** Requires Apple Business Manager (ADE) + an APNs cert. The Simulator CANNOT be MDM-enrolled and these keys are ignored on unsupervised devices — no local automation substitutes for this. |

So: everything up to the connector is automatable here; the on-device enforcement
is a one-time hardware step (one supervised device) that no Mac/Simulator tooling
can stand in for. Edit `allowlistedAppBundleIDs` to your real host-app bundle IDs
before deploying.
