#!/usr/bin/env python3
# review-wave-verdict.py <journal.jsonl> <wave> [out_dir] --prs 1444,1445  |  review-wave-verdict.py --self-test  -> writes c<PR>w<wave>.md per PR from the review-wave journal
# FAIL-CLOSED (DR-054: a workflow surfaces a dead agent, it never filters it away). A reviewer or refuter that is missing, null, dead (failed, or started and never returned), blocked or schema-invalid makes that PR's verdict
# `blocked`, never ship: the file names the agent and why, the DR-037 landing sentence is not written, and the exit code is 2. --prs lists the PRs the wave was GIVEN, so one whose reviewer never started still gets a row.
# No refute ran is fine ("by routing") only behind a ship whose tier is `autonomous` or `docs only`, compared case-, whitespace-, `-`- and `_`-insensitively (an allowlist: any other or unknown tier text requires a refute). --prs is REQUIRED (exit 64 without it).
# An agent is a (PR, round, kind): the LATEST round decides, and within a journal key the LAST row wins (started, failed, started, result renders the result).
# Two journal keys that carry the same label are judged SEPARATELY and combined fail-closed: ANY dead, invalid or blocked key in the (round, kind) blocks it, so a later dead key is never hidden by an earlier key's result. With several good keys NO key's fields are dropped: the verdict is the most severe, a tier that needs a refute is kept if ANY key has one, booleans are the worst across keys (merge_tree_clean and body_truthful need all, threads_unresolved is the max), findings and commands are concatenated, and every refute key is checked against the combined reviewer verdict.
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
SEVERITY = {v: i for i, v in enumerate(VERDICTS)}  # ship < fix-needed < owner-decision
def agg(kind, ks):  # ("ok" | "absent" | "bad", why, result) over every journal key of one (PR, round, kind); ks is {key: {"failed", "result"}} or None
    if not ks: return judge(kind, None) + (None, [])
    outs = [(k, *judge(kind, a)) for k, a in ks.items()]
    badr = [f"{w}" + (f" [journal key {k}]" if len(ks) > 1 else "") for k, st, w in outs if st != "ok"]
    if badr: return "bad", "; ".join(badr), None, []
    vk = "verdict" if kind == "review" else "counter_verdict"
    goods = [ks[k]["result"] for k, _, _ in outs]  # journal-key order
    top = max(goods, key=lambda r: SEVERITY[r[vk]])  # the first of the most severe: its prose fields are the ones shown
    if len(goods) == 1: return "ok", "", top, goods
    m = dict(top); m[vk] = top[vk]
    for f in ("commands_run", "findings", "counter_findings"):
        if f in top: m[f] = [x for r in goods for x in r[f]]
    if kind == "review":
        gated = [r["tier"] for r in goods if not tier_free(r["tier"])]
        m["tier"] = gated[0] if gated else top["tier"]  # any key on a tier that requires a refute keeps that requirement
        m["merge_tree_clean"] = all(r["merge_tree_clean"] for r in goods); m["body_truthful"] = all(r["body_truthful"] for r in goods)
        m["threads_unresolved"] = max(r["threads_unresolved"] for r in goods)
    else: m["upheld"] = all(r["upheld"] for r in goods)
    return "ok", "", m, goods
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
        extra = extra or ("--prs", "7")  # --prs is required (row 2642); a case that omits it passes () explicitly via run_raw
        with tempfile.TemporaryDirectory() as d:
            jp = os.path.join(d, "j.jsonl"); open(jp, "w").write("\n".join(json.dumps(r) for r in rows) + "\n")
            p = subprocess.run([sys.executable, "-I", os.path.abspath(__file__), jp, "9", d, *extra], capture_output=True, text=True)
            return p.returncode, {f: open(os.path.join(d, f)).read() for f in os.listdir(d) if f.endswith("w9.md")}
    def run_raw(rows):  # the argv exactly as given: journal, wave, out_dir and no --prs
        with tempfile.TemporaryDirectory() as d:
            jp = os.path.join(d, "j.jsonl"); open(jp, "w").write("\n".join(json.dumps(r) for r in rows) + "\n")
            p = subprocess.run([sys.executable, "-I", os.path.abspath(__file__), jp, "9", d], capture_output=True, text=True)
            return p.returncode, {f: open(os.path.join(d, f)).read() for f in os.listdir(d) if f.endswith("w9.md")}
    fails = total = 0
    def started(kind, rnd, key): return {"type": "started", "key": key, "agentId": key, "label": f"{kind}:#7 r{rnd}", "phase": kind}
    def res(key, v): return {"type": "result", "key": key, "agentId": key, "result": v}
    L = [{"type": "launched"}]
    r1 = L + [started("review", 1, "a"), res("a", rv()), started("refute", 1, "b"), res("b", rf())]
    raw = [  # name, rows, extra argv (None = default --prs 7), want rc, substrings the PR 7 file must carry, substrings it must NOT carry
        ("S10 r1 ship+refute ship, then r2 reviewer started and returned nothing -> blocked, labelled round 2", r1 + [started("review", 2, "c")], None, 2, ["verdict: **blocked**", "round 2", "reviewer", "DEAD"], ["verdict: **ship**", "round 1", "DR-037"]),
        ("S10b r2 result lands after r1: the round-2 verdict is the one rendered", r1 + [started("review", 2, "c"), res("c", rv("fix-needed")), ], None, 0, ["round 2 \u2014 verdict: **fix-needed**"], ["round 1"]),
        ("S12 ship, tier owner-gated, no refute -> blocked", L + [started("review", 1, "a"), res("a", rv(tier="owner-gated"))], None, 2, ["verdict: **blocked**", "refuter"], ["DR-037"]),
        ("S13 ship, tier 'safety machinery (scripts/**)', no refute -> blocked", L + [started("review", 1, "a"), res("a", rv(tier="safety machinery (scripts/**)"))], None, 2, ["verdict: **blocked**", "refuter"], ["DR-037"]),
        ("unknown free-text tier, ship, no refute -> blocked", L + [started("review", 1, "a"), res("a", rv(tier="low-risk i guess"))], None, 2, ["verdict: **blocked**"], ["DR-037"]),
        ("tier 'autonomous', ship, no refute -> ships", L + [started("review", 1, "a"), res("a", rv(tier="autonomous"))], None, 0, ["verdict: **ship**", "DR-037"], []),
        ("tier 'docs only', ship, no refute -> ships (control)", L + [started("review", 1, "a"), res("a", rv(tier="docs only"))], None, 0, ["verdict: **ship**", "DR-037"], []),
        ("tier 'autonomous (SAFETY_MACHINERY)', ship, no refute -> blocked (not an allowlist entry)", L + [started("review", 1, "a"), res("a", rv(tier="autonomous (SAFETY_MACHINERY)"))], None, 2, ["verdict: **blocked**"], ["DR-037"]),
        ("retried key: started, failed, started, result -> the result, not BLOCKED", L + [started("review", 1, "a"), {"type": "failed", "key": "a"}, started("review", 1, "a"), res("a", rv("fix-needed"))], None, 0, ["verdict: **fix-needed**"], ["BLOCKED", "blocked"]),
        ("retried key then failed again: started, result, failed -> blocked", L + [started("review", 1, "a"), res("a", rv()), {"type": "failed", "key": "a"}], None, 2, ["verdict: **blocked**", "DEAD"], ["DR-037"]),
        ("two keys under one label, the later one dead (started, no result) behind the first one's ship -> blocked, naming the key", r1 + [started("review", 1, "a2")], None, 2, ["verdict: **blocked**", "reviewer", "DEAD", "a2"], ["verdict: **ship**", "DR-037"]),
        ("two keys under one label, the later one FAILED behind the first one's ship -> blocked", r1 + [started("review", 1, "a2"), {"type": "failed", "key": "a2"}], None, 2, ["verdict: **blocked**", "DEAD"], ["DR-037"]),
        ("two keys under one label, the EARLIER dead and the later one a ship -> blocked (a later result does not cover an earlier dead key)", L + [started("review", 1, "a0")] + r1[1:], None, 2, ["verdict: **blocked**", "DEAD"], ["DR-037"]),
        ("two good reviewer keys, one ship and one fix-needed -> the most severe verdict, fix-needed", L + [started("review", 1, "a"), res("a", rv()), started("review", 1, "a2"), res("a2", rv("fix-needed")), started("refute", 1, "b"), res("b", rf(False, "fix-needed"))], None, 0, ["verdict: **fix-needed**"], ["DR-037"]),
        ("a `started` row after a result under the SAME key clears the result (a restarted agent that returned nothing is dead): started, result, started -> blocked", L + [started("review", 1, "a"), res("a", rv()), started("review", 1, "a")], None, 2, ["verdict: **blocked**", "reviewer", "DEAD"], ["verdict: **ship**", "DR-037"]),
        ("the round compare is an integer: r9 ships, then r10's reviewer started and returned nothing -> blocked, labelled round 10 (a string compare would pick r9)", L + [started("review", 9, "a"), res("a", rv()), started("refute", 9, "b"), res("b", rf()), started("review", 10, "c")], None, 2, ["verdict: **blocked**", "round 10"], ["verdict: **ship**", "round 9", "DR-037"]),
        ("two good review keys tie on ship, the SECOND on a gated tier, no refute -> blocked (a dropped key must not hide a tier that needs a refute)", L + [started("review", 1, "a"), res("a", rv()), started("review", 1, "a2"), res("a2", rv(tier=SM))], None, 2, ["verdict: **blocked**", "refuter"], ["verdict: **ship**", "DR-037"]),
        ("the same two keys in the reversed order -> blocked too (the answer does not depend on journal order)", L + [started("review", 1, "a2"), res("a2", rv(tier=SM)), started("review", 1, "a"), res("a", rv())], None, 2, ["verdict: **blocked**", "refuter"], ["verdict: **ship**", "DR-037"]),
        ("two refute keys, the second upheld=true but its counter-verdict differs from the reviewer's -> blocked (every refute key is checked, not only the one picked)", L + [started("review", 1, "r"), res("r", rv("fix-needed", SM)), started("refute", 1, "b"), res("b", rf(False, "ship")), started("refute", 1, "b2"), res("b2", rf(True, "ship"))], None, 2, ["verdict: **blocked**", "refuter", "INVALID"], ["verdict: **ship**", "DR-037"]),
        ("two good review keys, the second with merge_tree_clean=false and unresolved threads -> the worst value is rendered, not the first key's", L + [started("review", 1, "a"), res("a", rv()), started("review", 1, "a2"), res("a2", rv(merge_tree_clean=False, threads_unresolved=3))], None, 0, ["CONFLICT", "unresolved threads: 3"], ["merge-tree vs Alpha: clean"]),
        ("S8 no --prs -> exit 64 and writes nothing", r1, (), 64, [], ["verdict"]),
    ]
    for name, rows, extra, wantrc, has, hasnt in raw:
        rc, files = run(rows, *(extra if extra is not None else ())) if extra != () else run_raw(rows); out = files.get("c7w9.md", "")
        ok = rc == wantrc and all(h in out for h in has) and not any(h in out for h in hasnt)
        fails += not ok; total += 1; print(("ok  " if ok else "FAIL") + " - " + name + ("" if ok else f" (rc {rc}; wrote: {out[:160]!r})"))
    for name, a, b, want, names in cases:
        rc, files = run(journal(a, b)); out = files.get("c7w9.md", "")
        ok = f"verdict: **{want}**" in out and (rc == 0) == (want != "blocked") and all(n in out for n in names) and ("DR-037" in out) == (want == "ship")
        fails += not ok; total += 1; print(("ok  " if ok else "FAIL") + " - " + name + f" -> {want}" + ("" if ok else f" (rc {rc}; wrote: {out[:160]!r})"))
    rc, files = run(journal(rv(), rf()), "--prs", "7,8"); ok = rc == 2 and "verdict: **ship**" in files.get("c7w9.md", "") and "verdict: **blocked**" in files.get("c8w9.md", "") and "reviewer" in files.get("c8w9.md", "")
    fails += not ok; total += 1; print(("ok  " if ok else "FAIL") + " - a PR the wave was given (--prs) whose reviewer never started gets a blocked row, the other PR is unaffected, exit 2")
    print(f"review-wave-verdict self-test {'FAILED' if fails else 'passed'} ({total - fails}/{total})"); return 1 if fails else 0
