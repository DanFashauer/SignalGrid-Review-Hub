# Vendored: obra/superpowers

Third-party work, copied in unmodified. **Not ours.**

> **One exception in this directory:** `owner-comms/` is FIRST-PARTY — written in
> this repository, not part of the upstream set. It lives here because the harness
> loads skills from this directory. Everything else below describes the other 14.

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
