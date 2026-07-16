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

## What this could turn into (future work — not built here)

- A **DDM / device-health signal connector** (fixture-first, like the existing
  Entra/Intune and DockBridge connectors) that normalizes DDM health reporting
  and binary-control/privacy posture into decision dimensions the core already
  understands (device compliance, baseline alignment, posture freshness).
- A mapping doc: which DDM/EndpointSecurity signals feed which decision
  dimensions, and where they raise assurance (e.g. an off-baseline binary-control
  state nudges a sensitive action from auto → step-up).
- A macOS desktop host-app demo showing the same invisible Assist flow the
  frontline mobile path uses (`docs/EMBEDDED_UX_PRINCIPLE.md`).

Tracked in `docs/BUILD_BACKLOG.md`. All future work stays fixture-first and
public-safe — no live MDM/vendor calls, no partnership or certification claims.
