# ADR: Defer the feature-worktree reap until the shipped record is present on main

Status: APPROVED
Date: 2026-07-29
Refs: jstoup111/ai-conductor#1091, jstoup111/ai-conductor#1150
Related: adr-2026-07-03-committed-shipped-record-dispatch-dedup, adr-2026-07-04-resolution-worktree-lifecycle, adr-2026-07-27-ancestry-proven-park-reconciliation

## Context

`daemon-runner.ts:446`, on `makeRunFeature`'s `outcome.done` happy path, calls
`teardownWorktree(worktree, false)` — a hard `git worktree remove --force`
(`daemon-deps.ts:125-131`) — as soon as the implementation PR is **opened**. Sequencing at
`:405-446` is: cleanup halt presentation → `enrollWatch` → `markProcessed` → reap. The only
precondition is `shipmentFailureReason`, which binds the shipped record to the **PR head commit**
(`shipment-evidence.ts:74-85`, `resolveImplementationPrBinding`); nothing on that path consults
`main`, `origin/main`, or PR `state`/`mergedAt`.

When the PR then does not merge — a human closes it, review rejects it, CI rework is abandoned,
conflicts win — the branch survives but `.worktrees/<slug>/.pipeline/` is gone. That is the failure
this repo's own `CLAUDE.md` (Daemon Operations Safety, rule 3) already codifies as prose, and it was
observed live on 2026-07-29 on feature `step-completion-globs-are-feature-unscoped-so-anot`: finish
succeeded and committed its shipped record, the worktree was removed under the still-running
session, and the next dispatch died on `Path ... does not exist`, burning the retry ladder into a
halt.

Scope was materially reduced before this decision by PR #1118 (merged 2026-07-28, closing #1102),
which reconstructs `task-status.json` from plan headings plus `Task:` trailers. What #1118
**deliberately refuses** to reconstruct is the remaining loss surface: `HALT`, `HALT.class`,
`QUARANTINE`, `DONE`, `finish-choice`, `version-approval`, `conduct-state.json`, `gates/*.json`,
`protected-artifact-seal.json`, `events.jsonl`/`otel.jsonl` — "synthesizing one lets unearned work
pass a gate."

## Options

- **A. Defer the reap to the mergeable sweep, gated on the shipped record being present on main
  (chosen).**
- **B. Close #1091 as subsumed by #564 (relocate run-state out of the worktree).** Rejected. #1118
  already delivered the largest slice, but the artifacts above still die by design, so removal is
  not yet harmless; and the core defect survives #564 — the daemon would still
  `git worktree remove --force` a directory a live session is using. Sequencing also disfavours it:
  #564 is size L / v1.0 and its spec PR #770 is not merged, while #1091 is priority: critical /
  v1.0.
- **C. Minimal interlock — refuse to delete a worktree holding an active session lease.** A genuine
  alternative and the smallest change that stops the acute crash (~2-3h), but it delivers only part
  of the remediation outcome and none of retention correctness, cleanup-once-on-main,
  retain-vs-reap observability, or abandoned-worktree reclaim. Retained as the fallback if A proves
  too large in planning; the lease interlock is complementary to A, not contradictory.

## Decision

1. **Remove the reap from the runner's happy path.** `daemon-runner.ts` no longer calls
   `teardownWorktree` on `outcome.done`. The worktree and its full `.pipeline/` state survive
   PR-open. `enrollWatch` and `markProcessed` are unchanged and still run.

2. **The mergeable sweep owns the reap.** `mergeable-sweep.ts` already visits every watched PR and
   is the component that observes terminal PR state, so the reap moves onto its `MERGED` branch.
   `WatchEntry` carries `{prUrl, slug, repoCwd}`, which is everything the reap needs to resolve
   `.worktrees/<slug>` — no new registry field.

