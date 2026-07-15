#!/usr/bin/env bash
# 00 — Snapshot open issues from both source repos and print a migration
# checklist. Read-only: never edits or closes anything.
. "$(dirname "$0")/_env.sh"
require_gh

banner "Phase 6 · 00 — Issue triage snapshot"

OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/docs/consolidation"
OUT="$OUT_DIR/issues-snapshot.json"
mkdir -p "$OUT_DIR"

fields='number,title,state,labels,url,createdAt,updatedAt,author'

log "Fetching open issues from $REVIEWHUB_REPO and $DEV_REPO …"
rh=$(gh issue list --repo "$REVIEWHUB_REPO" --state open --limit 300 --json "$fields")
dv=$(gh issue list --repo "$DEV_REPO"        --state open --limit 300 --json "$fields")

if [ "$DRY_RUN" = "1" ]; then
  warn "[dry-run] would write snapshot to $OUT"
else
  # Tag each issue with its source repo, then combine.
  jq -n --argjson rh "$rh" --argjson dv "$dv" \
     --arg rhr "$REVIEWHUB_REPO" --arg dvr "$DEV_REPO" \
     '{ generated: "snapshot", sources: {
          ($rhr): ($rh | map(. + {source:$rhr})),
          ($dvr): ($dv | map(. + {source:$dvr})) } }' > "$OUT"
  ok "Wrote $OUT"
fi

echo ""
echo "Open issues — $REVIEWHUB_REPO:"
echo "$rh" | jq -r '.[] | "  #\(.number)  \(.title)  \(.url)"' || true
echo ""
echo "Open issues — $DEV_REPO:"
echo "$dv" | jq -r '.[] | "  #\(.number)  \(.title)  \(.url)"' || true

cat <<EOF

Next, for each issue worth keeping, migrate into the home repo:

  gh issue create --repo $HOME_REPO --title "<title>" \\
    --body "<body>

Migrated from <old-url>"

Then close the source issue with a pointer:

  gh issue close <n> --repo <source-repo> \\
    --comment "Migrated to $HOME_REPO — see <new-url>"

The snapshot ($OUT) is your auditable record of what existed at cutover.
EOF
