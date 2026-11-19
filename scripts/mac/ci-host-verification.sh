#!/usr/bin/env bash
# One self-hosted CI shell owns the persistent host lock through work and teardown.
# The workflow pins the trusted helper commit; stdin is the complete verification chain.
# Local ticks retain their nonblocking policy. Never unlink the shared lock file.
set -u
if [ "$#" != 3 ] || ! printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}$'; then
  echo 'ci-host-verification: expected helper SHA, admission seconds and work seconds' >&2
  exit 2
fi
HELPER_SHA="$1" WAIT_SECONDS="$2" WORK_SECONDS="$3"
case "$WAIT_SECONDS" in ""|*[!0-9]*) echo 'ci-host-verification: invalid admission budget' >&2; exit 2;; esac
case "$WORK_SECONDS" in ""|*[!0-9]*) echo 'ci-host-verification: invalid work budget' >&2; exit 2;; esac
if [ "${#WAIT_SECONDS}" -gt 5 ] || [ "${#WORK_SECONDS}" -gt 4 ]; then echo 'ci-host-verification: oversized budgets' >&2; exit 2; fi
if [ "$WAIT_SECONDS" -lt 1 ] || [ "$WAIT_SECONDS" -gt 39600 ] || [ "$WORK_SECONDS" -lt 1 ] || [ "$WORK_SECONDS" -gt 5400 ]; then
  echo 'ci-host-verification: budgets outside the declared bounds' >&2; exit 2
