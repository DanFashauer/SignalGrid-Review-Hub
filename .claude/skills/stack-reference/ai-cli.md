# Agent CLIs — Claude Code, Codex, Cursor, OpenCode

The repo's rules are enforced by HOOKS (`.claude/hooks/block-dangerous.sh`,
`verify-done.sh`, `session-start.sh`) and by a hand-tuned `CLAUDE.md` (which carries a gate
marker `<!-- framing:mechanism -->` that `scripts/check-product-framing.mjs` reads) plus an
`AGENTS.md` for CLIs that never read `CLAUDE.md`. Anything a sheet recommends that skips
hooks, prompts or CLAUDE.md is therefore recommending that the rules be skipped. Verified
2026-09-04.

1. **SAYS** PostToolUse auto-format hook `"command": "npm run lint --silent"`; permission
   allow list `["Bash(npm test)", …]`.
   **BREAKS** pnpm-only, and CLAUDE.md "Truth and completion": no quiet flags — a silenced
   lint is a check whose failure you cannot see.
   **DO** no per-edit lint hook. `pnpm run typecheck` / `node scripts/preflight.mjs`
   UNSILENCED before push; if a PostToolUse hook is wanted, `pnpm run typecheck` with full
   output. Keep npm out of `permissions.allow`.
2. **SAYS** `git diff main --name-only | claude -p "review for issues"`.
   **BREAKS** the mainline is `SignalGrid_Alpha` (`origin/HEAD` → it), and a plain `git diff`
   misses staged files (`git-ci.md` 3).
   **DO** `git add -A -N && git diff HEAD` for the working tree, or `git diff
   origin/SignalGrid_Alpha...HEAD --name-only` for branch scope; pipe to `claude -p` only as
   a REPORT-ONLY pass.
3. **SAYS** "add Claude as a linter": `"lint:ai": "claude -p 'review changes vs main, report
   file:line + issue'"` in `package.json`.
   **BREAKS** a gate whose output varies run to run is a flaky gate, and "a flaky gate gets
   switched off" — the preflight↔CI parity checks would also have to list it.
   **DO** never an AI step in `package.json` scripts or any gate. AI review is a report-only
   pass (the dormant `tools/ecc-review-pass.sh` pattern) whose findings go through
   `signalgrid-reviewer` to a human.
4. **SAYS** `claude --bare -p "query"` — "skips hooks, CLAUDE.md auto-discovery, plugins, MCP
   and auto memory; ideal for scripting".
   **BREAKS** the banned-command enforcement and the done-means-pushed rule ARE hooks;
   `--bare` disables them.
   **DO** `claude -p "…" --max-turns N --max-budget-usd X` WITHOUT `--bare` — bound cost with
   flags, keep hooks and CLAUDE.md loaded.
5. **SAYS** `claude --dangerously-skip-permissions` ("containers only"); Codex `--yolo`;
   `[profile.ci] approval_policy = "never"`.
   **BREAKS** the Mac is the lab, not a disposable container; force-push, history rewrite
   and branch deletion need the owner's explicit OK — the prompt IS the ask.
   **DO** stay in `default` / `acceptEdits`. Reduce prompts by widening the READ-ONLY allow
   list (`/permissions`), never by bypassing.
6. **SAYS** Cursor batch: `for f in src/**/*.ts; do agent -p "Add JSDoc to $f" --force; done`.
   **BREAKS** bash 3.2: `**` is `*` without `globstar` — one directory level, silently
   (`shell.md` 6); `--force` skips the review.
   **DO** `find src -name '*.ts' -print0 | while IFS= read -r -d '' f; do …; done`, and drop
   `--force`.
7. **SAYS** worktree setup scripts run a package install — Cursor `.cursor/worktrees.json`
   `"setup": ["npm install", "cp .env.example .env"]`; Codex `AGENTS.md` examples likewise.
   **BREAKS** pnpm-only, and `session-start.sh` DELIBERATELY skips install on the Mac: a local
   install adds darwin platform binaries, and restoring the manifests afterwards re-diverges
   the lockfile.
   **DO** in a new worktree, `pnpm install --frozen-lockfile` only when actually needed;
   restore manifests FIRST if the darwin dance ran, then regenerate the lockfile; baseline
   with `./validate-sim-macos.sh` / `node scripts/preflight.mjs`.
