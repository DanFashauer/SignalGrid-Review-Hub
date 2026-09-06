# Glossary — the house idiom, defined once

Backlog row 21. The corpus is written in a private dialect; this page is the
decoder. Definitions describe how the words are USED HERE, which is sometimes
narrower than the industry sense. Kept alphabetical; a term nobody uses
anymore gets deleted, not curated.

**Absence check** — `pnpm run check:absence <topic>`: four differently-shaped
probes before any document may claim "X does not exist." One empty grep is
evidence of one grep.

**Allow / step_up / restrict / deny** — the four decision outcomes the Assist
gate returns. Nothing else escapes the engine.

**Assist gate** — a mechanism, not the product's name: the deterministic decision a
HOST app consults before a sensitive workflow proceeds (allow / step_up / restrict /
deny). SignalGrid is invisible to the end user; the host app owns the user
experience. `docs/PURPOSE.md` §2 owns the product sentence (DR-020).

**Assurance** — the engine's internal confidence requirement. An unknown or
unreachable signal RAISES the assurance required, never lowers it — that
asymmetry is the core doctrine.

**Breadth freeze** — the standing rule that scope does not widen (no new
verticals, connectors, platforms) without ratification. It is enforced by the
launch profile's classification bijection, whose revision is
`LAUNCH_PROFILE_VERSION` in `scripts/launch-profile.mjs` — **v5** today, and read
from there rather than typed here, because this line said "Currently v4" after
DR-023 had already carried it to v5. **Not to be confused with the engineering
freeze, which DR-021 lifted in full on 2026-08-31**: claim discipline and the
classification bijection are unchanged and were never the freeze. Its
purpose is not austerity; it is that every extra surface is another thing
that can silently rot.

**Byte-faithful port** — `DecisionEngine.swift` and `AppWorkflows.swift` are
byte-for-byte ports of the TS simulator. Parity IS the feature; behavior
changes go around them, never into them.

**Connector discipline** — the gate family that enumerates every connector
evaluator and proves each handles unknown, stale, and malformed input
fail-closed. Its `KNOWN_GAPS` list is a declaration, not an excuse.

**Contradiction** — two fresh sources disagreeing about the same subject. The
most valuable state SignalGrid detects: the answer is RESTRICT plus a route
owner, never a coin flip.

**Decision record (DR)** — a numbered entry in `DECISION_RECORDS.md` that
makes a choice reviewable and reversible. Mutation authority, custody,
scope — anything that would otherwise live in chat history.

**Declared gap** — a known limitation written down WHERE A GATE READS IT, so
it cannot silently become a permanent feature of the landscape.

**Doctrine proof** — one of the proofs under `verify:breadth` that pins a
safety doctrine (fail-closed, unknown-raises-assurance) rather than a
feature.

**Embedded UX law** — golden rule 3: the worker uses their own host app;
domain safety belongs in the host, not in SignalGrid.

**Evidence classes** — the three ratified kinds of evidence the launch engine
consumes: `device_posture` (what state the device is in),
`device_management_health` (whether the management source itself is alive
and current), `local_authority` (who/where/what is present RIGHT NOW).

**Fail-closed** — when anything is missing, stale, or contradictory, the
decision tightens. The opposite default — assuming absent means fine — is
the defect class the whole repo exists to prevent.

**Fossil figure** — a number typed into prose that a later run no longer
produces. Guarded by `check:proof-counts` and the docs↔proof figure guard —
within their shape: the figure guard's `FIGURE_RE` matches only comma-formatted
values ≥ 1,000, and it says so on every run ("NOT checked — out of SHAPE"), so a
small integer such as "42 cases" or "7/7" is outside it. The cure is deriving
figures from runs, not updating them by hand.

**Freshness** — evidence carries `observedAt` and a validity window; a stale
observation is not evidence of the present. "The MDM said healthy" always
has an implicit "as of when?"

**Gate** — a script CI runs that can FAIL. A gate registered in preflight but
not CI is not a gate. A gate that cannot be made to fail proves nothing
(see unfalsifiable guard).

**Golden rules** — the four non-negotiables at the top of `CLAUDE.md`:
byte-faithful ports, fail-closed determinism, embedded UX, platform honesty.