if len(sys.argv) > 1 and sys.argv[1] == "--self-test": sys.exit(selftest())
if "--prs" not in sys.argv or len(sys.argv) < sys.argv.index("--prs") + 2 or not [p for p in sys.argv[sys.argv.index("--prs") + 1].split(",") if p.strip()]:
    print("usage: review-wave-verdict.py <journal.jsonl> <wave> [out_dir] --prs 1444,1445  (--prs is REQUIRED: without the PRs the wave was given, one whose reviewer never started is dropped silently)", file=sys.stderr); sys.exit(64)
i = sys.argv.index("--prs"); expect = [p.strip().lstrip("#") for p in sys.argv[i + 1].split(",") if p.strip()]; del sys.argv[i:i + 2]
if len(sys.argv) < 3: print("usage: review-wave-verdict.py <journal.jsonl> <wave> [out_dir] --prs 1444,1445", file=sys.stderr); sys.exit(64)
journal, wave = sys.argv[1], sys.argv[2]
out_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(__file__))
rows = [json.loads(l) for l in open(journal) if l.strip()]
res = {}  # pr -> round -> kind -> key -> {"failed", "result"}: an agent is a (PR, round, kind) and may span several journal keys; each key's state is its LAST row
labels = {r["key"]: r.get("label", "") for r in rows if r.get("type") == "started" and r.get("key")}
for r in rows:
    lab = r.get("label") or labels.get(r.get("key", ""), "") or (r.get("opts") or {}).get("label") or ""
    m = re.match(r"(review|refute):#(\d+) r(\d+)", lab)
    if not m: continue
    a = res.setdefault(m.group(2), {}).setdefault(int(m.group(3)), {}).setdefault(m.group(1), {}).setdefault(r.get("key") or "", {"failed": False, "result": None})
    if r.get("type") == "failed": a["failed"] = True; a["result"] = None
    elif "result" in r or "value" in r: a["failed"] = False; a["result"] = r["result"] if "result" in r else r["value"]
    elif r.get("type") == "started": a["failed"] = False; a["result"] = None  # a retry under the same key starts clean; only a later result clears it
