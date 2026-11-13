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
HOST_HELPER = "scripts/mac/host-verification-lock.sh"

MOCK_NODE = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
a = sys.argv[1:]
root = Path(os.environ["SG_TEST_ROOT"])
cfg = json.loads((root/"fixture.json").read_text())
with (root/"client-context.jsonl").open("a") as f:
    keys=["GIT_SSH_COMMAND","BASH_ENV","ENV","SHELLOPTS","BASHOPTS"]+[k for k in os.environ if k.startswith("BASH_FUNC_")]
    f.write(json.dumps({"client":"node","argv":a,"env":{k:os.environ.get(k) for k in keys}})+"\n")
if "--list-review" in a or "--list-prepare" in a:
    if "--list-prepare" in a:
        print("\n".join(cfg.get("prepare_jobs", [])))
        sys.exit(0)
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
if "--job" in a and "--publish" not in a:
    import hashlib
    job=a[a.index("--job")+1]
    with (root/"prepare-calls.jsonl").open("a") as f:
        f.write(json.dumps({"job":job,"argv":a})+"\n")
    if cfg.get("prepare_error"):
        print("PRIVATE_SYNTHETIC /Users/fixture/private-source",file=sys.stderr)
        sys.exit(1)
    title="Synthetic privacy preparation"
    body="Synthetic exact screened public metadata."
    def export(source,text):
        b=text.encode()
        return {"source":source,"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()}
    publisher=Path("scripts/mac/brain-proposal-pr.mjs").resolve()
    request={"format":"signalgrid-publication-privacy-request/v1","job":job,
        "job_sha256":"a"*64,"publisher_sha256":hashlib.sha256(publisher.read_bytes()).hexdigest(),
        "worker_head":"1"*40,"worker_uid":os.getuid(),"patch_sha256":"b"*64,
        "replay_base":"3"*40,"head":"4"*40,"tree":"2"*40,
        "exports":[export("metadata/title.txt",title),export("metadata/body.md",body),
                   export("metadata/commit.txt","Synthetic commit"),
                   export("metadata/paths.json",json.dumps(["docs/x.md"],separators=(",",":"))),
                   export("deleted/docs/x.md.txt","Deleted public path: docs/x.md\n") if cfg.get("prepare_deletion")
                   else export("files/docs/x.md","Synthetic public file\n")]}
    if cfg.get("prepare_missing_paths"):
        request["exports"]=[row for row in request["exports"] if row["source"]!="metadata/paths.json"]
    if cfg.get("prepare_unknown_export"):
        request["exports"].append(export("metadata/unknown.txt","Unknown"))
    if cfg.get("prepare_metadata_only"):
        request["exports"]=[row for row in request["exports"] if row["source"].startswith("metadata/")]
    if cfg.get("prepare_bad_deletion"):
        request["exports"]=[export(row["source"],"Wrong deletion marker") if row["source"].startswith("deleted/") else row
                            for row in request["exports"]]
    request["exports"].sort(key=lambda row:row["source"])
    request_sha=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
    metadata={"format":"signalgrid-publication-prepared-metadata/v1","request_sha256":request_sha,"title":title,"body":body}
    if cfg.get("prepare_bad_digest"): metadata["request_sha256"]="0"*64
    print("SIGNALGRID_PUBLICATION_PRIVACY_REQUEST "+json.dumps(request))
    if cfg.get("prepare_duplicate"): print("SIGNALGRID_PUBLICATION_PRIVACY_REQUEST "+json.dumps(request))
    if not cfg.get("prepare_missing_metadata"):
        print("SIGNALGRID_PUBLICATION_PREPARED_METADATA "+json.dumps(metadata))
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
    if "--file" in a:
        # A physical-file parse is the one thing this fixture does not fake: real Git reads the real file.
        if cfg.get("refuse_physical_config_parse") or not {"--no-includes","--null","--list"} <= set(a): sys.exit(98)
        real=subprocess.run(["/usr/bin/git"]+a,env={"PATH":"/usr/bin:/bin","GIT_CONFIG_GLOBAL":"/dev/null","GIT_CONFIG_NOSYSTEM":"1","HOME":"/nonexistent"},stdin=subprocess.DEVNULL,capture_output=True)
        sys.stdout.buffer.write(real.stdout); sys.exit(real.returncode)
    elif "--list" in a:
        print("remote.origin.url\ngit@github.com:DanFashauer/SignalGrid-Review-Hub.git\0"+("core.sshcommand\nsynthetic-worker-command\0" if cfg.get("unsafe_local_config") else "")+("extensions.worktreeconfig\ntrue\0" if cfg.get("worktree_config_extension") else ""),end="")
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
            "scripts/check-owner-gated-surfaces.mjs", "scripts/lib/is-main.mjs", "scripts/lib/scratch-git.mjs", ".githooks/pre-push", HOST_HELPER)}
        self.write_activation()
        self.bootstrap_custody()
        self.cfg={"jobs":["freshA"]}
        self.cap="1"
        self.host_busy=False
        self.extra_env={}

    def enable_preparation(self):
        self.activation["privacy_preparation_enabled"]=True
        self.write_activation()
        anchor=json.loads(self.anchor.read_text())
        self.anchor.chmod(0o600)  # Only this disposable setup file, before resealing the fixture.
        anchor["activation_sha256"]=hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest()
        for name,path in (("preparations",self.state/"preparations"),("preparation_mirror",self.mirror/"preparations")):
            path.mkdir(mode=0o700)
            s=path.stat()
            anchor[name]={"path":str(path.resolve()),"dev":s.st_dev,"ino":s.st_ino}
        self.anchor.write_text(json.dumps(anchor,sort_keys=True)+"\n")
        self.anchor.chmod(0o400)
        self.cfg={"jobs":[],"prepare_jobs":["freshA"]}

    def test_preparation_makes_private_bound_handoff_without_publication(self):
        self.enable_preparation()
        out,err=self.run_step()
        handoff=self.state/"preparations/freshA/request.json"
        self.assertTrue(handoff.exists(),out+err)
        value=json.loads(handoff.read_text())
        self.assertEqual(value["format"],"signalgrid-brain-privacy-handoff/v1")
        self.assertEqual(value["request"]["job"],"freshA")
        self.assertEqual(value["metadata"]["request_sha256"],value["request_sha256"])
        self.assertEqual(handoff.stat().st_mode & 0o777,0o400)
        self.assertNotIn("source_review",value)
        self.assertNotIn("artifact_review",value)
        self.assertNotIn("approved",value)
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertEqual(self.calls(),[])
        self.assertNotIn("PRIVATE_SYNTHETIC",out+err)
        events=(self.root/"host-events").read_text().splitlines()
        self.assertEqual(events.count("acquire"),1)
        self.assertEqual(events.count("release"),1)


    def test_preparation_failed_started_receipt_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["fail_started_receipt"] = True
        out, err = self.run_step()
        terminal = json.loads((self.state/"preparations/freshA/terminal.json").read_text())
        self.assertEqual(terminal["started_receipt_error"], "OSError")
        self.assertEqual(terminal["returncode"], 0)
        self.assertTrue(terminal["normal_exit"])
        self.assertTrue(terminal["original_wait_completed"])
        self.assertFalse((self.state/"preparations/freshA/started.json").exists())
        self.assertFalse((self.state/"preparations/freshA/request.json").exists(), out + err)
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")), 1)
        self.assertEqual(self.calls(), [])
        events = (self.root/"host-events").read_text().splitlines()
        self.assertEqual(events.count("acquire"), events.count("release"))

    def test_preparation_missing_started_receipt_result_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["remove_started_receipt_result"] = True
        out, err = self.run_step()
        terminal = json.loads((self.state/"preparations/freshA/terminal.json").read_text())
        self.assertNotIn("started_receipt_error", terminal)
        self.assertEqual(terminal["returncode"], 0)
        self.assertTrue(terminal["original_wait_completed"])
        self.assertFalse((self.state/"preparations/freshA/request.json").exists(), out + err)

    def test_preparation_incomplete_original_wait_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["incomplete_preparation_wait"] = True
        out, err = self.run_step()
        terminal = json.loads((self.state/"preparations/freshA/terminal.json").read_text())
        self.assertIsNone(terminal["started_receipt_error"])
        self.assertEqual(terminal["returncode"], 0)
        self.assertFalse(terminal["original_wait_completed"])
        self.assertFalse((self.state/"preparations/freshA/request.json").exists(), out + err)

    def test_preparation_accepts_deleted_path_inventory(self):
        self.enable_preparation()
        self.cfg["prepare_deletion"]=True
        out,err=self.run_step()
        handoff=self.state/"preparations/freshA/request.json"
        self.assertTrue(handoff.exists(),out+err)
        sources={row["source"] for row in json.loads(handoff.read_text())["request"]["exports"]}
        self.assertIn("deleted/docs/x.md.txt",sources)
        self.assertIn("metadata/paths.json",sources)
        self.assertEqual(self.calls(),[])

    def test_preparation_missing_paths_inventory_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_missing_paths"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_unknown_metadata_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_unknown_export"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_metadata_without_changed_path_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_metadata_only"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_changed_deletion_marker_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_deletion"]=True
        self.cfg["prepare_bad_deletion"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_runs_only_once_while_review_is_pending(self):
        self.enable_preparation()
        self.run_step();self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertEqual(self.calls(),[])

    def test_preparation_requires_explicit_activation(self):
        self.cfg={"jobs":[],"prepare_jobs":["freshA"]}
        self.run_step()
        self.assertEqual(self.jsonlines("prepare-calls.jsonl"),[])
        self.assertFalse((self.state/"preparations").exists())

    def test_preparation_defers_busy_host_without_consuming_job(self):
        self.enable_preparation()
        self.host_busy=True
        self.run_step()
        self.assertEqual(self.jsonlines("prepare-calls.jsonl"),[])
        self.assertFalse((self.state/"preparations/freshA").exists())

    def test_failed_preparation_is_consumed_and_private_errors_stay_private(self):
        self.enable_preparation()
        self.cfg["prepare_error"]=True
        out,err=self.run_step()
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())
        self.assertNotIn("PRIVATE_SYNTHETIC",out+err)
        terminal=json.loads((self.state/"preparations/freshA/terminal.json").read_text())
        self.assertEqual(terminal["returncode"],1)

    def test_preparation_bad_digest_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_bad_digest"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_duplicate_marker_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_duplicate"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_missing_metadata_never_creates_review_handoff(self):
        self.enable_preparation()
        self.cfg["prepare_missing_metadata"]=True
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse((self.state/"preparations/freshA/request.json").exists())

    def test_preparation_lost_mirror_is_not_recreated_or_replayed(self):
        self.enable_preparation()
        self.run_step()
        mirror=self.mirror/"preparations/freshA.json"
        self.assertTrue(mirror.exists())
        mirror.unlink()
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
        self.assertFalse(mirror.exists())

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
sg_host_verify_acquire_bounded() {
 printf 'bounded %s\\n' "${2:-}" >> "$SG_TEST_ROOT/host-events"
 sg_host_verify_acquire "$1"
}
"""
        wrapper += source[a:b] + '\nprintf "__RESULT__%s\\n" "$RESULT"\n'
        # Only the extracted test copy substitutes account/tool transport seams.
        # Production has no environment override for these trusted functions.
        wrapper=wrapper.replace("try:\n    need(MODE in", "if 'trusted_client' in globals():\n    trusted_client = lambda name: str(Path(os.environ['SG_TEST_ROOT'])/'bin'/name)\n    account_home = lambda: Path(os.environ['SG_TEST_TRUSTED_HOME'])\ntry:\n    need(MODE in")
        # Inject into the extracted Python only, after its parent Bash started.
        # Otherwise BASH_ENV would poison the fixture launcher, not this boundary.
        wrapper=wrapper.replace("    account_home = lambda: Path(os.environ['SG_TEST_TRUSTED_HOME'])", "    account_home = lambda: Path(os.environ['SG_TEST_TRUSTED_HOME'])\n    os.environ.update(json.loads((Path(os.environ['SG_TEST_ROOT'])/'fixture.json').read_text()).get('client_shell_env',{}))\n    _fixture_client_env = client_env\n    def client_env():\n        env = _fixture_client_env()\n        env.update(SG_TEST_ROOT=os.environ['SG_TEST_ROOT'], SIGNALGRID_BRAIN_PUBLICATION_STATE=os.environ['SIGNALGRID_BRAIN_PUBLICATION_STATE'])\n        return env")
        # Faults affect only this extracted fixture. Exercise the real producer's
        # receipt-error path and the real consumer's persisted-terminal checks.
        if self.cfg.get("fail_started_receipt"):
            wrapper = wrapper.replace("try:\n    need(MODE in",
                "_fixture_write_new = write_new\n"
                "def write_new(path, value):\n"
                "    if path.name == 'started.json':\n"
                "        raise OSError('synthetic start receipt failure')\n"
                "    return _fixture_write_new(path, value)\n"
                "try:\n    need(MODE in")
        if self.cfg.get("remove_started_receipt_result") or self.cfg.get("incomplete_preparation_wait"):
            wrapper = wrapper.replace("try:\n    need(MODE in",
                "_fixture_prepared_request = prepared_request\n"
                "def prepared_request(attempt, intent):\n"
                "    path = attempt / 'terminal.json'\n"
                "    terminal = json.loads(path.read_text())\n"
                "    config = json.loads((Path(os.environ['SG_TEST_ROOT'])/'fixture.json').read_text())\n"
                "    if config.get('remove_started_receipt_result'):\n"
                "        terminal.pop('started_receipt_error')\n"
                "    if config.get('incomplete_preparation_wait'):\n"
                "        terminal['original_wait_completed'] = False\n"
                "    path.chmod(0o600)\n"
                "    path.write_text(json.dumps(terminal))\n"
                "    path.chmod(0o400)\n"
                "    return _fixture_prepared_request(attempt, intent)\n"
                "try:\n    need(MODE in")
        # Scale only the isolated test copy's publication timeout. No production
        # environment flag or model/queue cap is changed or introduced.
        if self.cfg.get("drop_bounded_helper"):
            wrapper=wrapper.replace("sg_host_verify_acquire_bounded() {","unused_fixture_bounded() {",1)
        if self.cfg.get("hang_publish"):
            wrapper=wrapper.replace("PUBLICATION_TIMEOUT_SEC = 600", "PUBLICATION_TIMEOUT_SEC = 0.25")
        env={**os.environ,"HOME":str(self.home),"PATH":str(self.bin)+os.pathsep+os.environ["PATH"],
             "SG_TEST_ROOT":str(self.root),"SG_TEST_TRUSTED_HOME":str(self.home),"SG_TEST_HOST_BUSY":"1" if self.host_busy else "0",
             "SIGNALGRID_PUBLISH_MAX":self.cap,"SIGNALGRID_BRAIN_PUBLICATION_STATE":str(self.state),
             # The tick records the digest of the helper it actually sourced; the fixture sources this checkout's.
             "SG_VERIFY_HELPER_SHA256":hashlib.sha256((REPO/HOST_HELPER).read_bytes()).hexdigest()}
        env.update(self.extra_env)
        for name in [key for key,value in env.items() if value is None]:
            del env[name]
        p=subprocess.run(["/bin/bash","-c",wrapper],cwd=self.work,env=env,capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,0,p.stderr)
        return p.stdout,p.stderr
    # ── bounded ordinary admission on the two publication acquisitions, and the sourced helper binding ──
    def bootstrap_custody_again(self):
        # Reseal only this disposable fixture anchor after its activation fixture was rewritten.
        anchor=json.loads(self.anchor.read_text()); self.anchor.chmod(0o600)
        anchor["activation_sha256"]=hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest()
        self.anchor.write_text(json.dumps(anchor,sort_keys=True)+"\n"); self.anchor.chmod(0o400)
    def host_events(self):
        # Host admission events only; the fixture's unrelated heartbeat "metadata" marker shares the file.
        p=self.root/"host-events"
        return [e for e in p.read_text().splitlines() if e!="metadata"] if p.exists() else []
    def state_files(self):
        return sorted(str(p.relative_to(self.state)) for p in self.state.rglob("*") if p.is_file() and p.name!="activation.json")
    def test_publication_admission_waits_a_bounded_ninety_seconds(self):
        out,_=self.run_step()
        self.assertEqual([e for e in self.host_events() if e.startswith("bounded")],["bounded 90"])
        self.assertEqual(len(self.calls()),1,out)
    def test_preparation_admission_waits_a_bounded_ninety_seconds(self):
        self.enable_preparation()
        self.run_step()
        self.assertEqual([e for e in self.host_events() if e.startswith("bounded")],["bounded 90"])
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
    def test_still_busy_after_the_bounded_wait_keeps_the_existing_defer(self):
        self.host_busy=True
        out,_=self.run_step()
        self.assertIn("brain publication deferred: host busy or unavailable",out)
        self.assertEqual(self.host_events(),["bounded 90","acquire"])
        self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[])
        self.enable_preparation(); (self.root/"host-events").unlink()
        out,_=self.run_step()
        self.assertIn("privacy request preparation deferred: host busy or unavailable",out)
        self.assertEqual(self.jsonlines("prepare-calls.jsonl"),[])
        self.assertFalse((self.state/"preparations/freshA").exists())
    def test_a_tick_without_the_bounded_helper_defers_instead_of_falling_back(self):
        # An older sourced helper has no bounded function: the tick must defer, never use another admission.
        self.cfg["drop_bounded_helper"]=True
        out,_=self.run_step()
        self.assertIn("brain publication deferred: host busy or unavailable",out)
        self.assertEqual(self.host_events(),[]); self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[])
    def test_sourced_helper_that_differs_from_the_bound_dependency_refuses_before_any_claim(self):
        for label,value in (("drifted","0"*64),("absent",None),("malformed","not-a-digest")):
            with self.subTest(sourced=label):
                p=self.root/"host-events"
                if p.exists(): p.unlink()
                self.extra_env={"SG_VERIFY_HELPER_SHA256":value}
                out,_=self.run_step()
                self.assertIn("brain publication unavailable",out)
                self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[],"Nothing may be claimed or consumed")
                self.assertEqual(self.host_events(),["bounded 90","acquire","release"],"Own admission is released; no other holder is touched")
        self.extra_env={"SG_VERIFY_HELPER_SHA256":"0"*64}
        self.enable_preparation(); (self.root/"host-events").unlink()
        out,_=self.run_step()
        self.assertIn("privacy request preparation unavailable",out)
        self.assertEqual(self.jsonlines("prepare-calls.jsonl"),[])
        self.assertFalse((self.state/"preparations/freshA").exists())
    def test_activation_must_bind_the_host_helper_with_the_other_dependencies(self):
        self.activation["dependency_sha256"].pop(HOST_HELPER); self.write_activation(); self.bootstrap_custody_again()
        self.run_step()
        self.assertEqual(self.calls(),[]); self.assertEqual(self.host_events(),[])
    def test_activation_bound_to_other_helper_bytes_is_refused(self):
        self.activation["dependency_sha256"][HOST_HELPER]="0"*64; self.write_activation(); self.bootstrap_custody_again()
        self.run_step()
        self.assertEqual(self.calls(),[]); self.assertEqual(self.host_events(),[])
    def test_private_intent_records_the_host_helper_reference(self):
        self.run_step()
        intents=[json.loads(p.read_text()) for p in self.state.rglob("intent.json")]
        self.assertEqual(len(intents),1)
        self.assertEqual(intents[0]["dependency_refs"][HOST_HELPER]["sha256"],hashlib.sha256((REPO/HOST_HELPER).read_bytes()).hexdigest())
        self.assertEqual(len(intents[0]["dependency_refs"]),5)

    # ── per-worktree configuration on the canonical checkout: the physical file is validated, never trusted ──
    INERT_WORKTREE_CONFIG="[codex]\n\tlocalEnvironmentConfigPath = __none__\n"
    def canonical_worktree_config(self,content=None,*,shape=None,extension=True):
        """The fixture checkout as a real main worktree directory, with or without its own config.worktree."""
        self.cfg["worktree_config_extension"]=extension
        admin=self.work/".git"
        if not admin.exists(): admin.mkdir(mode=0o700)
        path=admin/"config.worktree"
        if shape is not None: shape(path)
        elif content is not None:
            path.write_text(content); path.chmod(0o600)
        return path
    def git_argvs(self):
        p=self.root/"git-calls.log"
        return [eval(line) for line in p.read_text().splitlines()] if p.exists() else []
    def physical_parses(self):
        return [a for a in self.git_argvs() if "--file" in a]
    def test_extension_enabled_checkout_without_a_per_worktree_file_still_publishes(self):
        self.canonical_worktree_config()
        out,_=self.run_step()
        self.assertEqual(len(self.calls()),1,out)
        self.assertEqual(self.physical_parses(),[],"No file, so nothing is parsed")
    def test_extension_enabled_checkout_with_the_one_inert_application_key_publishes(self):
        path=self.canonical_worktree_config(self.INERT_WORKTREE_CONFIG)
        before=path.read_bytes()
        out,_=self.run_step()
        self.assertEqual(len(self.calls()),1,out)
        self.assertEqual(path.read_bytes(),before,"The tick never edits the per-worktree file")
        parses=self.physical_parses()
        self.assertTrue(parses,"The physical file was actually parsed")
        for argv in parses:
            self.assertEqual(argv[argv.index("--file")+1],str(path.resolve()))
            self.assertTrue({"--no-includes","--null","--list"} <= set(argv),"Parsed with includes disabled")
    def test_extension_enabled_checkout_prepares_with_the_inert_key(self):
        self.enable_preparation()
        self.canonical_worktree_config(self.INERT_WORKTREE_CONFIG)
        self.run_step()
        self.assertEqual(len(self.jsonlines("prepare-calls.jsonl")),1)
    def test_any_other_per_worktree_content_refuses_before_admission(self):
        program="/usr/bin/false"
        cases={"include":"[include]\n\tpath = /etc/hosts\n","conditional include":'[includeIf "gitdir:/"]\n\tpath = /etc/hosts\n',
               "filter":'[filter "late"]\n\tclean = '+program+"\n","text conversion":'[diff "late"]\n\ttextconv = '+program+"\n",
               "fsmonitor":"[core]\n\tfsmonitor = "+program+"\n","ssh command":"[core]\n\tsshCommand = "+program+"\n",
               "hooks path":"[core]\n\thooksPath = /tmp\n","core.worktree":"[core]\n\tworktree = /tmp\n","core.bare":"[core]\n\tbare = true\n",
               "partial clone extension":"[extensions]\n\tpartialClone = origin\n","credential helper":"[credential]\n\thelper = "+program+"\n",
               "unknown key":"[user]\n\tname = Synthetic\n","other application key":"[codex]\n\tother = 1\n",
               "inert key plus another":self.INERT_WORKTREE_CONFIG+"[user]\n\tname = Synthetic\n",
               "other value":"[codex]\n\tlocalEnvironmentConfigPath = /etc/passwd\n","empty value":"[codex]\n\tlocalEnvironmentConfigPath =\n",
               "inert key twice":self.INERT_WORKTREE_CONFIG*2,"unparseable":"[codex\n\tlocalEnvironmentConfigPath = __none__\n","empty file":""}
        for label,content in cases.items():
            with self.subTest(content=label):
                for name in ("host-events","git-calls.log"):
                    if (self.root/name).exists(): (self.root/name).unlink()
                path=self.canonical_worktree_config(content)
                out,_=self.run_step()
                self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[],"Nothing claimed or consumed")
                self.assertEqual(self.host_events(),[],"Refused before any host admission")
                self.assertIn("brain publication",out)
                path.unlink()
    def test_unsafe_per_worktree_file_shapes_refuse(self):
        target=self.root/"inert-target"; target.write_text(self.INERT_WORKTREE_CONFIG)
        def symlink(p): p.symlink_to(target)
        def directory(p): p.mkdir()
        def unreadable(p): p.write_text(self.INERT_WORKTREE_CONFIG); p.chmod(0o000)
        def group_writable(p): p.write_text(self.INERT_WORKTREE_CONFIG); p.chmod(0o660)
        def hard_linked(p): p.write_text(self.INERT_WORKTREE_CONFIG); p.chmod(0o600); os.link(p,self.root/"second-link")
        for shape in (symlink,directory,unreadable,group_writable,hard_linked):
            with self.subTest(shape=shape.__name__):
                if (self.root/"host-events").exists(): (self.root/"host-events").unlink()
                path=self.canonical_worktree_config(shape=shape)
                self.run_step()
                self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[]); self.assertEqual(self.host_events(),[])
                if path.is_dir() and not path.is_symlink(): path.rmdir()
                else:
                    if not path.is_symlink(): path.chmod(0o600)
                    path.unlink()
                if (self.root/"second-link").exists(): (self.root/"second-link").unlink()
    def test_a_failed_physical_parse_refuses_instead_of_assuming_inert(self):
        self.canonical_worktree_config(self.INERT_WORKTREE_CONFIG)
        self.cfg["refuse_physical_config_parse"]=True
        self.run_step()
        self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[])
    def test_other_dangerous_local_configuration_still_refuses_beside_an_inert_file(self):
        self.canonical_worktree_config(self.INERT_WORKTREE_CONFIG)
        self.cfg["unsafe_local_config"]=True
        self.run_step()
        self.assertEqual(self.calls(),[]); self.assertEqual(self.state_files(),[])
    def test_without_the_extension_a_stray_per_worktree_file_is_not_read_and_publication_proceeds(self):
        # Git itself ignores config.worktree when the extension is not set, so the tick does not parse it either.
        self.canonical_worktree_config("[core]\n\tfsmonitor = /usr/bin/false\n",extension=False)
        out,_=self.run_step()
        self.assertEqual(len(self.calls()),1,out); self.assertEqual(self.physical_parses(),[])
    def test_the_tick_never_relies_on_a_command_line_extension_override(self):
        self.canonical_worktree_config(self.INERT_WORKTREE_CONFIG)
        self.run_step()
        flat=" ".join(" ".join(a) for a in self.git_argvs()).lower()
        self.assertNotIn("extensions.worktreeconfig=",flat,"Git ignores that override; relying on it would be isolation in name only")

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

    # ── a consumed claim from an earlier activation epoch: skipped as readback-only, never current ──
    # After a real attempt, a source-only activation refresh leaves the old claim bound to the earlier
    # activation bytes. It is not current authorization, and it is not damaged custody either: it must
    # be passed over so later jobs can run. The refresh modelled here is the one that really happened:
    # SAME activation identifier, SAME cutover, same account and custody directories; only the pinned
    # tick source bytes, its digest in the activation, and therefore the activation digest change.
    def refresh_epoch(self):
        revised=self.root/"tick-revision"
        (revised/"scripts/mac").mkdir(parents=True,exist_ok=True)
        tick=revised/"scripts/mac/lane-tick.sh"
        # A harmless trailing comment on the PINNED copy only; the executed d3 text is still this checkout's.
        tick.write_bytes((REPO/"scripts/mac/lane-tick.sh").read_bytes()+b"# fixture-only harmless source revision\n")
        self.extra_env={**self.extra_env,"REPO_ROOT":str(revised)}
        identity=(self.activation["activation_id"],self.activation["not_before"])
        before=hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest()
        self.activation["tick_sha256"]=hashlib.sha256(tick.read_bytes()).hexdigest()
        self.write_activation(); self.bootstrap_custody_again()
        self.assertEqual((self.activation["activation_id"],self.activation["not_before"]),identity)
        self.assertNotEqual(before,hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest())
    def custody_snapshot(self,*paths):
        found={}
        for base in paths:
            for q in ([base] if base.is_file() else sorted(base.rglob("*"))):
                st=q.lstat()
                found[str(q)]=(st.st_ino,st.st_mode,hashlib.sha256(q.read_bytes()).hexdigest() if q.is_file() else None)
        self.assertTrue(found,"The old claim must exist before it can be compared")
        return found
    def jobs_called(self,name):
        return [c["job"] for c in self.jsonlines(name)]
    def rewrite_private_json(self,path,change):
        # Only this disposable fixture's own custody file, to model damage; production never rewrites one.
        value=json.loads(path.read_text()); change(value)
        path.chmod(0o600); path.write_text(json.dumps(value)); path.chmod(0o400)
    def result_line(self,out):
        return out.split("__RESULT__")[-1]

    def test_old_epoch_failed_preparation_is_skipped_and_a_fresh_job_prepares(self):
        self.enable_preparation(); self.cfg["prepare_error"]=True
        self.run_step()
        old=(self.state/"preparations/freshA",self.mirror/"preparations/freshA.json")
        before=self.custody_snapshot(*old)
        self.refresh_epoch()
        self.cfg={"jobs":[],"prepare_jobs":["freshA","freshB","freshC"]}
        out,err=self.run_step()
        self.assertEqual(self.jobs_called("prepare-calls.jsonl"),["freshA","freshB"],"One original call per old ID; the next fresh job proceeds")
        self.assertTrue((self.state/"preparations/freshB/request.json").exists(),out+err)
        self.assertFalse((self.state/"preparations/freshC").exists(),"The per-tick budget is unchanged")
        self.assertEqual(self.custody_snapshot(*old),before,"Old bytes, modes and inodes are untouched")
        self.assertNotIn("custody incomplete",self.result_line(out))
        self.assertEqual(self.calls(),[])
        fresh=json.loads((self.state/"preparations/freshB/intent.json").read_text())
        self.assertEqual(fresh["activation_ref"]["sha256"],hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest())
        self.assertEqual(fresh["tick_ref"]["sha256"],self.activation["tick_sha256"])
        self.assertNotEqual(json.loads((old[0]/"intent.json").read_text())["tick_ref"]["sha256"],self.activation["tick_sha256"])
        out,_=self.run_step()
        self.assertEqual(self.jobs_called("prepare-calls.jsonl"),["freshA","freshB","freshC"],"A later tick still never replays the old ID")
        self.assertEqual(self.custody_snapshot(*old),before)

    def test_old_epoch_prepared_handoff_is_not_adopted_or_remade(self):
        self.enable_preparation()
        self.run_step()
        old=(self.state/"preparations/freshA",self.mirror/"preparations/freshA.json")
        self.assertTrue((old[0]/"request.json").exists())
        before=self.custody_snapshot(*old)
        self.refresh_epoch()
        self.cfg={"jobs":[],"prepare_jobs":["freshA","freshB"]}
        out,err=self.run_step()
        self.assertEqual(self.jobs_called("prepare-calls.jsonl"),["freshA","freshB"],out+err)
        self.assertEqual(self.custody_snapshot(*old),before,"The old request is neither rebound nor rewritten")
        self.assertEqual(self.calls(),[],"This preparation-only fixture lists no review job, so it makes no publication call")
        self.assertEqual(json.loads((old[0]/"intent.json").read_text())["activation_ref"]["sha256"]==hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest(),False)
        self.assertNotIn("custody incomplete",self.result_line(out))

    def test_old_epoch_failed_publication_is_skipped_and_a_fresh_job_publishes(self):
        self.cfg["publish_error"]=True
        self.run_step()
        old=(self.state/"attempts/freshA",self.mirror/"freshA.json")
        before=self.custody_snapshot(*old)
        self.refresh_epoch()
        self.cfg={"jobs":["freshA","freshB","freshC"]}
        out,err=self.run_step()
        self.assertEqual(self.jobs_called("calls.jsonl"),["freshA","freshB"],out+err)
        self.assertFalse((self.state/"attempts/freshC").exists(),"The per-tick budget is unchanged")
        self.assertEqual(self.custody_snapshot(*old),before)
        self.assertNotIn("custody incomplete",self.result_line(out))
        fresh=json.loads((self.state/"attempts/freshB/intent.json").read_text())
        self.assertEqual(fresh["activation_ref"]["sha256"],hashlib.sha256((self.state/"activation.json").read_bytes()).hexdigest())

    def test_old_epoch_publication_claim_blocks_a_new_preparation_of_the_same_job(self):
        self.cfg["publish_error"]=True
        self.run_step()
        self.enable_preparation(); self.refresh_epoch()
        self.cfg={"jobs":[],"prepare_jobs":["freshA","freshB"]}
        self.run_step()
        self.assertEqual(self.jobs_called("prepare-calls.jsonl"),["freshB"],"A job consumed by publication in any epoch is never prepared again")
        self.assertFalse((self.state/"preparations/freshA").exists())

    DAMAGED_OLD_CLAIMS=(
        ("mirror lost", lambda t,d,m: m.unlink()),
        ("mirror differs from the intent", lambda t,d,m: t.rewrite_private_json(m,lambda v: v.__setitem__("created_at","1999-01-01T00:00:00Z"))),
        ("intent names another job", lambda t,d,m: [t.rewrite_private_json(q,lambda v: v.__setitem__("job_id","otherJob")) for q in (m,d/"intent.json")]),
        ("activation reference absent", lambda t,d,m: [t.rewrite_private_json(q,lambda v: v.pop("activation_ref")) for q in (m,d/"intent.json")]),
        ("activation reference is not a record", lambda t,d,m: [t.rewrite_private_json(q,lambda v: v.__setitem__("activation_ref","0"*64)) for q in (m,d/"intent.json")]),
        ("activation digest malformed", lambda t,d,m: [t.rewrite_private_json(q,lambda v: v["activation_ref"].__setitem__("sha256","not-a-digest")) for q in (m,d/"intent.json")]),
        ("intent missing", lambda t,d,m: (d/"intent.json").unlink()),
    )
    def test_damaged_old_epoch_preparation_claims_still_stop_the_loop(self):
        cases=self.DAMAGED_OLD_CLAIMS+(("attempt directory replaced", lambda t,d,m: (shutil.copytree(d,d.with_name("copy")),shutil.rmtree(d),d.with_name("copy").rename(d))),)
        for label,damage in cases:
            with self.subTest(damage=label):
                self.tearDown(); self.setUp()
                self.enable_preparation(); self.cfg["prepare_error"]=True
                self.run_step(); self.refresh_epoch()
                damage(self,self.state/"preparations/freshA",self.mirror/"preparations/freshA.json")
                self.cfg={"jobs":[],"prepare_jobs":["freshA","freshB"]}
                out,_=self.run_step()
                self.assertIn("custody incomplete",self.result_line(out))
                self.assertEqual(self.jobs_called("prepare-calls.jsonl"),["freshA"],"Nothing is replayed and nothing later runs")
                self.assertFalse((self.state/"preparations/freshB").exists())
    def test_damaged_old_epoch_publication_claims_still_stop_the_loop(self):
        for label,damage in self.DAMAGED_OLD_CLAIMS:
            with self.subTest(damage=label):
                self.tearDown(); self.setUp()
                self.cfg["publish_error"]=True
                self.run_step(); self.refresh_epoch()
                damage(self,self.state/"attempts/freshA",self.mirror/"freshA.json")
                self.cfg={"jobs":["freshA","freshB"]}
                out,_=self.run_step()
                self.assertIn("custody incomplete",self.result_line(out))
                self.assertEqual(self.jobs_called("calls.jsonl"),["freshA"])
                self.assertFalse((self.state/"attempts/freshB").exists())

    # A publication claim must be a publication intent, and a damaged one is never passed over by
    # the preparation side either: both preflights read the same consumed identity or report it.
    FORMAT_DAMAGED_PUBLICATION_CLAIMS=(
        ("publication format absent", lambda t,d,m: [t.rewrite_private_json(q,lambda v: v.pop("format")) for q in (m,d/"intent.json")]),
        ("another record's format", lambda t,d,m: [t.rewrite_private_json(q,lambda v: v.__setitem__("format","signalgrid-brain-privacy-preparation-intent/v1")) for q in (m,d/"intent.json")]),
    )
    def test_old_epoch_publication_claim_without_the_publication_format_still_stops_the_loop(self):
        for label,damage in self.FORMAT_DAMAGED_PUBLICATION_CLAIMS:
            with self.subTest(damage=label):
                self.tearDown(); self.setUp()
                self.cfg["publish_error"]=True
                self.run_step(); self.refresh_epoch()
                self.assertEqual(json.loads((self.mirror/"freshA.json").read_text())["format"],"signalgrid-brain-publication-intent/v1")
                damage(self,self.state/"attempts/freshA",self.mirror/"freshA.json")
                self.cfg={"jobs":["freshA","freshB"]}
                out,_=self.run_step()
                self.assertIn("custody incomplete",self.result_line(out))
                self.assertEqual(self.jobs_called("calls.jsonl"),["freshA"])
                self.assertFalse((self.state/"attempts/freshB").exists())
    def test_damaged_publication_claim_stops_preparation_of_later_jobs(self):
        for label,damage in self.DAMAGED_OLD_CLAIMS+self.FORMAT_DAMAGED_PUBLICATION_CLAIMS:
            with self.subTest(damage=label):
                self.tearDown(); self.setUp()
                self.cfg["publish_error"]=True
                self.run_step()
                self.enable_preparation(); self.refresh_epoch()
                damage(self,self.state/"attempts/freshA",self.mirror/"freshA.json")
                self.cfg={"jobs":[],"prepare_jobs":["freshA","freshB"]}
                out,_=self.run_step()
                self.assertIn("custody incomplete",self.result_line(out))
                self.assertEqual(self.jobs_called("prepare-calls.jsonl"),[],"Nothing is prepared past damaged publication custody")
                self.assertFalse((self.state/"preparations/freshA").exists())
                self.assertFalse((self.state/"preparations/freshB").exists())

    def test_old_epoch_claim_under_moved_custody_directories_is_not_skipped(self):
        # A refresh that does not keep the same custody namespace is not the bounded case: nothing proceeds.
        self.cfg["publish_error"]=True
        self.run_step(); self.refresh_epoch()
        anchor=json.loads(self.anchor.read_text()); self.anchor.chmod(0o600)
        anchor["attempts"]["ino"]+=1
        self.anchor.write_text(json.dumps(anchor,sort_keys=True)+"\n"); self.anchor.chmod(0o400)
        self.cfg={"jobs":["freshA","freshB"]}
        self.run_step()
        self.assertEqual(self.jobs_called("calls.jsonl"),["freshA"])
        self.assertFalse((self.state/"attempts/freshB").exists())


class HostAdmissionHelperBehaviour(unittest.TestCase):
    """The REAL sourced helper against a disposable lock file: real flock, real holder process, no fixture stubs."""
    HELPER=REPO/HOST_HELPER
    HOLDER="import fcntl,os,sys,time\nfd=os.open(sys.argv[1],os.O_RDWR|os.O_CREAT,0o600)\nfcntl.flock(fd,fcntl.LOCK_EX)\nopen(sys.argv[2]+'.held','w').close()\ntime.sleep(float(sys.argv[3]))\nopen(sys.argv[2]+'.released-by-self','w').close()\n"
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="host-admission-"); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.lock=self.root/"cache"/"host-verification.lock"
        self.lock.parent.mkdir(); self.lock.touch(); self.inode=self.lock.stat().st_ino
    def hold(self,seconds):
        marker=str(self.root/"holder")
        p=subprocess.Popen(["/usr/bin/python3","-I","-c",self.HOLDER,str(self.lock),marker,str(seconds)])
        self.addCleanup(p.wait)
        for _ in range(100):
            if Path(marker+".held").exists(): return p,marker
            import time; time.sleep(0.05)
        self.fail("fixture holder never acquired")
    def shell(self,body,timeout=20):
        import time
        started=time.monotonic()
        p=subprocess.run(["/bin/bash","-c",'set -u\n. "$1"\n'+body,"bash",str(self.HELPER),str(self.lock)],capture_output=True,text=True,timeout=timeout)
        return p.stdout.split(),time.monotonic()-started,p
    ACQUIRE='sg_host_verify_acquire_bounded "$2" %s; rc=$?; echo "$rc" "$SG_VERIFY_LOCK_HELD"\n'
    PROBE='sg_host_verify_release; sg_host_verify_acquire "$2"; echo "$?"\n'
    def test_free_lock_is_admitted_at_once_and_positively_released(self):
        out,elapsed,_=self.shell(self.ACQUIRE%90+self.PROBE)
        self.assertEqual(out,["0","1","0"]); self.assertLess(elapsed,3)
        self.assertEqual(self.lock.stat().st_ino,self.inode)
    def test_busy_then_released_within_the_bound_is_admitted_without_touching_the_holder(self):
        holder,marker=self.hold(1.5)
        out,elapsed,_=self.shell(self.ACQUIRE%20)
        self.assertEqual(out,["0","1"]); self.assertGreater(elapsed,1.0); self.assertLess(elapsed,12)
        self.assertEqual(holder.wait(timeout=10),0,"The other holder ended by itself")
        self.assertTrue(Path(marker+".released-by-self").exists())
        self.assertEqual(self.lock.stat().st_ino,self.inode,"Same canonical inode; never unlinked or replaced")
    def test_still_busy_at_the_bound_returns_the_existing_busy_code_and_leaves_the_holder_running(self):
        holder,marker=self.hold(5)
        out,elapsed,_=self.shell(self.ACQUIRE%2+'echo "$SG_VERIFY_LOCK_REASON"\n')
        self.assertEqual(out[:2],["75","0"]); self.assertIn("holds",out)
        self.assertGreaterEqual(elapsed,2.0); self.assertLess(elapsed,4.8)
        self.assertIsNone(holder.poll(),"The other holder was not signalled or ended")
        self.assertFalse(Path(marker+".released-by-self").exists())
        self.assertEqual(holder.wait(timeout=15),0); self.assertEqual(self.lock.stat().st_ino,self.inode)
    def test_invalid_custody_is_refused_at_once_without_retrying(self):
        blocked=self.root/"not-a-directory"; blocked.write_text("x")
        import time
        started=time.monotonic()
        p=subprocess.run(["/bin/bash","-c",'. "$1"\nsg_host_verify_acquire_bounded "$2" 90 2>/dev/null; echo "$?" "$SG_VERIFY_LOCK_HELD"\n',"bash",str(self.HELPER),str(blocked/"child"/"lock")],capture_output=True,text=True,timeout=20)
        self.assertEqual(p.stdout.split(),["2","0"]); self.assertLess(time.monotonic()-started,3,"A custody failure is not waited on")
    def test_invalid_or_larger_bound_is_refused_and_nothing_is_acquired(self):
        for bound in ("abc","''","91","-1","1.5","9999"):
            with self.subTest(bound=bound):
                out,elapsed,_=self.shell((self.ACQUIRE%bound)+'sg_host_verify_acquire "$2"; echo "$?"\n')
                self.assertEqual(out,["2","0","0"],"Refused, nothing held, and the lock was still free"); self.assertLess(elapsed,3)
    def test_zero_bound_is_the_existing_single_attempt(self):
        holder,_=self.hold(1.2)
        out,elapsed,_=self.shell(self.ACQUIRE%0)
        self.assertEqual(out,["75","0"]); self.assertLess(elapsed,1.0)
        self.assertEqual(holder.wait(timeout=10),0)
    def test_existing_single_attempt_caller_is_unchanged(self):
        holder,_=self.hold(1.2)
        out,elapsed,_=self.shell('sg_host_verify_acquire "$2"; echo "$?" "$SG_VERIFY_LOCK_HELD"\n')
        self.assertEqual(out,["75","0"]); self.assertLess(elapsed,1.0,"Every other caller keeps the immediate defer")
        self.assertEqual(holder.wait(timeout=10),0)

if __name__=="__main__":
    unittest.main()
