# Architecture Review: Accept an operator-recorded resolution for a stacked restack conflict above the repaired child (#3421)
**Date:** 2026-10-25
**Inputs reviewed:**
- the explore output and track: `.docs/track/stacked-repair-restack-conflict-above-the-repaired.md`
  (technical track, approach B, core plus adjacent defects);
- the operator-approved diagram `.docs/architecture/stacked-repair-restack-conflict-above-the-repaired.md`;
- `adr-2026-10-10-stacked-restack-journaled-replay`;
- `adr-2026-10-12-routed-whole-feature-repair`;
- `adr-2026-10-24-operator-route-round-for-closed-stacked-children` (#3203, prerequisite);
- the source under `src/conductor/src/engine/restack/` and `routing/routed-exit.ts`.

**Mode:** lightweight (Medium tier). This covers sections 2 (feasibility) and 4 (alignment), plus the
required wiring surface.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Item | Assessment | Basis |
|---|---|---|
| **Conflict record at the halt** | Feasible. Both unresolved-conflict sites have the range, the parent and the candidates in scope. Those sites are `haltUnresolvedConflict` in `restack-executor.ts`, also used by the `rem-*` body mismatch, and the `conflict-unresolved` arm of `recoverRestackJournal` in `restack-recovery.ts`. The journal already writes blobs and compare-and-swap ref transactions (`writeRestackJournalBlob`, `journalStateUpdateLines`). | verified, 90% |
| **The record survives cleanup** | Feasible. `cleanJournal` deletes only the journal ref and `restack/staging/*`, so a ref outside staging survives. | verified, 95% |
| **CLI validation reuses the shipped guards** | Feasible. `checkPathOwnership(range, parent, tip, git)` already takes an explicit tip. FR-9 is a strict subject-presence check over `newParent..tip`. `featureCommitsPreserved` is not reused, because with no declarations it applies the legacy `supersededByBase` excuse and reads `ORIG_HEAD` (`rebase.ts`), as plan review PR-004 found. The candidate-subject selection lives in `restack-resolver.ts` (`replayCandidates`, `candidateSubjects`), and its subjects are recorded at the halt. `clearHaltAtomically` exists in `rewind.ts`. | verified, 90% |
| **Consumption replays cleanly** | Feasible. The parent is compared by tree because `committerStamp` dates every replay at journal creation, so replayed commit ids differ per run (`restack-executor.ts`). Rebuilding onto an identical tree is conflict-free (ADR A1). | verified, 95% |
| **Candidates are deterministic** | A feature-repair journal's comparison set is always empty (`comparisonCommits`), so the candidates of an unchanged range are reproducible. | verified, 90% |
| **Routed-exit resolver wiring** | Feasible. `requestRoutedExit` calls `runRestack` with no resolver. The conductor already holds `stepRunner.resolveRebaseConflict` and passes it at three restack sites in `conductor.ts`. The routed-exit input gains the two fields. | verified, 95% |
| **The routed halt keeps the restack's reason** | Feasible. `RunRestackResult`'s `halted` arm carries no detail today, and `restackDetail` returns the kind. The arm gains `detail`. | verified, 90% |
| **The routed round completes after consumption** | The re-dispatch reaches the routed exit again for the still-open round: #3414's 12:11Z dispatch re-planned and its 12:23Z dispatch applied (worktree `events.jsonl`). This is ADR A2. | inferred, 85% |
| **Stack, prerequisites, isolation** | No new dependency, no external service, no new port or database. The refs are per-repository under `refs/conductor/<slug>/`, so parallel worktrees do not collide. The command needs the `stack` CLI family and the dispatch lease from #3203, and the topology loader from #3365, both declared as depends-on. | verified |

## Alignment

- **Restack ADR decision 6 (hand-off).** The operator path applies exactly decision 6's acceptance
  guards: FR-8 against `newParent`, FR-9 over the recorded candidates, path ownership. Its output
  enters the journal as `resolved`, the same status a provider resolution gets. The ADR's "nothing
  moved" property is kept, because the command moves no branch. The amendment note on decision 6
  records the new record and the consumption.
- **Restack ADR decision 2 (ranges).** Unchanged. `planRestackRanges` is untouched, which was the
  reason approach A was rejected.
- **Restack ADR decision 4 (journal).** No new journal state. The conflict record is a separate ref
  family, and its lifecycle is tied to the applied transaction (ADR decision 5).
- **Routed ADR.** The routed exit's resolver omission violated restack decision 6 ("dispatches the
  existing resolver within its existing budget"). Fixing it is conformance, not a design change. The
  routed round's bookkeeping (`restacked` occurrence, queue, `returnToLeaf`) is unchanged.
- **#3203's ADR.**
  - The command follows that ADR's operator-command conventions without amending it. Decision 2
    says only that its four commands take the lease and leaves "other operator commands
    unchanged"; this ADR gives its own command the lease.
  - It follows decision 4's daemon-session refusal and decision 10's rule that a halt is cleared
    only by the command that resolves it.
  - The commit guard (decision 6) refuses only commits on the feature's branches, and
    `git rebase --continue` runs no pre-commit hook (tested). The scratch-branch recipe therefore
    works while the round's marker is present.
- **Teardown convention.** `featureConductorRefNames` deliberately uses finite names and never
  prefix discovery. The new refs join that list for every child id (ADR decision 5).
- **Event spine.** Additions are one union member and one refusal reason value. No sidecar,
  watcher or log channel is added.
- **State.** The record's fields are typed (`ChildId`, `CommitSha`, `RestackOpId`) and parsed
  fail-closed like the journal blob. A stale resolution is an explicit refusal reason, not a
  boolean.
- **Diagram.** It matches the design. No other `.docs/architecture/` diagram covers the restack
  conflict path.

## Wiring Surface

| New surface | Production caller |
|---|---|
| Conflict-record writer (`restack-conflict-record.ts`, new) | `haltUnresolvedConflict` in `runRestack`, and the `conflict-unresolved` arm of `recoverRestackJournal`. Both run under `runStackPreflight` and `requestRoutedExit` dispatch. |
| Resolution consumer (`restack-conflict-record.ts`) | `runRestack`'s range loop and `resumePlanned`'s range loop, before `replayChildRange` for a replayed child. |
| `ai-conductor stack restack-resolve` | Registered in the `stack` CLI family that #3203 adds (`cli.ts`, `cli-pre-dispatch.ts`, dispatched from `index.ts`). Operator-invoked. |
| Strict candidate-subject presence check (`missingCandidateSubjects`) | `stack restack-resolve` validation. |
| Applied-transaction deletion of the resolution and record refs | `restackTransactionBuilder.appliedTransactionLines`, used by `runRestack` and recovery. |
| Teardown names | `featureConductorRefNames`, already called by the single-slug reclaim helper. |
| `restack_resolution` event, and the `restack-resolution-stale` reason | Emitted by the CLI (`recorded`) and the consumer (`consumed`), persisted by the shipped `EventPersister`. The reason is emitted by `haltRestack`. |
| Routed-exit resolver and cap fields, and the `halted.detail` field | Passed by the conductor's `requestRoutedExit` call sites, and read by `restackDetail`. |

**Overlap scan (advisory):** `ai-conductor overlap-scan` reported only
`spec/routed-round-advance-carries-the-previous-host-s-e` on `routing/routed-exit.ts`. That branch is
already squash-merged to main as #3423, so the overlap is stale. In-flight #3203 and #3365 are
declared prerequisites (depends-on at land).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The subject-matched rewrite map leaves resolved commits as patch-id residue and the resolved child's evidence translation stalls re-validation (ADR A3) | Technical | Medium | High | A real-git test of the whole halt → resolve → consume → re-validate → leaf-gates path; the operator approves the assumption |
| The re-dispatch does not re-enter the routed exit for the open round (ADR A2) | Integration | Low | High | An integration test drives a routed conflict halt, the command and a second dispatch through to `restacked` |
| #3203's `stack` CLI family or lease changes shape before it ships | Integration | Medium | Medium | Depends-on edge on #3203. The plan names only #3203's published entry points |
| Two children above the origin, with a conflict on the higher one, give a parent that differs per run | Technical | Certain | Low | The tree comparison (decision 4), proven by a test with two replayed children |
| An operator resolution goes stale because the lower stack changed between the halt and the next dispatch | Data | Low | Low | The `restack-resolution-stale` halt names the mismatched field, and both refs are kept for a re-resolve |

## ADRs Created
- `adr-2026-10-25-operator-recorded-restack-conflict-resolution` (APPROVED by operator 2026-10-25).
  The structural prerequisite is met: it adds durable cross-dispatch state (the conflict record and
  resolution refs) and a new input to the restack journal's conflict hand-off. No approved ADR
  governs that state; `adr-2026-10-10-stacked-restack-journaled-replay` decision 6 governs the
  hand-off and is amended with an additive note.

## Conditions
1. **C1.** Assumptions A2 and A3 are operator-approved before the ADR is marked APPROVED. Each is
   proven by the real-git or integration test named in its row.
2. **C2.** The halt recipe and the runbook name a scratch-branch prefix outside `feat/`, so #3203's
   commit guard can never refuse it.
3. **C3.** The plan proves parity (ADR decision 9) with a no-resolution-ref test asserting today's
   replay path, and keeps the N=1 golden guard unchanged.
