# Decision records — calls the team made under delegated authority

**Established 2026-08-19.** The founder's instruction was direct: *"why fight
me in that when I know you will make the right call."* This file is where the
team makes those calls instead of routing them back. Each record states the
question, the call, the evidence actually read, and — the part that makes
delegation safe — **exactly what would reverse it**. The founder overrides any
line here by saying so; nothing needs his approval first.

What is NOT here, by design, is anything on the short never-list in
`docs/VIRTUAL_TEAM.md`: outward-facing sends, legal or compliance sign-off,
irreversible operations, anything needing credentials the team does not hold,
and genuine matters of taste or strategy.

---

## DR-001 — The five connector families: **DEFER, all five**

**Question.** The owner board asked for build / defer / drop on facilities-CMMS
(intake row 86), OT/MQTT warehouse telemetry (row 85), managed-config receipt
and MAM/App-Protection state (both row 33), and Apple software-update currency
/ SOFA (row 81).

**Call: all five DEFER. The breadth freeze stands, and no family is lifted.**

**Rationale — the founder already answered this, and the board was asking him
twice.** The sequencing boundary is his own, recorded verbatim in intake row
55: *"Do not make this the first build wedge — the launch path remains Entra +
Intune → one shared-device workflow → one customer-approved sandbox → one live
decision loop."* Every one of the five is expansion, not wedge. Asking him to
classify them individually was asking him to re-decide something he had
already decided as a policy.

Three mechanical facts make DEFER the only currently-permitted answer anyway:

- A new family is a 52nd connector family; the moment its directory exists it
  trips the silent-omission arm of `scripts/check-launch-profile.mjs`.
