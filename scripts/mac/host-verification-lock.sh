#!/usr/bin/env bash
# Source from trusted mainline. Reserve FD 9 for one heavyweight chain per host.
# flock is provided by stock Perl/Fcntl on macOS; no separate flock executable is needed.
# The shell keeps the locked open-file description after Perl returns. Kernel ownership
# has no pid-file startup gap or stale reaper race, and disappears when holders exit.
# Never unlink this persistent file: replacing its inode would create a second lock.
SG_VERIFY_LOCK_HELD=0
export SG_VERIFY_LOCK_REASON=""
sg_host_verify_acquire() {
  SG_VERIFY_LOCK_REASON="host verification lock unavailable"
  mkdir -p "$(dirname "$1")" || return 2
  exec 9>>"$1" || return 2
  if perl -MFcntl=:flock -e 'open(my $lock, "+<&=9") or exit 2; flock($lock, LOCK_EX|LOCK_NB) or exit 75;'; then
    SG_VERIFY_LOCK_HELD=1
    return 0
  else
    _sg_verify_rc=$?
    exec 9>&-
    if [ "$_sg_verify_rc" = "75" ]; then SG_VERIFY_LOCK_REASON="another SignalGrid verification chain holds the host lock"; fi
    return "$_sg_verify_rc"
  fi
}
# Bounded ordinary admission for a caller that names a bound: the SAME non-blocking exclusive flock on the
# SAME inode, retried once a second until the bound, then the caller's existing busy result (75). Only "held
# by another chain" is waited on; a custody or open failure is returned at once. Nothing here signals,
# unlinks or otherwise touches another holder. sg_host_verify_acquire itself is unchanged for every other caller.
SG_VERIFY_WAIT_MAX_SEC=90
sg_host_verify_acquire_bounded() {
  case "${2:-}" in
    ''|*[!0-9]*) SG_VERIFY_LOCK_REASON="invalid host admission bound"; return 2 ;;
  esac
  if [ "${#2}" -gt 2 ] || [ "$2" -gt "$SG_VERIFY_WAIT_MAX_SEC" ]; then
    SG_VERIFY_LOCK_REASON="invalid host admission bound"; return 2
  fi
  _sg_wait_started=$SECONDS
  while :; do
    sg_host_verify_acquire "$1" && return 0
    _sg_wait_rc=$?
    [ "$_sg_wait_rc" = "75" ] || return "$_sg_wait_rc"
    [ $((SECONDS - _sg_wait_started)) -lt "$2" ] || return 75
    sleep 1
  done
}
sg_host_verify_release() {
  if [ "${SG_VERIFY_LOCK_HELD:-0}" = "1" ]; then exec 9>&-; SG_VERIFY_LOCK_HELD=0; fi
}
