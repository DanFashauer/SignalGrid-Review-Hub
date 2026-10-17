#!/usr/bin/env python3
# review-wave-verdict.py <journal.jsonl> <wave> [out_dir] [--prs 1444,1445]  |  review-wave-verdict.py --self-test  -> writes c<PR>w<wave>.md per PR from the review-wave journal
# FAIL-CLOSED (DR-054: a workflow surfaces a dead agent, it never filters it away). A reviewer or refuter that is missing, null, dead (failed, or started and never returned), blocked or schema-invalid makes that PR's verdict
# `blocked`, never ship: the file names the agent and why, the DR-037 landing sentence is not written, and the exit code is 2. --prs lists the PRs the wave was GIVEN, so one whose reviewer never started still gets a row.
# No refute ran is fine ("by routing") except behind a ship on a SAFETY_MACHINERY, DECISION_PATH or OWNER_RESERVED tier, which cannot land without one.
import json, sys, re, os
VERDICTS = ("ship", "fix-needed", "owner-decision")
KEYS = {"review": {"verdict": str, "head_verified": str, "tier": str, "gating": str, "merge_tree_clean": bool, "threads_unresolved": int, "body_truthful": bool, "prior_round_addressed": str, "findings": list, "commands_run": list, "summary": str, "blocked": bool},
        "refute": {"upheld": bool, "counter_verdict": str, "counter_findings": list, "commands_run": list, "summary": str, "blocked": bool}}
def judge(kind, a):  # ("ok" | "absent" | "bad", why) for one agent's journal entry; a is None when it never started
    if a is None: return "absent", "DEAD: it never started (not in the journal)"
    v = a["result"]
    if a["failed"] or v is None: return "bad", "DEAD: the journal records it failed" if a["failed"] else "DEAD: it started and returned no result (null)"
    miss = [k for k, t in KEYS[kind].items() if not isinstance(v.get(k) if isinstance(v, dict) else None, t) or (t is int and isinstance(v[k], bool))]
    if miss or not isinstance(v, dict): return "bad", "INVALID: missing or mistyped " + ", ".join(miss or ["the whole object"])
    if v["verdict" if kind == "review" else "counter_verdict"] not in VERDICTS: return "bad", "INVALID: verdict is not one of " + "/".join(VERDICTS)
    return ("bad", "BLOCKED: " + str(v.get("blocked_reason") or "no reason given")) if v["blocked"] else ("ok", "")