8. **SAYS** `/schedule review open PRs every morning at 9am` (cloud scheduled tasks on
   Anthropic infrastructure).
   **BREAKS** the evidence lane is macOS-only — `pnpm run verify:all --require-mcp
   --emit-evidence` refuses on CI; sim-requests run on the Mac against the simulator.
   **DO** Mac-side recurrence via launchd LaunchAgents (the `com.signalgrid.session-autostart`
   pattern, `mac-host.md` 5) or `/loop` inside the pinned lane session; `/schedule` only for
   work that needs nothing from this machine.
9. **SAYS** `claude mcp add --transport http my-api https://… --header "Authorization: Bearer
   $TOKEN"`; Codex `--bearer-token-env-var MY_TOKEN`.
   **BREAKS** the classifier blocks credential-shaped Bash; tokens in a command land in the
   transcript; the sandbox denies reading `**/.env`.
   **DO** `claude mcp add -e KEY=val` referencing an env var, or hand the credentialed run to
   the owner (the Firecrawl key went in this way — env only, never a tracked file). Never
   expand a token inline in a tool call.
10. **SAYS** `/init` — "generate CLAUDE.md for the project" (Codex/OpenCode `/init` likewise).
    **BREAKS** `CLAUDE.md` is hand-tuned (~250 lines), carries the gate marker above, and the
    repo ALSO has `AGENTS.md`; a regenerated file drops both the marker and the rules.
    **DO** never `/init` here. Edit `CLAUDE.md` / `AGENTS.md` by hand, keep them consistent,
    run `node scripts/preflight.mjs` after.

## Forms that survived — keep these

- Worktrees live at `.claude/worktrees/<name>/` (gitignored) and branch from `origin/HEAD`;
  `git remote set-head origin -a` re-syncs it. Auto memory persists across worktrees of the
  same repo and is machine-local. The worktree guard refuses compound git chains, `export
  PATH=` and `curl | sh` — plain single commands. It also refuses `pnpm run lane:send
  "subject" "<long body>"` because it cannot prove the pnpm script is not git (verified
  three ways, 2026-09-04); call the script directly — `node scripts/lane-message.mjs send
  …` / `ack …` / `inbox` — then commit the message file on MAINLINE, where the other lane
  reads; a message committed on a side branch is undelivered.
- Hook contract: exit 0 = success (JSON decision), 2 = BLOCK (stderr goes to the model), other
  = non-blocking error; `$CLAUDE_PROJECT_DIR` inside hooks; `claude --debug "api,hooks"` and
  `/hooks` show which hook decided. Events beyond the three in use: `WorktreeCreate` /
  `WorktreeRemove`, `FileChanged`, `SubagentStop`, `PostToolUseFailure`, `PreCompact` /
  `PostCompact`.
- `.claude/rules/*.md` with `paths:` frontmatter load only when matching files are opened.
  HTML comments in `CLAUDE.md` are stripped from CONTEXT but not from the FILE — a gate that
  reads the marker still sees it.
- `/rewind` (`Esc Esc`), `/compact [focus]`, `/context`, `/btw <q>`; `claude -n "name"` names a
  session and `claude -r <name> --remote-control` resumes it (memory:
  `combined-session-and-web-resume`).
- `claude mcp list` / `claude mcp get <name>` / `/mcp` for server connection state. Subagent
  frontmatter `isolation: worktree`, `autoMemoryEnabled: true`.
- `/loop <interval> <cmd>` is session-scoped; `/schedule` runs on Anthropic infra; launchd
  runs on the Mac. Pick by where the work's inputs live.
- OpenCode reads `.claude/` by default (`OPENCODE_DISABLE_CLAUDE_CODE` turns it off); Codex
  reads `AGENTS.md` and never `CLAUDE.md` — a rule that lives in only one of them is not a
  rule for the other CLI.
