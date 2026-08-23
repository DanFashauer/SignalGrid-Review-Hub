# Outreach operating rules — the guardrails, encoded

Owner-confirmed 2026-08-22 ("Confirmed, with guardrails"). These rules bind
every send; the log makes compliance auditable; DR-012 sets the segment.

## The checklist every send passes

1. **Researched target**: the recipient appears in the TARGET LIST with a
   segment, a reason, and a source for the research — no scraped blasts, no
   purchased lists. The named list lives in the OWNER'S PRIVATE Google
   Drive, never in this public repository: naming un-consenting
   organizations as "targets" in public would be its own boundary
   violation. `TARGETS_CRITERIA.md` (public) holds the method and segment
   quotas; log entries reference Drive row ids.
2. **Traced claims**: the message is built from `TEMPLATES.md`; any
   deviation still traces every product claim to POSITIONING.md or a
   running gate. This rule is MECHANICAL, not a promise:
   `scripts/check-launch-claims.mjs` (preflight + CI) scans this directory
   and every document it cites, and fails the build if a deferred family
   is presented as current. It was prose until 2026-08-23, and prose does
   not fail a build — the security-questionnaire pack made the same kind of
   promise and turned out to be unenforced for two of its four frameworks.
3. **Volume**: at most 10 first-touches per day; at most one follow-up per
   thread, ever.
4. **Identity**: sent from the owner's connected Gmail, signed as him,
   because it is him — the agent drafts and sends under standing authority;
   the owner reads everything in the daily digest and the log.
5. **Logged before sent counts as sent**: an entry lands in
   `artifacts/outreach-log/` for every send and every reply (see format
   below). An unlogged send is a rule violation, not an oversight.
6. **Halt**: any owner instruction to stop halts all sending immediately
   and completely. No queued sends fire after a halt.
7. **Replies handling**: interest → T3 + prep brief for the owner;
   decline → T4, thread closed, never re-contacted without their
   invitation; silence → at most one T2, then the thread rests.
8. **Unsubscribe-shaped anything** (a "remove me", an annoyed reply, an
   auto-responder saying no solicitations): honored instantly, logged,
   domain marked do-not-contact.

## The log format (one file per day in `artifacts/outreach-log/`, named by date)

```json
{
  "date": "2026-08-25",
  "sends": [
    {
      "target": "drive-row-id",
      "template": "T1",
      "sentAt": "2026-08-25T14:03:00Z",
      "threadRef": "gmail thread id",
      "deviations": "none | described"
    }
  ],
  "replies": [
    {
      "threadRef": "…",
      "disposition": "interest | decline | question | unsubscribe",
      "actionTaken": "T3 sent + prep brief | T4 sent + closed | …"
    }
  ],
  "haltState": "active | halted (<when, by what instruction>)"
}
```

The log is committed (it is the audit trail), but **reply CONTENT is never
committed** — dispositions only. What a prospect writes to the owner stays
between them and the owner's inbox; the public repository gets counts and
outcomes, not correspondence.

## What the daily digest reports

Sends (count + who), replies (count + dispositions), conversations needing
the owner (with prep briefs), targeting changes learned from responses, and
the running totals against the 30-day milestone.
