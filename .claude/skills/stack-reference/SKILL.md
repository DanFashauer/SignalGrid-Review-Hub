---
name: stack-reference
description: The org's corrected quick reference for every tool in the SignalGrid stack — shell (stock bash 3.2 + BSD userland on the Mac vs bash 5 + GNU on CI), git and GitHub Actions and gh, containers with Postgres/Redis/nginx/OpenSSL, the Mac build host (Homebrew, launchd, ssh, tmux), Swift, Kotlin and Rust, TypeScript/Node/regex/YAML/TOML, HTTP status codes, MIME, ports and markdown, and the agent CLIs. Written as "the generic cheatsheet says X; here it breaks Y; do Z instead", every entry verified on this Mac or against a named repo gate. Use BEFORE running a shell, git, container, CI or toolchain command from memory or from a reference site, when a command fails on one machine but not the other, or when porting a snippet from a cheatsheet into a script, gate or workflow.
---

# SignalGrid — Stack Reference

A cheatsheet is written for a generic machine. This repository is not one: its
scripts run under the 20-year-old bash 3.2 that ships with macOS AND under bash 5
on ubuntu CI; its userland is BSD here and GNU there; its git has hooks that
refuse commands the internet recommends; its default branch is not `main`; its
package manager is not npm; its decision code is fail-closed in four languages.
Generic advice pasted into that environment fails in one of three ways, in
rising order of cost: it errors (cheap — you see it), it silently does something
else (expensive — a "pass" that is not one), or it trips a rule the repo exists
to enforce (a fail-open in the Assist gate, a banned command, an exposed port).

This skill is the map of those failures. It was built on 2026-09-04 by holding
the 215 sheets of the owner-shared Fechin/reference site against this tree —
nine reader agents, one per domain, each running the doubtful commands on the
Mac lane and citing the gate or doctrine that governs — and keeping only the
CONTRADICTIONS (102) plus the items that survived contact. It inherits the base
`signalgrid` skill and does not repeat it. Intake record:
`docs/agent/RESOURCE_INTAKE.md` (2026-09-04).

## Five laws that every domain file is an instance of

1. **Two userlands, one script.** A shell script is portable only once it has
   run under BOTH `/bin/bash` 3.2 with BSD tools and bash 5 with GNU tools.
   "Works here" and "works in CI" are separate facts, and the traps run in both
   directions: `find -mtime +1w` passes here and fails there; `sed -i 's/x/y/'`
   passes there and fails here; `{5..50..5}` errors nowhere and runs once with
   garbage. shellcheck (`scripts/check-shell.mjs`) does NOT catch 4.x-only syntax.
2. **Banned and ask-first are not suggestions.** `git reset --hard`, `git stash`
   (all forms), `--no-verify`, `--force`, `curl … | sh`, `claude --bare`,
   `--dangerously-skip-permissions`, `/init`, a blanket `brew upgrade`,
   `docker system prune`, `FLUSHALL`, a `DROP` against a server you did not start,
   any `gh … delete` — each is either hook-denied (`.claude/hooks/block-dangerous.sh`)
   or an owner decision under CLAUDE.md "Ask before". The cheatsheets list every
   one of them as a plain one-liner.
3. **The names are different here.** `pnpm` (never npm/yarn; `pnpm install
   --frozen-lockfile`, Node 22), `SignalGrid_Alpha` (never `main` — a copied
   `if: github.ref == 'refs/heads/main'` never fires and the guarded step silently
   never runs), `docker.io/library/<image>` (never a short name — `scripts/check-container-native-base.mjs`
   fails it), `127.0.0.1:<offset port>` (5433/6380/55432 — never the well-known
   5432/6379 on the host), `-p host:container` (never `--expose`, which publishes
   nothing).
4. **Fail-closed in every language.** No wildcard arm over the repo's own enums
   (`_ =>`, `else ->`, `default:` — the four outcomes are the whole vocabulary and
   a new case must be a compile error); where a `default:` is required
   (TypeScript, `review-invariants` check 1) it TIGHTENS and sinks to `never`;
   `u16::try_from` not `as` (which wraps silently); `guard let` not `!`; `?.let {
   runCatching … }` not `!!`; `unknown`-then-validate not `any`/`as`; absent and
   present-but-unreadable are DIFFERENT failures and both DENY with a reason.
   A 404 where the sheet says 403, because existence is the secret.
5. **Deterministic, and the tree is the provenance.** No `$RANDOM`,
   `Int.random`, `Date()`, `Math.random`, `Date.now()` in a decision path; sort
   keys before encoding (Swift hashes per process); nothing that dirties the
   working tree — `chmod -R`, build output, key material, converted-table
   escapes — because `provenance.workingTreeClean` is sampled from `git status
   --porcelain` and a dirty tree is an untrusted result.

## The domain files — read the one for the tool you are about to use

| Before you… | Read |
| --- | --- |
| write or paste ANY shell — arrays, sed/awk/find/grep, curl, netstat/nc, chmod | `shell.md` (28 contradictions, the largest set) |
| run a git command you did not type yesterday, edit a workflow, use `gh` | `git-ci.md` |
| touch Docker/podman, compose, Postgres, Redis, nginx, OpenSSL in an image | `containers.md` |
| install, upgrade, schedule, tunnel or background anything on the Mac | `mac-host.md` |
| write Swift, Kotlin or Rust that a verdict passes through | `native.md` |
| add a dependency, write a regex for a gate, import JSON, edit YAML/TOML | `typescript.md` |
| script an agent CLI, add a hook, permission rule or schedule | `ai-cli.md` |
| return a status code, pick a port, write a markdown doc a gate reads | `http-docs.md` |

Every entry has three parts. **SAYS** is the sheet's advice, verbatim or close.
**BREAKS** is what actually happens here — the verified error text, the silent
wrong result, or the rule it violates, with the gate or file that holds the
rule. **DO** is the form that works on both machines and inside the rules.

## How to use it without it going stale

- When a command fails on one machine and not the other, the answer is almost
  always in `shell.md` law 1; check there before "fixing" the script for the
  machine in front of you.
- A new entry earns its place only with the failure VERIFIED (run it, quote the
  output) AND the rule NAMED (file, gate or CLAUDE.md line). An entry that says
  "probably breaks" is a guess and does not go in.
- When a gate or hook changes, the entries that cite it change the same day —
  `git grep <gate name> .claude/skills/stack-reference` finds them.
- This is an instruction file, not a tool: it installs nothing, sends nothing.
  It is the twelfth first-party exception in the vendored skills directory —
  `.claude/skills/VENDORED.md` and section E of `scripts/check-publication-boundary.mjs`
  hold that count to the carve-out list, and `scripts/check-skill-plane-conformance.mjs`
  holds this frontmatter to the directory name.
