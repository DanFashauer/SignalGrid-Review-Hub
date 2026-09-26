// land-branch — the generic, tracked saved workflow for landing a worker branch
// (DR-060 rule 2, lesson L2). Invoke with the Workflow tool, name 'land-branch',
// args = { repo, scratch, worktree, branch, tag, klass, title, preBrief?, bodyNotes? }
// (repo and scratch are absolute paths, required; every other field is the same
// shape the earlier session-pinned copy of this script took).
//
// Lessons this codifies, so a future rewrite does not relearn them:
//   L1  one sequential chain per host for port-bound gates (preflight/breadth/test:api
//       collide on fixed ports across two chains on the same box).
//   L2  no push without a green preflight+breadth sentinel on the EXACT head — this
//       file is that refusal, made structural instead of a rule someone re-reads.
//   L3  wait on a sentinel FILE, never on a process pattern — two waiters matching
//       processes by name can wait on each other forever.
//   L4  chain state lives in files under the scratchpad, never only in a process —
//       a restart kills processes and keeps files, and the chain resumes from them.
//   L9  gates run after `git add -A`, never before — a gate over a tracked-only walk
//       passes on a tree that doesn't yet contain the new file.
//   L13 the chain lock is a FILE (`<scratch>/chain.lock`), never a /proc scan — two
//       scans can each see the other's sleeping shell and wait on it forever.
//   L14 the chain is ONE detached `setsid nohup` job; a worker-owned background
//       process dies with the worker's turn and leaves no exit line.
export const meta = {
  name: 'land-branch',
  description: 'Optional pre-edit, merge Alpha + regenerate on a clean index, one sequential preflight+breadth chain, push only on 0/0, open the PR',
  phases: [
    { title: 'Pre', detail: 'optional Sonnet edit stage from args.preBrief' },
    { title: 'Merge', detail: 'Sonnet merges origin/SignalGrid_Alpha, regenerates on a clean index, runs the quick gates' },
    { title: 'Chain', detail: 'Haiku runs preflight + breadth with sentinels; pushes on 0/0' },
    { title: 'PR', detail: 'Sonnet drafts the body from the diff; Haiku opens the PR' },
  ],
}

const { repo, scratch, worktree, branch, tag, title, klass, preBrief, bodyNotes } = args
if (!repo) throw new Error('land-branch: args.repo is required (absolute repo root)')
if (!scratch) throw new Error('land-branch: args.scratch is required (absolute scratchpad base)')
const S = scratch
const REPO = repo

const RULES = `
HARD RULES (a violation is a failed stage): never \`git fetch --depth/--deepen/--shallow-*\`, never \`git stash\`, \`git reset --hard\`, \`git rebase\`, \`git checkout --\` on a dirty file, \`rm -rf\`, \`--no-verify\`, force-push; never touch any worktree but ${worktree}; never boot a server yourself; never hand-edit docs/agent/SURFACE_REVIEW_COVERAGE.md or artifacts/sync/live-sync-manifest.json (only their generators write them, and only on a CLEAN index: \`git ls-files -u\` must print nothing first); never put a model id in a commit message except the required trailers; gates run only AFTER \`git add -A\` (lesson L9). Every figure you report comes from output you produced in this stage. If blocked, stop and return the blocker in \`blockers\`; never return a best guess as complete.
Commit trailers (exact, last two lines of every commit body):
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D3GJ2Fs8sVppPgzuJdnNLn
`

const STAGE_SCHEMA = {
  type: 'object',
  properties: {
    headSha: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    gateResults: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exit: { type: 'number' }, lastLine: { type: 'string' } }, required: ['command', 'exit', 'lastLine'] } },
    notes: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['headSha', 'filesChanged', 'gateResults', 'notes', 'blockers'],
}

