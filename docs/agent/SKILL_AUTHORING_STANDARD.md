# Skill authoring standard — the bar a SignalGrid skill has to meet

**First-party.** Written here on 2026-09-12, in our own words. It is not a copy of
anyone's file and nothing in it is vendored prose.

**Where it came from.** Vendoring eleven skill collections in one pass (2026-09-12,
`.claude/skills/VENDORED.md`) put roughly 350 third-party skills in front of one reader,
and they were not of one quality. Most are a title, a paragraph and some numbered steps.
A few are engineered artifacts with a stated audience, a stated refusal boundary, a
stated outbound-data surface, a published measurement of whether they help, and a
cryptographic signature over their own files. The second kind came almost entirely from
one place — [NVIDIA/skills](https://github.com/NVIDIA/skills), read at pin
`9ca28078c7e9acef40347c7bb15449a281f3fb8d` — and the five properties below are that bar,
restated for this repository. Four of their skills are vendored here; this document is
what was learned from reading those four and the shape the catalog around them repeats,
which is a different thing from copying any of it and is why this file is first-party.

This is a standard for the skills **we author** — the fourteen first-party directories in
`.claude/skills/`. A vendored skill is never edited to meet it (that is the whole point
of vendoring); where a vendored instruction contradicts this repository, it gets an
`## Overrides` row in `.claude/skills/VENDORED.md` and nothing else.

---

## 1. Negative triggers — say when NOT to load

Every skill description says what it is for. Almost none say what it is *not* for, and a
harness that selects by description alone will load the nearest-sounding thing. NVIDIA's
`doca-hardware-safety` ends its description with a refusal list: general orientation
belongs to one sibling skill, install debugging to another, program-side debugging to a
third — by name. It also lists the phrasings that *should* trigger it even though they do
not contain its own words ("flip BlueField mode over SSH", "vendor says this is
one-way").

**The bar here.** A first-party skill description carries both halves: the implicit
phrasings that must trigger it, and the named siblings that own what it declines.

This repository has the failure mode that argument is about. `signalgrid-core`,
`signalgrid-native`, `signalgrid-reviewer` and `signalgrid-scribe` are four executors
whose subjects overlap at every seam, and `signalgrid-master` exists to route between
them. Routing written into a separate skill is routing the selector cannot see. The
descriptions should decline by name.

## 2. Refuse-and-escalate, written into the skill

A skill is a procedure, and a procedure meets situations where the right move is to
stop. `doca-hardware-safety` wraps every hardware-touching change in pre-flight
inventory, an out-of-band reachability check, a maintenance window, a rehearsal on a
replica and a rollback — and its refusals are steps, not warnings: without an
out-of-band path to the device, the change does not happen.

**The bar here.** A first-party skill that can produce an irreversible or
outward-facing effect names its own stop conditions as numbered steps, with the escalation
target. Three already exist in this tree and should be written the same way everywhere:

- Egress — anything that sends owner data or repository source to a third party stops
  and asks the owner, per machine, per run (CLAUDE.md "Ask before"). Two vendored
  skills in this tree reach outward under a credential —
  `retrieving-developer-knowledge/` (a Google endpoint, `DEVELOPERKNOWLEDGE_API_KEY` or
  ADC) and `doubt-driven-development/` (a second model through a foreign CLI) — and both
  carry an Overrides row saying so rather than an edit.
- Claims — anything that would change what may be *said* to ship stops at the
  launch-claims gate and the publication boundary. Building and claiming are different
  acts (DR-021).
- Unknown state — an unreachable signal, an unreadable file, a check that could not run
  raises assurance and never lowers it (golden rule 2). A catch arm that mints its own
  success is the defect `scripts/check-nan-fail-open.mjs` exists for.

## 3. An outbound-data disclosure table

NVIDIA ships a `skill-card.md` beside each SKILL.md: owner, licence, use case,
deployment geography, known risks with their mitigations, output types and formats. It
is a data sheet — the thing a reviewer reads instead of the whole skill.

**The bar here.** A first-party skill whose mechanism reaches outside the machine states,
in a table near the top: what leaves, to whom, under whose credential, whether it can be
turned off, and what happens when the credential is absent. Not a sentence in the middle
of a procedure — a table, in one place, that a reader can check without trusting the
prose around it.

The reason is specific and recent. This repository has never shipped a script that makes
an outbound network request, and that is a deliberate property, not an accident: the one
written for a byte-identity check in September 2026 tripped CodeQL's
file-data-in-outbound-request query and was deleted rather than merged
(`.claude/skills/VENDORED.md`). A skill that quietly acquires an egress path is how that
property ends. Keys stay out of the tree in every case (DR-029).

## 4. Published measurement, including when it makes things worse

NVIDIA evaluates each skill before publication across five dimensions — security,
correctness, discoverability, effectiveness, efficiency — and publishes the number **and
the uplift against a no-skill baseline**. `doca-hardware-safety` reports +46% and +48%
effectiveness across its two tiers. `nemo-rl-session-memory` reports **−5%** on one tier
beside +22% on the other, and shipped anyway with the negative number in the file.

That is the property worth copying, and it is not the positive numbers. A published
negative uplift is a measurement someone could have quietly dropped and did not — the
same discipline as this repository's rule that a failing gate is reported failing, and
that a skipped gate is not a pass.

**The bar here.** A first-party skill that claims to improve an outcome says how that was
measured and against what baseline, or it does not make the claim. "It helps" with no
baseline is the skill-plane version of a fossil figure, and
`scripts/check-derived-doc-figures.mjs` exists because this repository keeps producing
those. No measurement is an honest state; an unmeasured claim is not.

## 5. Provenance that survives the copy

Each NVIDIA skill carries a sigstore bundle signing the digests of its own files. We
vendor those bundles and **verify none of them** — verification needs an outbound
request, and this tree does not make those (point 3). Said plainly so the file is not
read as more than it is.

What this repository does instead is structural, and it is already stronger in the one
way that matters for a public tree: every vendored directory carries its upstream
LICENSE; `.claude/skills/VENDORED.md` names the pin, the commit date, the file count and
the byte-identity check for each upstream; `scripts/publication-boundary.mjs` classifies
the whole directory and states the licence basis; and section E of
`scripts/check-publication-boundary.mjs` fails the build the moment the count in the
registry, the carve-outs in the boundary and the directories on disk disagree.

**The bar here.** A first-party skill is identified by its carve-out and its table row,
not by a signature. A vendored one is identified by its pin and its `diff -r`. Neither is
identified by memory.

---

## Sources read, not copied

Two collections were read closely and **not** vendored, for reasons that have nothing to
do with their quality. Their transferable doctrine is written up here, in our own words,
because ideas are not copyrightable expression — the same precedent this repository used
for the CLI-Anything method (DR-040; the vendoring record was renumbered on 2026-09-12 after the Mac lane's DR-038 landed first).

### trailofbits/skills — CC BY-SA 4.0

**Why not vendored.** ShareAlike. A copyleft term on files committed to a public
repository reaches this repository's own MIT grant, and we can only grant what we were
granted (`.claude/skills/VENDORED.md`, the licence-survey table). NonCommercial and
NoDerivatives rule themselves out the same way; ShareAlike is the subtler one because it
*is* a free licence, and it is still a hard line here.

Four things from that reading that this repository should hold itself to:

- **Property-based testing beats example-based testing for a decision core.** An example
  test asserts that one input produces one output. A property asserts something true of
  *every* input — that an unknown signal never lowers assurance, that adding a signal
  never turns a deny into an allow, that a decision is a pure function of its inputs. The
  `proof:*` suite is fixture-backed and deterministic, which is the right foundation; the
  properties above are not currently asserted over generated inputs anywhere, and a
  fixture cannot find the case nobody imagined.
- **Differential review — two implementations of one rule must agree.** This repository
  already owns the sharpest example of the technique in the tree and does not call it
  that: `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is a byte-faithful
  port of the TypeScript simulator, and *parity is the point* (CLAUDE.md, golden rule 1).
  The general lesson is that two independent implementations disagreeing is a free
  oracle, and it is worth looking for the next place one is available.
- **Insecure defaults are the bug, not the misconfiguration.** A default that loosens
  when information is missing is a vulnerability even when every documented path is
  correct. This repository has the canonical instance on the record:
  `managedBool("AllowManualOverride", default: !isManaged)` handed the override to
  exactly the supervised phone the organisation believed was captive, because "no
  managed-configuration dictionary" and "not managed" are not the same state. It is now
  gated by `scripts/check-ios-policy-defaults.mjs`. Look for the shape, not the instance.
- **Name the sharp edges of the tools you use.** A review that says "use the crypto
  library correctly" helps nobody; one that names the specific API whose misuse is silent
  is a control. This repository's `stack-reference` skill is that idea already —
  "the generic cheatsheet says X, here it breaks Y, do Z" — and it should keep being fed.

### ramzesenok/iOS-Accessibility-Audit-Skill — no licence

**Why not vendored.** No LICENSE file. Absence of a licence is not permission; it is the
default, which grants nothing. Nothing was read closely enough from it to write up, and
nothing from it is in this tree.

---

## What this document does not do

It is not a gate. `scripts/check-skill-plane-conformance.mjs` enforces the shape of a
skill's frontmatter; `scripts/check-skill-instruction-conflicts.mjs` holds every skill to
the Bash deny list; section E of `scripts/check-publication-boundary.mjs` holds the
vendored count to the tree. The five properties above are judgement, and no regex reads
judgement. If one of them ever becomes mechanical, it becomes a gate and this section
says which.
