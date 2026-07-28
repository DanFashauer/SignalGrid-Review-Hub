# Infrastructure-as-Code / GitOps — the primary operating model

SignalGrid manages endpoints the way modern platform teams manage everything
else: **declaratively, in version control, through pull requests** — not by
clicking through an MDM console. Device configurations, compliance rules,
software packages, and the decision policies that gate them all live as
version-controlled files. Changes roll out through review and approval, and the
system continuously checks that the fleet still matches what Git declares.

This is the `@workspace/iac` engine. It is deliberately **not** a Terraform
clone. It adds the two things a trust fabric — and only a trust fabric — can:

1. **The apply is trust-gated.** A declared change does not simply roll out; it
   rolls out *through the decision fabric*. An apply is refused unless a live
   trust decision returns `allow`. A `restrict`, `deny`, or the fail-closed
   `unknown` blocks the rollout.
2. **Drift is a signal, not just a report.** The gap between declared desired
   state and observed fleet state feeds the self-audit checklist and the posture
   engine, so configuration drift degrades trust the same way a missing security
   signal does.

## Where SignalGrid sits

SignalGrid is not another MDM. **Fleet, Microsoft Intune, and Jamf are the
declarative backends** — the systems that actually push a profile to a device.
SignalGrid is the trust-and-governance layer *in front of* them: it holds the
desired state in Git, plans the diff, gates the rollout on a real decision, and
drift-checks the result. It complements a Fleet GitOps repo or a Terraform+Intune
module; it does not replace or compete with one.

```
 Git (desired state, YAML/JSON)
        │  plan  (diff desired ↔ observed)
        ▼
 SignalGrid rollout  ──approve (human ref)──▶ trust gate (allow?) ──▶ apply
        │                                                              │
        │  drift detector (declared ↔ observed) ──▶ self-audit + posture
        ▼
 Fleet / Intune / Jamf  (the declarative backend that actuates the change)
```

## The declared resources

A desired state is a list of resources; each has a `kind`, a stable `id`, and a
flat string `spec` (what a compiled GitOps document reduces to). Anything outside
the known kinds is **refused at parse time**, never silently ignored — a
silently-dropped resource would read as "nothing to do" and mask a real
divergence.

| Kind | What it declares |
| --- | --- |
| `enrollment_profile` | Supervision / enrollment / removability posture |
| `compliance_policy` | Disk encryption, screen lock, OS floor, … (sensitive) |
| `config_profile` | Wi-Fi, restrictions, certificates, … |
| `software_package` | Managed app + version + update policy |
| `decision_policy` | The trust rules SignalGrid itself evaluates (sensitive) |
| `app_allowlist` | The OS-enforced allowed-apps set for a released device |

## The governed rollout lifecycle

```
draft → planned → pending_approval → approved → applied
                                   ↘ rejected
   (any) → superseded
```

Two guarantees stack, both fail-closed:

- **A rollout cannot apply itself.** `applied` is reachable only from `approved`,
  and `apply()` independently re-checks that the carried approval has a non-empty
  approver reference — so a hand-forged `{status:"approved", approval:null}`
  still cannot apply. This is the "peer review before rollout" workflow encoded
  as state (the same human-gate invariant as `adaptive-proposals` and
  `self-audit`).
- **The apply is trust-gated.** Even a fully approved rollout applies only when
  the live decision outcome is `allow`. Every other outcome —
  `step_up` / `restrict` / `deny` and the fail-closed `unknown` — blocks it. The
  proof sweeps all five trust outcomes and asserts **exactly one** (`allow`)
  releases a rollout.

Approvals carry a reference to the approver and a monotonic sequence handle,
never a wall-clock — determinism stays provable end to end.

## Drift as a signal

`detectDrift(desired, observed)` classifies every resource:

- **in_sync** — observed matches declared.
- **drifted** — present but a field diverged (the changed fields are reported).
- **missing** — declared in Git but absent on the fleet (the worst: the control
  isn't there at all).
- **unmanaged** — present on the fleet but not declared in Git.

Aggregation is worst-status-wins. `toProbeResults()` projects the report into the
self-audit vocabulary (`missing → broken`, `drifted`/`unmanaged → drifted`,
`in_sync → healthy`), keyed `iac:<kind>:<id>`, so the self-aware checklist and
the posture engine consume drift directly.

## Platform honesty

In this public reference repo the plan/apply/drift surfaces are **fixture-backed
and deterministic** — no live MDM is called. Real actuation happens through the
backend's own API on a **supervised** device: Fleet's REST API / `fleetctl
gitops`, the Intune Terraform provider, or a Jamf CI/CD pipeline. SignalGrid
plans, gates, and drift-checks; the MDM enforces. On-device enforcement (kiosk,
app allowlist, non-removability) is an OS/MDM capability and cannot be claimed
from a simulator.

## Proofs and surfaces

- `pnpm run proof:iac` (65 checks) — plan/diff correctness and determinism,
  validation fail-closed (unknown kind / duplicate / empty id / malformed spec
  refused), the governed lifecycle, the trust gate (every non-`allow` outcome
  blocks), drift classification and worst-status-wins, and the self-audit
  projection. The negative controls carry the weight: the proof asserts the
  *unsafe* paths are refused, not just that the happy path works.
- `GET /api/cp/v1/iac` — the demo plan + drift status over the public-safe
  fixtures (`DEMO_DESIRED_STATE` vs `DEMO_OBSERVED_STATE`).

## References

- Fleet: Infrastructure as Code + GitOps (`fleetdm.com/infrastructure-as-code`,
  `fleetdm.com/docs/rest-api/rest-api`)
- Microsoft Intune + Terraform provider; Jamf Pro + Git/CI-CD
- Hexnode: provisioning kiosk fleets via API
