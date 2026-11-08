# Publication reviewer setup

**This document creates no accounts, grants no access and activates nothing.**
It describes the setup an administrator would carry out on the Mac so that a
separate reviewer account can use `scripts/mac/brain-publish-reviewer.mjs`. Nothing
here is installed by a script, nothing changes the lane tick, and following the
review steps does not publish anything. Publication remains the publisher's
`--publish` run, which this document does not start or authorize.

The interface the helper builds on is described in
[PUBLICATION_REVIEWER_INTERFACE.md](PUBLICATION_REVIEWER_INTERFACE.md).

## Who does what

| Role | Account | Does |
| --- | --- | --- |
| Publisher | the account that runs `scripts/mac/brain-proposal-pr.mjs` and owns `~/SignalGrid-Local-AI/brain-state/auto-publish-review` (mode 0700) | prepares a publication (without `--publish`) and later reads the clearance |
| Worker | the account that owns the local-brain worker checkout | produced the change; never reviews it |
| Reviewer | a separate, standard (non-administrator) macOS account | reads the prepared commit, decides, and writes the clearance |
| Administrator | an account with `sudo` | creates the reviewer account, the `clearances/` directory and the ACL grants below |

The reviewer must differ from both the publisher and the worker-checkout owner.
The helper refuses to write when the reviewer uid equals the request's
`worker_uid`, and refuses to run as root. The publisher's reader separately
refuses a `clearances/` directory owned by the publisher itself.

## 1. The reviewer account (administrator)

Create a standard account, for example `sgreview`, with System Settings → Users &
Groups, or:

```bash
sudo sysadminctl -addUser sgreview -fullName "SignalGrid publication reviewer" -password -
```

Do not make it an administrator. It needs its own clone of this repository at a
revision whose `scripts/mac/brain-proposal-pr.mjs` is byte-identical to the
publisher's. The helper compares that file's SHA-256 with the request's
`publisher_sha256` and refuses on a mismatch. The reviewer should not run the
helper from the publisher's checkout, because the publisher can change files
there. The helper needs Node only, without `pnpm install`.

The examples below use these names. Substitute the real ones:

```bash
PUBLISHER_HOME=/Users/publisher
STATE="$PUBLISHER_HOME/SignalGrid-Local-AI/brain-state/auto-publish-review"
REPO="$PUBLISHER_HOME/SignalGrid-Review-Hub"   # the publisher's checkout
```

## 2. Search access to `auto-publish-review` (administrator)

The publisher's reader requires `auto-publish-review` to stay publisher-owned
with mode 0700. The reviewer reaches `clearances/` inside it through an ACL that
grants **search only**, with no inheritance flags:

```bash
sudo chmod +a "user:sgreview allow search" "$STATE"
```

If an ancestor (`$PUBLISHER_HOME/SignalGrid-Local-AI` or `.../brain-state`) does
not already let the reviewer through, grant `search` on that directory the same
way. Grant nothing broader. Check the result:

```bash
sudo -u sgreview /bin/test -x "$STATE" && echo "reviewer can search auto-publish-review"
ls -led "$STATE"    # mode stays drwx------; the + and the ACL line are the search grant
```

## 3. The `clearances/` directory (administrator)

The reviewer cannot create a directory inside a publisher-owned 0700 directory,
so an administrator creates it and hands it over:

```bash
sudo mkdir "$STATE/clearances"
sudo chown sgreview:staff "$STATE/clearances"
sudo chmod 0711 "$STATE/clearances"
sudo chmod -N "$STATE/clearances"
ls -led "$STATE/clearances"
```

The last command must print exactly one line, beginning `drwx--x--x`, owned by
`sgreview`, with no `+` after the mode and no ACL entry lines. Mode 0711 lets
only the reviewer write. Group and other users get search only, so the publisher
can open the files by exact name but cannot list or change them. The helper
refuses any other owner, any mode other than 0711, and, on macOS, any ACL on the
directory or on a file it has just written.

## 4. Read access to the publisher's object store (administrator)

Preparation removes its temporary worktree. The prepared commit stays in the
publisher's object store and is usually unreachable from any ref. The reviewer
needs read access to that store, and to nothing else in the checkout:

```bash
sudo chmod +a "user:sgreview allow search" "$PUBLISHER_HOME" "$REPO" "$REPO/.git"
sudo chmod -R +a "user:sgreview allow list,search,read,readattr,readextattr,readsecurity,file_inherit,directory_inherit" "$REPO/.git/objects"
```

The inheritance flags let objects written by later preparations remain readable.
The grant contains no write rights. The helper reads objects through a temporary
Git directory of its own (`GIT_OBJECT_DIRECTORY`), so it never reads the
publisher repository's config, hooks or attributes. It does not need
`safe.directory` for the same reason.

