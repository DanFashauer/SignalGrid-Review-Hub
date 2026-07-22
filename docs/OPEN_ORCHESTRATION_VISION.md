# Open orchestration — the vision, and its honest boundary

SignalGrid is a **central, open, smart-decision orchestration layer** for an
organization's infrastructure. It fuses endless read-only signals into decisions
and lets the workflows an organization configures carry out the response — so the
decision is made **on your behalf** (by the engineers, app developers, and product
owners who author the workflows), not by a person watching a screen. This page
records the direction and — just as importantly — the boundary, so nothing here
reads as an over-claim.

## Principles

1. **Open by default.** Everything outside the hardware stack and the docking-
   station embedded software is open. The platform exposes whatever the underlying
   systems *allow* — and where a vendor API can't reach within its limitations,
   SignalGrid **picks up the slack** (see `docs/SIGNAL_SOURCING.md`: the
   `grid_collected` path) so no part of the environment is left uncontrolled.
2. **One central brain.** A single place to orchestrate decisions across the whole
   building — access "and beyond" — instead of a dozen disconnected consoles. More
   signals in, sharper decisions out (`lib/posture-composition`,
   `lib/flows` grid-coverage).
3. **Config as code, GitOps-native.** Workflows and signal sourcing are declarative
   config, versioned in Git and validated in the CI/CD pipeline on every change —
   the operating model Fleet popularized for MDM, applied here to *decision
   orchestration* far above the hardware layer. Author → PR → CI validates → the
   Grid runs it. (`lib/flows` grid-config + `pnpm run proof:grid-config`.)
4. **Zero-touch, out-of-box.** A device powers on for the first time; by serial +
   network join the Grid can configure the entire device when other systems won't.
   A **Designer** and a **Device Action Recorder** in the mobile app capture what a
   setup should do once, so the end user doesn't have to. *(Roadmap — the
   config-as-code core below is the substrate it builds on.)*
5. **Total control, still simple.** The admin side manages everything, but it is
   never *another tool to babysit*. The easier a workflow is to build — start to
   finish, however large the infrastructure or complex the intent — the better.
   Simplicity is a feature, not a trade-off (`docs/ADMIN_DESIGN_PRINCIPLE.md`).

## What's built vs. roadmap

| Capability | State |
|---|---|
| Signal fusion → one verdict + one incident | Built (`lib/posture-composition`, `lib/incident-playbook`) |
| Configurable workflows + health/self-heal/approvals | Built (`lib/flows`) |
| Grid coverage — what the Grid handles on its own | Built (`lib/flows` grid-coverage, proof) |
| Signal sourcing — API / native / grid-collected / gap | Built (`lib/flows` signal-sourcing, proof, operator view) |
| **Workflows as code** — declarative config, CI-validated | Built (`lib/flows` grid-config, proof, operator view) |
| Zero-touch provisioning · Designer · Device Action Recorder | Built, simulated (`lib/flows` provisioning, proof, Device Recorder operator view); real apply stays owner-gated |
| Teardown-proof — prove the reversal before deploy | Built, simulated (`lib/flows` provisioning-teardown, proof); a recording is not deploy-ready until a dependency-ordered, fail-safe teardown is proven — see [Teardown-proof](PROVISIONING_TEARDOWN_PROOF.md) |
| Application resilience — work through cloud downtime, PHI-safely | Built (`lib/flows` app-resilience, proof, operator view) |
| Real write-back "act plane" (quarantine/lock/revoke) | Roadmap — approval-gated, simulated until an owner enables it |

## The honest boundary

- **Open-source scope** is the orchestration/decision platform and its config — not
  the proprietary hardware stack or dock embedded firmware.
- SignalGrid **does not replace** an MDM/UEM, IAM, XDR/SIEM, or ITSM; it orchestrates
  decisions across them. It reads signals (read-only connectors) and, where a
  vendor can't be integrated, collects a signal itself at a stated lower fidelity —
  it never claims to extract data a vendor doesn't expose without doing that lifting.
- "Decisions made on your behalf" means **the workflows you authored run
  automatically** — not an unbounded autonomous agent. Real enforcement stays
  simulated and approval-gated until an owner turns it on.
- No partnership, certification, or production-readiness claim is implied by any
  system named here. See `docs/WHAT_SIGNALGRID_DOES_TODAY.md` and
  `docs/PUBLIC_MESSAGING_GUARDRAILS.md`.
