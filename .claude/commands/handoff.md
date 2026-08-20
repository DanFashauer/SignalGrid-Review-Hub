---
description: Creates a handoff doc so the next chat starts where this one ended.
argument-hint: [optional: what the next session should focus on]
---

Write a handoff document for the next session.

<focus_for_next_session>
$ARGUMENTS
</focus_for_next_session>

Assume the reader is competent, has none of this conversation, and will act on what
you write without being able to ask you a follow-up. Write for that person.

**Where things stand** — the current state in a few sentences. What is done, what is
in flight, what is untouched.

**Decisions already made, and why** — each with its reason. This is the section that
prevents the next session from relitigating settled ground. Mark anything that was a
judgement call rather than a forced move, so it can be revisited deliberately.

**What is verified vs. what is assumed** — draw this line explicitly. Anything
checked against a real run, a real server or a real file goes in the first column
with what was observed. Everything else goes in the second, however confident it
feels. Blurring these two is how a session inherits a false belief and builds on it.

**Open threads** — what is genuinely unresolved, ranked. For each, what has already
been tried and ruled out, so nobody repeats it.

**Landmines** — the things that will waste the next session's time: the gate with a
misleading name, the command that must be run from a particular directory, the file
that looks generated but is not. Include anything that cost time in THIS session.

**Exact next action** — the first concrete thing to do, specific enough to start
without a decision.

Rules:
- Be honest about what failed. A handoff that reads as though everything went well
  is worse than none, because the next session trusts it.
- Include the exact commands, paths and identifiers. Not "run the tests" — the
  command, from where.
- Do not summarise for the sake of brevity where a detail is load-bearing.
