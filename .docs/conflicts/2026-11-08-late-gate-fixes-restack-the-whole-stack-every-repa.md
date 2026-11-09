# Conflict Check: Routed audit fixes fold onto owners before publish (#3653)

**Date:** 2026-11-08
**New stories:** `.docs/stories/late-gate-fixes-restack-the-whole-stack-every-repa.md` (Stories 1–9)
**Result:** PASSED after resolution. Zero blocking conflicts remain, and one degrading conflict is
accepted (C11).

## ADR corpus

**Examined, because their subjects overlap these stories:**
- `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish`
- `adr-2026-10-12-routed-whole-feature-repair`
- `adr-2026-10-10-stacked-restack-journaled-replay`
- `adr-2026-10-17-stacked-feature-publication-as-native-stack`
- `adr-2026-10-24-operator-route-round-for-closed-stacked-children`
- `adr-2026-10-25-operator-recorded-restack-conflict-resolution`
- `adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref`
- `adr-2026-10-03-stacked-child-plans-identity-and-state`
- `adr-014-otel-observability-exporter`

**Narrowed out:** every other APPROVED ADR in `.docs/decisions/`. Their subjects are unrelated: intake,
provider routing, release gates, PRD and as-built review, test isolation, and similar. No ADR was
excluded as superseded.

## Resolved conflicts

### C1: Host region branch and review base
- **Stories:** #3211 Stories 1 and 7 (`a-routed-fix-cannot-be-built-charged-and-reviewed-.md`)
  vs new Story 1.
- **Type and severity:** contradiction, blocking.
- **Old:** "when region entry runs, then the worktree is on `feat/c1/demo`".
- **New:** "the leaf branch stays checked out".
- **Resolution:** the old stories gain a scope line. They govern `operator` and `revalidate` rounds,
  and audit rounds admitted with the setting off.

### C2: Round stamp branch
- **Stories:** #3211 Story 2 vs new Story 2.
- **Type and severity:** contradiction, blocking.
- **Old:** "a commit on a branch other than the marker's host branch … no `Round:` trailer is
  added".
- **New:** "when a commit is made on the leaf, then its message carries `Round: <roundId>` and
  `Owner: c1`".
- **Resolution:** a scope line on #3211 Story 2. Under `execution: 'leaf'`, the leaf is the
  execution branch (fold ADR decision 4).

### C3: Repair obligations resolve on the leaf
- **Stories:** #3211 Story 6 vs fold ADR decision 3.
- **Type and severity:** contradiction (a coverage gap), blocking.
- **Old:** "when a commit with `Task: T1` lands on the leaf, then it does not resolve the
  obligation."
- **Resolution:**
  - a scope line on #3211 Story 6;
  - a new Story 1 criterion: a leaf commit stamped `Task: T1` resolves an obligation whose
    boundary branch is the leaf.

### C4: Prerequisite reroute
- **Stories:** #3211 Story 8 and #3550 Story 2 vs new Stories 1 and 5.
- **Type and severity:** contradiction, blocking.
- **Resolution:** scope lines on both old stories. New Story 1 refuses the claim as a failed attempt
  on a leaf-executed host. New Story 5 halts on a verified claim in a fold-produced revalidate
  round.

### C5: Routed exit restacks
- **Stories:**
  - #3212 Stories 1 and 2;
  - `refused-over-scope-rework-can-t-start-while-a-rout.md` Story 1;
  - #3605 Story 1;
  - #3590 Story 2.

  All of these are checked against new Story 1.
- **Type and severity:** contradiction, blocking.
- **Resolution:**
  - scope lines on each old story;
  - for the refused-over-scope story, adjudication-equals-clean-PASS parity holds with `done` and
    `deferred` in place of `restacked`.

### C6: Hand-moved closure check
- **Stories:** `hand-moved-closure-ref-with-a-live-repairing-marke.md` Story 1 vs new Story 1.
- **Type and severity:** state conflict, blocking.
- **Resolution:**
  - **ADR:** fold ADR decision 3 records the host's closure separately from the leaf entry tip.
  - **Old story:** the old criterion now reads "pinned that host's closure".
  - **New Story 1:** gains the recorded-closure criteria.

### C7: Stack-commit guard on the leaf
- **Stories:** #3605 Story 4 and #3203 Story 4 vs new Story 2.
- **Type and severity:** contradiction, blocking.
- **Resolution:**
  - **ADR:** fold ADR decision 3 says the guard admits the leaf and refuses the host's own branch
    under `execution: 'leaf'`. An operator leaf commit during the host's region folds with that
    host.
  - **#3605:** its criterion is scoped to a round executing on child 1's own branch.
  - **#3203:** its `feat/c2/demo` refusal still holds, because every non-execution child is
    refused.

