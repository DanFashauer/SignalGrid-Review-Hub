// land-branch — the generic, tracked saved workflow for landing a worker branch
// (DR-060 rule 2, lesson L2). Invoke with the Workflow tool, name 'land-branch',
// args = { repo, scratch, worktree, branch, tag, klass, title, trailers, sessionUrl, preBrief?, bodyNotes? }
// (repo, scratch, worktree, branch, tag, klass, title, trailers and sessionUrl are
// required; preBrief and bodyNotes are optional). trailers and sessionUrl are the
// caller's own attribution (this file has no session baked in, so it is reusable
// across sessions without silently mis-attributing someone else's commits/PRs).
//
// Lessons this codifies, so a future rewrite does not relearn them:
//   L1  one sequential chain per host for port-bound gates (preflight/breadth/test:api
//       collide on fixed ports across two chains on the same box).
//   L2  no push without a green preflight+breadth sentinel on the EXACT head. This
//       is structural, not a rule someone re-reads, because the SCRIPT (not a worker's
//       prose) evaluates the sentinel via scripts/lib/land-branch-gate.mjs's canPush()
//       before it ever dispatches a push agent: it requires preflightExit===0,
//       breadthExit===0, the run's own headSha===the merge head, AND both sentinel
//       LINES to literally contain "PREFLIGHT_EXIT 0"/"BREADTH_EXIT 0" plus the
//       expected head sha. That function's self-test (`node
//       scripts/lib/land-branch-gate.mjs --self-test`) plants a missing sentinel, a
//       non-zero sentinel, and a stale (previous-run) sentinel at the wrong sha, and
//       asserts refusal in each case. The Chain-run worker below is read-only with
//       respect to the push decision: it reports what it saw, and only the script
//       decides whether that clears the bar.
//   L3  wait on a sentinel FILE, never on a process pattern — two waiters matching
//       processes by name can wait on each other forever.
//   L4  chain state lives in files under the scratchpad, never only in a process —
//       a restart kills processes and keeps files, and the chain resumes from them.
//   L9  gates run after `git add -A`, never before — a gate over a tracked-only walk
//       passes on a tree that doesn't yet contain the new file.
//   L13 the chain lock is a FILE (`<scratch>/chain.lock`) acquired with `noclobber`,
//       checked against a bracketed ps pattern (`[s]cripts/preflight.mjs`) that cannot
//       match another waiter's own `grep` invocation — not a bare process scan, which
//       is the shape that let two waiters each see the other's sleeping shell and wait
//       on it forever.
//   L14 the chain is ONE detached `setsid nohup` job and BOTH waits (lock, sentinel)
//       live in the script's own loops, never in one worker's patience; a worker-owned background
//       process dies with the worker's turn and leaves no exit line. The lock is
//       released by a `trap ... EXIT` as the FIRST statement inside that job, so any
//       exit path (success, failure, or the job's own `cd` failing) releases it —
//       never a trailing `&& (...; rm)` that only runs if everything before it did.
export const meta = {
  name: 'land-branch',
  description: 'Optional pre-edit, merge Alpha + regenerate on a clean index, one sequential preflight+breadth chain, push only on 0/0 verified by the script, open the PR',
  phases: [
    { title: 'Pre', detail: 'optional Sonnet edit stage from args.preBrief' },
    { title: 'Merge', detail: 'Sonnet merges origin/SignalGrid_Alpha, regenerates on a clean index, runs the quick gates' },
    { title: 'Chain', detail: 'Haiku runs preflight + breadth with sentinels; the SCRIPT gates the push on 0/0, a Haiku push agent runs only when it clears' },
    { title: 'PR', detail: 'Sonnet drafts the body from the diff; Haiku opens the PR' },
  ],
}

const { repo, scratch, worktree, branch, tag, title, klass, trailers, sessionUrl, preBrief, bodyNotes } = args
const REQUIRED = { repo, scratch, worktree, branch, tag, title, klass, trailers, sessionUrl }
for (const [name, value] of Object.entries(REQUIRED)) {
  if (!value) throw new Error(`land-branch: args.${name} is required`)
}
const S = scratch
const REPO = repo
const { canPush } = await import(new URL('../../scripts/lib/land-branch-gate.mjs', import.meta.url).href)

