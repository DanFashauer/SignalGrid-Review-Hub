# Slash commands

Nine commands, chained the way the work actually flows: a messy idea goes in one
end, a usable prompt comes out the other. Each is also fine on its own.

```
messy idea
    ↓
/prompt-master     brain dump in, clean task spec out
    ↓
/grill-me          asks questions until nothing is vague
/how-to            maps the steps you don't know yet
    ↓
/48                polish the prompt for Opus 4.8
/fable             same polish, for Fable 5 (creative work)
    ↓
/personal-voice    tune it to sound like you
/anti-ai           strip the AI tells from the draft
    ↓
/write-a-skill     bottle it as something reusable
/handoff           write the doc that starts your next chat
```

Type the name with a leading slash and pass your text after it:

```
/how-to archive a GitHub repo from my iPhone
/grill-me we should add a webhooks connector family
/handoff focus the next session on the status-code contract gap
```

## Why these are written the way they are

Each file carries its **failure mode**, not just its happy path — that is the whole
reason a command beats remembering. Three worth knowing:

- **`/how-to` establishes WHERE the task happens before writing a step.** The
  common failure of a guide is not a wrong step; it is a step describing a control
  that does not exist in the place the reader is standing. This repo learned that
  the expensive way: an owner-action list sent someone into the GitHub mobile app
  to change repository settings, which that app cannot open at all. No amount of
  care following those steps would have worked.

- **`/grill-me` refuses vague answers.** Accepting one is its single failure mode,
  so it is told to push back and ask again.

- **`/handoff` separates verified from assumed.** Blurring those is how a session
  inherits a false belief and builds on it.

## Adding to the set

Use `/write-a-skill`. It decides first whether the thing should exist at all — an
unused command is clutter that later reads as capability — and writes the file with
the failure modes included.
