# Policy binding — membership IS the policy

## Where this came from

The Intune endpoint-onboarding flow: users go into an enrollment group; enrolled
devices are placed into **dynamic device groups** (rules over OS type, ownership,
management type) or **enrollment-profile groups** (Android Fully Managed / COPE,
kiosk); and then *"policies are assigned to security groups, not to each device
one by one."* The decision-relevant heart of that design: **a device's group
membership decides every policy it receives.** Get the binding wrong and the
wrong policies apply *silently* — nothing errors, the device even reports
"compliant", but it is compliant with the wrong bar.

## The same mechanism in every system this repo documents

The user's ask was exactly right: every management plane in this fabric's
documented estate has the same binding under a different name, with the same
failure modes.

| System (as documented here) | The binding | Fail-open drift looks like |
| --- | --- | --- |
| **Intune / Entra** (`graph`, `device-management-health`) | dynamic device groups + enrollment-profile groups | corporate supervised device sitting in the BYOD group |
| **Fleet** (`fleet-connector` — its config literally carries `normalTeamId` / `restrictedTeamId`) | teams | a device that should be on the RESTRICTED team running the normal team's profiles |
| **Apple ABM / DDM** (`ddm-connector`, `macos-posture`) | ADE enrollment profile + declaration assignment | a shared kiosk iPad enrolled through the 1:1 profile, missing the shared-device declarations |
| **Jamf** (documented candidate path) | smart groups | a clinical iPad falling out of its smart group when an inventory attribute goes stale |
| **PACS** (`pacs-access`) | access levels / clearance groups | a decommissioned badge still in the pharmacy access level |
| **IdP / Entra CA** (`identity-risk`, `pim-activation`) | user security groups + Conditional Access scoping | a frontline account in a group excluded from MFA policy |
| **WMS / task plane** (`task-exception`, `work-context`) | queue and zone assignment | a picker device receiving another zone's task queue |
| **EDR** (`edr-threat`) | sensor policy groups | a server sensor in the workstation policy group (weaker rules) |
| **SignalGrid itself** (per-vertical policy bundles, `flows`) | the vertical's policy bundle | a warehouse device evaluated under the retail bundle — the fabric's own binding is subject to exactly the same drift |

## The dimension

`policy-binding` (`@workspace/integrations/policy-binding`) grades the binding
uniformly, from the management plane's OWN report — the plane re-evaluates its
rules against the device's observed properties (as Intune's dynamic groups do
continuously); this dimension **never re-implements a vendor's grouping engine**,
it grades the reported outcome:

| Observation | Verdict | Why |
| --- | --- | --- |
| bound + matched + clean membership + clean parse | `none` — the grant | positively correct binding |
| **unbound** (enrolled, in no policy group) | `restrict` | the device receives NO policy at all — affirmatively ungoverned |
| mismatched, binding **wider** than warranted | `restrict` | the fail-open case: more permissive policy than the device's properties justify, silently |
| mismatched, binding **narrower** | `monitor` | a fail-closed mistake — ops nuisance, not a trust hole |
| mismatched, direction unreadable | `step_up` | cannot confirm it is not the fail-open case |
| **mixed membership** (users inside a device group — the flow's own "device groups contain devices only" rule) | `alert` | policy targeting is broken at group scale, not for one device |
| any axis unknown | `step_up` | unknown raises, never grants |

The mismatch *direction* is deliberately moot when the binding is matched — it
exists in service of a mismatch — and the enumeration pins exactly that (162
normalized states, exactly 3 grant; 288 hostile raw reports, exactly 3).

## Boundaries

- **Read-only.** Moving a device between groups/teams stays with the management
  plane (and, for Fleet team transfer, requires Fleet Premium — a documented
  licensing gate). Fixture-gated like every connector.
- **The flow's automation is the vendor's job; grading it is ours.** Intune's
  "automatic categorization, less manual work" outcomes are real — and they are
  exactly why the failure mode is silent. Automation that puts devices in groups
  automatically also puts them in the *wrong* group automatically when a rule,
  attribute, or profile drifts.
- Registered with the mutation guard from day one (TARGETS, zero survivors), not
  queued.

Proven by `proof:policy-binding` (targeted ladder checks, per-field integrity,
hostile shapes, both grant-safety enumerations, connector surface, fusion;
deterministic, offline).
