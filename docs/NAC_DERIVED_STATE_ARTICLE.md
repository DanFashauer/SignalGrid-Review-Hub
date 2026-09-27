<!-- STAGING NOTE — strip before publication.
Draft 2 of the DR-005 queued series (docs/COMPANY_BUILD_PLAN.md row 24), staged
for the owner's review only. Unlike draft 1, the owner has not reviewed or
approved this draft, and no venue is chosen for it: DR-005 item 2 named
signalgrid.app's company blog for the FIRST piece specifically and does not by
itself carry that choice to this one. `nac`/`network-nac` are DEFERRED
connector families under `scripts/launch-profile.mjs` — this piece is
engineering prose about an unshipped connector's design, not a claim that
SignalGrid evaluates network/NAC posture in any deployment today.
PUBLISHING IS THE OWNER'S SEND — nothing here authorizes posting it anywhere.
-->

# NAC posture is a derivation, not a wire fact

Network Access Control looks, from outside, like a sensor: a device shows up
on the wire, and the NAC console tells you whether it's compliant. Model it
that way and you'll place "is this device NAC-compliant, and when did it last
authenticate" beside the authentication result itself, as if both arrived off
the same wire at the same moment. They don't. One of them is a protocol
outcome. The other is a different system's own conclusion, fetched from a
different place, on a different clock — and a fabric that can't tell the two
apart will treat someone else's inference as if it were a fact it measured
itself.

We checked this against a real wire rather than reasoning about it from
vendor diagrams. The lab was FreeRADIUS, a lab NAS client, and two
provisioned devices plus one unknown, driven with `radclient` carrying the
attributes a real switch or WLC sends (`docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`
has the full setup and is reproducible from a `clients.conf` NAS entry and two
`mods-config/files/authorize` users). Two findings carry the article:

| Our shape says | What the wire actually returns |
| --- | --- |
| `authState: "quarantined"` — a state alongside `"authenticated"` | RADIUS has exactly two outcomes, `Access-Accept` / `Access-Reject`. The quarantined device we drove returned `Access-Accept` with a different `Tunnel-Private-Group-Id` and `Filter-Id` — a policy label the NAC console computed and handed back, not a protocol state |
| `nacCompliant`, `lastAuthAt` modeled beside `authState` | Neither is in an `Access-Accept`. `nacCompliant` isn't a RADIUS concept at all — a posture-agent/console derivation; `lastAuthAt` comes from RADIUS accounting or the console's own session database, a different source with a different lifetime that can disagree with the auth result |

The same split shows up twice more, independent of RADIUS: Cisco ISE's own
docs distinguish its ERS/endpoint API (identity, administrative CRUD) from its
MnT monitoring API (live session state) as separate grants over separate
ports — "not to be confused with" each other, in Cisco's words; Aruba
ClearPass splits the same way, endpoint API versus session API. Three
unrelated sources — the protocol, one vendor, a second vendor — converge on
one fact: "who is this device" and "is it authenticated right now" are always
two different data sources, and a console that answers "is it compliant"
is reporting its own derivation, never something it read off a cable
(`docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`, Findings 1 and 4; the same conclusion
is why `lib/integrations/src/integrations/nac/cisco-ise.ts`'s header records
deleting a prior normalizer that hardcoded `status: 'registered'` for every
endpoint — asserting an authentication state the endpoint API never reports).

This is structural, not a vendor shortcoming: a protocol answers accept/reject
and nothing else, and a console's compliance flag is that console's own
policy engine talking, sourced from its logs, on its own refresh interval.
Neither is dishonest. But if a decision fabric treats a fetched conclusion the
way it treats a measurement, staleness in the source becomes invisible —
you're trusting someone else's cache without an expiry on it.

