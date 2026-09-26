// land-branch — the generic, tracked saved workflow for landing a worker branch
// (DR-060 rule 2, lesson L2). Invoke with the Workflow tool, name 'land-branch',
// args = { repo, scratch, worktree, branch, tag, klass, title, trailers, sessionUrl, preBrief?, bodyNotes? }
// (repo, scratch, worktree, branch, tag, klass, title, trailers and sessionUrl are
// required; preBrief and bodyNotes are optional). trailers and sessionUrl are the
// caller's own attribution (this file has no session baked in, so it is reusable
// across sessions without silently mis-attributing someone else's commits/PRs).
// `klass` is now only the CALLER'S CLAIM, not the truth (Codex summary finding 7 on
// #1126/#1127, docs/BUILD_BACKLOG.md): the Merge stage runs
// `scripts/check-owner-gated-surfaces.mjs --classify-branch` over the actual diff, and
// resolveKlass() (mirrored below, next to canPush) lets that DERIVED class win
// whatever the caller passed — including escalating a caller's 'other' up to
// OWNER_RESERVED, never the other way.
//
// Lessons this codifies, so a future rewrite does not relearn them:
//   L1  one sequential chain per host for port-bound gates (preflight/breadth/test:api
//       collide on fixed ports across two chains on the same box).
//   L2  no push without a green preflight+breadth sentinel on the EXACT head. This
//       is structural, not a rule someone re-reads, because the SCRIPT (not a worker's
//       prose) evaluates the sentinel via scripts/lib/land-branch-gate.mjs's canPush()
//       before it ever dispatches a push agent: it requires preflightExit===0,
//       breadthExit===0, the run's own headSha===the merge head, AND both sentinel
//       LINES to EQUAL exactly "PREFLIGHT_EXIT 0 <expected-head>"/"BREADTH_EXIT 0
//       <expected-head>". That function's self-test (`node
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
//   L15 a stacked branch merges Alpha after its base lands, never the base tip.
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
// Argument validation BEFORE any of these values are interpolated into shell text
// handed to a worker (Codex #1126 P1, land-branch.js:165): a tag or path containing
// shell metacharacters reaches the worker's Bash tool verbatim, since every command
// below is a template string, not an argv array. title/klass/sessionUrl are only ever
// interpolated into prose/prompt text and the PR body Markdown, never into a shell
// command — but `trailers` IS pasted into a literal double-quoted shell argument (the
// merge stage's `git merge --no-ff -m "..." -m "${trailers}"`, land-branch.js line
// ~160), so it is validated below the same as tag/path, not merely required non-empty.
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const ABS_PATH_RE = /^\/[A-Za-z0-9._/-]+$/
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
// One or more "Key: value" lines; no double quote, backtick, `$` or backslash in the
// value half — those are exactly the characters that can run a command or break out
// of the double-quoted `-m "${trailers}"` argument the merge stage builds.
const TRAILER_LINE_RE = /^[A-Za-z-]+: [^"`$\\]+$/
if (!TAG_RE.test(tag)) throw new Error(`land-branch: args.tag ${JSON.stringify(tag)} must match ${TAG_RE}`)
for (const [name, value] of [['repo', repo], ['scratch', scratch], ['worktree', worktree]]) {
  if (!ABS_PATH_RE.test(value)) throw new Error(`land-branch: args.${name} ${JSON.stringify(value)} must be an absolute path (${ABS_PATH_RE}) — no spaces or shell metacharacters`)
}
if (!BRANCH_RE.test(branch) || branch.includes('..')) throw new Error(`land-branch: args.branch ${JSON.stringify(branch)} must match ${BRANCH_RE} and contain no ".."`)
const trailerLines = String(trailers).split('\n').filter((l) => l.length > 0)
if (!trailerLines.length || !trailerLines.every((l) => TRAILER_LINE_RE.test(l)))
  throw new Error(`land-branch: args.trailers ${JSON.stringify(trailers)} must be one or more "Key: value" lines matching ${TRAILER_LINE_RE}, with no '"', backtick, '$' or '\\' in any line`)
const S = scratch
const REPO = repo
// canPush is MIRRORED from scripts/lib/land-branch-gate.mjs, byte-for-byte after whitespace
// normalisation: the Workflow sandbox has no import.meta / filesystem, so the module
// cannot be imported here. The module is the tested source of truth (`node
// scripts/lib/land-branch-gate.mjs --self-test`), and its self-test READS THIS FILE and
// fails when the two copies differ — change the module first, then paste it here.
function canPush(run, expectedHead) {
  const reasons = [];
  if (!run || typeof run !== "object") return { ok: false, reasons: ["no chain-run result"] };
  if (run.headSha !== expectedHead) reasons.push(`headSha ${run.headSha} !== expected ${expectedHead}`);
  if (run.preflightExit !== 0) reasons.push(`preflightExit ${run.preflightExit} !== 0`);
  if (run.breadthExit !== 0) reasons.push(`breadthExit ${run.breadthExit} !== 0`);
  // Exact equality of the WHOLE line, not "contains" — a tag-scoped log can otherwise
  // still hold a PREVIOUS run's "…_EXIT 0 <old-sha>" line (the sentinel is bound to the
  // tag, not the sha), and a substring/"contains" check ALSO passed a line that merely
  // had the expected head somewhere in trailing text (e.g. "PREFLIGHT_EXIT 0 <stale>
  // unrelated=<expected>"). The chain writes the sentinel as exactly `echo
  // "PREFLIGHT_EXIT $? $(git rev-parse HEAD)"`, so no trailing text on that line, and
  // no other head sha earlier on it, is ever legitimate.
  if (run.preflightLastLine !== `PREFLIGHT_EXIT 0 ${expectedHead}`)
    reasons.push(`preflightLastLine is not exactly "PREFLIGHT_EXIT 0 ${expectedHead}": ${JSON.stringify(run.preflightLastLine)}`);
  if (run.breadthLastLine !== `BREADTH_EXIT 0 ${expectedHead}`)
    reasons.push(`breadthLastLine is not exactly "BREADTH_EXIT 0 ${expectedHead}": ${JSON.stringify(run.breadthLastLine)}`);
  return { ok: reasons.length === 0, reasons };
}

// resolveKlass / ownerDecisionText are MIRRORED from scripts/lib/land-branch-gate.mjs,
// byte-for-byte after whitespace normalisation, for the same reason canPush is above:
// the Workflow sandbox has no import.meta / filesystem. That module's self-test READS
// THIS FILE and fails when either copy differs — change the module first, then paste
// it here. KLASS_LINE_RE is the regex both this file and the module need in scope for
// resolveKlass to run; it is not itself mirror-checked, only used.
const KLASS_LINE_RE = /^KLASS (OWNER_RESERVED|DECISION_PATH|SAFETY_MACHINERY|other) files=(\d+) matched=(\d+)$/;
function resolveKlass(callerKlass, derivedLine) {
  const m = KLASS_LINE_RE.exec(String(derivedLine ?? ""));
  if (!m) return { ok: false, reasons: [`derived line does not match the KLASS sentinel shape: ${JSON.stringify(derivedLine)}`] };
  const derivedKlass = m[1];
  const files = Number(m[2]);
  if (files === 0) return { ok: false, reasons: [`derived line reports files=0 (an empty diff is unknown, not "other"): ${JSON.stringify(derivedLine)}`] };
  const matched = Number(m[3]);
  if ((derivedKlass === "other") !== (matched === 0)) return { ok: false, reasons: [`derived line is internally inconsistent (klass ${derivedKlass} with matched=${matched}): ${JSON.stringify(derivedLine)}`] };
  return { ok: true, klass: derivedKlass, callerKlass, overridden: callerKlass !== derivedKlass };
}
function ownerDecisionText(klass) {
  switch (klass) {
    case "SAFETY_MACHINERY":
      return 'write: "SAFETY_MACHINERY (<paths>): merged under DR-037 with check run <id recorded before merge>" - leave "<id recorded before merge>" literally; the coordinator fills it';
    case "DECISION_PATH":
      return 'write: "Yes - DECISION_PATH by scripts/check-owner-gated-surfaces.mjs (name the rule(s) that match <paths>: lib/*, artifacts/api-server/, or a native decision port): the OWNER merges this PR or vetoes it by not merging; the cloud lane will not self-merge it, however green the gauntlet is." and say in one sentence, from the diff, what the change touches (whether it alters any route, verdict or decision logic) so the owner can judge it from the phone';
    case "OWNER_RESERVED":
      return 'write: "OWNER_RESERVED (<paths>): the launch profile, launch-claims gate, publication boundary, pricing, LICENSE/NOTICE or another owner-reserved surface changed — the OWNER merges this PR; the cloud lane will not merge it under DR-037 whatever the checks say." and name the paths';
    case "other":
      return 'write what the owner must decide, or "None - docs/record only, landed under DR-037 with check run <id recorded before merge>"';
    default:
      // Fail closed: an unrecognised klass must never fall through to a default
      // paragraph that understates what changed.
      throw new Error(`ownerDecisionText: unknown klass ${JSON.stringify(klass)}`);
  }
}

const RULES = `
HARD RULES (a violation is a failed stage): never \`git fetch --depth/--deepen/--shallow-*\`, never \`git stash\`, \`git reset --hard\`, \`git rebase\`, \`rm -rf\`, \`--no-verify\`, force-push; never \`git checkout --\` on a dirty file EXCEPT \`--theirs\` on the two GENERATED paths named in the Merge stage's step 2 (docs/agent/SURFACE_REVIEW_COVERAGE.md, artifacts/sync/live-sync-manifest.json), and only while a merge conflict is actually in progress there — docs/agent/CLAIM_INVENTORY.json is a SOURCE input and is never resolved with \`--theirs\`, only by merging both sides' records by hand; never touch any worktree but ${worktree}; never boot a server yourself; never hand-edit docs/agent/SURFACE_REVIEW_COVERAGE.md or artifacts/sync/live-sync-manifest.json (only their generators write them, and only on a CLEAN index: \`git ls-files -u\` must print nothing first); never put a model id in a commit message except the required trailers; gates run only AFTER \`git add -A\` (lesson L9). Every figure you report comes from output you produced in this stage. If blocked, stop and return the blocker in \`blockers\`; never return a best guess as complete.
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
    // The single line `check-owner-gated-surfaces.mjs --classify-branch` prints, EXACTLY
    // as printed (Codex finding 7). Only the Merge stage computes this — Pre returns ''.
    klassLine: { type: 'string' },
  },
  required: ['headSha', 'filesChanged', 'gateResults', 'notes', 'blockers', 'klassLine'],
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
After the edits: \`git add -A\`, run the gates the brief names (each exit 0, quote the last line), commit ONE commit with the subject the brief gives and the trailers. Do NOT push. Return the schema with klassLine = '' (this stage never computes it; the Merge stage does).
${RULES}`, { label: `pre:${tag}`, phase: 'Pre', model: 'sonnet', effort: 'medium', schema: STAGE_SCHEMA })
  if (!pre || pre.blockers?.length) { log(`pre blocked: ${JSON.stringify(pre?.blockers)}`); return { pre } }
  log(`pre: ${pre.headSha}`)
}

