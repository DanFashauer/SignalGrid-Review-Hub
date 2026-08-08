#!/usr/bin/env node
// Delete remote branches whose pull request is MERGED — running where the
// permission to do so actually exists.
//
//   node scripts/prune-merged-branches.mjs          # plan only, deletes nothing
//   APPLY=true node scripts/prune-merged-branches.mjs
//
// WHY THIS EXISTS, stated precisely because the previous explanation was wrong.
// Branch deletion had been reported as blocked by "the agent proxy returning HTTP
// 403 on delete refspecs". That was a misdiagnosis repeated three times. The proxy
// never saw the request: its failure log was empty and its status showed no git
// conflicts. The actual refusal came from the agent sandbox's own permission
// classifier, which treats `git push --delete` as destructive git — a local
// guardrail, correctly applied, and nothing to do with network policy. The GitHub
// MCP surface has `create_branch` and no delete counterpart, so that route was
// closed too.
//
// Neither of those is worth fighting. A GitHub Actions runner already holds a
// token with `contents: write`, which is exactly the permission a ref deletion
// needs, and it can be triggered from a phone. So the operation moves there. That
// is the whole fix: not more permission for the agent, but the work running where
// the permission already is.
//
// WHAT IT WILL NOT DO. Every one of these is a refusal, not a filter — each is
// counted and named in the report, because a prune that silently skipped things
// would leave you unable to tell "nothing to do" from "it did not look":
//
//   · the default branch
//   · any `dependabot/*` branch — bot-owned; deleting one makes it reopen
//   · any branch with an OPEN pull request — deleting it closes the PR and
//     orphans the review conversation
//   · any branch with NO merged pull request — that is unmerged work, and
//     deleting it destroys the work rather than tidying a pointer. The three
//     `codex/*` orphans land here, which is the correct outcome.
//   · any protected branch
//   · any branch whose PR lookup ERRORED. A failed read is not an empty result.
//     Deleting on a lookup failure would be the read-error-swallowing defect with
//     an irreversible consequence.
//
// MERGED-NESS IS RE-DERIVED AT RUN TIME, never read from the committed snapshot.
// `artifacts/sync/merged-branches-to-prune.txt` is a dated capture; branches move.
// The authority is the pull request's own merge state, for the reason
// docs/BRANCH_HYGIENE.md gives: a squash merge creates one new commit, so branch
// commits are never ancestors of the default branch and `git branch --merged`
// reports every squash-merged branch as UNMERGED.
//
// One API subtlety worth writing down, because getting it backwards inverts the
// whole result: the pulls LIST endpoint returns `merged: false` even on merged
// pull requests — it is `merged_at` that is populated there. This reads
// `merged_at`.
//
// REVERSIBILITY IS PRINTED BEFORE ANYTHING IS DELETED. Each branch's tip SHA goes
// into the run's job summary as a ready-to-paste restore command. A deletion whose
// tip was never recorded is not reversible, and this is the only moment that
// record can be made.

const APPLY = process.env.APPLY === "true";

