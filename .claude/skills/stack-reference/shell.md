# Shell — bash 3.2 + BSD here, bash 5 + GNU on CI

Stock macOS ships `/bin/bash` 3.2.57 and BSD `sed`/`find`/`grep`/`awk`/`nc`/`netstat`.
ubuntu-latest CI runs bash 5 and GNU coreutils. Every script under `scripts/` and the
`validate-sim-macos.sh` harness must run under BOTH, and `scripts/check-shell.mjs`
(`shellcheck -x --severity=warning`) does NOT flag bash-4-only syntax — only running
the script under `/bin/bash` does. Verified 2026-09-04 on this Mac unless stated.

## bash syntax the sheets assume and 3.2 does not have

1. **SAYS** `declare -A sounds; sounds[dog]=bark; for k in "${!sounds[@]}"` (dictionaries).
   **BREAKS** bash 4.0 associative arrays — `declare: -A: invalid option`, rc 2; the script aborts.
   **DO** parallel indexed arrays, a `case` statement, or `key=value` lines split with
   `${pair%%=*}` / `${pair#*=}`. Anything genuinely map-shaped belongs in a node `.mjs`.
2. **SAYS** `${STR,,}` / `${STR^^}` / `"${ARR[@],}"` (case transforms).
   **BREAKS** bash 4.0 case modification — `bad substitution`, aborts.
   **DO** `tr 'A-Z' 'a-z'` — exactly what `validate-sim-macos.sh` does to `uname -s`.
3. **SAYS** `local -n myarray=$1` (pass an array by nameref).
   **BREAKS** bash 4.3 — `local: -n: invalid option`.
   **DO** pass it expanded, `f ${arr+"${arr[@]}"}`; `${!name}` for scalars; or the
   `eval`-based indirection `read_lines` uses in `scripts/cleanup-merged-branches.sh`.
4. **SAYS** `${Fruits[-1]}` (last element), `${name::-1}` (drop the last char).
   **BREAKS** negative subscripts (4.3) and negative lengths (4.2) — `bad array subscript`,
   `substring expression < 0`.
   **DO** `${Fruits[${#Fruits[@]}-1]}`; `${name%?}` or `${name:0:${#name}-1}`. A negative
   OFFSET in parentheses, `${name:(-1)}`, is fine on 3.2.
5. **SAYS** `for i in {5..50..5}` (stepped range).
   **BREAKS** bash 4.0 — and it does NOT error: 3.2 prints the literal `{5..50..5}`, the
   loop runs ONCE with garbage, exit 0. A false pass.
   **DO** `for i in $(seq 5 5 50)` or `for ((i=5; i<=50; i+=5))`.
6. **SAYS** `shopt -s globstar` then `lib/**/*.rb`.
   **BREAKS** bash 4.0 — `shopt: globstar: invalid shell option name`. Under `set -e` the
   script dies; without it `**` degrades to `*` and silently sees one directory level.
   **DO** `find dir -name '*.ext' -print0 | xargs -0 …`, or `git ls-files 'lib/**/*.ts'`
   for tracked files (git's own globbing, not the shell's).
7. **SAYS** `args=("$@"); args+=(foo); echo "${args[@]}"` under `set -euo pipefail`.
   **BREAKS** the CLAUDE.md wrinkle: under `set -u` bash 3.2 treats an EMPTY array's
   `"${a[@]}"` as unbound — `args[@]: unbound variable` with zero script arguments.
   This killed `run-everything.sh` at line 108 in 387 ms while `--fast` worked.
   **DO** the guarded form `${args+"${args[@]}"}` on EVERY array expansion in a `set -u`
   script. No exceptions; the one script that documented it did not generalize.
8. **SAYS** `lines=(\`cat file\`)`; `while read line; do echo $line; done < file`.
   **BREAKS** the first word-splits (2 lines became 3 elements); the second strips
   backslashes (`a\tb` → `atb`) and trims whitespace. Both are wrong data, no error.
   **DO** `while IFS= read -r line; do a+=("$line"); done < file` — the repo's
   `read_lines` helper does this; it also replaces bash-4 `mapfile`.
9. **SAYS** `echo "I'm in $(PWD)"`.
   **BREAKS** runs a COMMAND named `PWD`. It "works" on this Mac only because APFS is
   case-insensitive and resolves `/bin/pwd`; on ubuntu it is `command not found`.
   **DO** `$PWD` or `$(pwd)`.
10. **SAYS** `$(($RANDOM%200))` for a random number.
    **BREAKS** golden rule 2 — deterministic. `review-invariants.mjs` gates the TS side;
    nothing gates `$RANDOM` in a proof script, so it is on you.
    **DO** fixed seeds from committed fixtures; a unique run id comes from `git rev-parse
    HEAD` plus the request id already in `artifacts/sim-requests/`.
