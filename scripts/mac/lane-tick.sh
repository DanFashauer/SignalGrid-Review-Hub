#!/usr/bin/env bash
# =============================================================================
# SignalGrid — the Mac lane's automatic tick. Runs WITHOUT a person and WITHOUT a
# Claude session, from launchd (scripts/mac/install-launchd.sh); the interval is the
# installer's (default 5 min). A short interval picks up queued sim requests fast; to
# keep protected mail PRs paced, an unchanged outcome gets a two-hour keepalive.
# A changed outcome is submitted immediately. The work poll remains five minutes;
# canonical delivery is pending until the PR passes its checks and merges.
#
#   bash scripts/mac/lane-tick.sh            # one tick, prints what it did
#   bash scripts/mac/lane-tick.sh --dry-run  # say what would run, run nothing
#
# WHY THIS EXISTS (owner, 2026-09-05, second time: "this isn't working and causing
# delay"). Everything the cloud lane asked the Mac for waited on a HUMAN opening a
# Claude session on the Mac: six messages sat unread for hours, queued sim
# requests sat pending, and a Swift twin waited days. Two things fix that:
#
#   1. Anything CI's macOS runners can verify — an xcodebuild, `swift test`, a
#      Swift twin against pinned vectors, a shell-script fix — the CLOUD LANE now
#      does itself and ios-ci.yml proves. The Mac is no longer on that path.
#   2. What genuinely needs THIS machine — the sim-request loop (real hardware,
#      the local harness, the live lanes on the LAN), and the fact that the Mac
#      has SEEN the mail — runs from this tick, unattended.
#
# WHAT ONE TICK DOES, in order, each step reporting itself:
#   a. fetch --prune; never touch a DIRTY checkout or one parked on another branch
#      (a person's work is never pulled over) — since 2026-09-12 the tick then runs
#      from its OWN detached worktree (SIGNALGRID_TICK_WORKTREE, default a sibling
#      directory `<repo>.tick`) at origin/SignalGrid_Alpha, so a person's checkout
#      never stops the unattended work; before that it heartbeat "skipped" every 5
#      minutes for as long as the checkout stayed parked (an hour and a half on
#      2026-09-11/12, with a landing branch checked out);
#   b. on SignalGrid_Alpha (the only branch it drives): fast-forward, install
#      deps only if the lockfile moved (resume-lane.sh's stamp);
#   c. run every PENDING sim request (`pnpm run sim:run-requests`) — results land
#      in artifacts/sim-results/ with provenance;
#   d. commit + push any new results on a `mac/tick-<stamp>` branch (the cloud
#      steward opens the PR within the hour; if `gh` is on PATH the PR is opened
#      here) and return the checkout to SignalGrid_Alpha;
#   e. HEARTBEAT on a changed outcome or the keepalive through `lane:deliver` — so "the Mac
#      ran and had nothing to do" is distinguishable from "the Mac never ran",
#      and the cloud steward escalates to the owner when this stops arriving.
#
# WHAT IT NEVER DOES: read or ack lane MAIL on a person's behalf (only the
# addressee closes a message — a machine cannot say it understood), touch a
# non-Alpha branch, or run an operation the request allowlist does not name.
#
# Stock macOS bash 3.2: guarded array expansion only, no mapfile, no ${var,,}.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) echo "unknown flag: $arg (known: --dry-run)" >&2; exit 2 ;;
  esac
done

# launchd starts with a minimal PATH; the tools this repo needs live in the usual
# places. Appended, never prepended, so a person's PATH still wins when run by hand.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/current/bin:$HOME/Library/pnpm"
# The `evidence` sim-operation needs SIGNALGRID_MCP_PATH (scripts/lib/sim-operations.mjs,
# `needsEnv`). launchd's plist carries PATH and HOME only (install-launchd.sh), so derive it
# from the sibling checkout when that exists — never invent one: absent stays absent, and
# the objective loop then ESCALATES instead of queuing a request nobody can run (DR-056).
if [ -z "${SIGNALGRID_MCP_PATH:-}" ] && [ -f "$REPO_ROOT/../signalgrid-mcp/pyproject.toml" ]; then
  SIGNALGRID_MCP_PATH="$(cd "$REPO_ROOT/../signalgrid-mcp" && pwd)"
  export SIGNALGRID_MCP_PATH
fi
export PATH

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PREFIX="lane-tick $STAMP"
say() { printf '%s  %s\n' "$LOG_PREFIX" "$1"; }

# Resolve once before use_tick_worktree can change cwd. Missing state never means first run.
RECORD_DIR="$(node "$REPO_ROOT/scripts/lib/lane-attempt-store.mjs" path "$REPO_ROOT")" || exit 1

# ── one tick at a time ───────────────────────────────────────────────────────
# BEGIN OWNED TICK GUARD
# Linked checkouts share a persistent, identity-pinned descriptor lock. Only
# explicit store initialization creates it; opening read-only cannot recreate it.
# An unfinished ownership record or an old tick.lock stays held for exact readback.
# A PID, process absence or an available kernel lock never clears that evidence.
# CLOSED records authorized lease finalization, not an independent parent exit,
# accepted task, canonical delivery or provider-cleanup witness.
TICK_LOCK_ROOT="$REPO_ROOT"
TICK_LOCK_HELPER="$REPO_ROOT/scripts/lib/lane-attempt-store.mjs"
TICK_GUARD_PATH="$(node "$TICK_LOCK_HELPER" tick-guard "$TICK_LOCK_ROOT")" || exit 1
exec 8<"$TICK_GUARD_PATH" || { say "tick guard cannot be opened; READBACK ONLY"; exit 1; }
TICK_OWNER_TOKEN="$(node "$TICK_LOCK_HELPER" tick-acquire "$TICK_LOCK_ROOT" "$$")"
_tick_acquire_status=$?
if [ "$_tick_acquire_status" != "0" ]; then
  exec 8<&-
  if [ "$_tick_acquire_status" = "75" ]; then
    say "another tick owns the shared guard; no work started"
    exit 0
  fi
  say "tick ownership is held or incomplete; no work started; READBACK ONLY"
  exit 1
