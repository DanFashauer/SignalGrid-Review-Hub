#!/usr/bin/env bash
# =============================================================================
# sg-brain-link — make the owner's SignalGrid knowledge corpus (iCloud Drive)
# readable by the Mac lane's Claude sessions, without ever committing it.
#
# Run ONCE, from ANY directory:
#   bash /Users/danfashauer/Public/Projects/SignalGrid/SignalGrid-Review-Hub/scripts/mac/sg-brain-link.sh
#
# It uses absolute paths, so the current directory does not matter, and it is
# idempotent — run it again any time (after adding docs to iCloud) to refresh.
#
# WHAT IT DOES. The business/reference material — invention disclosures, product
# videos, API catalogs, PDFs, exports — lives in iCloud Drive, not in git, and it
# should stay that way: some of it is CONFIDENTIAL and the Review Hub is a
# public-safe repo. So instead of copying it in, this symlinks it to
# `reference/knowledge` INSIDE the repo and gitignores `reference/`. A Claude
# session on this Mac can then Read those files on demand for product/company
# context — the "brain" gains the knowledge — while git never sees a byte of it.
#
# The cloud lane cannot reach this Mac's iCloud, so this is Mac-local by nature;
# that is fine, because the corpus is the owner's source material, not shared code.
# =============================================================================
set -uo pipefail

REPO="/Users/danfashauer/Public/Projects/SignalGrid/SignalGrid-Review-Hub"
KNOWLEDGE="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents/SignalGrid"
REF="$REPO/reference"
LINK="$REF/knowledge"

[ -d "$REPO" ] || { echo "sg-brain-link: repo not found at $REPO" >&2; exit 1; }
if [ ! -d "$KNOWLEDGE" ]; then
  echo "sg-brain-link: iCloud knowledge folder not found:" >&2
  echo "  $KNOWLEDGE" >&2
  echo "  Is iCloud Drive signed in and 'Documents' available on this Mac?" >&2
  exit 1
fi

mkdir -p "$REF"
ln -sfn "$KNOWLEDGE" "$LINK"

# Never let any of it — least of all the confidential material — reach git.
GI="$REPO/.gitignore"
if ! grep -qxF "reference/" "$GI" 2>/dev/null; then
  printf '\n# Local knowledge corpus symlinked from iCloud by scripts/mac/sg-brain-link.sh.\n# NEVER committed: some of it is confidential and the Review Hub is public-safe.\nreference/\n' >> "$GI"
  echo "sg-brain-link: added 'reference/' to .gitignore"
fi

# A local pointer so any session that lands in the repo knows what this is.
cat > "$REF/README.md" <<EOF
# reference/knowledge → the owner's SignalGrid knowledge corpus

Symlink created by scripts/mac/sg-brain-link.sh, pointing at:

    $KNOWLEDGE

This is the Mac lane's on-demand business/reference knowledge — invention
disclosures, API/ecosystem catalogs, product videos, PDFs, exports. Read the files
here (\`reference/knowledge/…\`) when you need product or company context.

Gitignored on purpose: some of it is CONFIDENTIAL and the Review Hub is public-safe,
so none of it is ever committed. iCloud may keep some files as placeholders until
first read; opening one downloads it.
EOF

echo "sg-brain-link: linked reference/knowledge -> iCloud SignalGrid corpus"
COUNT="$(ls -1 "$LINK" 2>/dev/null | wc -l | tr -d ' ')"
echo "sg-brain-link: $COUNT item(s) now readable at $LINK"
echo "sg-brain-link: gitignored (nothing here is committed). Done."
