#!/usr/bin/env python3
"""Local-brain guard repairs — the reviewed, in-tree replacement for ~/fix_*.py.

Owner directive 2026-11-06 ~13:40Z: "I want this to be fully automated." Four times that
day a brain install dropped a guard, a repair was written outside the tree, the Mac
classifier refused to run it, and a hand asked the owner to type two lines. This file is
the repair, in the tree, reviewed before it can run.

The guards (each measured on a real build before it was written; four as of 2026-11-06 18:27Z):
  call_cap_600     signalgrid_brain.py: the OmniRoute / direct-Ollama request ceiling is
                   600 s, not 180 s. A 12k-token step on this 16 GB Mac takes 2m27s-2m59s;
                   at 180 s the client aborted every one (OmniRoute 499, Ollama 500).
  job_budget_1800  signalgrid_agent_runtime.py: the job budget is 1800 s, not 900 s. Five
                   ~3-minute steps spent 900 s and build 14bb3dd8 died after its correct edit.
  reedit_schema    signalgrid_agent_runtime.py: after the SAME edit refusal repeats, the
                   action schema offers read/check/finish (one corrective re-read), then
                   check/finish once a path was read twice. Prose alone does not stop the 9B
                   from replaying a refused edit (4ec05dc3 x3) or re-reading (a6619d01 x5).
  noop_edit_refused signalgrid_agent_runtime.py: an edit whose replacement leaves the file
                   byte-identical is REFUSED, not "EDIT APPLIED". Build 2fd0db8d (2026-11-06):
                   step 3 applied the right edit, step 4 replayed it (refused), steps 5-8 sent
                   old_text == content four times; each was accepted as progress, cleared the
                   refusal counter so reedit_schema never fired, and the job budget expired at
                   step 9 with the correct edit sitting unverified in the worktree.
Not here yet: a read-loop guard (a third identical read of an unchanged path not
selectable) — JSON-schema enums narrow the action, not the path, and Codex's own test
requires `read` to stay offered while a never-read dependency exists. That one is the
brain's to build inside its runtime.

The brain's private home is never named in this source: SIGNALGRID_BRAIN_HOME, else the
one-line dotfile ~/.signalgrid-brain-home, else refuse.

  guards.py --check        exit 0 when every guard is present in the live brain, 1 otherwise
                           (the regression suite an install/re-pin path runs BEFORE pinning)
  guards.py --apply        restore the missing guards: backup, patch, re-pin the hash chain,
                           run the brain's own unit tests, roll everything back on failure
  guards.py --self-test    synthetic copies with each guard stripped: --check must fail,
                           --apply must restore, --check must pass; no brain needed
Every run is idempotent: a present guard is left byte-for-byte alone.
"""
import datetime as dt, hashlib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

RUNTIME, BRAIN = "signalgrid_agent_runtime.py", "signalgrid_brain.py"
HANDOFF = "brain-state/new-build-handoff-config.json"
OPCFG = "brain-state/repository-operator-config.json"


def brain_home():
    env = os.environ.get("SIGNALGRID_BRAIN_HOME")
    if env:
        return Path(env).expanduser()
    dot = Path.home() / ".signalgrid-brain-home"
    if dot.is_file():
        line = dot.read_text().strip()
        if line:
            return Path(line).expanduser()
    raise SystemExit("REFUSED: set SIGNALGRID_BRAIN_HOME or write the brain's home to ~/.signalgrid-brain-home")