const RULES = `
HARD RULES (a violation is a failed stage): never \`git fetch --depth/--deepen/--shallow-*\`, never \`git stash\`, \`git reset --hard\`, \`git rebase\`, \`rm -rf\`, \`--no-verify\`, force-push; never \`git checkout --\` on a dirty file EXCEPT \`--theirs\`/\`--ours\` on the four generated paths named in the Merge stage's step 2, and only while a merge conflict is actually in progress there; never touch any worktree but ${worktree}; never boot a server yourself; never hand-edit docs/agent/SURFACE_REVIEW_COVERAGE.md or artifacts/sync/live-sync-manifest.json (only their generators write them, and only on a CLEAN index: \`git ls-files -u\` must print nothing first); never put a model id in a commit message except the required trailers; gates run only AFTER \`git add -A\` (lesson L9). Every figure you report comes from output you produced in this stage. If blocked, stop and return the blocker in \`blockers\`; never return a best guess as complete.
Commit trailers (exact, last lines of every commit body):
${trailers}
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

// What the Chain-run worker reports — NEVER includes a push decision or a remoteSha.
// It observed two log files; it did not decide anything.
const CHAIN_RUN_SCHEMA = {
  type: 'object',
  properties: {
    headSha: { type: 'string' },
    preflightExit: { type: 'number' }, preflightLastLine: { type: 'string' },
    breadthExit: { type: 'number' }, breadthLastLine: { type: 'string' },
    jobStarted: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['headSha', 'preflightExit', 'preflightLastLine', 'breadthExit', 'breadthLastLine', 'jobStarted', 'failures'],
}

const PUSH_SCHEMA = {
  type: 'object',
  properties: { pushed: { type: 'boolean' }, remoteSha: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } } },
  required: ['pushed', 'remoteSha', 'failures'],
}

const RELEASE_SCHEMA = { type: 'object', properties: { released: { type: 'boolean' }, note: { type: 'string' } }, required: ['released', 'note'] }

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
2. \`git merge --no-edit origin/SignalGrid_Alpha\`. On conflicts: docs/agent/LOOP.md and docs/agent/EVIDENCE.md keep BOTH sides (append-only records); docs/agent/LESSONS.md keeps both sides and renumbers so ids read L1..Ln in order with no gap (a row from mainline keeps its id, the branch's rows take the next ids); generated files (docs/agent/SURFACE_REVIEW_COVERAGE.md, artifacts/sync/live-sync-manifest.json, docs/agent/CLAIM_INVENTORY.json, docs/CLAIM_INVENTORY.md) are resolved by taking THEIRS (\`git checkout --theirs -- <path> && git add <path>\` — the one allowed exception to "never git checkout -- on a dirty file", scoped to exactly these four paths during this merge) and regenerated in step 3 - never by hand; any other conflict you resolve by reading both sides and keeping the intent of both, and you name it in notes. Commit the merge (\`git commit --no-edit\` with the trailers appended via -m if needed).
3. ONLY with \`git ls-files -u\` empty and \`git status --short\` empty: \`node scripts/generate-sync-manifest.mjs\` (if it exists and touches the manifest), then \`node scripts/check-surface-review-coverage.mjs --write\`. If either changed a file: \`git add -A\`, run \`node scripts/check-surface-review-coverage.mjs\` (must exit 0), commit "coverage page regenerated on top of <alpha short sha>" with the trailers.
4. Quick gates after \`git add -A\` (nothing should be pending): node scripts/check-publication-boundary.mjs; node scripts/check-surface-review-coverage.mjs; node scripts/check-surface-ownership.mjs (if it exists); node scripts/check-lessons.mjs; node scripts/check-preflight-ci-parity.mjs; node scripts/check-cited-paths.mjs; node scripts/check-doc-line-counts.mjs. Each exit 0, quote the last line; a failure is returned as a blocker with the output, NOT patched around.
Return headSha = \`git rev-parse HEAD\`.
${RULES}`, { label: `merge:${tag}`, phase: 'Merge', model: 'sonnet', effort: 'medium', schema: STAGE_SCHEMA })
if (!merge || merge.blockers?.length) { log(`merge blocked: ${JSON.stringify(merge?.blockers)}`); return { pre, merge } }
log(`merged: ${merge.headSha}`)

phase('Chain')

