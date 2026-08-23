# Outreach templates — founder voice, every claim traced

Governing rules (DR-011/DR-012 + the owner's confirmed guardrails,
2026-08-22): messages go out under the owner's identity via his connected
Gmail; **every product claim here traces to POSITIONING.md or a running
gate** — and that is now enforced by one, `scripts/check-launch-claims.mjs`,
which reads this file and the documents it cites and fails on a deferred
family presented as current; ~5–10 sends/day to researched targets only; every send and reply
logged in `artifacts/outreach-log/`; the owner can halt everything with one
word. The publication boundary applies to outreach exactly as it applies to
the repository: nothing deferred presented as current, ever.

Tone: a working endpoint engineer asking a peer about their real failure
modes — never "do you need zero trust." Short. No attachments on first
contact. One question, easy to answer.

## T1 — First touch (cold, researched)

> Subject: shared devices at {Company} — a question from an endpoint guy
>
> Hi {FirstName} — I've spent my career managing endpoints, and I'm building
> something around a problem I kept hitting: the management console can tell
> you the last state it recorded for a shared device, but not whether that
> answer is still true when someone picks the device up and does something
> sensitive with it.
>
> I'm looking for two or three lean IT teams to test this in read-only
> shadow mode against a small shared-device population — {segment-specific
> line, e.g. "shared scanners across your warehouses" / "shared carts and
> tablets in your clinics"}. It doesn't replace your MDM and blocks nothing
> during the pilot; it just shows you where the system of record and the
> device's current reality disagree.
>
> Worth 20 minutes? If shared-device trust isn't a real problem for you,
> that's a useful answer too.
>
> — Dan Fashauer
> {calendar link} · the whole product is a public repository if your
> security person wants to look first: {repo link}

Claim trace: "last state it recorded" ↔ POSITIONING.md freshness clause;
"read-only shadow mode / blocks nothing" ↔ PILOT_PACKAGE.md scope;
"doesn't replace your MDM" ↔ boundary paragraph; "public repository" ↔ fact.

## T2 — Follow-up (one only, 4–6 days later)

> Subject: re: shared devices at {Company}
>
> One data point and I'll leave you alone: in our lab, a device that looked
> "compliant" in the management console had actually gone unverified for
> hours — every console stayed green because green is just the last thing
> anyone recorded. That's the gap we measure.
>
> If it's ever bitten you — a stale device doing something it shouldn't
> have — I'd genuinely like to hear how it played out, pilot or no pilot.

Claim trace: the lab scenario ↔ ProblemSection's staleness scenario (itself
launch-true); no capability claims made.

## T3 — Reply to interest

> Great — the shortest path is a 20-minute call: what you run for device
> management, where shared devices bite you, and whether the shadow-mode
> pilot fits. {calendar link}
>
> If it helps before then, the one-page pilot outline is here: {pilot link}.
> Your security reviewer can start at the security review package in the
> repo — every link, command and path in it is machine-checked to resolve.

## T4 — Reply to "not now / not us"

> Understood, and thanks for the straight answer. One favor if it's easy:
> is that because shared-device trust isn't a pain here, or because the
> timing/stack doesn't fit? One sentence helps me aim better. Either way —
> good luck out there.

## Never in any message

Certifications we don't hold; "production-ready"; deferred signals (badges,
zones, custody, shifts) as capability; invented customer counts or logos;
urgency theater; more than one follow-up.