# A guard: `present` matches the repaired text; `patch` turns the unrepaired text into it.
# `patch` must be exact about what it replaces (count == 1) so a changed brain is refused,
# never half-edited.
GUARDS = {
    "call_cap_600": {
        "file": BRAIN,
        "present": re.compile(r"cap = 600 if timeout is None else min\(600, timeout\)"),
        "patch": [
            (re.compile(r"cap = (\d+) if timeout is None else min\(\1, timeout\)\n(\s+)if not isinstance\(cap, \(int, float\)\) or isinstance\(cap, bool\) or not 0 < cap <= \1:"),
             "cap = 600 if timeout is None else min(600, timeout)\n\\2if not isinstance(cap, (int, float)) or isinstance(cap, bool) or not 0 < cap <= 600:"),
            (re.compile(r"remaining = (\d+) if deadline is None else min\(\1, deadline - time\.monotonic\(\)\)"),
             "remaining = 600 if deadline is None else min(600, deadline - time.monotonic())"),
        ],
    },
    "job_budget_1800": {
        "file": RUNTIME,
        "present": re.compile(r"time\.monotonic\(\) - job_started > 1800|job_deadline = job_started \+ 1800"),
        "patch": [
            (re.compile(r"remaining = (\d+) - \(time\.monotonic\(\) - started\)"), "remaining = 1800 - (time.monotonic() - started)"),
            (re.compile(r"if time\.monotonic\(\) - started >= (\d+):"), "if time.monotonic() - started >= 1800:"),
            (re.compile(r"if time\.monotonic\(\) - job_started > (\d+):"), "if time.monotonic() - job_started > 1800:"),
            (re.compile(r"job_deadline = job_started \+ (\d+)"), "job_deadline = job_started + 1800"),
            (re.compile(r"reached (?:the existing |its )15-minute execution budget"), lambda m: m.group(0).replace("15-minute", "30-minute")),
        ],
    },
    "reedit_schema": {
        "file": RUNTIME,
        "present": re.compile(r'allowed = \["check", "finish"\] if any\(c >= 2 for c in build_read_counts\.values\(\)\) else \["read", "check", "finish"\]'),
        "order": ("RECOVER FROM THE ACTUAL TOOL RESULT", 'allowed = ["check", "finish"]'),
        "patch": [
            (re.compile(r'^(?P<i>[ \t]+)(?P<line>instruction \+= "\\nRECOVER FROM THE ACTUAL TOOL RESULT: [^\n]*)\n', re.M),
             "\\g<i>\\g<line>\n"
             "\\g<i># Guard reedit_schema (scripts/mac/local-brain/repairs/guards.py): the recovery text alone does not stop\n"
             "\\g<i># the 9B from replaying a refused edit; once the SAME refusal repeats the schema drops edit, keeps one\n"
             "\\g<i># corrective read, then check/finish. A first refusal may be a bad fragment a corrected edit fixes.\n"
             "\\g<i>if any(k[0] == \"edit\" and c >= 2 for k, c in build_refusal_counts.items()):\n"
             "\\g<i>    allowed = [\"check\", \"finish\"] if any(c >= 2 for c in build_read_counts.values()) else [\"read\", \"check\", \"finish\"]\n"
             "\\g<i>    schema = {**ACTION_SCHEMA, \"properties\": {**ACTION_SCHEMA[\"properties\"],\n"
             "\\g<i>        \"action\": {\"type\": \"string\", \"enum\": allowed}}}\n"),
        ],
    },
    "noop_edit_refused": {
        "file": RUNTIME,
        "present": re.compile(r'raise AgentBlocked\("Replacement changes nothing: the file already holds that content"\)'),
        "order": ('content = previous.replace(action["old_text"], action["content"], 1)', "if content == previous:", "target.write_text(content)"),
        "patch": [
            (re.compile(r'^(?P<i>[ \t]+)(?P<line>content = previous\.replace\(action\["old_text"\], action\["content"\], 1\))\n', re.M),
             "\\g<i>\\g<line>\n"
             "\\g<i># Guard noop_edit_refused (scripts/mac/local-brain/repairs/guards.py): a byte-identical result is an\n"
             "\\g<i># attempted mutation, not a real one; accepting it cleared the refusal counter (build 2fd0db8d x4).\n"
             "\\g<i>if content == previous:\n"
             "\\g<i>    raise AgentBlocked(\"Replacement changes nothing: the file already holds that content\")\n"),
        ],
    },
}


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def placed(text, g):
    # `present` alone would accept the guard's text anywhere (a dead branch, after the write);
    # `order` names the lines that must appear in this sequence, each exactly once.
    idx = [text.find(s) for s in g.get("order", ())]
    return all(i >= 0 for i in idx) and idx == sorted(idx) and all(text.count(s) == 1 for s in g.get("order", ()))


