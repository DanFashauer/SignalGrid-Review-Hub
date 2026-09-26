// Pure push-gate for the land-branch saved workflow (docs/agent/LESSONS.md L2,
// docs/BUILD_BACKLOG.md row "The plan-row measurement tranche is a scripted
// workflow"). This is the single source of truth for "may the chain push?" —
// .claude/workflows/land-branch.js inlines these same three checks (that file
// cannot rely on a runtime-specific import mechanism, since the Workflow tool
// executes it in its own sandbox), so a change here must be mirrored there.
//
//   node scripts/lib/land-branch-gate.mjs --self-test
//
// canPush() takes the Chain-run result (never worker prose) and the expected
// head, and refuses unless: the run's headSha still matches, both exits are
// literally 0, AND both last-line strings literally contain "PREFLIGHT_EXIT 0"
// / "BREADTH_EXIT 0" — belt AND suspenders against a worker that reports
// exit:0 while pasting a different log line.
export function canPush(run, expectedHead) {
  const reasons = [];
  if (!run || typeof run !== "object") return { ok: false, reasons: ["no chain-run result"] };
  if (run.headSha !== expectedHead) reasons.push(`headSha ${run.headSha} !== expected ${expectedHead}`);
  if (run.preflightExit !== 0) reasons.push(`preflightExit ${run.preflightExit} !== 0`);
  if (run.breadthExit !== 0) reasons.push(`breadthExit ${run.breadthExit} !== 0`);
  if (!/(?:^|\s)PREFLIGHT_EXIT 0(?:\s|$)/.test(run.preflightLastLine || ""))
    reasons.push(`preflightLastLine does not literally contain "PREFLIGHT_EXIT 0": ${JSON.stringify(run.preflightLastLine)}`);
  if (!/(?:^|\s)BREADTH_EXIT 0(?:\s|$)/.test(run.breadthLastLine || ""))
    reasons.push(`breadthLastLine does not literally contain "BREADTH_EXIT 0": ${JSON.stringify(run.breadthLastLine)}`);
  // The sentinel line itself must carry the expected head — a tag-scoped log can
  // otherwise still hold a PREVIOUS run's "…_EXIT 0 <old-sha>" line (the sentinel
  // is bound to the tag, not the sha); requiring the sha inside the line closes that.
  if (!(run.preflightLastLine || "").includes(expectedHead))
    reasons.push(`preflightLastLine does not carry the expected head ${expectedHead}: ${JSON.stringify(run.preflightLastLine)}`);
  if (!(run.breadthLastLine || "").includes(expectedHead))
    reasons.push(`breadthLastLine does not carry the expected head ${expectedHead}: ${JSON.stringify(run.breadthLastLine)}`);
  return { ok: reasons.length === 0, reasons };
}

function selfTest() {
  const HEAD = "abc1234deadbeef";
  const good = { headSha: HEAD, preflightExit: 0, preflightLastLine: `PREFLIGHT_EXIT 0 ${HEAD}`, breadthExit: 0, breadthLastLine: `BREADTH_EXIT 0 ${HEAD}` };
  const cases = [
    { name: "all green pushes", run: good, expect: true },
    { name: "missing breadth sentinel refused", run: { ...good, breadthLastLine: "" }, expect: false },
    { name: "missing preflight sentinel refused", run: { ...good, preflightLastLine: "" }, expect: false },
    { name: "non-zero breadth exit refused", run: { ...good, breadthExit: 1, breadthLastLine: `BREADTH_EXIT 1 ${HEAD}` }, expect: false },
    { name: "non-zero preflight exit refused", run: { ...good, preflightExit: 1, preflightLastLine: `PREFLIGHT_EXIT 1 ${HEAD}` }, expect: false },
    { name: "mismatched head refused", run: { ...good, headSha: "other" }, expect: false },
    { name: "exit 0 with stale/lying last-line text refused", run: { ...good, breadthLastLine: "some other line" }, expect: false },
    { name: "stale sentinel from a previous run at a different sha refused", run: { ...good, preflightLastLine: "PREFLIGHT_EXIT 0 someOldSha", breadthLastLine: "BREADTH_EXIT 0 someOldSha" }, expect: false },
    { name: "null run refused", run: null, expect: false },
  ];
  let pass = 0;
  for (const c of cases) {
    const { ok } = canPush(c.run, HEAD);
    if (ok === c.expect) { pass++; console.log(`PASS: ${c.name}`); }
    else console.error(`FAIL: ${c.name} — got ok=${ok}, want ${c.expect}`);
  }
  console.log(`${pass}/${cases.length} passed`);
  if (pass !== cases.length) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("land-branch-gate.mjs") && process.argv.includes("--self-test")) {
  selfTest();
}