phase('Merge')
const merge = await agent(`You are the Sonnet merge worker (DR-060 rule 1: mid tier). Worktree ${worktree}, branch ${branch}.
1. \`cd ${REPO} && git fetch origin SignalGrid_Alpha\` (plain fetch). \`cd ${worktree} && git status --short\` must be empty.
2. \`git merge --no-ff -m "Merge origin/SignalGrid_Alpha into ${branch}" -m "${trailers}" origin/SignalGrid_Alpha\` — the trailers go on the merge commit's message from this ONE command, in the SAME commit \`git merge\` creates (a merge with no conflicts commits immediately; a later "append the trailers with git commit" step would then have nothing left to commit, and every conflict-free landing would silently lose its attribution — this is why the trailers are two -m paragraphs on the merge command itself, not a follow-up commit). If the output says "Already up to date.", nothing was committed and that is fine — do not try to force a commit. On conflicts: docs/agent/LOOP.md and docs/agent/EVIDENCE.md keep BOTH sides (append-only records); docs/agent/LESSONS.md keeps both sides and renumbers so ids read L1..Ln in order with no gap (a row from mainline keeps its id, the branch's rows take the next ids); the ONLY generated files this merge may resolve with \`--theirs\` are docs/agent/SURFACE_REVIEW_COVERAGE.md and artifacts/sync/live-sync-manifest.json (\`git checkout --theirs -- <path> && git add <path>\` — the one allowed exception to "never git checkout -- on a dirty file", scoped to exactly these two paths during this merge), because both are regenerated from the tree in step 3 by their own generator; docs/agent/CLAIM_INVENTORY.json is a SOURCE input, never \`--theirs\` — on a conflict there, merge the JSON records from BOTH sides by hand (never drop the branch's own claim records) and then regenerate docs/CLAIM_INVENTORY.md from the merged JSON with \`node scripts/gen-claim-inventory-md.mjs\` (never hand-edit the derived Markdown); if a conflict lands on docs/CLAIM_INVENTORY.md alone with the JSON already resolved, resolve it the same way (regenerate, don't pick a side). Any other conflict you resolve by reading both sides and keeping the intent of both, and you name it in notes. If the merge left a conflict, finish it with \`git commit --no-edit --cleanup=strip\` (the trailers are already on the merge's own message from the \`-m\` above, so nothing further needs appending; \`--cleanup=strip\` drops MERGE_MSG's \`# Conflicts:\` comment block so the trailers stay the LAST lines of the body instead of having that block appended after them — git still parses trailers either way, but the body should end with them, not with a leftover conflict listing).
3. ONLY with \`git ls-files -u\` empty and \`git status --short\` empty: \`node scripts/generate-sync-manifest.mjs\` (if it exists and touches the manifest), then \`node scripts/check-surface-review-coverage.mjs --write\`. If either changed a file: \`git add -A\`, run \`node scripts/check-surface-review-coverage.mjs\` (must exit 0), commit "coverage page regenerated on top of <alpha short sha>" with the trailers.
4. Quick gates after \`git add -A\` (nothing should be pending): node scripts/check-publication-boundary.mjs; node scripts/check-surface-review-coverage.mjs; node scripts/check-surface-ownership.mjs (if it exists); node scripts/check-lessons.mjs; node scripts/check-preflight-ci-parity.mjs; node scripts/check-cited-paths.mjs; node scripts/check-doc-line-counts.mjs. Each exit 0, quote the last line; a failure is returned as a blocker with the output, NOT patched around.
5. Derive the owner-decision class from the diff (Codex summary finding 7 on #1126/#1127, docs/BUILD_BACKLOG.md): \`cd ${worktree} && node scripts/check-owner-gated-surfaces.mjs --classify-branch origin/SignalGrid_Alpha\`. It prints exactly one line, either \`KLASS <klass> files=<n> matched=<m>\` or \`KLASS ERROR <reason>\`. Return that line EXACTLY as printed, verbatim, as klassLine — do not paraphrase it, do not compute or guess the class yourself; a later stage parses it.
Return headSha = \`git rev-parse HEAD\` and klassLine from step 5.
${RULES}`, { label: `merge:${tag}`, phase: 'Merge', model: 'sonnet', effort: 'medium', schema: STAGE_SCHEMA })
if (!merge || merge.blockers?.length) { log(`merge blocked: ${JSON.stringify(merge?.blockers)}`); return { pre, merge } }
log(`merged: ${merge.headSha}`)

