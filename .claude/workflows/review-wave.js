export const meta = {
  name: 'signalgrid-review-wave',
  description: 'Adversarial review of SignalGrid worker PRs: Sonnet reviews each PR in its own worktree, Opus tries to refute the verdict (DR-047 tiers)',
  phases: [{ title: 'Review' }, { title: 'Refute' }],
}
const { prs, repo, scratch, alpha, stamp } = args
const FINDING = { type: 'object', properties: { severity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW', 'INFO'] }, file: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' } }, required: ['severity', 'file', 'claim', 'evidence'] }
const CMD = { type: 'object', properties: { cmd: { type: 'string' }, exit: { type: 'integer' }, excerpt: { type: 'string' } }, required: ['cmd', 'exit', 'excerpt'] }
const REVIEW = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['ship', 'fix-needed', 'owner-decision'] },
  head_verified: { type: 'string' }, tier: { type: 'string' },
  gating: { type: 'string' }, merge_tree_clean: { type: 'boolean' }, threads_unresolved: { type: 'integer' }, body_truthful: { type: 'boolean' },
  prior_round_addressed: { type: 'string' },
  findings: { type: 'array', items: FINDING }, commands_run: { type: 'array', items: CMD },
  summary: { type: 'string' }, blocked: { type: 'boolean' }, blocked_reason: { type: 'string' },
}, required: ['verdict', 'head_verified', 'tier', 'gating', 'merge_tree_clean', 'threads_unresolved', 'body_truthful', 'prior_round_addressed', 'findings', 'commands_run', 'summary', 'blocked'] }
const REFUTE = { type: 'object', properties: {
  upheld: { type: 'boolean' }, counter_verdict: { type: 'string', enum: ['ship', 'fix-needed', 'owner-decision'] },
  counter_findings: { type: 'array', items: FINDING }, commands_run: { type: 'array', items: CMD }, summary: { type: 'string' }, blocked: { type: 'boolean' }, blocked_reason: { type: 'string' },
}, required: ['upheld', 'counter_verdict', 'counter_findings', 'commands_run', 'summary', 'blocked'] }

const RULES = (p, wt) => `
HARD RULES (DR-054: if you cannot finish, set blocked=true and say exactly what blocked you; never guess):
- Work ONLY in your own worktree ${wt}. Create it first: git -C ${repo} worktree add --detach ${wt} pr/${p.pr}   (refs/remotes/pr/${p.pr} is already fetched; its tip must be ${p.head} - verify with git -C ${wt} rev-parse HEAD and put that in head_verified). Then: cd ${wt} && pnpm install --frozen-lockfile --offline (fall back without --offline).
- NEVER write into ${repo} (the shared checkout): no git checkout/reset/branch/commit/push there, no 'git worktree remove' anywhere, no recursive deletes. Plant mutants only inside ${wt} and revert each with: git -C ${wt} restore <file>.
- Never put a 'cd' inside $(...) command substitution; use absolute paths or 'git -C'.
- Never run node scripts/preflight.mjs, pnpm run verify:breadth, test:api or test:load in the review (fixed ports collide with other reviewers; the landing chain runs them). Run the PR's OWN gate/proof/self-test and targeted mutants only.
- Read-only GitHub via: gh api repos/DanFashauer/SignalGrid-Review-Hub/pulls/${p.pr}  (body), .../issues/${p.pr}/comments?per_page=100 (prior rounds), .../pulls/${p.pr}/files, .../commits/${p.head}/check-runs. Never post, never merge, never edit the PR.
- Quote real output; every claim in findings carries the command and exit code that showed it. Numbers come from output, not memory.
- At the end: find ${wt}/node_modules -delete 2>/dev/null (leave the worktree itself in place).`