- The launch profile's criterion — *one* read-only device-management evidence
  source — is already spent on `graph`, so `deferred` is the only status the
  profile permits for a second one (row 81's own analysis).
- `AGENTS.md` bans live API calls outright, so even SOFA's public,
  credential-free feed could only ever ship fixture-default behind an env gate
  (the graph-transport precedent).

**Evidence.** `docs/INTAKE_LEDGER.md` rows 33, 55, 81, 85, 86;
`scripts/check-launch-profile.mjs`; `scripts/launch-profile.mjs`; `AGENTS.md`.

**Reversal.** This flips when the launch wedge actually ships — one live
decision loop with a real customer — not on a date and not on appetite. When
it does, **SOFA (row 81) goes first**: its own audit rates it the strongest of
the recent intakes, it is read-only Apache-2.0 public data with no tenant
credentials and no actuator, and it closes a genuinely non-overlapping gap
(OS currency against Apple's published cadence). Lifting the freeze for it
requires a `LAUNCH_PROFILE_VERSION` bump, which is the mechanical record that
the decision was taken deliberately.

**Confidence: high.** The founder can override any single family by naming it.

---

## DR-002 — `tenant:admin`: **narrow the scope, then enforce it or delete it**

**Question.** What should the `tenant:admin` permission cover?

**Call.** `tenant:admin` covers exactly two things — **tenant lifecycle**
(create, suspend, delete a tenant) and **credential material** (mint, revoke,
and read unmasked API-key material). Nothing else. It is deliberately NOT a
super-role: `admin` already holds policy write, connector sync, audit read and
remediation approval, and widening `tenant:admin` to mean "admin, but more"
would make it a role rather than a scope.

**And the finding that made this urgent:** `tenant:admin` is currently
declared and granted but **required by nothing**. It appears in the permission
union (`lib/signalgrid-core/src/types.ts:26`) and in the `owner` role's grant
list (`lib/signalgrid-core/src/auth.ts:23`), and no route, guard or check in
`lib/` or `artifacts/api-server/src/` ever demands it. A permission that
protects nothing is worse than no permission at all: it reads, to anyone
auditing the role table, as a control that exists.

So the call has a second half: **a declared permission that no surface
requires is a defect, and should be caught mechanically** — the same shape as
every other guard in this repo. Either the scope gets enforced on the surfaces
above when they exist, or it comes out of the union.

**Evidence.** `lib/signalgrid-core/src/auth.ts` (role table),
`lib/signalgrid-core/src/types.ts` (the union), `lib/signalgrid-core/src/engine.ts`
(the `demoApiKeys()` comment that already names `tenant:admin` as the intended
guard for masked key references), and a repository-wide search finding zero
enforcement sites.

**Reversal.** If a real deployment needs a tenant-scoped administrator who is
*not* the owner, split the scope rather than widening it —
`tenant:lifecycle` and `credential:admin` — so the audit trail still says
which power was exercised.

**Confidence: high** on the scope and on the unenforced-permission finding.

---

## DR-003 — Audit-ledger retention: **90 days hot, exportable, operator-configurable — a default, not a promise**

**Question.** What retention should the tamper-evident audit ledger have? It is
customer-visible: the pricing page currently reads *"retention: owner decision
pending"*.

**Call.** The shipped **default** is 90 days in the queryable store, with the
full hash-chain exportable at any time before expiry (`db:export-ledger`
already exists), and the window operator-configurable. The pricing page stops
saying "owner decision pending" and states the default plus the fact that it
is configurable.

**Status (August 21, 2026).** The decision stands; its tense was wrong. 90
days is the **intended** default — no retention mechanism is implemented in
any durable store (per-store evidence: `docs/DATA_RETENTION_AND_PERSONAL_DATA.md`;
the runtime role is denied DELETE, so honouring any window requires an
admin-credential job that has not been designed). Until the mechanism exists,
no surface states a retention duration as shipped, and export is stated
honestly as the operator-side CLI (`db:export-ledger`, no tenant filter) —
not a customer self-serve route. `scripts/check-retention-claims.mjs`
enforces the duration half.

**Rationale.** 90 days is the common floor for security-incident review and it
is short enough not to imply an archival commitment this product does not yet
make. The important property is not the number — it is that **export is
always available**, so a customer's real retention requirement is satisfied by
their archive, not by our storage. That framing keeps a technical default from
quietly becoming a contractual one.

**The line this does not cross.** A *contractual* retention or availability
commitment in a signed agreement is not the team's to make (never-list item 2).
This is the engineering default and is labelled as such.

**Reversal.** Any customer or assessor requirement that names a specific window
overrides this immediately; the value is configuration, not architecture.

**Confidence: medium-high** on the default; the number is a judgement call and
the founder should override it freely if he has a market reason.

---

## DR-004 — Execution order ratified; the category label is "Shared-Device Trust Gateway"

**Date:** August 20, 2026. **Decided by:** the owner, in his own words, in the
message that verified PR #215 and opened PR #216.

**Source, quoted verbatim** — the operative portion of that message, preserved
here because this file's contract requires the evidence to be recoverable, and
a summary cannot be audited against itself. Public-safe; the message contains
no credentials or personal data beyond what the owner published in the PRs.

> "The company should now execute the existing sweep in this order:
> 1. Protect the trust engine first. […] extend the same adversarial
>    grant-safety testing across the remaining uncovered connector families […]
> 2. Finish the production data boundary. Separate the PostgreSQL runtime role
>    from the database owner/admin role and make backup/restore preserve those
>    permissions. […]
> 3. Close the actual product journey. Fix the native iOS badge/session API
>    mismatch, then prove one complete shared-device flow […]
> 4. Make the public product tell only the launch truth. Remove present-tense
>    claims for deferred badge, zone, and shift capabilities; lock the site to
>    the ratified Shared-Device Trust Gateway scope; and add a gate so
>    marketing cannot drift beyond implemented capability again.
> 5. Use the low-cost lab as the engineering engine. […] Microsoft Entra and
>    Intune remain the enterprise production target, but they no longer block
>    product development.
> 6. Move the company from engineering proof to buyer proof. […] Do not
>    activate customer-success machinery before a real customer exists."

Elisions ([…]) drop only examples and restatements; every clause this record
relies on is quoted in full above.

**Decision 1 — the execution order.** The company works the build plan in this
sequence, quoted in substance from the owner: (1) protect the trust engine —
extend adversarial grant-safety testing across the uncovered connector families;
(2) finish the production data boundary — the Postgres runtime/admin role split,
with backup/restore preserving it; (3) close the actual product journey — the iOS
badge/session API mismatch, then one complete shared-device flow end to end;
(4) make the public product tell only the launch truth, with a gate so marketing
cannot drift again; (5) use the low-cost lab (Fleet Community, Headwind, Keycloak,
Wazuh, FreeRADIUS) as the engineering engine, with Entra/Intune the enterprise
target but no longer a blocker; (6) move from engineering proof to buyer proof —
and "do not activate customer-success machinery before a real customer exists."

**Decision 2 — the category label.** The owner's step 4 directs the site be
locked to "the ratified Shared-Device Trust Gateway scope." That settles the
five-labels-in-circulation defect the sweep found: **Shared-Device Trust
Gateway** — already `PRODUCT_NAME` in `scripts/launch-profile.mjs` — is the
category label. The other four labels get reconciled out, not kept as synonyms.

**What the order means — and does not.** The six steps rank priority and gate
what goes OUTWARD: nothing publishes, ships, or reaches a person outside the
company from a later step while an earlier step's outward preconditions are
open. They do not serialize internal work — the owner's own step 4 directs the
site rewrite in the same message that puts trust-engine work first, and step 6
gates *activation* ("do not activate customer-success machinery before a real
customer exists"), not preparation. Reading the list as a strict pipeline would
have the instruction forbidding work it explicitly assigns. Internal drafting
on any step may proceed in parallel; the sequence binds what leaves.

**What is ratified at the item level, precisely.** The owner's step 4 names its
own scope: *"Remove present-tense claims for deferred badge, zone, and shift
capabilities."* That sentence item-ratifies the six signal-kind classifications
the site rewrite depends on — the three launch kinds (`device_posture`,
`device_management_health`, `local_authority`) as the shipping wedge, and
`pacs_access` (badge), `location` (zone), and `shift_context` (shift) as
deferred, never present-tense. The owner's word "badge" ratifies the deferral
of every badge-shaped surface, not one enum: `pacs_access` (authorization at a
controlled door) AND the separate badge-binding evidence lane the review
console presents (`badgeBinding` in the operator evidence). When the
launch-claims gate derives its allowed terms from this subset, any badge-shaped
public claim resolves to this deferral — a claim escaping because it rode a
differently-named field would defeat the ratification it rode around. The remaining launch-profile classifications —
connector families, app surfaces, API paths — stay marked "proposal" until the
owner reviews them or ratifies them wholesale. Reading blanket approval into a
sentence about the site would be the unearned affirmative again.

**Consequence for the roster:** `positioning-messaging` is unblocked for the
site rewrite and POSITIONING.md, **bounded by the ratified subset**: public
copy may claim only the three ratified launch kinds and may name the three
ratified deferred kinds only as roadmap. Any claim resting on a classification
outside those six waits for item-level ratification.
`design-partner-outreach` stays blocked behind positioning and ICP research per
the owner's own step 6.

**Where the ratified subset is encoded.** For now: here, and only here.
`scripts/launch-profile.mjs` still describes itself as an unratified proposal
and its schema has no per-item ratification field, so tooling cannot yet
distinguish the six ratified items from the other 168. That encoding travels
with the launch-claims gate (build-plan item 6), which needs exactly that field
to check public copy mechanically — until it lands, this record is the source
of truth for the subset and the profile's blanket "proposal" language is read
as "except where DR-004 says otherwise."

**Reversal.** The owner reverses any part of this by saying so, as with every
record here. Short of that: the execution order is superseded the moment a
later owner instruction sequences the work differently, and the earlier order
does not linger as doctrine; the category label is reversed only by the owner
naming a different one, at which point every surface carrying "Shared-Device
Trust Gateway" is reconciled in the same shift rather than left to drift; and
the six item-level ratifications above are reversed individually if the owner
re-classifies a named signal kind, which re-blocks any public copy resting on
it until the copy is reconciled.

---

## DR-005 — The five owner decisions of August 20, 2026

**Date:** August 20, 2026. **Decided by:** the owner, in a message that stated
each decision explicitly, with the operative wording quoted per decision below.
Written with the reversal conditions and verbatim sourcing DR-004 had to learn
in review, from the start.

### 1. Launch-profile v4 — ratified in full

> "v4 is no longer a proposal. Treat every current classification in
> `scripts/launch-profile.mjs` as ratified unless a future decision record
> explicitly changes it. This also ratifies the source-agnostic build order:
> open-source lab first; Microsoft enterprise validation next."

This **supersedes DR-004's carve-out** that held the item-level classifications
as proposals — by exactly the mechanism DR-004's own reversal clause named: a
later owner instruction. All 174 classifications are ratified: three launch
connector families (`graph`, `device-management-health`, `local-authority`),
three launch signal kinds, three launch app surfaces (API server, operator
console, `ios:EnterpriseShell`); everything else deferred, demo-only, or
internal as written. The positioning draft's groundings that DR-004 bounded
out (graph, EnterpriseShell, the `/v1` routes, the console) are now ratified
ground. The owner's closing constraint is part of the decision: **"do not
widen the product again now"** — the backlog executes against a fixed edge.

### 2. The first article — approved after one factual correction; company blog first

> "keep the article, correct that section, independently recheck the
> experiment, then publish it. Canonical venue should be a technical
> SignalGrid company blog on `signalgrid.app`."

The blocker the owner found is real and this record confirms it: the draft
prescribed "revoking DELETE" while the same company audit established there is
no GRANT to revoke — the application role *owns* the ledger table, so the real
fix is the owner/admin vs restricted-runtime role split (build-plan item 3).
The corrected canonical article is staged at `docs/HASH_CHAIN_TAIL_ARTICLE.md`.
The independent recheck exists as a standing fact: `proof:audit-ledger-pg`
re-runs the experiment against a real Postgres in the "Durable persistence" CI
job on every push — including, since review of this record, the operator CLI
itself: `db:verify-ledger` is spawned as a child process and BOTH its exit codes and
its verdict lines are asserted — "Chain intact" with the right count, "TOO FEW
RECORDS" naming both numbers, "CHAIN BROKEN at record index" localizing the
break — across the same three states the article's table publishes (clean,
short-of-floor, tampered), at smaller scale (8 records to the article's 40).
The claim is scoped to that: same code paths and verdict sentences, not a
literal 40-row replay. The
article's runtime-role grant is per-table: on the ledger, `SELECT` and
`INSERT` only — `UPDATE` would let an attacker rewrite a record and its hash
and the verifier would accept the result. Publication order:
signalgrid.app blog (to be built) first, then a shorter founder version on the
owner's LinkedIn linking back; no third-party outlet for the first piece.
**Publishing anything remains the owner's send.**

### 3. Deny color — re-toned; WCAG AA is now the floor

> "adopt WCAG AA as the minimum contrast standard for SignalGrid
> decision-state colors. Use: Dark deny: `#C67070`, Light deny: `#8A3F3F`.
> Do not waive the issue and do not artificially restrict where `deny` may
> be used."

These are the exact values the accessibility pass had tested in `dd55bca` and
reverted solely for lacking brand ratification — that ratification is this
record. Independently re-measured before applying: dark `#C67070` scores
5.05:1 on background and 4.55:1 on card; light `#8A3F3F` scores 6.50:1 and
7.33:1 — all four above the 4.5:1 floor, against the old dark value's 3.18:1
on card. Applied to web (`index.css`, a committed single-theme dark surface,
takes the dark value — as `0 43% 60.8%`, because `61%` rounds to `#C67171`
and quietly forks the platforms) and iOS (`DesignSystem.swift`, dynamic
light/dark) in the same commit, because a fork between them was the stated
reason the first attempt was reverted. Review caught the pairing the original
measurements missed: the re-tone that fixed deny-as-TEXT flipped the failure
onto deny-as-FILL — white on the new dark fill measures 3.53:1. Filled deny
controls now carry a paired foreground (`SG.onDeny`, and the web's
`--destructive-foreground`): charcoal on the dark fill (5.05:1), white kept on
the light fill (7.33:1). Color remains redundant with text/icon labels, never the
sole signal. The canonical decision-state palette now lives in THIS repository
(`docs/BRAND_CONTRAST_FINDING.md` records the resolution); DEV is retired and
does not receive the change.

### 4. Billing numbers — the one open item, owner-only by design

Four values, never estimated, per the cost model's own rule: monthly Claude
spend; Apple Developer status/fee; GitHub plan, price, and sibling-repo
visibility; total domain spend. The model carries TBDs until the owner sends
them.

### 5. Fleet Premium — out of baseline COGS

> "do not renew Fleet Premium for SignalGrid's baseline build. […] If it
> isn't completed by September 16, mark that capability
> `deferred/unverified-premium`; do not pay merely to preserve a test."

Baseline economics are Fleet Community/self-hosted: $0 license plus actual
hosting. The Premium-only `getPolicies()` team-scoped branch gets proven on
the remaining trial only if it costs no launch focus; otherwise it is marked
`deferred/unverified-premium` on September 16 and priced as a
customer-specific dependency if a customer ever requires it.

### Reversal

The owner reverses any line here by saying so. Specifically: a future decision
record can re-open any v4 classification (that is the only path — silence
does not); the article's venue or the palette values change only by owner
instruction, and a palette change re-runs the contrast measurements before it
applies; the Fleet Premium exclusion reverses if a paying customer requires a
Premium capability, at which point it enters that deployment's pricing, not
baseline COGS. The "do not widen" constraint stands until the owner lifts it.

---

## Still open, and honestly so

Two of the four "standing decisions" are **not** decided here, because the
searches run for this pass did not locate their recorded reasoning, and
deciding them from their board titles alone would be exactly the unearned
affirmative this repository exists to refuse:

- **graph-default flip** — no record found under that name; the graph
  connector's fixture-vs-live default needs its actual reasoning located first.
- **shadow-mode step-up** — no record found; "shadow" appears in `lib/` only
  in unrelated senses (shadow agents, shadow copies).

These stay open as **team** work, not owner work: the next shift finds the
records and decides them. They are listed here rather than silently dropped.

## DR-006 — Allow re-tone and the onAllow pair (2026-08-21)

**Decision.** The owner ratified the recommended allow re-tone: dark
`#5E8F73` → `#639779` (hsl 145 21% 49% — same hue, same saturation, two
lightness steps), light `#3F6B52` unchanged. With it, the paired foreground
`onAllow` (light `FFFFFF`, dark `15181B`), the same shape as DR-005's
`onDeny`. Owner's words: "I allow color pick" — ratifying the recommended
option from the proposal of the same day.

**Why.** Dark allow sat at 4.32:1 on card — under the DR-005-ratified WCAG
AA floor for decision-state colors — and white toast text on the dark allow
fill sat at 3.72:1, the exact defect class onDeny closed for deny.

**Measured before applying, from the committed files** (the ratios are
computed from the token values as committed, not from intentions): dark
5.29:1 on background / 4.76:1 on card; light 5.41:1 / 6.11:1; onAllow dark
5.29:1 on the fill, light 6.11:1. Both web palettes' `--decision-allow`
round-trips to the identical hex as the iOS dark token — no cross-surface
fork, which is why the first deny attempt was reverted.

**Scope.** Landed together, per the ratified landing rule: canonical tokens
first (DesignSystem.swift + both web `index.css` palettes), the allow-filled
toast switched to `onAllow`, and signalgrid-app's rendered
`.text-status-allow`/`.bg-status-allow` classes moved off raw Tailwind
green onto the canonical token. The full palette-parity gate over every
rendered tree (the design lens's queued deliverable) is follow-up work, not
part of this record.

**Reversal.** A future decision record naming new hexes, measured the same
way, on every surface in the same commit.

### DR-006 addendum (2026-08-21, same day): the on-tint variant

Cross-lane review caught a composite the original nine measurements did not
cover: the operator console's tinted allow badge lightens its ground (10%
allow over card composites to ~#242E2E), putting the ratified #639779 text at
4.14:1 — under the floor. Resolution, measured from the committed files: tint
reduced to 8%, and badge text moved to a new canonical variant
`--decision-allow-on-tint` (hsl 145 21% 55%, #74A488) — 5.09:1 on the tinted
card, 5.55:1 on the tinted background, and ≥5.5:1 on both plain surfaces. The
lesson folds into the pending decision-palette gate: composited grounds are
render surfaces too, and must be in its measurement set.

## DR-007 — The Assist wire: **one served envelope, and the planned one is a declared gap, not a phantom contract**

**Question.** Three native Assist clients decode three different answers from
the server. The Kotlin and Rust SDKs — the two bound by the 42 shared
conformance vectors and `scripts/check-assist-conformance.mjs` — decode an
envelope `{assist, reasons, decisionId}` from `POST /v1/authorize`, a route
this repository does not implement (verified: the OpenAPI spec registers no
such path; the only `/v1/authorize` mentions in the tree are URL-normalization
comments). The one client that talks to the real server — iOS
`RemoteDecisionService` — decodes `{decision:{outcome}, plan:{outcome}}` from
`POST /v1/app-workflows/evaluate`, and sits OUTSIDE the vector suite under a
disclaimer whose stated reason ("EnterpriseShell ports the decision engine
rather than consuming /v1") stopped being true when that service landed. Which
envelope is the Assist wire?

**Call.** The **served** Assist surface is what the launch profile already
ratifies: `POST /v1/decisions/evaluate` returning `EvaluateResult` — outcome,
reasonCodes (the DR-catalogued vocabulary, `docs/REASON_CODES.md`), matched
rules, evidence reference. That is the envelope a host app integrates TODAY.
The `{assist, reasons, decisionId}` / `/v1/authorize` envelope the SDKs bind
is a **planned wire, recorded as a declared gap** (`assist-wire-unserved` in
`scripts/launch-profile.mjs` GAPS) — the vectors stay, the SDK suites stay
(they still catch real parse defects, which is why the Kotlin lane matters),
but no document may present that wire as served until the gap closes. The gap
closes mechanically when the spec registers `/v1/authorize`; building that
route now would widen the frozen launch surface and is deliberately not done.

**Enforcement.** `scripts/check-assist-wire-served.mjs` (preflight + CI)
reads the bound wire as DATA — the `route` field the shared vectors file now
carries — and fails when that route is neither served by the spec nor claimed
BY NAME in the declared-gap entry: deleting the gap entry, retargeting the
vectors to a second unserved route, and SDK documentation drifting from the
vectors' route all fail. (The first version of this paragraph claimed the
retarget case before the vectors carried a route at all — the gate then read
two SDK doc comments through two different regexes; the assurance review
executed the retarget and it passed. Corrected the same day: the route is
data, the gap must name it, and the gate prints the route it actually
checked.)

**The second unserved wire, stated.** The client this record calls "the one
that talks to the real server" — iOS `RemoteDecisionService`, and
SignalGridMobile beside it — posts to `/v1/app-workflows/evaluate`, which the
launch profile classifies **deferred** and the gateway profile fences: under
`shared-device-gateway` it 404s (executed: 404 on the gateway boot, 401 —
served — under review-demo). So the iOS wire is served only on the
review-demo surface today. It needs no second gap entry because the
deferral IS its declaration — `/v1/app-workflows/evaluate` sits in the
launch profile's deferred route list, which is the register for exactly
this; what the deferral does NOT license is calling that envelope "served"
for a commercial deployment, and no surface may. The conformance gate's iOS disclaimer is corrected in the same
change: EnterpriseShell consumes `/v1` through `RemoteDecisionService` (its
local `DecisionEngine` remains the offline fallback), and bringing that
envelope under shared vectors is follow-on work, not a reason to misstate
the present.

**Reversal path.** If the owner later ratifies serving `/v1/authorize`, the
gap's `closedWhen` clears on the spec change itself; this record then reads
as the period when the wire was declared ahead of the server, which is what
happened.

---

## DR-008 — Three-plane architecture: Bruno contract plane, MCP agent plane, deterministic trust plane (2026-08-21)

**Question.** The repository now carries three surfaces that all touch the
API from outside the core: a committed Bruno workspace
(`artifacts/api-collection/`), two MCP servers (the in-repo
`artifacts/mcp-server/` fabric server and the public sibling `signalgrid-mcp`
posture source), and the deterministic decision core they both orbit. Absent
a ratified relationship, each surface drifts toward doing the others' jobs —
a Bruno request that "checks" behavior becomes a shadow test suite, an MCP
tool that acts on results becomes a shadow control plane, and an agent
reading evidence becomes, one convenience at a time, a thing that decides.
What is the standing relationship?

**Decision.** Three planes, each with exactly one job, owner-directed:
**Plane 1, the API contract** — Bruno, two-directionally gated by
`scripts/check-api-collection.mjs`, proves what the API serves and what it
refuses. **Plane 2, agent interoperability** — MCP gives agents controlled
access: the in-repo server exposes the fabric as read-only tools over stdio,
the sibling `signalgrid-mcp` reads macOS posture as a signal source; neither
decides anything. **Plane 3, the trust authority** — the deterministic core
alone turns evidence into a verdict. The two governing principles, stated as
doctrine: **"Bruno proves the API. MCP gives agents controlled access to the
API. SignalGrid determines what the evidence means."** and **"MCP is an
orchestration interface, not a new trust authority."**

**What this forbids.** Three moves, each of which would have been easy and
each of which is now a doctrine violation: (1) **MCP mutation tools without
approval gates** — no tool that changes durable state lands without an
explicit human-approval step in the loop and its own decision record; today
the server has none, and `scripts/check-mcp-surface.mjs` makes a new tool
visible the moment it registers. (2) **Agents deciding trust** — no agent
output, tool result, or model judgment may bypass the core or be returned as
a verdict the core did not compute. (3) **Collapsing planes** — Bruno does
not evaluate, MCP does not certify the contract, the core grows no
agent-facing bypass; a change making one plane do another's job is wrong even
when it works.

**Evidence.** Read from the committed files, not asserted:
`artifacts/api-collection/README.md` and `scripts/check-api-collection.mjs`
(both coverage directions, self-test proving both can fail);
`artifacts/mcp-server/src/index.ts` (stdio transport, demo core, the
registered tool set — reads and in-memory evaluations only);
`scripts/mac/mcp-up.sh` (the launcher, stdout reserved for the transport);
`docs/ESTATE_SYNC_REPORT.md` §2.1 (the sibling's 22-tool read-only posture
surface, verified from a checkout at `369e08e`);
`docs/OPEN_SOURCE_LAB_REGISTRY.md` (the evidence boundary the planes overlay).
The deferred items — an MCP execute-bridge for Bruno, HTTP transport, OAuth
scopes — are recorded as design intent in `docs/MCP_ARCHITECTURE.md` and
`docs/MCP_SECURITY_MODEL.md`, in the future tense they are entitled to and no
other.

**Reversal.** A future decision record, owner-ratified, that either (a)
grants a named MCP tool mutation rights together with its approval-gate
design, or (b) merges two planes with the drift risks above answered
mechanically — a gate, not a promise — for each of the three forbidden moves.
Absent that record, the planes stay separate and the prohibitions stand.

**Status: ratified by owner directive, 2026-08-21. Confidence: high.**

---

## DR-009 — Signing-key custody: keyless Sigstore OIDC via the CI identity (2026-08-21)

**Question.** The release-evidence lane (backlog row 32, `docs/RELEASE_EVIDENCE.md`)
reaches the signature stage: before the first cosign signature exists, who —
or what — holds the key? Two custody models were on file: (a) keyless
Sigstore OIDC bound to the repository's CI identity, trust rooted in a public
transparency log; (b) an owner-custodied key pair.

**Decision.** Keyless — option (a), the recommendation as filed, ratified by
the owner 2026-08-21 in his own words: "I will go with recommendation on key
custody model." A solo founder holding a private signing key is a single
point of loss, and the transparency log is the assessor-legible answer. The
signing identity is the repository's GitHub Actions OIDC identity
(`id-token: write`, granted to exactly one job); every signature lands in the
public Rekor log by construction.

**Scope of the first signatures.** Blob signatures over the per-push release
evidence (the image SBOM and vulnerability report), produced only on `push`
events to the protected branches — never on pull requests, where a fork's
context must not mint repository-identity signatures. Signing a REGISTRY
image by digest arrives when an image registry exists to push to; nothing
here claims it early.

**What this forbids.** Any privately-held signing key for release artifacts
without a superseding decision record; any signing step in a job that
installs third-party dependencies (the signing job must stay
install-nothing-untrusted, the same isolation reasoning as `sbom-sync`);
any claim that a signature proves more than "this exact byte content
existed in this repository's CI at this time."

**Reversal.** A future decision record choosing held keys — expected only if
a customer's air-gapped verification requirement makes the public log
unusable, which is a real scenario and the reason option (b) stays written
down rather than deleted.

**Status: ratified by owner directive, 2026-08-21. Confidence: high.**

---

## DR-010 — OpenBao as the secret boundary (RATIFIED by owner, decision session 2026-08-22)

**Question.** Report v3 names secrets management one of the three most
important gaps: ~75 credential-shaped environment names exist, and while
nearly all are fixture/lab throwaways today, the first real tenant
credential must not follow that path. Adopt OpenBao (MPL-2.0, registry row,
P0) as the secret boundary?

**Proposal.** Yes, under docs/SECRET_MODEL.md's five rules — path-naming as
audit trail, per-consumer service identities, the agent-never-holds list
(secret-zero, unseal material, root token, any secret value in
conversation), leases with rotation proven by rotating, and sealed-storage
snapshots under the existing backup discipline. Migration starts with ONE
real credential (the lab DATABASE_URL) and fixture tokens deliberately stay
env-minted throwaways.

**What ratification changes.** The registry row's `mutationsAllowed` flips
true citing this DR (the DR-008 gate refused it without one — it fired on
intake, correctly), and the lab deployment plus first migration proceed.
Until then: model only, no instance, no stored secret.

**What this forbids either way.** Any AI lane reading a secret VALUE back
through any tool; root-token or unseal material anywhere an agent can
reach; a shared secret whose path cannot name its single consumer.

**Status: RATIFIED by owner, decision session 2026-08-22. Custody: unseal /
recovery material lives with the owner, outside this repository and outside
any agent's reach — recorded here per the proposal's own terms. Deployment
proceeds when a container engine is available (Mac lane, or the cloud
engine if restored); first migrated credential is the lab DATABASE_URL,
rotation proven on it before anything else moves.**

---

## DR-011 — Positioning ratified: sentence, label hierarchy (2026-08-22)

**Decision.** The owner ratified the filed positioning draft as written — the
one sentence, the 100-word version, and the boundary paragraph, every claim
traced to a launch-class proof — landing as docs/POSITIONING.md. On the
category label the owner answered "all", ratified here as a HIERARCHY rather
than a contradiction: "Shared-Device Trust Gateway" is the product
name/category (matching DR-005's launch-profile name), "access-decision
service" is the descriptor phrase, "workflow trust engine" is the vision
phrase reserved for roadmap contexts. One name everywhere that names, one
explainer everywhere that explains.

**What this unblocks.** The public-site rewrite to launch scope (backlog row
6), the launch-claims gate, the GTM pack, and every outreach message — all of
which now copy from POSITIONING.md and nowhere else.

**Status: ratified by owner, decision session 2026-08-22.**

---

## DR-012 — Target market and proof stack: lean-IT first, Fleet-first, Microsoft when a prospect brings a tenant (2026-08-22)

**Decision, in the owner's own direction (decision session).** Asked to start
a Microsoft Intune/Entra trial, the owner redirected: use Fleet (or another
open alternative) to prove the connector story for now — "Microsoft is not
the only one that can help prove this," and jumping straight at major
enterprise "would be crazy." The first market is organizations with LIMITED
IT STAFF OR LIMITED RESOURCES — the SMB/mid-market lean-IT segment the
research reports independently identified as the sweet spot — beginning
there to scale correctly rather than missing the industry that can take the
most advantage of this product.

**What this fixes in place:**

1. **Proof stack**: Fleet-first. The source-agnostic DeviceManagementEvidence
   contract is already proven LIVE against Fleet (TLS + real osqueryd,
   proof:live-fleet + live-fleet-workflow). That is the demo. The Graph/
   Intune adapter stays implemented and wire-hardened (12/12 socket proof),
   honestly described as awaiting a real tenant — which arrives when a
   PROSPECT brings one, not from a trial the owner buys first.
2. **ITSM the same way**: no ServiceNow/Jira signups on the critical path;
   GLPI (registry P0 lab source) becomes the ITSM lab when an engine is
   available. Proof scripts stay ready for the day a prospect's stack names
   a vendor.
3. **Outreach targeting** follows the segment: 75–1,000-employee
   organizations, 1–10 IT people, shared/frontline devices, consolidation
   pressure — not Fortune-500 procurement.
4. **Positioning amendment (owner-sourced)**: DR-011's ratified 100-word
   version named Intune as the first enterprise connector; amended same-day
   to state the Fleet-first truth with Intune as the enterprise-roadmap
   connector. The launch profile itself is untouched — this is GTM
   sequencing, not scope change.

**Status: owner-directed, decision session 2026-08-22.**

---

## DR-013 — Open-source proof IS product proof; paid platforms are wires, not milestones (2026-08-22)

**Owner-directed, in his own words:** "focus on proof validating even with
open source cause if it can work with open source then there shouldn't be
any reason why it shouldn't work with paid platforms." Extends DR-012 from
GTM sequencing into VALIDATION DOCTRINE.

**The doctrine.** The DeviceManagementEvidence contract (and its identity
and ITSM siblings) is the product boundary. A capability proven live against
an open-source implementation of a source class is proven FOR THE PRODUCT;
a paid platform in the same class adds a thin adapter and exactly ONE
honest obligation — a single live-wire verification when a real tenant
exists — because this repository's own record says so: all live checks ever
run (10 for 10) found some fixture-vs-wire divergence. Adapter work is a
day per vendor; it is never again treated as product risk, a launch
blocker, or a reason to buy a vendor trial.

**What this re-aims the proof queue at — the source-independence
milestones (report v3's own capstone):**
1. Fleet + Headwind → same normalized contract → SAME decisions under
   fresh/stale/missing/contradictory states (endpoint class, second
   implementation).
2. Keycloak (live-proven) + authentik → same, for identity.
3. GLPI live-driven → the ITSM class proven without any vendor signup.
4. The CROSS-SOURCE CONTRADICTION MATRIX: one workflow, all classes, the
   engine detecting disagreement between independent open sources — the
   demo that sells, per the reports and per this doctrine.

Engine-dependent pieces queue to the Mac lane via sim-requests; nothing
waits on a purchased platform.

**Status: owner-directed, 2026-08-22.**