def selftest():
    import subprocess, tempfile
    rv = lambda v="ship", tier="docs only", **kw: {"verdict": v, "head_verified": "h", "tier": tier, "gating": "g", "merge_tree_clean": True, "threads_unresolved": 0, "body_truthful": True, "prior_round_addressed": "n/a", "findings": [], "commands_run": [], "summary": "s", "blocked": False, **kw}
    rf = lambda up=True, cv="ship", **kw: {"upheld": up, "counter_verdict": cv, "counter_findings": [], "commands_run": [], "summary": "s", "blocked": False, **kw}
    def journal(a, b):  # "-": never started; "dead": started, no result; "failed": a failed row; "null": a null result; else the result object
        rows = [{"type": "launched"}]
        for kind, v in (("review", a), ("refute", b)):
            if v == "-": continue
            k = "v2:" + kind; rows.append({"type": "started", "key": k, "agentId": kind, "label": kind + ":#7 r1", "phase": kind})
            if v == "failed": rows.append({"type": "failed", "key": k, "agentId": kind})
            elif v != "dead": rows.append({"type": "result", "key": k, "agentId": kind, "result": None if v == "null" else v})
        return rows
    SM = "SAFETY_MACHINERY (owner-gated)"
    bad_rv = rv(); del bad_rv["summary"]
    cases = [  # name, reviewer, refuter, verdict, who the blocked file must name
        ("reviewer dead", "dead", rf(), "blocked", ["reviewer", "DEAD"]), ("reviewer null result", "null", rf(), "blocked", ["reviewer", "DEAD"]), ("reviewer schema-invalid", bad_rv, rf(), "blocked", ["reviewer", "INVALID"]),
        ("refuter dead (failed row)", rv(), "failed", "blocked", ["refuter", "DEAD"]), ("refuter dead (no result)", rv(), "dead", "blocked", ["refuter", "DEAD"]),
        ("both blocked", rv(blocked=True, blocked_reason="usage limit"), rf(blocked=True, blocked_reason="usage limit"), "blocked", ["reviewer", "refuter", "usage limit"]),
        ("reviewer ship + refuter fix-needed", rv(), rf(False, "fix-needed"), "fix-needed", []), ("reviewer ship + refuter ship", rv(), rf(), "ship", []),
        ("reviewer fix-needed + refuter absent by routing (docs only)", rv("fix-needed"), "-", "fix-needed", []), ("reviewer ship + refuter absent by routing, docs only", rv(), "-", "ship", []),
        ("reviewer ship + refuter absent by routing, SAFETY_MACHINERY", rv(tier=SM), "-", "blocked", ["refuter"]), ("refuter upheld but counter-verdict differs", rv(), rf(True, "fix-needed"), "blocked", ["refuter"]),
    ]
    def run(rows, *extra):
        with tempfile.TemporaryDirectory() as d:
            jp = os.path.join(d, "j.jsonl"); open(jp, "w").write("\n".join(json.dumps(r) for r in rows) + "\n")
            p = subprocess.run([sys.executable, "-I", os.path.abspath(__file__), jp, "9", d, *extra], capture_output=True, text=True)
            return p.returncode, {f: open(os.path.join(d, f)).read() for f in os.listdir(d) if f.endswith("w9.md")}
    fails = total = 0
    for name, a, b, want, names in cases:
        rc, files = run(journal(a, b)); out = files.get("c7w9.md", "")
        ok = f"verdict: **{want}**" in out and (rc == 0) == (want != "blocked") and all(n in out for n in names) and ("DR-037" in out) == (want == "ship")
        fails += not ok; total += 1; print(("ok  " if ok else "FAIL") + " - " + name + f" -> {want}" + ("" if ok else f" (rc {rc}; wrote: {out[:160]!r})"))
    rc, files = run(journal(rv(), rf()), "--prs", "7,8"); ok = rc == 2 and "verdict: **ship**" in files.get("c7w9.md", "") and "verdict: **blocked**" in files.get("c8w9.md", "") and "reviewer" in files.get("c8w9.md", "")
    fails += not ok; total += 1; print(("ok  " if ok else "FAIL") + " - a PR the wave was given (--prs) whose reviewer never started gets a blocked row, the other PR is unaffected, exit 2")
    print(f"review-wave-verdict self-test {'FAILED' if fails else 'passed'} ({total - fails}/{total})"); return 1 if fails else 0
if len(sys.argv) > 1 and sys.argv[1] == "--self-test": sys.exit(selftest())
expect = []
if "--prs" in sys.argv: i = sys.argv.index("--prs"); expect = sys.argv[i + 1].split(","); del sys.argv[i:i + 2]
journal, wave = sys.argv[1], sys.argv[2]
S = os.path.dirname(os.path.abspath(journal)) if len(sys.argv) < 4 else sys.argv[3]
out_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(__file__))
rows = [json.loads(l) for l in open(journal) if l.strip()]
res = {}
labels = {r["key"]: r.get("label", "") for r in rows if r.get("type") == "started" and r.get("key")}
for r in rows:
    lab = r.get("label") or labels.get(r.get("key", ""), "") or (r.get("opts") or {}).get("label") or ""
    m = re.match(r"(review|refute):#(\d+) r(\d+)", lab)
    if not m: continue
    a = res.setdefault(m.group(2), {"round": m.group(3)}).setdefault(m.group(1), {"failed": False, "result": None})
    if r.get("type") == "failed": a["failed"] = True
    elif "result" in r or "value" in r: a["result"] = r["result"] if "result" in r else r["value"]