**Retention during the review window.** From preparation until the publisher's
`--publish` run, do not run `git gc`, `git prune`, `git maintenance run` or
`git repack -d` in the publisher's repository, and do not set `gc.pruneExpire`
to `now`. An automatic `gc --auto` keeps unreachable objects younger than
`gc.pruneExpire` (two weeks by default), which is longer than a clearance can
live. Check that nothing is scheduled:

```bash
git -C "$REPO" config --get gc.pruneExpire          # unset, or not "now"
git config --global --get-all maintenance.repo      # the publisher repository should not be listed
```

If an object has been pruned, the helper reports that the prepared commit is
not readable. Prepare the publication again. Never re-create the object by hand.

## 5. Prepare, review and write a clearance

**Publisher account, prepare (no `--publish`):**

```bash
cd "$REPO"
node scripts/mac/brain-proposal-pr.mjs --job <id> > /Users/Shared/signalgrid-review/<id>.prepared.log
```

The log contains the `SIGNALGRID_PUBLICATION_PRIVACY_REQUEST ` and
`SIGNALGRID_PUBLICATION_PREPARED_METADATA ` lines. Any channel can carry it to
the reviewer because it carries no authority. The helper binds the request to
the metadata and the objects, and the publisher later binds the clearance to the
actual job, sources, publisher and artifact.

**Reviewer account, check the binding and the objects:**

```bash
cd ~/SignalGrid-Review-Hub     # the reviewer's own clone, see section 1
node scripts/mac/brain-publish-reviewer.mjs --check \
  --prepared /Users/Shared/signalgrid-review/<id>.prepared.log --repo "$REPO"
```

**Reviewer account, read what would be published:**

```bash
node scripts/mac/brain-publish-reviewer.mjs --show \
  --prepared /Users/Shared/signalgrid-review/<id>.prepared.log --repo "$REPO" | less
```

This prints the exact PR title and body, then the prepared commit and its full
patch. Terminal control characters, carriage returns and bidirectional or
zero-width marks are printed as visible `\u{…}` escapes.

**Reviewer account, record the decisions.** The helper never decides. Write a
review-input file in your own words:

```json
{
  "format": "signalgrid-publication-review-input/v1",
  "source_review":   { "system": "claude", "decision": "public_only", "summary": "What sources you checked and what you found." },
  "artifact_review": { "system": "claude", "decision": "public_safe", "summary": "What you read in the title, body and patch, and what you found." }
}
```

`system` names who reviewed (`codex`, `claude` or `owner`, the values the
publisher's validator accepts). Both summaries must be non-empty. No decision is
assumed by default. A source review clears only with `public_only`, and an
artifact review clears only with `public_safe`. Any other decision writes
nothing. The six flags `--source-system`, `--source-decision`,
`--source-summary`, `--artifact-system`, `--artifact-decision` and
`--artifact-summary` can replace the file. They cannot be mixed with it.

**Reviewer account, write the clearance:**

```bash
node scripts/mac/brain-publish-reviewer.mjs --write \
  --prepared /Users/Shared/signalgrid-review/<id>.prepared.log --repo "$REPO" \
  --review-input ~/review-<id>.json \
  --clearances "$STATE/clearances" --ttl-minutes 30
ls -le "$STATE/clearances"
```

Before writing anything, the helper runs the publisher's exported
`validatePrivacyClearanceContent` on the exact bytes it is about to write, at the
current time. The validator enforces the expiry limit, which is one hour at the
time of writing, so a longer `--ttl-minutes` is refused. The helper then writes
`<id>.source_review.json`, `<id>.artifact_review.json` and `<id>.json`. Each is
mode 0444 and owned by the reviewer, and each is created under a temporary name
and linked into place. It never overwrites an existing file. To review the same
job again, the reviewer first removes its own three files for that job.

A clearance written this way authorizes nothing by itself. The publisher's
reader independently checks the reviewer account and its separation from the
publisher and worker. It also checks ownership, modes, ACLs, the actual job and
patch, the replay base, the tree and the prepared commit before any push.

## What the helper's self-test does and does not prove

`node scripts/mac/brain-publish-reviewer.mjs --self-test` runs in preflight and
CI with synthetic fixtures in a temporary directory. It checks the following:

- The publisher's validator accepts the files the helper writes.
- Each refusal fires and leaves no file behind.
- The prepared-object checks work against a real scratch repository.
- The publisher repository's own Git config never runs.

It does **not** run the publisher's real reader on those files. That reader is
unexported, reads only the publisher account's own `clearances/` path, and
refuses a directory owned by its own uid. Exercising it needs a second OS
account, which single-uid CI does not have. On Linux, the macOS ACL refusal is
exercised with injected `ls -lde` listings. A real ACL is applied only when the
self-test runs on macOS.
