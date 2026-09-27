<!-- STAGING NOTE — strip before publication.
Draft 2 of the article series queued in `docs/COMPANY_BUILD_PLAN.md` row 24
(after DR-005's first piece), staged for the owner's review only. The owner
has not reviewed or approved this draft, and no venue is chosen for it:
DR-005 item 2 named signalgrid.app's company blog for the first piece
specifically, and that does not by itself carry to this one. `nac`/
`network-nac` are DEFERRED connector families under
`scripts/launch-profile.mjs` — this is engineering prose about an unshipped
connector's design, not a claim that SignalGrid evaluates network/NAC
posture in any deployment today.
PUBLISHING IS THE OWNER'S SEND — nothing here authorizes posting it anywhere.
-->

# NAC posture is a derivation, not a wire fact

Network Access Control looks, from outside, like a sensor: a device shows up
on the wire, and the NAC console tells you whether it's compliant, and when
it last checked in. Model it that way and you'll place those two facts
beside the authentication result itself, as if all three arrived off the
same wire at the same moment. They don't. One of them is a protocol outcome.
The others come from elsewhere: compliance is a different system's own
conclusion, and last-auth time is a record from a separate accounting stream
or the console's session database, on a different clock.

We checked this against a real wire rather than reasoning about it from
vendor diagrams. The lab was FreeRADIUS, a lab NAS client, and two
provisioned devices plus one unknown, driven with `radclient` carrying the
attributes a real switch or WLC sends. Two findings carry the article:

| Our shape says | What the wire actually returns |
| --- | --- |
| `authState: "quarantined"` — a state alongside `"authenticated"` | RADIUS has exactly two outcomes, `Access-Accept` / `Access-Reject`. The quarantined device we drove returned `Access-Accept` with a different `Tunnel-Private-Group-Id` plus a `Filter-Id` — a customer-chosen policy label the server was configured to hand back (in production, the NAC's policy engine picks it), not a protocol state |
| `nacCompliant`, `lastAuthAt` modeled beside `authState` | Neither is in an `Access-Accept`. `nacCompliant` isn't a RADIUS concept at all — a posture-agent/console derivation; `lastAuthAt` comes from RADIUS accounting or the console's own session database, a different source with a different lifetime that can disagree with the auth result (accounting was not driven in the lab) |

The same split shows up twice more, independent of RADIUS: Cisco ISE's own
documentation distinguishes its ERS/endpoint API (identity, administrative
CRUD) from its MnT monitoring API (live session state) as separate
permission grants — "not to be confused with" each other, in Cisco's words;
Aruba ClearPass splits the same way, endpoint API versus session API. Three
unrelated sources — the protocol, one vendor, a second vendor — converge on
one fact: "who is this device" and "is it authenticated right now" are
always two different data sources, and a console that answers "is it
compliant" is reporting its own derivation, never something it read off a
cable. The same conclusion confirms, after the fact, a correction already
recorded in our Cisco ISE adapter's own header: its old normalizer
hardcoded `status: 'registered'` for every endpoint, asserting an
authentication state the endpoint API never reports.

This is structural, not a vendor shortcoming: a protocol answers
accept/reject and nothing else, and a console's compliance flag is that
console's own policy engine talking, sourced from its logs. Neither is
dishonest. But if a decision fabric treats a fetched conclusion the way it
treats a measurement, staleness in the source becomes invisible — you're
trusting someone else's cache without an expiry on it.

Where this actually bites is what the evaluator does with a field it can't
independently verify: does an *unreported* `nacCompliant` or `lastAuthAt`
read as "nothing to worry about," or as "unknown, and unknown must never
look like verified-good"? The answer is a lattice, and the ordering matters
more than any single branch: a reported non-compliance or a reported-stale
auth is rejected earlier and steps up outright (`NAC_NONCOMPLIANT`,
`STALE_NETWORK_STATE`) — neither ever reaches the grant path. What's left
after that — `nacCompliant: null`, or a `lastAuthAt` that is missing,
unparseable, or dated in the future, all of which collapse to freshness
`unknown` — reaches the grant branch and grades `monitor`, reason
`AUTHENTICATED_POSTURE_UNVERIFIED`, never the same verdict as verified-good.

That's deliberate correction, not the original design: the build plan's own
reading of the live shape check records that the prior code let an
authenticated device with `nacCompliant` and `lastAuthAt` both `null` earn
the full `on_trusted_segment`/`none` grant — "that unconfirmed combination is
the *common* case on a real RADIUS wire, not an edge" — closed, together with
the full state-space enumeration that now pins it, in one pull request.

Segment gets the same treatment: an authenticated device on *any* VLAN used
to read `on_trusted_segment` even with no segment policy supplied. The
evaluator now returns the honestly-named `on_unverified_segment` when no
policy exists to grade against — still a grant when the session plane
itself is verified, on purpose: an operator who set no segment policy asked
for no segment check, so the fix stops *claiming* trust rather than
inventing a challenge nobody asked for. And it forecloses — `step_up`, not a
grant — when a policy exists but the source didn't report which segment the
device is on (`SEGMENT_UNREPORTED_UNDER_POLICY`).

Freshness itself is derived through one shared function after network-nac's
own copy was found missing the future-timestamp guard the other two callers
had — a `lastAuthAt` dated in the future used to read as the freshest
possible auth rather than as the contradiction it is, confirmed by
execution against network-nac. Network-nac, carrier, and location-services
now share that one guarded body.

We pinned the corrected lattice into the proof rather than trusting the
diff. The enumeration sweeps the full session-plane × segment-outcome space
under a segment policy — 192 combinations, the product of the domains
swept — and asserts a grant is reachable *only* by the fully-verified state,
with a companion negative control that proves the harness can fail: declare
unreported compliance clean, and it reports `mismatches > 0`. That count
pins the sweep's size; it does not notice a new evaluator input on its
own — a field added to the evaluator without also being added to the swept
domains would simply go untested, not fail loudly. Run the proof yourself:

```
$ pnpm run proof:network-nac
...
summary=pass (64/64)
```

The sibling console-adapter proof, which checks the read-only guard and the
identifier validation the ISE/ClearPass adapters depend on, is
`pnpm run proof:nac` → `summary=pass (46/46)`.

**How these numbers trace.** `64/64` and `46/46` are the exact lines the two
commands above print against this tree's current commit — rerun them for
the live count rather than trusting this page. The RADIUS findings are
reproducible per the live shape check's own reproduction section: stand up
a FreeRADIUS server with a NAS client and two authorize entries carrying
`Tunnel-Type`/`Tunnel-Private-Group-Id`/`Filter-Id`, drive it with
`radclient -x`, and read the reply attributes — nothing here was taken on a
vendor's word alone except the two console APIs, and that weaker claim is
labeled as such at the source (see the boundary note below).

Worth being explicit about the boundary: the RADIUS lab and the evaluator
lattice above are load-bearing and reproduced; the ISE/ClearPass session-API
claims rest on published vendor documentation only, no licensed instance
was driven, and that gap is labeled at the source, not smoothed over here.
The connector this describes is not shipped; nothing here evaluates live
NAC posture anywhere today.

**Sources.** The RADIUS lab and its findings: `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`
(Findings 1 and 4, and the console-adapter addendum). The Cisco ISE
correction: `lib/integrations/src/integrations/nac/cisco-ise.ts` (file
header). The grant lattice and segment handling:
`lib/integrations/src/integrations/network-nac/evaluate.ts`
(`grantIfPostureVerified` and the segment branch above it). Freshness:
`lib/integrations/src/utils/freshness.ts`. The prior defect and its fix:
`docs/COMPANY_BUILD_PLAN.md` row 1, PR #219. The enumeration and its
negative control: `scripts/src/network-nac-proof.ts`.

---

*This came out of checking the network/NAC posture shape SignalGrid's decision
core would consume against a real RADIUS wire, for SignalGrid, which connects
the systems a building already runs into one grid that decides and acts on a
person's behalf — fail-closed, on shared frontline devices; the full lab notes
are public in our review repository.*