**Grant safety** — the proof family asserting that no path exists where an
UNKNOWN subject earns the word "trusted" or any grant. An "unearned
affirmative" is its failure mode.

**Heartbeat** — the file a standing routine writes on EVERY fire, including
quiet ones, so "ran and did nothing" is distinguishable from "never ran."

**Host app** — the customer's own application (clinical, warehouse, field)
that consults the Assist gate. SignalGrid ships no end-user surface.

**Lane** — one working context: the cloud session, the Mac session, a role
session (Core/Native/Reviewer/Scribe per `docs/agent/ORG.md`). Lanes
coordinate through committed artifacts, never through assumption.

**Lane messages** — git-carried mail between lanes
(`artifacts/lane-messages/`). The push is the delivery; only the addressee
can close a message.

**Launch profile** — the ratified classification of every
surface in the tree (DR-005 ratified v4 in full; DR-023 carried it to v5, the
revision `scripts/launch-profile.mjs` declares today): what ships at launch, what is lab, what is deferred.
The gate fails when a real surface is unclassified.

**Level 10** — a completion grade that appeared in early README drafts with
no gate behind it. Recorded in `CLAIM_INVENTORY.md` as unsubstantiated; the
term is a fossil warning, not a target.

**Live evidence** — `artifacts/live-evidence/mac-run.json`: proof that the
full suite ran against real vendor software on real hardware. Only the Mac
lane can mint it, and only from a fully green run.

**Local authority** — the evidence class no MDM can provide: who is at the
console NOW, what network the device is attached to NOW, which peripherals
are physically present NOW.

**Mutation guard** — the gate proving that connectors classified read-only
cannot reach a write path, by attempting the writes and requiring refusal.

**Owner hands** — the section of `COMPANY_BUILD_PLAN.md` listing decisions
only the owner can make. Work never silently blocks on him; it queues here.

**Platform honesty** — golden rule 4: an app cannot grant itself device
control; real enforcement needs a supervised device and an MDM. Claims
otherwise are refused, not softened.

**Preflight** — `node scripts/preflight.mjs`: the per-push gate lane CI
mirrors, carrying far more than the `proof:*` suite. **No count is written
here on purpose.** This entry said "~35 gates beyond the proofs" while
`CI_AND_VALIDATION.md` said 208 and the parity checker printed a third number —
three hand-typed figures for one derived quantity. The live figure is
`scripts/check-preflight-ci-parity.mjs`'s own output, printed on every run.
Green preflight is WIDER than a green proof harness — see `CLAUDE.md`'s warning.

**Proof** — a `proof:*` script that exercises real behavior against fixtures
and asserts outcomes. Proofs are never weakened, skipped, or deleted to
make something pass.

**Provenance** — the recorded answer to "what code produced this result" —
sampled BEFORE a run, working tree cleanliness included. On evidence, the
answer to "which source said this, when, over what transport."

**Publication boundary** — the rule set separating what this public repo may
contain from what it must not (tenant data, secrets, unratified claims).

**Real-life simulator** — the deterministic scenario engine
(`lib/signalgrid-simulator`) that stands in for the physical world so the
decision core is provable without a deployment.

**Route owner** — the team or role a decision hands a problem to. A RESTRICT
without a route owner is an alarm without an address.

**Shared surface** — a file several lanes legitimately touch (preflight, CI
workflow, sync manifest, lockfile). One holder at a time; named in the
commit message.

**Sim-request loop** — the cloud lane queues verification operations
(`artifacts/sim-requests/`), the Mac executes and commits results with
provenance (`artifacts/sim-results/`). A refusal never closes a request.

**Steward** — the recurring duty cycle that reads the other lane's output,
acks its mail, and keeps the two-machine loop honest.

**Unearned affirmative** — any "yes"/"trusted"/grant produced without the
evidence that earns it. The grant-safety family exists to make these
impossible; the phrase is the repo's shorthand for its worst failure mode.

**Unfalsifiable guard** — a check that passes no matter what — proven by
planting the defect it claims to catch and watching it NOT fail. Finding
one is a defect; the reviewer role hunts them deliberately.

**verify:breadth** — the CI job running the deferred connector families and
doctrine proofs; the complement to preflight's per-push lane.
