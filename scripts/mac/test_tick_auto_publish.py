#!/usr/bin/env python3
"""Behavioral regressions for the tick publication step.

Run from any working directory:
  python3 scripts/mac/test_tick_auto_publish.py
The target is a test copy, never the installed tick. This harness executes only
the actual d3 source region, with fixture-only node/gh/git/host boundaries.
No models, live brain DB, public origin, mail, or full tick are invoked.
"""
import json
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import signal
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
expected_repo = os.environ.get("SIGNALGRID_AUTOPUBLISH_TEST_REPO")
if expected_repo is not None and Path(expected_repo).resolve() != REPO:
    raise RuntimeError("The tick regression target must be this harness repository")
START = "# ── d3."
END = "# ── e. heartbeat"
BOUNDARY_HEAD = "1234567890abcdef1234567890abcdef12345678"
NOT_BEFORE = "2026-11-06T16:40:00Z"

MOCK_NODE = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
a = sys.argv[1:]
root = Path(os.environ["SG_TEST_ROOT"])
cfg = json.loads((root/"fixture.json").read_text())
with (root/"client-context.jsonl").open("a") as f:
    keys=["GIT_SSH_COMMAND","BASH_ENV","ENV","SHELLOPTS","BASHOPTS"]+[k for k in os.environ if k.startswith("BASH_FUNC_")]
    f.write(json.dumps({"client":"node","argv":a,"env":{k:os.environ.get(k) for k in keys}})+"\n")
if "--list-review" in a:
    counter=root/"listing-count"
    count=int(counter.read_text())+1 if counter.exists() else 1
    counter.write_text(str(count))
    if cfg.get("slow_first_listing") and count == 1:
        import time
        time.sleep(2)
    if cfg.get("list_error"):
        print("PRIVATE_SYNTHETIC /Users/fixture/private-db", file=sys.stderr)
        sys.exit(42)
    print("\n".join([] if cfg.get("stale_on_preflight") and count>1 else cfg.get("jobs", ["freshA"])))
    sys.exit(0)
if "--job" not in a or "--publish" not in a:
    print("Fixture refuses an unrecognized node action", file=sys.stderr)
    sys.exit(97)
at = a.index("--job")
job = a[at+1]
with (root/"calls.jsonl").open("a") as f:
    f.write(json.dumps({"job":job,"argv":a})+"\n")
intents=[]
state = Path(os.environ["SIGNALGRID_BRAIN_PUBLICATION_STATE"])
if state.exists():
    for p in state.rglob("*"):
        if not p.is_file() or p.name == "activation.json":
            continue
        try:
            values = [json.loads(p.read_text())]
        except Exception:
            try: values=[json.loads(line) for line in p.read_text().splitlines() if line.strip()]
            except Exception: continue
        for v in values:
            if isinstance(v,dict) and (v.get("job_id")==job or v.get("job")==job):
                intents.append(str(p.relative_to(state)))
with (root/"seen-intents.jsonl").open("a") as f:
    f.write(json.dumps({"job":job,"intents":intents})+"\n")
if cfg.get("publish_error"):
    print("PRIVATE_SYNTHETIC /var/folders/fixture/brain-pr-x/private.md",file=sys.stderr)
    sys.exit(1)
if cfg.get("hang_publish"):
    import time
    time.sleep(2)
if cfg.get("branch_only"):
    print("brain/job-"+job+" already exists on origin — nothing pushed (idempotent)")
else:
    (root/"published.json").write_text(json.dumps({"job":job}))
    url="https://github.com/DanFashauer/SignalGrid-Review-Hub/pull/999999"
    print(url)
    if not cfg.get("no_facts"):
        print("SIGNALGRID_PUBLICATION_FACTS "+json.dumps({"format":"signalgrid-publication-facts/v1",
          "job":job,"branch":"brain/job-"+job,"base":"SignalGrid_Alpha",
          "replayBase":"3333333333333333333333333333333333333333",
          "publishedHead":"1234567890abcdef1234567890abcdef12345678",
          "publishedTree":"2222222222222222222222222222222222222222",
          "files":["docs/x.md"],"pushed":True,"prUrl":url}))
