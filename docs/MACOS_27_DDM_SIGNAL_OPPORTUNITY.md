# macOS 27 / DDM — new OS signal sources, and why they're tailwind

_Reading of the platform direction Apple set at WWDC 2026 (macOS 27), and what it
means for SignalGrid. This is an internal opportunity note, not a claim of any
partnership, certification, or endorsement. Specifics below track third-party
reporting and may change as the release finalizes; the architectural takeaway
does not depend on exact API shapes._

## What changed (as reported)

- **Native binary allow / deny** via the Endpoint Security framework — an admin
  can declare which apps and command-line binaries may execute on a managed Mac;
  anything off-list is stopped by the OS. An `AlwaysAllowManagedApps`-style key
  auto-permits MDM-deployed software.
- **PPPC → a declarative Privacy Management declaration** — the per-prompt
  TCC/PPPC flow is replaced by a single, admin-pre-configured privacy
  declaration (camera / microphone / Bluetooth / local network / location).
- **Declarative Device Management (DDM) becomes the standard** — binary control,
  the privacy framework, credential handling, and **health reporting** all ride
  on DDM rather than the legacy profile-push model.

Sources: [Stabilise](https://stabilise.io/blog/macos-27-mdm-binary-control-pppc-replacement-mac-admins),
[Jamf — WWDC26 takeaways](https://www.jamf.com/blog/wwdc26-key-takeaways-for-apple-admins/).

## Why this is tailwind for SignalGrid, not headwind

The distinction that matters:

| | macOS binary control (OS) | SignalGrid |
|---|---|---|
| Question | *May this binary run on this managed Mac at all?* | *Given who holds this shared device right now, in this workflow and posture, should this action proceed — and at what assurance?* |
| Scope | Static, device-scoped, launch-time | Dynamic, context-scoped, at the moment a workflow fires |
| Enforces | What can execute | Whether a sensitive **action** proceeds (allow / step-up / restrict / deny), inside the host app |

They answer **different questions on the same device**, so they compose:

1. **Complementary layers.** The OS decides what may launch; SignalGrid decides,
   per live session, whether a sensitive action inside a permitted app proceeds
   (the Assist model). On a shared or frontline Mac those are not the same
   question — SignalGrid covers the one device-scoped binary control cannot.

2. **New, high-quality signal sources — the biggest opportunity.** DDM **health
   reporting**, binary-control state, and the declarative privacy posture are
   exactly the kind of authoritative device signals the Grid ingests. This is
   the founding principle in action — *the more signals you add, the smarter the
   Grid becomes* — and it maps directly onto the signal-discovery / auto-onboard
   engine (`@workspace/signal-discovery`): a DDM/health source is one more thing
   the Grid detects, classifies, and onboards. macOS 27 effectively *manufactures
   new signals* for the decision core to fuse.

3. **Reinforces the embedded + desktop story.** The "no external Windows/Mac
   terminal — software runs on the dock" thesis is a hardware/custody-layer point
   and is untouched by how the OS manages binaries. And for the macOS/Windows
   desktop host-app path, the Assist decision layer lives inside the app
   regardless of the OS's binary-control policy.

## What's built

- ✅ **DDM / device-health signal connector** (`@workspace/ddm-connector`,
  fixture-first like the Entra/Intune and DockBridge connectors) — normalizes a
  DDM device report (enrollment, health reporting, binary-control state,
  declarative-privacy posture, last check-in) into the decision dimensions the
  core already understands:

  | DDM signal | → decision dimension |
  |---|---|
  | enrolled | `deviceManaged` |
  | health (healthy/degraded/unreporting) | `deviceCompliance` |
  | binary control (enforced/permissive/disabled) | `baselineCompliance` (enforced ⇒ aligned) |
  | last check-in + now | `postureFreshness` |

  Plus an **assurance hint**: any weak posture (not enrolled, binary control not
  enforced, privacy declaration incomplete, health degraded, or a stale/unknown
  check-in) sets `raise_step_up` — which can only move a sensitive action
  **auto → step-up**, never relax it (fail-closed, proven). Read API
  `GET /cp/v1/ddm`; proof:ddm-connector (run in CI).

## Update-enforcement currency — the OS-27 cutover fail-safe

macOS/iOS **27 makes legacy MDM software-update enforcement a silent no-op** — the
old command "doesn't fail; it's gone," so a device can keep *looking* managed and
reporting "compliant" while nothing is actually enforcing patches. That is exactly
the failure the Grid's core law exists for: **unknown / stale ≠ healthy.**

The connector models `updateEnforcement` (how a device delivers update enforcement)
against its `osMajor` and derives an `enforcementCurrency`:

  | Enforcement × OS | `enforcementCurrency` | Effect |
  |---|---|---|
  | `declarative` (DDM) | `current` | trusted — enforcement is live |
  | `legacy` on OS **27+** | `dead` | silently a no-op — "compliant" not trusted |
  | `legacy` on a known **pre-27** | `at_risk` | works now, dies on the upgrade |
  | `legacy` on an **unverifiable** OS | `at_risk` | can't confirm it still works — never `current` |
  | `none` | `dead` | nothing enforcing at all |
  | unreported / unmapped | `unknown` | fail-safe — cannot confirm |

Anything other than a provably `current` enforcement sets `raise_step_up`, so a
device that reports **healthy + enforced + declared + fresh** but is still on
legacy update enforcement under OS 27 **does not pass as standard** — the Grid
surfaces the silent drift as a decision instead of trusting a claim a dead
mechanism made. `ddmSummary` exposes `enforcementDead` / `enforcementAtRisk` for a
one-glance fleet view of the migration risk described in Apple's OS-27 rollout.

## Still open (future work)

- A macOS desktop host-app demo showing the same invisible Assist flow the
  frontline mobile path uses (`docs/EMBEDDED_UX_PRINCIPLE.md`).
- Wiring the DDM assurance hint into a live policy path (today it's a normalized
  signal + hint; a policy that consumes `baselineCompliance`/`postureFreshness`
  already reacts to it).

Tracked in `docs/BUILD_BACKLOG.md`. All future work stays fixture-first and
public-safe — no live MDM/vendor calls, no partnership or certification claims.
