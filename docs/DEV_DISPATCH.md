# Dev dispatch — when to build in the cloud vs locally

**Both environments, one source of truth.** SignalGrid development runs in two
places, and git is the bridge between them:

- **Cloud** — Claude Code on the web (what you've been using). A fresh, ephemeral
  container clones the repo per session. Best for autonomous multi-hour builds,
  PR/review cycles, and driving work from a phone or browser while you're away.
- **Local** — Claude Code CLI on your Mac/Windows against a local clone. Best for
  hands-on work: running and *seeing* the app, demos, investor prep, and fast
  iteration where a push-to-see loop would slow you down.

Neither is "the" repo — they're two working copies of the same GitHub repo
(`DanFashauer/SignalGrid-Review-Hub`). You move between them by pushing and
pulling the same branches (`SignalGrid_Alpha` + feature branches).

## The routing rule

Pick the environment by what the task needs, not by habit:

| Use **LOCAL** when the task… | Use **CLOUD** when the task… |
| ---------------------------- | ---------------------------- |
| runs or screenshots the app / a demo | is an autonomous multi-hour build you kick off and walk away from |
| needs you to *see* it live (UI, charts, the embedded demos) | is PR triage / responding to review comments / CI babysitting |
| iterates fast (many small edits, tight loop) | you're starting from a phone or a browser with no laptop |
| is investor/partner prep you're demoing in person | should run on a clean, disposable environment |
| touches secrets/local env you don't want in the cloud | is long and you want it to continue while you're away |

When both could work, prefer **local** for anything you'll look at, and **cloud**
for anything you'll walk away from.

Ask the helper if you're unsure:

```bash
pnpm run dispatch "run the desktop demo and screenshot the Windows chrome"
#   → LOCAL — needs to run/see the app.
pnpm run dispatch "keep building the backlog while I'm out, open PRs as you go"
#   → CLOUD — long autonomous build; runs while you're away.
```

## Git is the bridge (avoid conflicts)

1. **One branch at a time in flight.** Do a given piece of work in one place
   until it's pushed, then continue it in the other. Don't edit the same branch
   in both simultaneously.
2. **Always start from the remote.** In either environment:
   `git fetch origin && git checkout <branch> && git pull --ff-only`.
3. **Push before you switch.** Finish a session with `git push`; the other
   environment picks it up with a pull.
4. **The default branch is `SignalGrid_Alpha`.** Feature work goes on a branch and
   lands via PR (so CI + Codex review run), then both copies pull the merged base.

## Local setup (one time)

On your Mac or Windows (WSL or PowerShell):

```bash
# 1. Node 22 + pnpm (pnpm ships via corepack, matching the repo's version)
#    macOS:  brew install node@22   |  Windows: winget install OpenJS.NodeJS.LTS
corepack enable

# 2. Clone
git clone https://github.com/DanFashauer/SignalGrid-Review-Hub.git
cd SignalGrid-Review-Hub

# 3. Install exactly what CI uses
pnpm install --frozen-lockfile

# 4. Prove the tree is green (same gate suite CI runs)
pnpm run preflight

# 5. See something run
pnpm --filter @workspace/signalgrid-web run dev        # the marketing site
pnpm --filter @workspace/api-server run dev            # the /v1 decision API
open docs/embedded-desktop-demo.html                   # a self-contained demo
```

If `pnpm run preflight` passes locally, it will pass in CI — it's the same suite.

## Claude Code in each environment

- **Cloud:** start a session from claude.ai/code (or a GitHub trigger). It clones
  fresh, so nothing persists unless it's pushed.
- **Local:** install the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`),
  run `claude` inside the repo. It has your working copy directly — no push to
  see changes.

Both drive the same git history, so a branch built in one is available in the
other after a push/pull.