fi
SCRATCH="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sg-ci-host.XXXXXX")" || exit 2
WORK_PID="" WORK_STARTED=0
cleanup() {
  _ci_status=$?
  trap - EXIT INT TERM HUP
  if [ -n "$WORK_PID" ]; then
    kill -TERM "$WORK_PID" 2>/dev/null || true
    wait "$WORK_PID" 2>/dev/null || true
    WORK_PID=""
  fi
  if [ "$WORK_STARTED" = 1 ]; then
    # This final command is bounded too and still owns the same FD 9.
    (ci_capped 60 /bin/bash scripts/mac/free-test-port.sh)
    _ci_cleanup=$?
    if [ "$_ci_cleanup" != 0 ]; then
      echo "ci-host-verification: teardown failed ($_ci_cleanup)" >&2
      [ "$_ci_status" != 0 ] || _ci_status="$_ci_cleanup"
    fi
  fi
  if declare -F sg_host_verify_release >/dev/null; then sg_host_verify_release; fi
  rm -rf "$SCRATCH"
  exit "$_ci_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Read before backgrounding: an async shell otherwise receives /dev/null as stdin.
cat > "$SCRATCH/chain.sh" || exit 2
if ! env -i PATH="$PATH" HOME="$HOME" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git --no-replace-objects -c core.hooksPath=/dev/null show "$HELPER_SHA:scripts/mac/host-verification-lock.sh" > "$SCRATCH/lock.sh"; then
  echo 'ci-host-verification: pinned host lock helper unavailable' >&2; exit 2
fi
# shellcheck source=/dev/null
. "$SCRATCH/lock.sh" || exit 2

# Custody of the host reservation (FD 9), phase by phase:
#   readiness  bounded. Until the child reports its own session, no GROUP is ever signalled:
#              only the one child pid is killed, and an unreaped child is handed to the custodian.
#   work       bounded by the caller's seconds (124) or ended by a signal.
#   reap       bounded. An unreaped leader still shows in the inspection below.
#   verify     bounded. The owned group is KILLed again only when inspection POSITIVELY shows
#              live members; a failed or slow inspection is uncertainty, never an empty group.
#   custody    if the group is still live or unknown after the window, a detached custodian
#              inherits this same FD 9 (same open file, same lock inode) and holds it until
#              inspection positively reports the group empty. The supervisor then returns, so
#              the step ends and its logs upload, while no other host chain can be admitted.
#              If the custodian cannot be started, the supervisor keeps the reservation itself.
ci_capped() {
  exec perl -MPOSIX=setsid,WNOHANG,strftime -MTime::HiRes=time,sleep -e '
    my $seconds = shift @ARGV;
    my $verify_seconds = 30;
    my ($t0, $what) = (time(), $ARGV[-1]); $what =~ s{.*/}{};
    my $mark = sub { printf STDERR "ci-host-verification: %s +%ds %s: %s\n", strftime("%Y-%m-%dT%H:%M:%SZ", gmtime), time() - $t0, $what, $_[0] };
    my $signal = 0;
    $SIG{INT} = sub { $signal = 130 };
    $SIG{TERM} = sub { $signal = 143 };
    $SIG{HUP} = sub { $signal = 129 };
    # Hold FD 9 in a detached process until $gone->() is positively true; returns its pid or 0.
    my $custody = sub {
      my ($gone, $again) = @_;
      my $keeper = fork(); return 0 unless defined $keeper;
      return $keeper if $keeper;
      $SIG{INT} = $SIG{TERM} = $SIG{HUP} = "IGNORE";
      setsid();
      open(STDIN, "<", "/dev/null"); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null");
      while (1) { my $state = $gone->(); exit 0 if defined($state) && $state; $again->() if defined($state); sleep 0.5 }
    };
    pipe(my $ready, my $notify) or die "readiness pipe: $!";
    my $pid = fork(); defined($pid) or die "fork: $!";
    if (!$pid) {
      close $ready;
      POSIX::close(9); # Only the guardian/supervisor owns the reservation.
      $SIG{INT} = $SIG{TERM} = $SIG{HUP} = "DEFAULT";
      my $sid = setsid(); defined($sid) && $sid >= 0 && getpgrp() == $$ or die "setsid: $!";
      print {$notify} "ready\n"; close $notify;
      exec { $ARGV[0] } @ARGV; exit 127;
    }
    close $notify;
    my $started; { my $bits = ""; vec($bits, fileno($ready), 1) = 1; $started = <$ready> if select($bits, undef, undef, 10) > 0 } close $ready;
    if (!defined($started) || $started ne "ready\n") {
      # No session handshake: this is one pid in OUR group, so never a group signal.
      $mark->("readiness not established; ending the one child");
      kill "KILL", $pid;
      my $until = time() + 5; my $done = 0;
      while (time() < $until) { if (waitpid($pid, WNOHANG) == $pid) { $done = 1; last } sleep 0.05 }
      if (!$done) {
        print STDERR "ci-host-verification: cleanup unconfirmed; retaining host reservation\n";
        my $keeper = $custody->(sub { kill(0, $pid) ? 0 : 1 }, sub { kill "KILL", $pid });
        waitpid($pid, 0) unless $keeper;
        $mark->("reservation retained by custodian pid $keeper") if $keeper;
      }
      exit 125;
    }
    $mark->("started, bound ${seconds}s");
    my $deadline = time() + $seconds;
    my ($code, $reaped) = (0, 0);
    while (1) {
      my $done = waitpid($pid, WNOHANG);
      if ($done == $pid) { $code = ($? & 127) ? 128 + ($? & 127) : $? >> 8; $reaped = 1; last }
      if ($signal) { $code = $signal; last }
      if (time() >= $deadline) { print STDERR "ci-host-verification: work/cleanup deadline exceeded\n"; $code = 124; last }
      sleep 0.05;
    }
    $mark->("ended with $code; ending the owned group");
    # Parent exit is not group exit: reap redirected descendants on every outcome.
    # 1 = live members, 0 = positively none, undef = the inspection failed or stalled.
    my $live = sub {
      my $ps_pid = open(my $ps, "-|", "/bin/ps", "-axo", "pid=,pgid=,state=") or return undef;
      my $found = 0;
      my $read = eval {
        local $SIG{ALRM} = sub { die "slow\n" }; alarm 10;
        while (<$ps>) { $found = 1 if /^\s*(\d+)\s+(\d+)\s+(\S+)/ && $2 == $pid && $3 !~ /^Z/ }
        alarm 0; 1;
      };
      alarm 0;
      kill "KILL", $ps_pid unless $read;
      close($ps) or return undef;
      return $read ? $found : undef;
    };
    kill "TERM", -$pid;
    my $grace = time() + 1;
    while (time() < $grace) { my $active = $live->(); last if defined($active) && !$active; sleep 0.05 }
    kill "KILL", -$pid;
    my $reap_until = time() + 5;
    while (!$reaped && time() < $reap_until) { if (waitpid($pid, WNOHANG) == $pid) { $reaped = 1 } else { sleep 0.05 } }
    my $verify_until = time() + $verify_seconds;
    my $confirmed = 0;
    while (1) {
      my $active = $live->();
      if (defined($active) && !$active) { $confirmed = 1; last }
      last if time() >= $verify_until;
      kill "KILL", -$pid if $active; sleep 0.2;
    }
    if ($confirmed) { $mark->("cleanup confirmed: owned group empty"); exit $code }
    print STDERR "ci-host-verification: cleanup unconfirmed; retaining host reservation\n";
    my $keeper = $custody->(sub { my $active = $live->(); defined($active) ? !$active : undef }, sub { kill "KILL", -$pid });
    if (!$keeper) {
      # No custodian: keep the reservation here, as before. The outer job remains bounded.
      while (1) { my $active = $live->(); last if defined($active) && !$active; kill "KILL", -$pid if $active; sleep 0.2 }
      exit $code;
    }
    $mark->("reservation retained by custodian pid $keeper until the owned group is confirmed empty");
    exit($code || 70);
  ' "$@"
}

# The local second brain polls this same lock every 2 s non-blocking and never wins
# against a 1 s retry loop that then holds the host for a whole job: measured
# 2026-11-01, zero brain admissions in a day with 32 dispatch items queued. So once
# CI has SEEN the lock free (acquired it), and the brain reports queued work blocked
# on the host, CI releases it and sleeps past one brain poll. Budget is wall time from
# the first such yield, so waiting behind another chain never spends it, and a brain
# that is not starved costs one probe per admission, not one per retry.
# Fail-closed toward CI: no brain, no node, HTTP error, bad JSON — no yield.
SG_CI_BRAIN_URL="${SG_CI_BRAIN_URL:-http://127.0.0.1:8765/api/brain}"
SG_CI_BRAIN_YIELD_SECONDS="${SG_CI_BRAIN_YIELD_SECONDS:-30}"
case "$SG_CI_BRAIN_YIELD_SECONDS" in ""|*[!0-9]*) SG_CI_BRAIN_YIELD_SECONDS=30;; esac
if [ "${#SG_CI_BRAIN_YIELD_SECONDS}" -gt 3 ] || [ "$SG_CI_BRAIN_YIELD_SECONDS" -gt 120 ]; then SG_CI_BRAIN_YIELD_SECONDS=120; fi
# The brain's status runs to ~1 MB and can carry raw control characters inside job
# text (seen 2026-11-02), which strict JSON.parse rejects; between tokens they are
# whitespace, so they are blanked first. SG_BRAIN_PROBE keeps the answer's reason so
# an admission without a yield says why (it was silent, so production could not show it).
sg_brain_wants_host() {
  SG_BRAIN_PROBE=$(curl -q -s -f --noproxy '*' --max-filesize 8000000 -m 3 "$SG_CI_BRAIN_URL" 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  if (!s) { console.log("no reply"); process.exit(1); }
  let b; try { b = JSON.parse(s.replace(/[\u0000-\u001f]/g, " ")); } catch { console.log("unparseable reply"); process.exit(1); }
  const c = (b && b.coordinator) || {}; const queued = c.counts && c.counts.queued;
  const reason = String(c.blocked_reason || "none");
  const starved = Number.isInteger(queued) && queued > 0 && /^Host resources are reserved/.test(reason);
  // The brain pauses about two seconds after a blocked or failed job and queues the follow-up
  // attempt right after it, with nothing counted as queued in between. An admission landing in
  // that pause used to win the host for a whole run (2026-11-13: a follow-up waited behind a
  // 5400 s budget). Treat the pause as wanting the host; the same wall-time budget bounds it.
  const cooling = /^Brief cooldown after a /.test(reason);
  console.log((starved ? "starved" : cooling ? "cooling down" : "not starved") + ": queued=" + queued + ", reason=" + reason.slice(0, 60).replace(/[^ -~]/g, "?"));
  process.exit(starved || cooling ? 0 : 1);
});' 2>/dev/null)
}
sg_brain_yield_left() {
  [ "$SG_CI_BRAIN_YIELD_SECONDS" -gt 0 ] || return 1
  [ -z "$BRAIN_YIELD_START" ] || [ "$((SECONDS - BRAIN_YIELD_START))" -lt "$SG_CI_BRAIN_YIELD_SECONDS" ]
}