def check(home, say=print):
    missing = []
    for name, g in GUARDS.items():
        text = (home / g["file"]).read_text()
        ok = bool(g["present"].search(text)) and placed(text, g)
        say(f"{'present' if ok else 'MISSING'}  {name}  ({g['file']})")
        if not ok:
            missing.append(name)
    return missing


def patch_text(text, g):
    # A brain is pinned in more than one shape over time (Codex rewrites a site, the guard
    # stays): each anchor may be absent, never ambiguous. `present` is checked afterwards.
    hit = 0
    for rx, repl in g["patch"]:
        n = len(rx.findall(text))
        if n > 1 and not callable(repl):
            raise SystemExit(f"REFUSED: {g['file']}: anchor {rx.pattern[:50]!r} is ambiguous ({n} matches); the brain changed, repair by hand")
        if n:
            hit += 1
            text = rx.sub(repl, text)
    if not hit:
        raise SystemExit(f"REFUSED: {g['file']}: no anchor for this guard matches; the brain changed, repair by hand")
    return text


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"REFUSED: {path.name}: expected exactly one {old[:16]!r}…, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1))


def apply(home, instruction, run_tests=True, say=print):
    missing = check(home, say)
    if not missing:
        say("nothing to repair")
        return None
    files = [home / RUNTIME, home / BRAIN, home / HANDOFF, home / OPCFG]
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    bdir = home / "backups" / f"guards-{stamp}"
    bdir.mkdir(parents=True)
    for f in files:
        shutil.copy2(f, bdir / f.name)
    before = {f.name: sha(f) for f in files}

    sdir = None

    def rollback():
        for f in files:
            shutil.copy2(bdir / f.name, f)
        if sdir is not None:
            shutil.rmtree(sdir, ignore_errors=True)  # a scope never approved is not left behind
        say(f"ROLLED BACK from {bdir}")

    try:
        old_rt, old_brain, old_ho = sha(files[0]), sha(files[1]), sha(files[2])
        for name in missing:
            g = GUARDS[name]
            p = home / g["file"]
            p.write_text(patch_text(p.read_text(), g))
            if not (g["present"].search(p.read_text()) and placed(p.read_text(), g)):
                raise SystemExit(f"REFUSED: {name} still missing or misplaced after its patch")
        new_rt = sha(files[0])
        if new_rt != old_rt:
            replace_once(files[1], old_rt, new_rt)
            replace_once(files[2], old_rt, new_rt)
            replace_once(files[1], old_ho, sha(files[2]))
        new_brain = sha(files[1])

        cfg = json.loads(files[3].read_text())
        ref = cfg["accounting_scope_ref"]
        if sha(ref["path"]) != ref["sha256"] or cfg["approved_accounting_scope_sha256"] != ref["sha256"]:
            raise SystemExit("REFUSED: accounting scope already drifted")
        scope = json.loads(Path(ref["path"]).read_text())
        rs = scope["runtime_sources"]
        for fname, old, new in ((RUNTIME, old_rt, new_rt), (BRAIN, old_brain, new_brain)):
            if rs.get(fname) != old:
                raise SystemExit(f"REFUSED: scope pin for {fname} is not the live file")
            rs[fname] = new
        scope["human_instruction"] = f"{instruction} Guards restored: {', '.join(missing)} (scripts/mac/local-brain/repairs/guards.py, {stamp}). Prior instruction: " + scope["human_instruction"]
        sdir = Path(ref["path"]).parent.parent / f"guards-{stamp}"
        sdir.mkdir()
        spath = sdir / "accounting-scope.json"
        spath.write_text(json.dumps(scope, indent=2, sort_keys=True) + "\n")
        cfg["accounting_scope_ref"] = {"path": str(spath), "sha256": sha(spath)}
        cfg["approved_accounting_scope_sha256"] = sha(spath)
        files[3].write_text(json.dumps(cfg, indent=2) + "\n")

        if run_tests:
            r = subprocess.run([sys.executable, "-m", "unittest", "test_signalgrid_agent_runtime", "test_signalgrid_omniroute",
                                "test_signalgrid_repository_accounting_service"], cwd=home, capture_output=True, text=True)
            say(r.stderr[-800:])
            if r.returncode:
                raise SystemExit("REFUSED: the brain's unit tests failed with the guards restored")
    except BaseException as e:
        rollback()
        raise SystemExit(f"{e}") from None
    rec = {"stamp": stamp, "restored": missing, "backup": str(bdir), "scope": str(spath),
           "before": before, "after": {f.name: sha(f) for f in files}}
    (bdir / "record.json").write_text(json.dumps(rec, indent=2) + "\n")
    say(json.dumps(rec, indent=2))
    say("NEXT: launchctl kickstart -k gui/$(id -u)/com.signalgrid.local-brain")
    return rec