### C8: Leaf rewritten between a deferred exit and the fold
- **Stories:**
  - `build-loop-cannot-complete-a-feature-child-by-chil.md` Story 14;
  - #3203 Story 8;
  - #3212 Stories 8 and 9.

  All of these are checked against the new boundary-range rule.
- **Type and severity:** state conflict, blocking.
- **Resolution:**
  - **ADR:** fold ADR decision 6 defers base refresh while any host is `deferred`. New decision 12
    remaps deferred boundary tips through each restack journal's commit map, and halts with
    `fold-boundary-lost` on a tip with no image.
  - **Stories:** new Story 9 covers both rules, and the build-loop criterion is qualified "and no
    routed host awaiting a fold".

### C9: Interactive rebase step no-op
- **Stories:** `rebase-resolution-skill.md` vs new Stories 3 and 5.
- **Type and severity:** contradiction, blocking.
- **Resolution:** the old criteria are qualified "with no routed host awaiting a fold".

### C10: No-op and no-commit leaf-executed hosts, and queue entries
- **Stories:** #3590 Story 2 and #3212 Stories 2 and 7 vs new Story 3.
- **Type and severity:** state conflict, degrading.
- **Resolution:**
  - **ADR:** fold ADR decision 5. A host is `deferred` only when its boundary range has commits,
    and frozen-block-only hosts are deferred. A leaf-executed exit acknowledges no queue entry,
    which is consumed as a `revalidate` round instead.
  - **Stories:** new Story 1 gains the matching criteria.

### C12: `stack rounds` inspection and close
- **Stories:** `operator-command-to-inspect-and-recover-wedged-rou.md` Story 3 vs new Story 3.
- **Type and severity:** overlap, blocking.
- **Resolution:** new fold ADR decision 13 says the listing shows execution and placement, and
  close treats a `deferred` host as settled without clearing it. New Story 8 gains both criteria.
  The old story's assertions still hold, because a deferred host counts as settled.

## Accepted degrading conflict

### C11: Open spec PR #3495 (`stacked-feature-cost-and-time-cannot-be-broken-dow`)
- **Type and severity:** sequencing and resource contention, degrading.
- **The overlap:** both specs extend `provider_attempt` and the provider execution context
  (`child` there, `restack` here), and both add a shipped-record block.
- **Resolution:**
  - new Story 7 places `## Restack` after `## Children` when present, otherwise after `## Time`;
  - new Story 7 adds a kpi parity criterion;
  - no blocked-by edge, by operator decision on 2026-11-08: both changes are additive, and the
    overlap is merge-order only.

## Compatible pairs examined

- `whole-feature-audit-fixes-cannot-land-in-the-stack` Stories 1, 6, 7, 15 and 16: N=1 parity holds,
  and no new ref family is added.
- #3211 Stories 3 and 4: verify-green runs on child 1's specs on the leaf, and settlement is
  unchanged.
- #3212 Stories 4, 6, 9 and 10: the rem-block union and the leaf return are unchanged.
- `stacked-repair-restack-conflict-above-the-repaired`: a fold conflict reuses its halt and recipe.
- `restack-cascade-cap-halts-l-tier-stacked-features-`: the fold is charged per target child.
- `routed-repair-opens-a-new-round-while-an-earlier-r`: there is no `built` host in leaf-executed
  rounds.
- `routed-remediation-skips-re-run-steps-on-stale-chi`: region steps re-run in child k's state.
- `restack-refuses-child-resolution-that-adapts-tests`: adapted paths apply to fold resolutions too
  (fold ADR decision 8).
- `stacked-features-cannot-be-published-reviewed-and-` Story 10: published stacks refuse routing.
- `rebase-base-refresh-revalidation-halts-needs-human`: `revalidate` runs on the child's own branch.
- `successful-stacked-restack-halts-on-a-stale-reopen`: its fixture has no routing.
- `halt-records-committed-on-stacked-child-branches-m` and build-loop Story 13: halt records stay
  on the leaf.
- `multi-child-feature-cannot-resume-after-an-operato` Story 3: leaf commits are not
  membership-checked.
- `admitted-whole-feature-fixes-in-a-stacked-feature-` Story 5: the marker field is additive.

## Re-check

Every blocking pair above was re-tested in both directions after resolution.
- With the setting off, and for `operator` and `revalidate` rounds, each old assertion holds and
  the new stories assert nothing that contradicts it.
- With the setting on for `audit` rounds, the new stories govern, and each old story's scope line
  excludes that case.
- No oscillating pair remains.
