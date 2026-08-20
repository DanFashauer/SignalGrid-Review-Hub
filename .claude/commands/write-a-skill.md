---
description: Bottles a thing you just did into a reusable skill or slash command.
argument-hint: [what you want to make repeatable]
---

Turn this into something reusable.

<subject>
$ARGUMENTS
</subject>

**First decide whether it should exist at all.** A skill earns its place if the task
recurs, has a right way to do it that is easy to get wrong, and would otherwise be
re-explained every time. If it fails that test, say so and stop — an unused skill is
clutter that later reads as capability.

If it passes, work out from what actually happened rather than from the idea of it:

- **What triggers it** — the situation in which someone should reach for this. Be
  concrete enough that the description alone tells someone whether this is their
  case.
- **The inputs** it needs, and what it should do when one is missing.
- **The steps**, in the order that works, including the ones that are only obvious
  after getting them wrong once.
- **The failure modes** — where this goes wrong, and what the wrong outcome looks
  like so it is recognisable.
- **How to tell it worked.**

Then write the file:

- A **slash command** (`.claude/commands/<name>.md`) when it is one prompt someone
  invokes deliberately. Frontmatter: `description`, `argument-hint`. Body is the
  prompt, using `$ARGUMENTS`.
- A **skill** (`.claude/skills/<name>/SKILL.md`) when it needs supporting files, or
  should be discovered automatically from context rather than typed by name.

Write it in the second person, imperative, addressed to whoever runs it later.
Include the failure modes IN the file — the reason a skill beats a memory is that
it carries the mistakes forward, not just the happy path.

Finally, tell me plainly what this will NOT handle, so nobody discovers the boundary
the hard way.