3. **The reap gate is file presence at path on `origin/main`, never ancestry, never `mergedAt`.**
   After an explicit fetch, `git cat-file -e origin/main:.docs/shipped/<slug>.md` decides. Verified
   empirically on 2026-07-29 against squash-merged PR #1138: the `cat-file` probe finds the record,
   while `git merge-base --is-ancestor feat/daemon/<slug> origin/main` is **false** — squash-merge
   rewrites history, so an ancestry proof of "reached main" is unreachable for this repo's merge
   style (this is exactly the trap #1114 records). `mergedAt` was rejected as the primary gate
   because it asserts GitHub PR state rather than the content of the tree the daemon will build
   from; being *in that tree* is the property that actually matters.

4. **MERGED and CLOSED-unmerged are separated.** `mergeable-sweep.ts` currently prunes both
   identically (FR-13). Under this decision only `MERGED` enters the reap gate. `CLOSED` (unmerged)
   and `NOTFOUND` prune the registry entry — there is no longer a PR to label — but **retain** the
   worktree, because a rejected PR is precisely the case where the build evidence is still needed.
   Those slugs become operator-reclaimable.

5. **Every branch of the decision logs the driving condition** — `retained <slug> — reason: …` /
   `reaped <slug> — reason: shipped-record-on-main` — so an operator can distinguish a deliberate
   retention from a leak.

6. **Reclaim is an explicit single-slug operator verb**, surfaced by the daemon dashboard's
   retained-worktree category. Per Daemon Operations Safety rule 1 it operates on exactly one named
   slug, prints the path before removal, and never accepts a glob or a computed set. No retention
   cap and no TTL: measurement on 2026-07-29 showed the repo already carries 68 `.worktrees/`
   directories and 105 registered worktrees, overwhelmingly halted/errored features that retain
   worktrees today — retention for in-flight PRs is bounded additional pressure on a pre-existing
   leak, so a cap would be treating the wrong cause.

7. **The reap is idempotent and fail-open toward retention.** `teardownWorktree` is unchanged and
   already best-effort/non-throwing; the sweep re-evaluates the gate every pass, so a transient
   fetch or `gh` failure defers a reap rather than losing one, and never deletes on unknown state.

## Relationship to adjacent approved decisions

- **`adr-2026-07-03-committed-shipped-record-dispatch-dedup`** — unchanged and relied upon. This ADR
  adds a *second* reader of the same committed record (the sweep, main-scoped) beside the existing
  PR-head-scoped `evaluateShipmentEvidence`. The runner's evidence check is not modified.
- **`adr-2026-07-27-ancestry-proven-park-reconciliation`** — its rule 3 makes ancestry the sole
  deletion authority for the *parked-feature* helper. That is a different flow and is not changed
  here, but the #1138 measurement above indicates its ancestry predicate cannot prove
  "merged" for squash-merged branches. Recorded as a drift note against that ADR; out of scope for
  #1091 and not repaired by it.
- **`adr-2026-07-04-resolution-worktree-lifecycle`** — **conflict, accepted and descoped.** Its rule
  3 ("skip resolution for a slug whose build worktree currently exists") is implemented as Gate 6 of
  `isEligibleForResolve` (`autoresolve.ts:216-226`). Retention makes that gate fire on every open
  PR, suppressing automatic rebase-resolution — which is in direct tension with #1091's own
  negative-path outcome that a retained worktree must not block post-ship remediation. The operator
  was presented with three resolutions on 2026-07-29 and chose to **descope the repair to #1150**,
  shipping #1091's retention first. `ci-fix.ts` has no equivalent gate and is unaffected, so CI-fix
  remediation continues to work. This ADR does **not** supersede or amend
  `adr-2026-07-04-resolution-worktree-lifecycle`; #1150 owns that.

## Consequences

- The evidence-loss class in `CLAUDE.md` rule 3 becomes machinery instead of operator prose, for the
  PR-open-to-merge window.
- Resuming a closed-unmerged feature reads a real `.pipeline/`, so no false `no_task_progress` stall
  and no re-execution of completed tasks.
- Steady-state `.worktrees/` occupancy rises by roughly one directory per in-flight implementation
  PR, plus abandoned closed-unmerged features until an operator reclaims them.
- Automatic rebase-resolution of conflicted open PRs is suppressed from the moment this ships until
  #1150 lands. #1150 is milestoned **v1.1** while this feature is **v1.0**, so v1.0 ships with that
  suppression in force and conflicted open PRs resolved by hand. Knowingly accepted, not an
  oversight.
- Cleanup latency becomes one sweep interval after merge rather than immediate — acceptable, and the
  condition is now observable in the log.

## Verification of load-bearing claims

| Claim | Basis | Confidence |
|---|---|---|
| Reap fires at PR-open on the happy path, unguarded by main state | verified — `daemon-runner.ts:405-446`, `daemon-deps.ts:125-131` read directly | 99% |
| File-presence on `origin/main` survives squash-merge; ancestry does not | verified — probed against squash-merged PR #1138 on 2026-07-29 | 97% |
| `mergeable-sweep.ts` prunes MERGED and CLOSED identically today | verified — `mergeable-sweep.ts:270-280` | 99% |
| `WatchEntry` already carries the slug needed to resolve the worktree path | verified — `mergeable-sweep.ts` module header, `{prUrl, slug, repoCwd}` | 99% |
| Gate 6 will fire on every retained feature | verified — `autoresolve.ts:216-226`; candidates come only from the watch registry | 95% |
| `ci-fix.ts` has no build-worktree eligibility gate | verified — `evaluateEligibilityGates`, gates 1-5 read directly | 95% |
| #1118 refuses to reconstruct the listed artifacts | verified — PR #1118 merged 2026-07-28, stated non-goals | 90% |
| Retention is not the dominant driver of worktree disk pressure | verified — 68 `.worktrees/` dirs, 105 registered worktrees counted 2026-07-29 | 90% |

No unconfirmed load-bearing assumption remains. The single conflict discovered
(`adr-2026-07-04-resolution-worktree-lifecycle` Gate 6) was surfaced to the operator and resolved by
explicit decision before this ADR reached APPROVED.