// Branches to delete even though they carry commits that exist nowhere else. This is
// the ONE way past the "unmerged work" refusal, and it is deliberately awkward: an
// explicit, comma-separated list of exact names, typed per run, never a pattern.
//
// It cannot override the other refusals. The default branch, `dependabot/*`, an open
// pull request and branch protection stay refused even when named here — those are
// about breaking something live, not about losing history, and naming a branch does
// not make deleting it safe.
//
// AND IT CANNOT DELETE UNANCHORED WORK. Before a forced branch is removed, its tip is
// tagged `archive/<branch>`. If that tag cannot be created, the branch is NOT deleted.
// That ordering is the whole safety property: a recorded SHA in a document only works
// while the object stays reachable, and an unreferenced commit is eventually collected.
// A tag is a real ref, so the commits survive the branch indefinitely and the work is
// restorable with `git push origin archive/<branch>:refs/heads/<branch>`.
const FORCE = new Set(
  (process.env.FORCE_BRANCHES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const TOKEN = process.env.GH_TOKEN;
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

if (!TOKEN || !OWNER || !REPO) {
  console.error("✗ GH_TOKEN and GITHUB_REPOSITORY must be set (this runs in Actions).");
  process.exit(1);
}

const API = "https://api.github.com";
const headers = {
  authorization: `Bearer ${TOKEN}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "signalgrid-branch-prune",
};

// ── Rendering untrusted names safely ─────────────────────────────────────────
//
// A branch name is NOT a safe string. Git's ref grammar forbids spaces, control
// characters, `~ ^ : ? * [ \` and `..` — and permits everything else, including
// `$`, backticks, parentheses, `&`, `;`, `|`, `%` and single quotes. So
// `x$(whoami)` is a perfectly legal branch name, and every one of these helpers
// exists because the obvious rendering of it is wrong in a different way.
//
// CodeQL flagged the file write below as "network data written to file system".
// That is the right finding and the summary understates it: the most serious sink
// is not the file, it is the RESTORE COMMAND. This script's whole safety story is
// that a human can copy a line out of the run summary and paste it into a shell to
// undo a deletion — so an unquoted branch name there is command injection with a
// helpful "paste this" label on it.

/** Single-quote for POSIX sh. Inside single quotes only `'` is special. */
const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Render as a code span that cannot break out of it. Backticks in a name would
 *  close a markdown span and let the rest inject headings into the audit record —
 *  the record being the only evidence of what this run did. HTML entities render
 *  the name faithfully and escape nothing into markup. */
const escapeHtml = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const mdCode = (s) => `<code>${escapeHtml(s)}</code>`;

/** Encode a ref for a URL path WITHOUT destroying its slashes — `claude/foo` is
 *  two path segments and must stay two, but a `%` inside a segment is a legal ref
 *  character that would otherwise be read as the start of a percent-escape. */
const encodeRefPath = (ref) => ref.split("/").map(encodeURIComponent).join("/");

// The helpers are checked against the adversarial cases before they are used, for
// the same reason the text-safety gate tests itself: an escaper that has quietly
// stopped escaping produces output that looks exactly like correct output.
{
  const cases = [
    [shellQuote("x$(whoami)"), `'x$(whoami)'`],
    [shellQuote("it's"), `'it'\\''s'`],
    [mdCode("a`b"), "<code>a`b</code>"],
    [mdCode("<script>"), "<code>&lt;script&gt;</code>"],
    [encodeRefPath("claude/a b"), "claude/a%20b"],
    [encodeRefPath("claude/100%"), "claude/100%25"],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length > 0) {
    console.error("✗ escaping self-test FAILED — refusing to render untrusted names.\n");
    for (const [got, want] of bad) console.error(`    got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Follow Link headers rather than assuming one page holds everything. */
async function paginate(path) {
  const out = [];
  let url = `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    out.push(...(await res.json()));
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "");
    url = next ? next[1] : null;
  }
  return out;
}

const repo = await api(`/repos/${OWNER}/${REPO}`);
const defaultBranch = repo.default_branch;

const branches = await paginate(`/repos/${OWNER}/${REPO}/branches`);
console.log(`Branch prune — ${OWNER}/${REPO}, default branch ${defaultBranch}`);
console.log(`Mode: ${APPLY ? "APPLY (branches will be deleted)" : "DRY RUN (nothing will be deleted)"}`);
console.log(`${branches.length} remote branches\n`);

const doomed = [];
const forced = []; // {name, sha, unique} — unmerged, named explicitly, archived then deleted
const kept = []; // {branch, reason}

for (const b of branches) {
  const name = b.name;
  const sha = b.commit?.sha ?? "";

  if (name === defaultBranch) {
    kept.push({ name, reason: "default branch" });
    continue;
  }
  if (name.startsWith("dependabot/")) {
    kept.push({ name, reason: "dependabot-owned (deleting makes it reopen)" });
    continue;
  }
  if (b.protected) {
    kept.push({ name, reason: "branch protection" });
    continue;
  }

  let prs;
  try {
    prs = await paginate(
      `/repos/${OWNER}/${REPO}/pulls?state=all&head=${encodeURIComponent(`${OWNER}:${name}`)}`,
    );
  } catch (err) {
    // A failed lookup is NOT "no pull requests". Refuse, loudly.
    kept.push({ name, reason: `PR LOOKUP FAILED — refusing to judge it (${err.message})` });
    continue;
  }

  if (prs.some((p) => p.state === "open")) {
    kept.push({ name, reason: "has an OPEN pull request" });
    continue;
  }
  // `merged_at`, not `merged` — the list endpoint leaves `merged` false throughout.
  const merged = prs.filter((p) => p.merged_at);
  if (merged.length > 0) {
    const newest = merged.sort((a, b2) => (a.merged_at < b2.merged_at ? 1 : -1))[0];
    doomed.push({ name, sha, why: `PR #${newest.number} merged ${newest.merged_at}` });
    continue;
  }

  // SECOND SUFFICIENT CONDITION: CONTAINMENT. A branch can be fully absorbed into
  // the default branch without ever having had a pull request — the four tier
  // pointers `alpha`/`beta`/`dev`/`prod` here are exactly that, stale markers all
  // sitting on one old commit that the default branch long ago passed. Judging only
  // by PR state would refuse them forever and leave the branch list permanently
  // untidy, while judging by name would be a hand-typed exception list going stale
  // the moment someone adds a fifth.
  //
  // So ask git, through the compare endpoint: is this branch's tip already contained
  // in the default branch? `identical` or `behind` means yes — every commit on it is
  // reachable from the default branch, so deleting the ref discards a pointer and no
  // work. `ahead` or `diverged` means it carries commits that exist nowhere else, and
  // it is REFUSED with the count named. That is what keeps the two `codex/*` orphans
  // (1 and 4 unique commits) safe while releasing the four tier pointers.
  let cmp;
  try {
    cmp = await api(
      `/repos/${OWNER}/${REPO}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(name)}`,
    );
  } catch (err) {
    kept.push({ name, reason: `COMPARE FAILED — refusing to judge it (${err.message})` });
    continue;
  }
  if (cmp.status === "identical" || cmp.status === "behind") {
    doomed.push({
      name,
      sha,
      why: `no PR, but fully contained in ${defaultBranch} (${cmp.status})`,
    });
    continue;
  }

  const unmerged =
    prs.length === 0
      ? `no pull request, and ${cmp.ahead_by} commit(s) exist ONLY here (${cmp.status}) — this is unmerged work`
      : `PR(s) closed WITHOUT merging, and ${cmp.ahead_by} commit(s) exist ONLY here (${cmp.status})`;

  if (FORCE.has(name)) {
    forced.push({ name, sha, unique: cmp.ahead_by, note: unmerged });
    continue;
  }
  kept.push({ name, reason: unmerged });
}

// ── The recovery record, emitted BEFORE any deletion ──────────────────────────
const restore = [
  ...doomed.map((d) => `git push origin ${d.sha}:refs/heads/${shellQuote(d.name)}`),
  // A forced branch restores from its archive tag, which is a real ref and therefore
  // survives indefinitely — unlike a bare SHA, which only works until the unreferenced
  // object is collected. These are the ones that actually need a durable anchor.
  ...forced.map((f) => `git push origin ${shellQuote(`archive/${f.name}`)}:refs/heads/${shellQuote(f.name)}`),
].join("\n");

const summary = [
  `## Branch prune — ${APPLY ? "APPLIED" : "dry run"}`,
  "",
  `- ${branches.length} remote branches examined`,
  `- **${doomed.length}** released by the normal rules${APPLY ? " — deleted" : " — would be deleted"}`,
  ...(forced.length > 0
    ? [
        `- **${forced.length} FORCED** — carry unmerged commits and were named explicitly.`,
        `  Each is tagged \`archive/<branch>\` at its tip BEFORE deletion; if the tag fails, the branch stays.`,
      ]
    : []),
  `- ${kept.length} kept`,
  "",
  "### Restore any of these",
  "",
  "```bash",
  restore || "# nothing to restore — no branch qualified",
  "```",
  "",
  "### Kept, and why",
  "",
  ...kept.map((k) => `- ${mdCode(k.name)} — ${escapeHtml(k.reason)}`),
  "",
];

for (const d of doomed) console.log(`  prune  ${d.name}  — ${d.why}  ${d.sha}`);
for (const f of forced) {
  console.log(`  FORCE  ${f.name}  — ${f.unique} unique commit(s); archive tag first, then delete  ${f.sha}`);
}
for (const k of kept) console.log(`  keep   ${k.name}  — ${k.reason}`);

// ── Delete ────────────────────────────────────────────────────────────────────
let deleted = 0;
const failed = [];
if (APPLY) {
  for (const d of doomed) {
    try {
      await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeRefPath(d.name)}`, { method: "DELETE" });
      deleted += 1;
    } catch (err) {
      failed.push(`${d.name}: ${err.message}`);
    }
  }
  // FORCED branches: anchor, verify the anchor, and only then delete.
  //
  // The order is the safety property, not a nicety. These branches hold the only copy
  // of their commits; once the ref is gone the objects are unreferenced and a future
  // garbage collection takes them. Tagging first means the work outlives the branch.
  // A tag that fails to create leaves the branch ALONE — the alternative is deleting
  // unmerged work having just failed to save it, which is the worst outcome available.
  for (const f of forced) {
    const tag = `archive/${f.name}`;
    try {
      await api(`/repos/${OWNER}/${REPO}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: f.sha }),
      });
    } catch (err) {
      // Already existing is fine — the anchor is what matters, not who made it.
      if (!/already exists/i.test(err.message)) {
        failed.push(`${f.name}: archive tag FAILED, branch left in place (${err.message})`);
        continue;
      }
    }
    // Read the tag back. A POST that reported success but left no ref would mean
    // deleting on the strength of an anchor that is not there.
    let anchored = false;
    try {
      const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/tags/${encodeRefPath(tag)}`);
      anchored = ref?.object?.sha === f.sha;
    } catch {
      anchored = false;
    }
    if (!anchored) {
      failed.push(`${f.name}: archive tag not readable at ${f.sha}, branch left in place`);
      continue;
    }
    try {
      await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeRefPath(f.name)}`, { method: "DELETE" });
      deleted += 1;
      console.log(`  archived ${tag} then deleted ${f.name}`);
    } catch (err) {
      failed.push(`${f.name}: ${err.message}`);
    }
  }

  summary.push(`### Result`, "", `- deleted: ${deleted}`, `- failed: ${failed.length}`, "");
  for (const f of failed) summary.push(`- ${mdCode(f)}`);
  console.log(`\ndeleted=${deleted} failed=${failed.length}`);
} else {
  console.log(`\nDRY RUN — nothing was deleted. Re-run with apply=true to act on this plan.`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
}

// A failed deletion is a failed run. Partial success reported as green is the
// thing this repository keeps refusing to ship.
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length} deletion(s) failed — see above. The rest succeeded.`);
  process.exit(1);
}
