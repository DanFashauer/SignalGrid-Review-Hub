# Phase PR Evidence Bot

The Phase PR Evidence Bot creates a compact report for each scoped phase PR.

## Workflow

`.github/workflows/phase-pr-evidence.yml` runs on `pull_request` and `workflow_dispatch`. It installs dependencies, runs `phase:gate`, runs `phase:summary-check`, generates a phase PR report, and uploads the report as a named artifact.

## Permissions

The workflow uses default GitHub workflow authentication only. It requests read access to repository contents and pull requests. Write access to issues is reserved for future PR comment updates and is not used for external secrets.

## Report format

```text
PHASE_REPORT
phase_id:
risk_lane:
pr_number:
head_sha:
changed_source:
changed_files:
touches_docs:
touches_runtime:
touches_scripts:
touches_workflows:
touches_fixtures:
unsafe_claim_scan:
validation_expected:
workflow_artifacts_expected:
owner_action_required:
merge_recommendation:
next_phase:
END_PHASE_REPORT
```

## Merge interpretation

GREEN reports can be prepared for owner merge after passing checks. YELLOW reports require explicit owner approval. RED reports block by default in this public Review Hub.
