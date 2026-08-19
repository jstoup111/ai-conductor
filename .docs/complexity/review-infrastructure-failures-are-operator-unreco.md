# Complexity: review-infrastructure-failures-are-operator-unreco

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One — an infrastructure-failure result gains a canonical identity so it can be dispositioned in the existing `.pipeline/build-review-dispositions.json` store. No new store, no new file format. |
| External integrations | None |
| Auth / permission surface | Reuses the existing `build-review accept` gate unchanged (interactive TTY + verified local operator). No new authority, no daemon-grantable path. |
| State machines | Yes — a bounded per-rubric infrastructure retry lane with a terminal exhaustion state that hands off to the operator decision. Distinct from, and must not disturb, the semantic kickback budget's own state. |
| Story count | ~7 (retry-without-budget-spend; retry exhaustion; operator acceptance of an exhausted infra failure; effective verdict unblocks on a matching disposition; semantic FAIL still blocks; reduced coverage stamped on lap + shipped evidence; refusal negatives) |
| Files touched | ~6 engine modules (`build-review-aggregate.ts`, `build-review-finding-identity.ts`, `build-review-cli.ts`, `step-runners.ts`, `conductor.ts`, `artifacts.ts`) plus docs (`docs/reference/cli.md`, `docs/explanation/gates.md`, a runbook) |
| New runtime code | Moderate — reducer branch, identity extension, retry accounting, evidence stamping |

## Rationale

Two coupled changes to the gate that decides whether a build ships, touching the verdict
reducer, the durable accepted-risk store, and the cross-dispatch kickback ledger. The
blast radius is real: a mistake here either lets a genuine semantic FAIL through or
re-creates the unrecoverable terminal state the feature exists to remove. That rules out
Small. It is not Large either — no new persistence format, no new external integration,
no new authority model, and every mechanism it needs (dispositions store, canonical
identity, absent-verdict re-dispatch, coverage fields on the effective verdict) already
exists and is being extended rather than invented. → **Medium.**

Medium tier: `/architecture-diagram` and `/architecture-review` run lightweight,
`/conflict-check` and `/coherence-check` both run.
