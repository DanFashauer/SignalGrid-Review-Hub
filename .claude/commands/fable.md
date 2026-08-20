---
description: Same polish as /48, but aimed at Claude Fable 5 for creative work.
argument-hint: [the creative prompt you want tightened]
---

Rewrite this prompt for Claude Fable 5, the creative-writing model in the Claude 5
family.

<prompt>
$ARGUMENTS
</prompt>

Creative prompts fail differently from analytical ones. They fail by being so
specified that the output is inert, or so loose that it drifts. Aim between:

- **Fix the constraints that carry meaning** — form, length, point of view, tense,
  who is speaking and to whom, what must be true by the end.
- **Leave the discoveries open.** Do not pre-write the images, the turns of phrase
  or the ending. If the prompt already contains its own best line, cut it and say
  why.
- **Name what to avoid concretely**, because "don't be clichéd" is not actionable
  and "no weather-as-mood openings, no dream reveals" is.
- **Anchor the voice with a sample, not an adjective** — a line of my own writing
  beats "lyrical but grounded".
- **Say what the piece is FOR** and who reads it. Purpose disciplines style more
  than any instruction about style.

Return:

1. **The rewritten prompt.**
2. **What I changed and why.**
3. **What I deliberately left open, and what that costs** — so I can close it if I
   actually wanted it closed.
