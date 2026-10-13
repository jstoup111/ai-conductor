# Complexity: Route whole-feature audit fixes to the owning stacked child (#2944)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | New: a ref-backed route record (items, owner, host, frozen allocation, per-host state, round receipt, event outbox); a repairing marker; a durable re-validation queue for closed children; cursor fields `routedRepair` and `revalidating`; an execution-child resolver; a committed `Child:` field on routed rem tasks; a schema'd `blocked-by-prerequisite` builder claim and an engine-owned residue-routing judgement |
| External integrations | None new. New git plumbing use: engine commits to a branch that is not checked out (CAS ref update), and a deterministic append-only merge of rem blocks in the shared plan during restack replay |
| Auth / permission surface | The commit-msg membership guard honours the committed `Child:` line and the route record's execution projection |
| State machines | The cursor gains `routedRepair` and `revalidating` fields that activate a closed child's region while keeping its closure. Stack preflight defers the auto-repair restack until that region closes. Closed children above the fix move from `wouldInvalidate` telemetry to real re-validation. Leaf gate state is parked while a lower child is repaired |
| Story count | ~12–15: owner derivation, residue judgement, cannot-host check before mutation, verified prerequisite fallback, route record and event, cursor routed-repair state and deferred restack, plan append on the child plus stack-wide id allocation and deterministic merge, committed `Child:` and durable membership, receipt bound to its child with one charge per budget, multi-target laps, upward re-validation and its bound, per-branch repair boundary, execution-child resolver, routed exit restack, N=1 parity |
| Files touched | ~25–35: `conductor.ts`, `remediation-append.ts`, `remediation-task-append.ts`, `artifacts.ts`, `child-cursor.ts`, `child-lifecycle.ts`, `restack/{stack-preflight,restack-plan,restack-replay,restack-transition,cascade-cap}.ts`, `rewind.ts`, `repair-restage.ts`, `repair-obligations.ts`, `task-progress.ts`, `autoheal.ts`, `kickback-ledger.ts`, `task-membership-check-cli.ts`, `task-cli.ts`, `guarded-engine-commit.ts`, `plan-slices.ts`, `types/events.ts`, plus `event-persister.ts`, `build-review-inputs.ts`, the prd-audit and architecture-review skills, and runbook docs |
| ADR work | A new ADR, `adr-2026-10-12-routed-whole-feature-repair`, amends eleven existing ADRs; its Amendments section lists each decision |

## Rationale

This spec is the foundation of a four-spec split (ADR decision 18): 17 tasks, with routing dark
behind a default-off setting. The tier stays L because the foundation changes the cursor contract
and every consumer of the child being worked, and because the approved ADR it lands is Large.


Large. This changes how closure refs, cursor state and the restack preflight interact. A mistake
silently mis-routes or loses a repair, or moves a closure past a half-built fix. It also changes
feature-wide budget settlement and repair-obligation freshness across branches, rewrites
remediation-append semantics on a shared plan that every branch carries, and amends eleven existing ADRs. Outcome 6 (the landing aid) was split to #3203 to keep this
feature buildable. Both adversarial reviews found crash-ordering holes that only a full architecture review will
settle.