fi
TICK_INTERRUPTED=0
sg_tick_guard_cleanup() {
  local _tick_exit=$?
  trap - EXIT
  if declare -F sg_host_verify_release >/dev/null; then sg_host_verify_release; fi
  if [ "$TICK_INTERRUPTED" = "0" ] && [ "$_tick_exit" -lt 128 ]; then
    if ! node "$TICK_LOCK_HELPER" tick-release "$TICK_LOCK_ROOT" "$TICK_OWNER_TOKEN" "$$" "$_tick_exit"; then
      say "tick terminal ownership could not be committed; READBACK ONLY"
      [ "$_tick_exit" != "0" ] || _tick_exit=1
    fi
  else
    say "tick interrupted; original OPEN ownership remains held for readback"
  fi
  # Never unlink a shared guard or another owner's pathname.
  exec 8<&-
  exit "$_tick_exit"
}
trap 'TICK_INTERRUPTED=1; exit 129' HUP
trap 'TICK_INTERRUPTED=1; exit 130' INT
trap 'TICK_INTERRUPTED=1; exit 143' TERM
trap sg_tick_guard_cleanup EXIT
# END OWNED TICK GUARD

# An UNCHANGED tick heartbeats at most once per this many minutes, so a short launchd
# interval does not create a protected PR every run. The default leaves an hour
# for CI within the steward's three-hour tolerance. The attempt pointer and result
# record the last attempted submission, not a claim that canonical delivery happened.
#
# "Unchanged", not "quiet" (2026-09-12): the throttle used to exempt every skipped
# and failed result, so a checkout parked on a landing branch for an hour pushed
# "skipped: checkout on mac/land-…" to Alpha every 5 minutes — twelve pushes an hour,
# each starting four workflows, each cancelling the mainline CI run before it, and
# between them exhausting the repository's GITHUB_TOKEN budget until the CI liveness
# gate failed a product PR on a 403. A repeated result is not news; a CHANGED result
# is, and still delivers at once — including the first skip and the first failure.
QUIET_HEARTBEAT_MIN="${SIGNALGRID_QUIET_HEARTBEAT_MIN:-120}"
HB_LAST_RESULT="$RECORD_DIR/.sg-last-heartbeat-result"
HB_LAST_ATTEMPT="$RECORD_DIR/.sg-last-heartbeat-attempt"
ESTATE_RESULT="$RECORD_DIR/.sg-estate-result"

# Node is already required by the tick. Keep private cache writes and immutable
# attempt records on the same regular-file, no-follow, fsynced primitive.
tick_record() {
  node - "$@" <<'JS'
const fs = require("node:fs");
const [mode, a, b, c, d, e] = process.argv.slice(2);
function check(fd) {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.nlink !== 1) throw Error("owned regular record required");
}
function write(path, data, exclusive = false) {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | (exclusive ? fs.constants.O_EXCL : 0), 0o600);
  try {
    check(fd);
    fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
if (mode === "prepare") {
  write(a, JSON.stringify({attempt:b,result:c}) + "\n", true);
  write(d, b); write(e, c);
} else {
  const code = Number(b);
  if (!Number.isInteger(code) || code < 0 || code > 255) throw Error("invalid actual child exit");
  if (mode === "terminal") write(a, code + "\n", true);
  else if (mode === "estate") {
    if (code) write(a, `estate queue FAILED (exit ${code}); see private tick log\n`);
    else {
      try {
        const fd = fs.openSync(a, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { check(fd); } finally { fs.closeSync(fd); }
        fs.unlinkSync(a);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  } else throw Error("invalid private record mode");
}
JS
}

# The heartbeat is the tick's ONLY obligation on every path, including failure
# paths: a tick that died silently is exactly what this script exists to prevent.
RESULT="quiet"

# THE MAILBOX, FOLDED INTO THE HEALTH SIGNAL.
#
# This tick reported "quiet" on 2026-09-17 while FIVE cloud->mac messages sat
# unread, the oldest nearly four days. That was true about the tick and silent
# about the mailbox: it runs sim requests and heartbeats and does both correctly,
# but nothing in it reads the inbox, so "nothing happened" and "nobody looked"
# produced the same word.
#
# It deliberately does NOT acknowledge anything. An ack is supposed to say what was
# done, and a script has done nothing; a tick that acked its own inbox would be
# manufacturing exactly the false green this repo hunts. It only stops the state
# being invisible, which is the part a script can honestly do.
#
# The figure is COARSE (whole days) because an identical result is throttled: an age
# that ticks up continuously would differ every run and push a heartbeat commit to
# Alpha every five minutes, trading a silent mailbox for a flooded mainline.
# AND THE SAME DISTINCTION ONE LAYER DOWN, because the first draft of this function
# got it wrong in exactly the way the function exists to fix. It left RESULT
# untouched on a failed read — so an unreadable mailbox and an empty one both said
# "quiet", which is "nothing happened" and "nobody looked" wearing the same word
# again. An empty inbox is silence by design; a mailbox that could not be READ says
# so.
# This lane's own identity — the tick runs ON the Mac, so the inbox that matters is
# the one addressed to it. Overridable the same way lane-message.mjs allows, so this
# does not become a second, divergent notion of which lane you are.
LANE_SELF="${SIGNALGRID_LANE:-mac}"
append_unread_state() {
  _u="$(node scripts/check-lane-messages.mjs --unread-summary "$LANE_SELF" 2>/dev/null || true)"
  case "$_u" in
    unread=0) : ;;                                    # genuinely empty; silence is honest here
    unread=*) RESULT="$RESULT; $_u to $LANE_SELF" ;;  # e.g. "quiet; unread=5 oldest=3d to mac"
    *) RESULT="$RESULT; mailbox UNREADABLE" ;;        # never mistaken for an empty inbox
  esac
}

# Fold any OPEN raised hands (DR-054) into the heartbeat, so the unattended lane surfaces
# a blocker the same way it surfaces unread mail — never lost between sessions.
append_raised_hands_state() {
  _rh="$(node scripts/check-raised-hands.mjs --tick-summary 2>/dev/null || true)"
  case "$_rh" in
    "") : ;;                                   # none open, or monitor silent; loop:state catches a run failure
    raised-hands=*) RESULT="$RESULT; $_rh" ;;  # e.g. "quiet; raised-hands=2 gaps=1"
  esac
}