// Lock acquisition lives in the SCRIPT loop, not inside one agent: a worker forced to return
// early cannot drop the wait (L3). The lock itself is a FILE under the scratchpad, checked
// against a bracketed ps pattern (`[s]cripts/preflight.mjs`) so a waiter's own `grep` command
// line can never match itself (L13) — this is a lock FILE with a ps precondition, not a bare
// /proc scan; two independent bare scans is the shape that let each see the other's sleeping
// shell and wait on it forever, which is what this replaced.
const LOCK_SCHEMA = { type: 'object', properties: { acquired: { type: 'boolean' }, holder: { type: 'string' }, note: { type: 'string' } }, required: ['acquired', 'holder', 'note'] }
let acquired = false, lockTries = 0
while (!acquired && lockTries < 12) {
  lockTries++
  const lk = await agent(`You are the lock waiter (mechanical). Call the Bash tool with timeout: 600000 for this command (it can legitimately run for up to 8 minutes; the tool's own 120s default would abort it mid-wait and read as a failure). Run EXACTLY this one command in the foreground and report what it prints; do nothing else, edit nothing, kill nothing:
\`LOCK=${S}/chain.lock; TAG=${tag}; try() { ( set -o noclobber; echo "$TAG $(date -u +%FT%TZ)" > "$LOCK" ) 2>/dev/null; }; busy() { ps -eo args | grep -E '[s]cripts/preflight.mjs|[v]erify-breadth.mjs' >/dev/null; }; if [ -e "$LOCK" ] && [ -n "$(find "$LOCK" -mmin +40 2>/dev/null)" ]; then echo "STALE_CLEARED $(cat "$LOCK")"; rm -f "$LOCK"; fi; if ! busy && try; then echo "ACQUIRED $(cat "$LOCK")"; else echo "HELD $(cat "$LOCK" 2>/dev/null || echo by-a-running-chain)"; timeout 480 bash -c 'until [ ! -e "'"$LOCK"'" ] && ! (ps -eo args | grep -E "[s]cripts/preflight.mjs|[v]erify-breadth.mjs" >/dev/null); do sleep 15; done'; if ! busy && try; then echo "ACQUIRED $(cat "$LOCK")"; else echo "STILL_HELD $(cat "$LOCK" 2>/dev/null || echo by-a-running-chain)"; fi; fi\`
Return acquired=true only if the output contains a line starting with ACQUIRED; holder = the text after HELD/STILL_HELD/ACQUIRED; note = the full output.`, { label: `lock:${tag}#${lockTries}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: LOCK_SCHEMA })
  acquired = !!(lk && lk.acquired)
  log(`lock try ${lockTries}: ${acquired ? 'acquired' : 'held by ' + (lk?.holder || '?')}`)
}
if (!acquired) { log('lock never acquired after 12 tries (~90 min)'); return { pre, merge, lockTries } }

let chainRun = await agent(`You are the Haiku validation worker (mechanical gate run; READ-ONLY with respect to pushing — you never push, the script decides that from what you report). Worktree ${worktree}, branch ${branch}, expected head ${merge.headSha}. Call the Bash tool with timeout: 600000 for step 4's waits below (each can legitimately take several minutes; the tool's own 120s default would abort mid-wait and read as a missing sentinel).
Steps, in order, stopping at the first failure:
1. \`cd ${worktree} && git status --short\` must be empty and \`git rev-parse HEAD\` must equal ${merge.headSha}.
2. The host's chain lock ${S}/chain.lock is ALREADY HELD FOR YOU by a previous stage (its first word is your tag). Confirm with \`cat ${S}/chain.lock\`; do not wait on anything, do not remove it - the background job in step 3 releases it itself (via a trap) when it starts, however it ends.
3. Start the WHOLE chain as ONE DETACHED job (a job owned by your shell dies when your turn ends or the tool's 10-minute cap hits - a worker-owned background chain has been killed mid-preflight that way with no exit line written, L14; \`setsid nohup\` detaches it from you). Run exactly this single command in the FOREGROUND (it returns in 2 seconds; the chain keeps running on its own). Note the \`trap ... EXIT\` is the FIRST statement inside the job, so the lock is released on every exit path (success, a failing \`cd\`, anything) rather than only after a full run; and both log files are truncated (\`: >\`) before preflight starts, not left holding a previous run's sentinel line under the same tag:
   \`setsid nohup bash -c 'trap "rm -f ${S}/chain.lock" EXIT; cd ${worktree} && echo ${merge.headSha} > ${S}/${tag}-run-head && : > ${S}/${tag}-pf.log && : > ${S}/${tag}-br.log && ( node scripts/preflight.mjs > ${S}/${tag}-pf.log 2>&1; echo "PREFLIGHT_EXIT $? $(git rev-parse HEAD)" >> ${S}/${tag}-pf.log; pnpm run verify:breadth > ${S}/${tag}-br.log 2>&1; echo "BREADTH_EXIT $? $(git rev-parse HEAD)" >> ${S}/${tag}-br.log )' > /dev/null 2>&1 < /dev/null & disown; sleep 2; ps -eo pid,args | grep -E "[s]cripts/preflight.mjs" | head -2\`
   The last line must show a running \`node scripts/preflight.mjs\`; if it shows nothing, report jobStarted=false and that as a failure — do NOT proceed to step 4.
4. Wait on the SENTINEL FILE, never on a process: foreground \`timeout 540 bash -c 'until grep -q BREADTH_EXIT ${S}/${tag}-br.log 2>/dev/null; do sleep 30; done'; grep -h "_EXIT" ${S}/${tag}-pf.log ${S}/${tag}-br.log\` and repeat that same call (each with the 600000ms Bash timeout above) until it prints both a PREFLIGHT_EXIT and a BREADTH_EXIT line (up to 6 repeats; each repeat is a fresh call, never a longer one). If after 6 repeats BREADTH_EXIT is still missing, return a failure with the last 40 lines of ${tag}-pf.log.
5. Read the last line of each log file EXACTLY as written (do not paraphrase, do not summarize the exit code — quote the literal text) into preflightLastLine / breadthLastLine, and their exit codes into preflightExit / breadthExit. Re-run \`git rev-parse HEAD\` into headSha. Do NOT push, do NOT run any other git command, do NOT fetch, do NOT edit files — that decision and that command belong to a later stage.
${RULES}`, { label: `chain-run:${tag}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: CHAIN_RUN_SCHEMA })

if (!chainRun || !chainRun.jobStarted) {
  log(`chain run never started the job: ${JSON.stringify(chainRun?.failures)}`)
  // The job's own `trap ... EXIT` releases the lock once it starts. If it never started
  // (chainRun is null, or it reported jobStarted=false), nothing has released it, and the
  // 40-minute stale-clear is the only other path — dispatch a narrow one-command release
  // instead of leaving every later landing on this host to wait that out.
  await agent(`Run EXACTLY this one command and report its output; do nothing else: \`LOCK=${S}/chain.lock; if [ -f "$LOCK" ] && [ "$(cut -d\\ -f1 "$LOCK")" = "${tag}" ]; then rm -f "$LOCK"; echo RELEASED; else echo NOT_MINE_OR_ABSENT; fi\`. released=true only if the output is RELEASED.`, { label: `release:${tag}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: RELEASE_SCHEMA })
  return { pre, merge, chainRun }
}
log(`chain ran: head ${chainRun.headSha}, preflight ${chainRun.preflightExit}, breadth ${chainRun.breadthExit}`)
// L14, second half: a worker's patience is not the wait. The chain-run worker above can
// return before either sentinel exists (it did, ~10 minutes in on 2026-09-26, while the
// detached job ran on to PREFLIGHT_EXIT 0 / BREADTH_EXIT 0 twenty minutes later) — so the
// SCRIPT keeps waiting through short mechanical readers until both lines exist, never
// re-starting the job. Up to 8 more reads of <=9 minutes each; a chain that has not
// written both lines by then is reported as such and canPush() below refuses.
const bothSentinels = (r) => /PREFLIGHT_EXIT/.test(r?.preflightLastLine || '') && /BREADTH_EXIT/.test(r?.breadthLastLine || '')
let sentinelReads = 0
while (!bothSentinels(chainRun) && sentinelReads < 8) {
  sentinelReads++
  const read = await agent(`You are the sentinel reader (mechanical: you start nothing, push nothing, edit nothing, remove nothing). Call the Bash tool with timeout: 600000 for this ONE command (it legitimately waits up to 9 minutes): \`timeout 540 bash -c 'until grep -q BREADTH_EXIT ${S}/${tag}-br.log 2>/dev/null; do sleep 30; done'; echo PF: $(tail -n 1 ${S}/${tag}-pf.log); echo BR: $(tail -n 1 ${S}/${tag}-br.log); cd ${worktree} && git rev-parse HEAD\`. Return jobStarted=true; preflightLastLine = the text after "PF: " EXACTLY as printed (empty string if nothing follows); breadthLastLine = the text after "BR: " likewise; preflightExit / breadthExit = the integer that follows PREFLIGHT_EXIT / BREADTH_EXIT on those lines, or -1 when the line is not a sentinel line yet; headSha = the rev-parse output; failures = []. Never paraphrase a line.`, { label: `sentinel-read:${tag}#${sentinelReads}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: CHAIN_RUN_SCHEMA })
  if (read) chainRun = read
  log(`sentinel read ${sentinelReads}: preflight ${chainRun.preflightExit}, breadth ${chainRun.breadthExit}`)
}

// The push decision is the SCRIPT's, not a worker's prose (lesson L2): canPush() requires
// preflightExit===0 && breadthExit===0 && the run's own headSha===the merge head, AND both
// log lines to literally contain "PREFLIGHT_EXIT 0"/"BREADTH_EXIT 0" plus the expected head
// sha (closing the tag-scoped-sentinel gap: a stale line from an earlier run at a different
// sha under the same tag is refused, not just an exit code taken on faith). Self-tested at
// scripts/lib/land-branch-gate.mjs --self-test.
const gate = canPush(chainRun, merge.headSha)
if (!gate.ok) {
  log(`push refused by the script: ${JSON.stringify(gate.reasons)}`)
  return { pre, merge, chainRun, gate }
}

const push = await agent(`You are the Haiku push worker. You have been dispatched ONLY because the script already verified a green preflight+breadth sentinel on head ${merge.headSha} — you do not re-decide that, you execute it. Worktree ${worktree}, branch ${branch}.
1. \`cd ${worktree} && git status --short\` must be empty and \`git rev-parse HEAD\` must equal ${merge.headSha}; if not, do NOT push, return the mismatch as a failure.
2. \`git push -u origin ${branch}\` (retry on a network error only, with 2s/4s/8s/16s backoff; never --force).
3. \`git ls-remote origin refs/heads/${branch}\` → remoteSha.
Never run any other git command; never fetch; never edit files.
${RULES}`, { label: `push:${tag}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: PUSH_SCHEMA })
if (!push || !push.pushed) { log(`push failed: ${JSON.stringify(push?.failures)}`); return { pre, merge, chainRun, push } }
log(`pushed ${push.remoteSha}`)

phase('PR')
const body = await agent(`You are the Sonnet PR-body writer (DR-060 rule 1 puts PR bodies on the cheapest tier that can read a diff; you are it here). Worktree ${worktree}, branch ${branch}, head ${push.remoteSha}. Read-only: git and node commands only, no edits, no pushes.
Write the PR body in this repository's house template, every figure from output you ran or from the log files ${S}/${tag}-pf.log and ${S}/${tag}-br.log:
## Summary (what and why, 1-3 paragraphs, plain)
## What changed (one bullet per file, from \`git diff --stat $(git merge-base origin/SignalGrid_Alpha HEAD)..HEAD\`)
## Validation (quote: the preflight PASSED line + "PREFLIGHT_EXIT ${chainRun.preflightExit}", the breadth PASSED line + "BREADTH_EXIT ${chainRun.breadthExit}", both on head ${push.remoteSha}; then each gate the branch adds or changes, run it and quote its last line with EXIT code; if a self-test exists run it and quote N/N)
## Public-safety note (public-safe content only; no secrets, tenant IDs, customer data, PHI/PII, live API calls; no production-readiness, compliance, partnership or replacement claims; nothing in lib/ or /v1 changes - verify the last with the diff stat and say so only if true)
## Remaining risks (honest, 2-4 bullets)
## Owner decision needed (${klass === 'SAFETY_MACHINERY' ? 'write: "SAFETY_MACHINERY (<paths>): merged under DR-037 with check run <id recorded before merge>" - leave "<id recorded before merge>" literally; the coordinator fills it' : klass === 'DECISION_PATH' ? 'write: "Yes - DECISION_PATH by scripts/check-owner-gated-surfaces.mjs (its blanket artifacts/api-server rule matches <paths>): the OWNER merges this PR or vetoes it by not merging; the cloud lane will not self-merge it, however green the gauntlet is." and say in one sentence what the change touches (test harness only, no route or verdict logic) so the owner can judge it from the phone' : 'write what the owner must decide, or "None - docs/record only, landed under DR-037 with check run <id recorded before merge>"'})
Notes from the build: ${bodyNotes || '(none)'}
End the body with exactly:
🤖 Generated with [Claude Code](https://claude.com/claude-code)

${sessionUrl}
Return the body as your final text (raw markdown, nothing else).
${RULES}`, { label: `body:${tag}`, phase: 'PR', model: 'sonnet', effort: 'medium' })

const pr = await agent(`You are the Haiku PR opener. Load the GitHub tool with ToolSearch "select:mcp__github__create_pull_request" and open a PR in DanFashauer/SignalGrid-Review-Hub: head ${branch}, base SignalGrid_Alpha, title exactly: ${JSON.stringify(title)}, body exactly the markdown between the BODY markers below (do not alter it). Return number, url, and headSha = ${push.remoteSha}. If the call fails, return the error as a blocker; do not retry more than twice.
BODY-START
${body}
BODY-END`, { label: `open:${tag}`, phase: 'PR', model: 'haiku', effort: 'low', schema: PR_SCHEMA })

return { pre, merge, chainRun, push, pr, body }
