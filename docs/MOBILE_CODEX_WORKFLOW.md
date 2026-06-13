# Mobile-first Codex workflow

## Purpose

This workflow makes SignalGrid Review Hub usable from an iPhone in a Replit-style build loop: one task goes into Codex Web, Codex opens or updates a pull request, GitHub Actions validates it, Codex review catches issues, and the owner merges from GitHub Mobile when ready.

The PC is not the default workspace. It is a test bench for real-world gates that need local secrets, live authentication, browser/device checks, or private environments.

## Daily iPhone workflow

1. Paste one focused task into Codex Web.
2. Codex opens a pull request.
3. GitHub Actions runs validation.
4. Codex review runs or is requested.
5. User shares the PR summary/link with the ChatGPT review chat.
6. ChatGPT classifies the PR as merge-ready, focused fix, park, or ignore.
7. User merges from GitHub Mobile when the PR is ready.
8. PC is used only for real-world test gates.

## When to use Codex Web

Use Codex Web for normal Review Hub work:

- Documentation updates.
- Public-safe simulator or proof-harness changes.
- Fixture-backed validation.
- PR updates from review feedback.
- CI/test fixes that do not require local secrets.
- Guardrail, template, and workflow improvements.

## When to use GitHub Mobile

Use GitHub Mobile for owner actions:

- Reading the PR summary.
- Checking CI status.
- Reviewing Codex comments.
- Confirming that requested changes are resolved.
- Merging approved PRs.
- Leaving short comments that ask Codex to make a focused fix.

## When to use PC

Use the PC only when a task reaches a real-world test gate, such as:

- Microsoft Graph live sandbox login.
- Local `.env` secrets or tenant-specific configuration.
- Browser/device QA that cannot be verified in cloud CI.
- Real API smoke tests.
- Native app testing.
- Private customer-like data or protected implementation work that does not belong in public Review Hub.

## Standard task lifecycle

1. Start from `docs/CODEX_TASK_TEMPLATE.md` or a short prompt that references it.
2. Keep the task focused and public-safe.
3. Ask Codex to create a branch and PR.
4. Require validation commands from `docs/VALIDATION_COMMANDS.md`.
5. Wait for GitHub Actions.
6. Request Codex review if it did not run automatically.
7. Send the PR summary/link to the ChatGPT review chat.
8. Resolve only focused findings in the same PR.
9. Park unrelated ideas for a later task.
10. Merge from GitHub Mobile only after CI and review are acceptable.

## How to request Codex review

On the PR, comment:

```text
@codex review
```

Ask the review to focus on `AGENTS.md`, public-safety guardrails, deterministic proof coverage, approval gates, and unsafe claims.

## How to ask Codex to fix review feedback

In the same PR thread, comment with a narrow fix request:

```text
@codex fix the review finding about <specific issue>. Keep the change public-safe, do not add live API calls or secrets, and rerun the documented validation commands.
```

Do not combine unrelated improvements with review fixes.

## Merge rule

Merge only when:

- GitHub Actions pass or any limitation is clearly explained and accepted by the owner.
- Codex review is complete or the owner intentionally skips it for a low-risk docs-only change.
- The ChatGPT review chat classifies the PR as merge-ready.
- No unresolved public-safety, approval-gate, or deterministic-proof concern remains.

## Parking-lot rule for new ideas/screenshots

Screenshots and new product ideas are inputs, not automatic scope. Classify each item as:

- **Use now**: directly supports the current task.
- **Park**: useful later but unrelated to the current PR.
- **Ignore**: duplicate, unsafe, or outside Review Hub scope.

Parked ideas should become separate future tasks. Do not expand an active PR because a screenshot suggests a broader roadmap direction.