heartbeat() {
  append_unread_state
  append_raised_hands_state
  # Retain an estate failure until a later actual success. Successful PR counts
  # stay in the private log; their hourly churn is not a changed heartbeat outcome.
  if [ -e "$ESTATE_RESULT" ] || [ -L "$ESTATE_RESULT" ]; then
    if [ ! -L "$ESTATE_RESULT" ] && _estate_result="$(cat "$ESTATE_RESULT" 2>/dev/null)" && [ -n "$_estate_result" ]; then
      RESULT="$RESULT; last estate: $_estate_result"
    else
      RESULT="$RESULT; last estate: UNKNOWN (record unreadable)"
    fi
  fi
  if [ "$DRY" = "1" ]; then say "dry-run: would heartbeat: $RESULT"; return 0; fi

  _hb_hold() {
    say "RAISED HAND: $1; READBACK ONLY, no submission (see docs/LANE_COORDINATION.md, held deliveries)"
  }

  # A pending PR or a source-bound refused original push may need Cloud repair.
  # One DIFFERENT hand only; never resend/requeue/close the original heartbeat.
  _hb_pending_hand() {
    node - "$_hb_submission" "$1" "$RECORD_DIR" "$_hb_previous" "${TICK_LOCK_ROOT:-}" "${TICK_OWNER_TOKEN:-}" "$$" <<'JS'
  const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
  const { spawnSync } = require("node:child_process");
  const [originalPath, output, records, attempt, guardRoot, guardToken, shellPid] = process.argv.slice(2);
  const repo = process.cwd(); // same producing checkout as the original readback
  const sha = raw => crypto.createHash("sha256").update(raw).digest("hex");
  const own = st => st.isFile() && st.nlink === 1 && (typeof process.getuid !== "function" || st.uid === process.getuid());
  function read(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd);
      if (!own(before) || before.size > 1024 * 1024) throw Error("owned bounded record required");
      const raw = fs.readFileSync(fd), after = fs.fstatSync(fd);
      if (raw.length !== before.size || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key])) throw Error("record changed");
      return raw;
    } finally { fs.closeSync(fd); }
  }
  function write(file, value) {
    fs.writeFileSync(file, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600, flush: true });
  }
  function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
  (async () => {
    if (!/^[0-9]{8}T[0-9]{6}Z-[0-9]+$/.test(attempt) || Buffer.byteLength(output) > 32768) throw Error("pending input differs");
    const raw = read(originalPath), original = JSON.parse(raw.toString("utf8"));
    if (original.version !== 1 || !/^[a-f0-9]{40}$/.test(original.head ?? "") ||
        !/^lane\/mac-mail-\d{8}-\d{6}Z-[a-f0-9]{12}$/.test(original.target ?? "") ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(original.repository ?? "")) throw Error("original binding differs");
    const refusedPrefix = "refused delivery observation ", pendingPrefix = "pending delivery observation ";
    const refused = output.split("\n").some(line => line.startsWith(refusedPrefix));
    const prefix = refused ? refusedPrefix : pendingPrefix;
    const lines = output.split("\n").filter(line => line.startsWith(prefix));
    if (lines.length !== 1 || output.split("\n").some(line => line.startsWith(refused ? pendingPrefix : refusedPrefix))) throw Error("one original delivery observation required");
    const text = lines[0].slice(prefix.length), observed = JSON.parse(text);
    const keys = refused ? ["version", "kind", "repository", "target", "original_head", "base", "receipt_sha256", "push_result_sha256", "ref_readback_sha256", "remote_ref_state", "remote_oid", "producer_head", "producer_source_sha256", "original_push_exit", "publication_state", "no_replay", "repair_only"] :
      ["version", "repository", "target", "original_head", "receipt_sha256", "pr_number", "base", "pr_head", "created_at", "observed_at", "age_seconds", "merge_state", "check_state", "auto_merge_requested"];
    const literalKeys = [...text.matchAll(/(?:^|[,{])\s*"([A-Za-z_][A-Za-z_0-9]*)"\s*:/g)].map(match => match[1]);
    if (!observed || typeof observed !== "object" || Array.isArray(observed) ||
        Object.keys(observed).sort().join("\n") !== [...keys].sort().join("\n") ||
        literalKeys.length !== keys.length || new Set(literalKeys).size !== keys.length ||
        literalKeys.some(key => !keys.includes(key))) throw Error("pending scalar schema differs");
    let reason;
    if (refused) {
      function capture(prefix) {
        const terminalBytes = read(prefix + ".json"), rawBytes = read(prefix + ".raw.json");
        const p = JSON.parse(terminalBytes.toString("utf8")), b = JSON.parse(rawBytes.toString("utf8"));
        if (!Buffer.from(JSON.stringify(p) + "\n").equals(terminalBytes) || !Buffer.from(JSON.stringify(b) + "\n").equals(rawBytes) ||
            p.raw_capture_sha256 !== sha(rawBytes) || b.kind !== p.kind + "-raw" || p.utf8_valid !== true) throw Error("raw refusal capture differs");
        for (const key of ["version", "receipt_sha256", "repository", "base", "head", "target", "producer_head", "producer_source_sha256", "push_result_sha256", "command", "status", "signal", "error", "stdout_sha256", "stderr_sha256"]) {
          if (JSON.stringify(p[key]) !== JSON.stringify(b[key])) throw Error("raw refusal binding differs");
        }
        for (const name of ["stdout", "stderr"]) {
          if (typeof b[name + "_base64"] !== "string") throw Error("raw refusal bytes missing");
          const bytes = Buffer.from(b[name + "_base64"], "base64"), decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          if (bytes.toString("base64") !== b[name + "_base64"] || sha(bytes) !== p[name + "_sha256"] || !Buffer.from(decoded).equals(bytes) || decoded !== p[name]) throw Error("raw refusal bytes or UTF-8 differ");
        }
        return { value: p, sha256: sha(terminalBytes) };
      }
      const push = capture(originalPath + ".push"), ref = capture(originalPath + ".push-ref"), p = push.value, q = ref.value;
      if (observed.version !== 1 || observed.kind !== "original-push-refused" || observed.repository !== original.repository || observed.target !== original.target ||
          observed.original_head !== original.head || observed.base !== original.base || !/^[a-f0-9]{40}$/.test(original.base ?? "") || observed.receipt_sha256 !== sha(raw) ||
          observed.push_result_sha256 !== push.sha256 || observed.ref_readback_sha256 !== ref.sha256 ||
          observed.remote_ref_state !== "ABSENT" || observed.remote_oid !== null || observed.publication_state !== "KNOWN_REFUSED" ||
          observed.no_replay !== true || observed.repair_only !== true || p.version !== 1 || p.kind !== "original-lane-push-terminal" ||
          p.receipt_sha256 !== sha(raw) || ["repository", "base", "head", "target", "producer_head", "producer_source_sha256"].some(key => p[key] !== original[key]) ||
          !/^[a-f0-9]{40}$/.test(p.producer_head ?? "") || !/^[a-f0-9]{64}$/.test(p.producer_source_sha256 ?? "") ||
          observed.producer_head !== p.producer_head || observed.producer_source_sha256 !== p.producer_source_sha256 ||
          !Number.isInteger(p.status) || p.status <= 0 || p.status > 255 || p.signal !== null || p.error !== null || observed.original_push_exit !== p.status ||
          !/GH006|GH013|remote rejected|protected branch|permission .+ denied/i.test(p.stderr + p.stdout) ||
          JSON.stringify(p.command) !== JSON.stringify(["git", "push", "origin", "HEAD:refs/heads/" + original.target]) ||
          q.version !== 1 || q.kind !== "original-lane-push-ref-readback" || q.receipt_sha256 !== sha(raw) || q.push_result_sha256 !== push.sha256 ||
          ["repository", "head", "target", "producer_head", "producer_source_sha256"].some(key => q[key] !== p[key]) ||
          JSON.stringify(q.command) !== JSON.stringify(["git", "ls-remote", "origin", "refs/heads/" + original.target]) ||
          q.status !== 0 || q.signal !== null || q.error !== null || q.stdout !== "") throw Error("original refusal or exact ref absence remains UNKNOWN");
      const source = spawnSync("git", ["--no-replace-objects", "-c", "core.fsmonitor=false", "show", p.producer_head + ":scripts/lane-deliver.mjs"],
        { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
      if (source.status !== 0 || source.signal || source.error || !Buffer.isBuffer(source.stdout) || sha(source.stdout) !== p.producer_source_sha256) throw Error("original producing source differs");
      reason = "original Git push refused; exact original topic observed absent";
    } else {
    const created = typeof observed.created_at === "string" ? Date.parse(observed.created_at) : NaN;
    const at = typeof observed.observed_at === "string" ? Date.parse(observed.observed_at) : NaN;
    if (observed.version !== 1 || observed.repository !== original.repository || observed.target !== original.target ||
        observed.original_head !== original.head || observed.receipt_sha256 !== sha(raw) || observed.base !== "SignalGrid_Alpha" ||
        typeof observed.pr_head !== "string" || !/^[a-f0-9]{40}$/.test(observed.pr_head) || !Number.isInteger(observed.pr_number) || observed.pr_number <= 0 ||
        !Number.isFinite(created) || !Number.isFinite(at) || created > at || at > Date.now() || Date.now() - at > 300000 ||
        !Number.isInteger(observed.age_seconds) || observed.age_seconds < 0 || observed.age_seconds !== Math.floor((at - created) / 1000) ||
        !["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNSTABLE"].includes(observed.merge_state) ||
        !["failed", "pending", "success"].includes(observed.check_state) || observed.auto_merge_requested !== true) throw Error("pending metadata missing, stale or foreign");
    reason = observed.check_state === "failed" ? "terminal failed check" : observed.merge_state === "BEHIND" ? "behind canonical" : observed.age_seconds >= 3600 ? "pending at least one hour" : null;
    }
    if (!reason) { console.log("pending heartbeat metadata is current; no new notification needed"); process.exit(0); }
    const { checkTickOwner } = await import(require("node:url").pathToFileURL(path.join(repo, "scripts/lib/lane-attempt-store.mjs")).href);
    if (typeof checkTickOwner !== "function") throw Error("qualified read-only owner check unavailable");
    function activeOwner() {
      const owner = checkTickOwner(guardRoot, guardToken, shellPid), named = fs.lstatSync(records);
      if (owner.directory !== records || owner.token !== guardToken || owner.shellPid !== Number(shellPid) ||
          !named.isDirectory() || named.dev !== owner.store.dev || named.ino !== owner.store.ino ||
          (typeof process.getuid === "function" && named.uid !== process.getuid()) || (named.mode & 0o022)) throw Error("original notification store or owner changed");
      return owner;
    }
    const active = activeOwner(), store = active.store;
    function stillActive() {
      const current = activeOwner();
      if (current.openedSha256 !== active.openedSha256 || current.guard.dev !== active.guard.dev || current.guard.ino !== active.guard.ino ||
          current.store.dev !== active.store.dev || current.store.ino !== active.store.ino) throw Error("original active lease changed");
    }
    const id = "pending-heartbeat-" + sha(attempt), root = path.join(records, id);
    const files = { intent: root + ".attempt.json", ops: root + ".ops.json", output: root + ".output", terminal: root + ".terminal.json", receipt: root + ".submission.json" };
    // The cause identity excludes GET timing, transient output and ref snapshots.
    // Reusing the existing original-attempt ID also prevents another hand when a
    // later observation changes category. Failure/UNKNOWN never creates a new ID.
    const binding = refused ? { version: 1, kind: "refused-heartbeat-notification", attempt, receipt_sha256: sha(raw), repository: original.repository,
      target: original.target, original_head: original.head, producer_head: observed.producer_head, producer_source_sha256: observed.producer_source_sha256,
      push_result_sha256: observed.push_result_sha256, store: { dev: store.dev, ino: store.ino } } :
      { version: 1, kind: "pending-heartbeat-notification", attempt, receipt_sha256: sha(raw), repository: original.repository,
      target: original.target, original_head: original.head, pr_number: observed.pr_number, store: { dev: store.dev, ino: store.ino } };
    if (Object.values(files).some(exists)) {
      const prior = JSON.parse(read(files.intent).toString("utf8"));
      if (JSON.stringify(prior.binding) !== JSON.stringify(binding)) throw Error("notification intent binding differs");
      read(files.ops); read(files.output);
      const terminal = JSON.parse(read(files.terminal).toString("utf8"));
      if (!Number.isInteger(terminal.status) || terminal.status < 0 || terminal.status > 255 || terminal.signal !== null || terminal.error !== null) throw Error("notification parent terminal unknown");
      read(files.receipt);
      console.log("pending heartbeat notification was already attempted; READBACK ONLY, no new hand");
      process.exit(0);
    }
    const url = refused ? `https://github.com/${original.repository}/compare/SignalGrid_Alpha...${encodeURIComponent(original.target)}` : `https://github.com/${original.repository}/pull/${observed.pr_number}`;
    const op = { op: "raise", id, who: "cloud lane", domain: "lane", where: url,
      doing: "canonical delivery of a Mac heartbeat",
      blocked: refused ? `Original heartbeat ${reason}; source ${observed.producer_head}; original topic ${original.target} @ ${original.head}.` :
        `Protected heartbeat PR #${observed.pr_number} is ${reason}; original topic ${original.target} @ ${original.head}.`,
      need: "Cloud lane: inspect the current PR checks and source, then repair or land only through the existing protected review/CI route. This hand does not authorize resending, reposting or closing the original attempt." };
    stillActive();
    write(files.intent, { at: new Date().toISOString(), binding, state: "one distinct notification attempted; original heartbeat unchanged", receipt: files.receipt });
    write(files.ops, [op]);
    const fd = fs.openSync(files.output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    let result;
    try {
      if (!own(fs.fstatSync(fd))) throw Error("owned notification output required");
      stillActive();
      result = spawnSync(process.execPath, [path.join(repo, "scripts/lane-deliver.mjs"), "batch", files.ops, "--receipt", files.receipt],
        { cwd: repo, stdio: ["ignore", fd, fd] });
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    write(files.terminal, { at: new Date().toISOString(), status: result.status, signal: result.signal ?? null,
      error: result.error?.code ?? null, pid: result.pid ?? null, readback_only: true });
    if (result.status !== 0 || result.signal || result.error) throw Error("new notification remains unconfirmed");
    read(files.receipt);
    console.log(refused ? "refused original heartbeat: one distinct Cloud repair hand submitted; canonical merge unverified" : `pending heartbeat PR #${observed.pr_number}: one distinct Cloud hand submitted; canonical merge unverified`);
  })().catch(() => {
    console.log("RAISED HAND: pending heartbeat diagnostic or notification remains held; READBACK ONLY, no retry");
    process.exitCode = 1;
  });
JS
  }

  _hb_window="$QUIET_HEARTBEAT_MIN"
  _hb_submission=""
  # An independent parent-written terminal, not child output or a PID check,
  # closes an attempt. Unknown/interrupted mutations remain readback-only.
  if [ -e "$HB_LAST_ATTEMPT" ] || [ -L "$HB_LAST_ATTEMPT" ]; then
    _hb_previous="$(cat "$HB_LAST_ATTEMPT" 2>/dev/null)"
    if [ -L "$HB_LAST_ATTEMPT" ] || ! [[ "$_hb_previous" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]; then
      _hb_hold "unknown heartbeat receipt"; return 1
    fi
    _hb_previous_log="$RECORD_DIR/.sg-heartbeat-${_hb_previous}.log"
    _hb_previous_exit="$RECORD_DIR/.sg-heartbeat-${_hb_previous}.exit"
    if [ ! -f "$_hb_previous_log" ] || [ -L "$_hb_previous_log" ] || [ ! -f "$_hb_previous_exit" ] || [ -L "$_hb_previous_exit" ]; then
      _hb_hold "unfinished heartbeat receipt"; return 1
    fi
    _hb_previous_status="$(cat "$_hb_previous_exit" 2>/dev/null)"
    case "$_hb_previous_status" in
      0|1|2|3|4) ;;
      *) _hb_hold "invalid independent heartbeat terminal"; return 1 ;;
    esac
    # The immutable receipt is written BEFORE push. A refused push or later
    # cleanup can still exit 1/2; that receipt always binds the ORIGINAL attempt.
    _hb_submission="$RECORD_DIR/.sg-heartbeat-${_hb_previous}.submission.json"
    if [ -e "$_hb_submission" ] || [ -L "$_hb_submission" ]; then
      if [ ! -f "$_hb_submission" ] || [ -L "$_hb_submission" ]; then
        _hb_hold "original heartbeat submission binding is not a regular owned receipt"; return 1
      fi
    elif [ "$_hb_previous_status" = "1" ] || [ "$_hb_previous_status" = "2" ]; then
      _hb_submission=""
      _hb_window=10 # no publication binding: a DIFFERENT eligible observation
    else
      _hb_hold "unconfirmed/unfinished heartbeat lacks its exact submission binding"; return 1
    fi
  fi
  # A lost pointer alongside existing attempt evidence is damage, never a first run.
  if [ ! -e "$HB_LAST_ATTEMPT" ] && [ -n "$(find "$RECORD_DIR" -maxdepth 1 -name '.sg-heartbeat-*' -print -quit)" ]; then
    _hb_hold "heartbeat pointer missing beside original attempt evidence"; return 1
  fi
  # Throttle a result IDENTICAL to the last attempted one ("quiet" again, the same
  # "skipped: …" again, the same failure again) inside the window; anything that
  # differs from the previous attempt submits now. A tick that ACTED names
  # what it did, so its result differs and submits immediately. `find -mmin -N` and the
  # `cat` comparison are BSD/bash-3.2 safe; a missing result file compares unequal.
  LAST_RESULT=""
  [ -f "$HB_LAST_RESULT" ] && LAST_RESULT="$(cat "$HB_LAST_RESULT" 2>/dev/null)"
  if [ "$RESULT" = "$LAST_RESULT" ] && [ -f "$HB_LAST_ATTEMPT" ] && [ -n "$(find "$HB_LAST_ATTEMPT" -mmin -"$_hb_window" 2>/dev/null)" ]; then
    say "unchanged ($RESULT), last submission attempt <${_hb_window}m ago — no new mail PR; original submission not rechecked"
    return 0
  fi
  # A due/changed observation checks the original submission before any new one.
  # Unchanged ticks do not fetch and write duplicate observations every five minutes.
  if [ -n "$_hb_submission" ]; then
    if _hb_readback="$(node scripts/lane-deliver.mjs readback "$_hb_submission" 2>&1)"; then
      say "$_hb_readback"
    else
      _hb_readback_exit=$?
      if [ "$_hb_readback_exit" = "4" ] || [ "$_hb_readback_exit" = "5" ]; then
        say "$_hb_readback"
        _hb_pending_hand "$_hb_readback" || _hb_hold "pending heartbeat has no new qualified notification"
        return 0
      fi
      _hb_hold "original heartbeat canonical readback is unavailable"; return 1
    fi
  fi
  # --no-wake: the tick heartbeat is a STALENESS record, read from the heartbeat
  # FILE by the cloud steward's hourly cycle — it never carries cloud-addressed
  # mail (append_unread_state reports THIS lane's inbox, mac's), so it must not
  # post the mailbox-PR comment that wakes the cloud lane. Real cloud mail travels
  # on a separate `lane-deliver send` (no --no-wake), which still wakes at once;
  # mail topics pass their required checks before merging. This ends the
  # every-tick quiet wake that flooded the cloud session (owner decision 2026-09-23).
  # Sync the intent before calling a mutating child, and its independent terminal
  # afterwards. Existing receipts remain immutable; no automatic unknown override.

  _hb_attempt="${STAMP}-$$"
  _hb_log="$RECORD_DIR/.sg-heartbeat-${_hb_attempt}.log"
  if ! tick_record prepare "$_hb_log" "$_hb_attempt" "$RESULT" "$HB_LAST_ATTEMPT" "$HB_LAST_RESULT"; then
    say "WARN could not preserve heartbeat intent; no submission"; return 1
  fi
  if node scripts/lane-deliver.mjs heartbeat mac-lane-tick "$RESULT" --no-wake --receipt "$RECORD_DIR/.sg-heartbeat-${_hb_attempt}.submission.json" >>"$_hb_log" 2>&1; then
    _hb_exit=0
  else
    _hb_exit=$?
  fi
  if ! tick_record terminal "$RECORD_DIR/.sg-heartbeat-${_hb_attempt}.exit" "$_hb_exit"; then
    say "WARN heartbeat terminal not recorded; READBACK ONLY: $_hb_log"; return 1
  fi
  if [ "$_hb_exit" = "0" ]; then
    say "heartbeat submitted for protected PR merge: $RESULT"
  else
    say "WARN heartbeat submission not confirmed (exit $_hb_exit); receipt $_hb_log: $RESULT"
  fi
}

# ── the tick's own worktree, for when a person holds the main checkout ────────
# DETACHED at origin/SignalGrid_Alpha on purpose: a worktree that held the branch
# would make `git checkout SignalGrid_Alpha` in the main checkout refuse ("already
# checked out at …"), which is the person's next move after parking. Nothing here
# is pushed from a branch except the mac/tick-<stamp> result branches (step d).
TICK_WT="${SIGNALGRID_TICK_WORKTREE:-$REPO_ROOT/../$(basename "$REPO_ROOT").tick}"
IN_TICK_WT=0
use_tick_worktree() {
  why="$1"
  if [ ! -e "$TICK_WT/.git" ]; then
    if ! git worktree add -q --detach "$TICK_WT" origin/SignalGrid_Alpha >/dev/null 2>&1; then
      RESULT="skipped: $why; and the tick worktree could not be created at $TICK_WT"
      say "$RESULT"
      heartbeat
      exit 0
    fi
    say "created the tick worktree at $TICK_WT (detached at origin/SignalGrid_Alpha)"
  fi
  if ! cd "$TICK_WT"; then
    RESULT="skipped: $why; and the tick worktree at $TICK_WT cannot be entered"
    say "$RESULT"
    heartbeat
    exit 0
  fi
  if [ -n "$(git status --porcelain)" ]; then
    RESULT="skipped: $why; and the tick worktree at $TICK_WT is dirty too (a person's work; not touching it)"
    say "$RESULT"
    heartbeat
    exit 0
  fi
  IN_TICK_WT=1
  say "$why — ticking from the tick worktree at $TICK_WT instead"
}

# ── a. sync, never over a person's work ──────────────────────────────────────
if ! git fetch origin --prune >/dev/null 2>&1; then
  RESULT="skipped: origin unreachable (offline?)"
  say "$RESULT"
  heartbeat
  exit 0
fi
if [ -n "$(git status --porcelain)" ]; then
  use_tick_worktree "checkout dirty (a person's uncommitted work; not touching it)"
else
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$BRANCH" != "SignalGrid_Alpha" ]; then
    use_tick_worktree "checkout on $BRANCH, not SignalGrid_Alpha (a person is mid-work; leaving it)"
  fi
fi

# ── b. fast-forward + deps only when the lockfile moved ──────────────────────
if ! git merge-base --is-ancestor origin/SignalGrid_Alpha HEAD 2>/dev/null; then
  if [ "$IN_TICK_WT" = "1" ]; then
    # Detached: move to origin's tip directly (no branch to fast-forward).
    if git checkout -q --detach origin/SignalGrid_Alpha; then
      say "tick worktree moved to origin/SignalGrid_Alpha $(git rev-parse --short HEAD)"
    else
      RESULT="failed: the tick worktree could not move to origin/SignalGrid_Alpha"
      say "$RESULT"
      heartbeat
      exit 1
    fi
  elif git pull -q --ff-only origin SignalGrid_Alpha; then
    say "fast-forwarded SignalGrid_Alpha to $(git rev-parse --short HEAD)"
  else
    RESULT="skipped: SignalGrid_Alpha diverged from origin; resolve by hand (docs/LANE_COORDINATION.md)"
    say "$RESULT"
    heartbeat
    exit 0
  fi
fi
if ! command -v pnpm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  RESULT="skipped: pnpm/node not on PATH for launchd (edit PATH at the top of scripts/mac/lane-tick.sh)"
  say "$RESULT"
  # This arm was the ONE early exit with no heartbeat, and it is the arm most
  # likely to fire under launchd (a minimal PATH is launchd's default). The cloud
  # steward escalates on a MISSING heartbeat, so a tick that dies here looked
  # exactly like a Mac that never ran — the loudest possible failure reported as
  # silence. `heartbeat` itself shells to node and will WARN if it cannot; that is
  # still more than nothing, and it costs one line.
  heartbeat
  exit 0
fi
# Keep the tick alive and honest while another chain owns this host's heavyweight lane.
defer_host_verification() {
  RESULT="deferred: $SG_VERIFY_LOCK_REASON; sim requests and objective evaluation not run"
  say "$RESULT"
  heartbeat
}
if [ "$DRY" = "0" ]; then
  _verify_cache="$HOME/Library/Caches/signalgrid"
  mkdir -p "$_verify_cache" || { SG_VERIFY_LOCK_REASON="host verification cache unavailable"; defer_host_verification; exit 1; }
  _verify_helper="$(mktemp "$_verify_cache/host-verification.XXXXXX")" || { SG_VERIFY_LOCK_REASON="host verification reader unavailable"; defer_host_verification; exit 1; }
  _verify_sha="$(git rev-parse origin/SignalGrid_Alpha)"
  if ! git show "$_verify_sha:scripts/mac/host-verification-lock.sh" > "$_verify_helper"; then
    rm -f "$_verify_helper"; SG_VERIFY_LOCK_REASON="mainline host verification helper unavailable"; defer_host_verification; exit 1
  fi
  # shellcheck source=/dev/null
  . "$_verify_helper" || { rm -f "$_verify_helper"; SG_VERIFY_LOCK_REASON="mainline host verification helper could not load"; defer_host_verification; exit 1; }
  rm -f "$_verify_helper"
  if ! sg_host_verify_acquire "$HOME/Library/Caches/signalgrid/host-verification.lock"; then
    defer_host_verification
    exit 0
  fi
fi
LOCK_SHA="$(shasum -a 256 pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)"
INSTALL_STAMP="node_modules/.sg-installed-lock-sha"
if [ -z "$LOCK_SHA" ] || [ ! -f "$INSTALL_STAMP" ] || [ "$(cat "$INSTALL_STAMP" 2>/dev/null)" != "$LOCK_SHA" ]; then
  if [ "$DRY" = "1" ]; then
    say "dry-run: would pnpm install --frozen-lockfile"
  elif pnpm install --frozen-lockfile >/dev/null 2>&1; then
    printf '%s' "$LOCK_SHA" > "$INSTALL_STAMP"
    say "pnpm install --frozen-lockfile (lockfile moved)"
  else
    RESULT="failed: pnpm install --frozen-lockfile (see ~/Library/Logs/signalgrid-lane-tick.log)"
    say "$RESULT"
    heartbeat
    exit 1
  fi
fi

# ── c. run what the cloud asked for ──────────────────────────────────────────
# `--plan` prints one `  PENDING <id> …` line per request it would run, then a
# `--plan: N request(s) PENDING …` summary. Until 2026-09-06 it printed NEITHER —
# the word PENDING lived only in that file's `//` comments — so this grep matched
# nothing on every tick since the tick was written, the count was always 0, and
# step (c), the only reason this script runs unattended, never once fired.
#
# The old line also swallowed a broken planner: `2>/dev/null | grep -c … || true`
# turns a crash into "0", which reads as "nothing to do". A plan this tick cannot
# READ is now a failure, never an empty queue — the summary line must be present.
PLAN_OUT="$(node scripts/mac/run-requests.mjs --plan 2>/dev/null)"
PLAN_STATUS=$?
if [ "$PLAN_STATUS" != "0" ] || ! printf '%s\n' "$PLAN_OUT" | grep -q '^--plan: [0-9][0-9]* request'; then
  RESULT="failed: could not read the sim-request plan (run-requests.mjs --plan exited $PLAN_STATUS with no roster) — pending work was NOT counted, and is NOT known to be zero"
  say "$RESULT"
  heartbeat
  exit 1
fi
PENDING="$(printf '%s\n' "$PLAN_OUT" | grep -c '^  PENDING')"
PENDING="${PENDING:-0}"
if [ "$PENDING" = "0" ]; then
  say "no pending sim requests"
else
  say "$PENDING pending sim request(s)"
  if [ "$DRY" = "1" ]; then
    say "dry-run: would pnpm run sim:run-requests"
  else
    # A per-operation FAILURE writes a result with its status recorded — but a runner
    # CRASH (a malformed request, a write error) writes NOTHING. Those two exit-1 cases
    # were indistinguishable while stderr was thrown away, and the else-branch claimed
    # "recorded in the results" even on the crash. Keep stderr (drop the inner 2>&1) so
    # the trace reaches the launchd log, and let step d's `git status` on the results dir
    # be the honest test of whether any result actually landed. (DR-054.)
    if pnpm run sim:run-requests >/dev/null; then
      say "sim requests ran"
    else
      say "sim requests exited non-zero — see stderr in the log; whether any result landed is decided in step d"
    fi
  fi
fi

# ── c'. evaluate + replan (DR-056) — AFTER step c, never before ──────────────
# run-requests.mjs samples provenance.workingTreeClean from `git status --porcelain`
# (untracked included) at ITS launch; a state file written before step c would stamp
# every result in this tick dirty. The loop rewrites docs/agent/objective-state.json only
# when the DECISION changed, queues at most one request the tick can actually run, and
# mails the cloud once per NEW escalation id. A loop that cannot run is named in the
# heartbeat, never swallowed (DR-054).
LOOP_VERDICT="not run"
if [ "$DRY" = "1" ]; then
  say "dry-run: would node scripts/objective-loop.mjs --write --deliver"
  LOOP_VERDICT="dry-run"
else
  LOOP_OUT="$(node scripts/objective-loop.mjs --write --deliver 2>&1)"
  LOOP_STATUS=$?
  # Select the summary by its PREFIX, never by position: a node warning on stderr would
  # otherwise become the verdict in the commit message and the heartbeat.
  LOOP_LINE="$(printf '%s\n' "$LOOP_OUT" | grep -m1 '^objective-loop: ' || true)"
  say "${LOOP_LINE:-objective-loop printed no summary line}"
  if [ "$LOOP_STATUS" = "0" ]; then
    printf '%s\n' "$LOOP_OUT" | grep -E '^(RAISED HAND:|WARN )' | while IFS= read -r _l; do say "  $_l"; done
  fi
  if [ "$LOOP_STATUS" = "0" ] && [ -n "$LOOP_LINE" ]; then
    LOOP_VERDICT="${LOOP_LINE#objective-loop: }"
    LOOP_VERDICT="${LOOP_VERDICT%% —*}"
  elif [ "$LOOP_STATUS" = "0" ]; then
    LOOP_VERDICT="BROKEN (no summary line)"
  else
    LOOP_VERDICT="BROKEN (objective-loop exit $LOOP_STATUS)"
    printf '%s\n' "$LOOP_OUT" | tail -n +2 | while IFS= read -r _l; do say "  $_l"; done
  fi
fi

# ── d. deliver results on a mac/tick-* branch ────────────────────────────────
if [ -n "$(git status --porcelain -- artifacts/sim-results artifacts/live-evidence docs/agent/objective-state.json artifacts/sim-requests 2>/dev/null)" ]; then
  TICK_BRANCH="mac/tick-$STAMP"
  if [ "$DRY" = "1" ]; then
    say "dry-run: would commit results to $TICK_BRANCH and push"
  else
    # RESULT used to be assigned AFTER this chain unconditionally, so a checkout,
    # commit or push that failed still heartbeat "results on mac/tick-<stamp>" — the
    # cloud lane was told work had been delivered to a branch that does not exist on
    # origin. The claim now lives INSIDE the success arm, and the failure arm says
    # what actually happened.
    # A new result file moves the tracked-file count, and the derived coverage
    # page is gated against it (check-surface-review-coverage): the first tick PR
    # (#844, 2026-09-18) went red on exactly that and needed a cloud commit to
    # land. Re-derive the page here so the result lands on its own.
    #
    # ORDER MATTERS: the page counts TRACKED files (git ls-files). Deriving it before
    # `git add` counted nothing new, so a tick that queued its first sim request (#1052,
    # 2026-09-25) committed a page derived without the request file and went red on the
    # very gate this block exists to satisfy. Stage the new files first, derive second,
    # then stage the page.
    if git checkout -q -b "$TICK_BRANCH" \
      && git add artifacts/sim-results artifacts/live-evidence docs/agent/objective-state.json artifacts/sim-requests 2>/dev/null \
      && { node scripts/check-surface-review-coverage.mjs --write >/dev/null 2>&1 \
           || say "WARN could not re-derive docs/agent/SURFACE_REVIEW_COVERAGE.md — the PR will fail the coverage gate until it is"; } \
      && git add docs/agent/SURFACE_REVIEW_COVERAGE.md 2>/dev/null \
      && git commit -q -m "Mac tick $STAMP: sim results ($PENDING request(s)); objective loop: $LOOP_VERDICT" \
      && git push -q -u origin "$TICK_BRANCH"; then
      say "pushed $TICK_BRANCH (the cloud steward opens its PR within the hour)"
      RESULT="acted: ran $PENDING sim request(s); results on $TICK_BRANCH"
      if command -v gh >/dev/null 2>&1; then
        gh pr create --base SignalGrid_Alpha --head "$TICK_BRANCH" --fill >/dev/null 2>&1 && say "opened the PR for $TICK_BRANCH"
      fi
    else
      RESULT="failed: ran $PENDING sim request(s) and produced results, but the $TICK_BRANCH commit/push chain broke — the cloud lane CANNOT see them; they are still in this checkout"
      say "$RESULT"
      # The loop's own writes are put back so the next tick does not find a dirty
      # worktree and skip forever (a latched-off executor is the silent stall DR-054
      # forbids). Sim RESULTS are deliberately left: they are evidence, not derivable.
      # Reset the INDEX first: `git checkout -- <path>` restores from the index, and `git clean`
      # skips a path the index holds, so after a failed `git commit` both would be no-ops.
      git reset -q -- docs/agent/objective-state.json artifacts/sim-requests >/dev/null 2>&1 || true
      if git ls-files --error-unmatch docs/agent/objective-state.json >/dev/null 2>&1; then
        git checkout -q -- docs/agent/objective-state.json 2>/dev/null || true
      else
        rm -f docs/agent/objective-state.json
      fi
      git clean -fq -- "artifacts/sim-requests/objective-loop-*.json" >/dev/null 2>&1 || true
      # ...and re-derive the decision next tick. Independent per-escalation attempt
      # records remain intact: forgetting this stamp never permits re-submission.
      rm -f node_modules/.sg-objective-loop-last.json
    fi
    if [ "$IN_TICK_WT" = "1" ]; then
      git checkout -q --detach origin/SignalGrid_Alpha || say "WARN could not return the tick worktree to origin/SignalGrid_Alpha"
    else
      git checkout -q SignalGrid_Alpha || say "WARN could not return the checkout to SignalGrid_Alpha"
    fi
  fi
elif [ "$PENDING" != "0" ] && [ "$DRY" = "0" ]; then
  RESULT="acted: ran $PENDING sim request(s); no new result files (see the run log)"
fi

# Unread mail reaches RESULT through append_unread_state (check-lane-messages.mjs
# --unread-summary), called by heartbeat below. A block here once grepped
# `lane-message.mjs inbox` for '→ mac', an arrow that CLI never prints, so it could
# not fire; scripts/check-sim-scripts-selfcheck.mjs rule (g) keeps it from returning.

RESULT="$RESULT; objective: $LOOP_VERDICT"

# ── d2. the estate queue, at most hourly ─────────────────────────────────────
# The owner gave the Mac brain the estate (2026-10-23; #1546, 2026-10-29). The queue
# is scripts/mac/estate-queue.mjs: it closes a PR whose head is already on mainline
# and merges mainline into a PR that is behind without conflict, at most ESTATE_MAX
# per run, and only reports everything else (it never merges a PR). Hourly, so a
# 5-minute tick does not re-run CI on the same PRs every few minutes; the stamp lives
# in the shared private store, like the heartbeat's.
ESTATE_STAMP="$RECORD_DIR/.sg-estate-last"
ESTATE_MAX="${SIGNALGRID_ESTATE_MAX:-3}"
if [ -f scripts/mac/estate-queue.mjs ] && command -v gh >/dev/null 2>&1; then
  if [ -z "$(find "$ESTATE_STAMP" -mmin -60 2>/dev/null)" ]; then
    if [ "$DRY" = "1" ]; then
      _est="$(node scripts/mac/estate-queue.mjs plan 2>&1 | tail -1)"
      say "dry-run: would execute the estate queue (max $ESTATE_MAX); plan: $_est"
    else
      _est="$(node scripts/mac/estate-queue.mjs execute --max "$ESTATE_MAX" --cursor-file "$RECORD_DIR/.sg-estate-cursor" 2>&1)"
      _est_rc=$?
      printf '%s\n' "$_est" | while IFS= read -r _l; do say "  $_l"; done
      # Without the stamp the hourly throttle is gone and the queue runs every tick.
      touch "$ESTATE_STAMP" 2>/dev/null || say "WARN could not write $ESTATE_STAMP; the estate queue will re-run next tick"
      if ! tick_record estate "$ESTATE_RESULT" "$_est_rc"; then RESULT="$RESULT; estate outcome could not be retained"; fi
    fi
  fi
else
  say "estate queue not run: scripts/mac/estate-queue.mjs or gh missing"
fi

# ── e. heartbeat, always ─────────────────────────────────────────────────────
heartbeat
exit 0