11. **SAYS** `[[ "$s" =~ "([0-9]+)" ]]` with the regex quoted (some sheets show it).
    **BREAKS** on 3.2 a quoted right-hand side is a LITERAL string match; `${BASH_REMATCH[1]}`
    is never set.
    **DO** leave the regex unquoted: `[[ "$s" =~ ([0-9]+) ]]`, then `${BASH_REMATCH[1]}`.

## Processes and ports

12. **SAYS** `kill -9 $(lsof -t -i :8080)`.
    **BREAKS** `-i :PORT` matches CLIENT sockets too — an MCP client or the session's own
    child can be the "owner" — and `kill -9` skips the harness's EXIT traps, so containers
    stay up.
    **DO** look first: `lsof -nP -iTCP:PORT -sTCP:LISTEN`; then `kill <pid>` (TERM) on the
    specific listener; let the traps clean up.
13. **SAYS** `netstat -anp | grep :80`, `netstat -ltunp` (all listening ports).
    **BREAKS** Linux net-tools flags; on macOS `-p` takes a PROTOCOL — `option requires an
    argument -- p`, shows nothing.
    **DO** `lsof -nP -iTCP -sTCP:LISTEN`, or `netstat -anv -p tcp | grep LISTEN`.
14. **SAYS** `nc -lp port` (listen), `nc -lp 8001 -c "nc 127.0.0.1 8000"` (proxy),
    `nc -lv 8000 -e /bin/bash` (remote shell), reverse shells "to bypass the firewall".
    **BREAKS** macOS nc: `-p` "cannot use with -l"; `-c` means send CRLF, so the "proxy" is
    a chat session; `-e` does not exist. And a reverse shell on the lab host is out.
    **DO** `nc -l PORT` to listen; `nc -z -w1 host port` to probe; forwarding via `ssh -L`;
    never `-e` or a reverse shell here. Readiness without nc at all:
    `(exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null` — a bash builtin pseudo-device,
    3.2-safe, and what `validate-sim-macos.sh` already uses.

## sed, awk, find, grep — GNU forms BSD rejects, or worse, accepts differently

15. **SAYS** `sed -i 's/old/new/g' file`, `sed 's/old/new/g' -i file`, `sed -ibak … php.ini`.
    **BREAKS** BSD `sed -i` REQUIRES a suffix argument and options are not permuted: form 1
    → `undefined label`, file unchanged; form 2 → an error.
    **DO** `sed -i.bak 's/old/new/g' file && rm file.bak` — the ONLY in-place form that runs
    on both stock macOS and ubuntu. Never `sed -i ''`: GNU reads `''` as the script. For
    anything non-trivial, edit in node where the gates already live.
16. **SAYS** `sed '2a Text after line 2'`, `sed '$a THE END'`, `sed '5i line five'`, `sed '/hello/i Example: '`.
    **BREAKS** GNU one-line a/i/c text; BSD: `command a expects \ followed by text`, rc 1.
    **DO** `sed -e '2a\' -e 'Text'` (two `-e`), or `a\` followed by a literal newline; awk or
    node for more.
17. **SAYS** `sed '3~3a text'`, `sed '3~2d'` (step addresses).
    **BREAKS** GNU-only `first~step` — BSD: `invalid command code ~`.
    **DO** `awk 'NR%2==1'`, `awk 'NR>=3 && (NR-3)%3==0'`.
18. **SAYS** `sed 's/^\s*//'` (strip leading whitespace).
    **BREAKS** `\s` is a GNU extension; BSD sed silently matches NOTHING — verified with
    `od`: spaces intact, rc 0. Silent wrong output is the fail-open class.
    **DO** POSIX classes: `[[:space:]]`, `[[:digit:]]`, `[[:alnum:]]` — in sed AND grep.
19. **SAYS** the substitute flag `e` — "substitute and execute in the command line".
    **BREAKS** GNU-only (BSD: `bad flag in substitute command: 'e'`) AND it executes the
    pattern space as a shell command — data becomes code.
    **DO** never. Produce the command text, review it, run it; or do the logic in node.
20. **SAYS** `find ./ -type f -exec sed -i 's/const/let/g' {} \;`, with `-readable -writable`.
    **BREAKS** three at once: BSD `sed -i` (15); `-readable`/`-writable` are GNU-only (BSD:
    `unknown primary or operator`); and an unscoped `find ./` rewrites `node_modules`, the
    byte-faithful `DecisionEngine.swift`/`AppWorkflows.swift`, and vendored skills.
    **DO** scope it — `find lib -name '*.ts' -not -path '*/node_modules/*' -print0 | xargs -0 …`
    — never touch the two byte-faithful files, and take the patch with `git add -A -N &&
    git diff HEAD` afterwards to read exactly what changed.
21. **SAYS** `find / -perm /u=s` (SUID), `find / -perm /a=x`.
    **BREAKS** GNU `/mode`; BSD: `-perm: /u=s: illegal mode string`. BSD's `+mode` was removed
    from GNU, so neither is portable.
    **DO** `-perm -u=s` (the all-bits form, both); for "executable" `-perm -u=x`, or
    `-exec sh -c '[ -x "$1" ]' _ {} \;`.
22. **SAYS** `-mtime +1w`, `-ctime -6h30m` (unit suffixes).
    **BREAKS** the REVERSE trap: BSD-only suffixes WORK here (rc 0) and GNU find on ubuntu
    rejects them — green on the harness, red in CI. This is the "validate-sim-macos.sh green
    is narrower than CI green" rule made concrete.
    **DO** integer units only: `-mtime +7`, `-mmin -390`.
23. **SAYS** `find . -type f -empty -delete`; `find / -size +100m -exec rm -f {} \;`;
    `find . -name *.mp3 -exec rm {} \;`.
    **BREAKS** `-empty -delete` inside the repo removes intentionally-empty tracked files
    (`.gitkeep`) and dirties the tree; an unquoted `-name *.mp3` is expanded by the shell
    first; deletes are ask-first.
    **DO** run with `-print` first, quote every `-name` pattern, and confine deletes to
    gitignored build output (`native/ios/build/`, `target/`).
24. **SAYS** grep quantifier `{,m}` ("at most m").
    **BREAKS** GNU extension. BSD grep: rc 1, no error, no match — a gate or an absence probe
    written with `{,3}` reports ABSENT for a thing that is present.
    **DO** `{0,m}`.
25. **SAYS** awk `switch (NR*2+1) { case 3: … }`, `n = asort(arr)`, `IGNORECASE = 1`.
    **BREAKS** BSD awk 20200816: `switch` is a syntax error, `asort` is `calling undefined
    function`, and `IGNORECASE=1` is SILENTLY ignored (rc 0, case-sensitive match).
    **DO** if/else chains; `| sort`; `tolower($0) ~ /pattern/`. Portable awk subset, all
    verified: `-F:`, `$NF`, `$(NF-1)`, `-v var="$shell_var"`, `printf "%-10s"`, `gsub`,
    `tolower`, `length(arr)`.

## curl, python, chmod

26. **SAYS** `curl -sSL https://get.rvm.io | bash` (script install).
    **BREAKS** pipe-to-shell bypasses every supply-chain control the repo runs on itself
    (frozen lockfile, syft + grype, `supply-chain.yml`) and is irreversible; the worktree
    guard refuses the `curl … | sh` shape outright.
    **DO** `brew install <formula>`; otherwise download to a file, inspect and checksum it,
    then run it — with the owner's yes.