Where this actually bites is what a decision core does with a field it can't
independently verify: does an *unreported* `nacCompliant` or `lastAuthAt` read
as "nothing to worry about" or as "unknown, and unknown must never look like
verified-good"? `lib/integrations/src/integrations/network-nac/evaluate.ts`
answers with a lattice, not a shortcut. `grantIfPostureVerified` (lines
131–142) only returns the clean `none` verdict when `nacCompliant === true`
**and** freshness derives to `"fresh"`; anything else on that branch —
`nacCompliant: null`, a stale timestamp, both — grades `monitor`, distinct
reason code `AUTHENTICATED_POSTURE_UNVERIFIED`, never the same verdict as
verified-good. That's deliberate correction, not the original design:
`docs/COMPANY_BUILD_PLAN.md`'s own reproduced-blocking-claims table records
that the prior code let an authenticated device with `nacCompliant` and
`lastAuthAt` both `null` earn the full `on_trusted_segment`/`none` grant —
"unreported combination is the *common* case on a real RADIUS wire, not an
edge," per the live shape check — closed in PR #219. Segment gets the same
treatment: an authenticated device on *any* VLAN used to read
`on_trusted_segment` even with no segment policy supplied; the evaluator now
returns the honestly-named `on_unverified_segment` when no policy exists to
grade against (`evaluate.ts` lines 67–91), and forecloses — `step_up`, not a
grant — when a policy exists but the source didn't report which segment the
device is on (`SEGMENT_UNREPORTED_UNDER_POLICY`). Freshness itself is derived
through one shared function, `deriveFreshness`/`ageMs` in
`lib/integrations/src/utils/freshness.ts`, after network-nac's own copy was
found missing the future-timestamp guard the other two callers had — a
`lastAuthAt` dated in the future used to read as the freshest possible auth
rather than as the contradiction it is (confirmed by execution against
network-nac on 2026-09-01; the file is now the one shared body every caller
consumes).

We pinned the corrected lattice into the proof rather than trusting the
diff. `scripts/src/network-nac-proof.ts` enumerates the full session-plane ×
segment-outcome space under a segment policy — 192 combinations, product of
the domains — and asserts a grant is reachable *only* by the fully-verified
state, with a companion negative control that catches a mutant declaring
unreported compliance clean (`mismatches > 0`). Run it yourself:

```
$ pnpm run proof:network-nac
...
summary=pass (64/64)
```

The sibling console-adapter proof, which checks the read-only guard and the
identifier validation `cisco-ise.ts`/`aruba-clearpass.ts` depend on, is
`pnpm run proof:nac` → `summary=pass (46/46)`.

**How these numbers trace.** `64/64` and `46/46` are the exact lines printed
by the two commands above against this tree's HEAD — rerun them for the
current count rather than trusting this print. `192` is asserted in
`scripts/src/network-nac-proof.ts` as "all `${withPolicy.combos}` combinations
swept (= product of domains)" and fails the moment the evaluator's input
domains change. The RADIUS findings are reproducible per
`docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`'s own reproduction section: stand up
`freeradius/freeradius-server:latest` with a NAS client and two authorize
entries carrying `Tunnel-Type`/`Tunnel-Private-Group-Id`/`Filter-Id`, drive it
with `radclient -x`, and read the reply attributes — nothing here was taken on
a vendor's word alone except the two console APIs, and that weaker claim is
labeled as such in the source doc, not smoothed over here.

Worth being explicit about the boundary: the RADIUS lab and the code above are
load-bearing and reproduced; the ISE/ClearPass session-API claims rest on
published vendor documentation only, no licensed instance was driven, and
`docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md` labels that gap itself. Nothing in this
piece, or in the connector it describes, is evaluating live NAC posture
anywhere today — `nac`/`network-nac` are deferred connector families.

---

*This came out of checking the network/NAC posture shape SignalGrid's decision
core would consume against a real RADIUS wire, for SignalGrid, which connects
the systems a building already runs into one grid that decides and acts on a
person's behalf — fail-closed, on shared frontline devices; the full lab notes
are public in our review repository.*