'''
MOCK_GH = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
r=Path(os.environ["SG_TEST_ROOT"])
cfg=json.loads((r/"fixture.json").read_text())
a=sys.argv[1:]
with (r/"get-calls.jsonl").open("a") as f: f.write(json.dumps(a)+"\n")
with (r/"client-context.jsonl").open("a") as f:
    keys=["GIT_SSH_COMMAND","GH_HOST","GH_REPO","GH_CONFIG_DIR","BASH_ENV","ENV","SHELLOPTS","BASHOPTS"]+[k for k in os.environ if k.startswith("BASH_FUNC_")]
    f.write(json.dumps({"client":"gh","argv":a,"env":{k:os.environ.get(k) for k in keys}})+"\n")
with (r/"host-events").open("a") as f: f.write("metadata\n")
if a[:3]==["api","--hostname","github.com"]: a=["api"]+a[3:]
if len(a)!=4 or a[:3]!=["api","--method","GET"]:
    print("fixture refuses mutating/unknown GitHub action",file=sys.stderr); sys.exit(98)
endpoint=a[3]
prefix="repos/DanFashauer/SignalGrid-Review-Hub/"
if not endpoint.startswith(prefix): sys.exit(98)
path=endpoint[len(prefix):]
if cfg.get("branch_only") or not (r/"published.json").exists():
    if not path.startswith("pulls?state=all&head=DanFashauer:brain/job-"): sys.exit(98)
    print("[]");sys.exit(0)
job=json.loads((r/"published.json").read_text())["job"]
branch="brain/job-"+job
head="1234567890abcdef1234567890abcdef12345678"
tree="2222222222222222222222222222222222222222"
url="https://github.com/DanFashauer/SignalGrid-Review-Hub/pull/999999"
if cfg.get("tamper_raw") and not (r/"tampered").exists():
    raw=Path(os.environ["SIGNALGRID_BRAIN_PUBLICATION_STATE"])/"attempts"/job/"stdout.raw"
    raw.chmod(0o600)
    fact={"format":"signalgrid-publication-facts/v1","job":job,"branch":branch,"base":"SignalGrid_Alpha",
          "replayBase":"3333333333333333333333333333333333333333","publishedHead":head,
          "publishedTree":tree,"files":["docs/x.md"],"pushed":True,"prUrl":url}
    raw.write_text(url+"\nSIGNALGRID_PUBLICATION_FACTS "+json.dumps(fact)+"\n")
    raw.chmod(0o400)
    (r/"tampered").write_text("1")
if cfg.get("tamper_stderr") and not (r/"tampered").exists():
    raw=Path(os.environ["SIGNALGRID_BRAIN_PUBLICATION_STATE"])/"attempts"/job/"stderr.raw"
    raw.chmod(0o600);raw.write_text("Synthetic changed completed raw\n");raw.chmod(0o400)
    (r/"tampered").write_text("1")
pr={"number":999999,"html_url":url,"state":"open","merged":False,
    "head":{"ref":branch,"sha":head,"repo":{"full_name":"DanFashauer/SignalGrid-Review-Hub"}},
    "base":{"ref":"SignalGrid_Alpha","repo":{"full_name":"DanFashauer/SignalGrid-Review-Hub"}}}
if path.startswith("pulls?state=all&head=DanFashauer:"):
    print(json.dumps([pr] if "head=DanFashauer:"+branch+"&" in path else []))
elif path=="pulls/999999": print(json.dumps(pr))
elif path=="pulls/999999/files?per_page=100&page=1": print(json.dumps([{"filename":"docs/x.md"}]))
elif path=="git/commits/"+head:
    print(json.dumps({"sha":head,"tree":{"sha":"4444444444444444444444444444444444444444" if cfg.get("wrong_tree") else tree},
                      "parents":[{"sha":"3333333333333333333333333333333333333333"}]}))
elif path=="git/ref/heads/"+branch:
    print(json.dumps({"ref":"refs/heads/"+branch,"object":{"type":"commit","sha":head}}))
else:
    print("fixture refuses unexpected GitHub read",file=sys.stderr);sys.exit(98)
'''
MOCK_GIT = r'''#!/usr/bin/env python3
import os,sys
from pathlib import Path
r=Path(os.environ["SG_TEST_ROOT"])
with (r/"git-calls.log").open("a") as f: f.write(repr(sys.argv[1:])+"\n")
with (r/"client-context.jsonl").open("a") as f:
    import json
    keys=["GIT_SSH_COMMAND","GIT_CONFIG_GLOBAL","HOME","BASH_ENV","ENV","SHELLOPTS","BASHOPTS"]+[k for k in os.environ if k.startswith("BASH_FUNC_")]
    f.write(json.dumps({"client":"git","argv":sys.argv[1:],"env":{k:os.environ.get(k) for k in keys}})+"\n")
import json,subprocess
cfg=json.loads((r/"fixture.json").read_text())
if cfg.get("probe_shell_startup"):
    subprocess.run(["/bin/bash","-c","exit 0"],check=True)
a=sys.argv[1:]
if any(x in a for x in ["push","fetch","commit","checkout","worktree","add","reset","clean"]):
    print("fixture refuses unexpected Git mutation",file=sys.stderr);sys.exit(98)
if "config" in a:
    import json
    cfg=json.loads((r/"fixture.json").read_text())
    if "--list" in a:
        print("remote.origin.url\ngit@github.com:DanFashauer/SignalGrid-Review-Hub.git\0"+("core.sshcommand\nsynthetic-worker-command\0" if cfg.get("unsafe_local_config") else ""),end="")
    elif "remote.origin.url" in a: print("git@github.com:DanFashauer/SignalGrid-Review-Hub.git")
    else: sys.exit(98)
elif "remote" in a and "get-url" in a:
    print("git@github.com:DanFashauer/SignalGrid-Review-Hub.git")
    if cfg.get("extra_effective_pushurl") and "--push" in a:
        print("ssh://synthetic.invalid/other/project.git")
elif "ls-remote" in a:
    import json
    cfg=json.loads((r/"fixture.json").read_text())
    ref=a[-1]
    job=json.loads((r/"published.json").read_text())["job"] if (r/"published.json").exists() else None
    if (cfg.get("branch_only") and ref=="refs/heads/brain/job-freshA") or (job and ref=="refs/heads/brain/job-"+job):
        print("1234567890abcdef1234567890abcdef12345678\t"+ref)
elif "rev-parse" in a:
    print("1234567890abcdef1234567890abcdef12345678")
else:
    print("fixture refuses unexpected Git read",file=sys.stderr);sys.exit(98)
'''

