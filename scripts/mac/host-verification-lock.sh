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
sg_host_verify_release() {
  if [ "${SG_VERIFY_LOCK_HELD:-0}" = "1" ]; then exec 9>&-; SG_VERIFY_LOCK_HELD=0; fi
}