27. **SAYS** `curl -k` / `--insecure` "for self-signed certificates".
    **BREAKS** fail-closed: disabling verification makes a TLS probe report REACHABLE for an
    endpoint whose identity was never checked.
    **DO** `--cacert path/to/ca.pem` (or `--capath`); if the CA is unavailable, report the
    probe NOT VERIFIED, never passed.
28. **SAYS** `curl … | python -m json.tool` (pretty-print).
    **BREAKS** `python` is not on this Mac's PATH (only `/usr/bin/python3`): `command not
    found`, and with `-s` no visible error from curl either.
    **DO** `| jq .` (`/usr/bin/jq` is present) or `node -e`.
29. **SAYS** `chmod -R 755 my_directory`, `chmod -R 644 …`, `chmod 777`.
    **BREAKS** a recursive mode change on a repo tree flips git's tracked executable bit
    (100644 ↔ 100755) on every file → a dirty `git status --porcelain` → every sim result
    minted afterwards stamped `workingTreeClean: false`.
    **DO** `chmod +x path/to/one-script.sh`. For trees, `find dir -type d -exec chmod 755 {} +`
    and `find dir -type f -exec chmod 644 {} +` separately — and outside tracked source.

## Forms that survived — keep these

- Strict-mode skeleton, 3.2-safe: `set -euo pipefail; set -o errtrace; trap 'echo "ERROR:
  ${BASH_SOURCE[1]} at about ${BASH_LINENO[0]}" >&2' ERR`.
- Optional flag without an array: `${VAR:+--flag "$VAR"}` — `run-live-lanes.sh` already
  does `curl -s ${W…}` this way.
- HTTP readiness probe: `curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2
  --max-time 10 URL`. With `-sf`, exit codes separate failure kinds: 7 connection refused,
  22 HTTP ≥ 400, 28 timeout — a loop can tell "not up yet" from "up and broken".
- Who owns a listener: `lsof -nP -iTCP:PORT -sTCP:LISTEN` (`-n -P` skip the DNS and
  port-name lookups that otherwise stall).
- Portable grep set across BSD / ugrep / GNU: `-rl --include='*.sh'`, `-c`, `-o`, `-q`,
  `-w`, `-n -A/-B`, `\<word\>`, `\b`, `--only-matching`.
- Three grep/find flavours in three contexts: inside the Claude Code Bash tool `grep` and
  `find` are shell-snapshot FUNCTIONS (not the binaries a script gets); a script on the Mac
  gets BSD `/usr/bin/grep`; CI gets GNU. Test a gate's pattern with the binary the script
  will actually run: `/usr/bin/grep -E '…'`.