class TickAutoPublishRegression(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="tick-auto-publish-st-")
        self.root=Path(self.tmp.name)
        self.home=self.root/"home"
        self.state=self.home/".local/state/signalgrid/brain-publications"
        self.state.mkdir(parents=True,mode=0o700)
        self.work=self.root/"work"
        self.work.mkdir()
        (self.work/"node_modules").mkdir()
        (self.work/"scripts").symlink_to(REPO/"scripts",target_is_directory=True)
        self.bin=self.root/"bin"
        self.bin.mkdir()
        for name, text in [("node",MOCK_NODE),("gh",MOCK_GH),("git",MOCK_GIT)]:
            p=self.bin/name
            p.write_text(text)
            p.chmod(0o700)
        self.activation={"format":"signalgrid-brain-publication-activation/v1",
                         "enabled":True,"not_before":NOT_BEFORE,
                         "activation_id":"synthetic-autopublish-test"}
        self.activation["publisher_sha256"]=hashlib.sha256((REPO/"scripts/mac/brain-proposal-pr.mjs").read_bytes()).hexdigest()
        self.activation["tick_sha256"]=hashlib.sha256((REPO/"scripts/mac/lane-tick.sh").read_bytes()).hexdigest()
        self.activation["dependency_sha256"]={p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in (
            "scripts/check-owner-gated-surfaces.mjs", "scripts/lib/is-main.mjs", "scripts/lib/scratch-git.mjs", ".githooks/pre-push")}
        self.write_activation()
        self.bootstrap_custody()
        self.cfg={"jobs":["freshA"]}
        self.cap="1"
        self.host_busy=False
        self.extra_env={}
    def tearDown(self):
        self.tmp.cleanup()
    def write_activation(self):
        p=self.state/"activation.json"
        p.write_text(json.dumps(self.activation)+"\n")
        p.chmod(0o600)
    def bootstrap_custody(self):
        # Disposable fixture counterpart of separately selected Root activation.
        # The production tick must never synthesize these control identities.
        parent=self.home/".local/state/signalgrid"
        self.mirror=parent/"brain-publication-custody"
        self.mirror.mkdir(mode=0o700)
        attempts=self.state/"attempts"
        attempts.mkdir(mode=0o700)
        self.anchor=parent/"brain-publication-custody.json"
        value={"format":"signalgrid-brain-publication-custody/v1",
               "activation_sha256":hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest()}
        for name,p in [("state",self.state),("mirror",self.mirror),("attempts",attempts)]:
            s=p.stat()
            value[name]={"path":str(p.resolve()),"dev":s.st_dev,"ino":s.st_ino}
        self.anchor.write_text(json.dumps(value,sort_keys=True)+"\n")
        self.anchor.chmod(0o400)
    def jsonlines(self,name):
        p=self.root/name
        return [json.loads(x) for x in p.read_text().splitlines() if x] if p.exists() else []
    def calls(self):
        return self.jsonlines("calls.jsonl")
    def run_step(self):
        source=(REPO/"scripts/mac/lane-tick.sh").read_text()
        a=source.find(START)
        b=source.find(END,a)
        self.assertGreaterEqual(a,0,"The selected existing PR1890 d3 source marker must be present")
        self.assertGreater(b,a,"The actual d3 block must end before heartbeat")
        (self.root/"fixture.json").write_text(json.dumps(self.cfg))
        wrapper = """set -u
DRY=0
RESULT=quiet
SG_VERIFY_LOCK_HELD=0
SG_VERIFY_LOCK_REASON="synthetic host unavailable"
say() { printf '%s\\n' "$1"; }
heartbeat() { printf 'FIXTURE_HEARTBEAT %s\\n' "$RESULT"; }
append_unread_state() { printf 'metadata\\n' >> "$SG_TEST_ROOT/host-events"; }
append_raised_hands_state() { :; }
sg_host_verify_acquire() {
 printf 'acquire\\n' >> "$SG_TEST_ROOT/host-events"
 [ "$SG_TEST_HOST_BUSY" = 0 ] || return 75
 SG_VERIFY_LOCK_HELD=1
}
sg_host_verify_release() { printf 'release\\n' >> "$SG_TEST_ROOT/host-events"; SG_VERIFY_LOCK_HELD=0; }
"""
        wrapper += source[a:b] + '\nprintf "__RESULT__%s\\n" "$RESULT"\n'
        # Only the extracted test copy substitutes account/tool transport seams.
        # Production has no environment override for these trusted functions.
        wrapper=wrapper.replace("try:\n    need(MODE in", "if 'trusted_client' in globals():\n    trusted_client = lambda name: str(Path(os.environ['SG_TEST_ROOT'])/'bin'/name)\n    account_home = lambda: Path(os.environ['SG_TEST_TRUSTED_HOME'])\ntry:\n    need(MODE in")
        # Inject into the extracted Python only, after its parent Bash started.
        # Otherwise BASH_ENV would poison the fixture launcher, not this boundary.
        wrapper=wrapper.replace("    account_home = lambda: Path(os.environ['SG_TEST_TRUSTED_HOME'])", "    account_home = lambda: Path(os.environ['SG_TEST_TRUSTED_HOME'])\n    os.environ.update(json.loads((Path(os.environ['SG_TEST_ROOT'])/'fixture.json').read_text()).get('client_shell_env',{}))\n    _fixture_client_env = client_env\n    def client_env():\n        env = _fixture_client_env()\n        env.update(SG_TEST_ROOT=os.environ['SG_TEST_ROOT'], SIGNALGRID_BRAIN_PUBLICATION_STATE=os.environ['SIGNALGRID_BRAIN_PUBLICATION_STATE'])\n        return env")
        # Scale only the isolated test copy's publication timeout. No production
        # environment flag or model/queue cap is changed or introduced.
        if self.cfg.get("hang_publish"):
            wrapper=wrapper.replace("PUBLICATION_TIMEOUT_SEC = 600", "PUBLICATION_TIMEOUT_SEC = 0.25")
        env={**os.environ,"HOME":str(self.home),"PATH":str(self.bin)+os.pathsep+os.environ["PATH"],
             "SG_TEST_ROOT":str(self.root),"SG_TEST_TRUSTED_HOME":str(self.home),"SG_TEST_HOST_BUSY":"1" if self.host_busy else "0",
             "SIGNALGRID_PUBLISH_MAX":self.cap,"SIGNALGRID_BRAIN_PUBLICATION_STATE":str(self.state)}
        env.update(self.extra_env)
        p=subprocess.run(["/bin/bash","-c",wrapper],cwd=self.work,env=env,capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,0,p.stderr)
        return p.stdout,p.stderr
    def test_explicit_activation_is_required_and_never_self_created(self):
        (self.state/"activation.json").unlink()
        self.run_step()
        self.assertEqual(self.calls(),[])
        self.assertFalse((self.state/"activation.json").exists())
    def test_private_intent_precedes_the_ordinary_cli(self):
        self.run_step()
        self.assertEqual(len(self.calls()),1)
        self.assertEqual(self.calls()[0]["argv"],["scripts/mac/brain-proposal-pr.mjs","--job","freshA","--publish"])
        seen=self.jsonlines("seen-intents.jsonl")
        self.assertTrue(seen[0]["intents"],"Claim must already exist outside Git before the real publication child")
        self.assertFalse(list((self.work/"node_modules").glob(".sg-brain-published-*")))
    def test_invalid_cap_cannot_publish_every_job(self):
        self.cfg["jobs"]=["freshA","freshB","freshC"]
        self.cap="abc"
        self.run_step()
        self.assertLessEqual(len(self.calls()),1)
    def test_failed_attempt_is_not_replayed_after_node_modules_is_lost(self):
        self.cfg["publish_error"]=True
        self.run_step()
        shutil.rmtree(self.work/"node_modules")
        (self.work/"node_modules").mkdir()
        self.run_step()
        self.assertEqual(len(self.calls()),1,"Every selected original attempt remains consumed after failure")
    def test_corrupt_private_state_does_not_fall_back_to_publication(self):
        (self.state/"activation.json").write_text("{broken")
        self.run_step()
        self.assertEqual(self.calls(),[])
    def test_exit_zero_existing_branch_is_not_a_published_PR(self):
        self.cfg["branch_only"]=True
        out,_=self.run_step()
        result=out.split("__RESULT__")[-1].strip()
        self.assertNotIn("published brain job",result)
        self.assertNotIn("verified publication",result)
        self.assertTrue(self.jsonlines("get-calls.jsonl"),"Read-only exact PR lookup is required")
    def test_raw_private_error_never_enters_public_heartbeat_result(self):
        self.cfg["publish_error"]=True
        out,_=self.run_step()
        result=out.split("__RESULT__")[-1].strip()
        self.assertNotIn("PRIVATE_SYNTHETIC",result)
        self.assertNotIn("/var/folders",result)
    def test_unreadable_job_list_is_material_not_quiet(self):
        self.cfg["list_error"]=True
        out,_=self.run_step()
        self.assertFalse(self.calls())
        result=out.split("__RESULT__")[-1].strip()
        self.assertNotEqual(result,"quiet")
        self.assertNotIn("PRIVATE_SYNTHETIC",result)
    def test_busy_host_defers_without_consuming_a_publication_intent(self):
        self.host_busy=True
        self.run_step()
        self.assertFalse(self.calls())
        self.assertFalse([p for p in self.state.rglob("*") if p.is_file() and p.name!="activation.json"])
    def test_publication_uses_a_separate_bounded_host_custody(self):
        self.run_step()
        p=self.root/"host-events"
        events=p.read_text().splitlines() if p.exists() else []
        self.assertIn("acquire",events)
        self.assertIn("release",events)
        self.assertLess(events.index("acquire"),events.index("release"))

    def test_missing_custody_is_not_initialized_by_tick(self):
        self.anchor.unlink()
        self.run_step()
        self.assertEqual(self.calls(),[])
        self.assertFalse(self.anchor.exists())
    def test_lost_attempt_directory_cannot_replay_mirrored_claim(self):
        self.cfg["publish_error"]=True
        self.run_step()
        shutil.rmtree(self.state/"attempts/freshA")
        self.run_step()
        self.assertEqual(len(self.calls()),1)
        self.assertFalse((self.state/"attempts/freshA").exists())
    def test_recreated_state_cannot_reset_external_custody(self):
        self.cfg["publish_error"]=True
        self.run_step()
        activation=(self.state/"activation.json").read_bytes()
        shutil.rmtree(self.state)
        self.state.mkdir(mode=0o700)
        (self.state/"attempts").mkdir(mode=0o700)
        (self.state/"activation.json").write_bytes(activation)
        (self.state/"activation.json").chmod(0o600)
        self.run_step()
        self.assertEqual(len(self.calls()),1)
    def test_exact_public_facts_and_tree_readback_can_verify_publication(self):
        out,_=self.run_step()
        self.assertIn("verified brain publication:",out.split("__RESULT__")[-1])
        endpoints=[c[-1] for c in self.jsonlines("get-calls.jsonl")]
        self.assertTrue(any("/files?" in x for x in endpoints))
        self.assertTrue(any("/git/commits/" in x for x in endpoints))
        events=(self.root/"host-events").read_text().splitlines()
        release=events.index("release")
        self.assertIn("metadata",events[release+1:],"Exact metadata readback follows host release")
    def test_url_and_exit_zero_without_fact_marker_remain_unverified(self):
        self.cfg["no_facts"]=True
        out,_=self.run_step()
        self.assertNotIn("verified publication",out.split("__RESULT__")[-1])
        self.assertEqual(len(self.calls()),1)
    def test_mismatched_public_tree_remains_readback_only(self):
        self.cfg["wrong_tree"]=True
        out,_=self.run_step()
        self.assertNotIn("verified publication",out.split("__RESULT__")[-1])
        self.assertEqual(len(self.calls()),1)
    def test_each_job_releases_host_before_next_admission(self):
        self.cfg["jobs"]=["freshA","freshB"]
        self.cap="2"
        self.run_step()
        self.assertEqual(len(self.calls()),2)
        events=(self.root/"host-events").read_text().splitlines()
        acquisitions=[i for i,x in enumerate(events) if x=="acquire"]
        releases=[i for i,x in enumerate(events) if x=="release"]
        self.assertEqual(len(acquisitions),2)
        self.assertEqual(len(releases),2)
        self.assertLess(acquisitions[0],releases[0])
        self.assertLess(releases[0],acquisitions[1])
        self.assertLess(acquisitions[1],releases[1])

    def test_publisher_source_pin_is_required_even_with_valid_custody(self):
        del self.activation["publisher_sha256"]
        self.write_activation()
        self.anchor.unlink()
        self.mirror.rmdir()
        (self.state/"attempts").rmdir()
        self.bootstrap_custody()
        self.run_step()
        self.assertEqual(self.calls(),[])
    def test_tick_source_drift_refuses_even_with_valid_custody(self):
        self.activation["tick_sha256"]="0"*64
        self.write_activation()
        self.anchor.unlink()
        self.mirror.rmdir()
        (self.state/"attempts").rmdir()
        self.bootstrap_custody()
        self.run_step()
        self.assertEqual(self.calls(),[])

    def test_replaced_stdout_cannot_supply_a_new_fact_marker(self):
        self.cfg["no_facts"]=True
        self.cfg["tamper_raw"]=True
        out,_=self.run_step()
        self.assertTrue((self.root/"tampered").exists())
        self.assertNotIn("verified publication",out.split("__RESULT__")[-1])
        self.assertEqual(len(self.calls()),1)
    def test_changed_completed_stderr_invalidates_publication_proof(self):
        self.cfg["tamper_stderr"]=True
        out,_=self.run_step()
        self.assertTrue((self.root/"tampered").exists())
        self.assertNotIn("verified publication",out.split("__RESULT__")[-1])
        self.assertEqual(len(self.calls()),1)

    def test_imported_source_pins_are_required(self):
        self.activation.pop("dependency_sha256")
        self.write_activation()
        self.anchor.unlink(); self.mirror.rmdir(); (self.state/"attempts").rmdir()
        self.bootstrap_custody()
        self.run_step()
        self.assertEqual(self.calls(),[])

    def test_imported_source_pin_drift_is_refused(self):
        self.activation["dependency_sha256"]["scripts/check-owner-gated-surfaces.mjs"]="0"*64
        self.write_activation()
        self.anchor.unlink(); self.mirror.rmdir(); (self.state/"attempts").rmdir()
        self.bootstrap_custody()
        self.run_step()
        self.assertEqual(self.calls(),[])

    def test_own_timed_out_publication_is_consumed_and_host_released(self):
        self.cfg["hang_publish"]=True
        self.cfg["slow_first_listing"]=True
        out,_=self.run_step()
        terminal=json.loads((self.state/"attempts/freshA/terminal.json").read_text())
        started=json.loads((self.state/"attempts/freshA/started.json").read_text())
        self.assertTrue(terminal.get("timed_out"))
        self.assertFalse(terminal["normal_exit"])
        # Selection time is outside the publication child's deadline. Check that
        # the actual owned child was terminated and reaped, even after slow setup.
        self.assertEqual(terminal["pid"],started["pid"])
        self.assertIn(terminal["returncode"],(-signal.SIGTERM,-signal.SIGKILL))
        self.assertTrue(terminal["original_wait_completed"])
        self.assertIsNone(terminal["started_receipt_error"])
        self.assertEqual(terminal["interruptions"],[])
        self.assertIn("release",(self.root/"host-events").read_text())
        self.assertNotIn("verified publication",out.split("__RESULT__")[-1])
        self.run_step()
        self.assertEqual(len(self.calls()),1)

    def test_job_identifier_does_not_reach_public_heartbeat(self):
        self.cfg["jobs"]=["private_brain-state_marker"]
        out,_=self.run_step()
        self.assertNotIn("private_brain-state_marker",out.split("__RESULT__")[-1])

    def test_partial_claim_is_material_and_never_recreated(self):
        (self.state/"attempts/freshA").mkdir(mode=0o700)
        out,_=self.run_step()
        self.assertEqual(self.calls(),[])
        self.assertIn("custody incomplete",out.split("__RESULT__")[-1])
        self.assertFalse((self.state/"attempts/freshA/intent.json").exists())

    def test_stale_source_refuses_before_any_remote_metadata(self):
        self.cfg["stale_on_preflight"]=True
        self.run_step()
        self.assertEqual(self.calls(),[],"a no-longer-eligible source must not start publication")
        self.assertEqual(self.jsonlines("get-calls.jsonl"),[],"no GitHub query before current clearance")
        self.assertFalse((self.root/"git-calls.log").exists(),"no Git query before current clearance")

    def test_caller_git_and_gh_routing_does_not_cross_client_boundary(self):
        self.extra_env={"GIT_SSH_COMMAND":"synthetic-attacker-command","GIT_CONFIG_GLOBAL":"synthetic-attacker-config",
                        "GH_HOST":"synthetic.invalid","GH_REPO":"synthetic.invalid/other/project","GH_CONFIG_DIR":"synthetic-attacker-gh"}
        out,_=self.run_step()
        self.assertIn("verified brain publication",out)
        contexts=self.jsonlines("client-context.jsonl")
        self.assertTrue(contexts)
        for row in contexts:
            self.assertIsNone(row["env"].get("GIT_SSH_COMMAND"),row)
            if row["client"]=="gh":
                self.assertEqual(row["env"]["GH_HOST"],"github.com")
                self.assertEqual(row["env"]["GH_REPO"],"github.com/DanFashauer/SignalGrid-Review-Hub")
                self.assertEqual(row["env"]["GH_CONFIG_DIR"],str(self.home/".config/gh"))
                self.assertEqual(row["argv"][:3],["api","--hostname","github.com"])

    def test_caller_path_cannot_replace_publication_git(self):
        poisoned=self.root/"poisoned-bin";poisoned.mkdir()
        marker=self.root/"caller-git-executed"
        binary=poisoned/"git"
        binary.write_text("#!/usr/bin/env python3\nfrom pathlib import Path\nPath("+repr(str(marker))+").write_text('executed')\nraise SystemExit(1)\n")
        binary.chmod(0o700)
        self.extra_env["PATH"]=str(poisoned)+os.pathsep+str(self.bin)+os.pathsep+os.environ["PATH"]
        self.run_step()
        self.assertFalse(marker.exists(),"the caller-selected executable actually ran")
        self.assertEqual(len(self.calls()),1,"the trusted fixture transport remains usable")

    def test_local_git_execution_config_refuses_before_publication(self):
        self.cfg["unsafe_local_config"]=True
        self.run_step()
        self.assertEqual(self.calls(),[])
        self.assertEqual(self.jsonlines("get-calls.jsonl"),[])

    def test_shell_startup_and_function_imports_do_not_reach_clients(self):
        self.cfg["client_shell_env"]={"BASH_ENV":"synthetic-startup","ENV":"synthetic-startup",
                                      "SHELLOPTS":"xtrace","BASHOPTS":"extdebug","BASH_FUNC_pnpm%%":"() { return 0; }"}
        self.run_step()
        contexts=self.jsonlines("client-context.jsonl")
        self.assertEqual({x["client"] for x in contexts},{"node","git","gh"})
        for row in contexts:
            self.assertFalse(any(v for k,v in row["env"].items() if k in ("BASH_ENV","ENV","SHELLOPTS","BASHOPTS") or k.startswith("BASH_FUNC_")),row)

    def test_client_environment_prevents_actual_bash_startup_execution(self):
        marker=self.root/"startup-executed";startup=self.root/"startup.sh"
        startup.write_text("printf executed > '"+str(marker).replace("'","'\\''")+"'\n")
        self.cfg["client_shell_env"]={"BASH_ENV":str(startup)}
        self.cfg["probe_shell_startup"]=True
        self.run_step()
        self.assertFalse(marker.exists(),"the actual preflight client executed caller Bash startup")
        self.assertEqual(len(self.calls()),1)

    def test_effective_inherited_push_url_refuses_before_publication(self):
        self.cfg["extra_effective_pushurl"]=True
        self.run_step()
        self.assertEqual(self.calls(),[],"an inherited second push URL must not receive an artifact")
        self.assertEqual(self.jsonlines("get-calls.jsonl"),[])

if __name__=="__main__":
    unittest.main()
