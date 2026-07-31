# Shift context — the right time and site for this worker to be operating

## The gap this closes

SignalGrid's premise is shift workers on shared, badge-checked-out devices — yet
nothing in the fabric consumed the **labor plane**. The custody dimensions know
which badge holds the device; `access-governance` knows the account is alive and
not a leaver; PACS knows the door opened inside the badge system's own permitted
hours. None of them can say what a workforce-management system (UKG, Dayforce,
ADP and their peers) already records: whether this worker is **scheduled** to be
working right now, whether they are **on the clock**, and **where** the shift
places them.

A worker operating a controlled workflow while clocked out is either working off
the clock — a labor-law exposure the employer is liable for — or is not the
person the badge says. Both deserve a step-up, and until this dimension neither
was representable.

## What it grades

Three questions, on one worker at one instant:

| Question | Axis | How it is answered |
| --- | --- | --- |
| Scheduled to be working now? | `scheduleStanding` | **derived** — the WFM's reported shift window against a caller-supplied reference instant; never a believed `on_shift: true` boolean |
| On the clock? | `punchStatus` | the WFM's own punch record, read as an **allowlisted enum** — the one trusted axis, because the WFM is the source of truth for punches; an unlisted spelling is malformed, never coerced |
| At the scheduled site? | `siteMatch` | two strings compared by case/whitespace fold, only when the **caller poses the question** by supplying the device's site |

The headline derivation is the **coherence** of schedule × punch:

| Observation | Verdict | Why |
| --- | --- | --- |
| on shift + clocked in (+ site matched or unposed) | `none` — the grant | the labor plane agrees: right time, right place |
| scheduled NOW and **clocked out** | `step_up` | off-the-clock work, or someone else's badge — a challenge resolves both |
| neither scheduled nor punched in, yet operating | `step_up` | the strongest wrong-time signal — still a step_up, **not** a restrict: an emergency call-in is legitimate, and a challenge resolves it where a block would strand them mid-crisis |
| clocked in **outside** any reported window | `monitor` | real overtime and early starts happen — visible, never blocked |
| on break | `monitor` | carried, so controlled work on break is attributable |
| the shift places the worker at a **different site** | `step_up` | floating staff are real; so are borrowed badges |
| any axis unknown, malformed report, no WFM record | `step_up` | unknown raises, never grants; agency/contract staff outside the WFM are an honest hole, not a pass |

The grant requires **five affirmative clauses**: clean parse + covered + on
shift + clocked in + a site answer of `matched` or `unassessed`. Not one clause
has the form `!== bad`.

## No clock in the decision path

The schedule axis is deterministic on three **supplied** inputs: the WFM reports
the window, and the caller supplies the reference instant — `Date.now()` never
runs. The proof pins the temporal point directly: the same record grades a grant
at 14:00 and `OFF_DUTY_OPERATION` at 03:00 the next day; nothing about the
worker changed, only the instant.

Window boundaries are inclusive on both ends and there is **no grace allowance**
— an allowance is a tuned number, and this dimension has none. A worker punching
in a few minutes early reads as an unscheduled clock-in, which is the
non-blocking `monitor` rung, not a refusal. A window that ends before it starts
is a wire-level contradiction (`malformed`), and a future-shaped or unreadable
asserted instant is an assertion we could not read, distinct from silence.

## The site question is posed, never presumed

`unassessed` (the caller supplied no device site) is carried on the record and
does **not** foreclose the grant — nobody claimed a match, and that fact is
visible rather than defaulted. A **posed** question the WFM cannot answer
(`scheduled_site` absent) is `unknown` and raises. Matching is equality after
case-folding and whitespace collapse — no geo inference, no site-name aliasing.

## What this deliberately does not do

- **It never says who is holding the badge.** Custody (`rtls-custody`,
  `custody-beacon`, badge-binding) owns that; this dimension only says whether
  the labor plane agrees with the moment.
- **It never grades role fit.** `scheduled_role` is carried as evidence;
  entitlements are `access-governance` and core RBAC.
- **It touches nothing payroll-adjacent.** No hours totals, no pay, no
  punch writes — reading a schedule is not managing one. The connector is
  GET-only with the same tier + `SIGNALGRID_LIVE_INTEGRATIONS` + credential +
  injected-transport gate as every family, and ships no transport.
- **It never lowers.** A confirmed labor context contributes `none`; every
  other dimension still fires alongside it.

Field naming follows the HR Open Standards vocabulary (worker, shift, punch,
site) so a future canonical-schema mapping is a rename, not a redesign.

Proven by `proof:shift-context` (50 checks; the coherence ladder, both
derivations asserted directly, the posed/unposed site split, hostile wire
shapes, the live-call gate clause by clause, both grant-safety enumerations,
fusion; deterministic, offline).