// The push-decision precedent (canPush, L2) applies here too: the DERIVED class from
// the diff wins over whatever klass the caller passed, never the other way (Codex
// finding 7). A klassLine that fails to resolve (unparsable, a KLASS ERROR from a git
// failure, or files=0) is a blocker, not a fallback to the caller's guess.
const kl = resolveKlass(klass, merge.klassLine)
if (!kl.ok) { log(`klass could not be derived from the diff: ${JSON.stringify(kl.reasons)}`); return { pre, merge, klass: kl } }
if (kl.overridden) log(`klass overridden: caller said ${klass}, the diff says ${kl.klass}`)
if (kl.klass === 'OWNER_RESERVED') log('OWNER_RESERVED: the lane must not merge this PR')

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
  await agent(`Run EXACTLY this one command and report its output; do nothing else: \`LOCK=${S}/chain.lock; if [ -f "$LOCK" ] && [ "$(awk '{print $1}' "$LOCK")" = "${tag}" ]; then rm -f "$LOCK"; echo RELEASED; else echo NOT_MINE_OR_ABSENT; fi\`. released=true only if the output is RELEASED.`, { label: `release:${tag}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: RELEASE_SCHEMA })
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
// log lines to EQUAL exactly "PREFLIGHT_EXIT 0 <expected-head>"/"BREADTH_EXIT 0
// <expected-head>" (closing the tag-scoped-sentinel gap: a stale line from an earlier run
// at a different sha under the same tag is refused, not just an exit code taken on faith —
// and closing the Codex #1130 P2 gap where a "contains" check let a line with the expected
// head concatenated after other text pass). Self-tested at
// scripts/lib/land-branch-gate.mjs --self-test.
const gate = canPush(chainRun, merge.headSha)
if (!gate.ok) {
  log(`push refused by the script: ${JSON.stringify(gate.reasons)}`)
  return { pre, merge, chainRun, gate }
}

const push = await agent(`You are the Haiku push worker. You have been dispatched ONLY because the script already verified a green preflight+breadth sentinel on head ${merge.headSha} — you do not re-decide that, you execute it, and you do not re-derive it either: the ONLY git command you run is the one shell line below, which re-verifies the sentinel logs and the worktree's own HEAD/branch ref DETERMINISTICALLY (never from your own report of what a file says) before the push runs at all. Worktree ${worktree}, branch ${branch}.
1. Run exactly this one command, in the worktree, in the foreground. The verifier is invoked from ${worktree} (the copy preflight itself just ran, never from ${REPO} — a shared checkout that may sit on an older commit lacking --verify would then no-op and print nothing, and \`&&\` would fall straight through to the push with no gate at all), and the push is gated on the module's own literal PASS line via grep, not merely on its exit code (an older module ignoring an unknown flag also exits 0 with empty output). Every step is chained with \`&&\`, never \`;\`, and the previous run's output file is removed FIRST, so a failed \`cd\`, a verifier that never runs, or a stale leftover file from an earlier run under the same tag can never be mistaken for a fresh PASS:
   \`cd ${worktree} && rm -f ${S}/${tag}-verify.out && node ${worktree}/scripts/lib/land-branch-gate.mjs --verify --scratch ${S} --tag ${tag} --worktree ${worktree} --branch ${branch} --head ${merge.headSha} | tee ${S}/${tag}-verify.out && grep -q "^land-branch-gate --verify PASS: head ${merge.headSha} " ${S}/${tag}-verify.out && git push -u origin HEAD:refs/heads/${branch}\`
   If the verify half prints "REFUSED", or prints nothing, or its PASS line does not literally match (wrong head, wrong tag), the \`grep -q\` fails and the \`&&\` never reaches the push — report the printed reasons (or "no PASS line printed") as a failure and pushed=false. A failed \`cd\` into the worktree, or the \`rm -f\`/verifier/\`tee\` step failing outright, stops the line at that \`&&\` before anything downstream (including the push) ever runs — there is no \`;\` anywhere in this line for a failure to fall through. Never run this with any other git command chained on, never pass --force.
2. Only if the command above succeeded: \`git ls-remote origin refs/heads/${branch}\` → remoteSha.
Never run any other git command; never fetch; never edit files.
${RULES}`, { label: `push:${tag}`, phase: 'Chain', model: 'haiku', effort: 'low', schema: PUSH_SCHEMA })
if (!push || !push.pushed) { log(`push failed: ${JSON.stringify(push?.failures)}`); return { pre, merge, chainRun, push } }
log(`pushed ${push.remoteSha}`)

phase('PR')
const body = await agent(`You are the Sonnet PR-body writer (DR-060 rule 1 puts PR bodies on the cheapest tier that can read a diff; you are it here (L16)). Worktree ${worktree}, branch ${branch}, head ${push.remoteSha}. Read-only: git and node commands only, no edits, no pushes.
Write the PR body in this repository's house template, every figure from output you ran or from the log files ${S}/${tag}-pf.log and ${S}/${tag}-br.log:
## Summary (what and why, 1-3 paragraphs, plain)
## What changed (one bullet per file, from \`git diff --stat $(git merge-base origin/SignalGrid_Alpha HEAD)..HEAD\`)
## Validation (quote: the preflight PASSED line + "PREFLIGHT_EXIT ${chainRun.preflightExit}", the breadth PASSED line + "BREADTH_EXIT ${chainRun.breadthExit}", both on head ${push.remoteSha}; then each gate the branch adds or changes, run it and quote its last line with EXIT code; if a self-test exists run it and quote N/N)
## Public-safety note (public-safe content only; no secrets, tenant IDs, customer data, PHI/PII, live API calls; no production-readiness, compliance, partnership or replacement claims; nothing in lib/ or /v1 changes - verify the last with the diff stat and say so only if true)
## Remaining risks (honest, 2-4 bullets)
## Owner decision needed (${ownerDecisionText(kl.klass)})
Notes from the build: ${bodyNotes || '(none)'}
End the body with exactly:
🤖 Generated with [Claude Code](https://claude.com/claude-code)

${sessionUrl}
Return the body as your final text (raw markdown, nothing else).
${RULES}`, { label: `body:${tag}`, phase: 'PR', model: 'sonnet', effort: 'medium' })

// Sanitize in the SCRIPT, not a prompt: an agent's "final text" can carry a harness
// preamble line above the first heading (seen twice this week) even when told to
// return "raw markdown, nothing else". Cut everything before the first "## " so the
// opener never has to trust the worker's own compliance with that instruction.
const bodyText = String(body || '')
// Cut at the first LINE that starts with "## ", not the first occurrence of the
// substring anywhere — a preamble line containing "### not a heading" has "## " as a
// substring one character in, so indexOf() alone turns it into a bogus leading H2.
const headingMatch = /^## /m.exec(bodyText)
const cleanBody = headingMatch ? bodyText.slice(headingMatch.index) : bodyText

const pr = await agent(`You are the Haiku PR opener. Load the GitHub tool with ToolSearch "select:mcp__github__create_pull_request" and open a PR in DanFashauer/SignalGrid-Review-Hub: head ${branch}, base SignalGrid_Alpha, title exactly: ${JSON.stringify(title)}, body exactly the markdown between the BODY markers below (do not alter it). Return number, url, and headSha = ${push.remoteSha}. If the call fails, return the error as a blocker; do not retry more than twice.
BODY-START
${cleanBody}
BODY-END`, { label: `open:${tag}`, phase: 'PR', model: 'haiku', effort: 'low', schema: PR_SCHEMA })

return { pre, merge, chainRun, push, pr, body: cleanBody, klass: kl }
