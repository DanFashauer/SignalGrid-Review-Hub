---
description: Maps the steps you don't know yet — a real guide for the device you're actually on.
argument-hint: [what you're trying to accomplish, and on what device]
---

Write me a true step-by-step guide for this.

<task>
$ARGUMENTS
</task>

**First, establish where this actually happens.** Before writing a single step,
determine which app, site or program the task lives in, and whether the controls
exist there at all on the device I named. If I did not name a device, ask — the
answer changes the whole guide.

This matters because the common failure of a guide is not that a step is wrong; it
is that the step describes a control that **does not exist in the place the reader
is standing**. A mobile app that omits an entire settings section will never show
the reader that setting no matter how carefully they follow. Say that up front when
it applies, and send them somewhere the control exists.

Then produce:

**Before you start** — anything required that I might not have: an account, a
permission level, a file, a program installed. If I might not have admin rights for
something, say which steps need them.

**The steps** — numbered, in order. For each one:
- The literal thing to tap, click or type. Quote button labels exactly.
- What I should see afterwards, so I know it worked.
- A direct link where a link can replace navigation. A URL that lands on the exact
  page beats four taps of directions that may not match my version.

**If it doesn't look like that** — the two or three most likely ways my screen
differs from your description, and what to do in each case.

**How I know I'm done** — the observable end state.

Rules:
- Never invent a UI path you are not confident exists. Say "I can't verify the
  current layout — here is the direct link, and the control is called X" instead.
- Do not skip a step because it is obvious to you. It is not obvious to me.
- If part of this can be done FOR me by someone with API or command-line access,
  say so and mark that step `CAN BE DONE FOR YOU` rather than making me do it.
