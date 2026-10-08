#!/usr/bin/env bash
# =============================================================================
# SignalGrid — a one-line Claude Code status line for the lane session.
#
#   bash scripts/mac/statusline.sh              # reads Claude Code's status JSON on stdin
#   bash scripts/mac/statusline.sh --self-test  # builds a fixture tree, asserts the counts
#
# It prints ONE line, built only from files already on disk:
#
#   <branch> | <N> open hands | <M> unread for <lane> | <model display name>
#
#   branch    git plumbing only (`git symbolic-ref`, `git rev-parse --short` when
#             detached). No fetch, no status, no network.
#   hands     artifacts/raised-hands/*.json whose status is not "resolved" — the same
#             rule scripts/raised-hands.mjs applies to decide a hand is still open.
#   unread    artifacts/lane-messages/*.json addressed to THIS lane with no ack in
#             artifacts/lane-messages/acks/ written by that lane (an ack from anyone
#             else does not close a message — scripts/lane-message.mjs refuses it too).
#   lane      SIGNALGRID_LANE if it is mac or cloud, else mac on macOS and cloud
#             everywhere else — scripts/lib/lane-identity.mjs's rule; the self-test
#             compares the two so this copy cannot drift.
#   model     model.display_name from the status JSON, when Claude Code sends it.
#
# A part that cannot be read is LEFT OUT, never replaced by a placeholder: no repo,
# no directory, a file that does not parse. A count that might be too low is not
# shown (golden rule 2: unknown never reads as "nothing waiting"); a 0 is printed
# only when the directory WAS read and nothing in it is waiting. When nothing at all
# can be read it prints nothing.
#
# WHAT IT READS: files in the checkout of the session's directory
# (workspace.current_dir, else cwd, else $PWD). Nothing else — no network, no `gh`,
# no `pnpm run hands` (which asks GitHub). So the counts are as fresh as the last
# `git pull`; they are a prompt to run `pnpm run lane:inbox` / `pnpm run hands`,
# not a replacement for either.
#
# WHY python3 -I and not node: it is the faster parser. The same program in each, whole
# script, 30 runs per round, three rounds on a 4-core box under other sessions' load
# (load average 12-14): python3 median 32 / 72 / 74 ms, node median 45 / 123 / 127 ms.
# Bare interpreter start is 20 ms against 55 ms. The budget is 150 ms; python3 holds it
# at the median and p90 with room; node's p90 reached 150-167 ms under load. It is not a
# new dependency in practice: on a Mac `git` and `python3` both come from the Xcode
# command-line tools this repo already needs. Kept to what Python 3.9 (the CLT's) runs.
#
# Turn it off: delete the "statusLine" key from .claude/settings.json, or point your own
# .claude/settings.local.json "statusLine" at another command. Nothing else depends on it.
#
# bash 3.2 (the only bash on a stock Mac): no arrays are used; `read -d ''` and
# `[ ]` only; every variable is defaulted under `set -u`.
# =============================================================================
set -u

IFS= read -r -d '' STATUS_PY <<'PYEOF'
import json
import os
import subprocess
import sys


def clean(s):
    return "".join(c for c in str(s) if ord(c) >= 32 and not 0x7F <= ord(c) <= 0x9F).strip()


def text(v):
    return v if isinstance(v, str) and v.strip() != "" else None


def json_files(d):
    return sorted(f for f in os.listdir(d) if f.endswith(".json"))


def read_obj(p):
    with open(p, encoding="utf-8") as fh:
        v = json.load(fh)
    if not isinstance(v, dict):
        raise ValueError("not an object: " + p)
    return v


# Claude Code's status JSON arrives on stdin; a terminal, an empty pipe or garbage all
# mean "no JSON", and the session directory falls back to $PWD.
data = {}
try:
    if not sys.stdin.isatty():
        raw = sys.stdin.read()
        if raw.strip() != "":
            data = json.loads(raw)
except Exception:
    data = {}
if not isinstance(data, dict):
    data = {}

# currentLane() in scripts/lib/lane-identity.mjs, without its console.warn.
declared = os.environ.get("SIGNALGRID_LANE")
if declared in ("mac", "cloud"):
    lane = declared
else:
    lane = "mac" if sys.platform == "darwin" else "cloud"

ws = data.get("workspace") if isinstance(data.get("workspace"), dict) else {}
root = None
for cand in (ws.get("current_dir"), data.get("cwd"), sys.argv[1] if len(sys.argv) > 1 else None):
    d = text(cand)
    if d and os.path.isabs(d) and os.path.isdir(d):
        while True:
            if os.path.exists(os.path.join(d, ".git")):
                root = d
                break
            up = os.path.dirname(d)
            if up == d:
                break
            d = up
        break

