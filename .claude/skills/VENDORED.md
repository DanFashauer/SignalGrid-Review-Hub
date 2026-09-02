# Vendored: obra/superpowers

Third-party work, copied in unmodified. **Not ours.**

> **TEN exceptions in this directory — read this before any re-vendor.** These are
> FIRST-PARTY, written in this repository and NOT part of the upstream set. They live
> here because the harness loads skills from this directory. Everything else below
> describes the other 14. Counted, not remembered: `ls -1d .claude/skills/*/` lists 24
> directories = 14 upstream + the 10 in the table. This line said SEVEN until 2026-09-02,
> three skills after it stopped being true — the same drift that took it from "one
> exception" to seven, recorded below.
>
> **The seventh, `signalgrid-master/`, arrived 2026-08-25 under DR-018 and is a
> MIRROR, not an original.** The owner's synced copy at
> `~/.claude/skills/synced/signalgrid-master/` still exists and still loads. What
> changed is which copy is AUTHORITATIVE: this one, because it is the one that can
> `pnpm run scan:agent-plane` reports the synced copy AND compares it byte-for-byte
> against this one, printing `identical` or `DIVERGED`. That comparison did not
> exist when this sentence was first written on 2026-08-25 — the scanner read only
> the home directory and never opened the committed copy, so the safeguard named
> here was a claim with nothing behind it. Implemented the same day, once the first
> agent-platform-engineer shift caught it.
> one to correct.
>
> | Skill | Authored | What it defines |
> | --- | --- | --- |
> | `owner-comms/` | 2026-08-20 | how this org writes to the owner |
> | `signalgrid/` | 2026-08-22 | the base skill every SignalGrid role inherits |
> | `signalgrid-core/` | 2026-08-22 | executor for web, performance, data, API and six domain roles |
> | `signalgrid-native/` | 2026-08-22 | executor for mobile, desktop, firmware and the Mac lane |
> | `signalgrid-reviewer/` | 2026-08-22 | executor for qa-engineer |
> | `signalgrid-scribe/` | 2026-08-22 | executor for docs, compliance, release, archivist, positioning |
> | `signalgrid-master/` | 2026-08-25 | the orchestration layer — vendored from the owner's synced skills per DR-018 |
> | `signalgrid-evidence-toolchain/` | 2026-08-26 | the evidence toolchain a role uses to produce provable output (#321) |
> | `loop-start/` | 2026-08-31 | the session-start ritual — handoff enforcement pack, DR-021 |
> | `loop-end/` | 2026-08-31 | the session-end ritual — handoff enforcement pack, DR-021 |
>
> **This note said "one exception" until 2026-08-24, and it was true when written on
> 08-20.** The five `signalgrid-*` skills landed on 08-22, after it, and nothing
> updated the sentence — so a re-vendor operator following it literally would have
> overwritten the skills that define four of the org's executors. Found by the
> first audit of `.claude/`, which until that day no role owned.

| | |
|---|---|
| Upstream | https://github.com/obra/superpowers |
| Author | Jesse Vincent |
| Licence | MIT (`LICENSE` in this directory, copyright notice intact) |
| Commit | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` |
| Committed upstream | 2026-08-12T09:53:21-07:00 |
| Vendored | 2026-08-20 |
| Contents | 14 skills, 51 files, byte-identical to upstream |

## Why these and nothing else

Seven skill collections were surveyed. Only these were taken, and the reason is
licensing before it is taste — **this repository is PUBLIC**, so anything committed
here is republished under our own MIT grant, and we can only grant what we were
granted.

| Surveyed | Licence | Usable here |
| --- | --- | --- |
| `obra/superpowers` | MIT © 2025 Jesse Vincent | **yes** — vendored |
| `OneWave-AI/claude-skills` | MIT © 2025 OneWave AI | yes, not taken |
| `affaan-m/ECC` | MIT © 2026 Affaan Mustafa | yes, not taken |
| `ericbuess/claude-code-docs` | MIT | yes, not taken |
| `yamadashy/repomix` | MIT © 2024 Kazuki Yamada | yes — a tool, would be a dependency |
| `eyaltoledano/claude-task-master` | custom "Task Master License" | **unread — do not use until read** |
| `ComposioHQ/awesome-claude-skills` | **none** | **NO** |
| `travisvn/awesome-claude-skills` | **none** | **NO** |
| `hesreallyhim/awesome-claude-code` | **CC BY-NC-ND 4.0** | **NO** |

Three of those carry **no licence file at all**, and one of them holds 864 skills.
Absence of a licence is not permission — it is the default, which grants nothing.
"It is on GitHub and the repo is called awesome" is the exact reasoning this table
exists to stop. `CC BY-NC-ND` rules itself out twice over: **NonCommercial**
against a commercial venture, **NoDerivatives** against adapting anything.

This is what `scripts/publication-boundary.mjs` means by its `third_party_intake`
class: *"The risk here is not leaking outward — it is REPUBLISHING someone else's
licensed work from a public repository."* This directory is classified there, with
the licence basis above as the stated basis.

## Why superpowers specifically

Its 14 skills describe the discipline this repository already enforces mechanically.
`verification-before-completion`, `systematic-debugging`,
`test-driven-development`, `requesting-code-review` and
`finishing-a-development-branch` are the workflow form of what `preflight.mjs` and
the `proof:*` suite enforce as gates. Adopting them adds no new claim to the
product and no new surface to the launch profile.

## Caveats a reader needs

- **Unmodified on purpose.** An untouched copy is the cheapest thing to audit and
  to re-sync against upstream. Do not edit files here — if a skill needs to differ
  for this repo, write our own under `.claude/commands/` and say why it differs.
- **`using-superpowers` is harness-specific.** Its `references/` name Codex,
  Gemini, Antigravity, Hermes and Pi tooling that this repository does not use.
  Kept anyway rather than pruned, because a partial copy is harder to diff against
  upstream than a whole one, and MIT does not require us to ship all of it.
- **Vendored, not tracked.** Nothing re-syncs this automatically. The commit above
  is the version that was read; a newer upstream is not in this tree until someone
  deliberately re-vendors and re-reads.
- **Not reviewed line by line.** These 51 files are third-party prompt content that
  has been surveyed, not audited. They are NOT counted in
  `docs/agent/review-coverage.json`, because counting unread files as reviewed is
  the precise fiction that ledger exists to prevent.