const CHAIN_SCHEMA = {
  type: 'object',
  properties: {
    headSha: { type: 'string' },
    preflightExit: { type: 'number' }, preflightLastLine: { type: 'string' },
    breadthExit: { type: 'number' }, breadthLastLine: { type: 'string' },
    pushed: { type: 'boolean' }, remoteSha: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['headSha', 'preflightExit', 'preflightLastLine', 'breadthExit', 'breadthLastLine', 'pushed', 'remoteSha', 'failures'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: { number: { type: 'number' }, url: { type: 'string' }, headSha: { type: 'string' }, blockers: { type: 'array', items: { type: 'string' } } },
  required: ['number', 'url', 'headSha', 'blockers'],
}

let pre = null
if (preBrief) {
  phase('Pre')
  pre = await agent(`You are the Sonnet edit worker (DR-060 rule 1: mechanical edits run on the mid tier). Worktree ${worktree}, branch ${branch}. \`git status --short\` must be empty before you start; if not, return the blocker.
${preBrief}
After the edits: \`git add -A\`, run the gates the brief names (each exit 0, quote the last line), commit ONE commit with the subject the brief gives and the trailers. Do NOT push. Return the schema.
${RULES}`, { label: `pre:${tag}`, phase: 'Pre', model: 'sonnet', effort: 'medium', schema: STAGE_SCHEMA })
  if (!pre || pre.blockers?.length) { log(`pre blocked: ${JSON.stringify(pre?.blockers)}`); return { pre } }
  log(`pre: ${pre.headSha}`)
}

phase('Merge')
const merge = await agent(`You are the Sonnet merge worker (DR-060 rule 1: mid tier). Worktree ${worktree}, branch ${branch}.
1. \`cd ${REPO} && git fetch origin SignalGrid_Alpha\` (plain fetch). \`cd ${worktree} && git status --short\` must be empty.
2. \`git merge --no-edit origin/SignalGrid_Alpha\`. On conflicts: docs/agent/LOOP.md and docs/agent/EVIDENCE.md keep BOTH sides (append-only records); docs/agent/LESSONS.md keeps both sides and renumbers so ids read L1..Ln in order with no gap (a row from mainline keeps its id, the branch's rows take the next ids); generated files (docs/agent/SURFACE_REVIEW_COVERAGE.md, artifacts/sync/live-sync-manifest.json, docs/agent/CLAIM_INVENTORY.json, docs/CLAIM_INVENTORY.md) are resolved by taking THEIRS (\`git checkout --theirs -- <path> && git add <path>\`) and regenerated in step 3 - never by hand; any other conflict you resolve by reading both sides and keeping the intent of both, and you name it in notes. Commit the merge (\`git commit --no-edit\` with the trailers appended via -m if needed).
3. ONLY with \`git ls-files -u\` empty and \`git status --short\` empty: \`node scripts/generate-sync-manifest.mjs\` (if it exists and touches the manifest), then \`node scripts/check-surface-review-coverage.mjs --write\`. If either changed a file: \`git add -A\`, run \`node scripts/check-surface-review-coverage.mjs\` (must exit 0), commit "coverage page regenerated on top of <alpha short sha>" with the trailers.
4. Quick gates after \`git add -A\` (nothing should be pending): node scripts/check-publication-boundary.mjs; node scripts/check-surface-review-coverage.mjs; node scripts/check-surface-ownership.mjs (if it exists); node scripts/check-lessons.mjs; node scripts/check-preflight-ci-parity.mjs; node scripts/check-cited-paths.mjs; node scripts/check-doc-line-counts.mjs. Each exit 0, quote the last line; a failure is returned as a blocker with the output, NOT patched around.
Return headSha = \`git rev-parse HEAD\`.
${RULES}`, { label: `merge:${tag}`, phase: 'Merge', model: 'sonnet', effort: 'medium', schema: STAGE_SCHEMA })
if (!merge || merge.blockers?.length) { log(`merge blocked: ${JSON.stringify(merge?.blockers)}`); return { pre, merge } }
log(`merged: ${merge.headSha}`)

phase('Chain')

// Lock acquisition lives in the SCRIPT loop, not inside one agent: a worker forced to return
// early cannot drop the wait (L3). The lock itself is a FILE under the scratchpad, never a
// /proc scan for a running preflight/breadth process (L13): two independent scans can each
// see the other's sleeping shell and wait on it forever, which is exactly what happened the
// first time this pattern was hand-run without a lock file.
const LOCK_SCHEMA = { type: 'object', properties: { acquired: { type: 'boolean' }, holder: { type: 'string' }, note: { type: 'string' } }, required: ['acquired', 'holder', 'note'] }
let acquired = false, lockTries = 0
while (!acquired && lockTries < 12) {
  lockTries++
  const lk = await agent(`You are the lock waiter (mechanical). Run EXACTLY this one command in the foreground and report what it prints; do nothing else, edit nothing, kill nothing:
\`LOCK=${S}/chain.lock; TAG=${tag}; try() { ( set -o noclobber; echo "$TAG $(date -u +%FT%TZ)" > "$LOCK" ) 2>/dev/null; }; busy() { ps -eo args | grep -E '[s]cripts/preflight.mjs|[v]erify-breadth.mjs' >/dev/null; }; if [ -e "$LOCK" ] && [ -n "$(find "$LOCK" -mmin +40 2>/dev/null)" ]; then echo "STALE_CLEARED $(cat "$LOCK")"; rm -f "$LOCK"; fi; if ! busy && try; then echo "ACQUIRED $(cat "$LOCK")"; else echo "HELD $(cat "$LOCK" 2>/dev/null || echo by-a-running-chain)"; timeout 480 bash -c 'until [ ! -e "'"$LOCK"'" ] && ! (ps -eo args | grep -E "[s]cripts/preflight.mjs|[v]erify-breadth.mjs" >/dev/null); do sleep 15; done'; if ! busy && try; then echo "ACQUIRED $(cat "$LOCK")"; else echo "STILL_HELD $(cat "$LOCK" 2>/dev/null || echo by-a-running-chain)"; fi; fi\`
Return acquired=true only if the output contains a line starting with ACQUIRED; holder = the text after HELD/STILL_HELD/ACQUIRED; note = the full output.`, { label: `lock:${tag}#${lockTries}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: LOCK_SCHEMA })
  acquired = !!(lk && lk.acquired)
  log(`lock try ${lockTries}: ${acquired ? 'acquired' : 'held by ' + (lk?.holder || '?')}`)
}
if (!acquired) { log('lock never acquired after 12 tries (~90 min)'); return { pre, merge, lockTries } }
const chain = await agent(`You are the Haiku validation worker (mechanical gate run). Worktree ${worktree}, branch ${branch}, expected head ${merge.headSha}.
Steps, in order, stopping at the first failure:
1. \`cd ${worktree} && git status --short\` must be empty and \`git rev-parse HEAD\` must equal ${merge.headSha}.
2. The host's chain lock ${S}/chain.lock is ALREADY HELD FOR YOU by a previous stage (its first word is your tag). Confirm with \`cat ${S}/chain.lock\`; do not wait on anything, do not remove it - the background job in step 3 removes it when the chain ends.
3. Start the WHOLE chain as ONE DETACHED job (a job owned by your shell dies when your turn ends or the tool's 10-minute cap hits - a worker-owned background chain has been killed mid-preflight that way with no exit line written, L14; \`setsid nohup\` detaches it from you). Run exactly this single command in the FOREGROUND (it returns in 2 seconds; the chain keeps running on its own):
   \`setsid nohup bash -c 'cd ${worktree} && echo ${merge.headSha} > ${S}/${tag}-run-head && ( node scripts/preflight.mjs > ${S}/${tag}-pf.log 2>&1; echo PREFLIGHT_EXIT $? >> ${S}/${tag}-pf.log; pnpm run verify:breadth > ${S}/${tag}-br.log 2>&1; echo BREADTH_EXIT $? >> ${S}/${tag}-br.log; rm -f ${S}/chain.lock )' > /dev/null 2>&1 < /dev/null & disown; sleep 2; ps -eo pid,args | grep -E "[s]cripts/preflight.mjs" | head -2\`
   The last line must show a running \`node scripts/preflight.mjs\`; if it shows nothing, report that as a failure.
4. Wait on the SENTINEL FILE, never on a process: foreground \`timeout 540 bash -c 'until grep -q BREADTH_EXIT ${S}/${tag}-br.log 2>/dev/null; do sleep 30; done'; grep -h "_EXIT" ${S}/${tag}-pf.log ${S}/${tag}-br.log\` and repeat that same call until it prints both a PREFLIGHT_EXIT and a BREADTH_EXIT line (up to 6 repeats; each repeat is a fresh call, never a longer one). If after 6 repeats BREADTH_EXIT is still missing, return a failure with the last 40 lines of ${tag}-pf.log.
5. Read the last 3 lines of each log. If both exits are 0 AND \`git rev-parse HEAD\` still equals ${merge.headSha}: \`git push -u origin ${branch}\` (retry on a network error with 2s/4s/8s/16s backoff; never --force), then \`git ls-remote origin refs/heads/${branch}\` → remoteSha. If either exit is non-zero, do NOT push; return the failing step's last 60 lines in failures.
Never run any other git command; never fetch; never edit files.
${RULES}`, { label: `chain:${tag}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: CHAIN_SCHEMA })
if (!chain || !chain.pushed) { log(`chain did not push: ${JSON.stringify(chain?.failures)}`); return { pre, merge, chain } }
log(`pushed ${chain.remoteSha}; preflight ${chain.preflightExit}, breadth ${chain.breadthExit}`)

phase('PR')
const body = await agent(`You are the Sonnet PR-body writer (DR-060 rule 1 puts PR bodies on the cheapest tier that can read a diff; you are it here). Worktree ${worktree}, branch ${branch}, head ${chain.remoteSha}. Read-only: git and node commands only, no edits, no pushes.
Write the PR body in this repository's house template, every figure from output you ran or from the log files ${S}/${tag}-pf.log and ${S}/${tag}-br.log:
## Summary (what and why, 1-3 paragraphs, plain)
## What changed (one bullet per file, from \`git diff --stat $(git merge-base origin/SignalGrid_Alpha HEAD)..HEAD\`)
## Validation (quote: the preflight PASSED line + "PREFLIGHT_EXIT ${chain.preflightExit}", the breadth PASSED line + "BREADTH_EXIT ${chain.breadthExit}", both on head ${chain.remoteSha}; then each gate the branch adds or changes, run it and quote its last line with EXIT code; if a self-test exists run it and quote N/N)
## Public-safety note (public-safe content only; no secrets, tenant IDs, customer data, PHI/PII, live API calls; no production-readiness, compliance, partnership or replacement claims; nothing in lib/ or /v1 changes - verify the last with the diff stat and say so only if true)
## Remaining risks (honest, 2-4 bullets)
## Owner decision needed (${klass === 'SAFETY_MACHINERY' ? 'write: "SAFETY_MACHINERY (<paths>): merged under DR-037 with check run <id recorded before merge>" - leave "<id recorded before merge>" literally; the coordinator fills it' : klass === 'DECISION_PATH' ? 'write: "Yes - DECISION_PATH by scripts/check-owner-gated-surfaces.mjs (its blanket artifacts/api-server rule matches <paths>): the OWNER merges this PR or vetoes it by not merging; the cloud lane will not self-merge it, however green the gauntlet is." and say in one sentence what the change touches (test harness only, no route or verdict logic) so the owner can judge it from the phone' : 'write what the owner must decide, or "None - docs/record only, landed under DR-037 with check run <id recorded before merge>"'})
Notes from the build: ${bodyNotes || '(none)'}
End the body with exactly:
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01D3GJ2Fs8sVppPgzuJdnNLn
Return the body as your final text (raw markdown, nothing else).
${RULES}`, { label: `body:${tag}`, phase: 'PR', model: 'sonnet', effort: 'medium' })

const pr = await agent(`You are the Haiku PR opener. Load the GitHub tool with ToolSearch "select:mcp__github__create_pull_request" and open a PR in DanFashauer/SignalGrid-Review-Hub: head ${branch}, base SignalGrid_Alpha, title exactly: ${JSON.stringify(title)}, body exactly the markdown between the BODY markers below (do not alter it). Return number, url, and headSha = ${chain.remoteSha}. If the call fails, return the error as a blocker; do not retry more than twice.
BODY-START
${body}
BODY-END`, { label: `open:${tag}`, phase: 'PR', model: 'haiku', effort: 'low', schema: PR_SCHEMA })

return { pre, merge, chain, pr, body }