branch = ""
if root:
    def git(*args):
        try:
            r = subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True, timeout=1,
                               env=dict(os.environ, GIT_OPTIONAL_LOCKS="0"))
            return clean(r.stdout) if r.returncode == 0 else ""
        except Exception:
            return ""
    branch = git("symbolic-ref", "--short", "-q", "HEAD")
    if not branch:
        sha = git("rev-parse", "--short", "HEAD")
        branch = "detached@" + sha if sha else ""

hands = None
if root:
    d = os.path.join(root, "artifacts", "raised-hands")
    try:
        if os.path.isdir(d):
            hands = sum(1 for f in json_files(d) if read_obj(os.path.join(d, f)).get("status") != "resolved")
    except Exception:
        hands = None

mail = None
if root:
    d = os.path.join(root, "artifacts", "lane-messages")
    try:
        if os.path.isdir(d):
            closed = set()
            ad = os.path.join(d, "acks")
            if os.path.isdir(ad):
                for f in json_files(ad):
                    a = read_obj(os.path.join(ad, f))
                    if a.get("ackedBy") == lane and isinstance(a.get("messageId"), str):
                        closed.add(a["messageId"])
            n = 0
            for f in json_files(d):
                m = read_obj(os.path.join(d, f))
                mid = m["id"] if isinstance(m.get("id"), str) else f[:-5]
                if m.get("to") == lane and mid not in closed:
                    n += 1
            mail = n
    except Exception:
        mail = None

m = data.get("model")
model = text(m if isinstance(m, str) else m.get("display_name") if isinstance(m, dict) else None)

parts = []
if branch:
    parts.append(clean(branch))
if hands is not None:
    parts.append("%d open hand%s" % (hands, "" if hands == 1 else "s"))
if mail is not None:
    parts.append("%d unread for %s" % (mail, lane))
if model and clean(model):
    parts.append(clean(model))
if parts:
    sys.stdout.write(" | ".join(parts) + "\n")
PYEOF

status_line() {
  command -v python3 >/dev/null 2>&1 || return 0
  exec python3 -I -c "$STATUS_PY" "$PWD" 2>/dev/null
}

