# The Mac build host — Homebrew, launchd, ssh, tmux, permissions

The Mac is the lab and the build host (memory: `mac-is-the-lab-consolidated`,
`mac-lane-is-the-build-host`), not a disposable container. It is the ONLY machine that
can mint `artifacts/live-evidence/mac-run.json`, run the iOS simulator, or run the
android/desktop toolchains. Anything that moves a version, opens a port, or touches
`~/.ssh` is therefore an owner-visible act. Verified 2026-09-04.

## Homebrew

1. **SAYS** `brew link <formula>`.
   **BREAKS** keg-only formulae (`openjdk@17`, `node@22`) refuse `brew link`; `brew link
   --force` would put JDK 17 or node@22 in front of `/usr/bin/java` and the Node on PATH for
   every lane on this machine.
   **DO** set it per command or in the harness script: `JAVA_HOME=/opt/homebrew/opt/openjdk@17
   gradle …`, or `PATH=/opt/homebrew/opt/<formula>/bin:$PATH cmd`. Never `--force` a keg-only
   link on the build host. `brew info <formula>` prints the keg-only caveat verbatim.
2. **SAYS** `brew upgrade` — "upgrade all outdated and unpinned brews".
   **BREAKS** `brew list --pinned` is EMPTY here, so this moves gradle off 9.7.1, plus
   xcodegen, podman and rust, under a running lane — and every version quoted in a doc or a
   sim result goes stale at once.
   **DO** `brew pin gradle openjdk@17 xcodegen podman` first; upgrade ONE formula
   deliberately with `brew upgrade <formula>`; re-quote `brew list --versions` afterwards.
3. **SAYS** install Homebrew with `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.
   **BREAKS** Homebrew is already installed (6.0.x); piping an unpinned remote script into
   bash contradicts the supply-chain discipline the repo enforces on itself.
   **DO** use the existing brew. Any curl|bash on the build host is an owner decision, with
   the URL and SHA shown first.
4. Sandbox notes: `brew list --versions <f>…` reads the Cellar and works INSIDE the Claude
   sandbox; anything touching the formula API cache (`brew install`, `brew info` on a cold
   cache) fails inside it with `Operation not permitted @ dir_s_mkdir` — run those
   sandbox-off. `brew install --cask <name>` is a different target from `brew install`.

## Scheduling

5. **SAYS** `crontab -e`.
   **BREAKS** the Mac's scheduler is launchd (`~/Library/LaunchAgents/com.signalgrid.session-autostart.plist`
   is the live example). cron on macOS runs with a bare PATH and none of the TCC grants
   (Screen Recording, Full Disk Access) a lane needs.
   **DO** a LaunchAgent plist with `StartCalendarInterval` / `StartInterval`, an explicit
   PATH set inside the script (`sg-login-autostart.sh` exports
   `/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:…`), `StandardOutPath` /
   `StandardErrorPath` under `~/Library/Logs`, loaded with `launchctl bootstrap gui/$(id -u)
   <plist>`. Translation: `@reboot` = `RunAtLoad true`; `crontab -l` = `launchctl print
   gui/$(id -u)/<label>` (shows `state`, `runs`, `last exit code`).
6. **SAYS** cron extensions `1L`, `4#2`, `?`, `@daily`.
   **BREAKS** see `git-ci.md` 15 — GitHub Actions `schedule:` rejects them; launchd does not
   use cron syntax at all.
   **DO** 5-field UTC in Actions; `StartCalendarInterval` dictionaries in launchd.

## ssh

7. **SAYS** key types rsa/ed25519/dsa/ecdsa; `ssh-keygen -t rsa -b 4096 -C "you@mail"`.
   **BREAKS** DSA is disabled since OpenSSH 9.8 and refused by GitHub; RSA-SHA1 signatures
   are refused by GitHub since 2022. Generating keys is an OWNER action here.
   **DO** `ssh-keygen -t ed25519 -C "<comment>"`, run by the owner, key kept in `~/.ssh`. The
   agent verifies only: `ssh -T git@github.com` and quotes the greeting (`Hi DanFashauer!
   You've successfully authenticated…`).
8. **SAYS** `ssh-keygen -y -f private.key > public.pub`; `ssh-keygen -f ~/.ssh/name`; `scp
   user@server:/dir/* .`.
   **BREAKS** redirecting or copying key material with cwd in the worktree drops it INTO the
   tree; the root `.gitignore` has `.env*` only — no `*.pem`, `*.key`, `id_*` patterns — so it
   would be staged by an `-A`.
   **DO** never run ssh-keygen or scp toward a repo path; keys live only in `~/.ssh`. Before
   any push, read the patch's file list against what you meant to change.
9. **SAYS** `ssh -g` ("allow remote hosts to connect to local forwarded ports"); `ssh -f -N -L
   local:remote:port user@server` (background tunnel).
   **BREAKS** `-g` binds the forward on 0.0.0.0 and exposes whatever is tunnelled — the
   api-server `/v1`, a lab Postgres or Redis — to the LAN. A backgrounded `-f` tunnel is
   invisible to the next session.
   **DO** keep the default 127.0.0.1 bind, never `-g`. If a tunnel is needed, run it
   FOREGROUND inside a named tmux session so `tmux ls` shows it and `tmux kill-session -t`
   ends it. `ssh-keygen -F github.com` / `-R github.com` inspect and clear a stale
   `known_hosts` entry.

## tmux and TTYs

10. **SAYS** `tmux new -s myname` (start), `tmux a` (attach).
    **BREAKS** from the Bash tool there is no TTY: `tmux new -s` without `-d` fails with `open
    terminal failed: not a terminal`, and attach is impossible. tmux is also NOT installed
    on this Mac yet (`command not found`).
    **DO** `brew install tmux` (sandbox off), then `tmux new -d -s <name> '<cmd>'`; read with
    `tmux capture-pane -p -S -200 -t <name>` (the last 200 lines to stdout); drive with `tmux
    send-keys -t <name> '<cmd>' Enter`. Leave `tmux a -t <name>` / `Ctrl+b d` to the owner at
    a real terminal.

## Permissions the sheets never mention — TCC

- `screencapture` from a shell needs **Screen Recording** granted to the TERMINAL app
  (System Settings → Privacy & Security → Screen Recording → Terminal, then quit and relaunch
  Terminal). Without it the desktop `window-smoke` op builds and launches the Tauri shell and
  then FAILS only its mandatory screenshot — the one open item on
  `2026-09-02-android-desktop-first-run`. This is an owner action; no flag substitutes.
- Gradle cannot run inside the Bash sandbox (native-library load fails under the default
  `~/.gradle`); run the Kotlin lane sandbox-off with `JAVA_HOME` set — see `native.md`.