START_SECONDS=$SECONDS
WAIT_NOTED=0
BRAIN_YIELD_START="" SG_BRAIN_PROBE=""
while :; do
  if sg_host_verify_acquire "$HOME/Library/Caches/signalgrid/host-verification.lock"; then
    if sg_brain_yield_left && sg_brain_wants_host; then
      sg_host_verify_release
      if [ -z "$BRAIN_YIELD_START" ]; then
        BRAIN_YIELD_START=$SECONDS
        echo 'ci-host-verification: yielding the host to the queued local brain'
      fi
      sleep 3; continue
    fi
    [ -z "${SG_BRAIN_PROBE:-}" ] || echo "ci-host-verification: brain probe at admission: $SG_BRAIN_PROBE"
    break
  else _ci_admit=$?; fi
  if [ "$_ci_admit" != 75 ]; then
    echo "ci-host-verification: admission failed ($_ci_admit): $SG_VERIFY_LOCK_REASON" >&2
    exit "$_ci_admit"
  fi
  if [ "$WAIT_NOTED" = 0 ]; then echo 'ci-host-verification: waiting for the active host chain'; WAIT_NOTED=1; fi
  if [ "$((SECONDS - START_SECONDS))" -ge "$WAIT_SECONDS" ]; then
    echo 'ci-host-verification: admission deadline exceeded; verification did not run' >&2
    exit 75
  fi
  sleep 1
done
echo "ci-host-verification: admitted; work budget ${WORK_SECONDS}s"
WORK_STARTED=1
ci_capped "$WORK_SECONDS" /bin/bash --noprofile --norc "$SCRATCH/chain.sh" &
WORK_PID=$!
wait "$WORK_PID"
_ci_result=$?
WORK_PID=""
exit "$_ci_result"