self_test() {
  local self fx repo n_ok n_fail out want
  case "$0" in /*) self=$0 ;; *) self=$PWD/$0 ;; esac
  n_ok=0
  n_fail=0
  command -v python3 >/dev/null 2>&1 || { echo "statusline self-test: python3 is not on PATH" >&2; return 1; }
  command -v node >/dev/null 2>&1 || { echo "statusline self-test: node is not on PATH (needed to read lane-identity.mjs)" >&2; return 1; }
  command -v git >/dev/null 2>&1 || { echo "statusline self-test: git is not on PATH" >&2; return 1; }

  fx=$(mktemp -d "${TMPDIR:-/tmp}/sg-statusline.XXXXXX") || return 1
  case "$fx" in /*/sg-statusline.*) ;; *) echo "statusline self-test: unexpected temp dir $fx" >&2; return 1 ;; esac
  # shellcheck disable=SC2064  # $fx is expanded NOW on purpose: the trap removes this fixture only
  trap "rm -rf -- '$fx'" EXIT

  repo=$fx/repo
  mkdir -p "$repo/artifacts/raised-hands" "$repo/artifacts/lane-messages/acks" "$repo/sub" "$fx/plain"
  git init -q "$repo" || return 1
  git -C "$repo" symbolic-ref HEAD refs/heads/fixture-branch || return 1

  # two hands: one open, one cleared (the real ledger marks a cleared hand status "resolved")
  printf '%s\n' '{"id":"h-open","status":"open","doing":"d","blockedBy":"b","need":"n","whoCanUnblock":"owner"}' > "$repo/artifacts/raised-hands/h-open.json"
  printf '%s\n' '{"id":"h-cleared","status":"resolved","resolvedAt":"2026-10-08T00:00:00Z","resolution":"done"}' > "$repo/artifacts/raised-hands/h-cleared.json"
  # one unread message to each lane, plus one to mac that mac has acknowledged
  printf '%s\n' '{"id":"m-to-mac","from":"cloud","to":"mac","subject":"s","body":"b"}' > "$repo/artifacts/lane-messages/m-to-mac.json"
  printf '%s\n' '{"id":"m-to-cloud","from":"mac","to":"cloud","subject":"s","body":"b"}' > "$repo/artifacts/lane-messages/m-to-cloud.json"
  printf '%s\n' '{"id":"m-to-mac-acked","from":"cloud","to":"mac","subject":"s","body":"b"}' > "$repo/artifacts/lane-messages/m-to-mac-acked.json"
  printf '%s\n' '{"messageId":"m-to-mac-acked","ackedBy":"mac","note":"done"}' > "$repo/artifacts/lane-messages/acks/m-to-mac-acked.json"

  expect() {
    # expect <name> <wanted> <got>
    if [ "$2" = "$3" ]; then
      n_ok=$((n_ok + 1))
      echo "  ok   — $1"
    else
      n_fail=$((n_fail + 1))
      echo "  FAIL — $1" >&2
      echo "         want: [$2]" >&2
      echo "         got:  [$3]" >&2
    fi
  }

  out=$(printf '{"model":{"display_name":"Test Model"},"workspace":{"current_dir":"%s"}}' "$repo" | env SIGNALGRID_LANE=mac bash "$self")
  expect "mac lane: branch, 1 open hand (not 2), 1 unread (the acked one is closed), model" "fixture-branch | 1 open hand | 1 unread for mac | Test Model" "$out"
  out=$(printf '{"model":{"display_name":"Test Model"},"workspace":{"current_dir":"%s"}}' "$repo" | env SIGNALGRID_LANE=cloud bash "$self")
  expect "cloud lane: the cloud lane's one unread message is counted" "fixture-branch | 1 open hand | 1 unread for cloud | Test Model" "$out"

  out=$(printf '{"cwd":"%s"}' "$repo/sub" | env SIGNALGRID_LANE=mac bash "$self")
  expect "cwd field, from a subdirectory, finds the repo above it; no model, none printed" "fixture-branch | 1 open hand | 1 unread for mac" "$out"

  out=$( cd "$repo" && printf 'this is not json' | env SIGNALGRID_LANE=mac bash "$self" )
  expect "garbage on stdin falls back to \$PWD" "fixture-branch | 1 open hand | 1 unread for mac" "$out"

  # an ack written by the SENDER does not close the message (lane-message.mjs refuses it too)
  printf '%s\n' '{"messageId":"m-to-cloud","ackedBy":"mac","note":"graded my own homework"}' > "$repo/artifacts/lane-messages/acks/m-to-cloud.json"
  out=$(printf '{"workspace":{"current_dir":"%s"}}' "$repo" | env SIGNALGRID_LANE=cloud bash "$self")
  expect "an ack by the sender leaves the message unread" "fixture-branch | 1 open hand | 1 unread for cloud" "$out"
  printf '%s\n' '{"messageId":"m-to-cloud","ackedBy":"cloud","note":"read"}' > "$repo/artifacts/lane-messages/acks/m-to-cloud.json"
  out=$(printf '{"workspace":{"current_dir":"%s"}}' "$repo" | env SIGNALGRID_LANE=cloud bash "$self")
  expect "an ack by the addressee closes it (a true zero is printed)" "fixture-branch | 1 open hand | 0 unread for cloud" "$out"

  # a hand file that does not parse: the count is LEFT OUT, never shown as 1
  printf '%s' '{"id":' > "$repo/artifacts/raised-hands/torn.json"
  out=$(printf '{"workspace":{"current_dir":"%s"}}' "$repo" | env SIGNALGRID_LANE=mac bash "$self")
  expect "an unreadable hand file removes the hands count instead of undercounting" "fixture-branch | 1 unread for mac" "$out"
  rm -f -- "$repo/artifacts/raised-hands/torn.json"

  # a hand whose status is not "resolved" (a typo, say) is still counted as open
  printf '%s\n' '{"id":"h-typo","status":"reolved"}' > "$repo/artifacts/raised-hands/h-typo.json"
  out=$(printf '{"workspace":{"current_dir":"%s"}}' "$repo" | env SIGNALGRID_LANE=mac bash "$self")
  expect "an unknown status counts as open" "fixture-branch | 2 open hands | 1 unread for mac" "$out"
  rm -f -- "$repo/artifacts/raised-hands/h-typo.json"

  # no repo: only what is readable is printed
  out=$(printf '{"model":{"display_name":"Test Model"},"workspace":{"current_dir":"%s"}}' "$fx/plain" | env SIGNALGRID_LANE=mac bash "$self")
  expect "outside a repo only the model name is printed" "Test Model" "$out"
  out=$(printf '{"workspace":{"current_dir":"%s"}}' "$fx/plain" | env SIGNALGRID_LANE=mac bash "$self")
  expect "outside a repo and with no model, nothing is printed" "" "$out"

  # the lane rule is lane-identity.mjs's rule: compare, so the copy cannot drift
  want=$(node -e 'import(process.argv[1]).then((m) => console.log(m.currentLane()))' -- "file://$(dirname "$self")/../lib/lane-identity.mjs" 2>/dev/null)
  out=$(printf '{"workspace":{"current_dir":"%s"}}' "$repo" | env -u SIGNALGRID_LANE bash "$self")
  expect "the lane label with SIGNALGRID_LANE unset equals currentLane() in lane-identity.mjs" "fixture-branch | 1 open hand | 0 unread for ${want:-?}" "$out"

  echo "statusline self-test: $n_ok passed, $n_fail failed"
  [ "$n_fail" -eq 0 ]
}

case "${1:-}" in
  --self-test) self_test ;;
  *) status_line ;;
esac
