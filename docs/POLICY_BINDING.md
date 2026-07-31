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
| **Fleet** (teams; the enforcement client's config carried `normalTeamId` / `restrictedTeamId` before actuation moved to the private core — the package is not in this public tree) | teams | a device that should be on the RESTRICTED team running the normal team's profiles |
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
| bound + matched + clean membership + **enforcing** + clean parse | `none` — the grant | positively correct binding, behind a policy that acts |
| **unbound** (enrolled, in no policy group) | `restrict` | the device receives NO policy at all — affirmatively ungoverned |
| mismatched, binding **wider** than warranted | `restrict` | the fail-open case: more permissive policy than the device's properties justify, silently |
| mismatched, binding **narrower** | `monitor` | a fail-closed mistake — ops nuisance, not a trust hole |
| mismatched, direction unreadable | `step_up` | cannot confirm it is not the fail-open case |
| **mixed membership** (users inside a device group — the flow's own "device groups contain devices only" rule) | `alert` | policy targeting is broken at group scale, not for one device |
| bound correctly, policy in **report-only** | `monitor` | evaluates and logs; gates nothing. The binding is right and the device is unprotected |
| bound correctly, policy **disabled** | `restrict` | neither acting nor observing — in effect, no binding at all |
| any axis unknown | `step_up` | unknown raises, never grants |

The mismatch *direction* is deliberately moot when the binding is matched at the
NORMALIZED layer — it exists in service of a mismatch — and the enumeration pins
exactly that (648 normalized states, exactly 3 grant — one per direction value, and
none at all for the three non-enforcing modes). At the WIRE layer a report that
asserts a concrete direction alongside `matched` contradicts itself and is
malformed, so exactly 1 of 1,440 hostile raw reports grants.

## The enforcement axis — a correct binding is not protection

Being in the right group is necessary and not sufficient. Every management plane
ships a mode where a policy **evaluates without acting**, and recommends it as the
rollout stage:

| Plane | The non-acting mode |
| --- | --- |
| Entra Conditional Access | **report-only** — the policy evaluates on every sign-in, writes to the sign-in log, blocks nothing |
| Intune compliance policy | actions for noncompliance limited to *notify*, with no mark-noncompliant or CA block configured |
| Microsoft Defender ASR | **audit mode** |
| Update rings | a deferral/grace window whose deadline has not arrived, so nothing installs yet |

Staging a policy this way is correct practice — the guidance this dimension came
from says so in as many words ("test in report-only mode"). The failure is not the
mode; it is that a dashboard showing the device correctly bound reads as protection
it does not have. Before this axis, `bound_correctly` was exactly that claim: the
same unearned affirmative `response-accountability` grades in the ITSM plane, where
every process metric is green and the concern is still there.

So the axis reports what is TRUE of the device rather than what an operator meant:
report-only is a `monitor` finding (a fail-open one — it is listed in
`criticalFindings`), never a grant. `disabled` is `restrict`, because a policy that
neither acts nor observes leaves the device in the same posture as `unbound` and,
unlike report-only, is nobody's recommended stage.

An **absent** `enforcement` key normalizes to `unknown` → `step_up`, not to
`enforcing`. A plane that was never asked the question has not answered it, and
defaulting the silence to "yes" would reinstate the affirmative the axis exists to
withdraw. The allowlist also refuses `audit` — the vendor's own word for the same
thing — rather than guessing at a spelling nobody registered; the raw enumeration
carries that value specifically to pin the refusal.

## What produces `enforcement` — the honest boundary

Unlike `profile_match`, this one is **directly readable** from the planes rather
than inferred. Entra exposes a Conditional Access policy's state as a first-class
enum whose middle value is literally "enabled for reporting but not enforced";
Intune exposes a compliance policy's scheduled actions, so "notify only, nothing
blocks" is a fact about the policy object rather than a judgement. That is why this
axis is a normal read and not an already-resolved referee input.

The part that IS the caller's: a device bound to SEVERAL policies with MIXED modes
resolves to ONE reported value. The safe fold is the weakest — one report-only
policy in the set means the device is not fully covered — and the fabric cannot
enforce that from downstream, so it grades the value the plane reports, the same
way it grades `profile_match`. A bridge that folds by "any policy enforcing →
enforcing" would be manufacturing the affirmative this axis exists to withdraw.

## What produces `profile_match` — the honest boundary

No vendor API returns "matched / mismatched / wider / narrower" directly. Intune's
dynamic-group engine CONVERGES membership toward its rules rather than reporting a
disagreement; Fleet reports the team a host is on, not the team it should be on. So
the match verdict is an **already-resolved input** that requires an independent
referee — the tenant's expected-state rules (this repo's own IaC/GitOps desired
state is exactly such a referee), a reconciliation job comparing observed device
properties against the group's rule, or an operator's declaration. This dimension
grades that referee's output; it neither computes membership nor re-implements a
vendor's grouping engine, and a plane that only ever reports "matched" about itself
teaches this dimension nothing. Wiring it to a self-reporting feed and expecting
drift detection would be exactly the fail-open the dimension exists to catch.

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

Proven by `proof:policy-binding` (46 checks; targeted ladder checks, per-field integrity,
hostile shapes, both grant-safety enumerations, connector surface, fusion;
deterministic, offline).