# ---- self-test: a synthetic brain with every guard stripped ------------------------------
UNREPAIRED_BRAIN = (
    "def omniroute_infer(system, user, schema, *, timeout, deadline):\n"
    "    try:\n"
    "        cap = 180 if timeout is None else min(180, timeout)\n"
    "        if not isinstance(cap, (int, float)) or isinstance(cap, bool) or not 0 < cap <= 180:\n"
    "            raise ValueError('bad')\n"
    "        local_phase = 'deadline'\n"
    "        remaining = 180 if deadline is None else min(180, deadline - time.monotonic())\n"
    "    except Exception:\n"
    "        pass\n"
    "NATIVE_CODING_SOURCE_HASHES = {'signalgrid_agent_runtime.py': 'RT'}\n"
    "NEW_BUILD_CONFIG_SHA256 = 'HO'\n")
UNREPAIRED_RUNTIME = (
    "def strict_review(started):\n"
    "            remaining = 900 - (time.monotonic() - started)\n"
    "            if remaining <= 0:\n"
    "                raise AgentBlocked(\"Strict review reached the existing 15-minute execution budget\")\n"
    "                if time.monotonic() - started >= 900:\n"
    "                    raise AgentBlocked(\"Strict review reached the existing 15-minute execution budget\")\n"
    "def execute(job_started):\n"
    "                if time.monotonic() - job_started > 900:\n"
    "                    raise AgentBlocked(\"The job reached its 15-minute execution budget\")\n"
    "                if edits:\n"
    "                    if not tdd and not private_document and (any(k[0] == \"edit\" for k in build_refusal_counts) or any(c >= 2 for c in build_read_counts.values())):\n"
    "                        instruction += \"\\nRECOVER FROM THE ACTUAL TOOL RESULT: do not replay the refused replacement. Read the current needed worktree source.\"\n"
    "                if intake_read_pending:\n"
    "                    pass\n"
    "                        if action[\"old_text\"]:\n"
    "                            previous = target.read_bytes().decode(\"utf-8\", errors=\"strict\")\n"
    "                            if previous.count(action[\"old_text\"]) != 1:\n"
    "                                raise AgentBlocked(\"Replacement fragment must occur exactly once\")\n"
    "                            content = previous.replace(action[\"old_text\"], action[\"content\"], 1)\n"
    "                        target.write_text(content)\n")


