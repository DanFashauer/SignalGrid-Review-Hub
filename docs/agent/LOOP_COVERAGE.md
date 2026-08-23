# The hiring loop — what it covers, and where it stops

**Basis: DR-016. Owner-directed 2026-08-23.** The loop is: do the work; if you
cannot complete it because no agent has the skill, evaluate whether that skill is
genuinely needed; if it is, hire an agent for it and return to the main loop.
Repeat until every assignment has someone who can do it.

This page is the loop's output. It is written after a run, not before one.

## Run 1 — 2026-08-23

**Input:** 38 open assignments in `docs/COMPANY_BUILD_PLAN.md`.

**Method:** compute which agent may write each surface, from
`docs/agent/agent-tiers.json`, and compare against where the open work lives.
Not from memory — the first version of this check was WRONG, reporting
`scripts/` as covered because it confused "a scope inside this directory" with
"this directory inside a scope". The corrected check is the one below.

### What the run found

`scripts/` holds 328 files. Only the 11 under `scripts/src/e2e/` had a Tier-2
owner. **317 files — every gate and every proof this company runs — could not be
written by any Tier-2 agent**, and that is where most open rows live. It was the
largest unowned surface in the tree by an order of magnitude.

### What it hired

| Hire | Tier | Boundary | Why |
|---|---|---|---|
| `gate-and-proof-engineer` | 2 | `scripts/` (e2e carved out) | The 317-file gap above. |
| `verdict-core-reader` | 3 | read-only | ~3,900 lines of decision core have no named reader in `review-coverage.json`. Closes build-plan row 42. |

### What the run had to fix in the rule itself

The first hire was impossible under the rule as written. Write scopes had to be
strictly disjoint, and `scripts/` contains `scripts/src/e2e/` — so the largest
unowned surface could not be given an owner at all. The rule was forbidding the
most ordinary shape an organisation has: a team owns a directory, one specialist
owns one subdirectory inside it.

Nesting is now allowed **when the inner scope names the outer one it is carved
out of**. The property the rule exists for is unchanged — for any path exactly
one agent owns it, and which one is written down rather than inferred. An
undeclared overlap still fails, and so does a carve-out naming a scope it does
not actually nest inside.

That limitation was found by trying to use the rule, one day after writing it.

## Where the loop stops, and why that is not a gap to fill

Some assignments cannot be given to an agent at all, because they need a person
who has a bank account, a legal identity, a vendor relationship, or an opinion
about the real world. Hiring for these would not be filling a gap; it would be
producing a confident answer where no answer is owned — the exact failure DR-015
puts above helpfulness.

These are the owner's, and the loop reports them rather than absorbing them:

- **Supply the billing numbers.** They live in the owner's private record and
  never enter this repository.
- **The Fleet Premium purchasing question** (dated). A spend decision.
- **Start the Intune/Entra trial.** Needs the owner's tenant and account.
- **Review the ledger-truncation article before it is published.** A judgement
  about what the company says in public, under his name.

An agent may prepare any of these to the edge — draft the article, price the
options, write the trial checklist — and must stop at the point where a person
is the one taking the consequence.

## Standing rule for the next run

The cheapest hire is always Tier 3, because something with no write tools cannot
collide with anything. Reach for a Tier 2 hire only when work genuinely needs to
change files, and when a disjoint boundary — or a declared carve-out — exists for
it. `scripts/check-agent-roster.mjs` enforces the shape; it does not decide
whether the hire was wise.