blocked = 0
def esc(s): return str(s).replace("@claude", "@ claude")
for pr in list(res) + [p for p in expect if p not in res]:
    d = res.setdefault(pr, {"round": "?"})
    sv, wv = judge("review", d.get("review")); sf, wf = judge("refute", d.get("refute"))
    rv, rf = (d["review"]["result"] if sv == "ok" else None), (d["refute"]["result"] if sf == "ok" else None)
    bad = ([("reviewer", wv)] if sv != "ok" else []) + ([("refuter", wf)] if sf == "bad" else [])
    if rv and rf is None and sf == "absent" and rv["verdict"] == "ship" and re.search(r"SAFETY_MACHINERY|DECISION_PATH|OWNER_RESERVED", rv["tier"]): bad.append(("refuter", "MISSING: no refute ran (not routed), and a ship on tier " + rv["tier"][:60] + " cannot land without one"))
    if rv and rf and rf["upheld"] and rf["counter_verdict"] != rv["verdict"]: bad.append(("refuter", "INVALID: upheld=true but its counter_verdict differs from the reviewer's"))
    if bad:
        out = [f"## Review round {d['round']} — verdict: **blocked**\n", "Not landable: the review wave did not return a complete, unblocked verdict, so nothing here is a ship.\n"]
        out += [f"- **{who}** (`{'review' if who == 'reviewer' else 'refute'}:#{pr} r{d['round']}`) {esc(why)}" for who, why in bad]
        out.append("\n**Next:** not landable; re-run the review wave for this PR. Do not push, land or merge on this comment.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_")
        p = os.path.join(out_dir, f"c{pr}w{wave}.md"); open(p, "w").write("\n".join(out) + "\n"); print("wrote", p, "blocked"); blocked += 1; print("BLOCKED", pr, "; ".join(f"{who} {w}" for who, w in bad), file=sys.stderr); continue
    verdict = rv["verdict"]
    upheld = None if rf is None else rf.get("upheld")
    if rf is not None and upheld is False and rf.get("counter_verdict"):
        final = rf["counter_verdict"]
    else:
        final = verdict
    lines = []
    lines.append(f"## Review round {d['round']} — verdict: **{final}** (head `{rv['head_verified']}`)\n")
    ref = ("adversarial refuter: **upheld**" if upheld else ("adversarial refuter: **REFUTED** (counter-verdict " + rf.get("counter_verdict","?") + ")" if rf is not None else "no Opus refute by routing"))
    lines.append(f"Reviewed by the cloud lane (Sonnet review + Opus refute, DR-047 review tiers). Independent reviewer: **{verdict}**; {ref}.")
    lines.append(f"Tier: {rv['tier']}. Gating: {esc(rv['gating'])} merge-tree vs Alpha: {'clean' if rv['merge_tree_clean'] else 'CONFLICT'}; unresolved threads: {rv['threads_unresolved']}; body truthful: {rv['body_truthful']}.\n")
    lines.append(f"**Reviewer's summary:** {esc(rv['summary'])}\n")
    lines.append(f"**Prior round:** {esc(rv['prior_round_addressed'])}\n")
    if rv["findings"]:
        lines.append("**Findings:**")
        for f in rv["findings"]:
            lines.append(f"- **{f['severity']}** `{f['file']}` — {esc(f['claim'])}\n  Evidence: {esc(f['evidence'])}")
        lines.append("")
    lines.append("**Verified by running (reviewer):**")
    for c in rv["commands_run"][:12]:
        lines.append(f"- `{esc(c['cmd'])}` → exit {c['exit']}: {esc(c['excerpt'])[:300]}")
    if rf is not None:
        lines.append(f"\n**Refuter's summary:** {esc(rf['summary'])}")
        if rf.get("counter_findings"):
            lines.append("\n**Refuter's counter-findings:**")
            for f in rf["counter_findings"]:
                lines.append(f"- **{f['severity']}** `{f['file']}` — {esc(f['claim'])}\n  Evidence: {esc(f['evidence'])}")
        lines.append("\n**Verified by running (refuter):**")
        for c in rf["commands_run"][:10]:
            lines.append(f"- `{esc(c['cmd'])}` → exit {c['exit']}: {esc(c['excerpt'])[:300]}")
    if final == "ship":
        lines.append("\n**Next:** the cloud lane lands this under DR-037 (merge SignalGrid_Alpha in, regenerate, preflight + breadth on the merged head, push, wait for the gating check, merge). After this verdict, do not push to this branch; LOW/INFO items go to a follow-up PR.")
    elif final == "fix-needed":
        lines.append("\n**Next:** fix on this same branch (the fix commit plus, if mainline moved, a merge of origin/SignalGrid_Alpha), refresh the PR body for the new head with preflight and breadth quoted, then reply here with the new head.")
    else:
        lines.append("\n**Next:** owner-decision — the cloud lane keeps it mergeable; the owner merges or declines.")
    lines.append("\n---\n_Generated by [Claude Code](https://claude.ai/code)_")
    p = os.path.join(out_dir, f"c{pr}w{wave}.md")
    open(p, "w").write("\n".join(lines) + "\n"); print("wrote", p, final, "upheld=", upheld)
sys.exit(2 if blocked else 0)
