# Executive One-Pager

**Contact:** Dan Fashauer, Founder — hello@signalgrid.app · signalgrid.app

**Status:** rewritten 2026-08-23 to `docs/POSITIONING.md` (ratified 2026-08-22),
DR-012 (market) and DR-013 (proof doctrine). The previous version predated all
three and is superseded in every section — it used a retired product label,
named four deferred signal families as connected capability, targeted buyers
"regardless of company size", and described the proof as synthetic when live
open-source proof already existed.

SignalGrid is **an access-decision service** embedded invisibly in the apps your
staff already use on shared frontline
devices. Before a sensitive action, the host app asks and gets one answer:
allow, step_up, restrict, or deny. Your existing systems remain the systems of
record; SignalGrid reads their evidence read-only and writes to none of them.

## What it decides on

Three signals, all read from one source — your device-management evidence:

1. **Device compliance**, read-only from your management plane.
2. **How current that compliance answer really is.** A stale "compliant" is the
   unearned affirmative in its purest form, so freshness is a signal in its own
   right rather than a footnote on the first one.
3. **Whether the device may act on its own authority right now.**

Anything SignalGrid cannot verify **tightens** the answer instead of waving it
through. That direction is not a policy choice a customer can invert; it is
enforced structurally and checked on every build.

Every verdict carries reproducible evidence an operator can audit.

## Who it is for

Organizations with **limited IT staff or limited resources** — roughly
75–1,000 employees and 1–10 people in IT — running shared or roaming frontline
devices across a mixed vendor stack. That segment feels the problem most and
has the least capacity to build around it. This is deliberately not
Fortune-500 procurement; the product scales up later, from customers, rather
than starting there.

Also relevant: design partners and pre-seed investors assessing whether a
deterministic, fully auditable decision layer is a real category.

## The problem

Shared and frontline workflows fail because no single system sees the whole
picture at the moment that matters. Identity knows who logged in. Device
management knows posture, at some point in the past. Neither answers the
question the workflow actually asks: *should this action, on this device, right
now, proceed?*

Today that judgement is stitched together per application, inconsistently, with
no single verdict and no single audit trail. Every new tool answers with another
console to check. SignalGrid answers with a decision — one word, with the
evidence attached — consumable by any host app in any industry that has this
flow.

## Proof status

The decision core is deterministic and fixture-backed. It has been proven **live,
end to end, against real open-source systems** — Fleet (TLS with a real osqueryd
agent), Keycloak, FreeRADIUS and Wazuh — each driven by a committed proof, run on
the maintainer's lab hardware (the Mac live-lane, `scripts/run-live-lanes.sh`). In
CI, the in-process OIDC provider proof runs on every build; the live-server proofs
refuse to pass without a provisioned server rather than run against nothing, so
they are lab-verified, not CI-continuous. Microsoft Entra/Intune is implemented
and wire-hardened as the enterprise connector and is on the roadmap awaiting a
customer tenant.

The reasoning is deliberate: if the gateway holds against open-source systems
anyone can stand up and inspect, there is no mechanism by which a commercial
platform of the same shape would behave differently — and it means no part of
the proof waits on a purchased licence. Every figure here is machine-checked;
the repository's gate suite fails the build rather than let a claim drift.

## What is deliberately absent

Location, badges, custody, network and threat signals are **real and proven in
the public repository, and are not Limited GA**. They are roadmap, and they are
described that way everywhere or not at all — a rule enforced by a gate, not by
good intentions.

## Boundaries

SignalGrid is not an MDM: it never enrolls, configures, locks or wipes a device,
and it cannot enforce anything on the device itself — enforcement is your MDM's
job on a supervised device. It is not an identity provider: it authenticates
nobody and runs no MFA; when it returns step_up, your app satisfies that with
your existing authenticator. At Limited GA it conducts no challenge itself and
operates in shadow mode. It is not an EDR or a SIEM: it detects nothing and
investigates nothing.

Domain safety — patient lookup, clinical rules, and the like — stays in the host
application. SignalGrid answers only whether this device, in its current state,
should proceed.

## What is not claimed

No production readiness, compliance certification, regulatory approval, vendor
partnership, marketplace certification, endorsement, acquisition outcome,
valuation, or financial promise. For regulated verticals, a human compliance
review is required and is not something this project substitutes for. Live
integrations against a customer's own systems require separate sandbox
validation and the owner's approval.

**Limited GA target: 2027-02-04.**