const reviewPrompt = (p) => {
  const wt = `${scratch}/rv${p.pr}w${p.round}`
  return `You are an INDEPENDENT adversarial reviewer for SignalGrid-Review-Hub PR #${p.pr} ("${p.title}"), review round ${p.round}, head ${p.head}, classified by scripts/check-owner-gated-surfaces.mjs classifyDiff as ${p.tier}. Mainline is origin/SignalGrid_Alpha at ${alpha}. Your job is to try to REFUTE the fix, not to approve it.
${RULES(p, wt)}

CHECKLIST (answer each with evidence):
1. Fail-closed: does any unknown/missing/unparseable/stale input LOOSEN a result (allow, pass, skip, exemption) instead of tightening it? Grep the diff for try/catch swallowing, default:true, optional chaining that yields pass, exemption/allowlist growth.
2. Deterministic: no Date.now()/Math.random()/env-dependent output in a decision or gate path; same input, same output (run the gate twice if cheap).
3. Does the falsification really fail? Run the PR's self-test / proof; then plant at least two mutants in ${wt} that would make the gate useless (e.g. invert the check, drop a branch) and show each turns the gate RED (quote exit codes); revert them.
4. Docs figures true: every number the PR writes into docs/* must match something you measured on this head.
5. Owner-reserved files: list files hit by OWNER_RESERVED/DECISION_PATH/SAFETY_MACHINERY (node -e 'import("./scripts/check-owner-gated-surfaces.mjs").then(m=>console.log(JSON.stringify(m.classifyDiff(process.argv.slice(1)))))' <files> in ${wt}). Golden rule 1: native/ios/EnterpriseShell/Services/DecisionEngine.swift and AppWorkflows.swift untouched.
6. Prior round: read the previous round's findings on the PR (comments) and state for each whether this head addresses it (prior_round_addressed).
7. DR-037 landing conditions: gating check 'Typecheck, build, and proof scaffold' status on ${p.head} (gating); git -C ${repo} merge-tree --write-tree origin/SignalGrid_Alpha pr/${p.pr} exit 0 (merge_tree_clean); review threads unresolved count via gh api .../pulls/${p.pr}/comments (threads_unresolved); PR body quotes preflight AND verify:breadth on THIS head (body_truthful).

VERDICT RULE: 'ship' only when NO finding is HIGH or MEDIUM, prior-round items are all addressed, and conditions in 7 hold except merge_tree (the landing chain merges mainline). Any HIGH/MEDIUM or an unaddressed prior item = 'fix-needed'. 'owner-decision' when the tier includes DECISION_PATH or OWNER_RESERVED (the cloud lane never lands those) - still report findings. LOW/INFO never block a ship. Return the JSON only.`
}

const refutePrompt = (p, r) => {
  const wt = `${scratch}/rv${p.pr}w${p.round}r`
  return `You are the ADVERSARIAL REFUTER (DR-047 judgment tier) for SignalGrid-Review-Hub PR #${p.pr} ("${p.title}"), round ${p.round}, head ${p.head}, tier ${p.tier}. An independent reviewer returned this verdict JSON:
${JSON.stringify(r, null, 1).slice(0, 12000)}
Your job: try to REFUTE it. If it says ship, hunt for the fail-open path, the non-deterministic input, the false docs figure, the mutant that stays green, or the prior-round item still open that the reviewer missed. If it says fix-needed, test whether each HIGH/MEDIUM finding is real (reproduce it) - a false finding is also a refutation. Default to upheld=false only when you have run something that shows the reviewer wrong; otherwise upheld=true.
${RULES(p, wt)}
Run at least two of your own probes (commands with exit codes) that the reviewer did not run. counter_verdict is the verdict you would give. Return the JSON only.`
}

log(`wave ${stamp}: ${prs.length} PRs`)
const results = await pipeline(
  prs,
  (p) => agent(reviewPrompt(p), { label: `review:#${p.pr} r${p.round}`, phase: 'Review', schema: REVIEW, model: 'sonnet' }),
  (r, p) => {
    if (!r) return { pr: p.pr, round: p.round, review: null, refute: null }
    if (!p.refute) return { pr: p.pr, round: p.round, review: r, refute: null }
    return agent(refutePrompt(p, r), { label: `refute:#${p.pr} r${p.round}`, phase: 'Refute', schema: REFUTE, model: 'opus' })
      .then((f) => ({ pr: p.pr, round: p.round, review: r, refute: f }))
  },
)
const dead = prs.filter((p, i) => !results[i] || !results[i].review)
if (dead.length) log(`DEAD reviewers (no result): ${dead.map((p) => '#' + p.pr).join(' ')}`)
return { stamp, results }