def self_test():
    home = Path(tempfile.mkdtemp(prefix="guards-st-"))
    try:
        (home / "brain-state").mkdir()
        (home / RUNTIME).write_text(UNREPAIRED_RUNTIME)
        rt = sha(home / RUNTIME)
        (home / HANDOFF).write_text(json.dumps({"runtime": rt}) + "\n")
        (home / BRAIN).write_text(UNREPAIRED_BRAIN.replace("'RT'", f"'{rt}'").replace("'HO'", f"'{sha(home / HANDOFF)}'"))
        scope_dir = home / "brain-state" / "scopes" / "first"
        scope_dir.mkdir(parents=True)
        scope = scope_dir / "accounting-scope.json"
        scope.write_text(json.dumps({"runtime_sources": {RUNTIME: rt, BRAIN: sha(home / BRAIN)}, "human_instruction": "fixture"}) + "\n")
        (home / OPCFG).write_text(json.dumps({"accounting_scope_ref": {"path": str(scope), "sha256": sha(scope)}, "approved_accounting_scope_sha256": sha(scope)}) + "\n")
        passed = total = 0
        quiet = lambda *_: None

        def ok(name, cond):
            nonlocal passed, total
            total += 1
            passed += bool(cond)
            if not cond:
                print(f"FAIL: {name}")

        ok("(1) every guard reported MISSING on the stripped brain", sorted(check(home, quiet)) == sorted(GUARDS))
        rec = apply(home, "self-test", run_tests=False, say=quiet)
        ok("(2) --apply restored every guard", rec is not None and sorted(rec["restored"]) == sorted(GUARDS))
        ok("(3) --check passes afterwards", check(home, quiet) == [])
        rt2 = sha(home / RUNTIME)
        brain_txt = (home / BRAIN).read_text()
        ok("(4) runtime re-pinned in brain and handoff", rt2 in brain_txt and rt2 in (home / HANDOFF).read_text() and sha(home / HANDOFF) in brain_txt)
        cfg = json.loads((home / OPCFG).read_text())
        ok("(5) a NEW accounting scope pins the repaired files", cfg["accounting_scope_ref"]["path"] != str(scope)
           and json.loads(Path(cfg["accounting_scope_ref"]["path"]).read_text())["runtime_sources"][RUNTIME] == rt2)
        runtime_txt = (home / RUNTIME).read_text()
        ok("(6) 15-minute wording became 30-minute at every site", "15-minute" not in runtime_txt and runtime_txt.count("30-minute") == 3)
        ok("(7) the schema guard sits inside the RECOVER branch, keeping a first-refusal corrected edit", 'enum": allowed' in runtime_txt and runtime_txt.index("RECOVER FROM") < runtime_txt.index("allowed = ["))
        ok("(7b) the no-op refusal sits between the replace and the write, so an identical result never reaches write_text",
           runtime_txt.index("content = previous.replace(") < runtime_txt.index("if content == previous:") < runtime_txt.index("target.write_text(content)"))
        # Cloud review L1 (6f6b7adf): the raise text alone must not read as present when it sits after the write.
        moved = runtime_txt.replace("if content == previous:\n", "", 1).replace("target.write_text(content)\n",
                "target.write_text(content)\nif content == previous:\n", 1)
        ok("(7c) --check refuses the guard's text in the wrong place", not placed(moved, GUARDS["noop_edit_refused"]))
        snap = {n: sha(home / n) for n in (RUNTIME, BRAIN, HANDOFF, OPCFG)}
        ok("(8) a second --apply is a no-op", apply(home, "again", run_tests=False, say=quiet) is None and snap == {n: sha(home / n) for n in snap})
        # A brain whose anchor changed shape is refused and left untouched, not half-edited.
        (home / BRAIN).write_text((home / BRAIN).read_text().replace("cap = 600", "cap = 120", 1))
        broken = sha(home / BRAIN)
        try:
            apply(home, "drift", run_tests=False, say=quiet)
            ok("(9) a drifted anchor is refused", False)
        except SystemExit as e:
            ok("(9) a drifted anchor is refused and rolled back", "REFUSED" in str(e) and sha(home / BRAIN) == broken)
        print(f"self-test {'passed' if passed == total else 'FAILED'} ({passed}/{total})")
        return passed == total
    finally:
        shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["--self-test"]:
        sys.exit(0 if self_test() else 1)
    if a == ["--check"]:
        sys.exit(1 if check(brain_home()) else 0)
    if a[:1] == ["--apply"]:
        apply(brain_home(), " ".join(a[1:]) or "Owner directive 2026-11-06: repairs are code in the tree.")
        sys.exit(0)
    print(__doc__)
    sys.exit(2)
