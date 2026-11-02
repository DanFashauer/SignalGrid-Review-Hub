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

ci_capped() {
  exec perl -MPOSIX=setsid,WNOHANG -MTime::HiRes=time,sleep -e '
    my $seconds = shift @ARGV;
    my $signal = 0;
    $SIG{INT} = sub { $signal = 130 };
    $SIG{TERM} = sub { $signal = 143 };
    $SIG{HUP} = sub { $signal = 129 };
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
    my $started = <$ready>; close $ready;
    if (!defined($started) || $started ne "ready\n") {
      kill "KILL", $pid; waitpid($pid, 0); exit 125;
    }
    my $deadline = time() + $seconds;
    my ($code, $reaped) = (0, 0);
    while (1) {
      my $done = waitpid($pid, WNOHANG);
      if ($done == $pid) { $code = ($? & 127) ? 128 + ($? & 127) : $? >> 8; $reaped = 1; last }
      if ($signal) { $code = $signal; last }
      if (time() >= $deadline) { print STDERR "ci-host-verification: work/cleanup deadline exceeded\n"; $code = 124; last }
      sleep 0.05;
    }
    # Parent exit is not group exit: reap redirected descendants on every outcome.
    my $live = sub {
      open(my $ps, "-|", "/bin/ps", "-axo", "pid=,pgid=,state=") or return undef;
      my $found = 0;
      while (<$ps>) { $found = 1 if /^\s*(\d+)\s+(\d+)\s+(\S+)/ && $2 == $pid && $3 !~ /^Z/ }
      close($ps) or return undef;
      return $found;
    };
    kill "TERM", -$pid;
    my $grace = time() + 1;
    while (time() < $grace) { my $active = $live->(); last if defined($active) && !$active; sleep 0.05 }
    kill "KILL", -$pid;
    waitpid($pid, 0) unless $reaped;
    my $warned = 0;
    while (1) {
      my $active = $live->(); last if defined($active) && !$active;
      # Keep FD 9 held on cleanup uncertainty; the outer job remains bounded.
      print STDERR "ci-host-verification: cleanup unconfirmed; retaining host reservation\n" unless $warned++;
      kill "KILL", -$pid; sleep 0.2;
    }
    exit $code;
  ' "$@"
}

# The local second brain polls this same lock every 2 s non-blocking and never wins
# against a 1 s retry loop that then holds the host for a whole job: measured
# 2026-11-01, zero brain admissions in a day with 32 dispatch items queued. Once per
# job, while the brain reports queued work blocked on the host, yield instead of
# trying. Fail-closed toward CI: no brain, no node, bad JSON — no yield.
SG_CI_BRAIN_URL="${SG_CI_BRAIN_URL:-http://127.0.0.1:8765/api/brain}"
SG_CI_BRAIN_YIELD_SECONDS="${SG_CI_BRAIN_YIELD_SECONDS:-30}"
case "$SG_CI_BRAIN_YIELD_SECONDS" in ""|*[!0-9]*) SG_CI_BRAIN_YIELD_SECONDS=30;; esac
sg_brain_wants_host() {
  curl -s -m 3 "$SG_CI_BRAIN_URL" 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  let b; try { b = JSON.parse(s); } catch { process.exit(1); }
  const c = (b && b.coordinator) || {}; const queued = c.counts && c.counts.queued;
  process.exit(Number.isInteger(queued) && queued > 0
    && /^Host resources are reserved/.test(String(c.blocked_reason || "")) ? 0 : 1);
});' 2>/dev/null
}

START_SECONDS=$SECONDS
WAIT_NOTED=0
BRAIN_YIELDED=0
while :; do
  if [ "$BRAIN_YIELDED" -lt "$SG_CI_BRAIN_YIELD_SECONDS" ] && sg_brain_wants_host; then
    if [ "$BRAIN_YIELDED" = 0 ]; then echo 'ci-host-verification: yielding the host to the queued local brain'; fi
    BRAIN_YIELDED=$((BRAIN_YIELDED + 2)); sleep 2; continue
  fi
  if sg_host_verify_acquire "$HOME/Library/Caches/signalgrid/host-verification.lock"; then break; else _ci_admit=$?; fi
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
