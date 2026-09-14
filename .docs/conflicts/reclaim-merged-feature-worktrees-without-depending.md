# Conflict Check: Reclaim merged feature worktrees without depending on the mergeable watch registry (#1510)

**Date:** 2026-09-14
**Result:** CLEAN after one resolution — one blocking contradiction resolved by in-place story amendment; zero degrading conflicts accepted.

## Scope Reviewed

The inventory covered all 458 story files in `.docs/stories/`, prior reports in `.docs/conflicts/`, and the approved ADR corpus at `conflict_check.adr_corpus: repo_wide` (585 files in `.docs/decisions/`, every Decision section read by a delegated sweep earlier in this DECIDE pass; findings in `.pipeline/explore-notes.md`). Semantic comparison focused on the eight new stories against every story mentioning parked-feature reconciliation, the mergeable sweep's reap, retained worktrees, park markers, project teardown, shipped-record enforcement, engineer and resolution worktree lifecycles, provider-scratch cleanup, and the event spine.

All six conflict types were evaluated: contradiction, behavioral overlap, state conflict, resource contention, sequencing conflict, and oscillating conflict. Every pair sharing a behavior was tested in both directions.

### ADRs examined (subject overlap)

adr-2026-08-01-multi-proof-park-deletion-authority, adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main, adr-2026-07-27-ancestry-proven-park-reconciliation, adr-2026-08-07-worktree-removal-coverage-guard, adr-2026-08-07-project-teardown-hook-contract-and-containment, adr-2026-08-05-worktree-classification-evidence-derived-reasons, adr-2026-07-10-park-marker-main-root-resolution, adr-2026-07-13-park-all-dispatch-paths, adr-2026-07-28-total-halt-classification-legacy-boundary, adr-2026-08-23-committed-halt-record, adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-26-setup-once-per-worktree-marker, adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal, adr-2026-08-27-daemon-dispatcher-executor-seam, adr-2026-07-04-resolution-worktree-lifecycle, adr-2026-06-30-engineer-worktree-authoring-isolation, adr-2026-08-09-worktree-local-provider-scratch, adr-2026-09-11-github-operation-ownership, adr-2026-07-22-origin-refresh-before-engine-rebuild, adr-015-daemon-pr-labeling-sweep, adr-2026-07-11-pipeline-state-durability, adr-2026-06-29-shared-memory-store-placement-and-durability.

### ADRs narrowed out

Every other approved ADR in the corpus: no overlap with worktree lifecycle, deletion authority, park state, daemon sweeps, config keys, or the event spine. Supersession parsing excluded only unambiguously superseded records (adr-2026-07-04-operator-park-marker, adr-2026-07-30-finish-only-mergeability-gate); partially amended ADRs (07-27, 07-29, 08-01) were retained and compared.

## Conflict: Unconditional record-missing retention contradicts branch-kind reclamation

**Stories involved:** Story S2 "Fully-merged parked feature is auto-reconciled by default" vs Story 4 "The shipped-record precondition applies only to daemon branches"
**Files:** [.docs/stories/parked-feature-reconciliation-1060.md] vs [.docs/stories/reclaim-merged-feature-worktrees-without-depending.md]
**Type:** contradiction
**Severity:** blocking (on the input "a parked slug on a non-`feat/daemon-*` branch, proven merged, no shipped record")

**Description:** S2's negative path stated, for any ancestry-proven slug with no record on the base branch, "no worktree/branch/marker is removed this pass". Story 4 states a proven-merged candidate on `hotfix/x` or `spec/<slug>` with no record is reclaimed. For a parked slug on such a branch both cannot hold. Root: the approved amendment `adr-2026-08-01` D8 scopes the record precondition by branch kind; S2 predates it and was written when every parked slug was assumed to sit on `feature/<slug>`.

**Resolution Options:**
1. Amend S2 in place to scope its record-missing retention to `feat/daemon-*` branches (matches the approved ADR amendment).
2. Narrow Story 4 to non-parked candidates, leaving parked slugs under the unconditional rule (two rules in one helper).
3. Drop the branch-kind rule (reverts an operator decision; reclaims 10 of 67 here).

**Recommendation:** Option 1 because the approved ADR already decided the rule and one helper should carry one rule.

**Selected by operator:** Option 1. S2's second negative path and third Done-When item were replaced in place; no amendment record was added to the story artifact.

## Internal Consistency

- Story 8 originally asserted parked-only behavior identical to pre-change for every parked slug; that contradicted Story 4 on the same input as above. Its first happy-path criterion and its first Done-When item were scoped in place to parked slugs on `feat/daemon-*` branches.
- Story 2's in-flight exclusion wins over Story 4's reclamation; Story 2 states this explicitly in both directions.
- Story 7's `false` gate holds Story 4's reclamation for enumerated candidates while Story 8's parked path is unchanged; Story 7 states the interaction as a negative path.
- Story 1's union de-duplicates a slug that is both parked and registered; Story 8 asserts it is evaluated once.

## Findings (compatible)

- **Daemon reaps a feature worktree at PR open (#1091/#1150):** compatible. The registry-driven reap and its retention semantics are untouched; an entry dropped by the registry cap is now reclaimable through the enumerated path, which that story treated as permanently retained only because no other path existed.
- **Mergeable watch registry size cap:** compatible. The registry is neither read nor written by the new path.
- **Project-supplied teardown hook (#1329 family):** compatible. Every removal stays in `park-reconciliation.ts`, one of the three invitation points; Story 10 ("a new worktree-removal path cannot silently skip teardown") is satisfied because no new path exists.
- **Operator park single-writer:** compatible. Unpark still happens only inside the guarded helper, and only when a marker exists (Story 5).
- **Worktree with no conduct-state is retained (#1329):** compatible. `resolve-`/`engineer-` prefixes are excluded there for presentation and here for reclamation; the sweep does not read dashboard collections.
- **Auto-resolve open PR conflicts:** compatible. `resolve-*` worktrees are foreign-lifecycle and retained; a retained build worktree never blocks resolution, and a merged PR has no resolution to block.
- **Interrupted self-host runs leak provider homes:** compatible. "No new reaper is added" holds; scratch removal remains a consequence of the existing removal path. Sweep order (parked reconciliation before provider-scratch) is unchanged, and scratch lives inside the worktree under an excluded prefix.
- **Mid-loop pipeline wipe (#549):** compatible. Removal is scoped to one worktree path; the shared `.pipeline` root is never touched.
- **Durable shipped-record enforcement (#916/#936) and content-aware dedup:** compatible. Records are read, never written; the record-repair seam is still invoked for `feat/daemon-*` candidates.
- **Park all dispatch paths / park marker main-root resolution:** compatible. Park state is read through the existing primitives against the main root; a throwing read retains.

## Observed, not resolved (outside this spec's scope)

`parked-feature-reconciliation-1060` S2 and S4 place the in-flight refusal inside the guarded helper; the shipped helper deliberately removed that check (comment in `park-reconciliation.ts`: "No local-resume check runs here, deliberately"). The observable property — an in-flight worktree is never removed — is preserved by this spec at the sweep layer (Story 2). Reconciling those two accepted stories with the code is pre-existing drift and is recorded here for a later pass.

## Verify-Claims Verdict

CLEAR. The one recorded conflict is grounded in the quoted story text on both sides; every compatibility judgment cites the story, ADR, or current source it rests on. No unconfirmed load-bearing assumption was used.