blocked = 0
def esc(s): return str(s).replace("@claude", "@ claude")
NOT_GATED = ("autonomous", "docs only")  # the ONLY tier spellings that may ship without a refute; anything else (unknown, free text, gated) requires one
def tier_free(t): return re.sub(r"[\s_-]+", " ", t.strip().lower()) in NOT_GATED
for pr in list(res) + [p for p in expect if p not in res]:
    rounds = res.get(pr, {})
    cur = max(rounds) if rounds else None  # the LATEST round decides: an earlier round's ship never covers a later round's silence
    d = dict(rounds.get(cur, {})); d["round"] = cur if cur is not None else "?"
    sv, wv, rv, _ = agg("review", d.get("review")); sf, wf, rf, rfs = agg("refute", d.get("refute"))
    bad = ([("reviewer", wv)] if sv != "ok" else []) + ([("refuter", wf)] if sf == "bad" else [])
    if rv and rf is None and sf == "absent" and rv["verdict"] == "ship" and not tier_free(rv["tier"]): bad.append(("refuter", "MISSING: no refute ran, and a ship on tier " + rv["tier"][:60] + " cannot land without one (only an explicit autonomous / docs only tier may skip it)"))
    if rv and any(x["upheld"] and x["counter_verdict"] != rv["verdict"] for x in rfs): bad.append(("refuter", "INVALID: upheld=true but its counter_verdict differs from the reviewer's"))
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
