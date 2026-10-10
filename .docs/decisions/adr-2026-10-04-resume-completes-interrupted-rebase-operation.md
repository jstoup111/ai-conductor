# ADR: Resume completes an interrupted rebase operation and narrows the resume-time fence

**Date:** 2026-10-04
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer session for #2983
**Conforms to:** adr-2026-07-11-verdict-aware-resume-entry, adr-2026-08-16-restore-the-current-head-publication-fence,
adr-2026-07-26-rebase-tail-current-branch-before-publication

## Context

A file-changing rebase is a cross-file, non-transactional operation recorded on
`.pipeline/gates/rebase.json` as `rebaseOperation` (`status: applying | applied`, `transition`
{preserved, invalidated, reverified}, `replay`). `rebase.ts` first writes a provisional descriptor
(id `preparing-…`, empty transition); `applyRebaseTransition` (`rebase-transition.ts`) then writes
the full descriptor as `applying`, applies the state batch, stamps preserved gates with
`preservation.operationId`, and marks the record `applied` with `appliedAt`.

On resume, `Conductor.run()` calls `rebaseOperationPublicationBlocker` and halts `needs-human` on
any non-null result, before any step dispatches. That conflates three different conditions:

1. **Interrupted operation** (`applying`): today halts; recovery is manual. Completing it
   requires each preserved gate's `RebasePreservedCandidate.originalVerdictDigest`, which lives only
   in memory during `applyRebaseTransition` — after a crash a stamp-less old PASS is
   indistinguishable from a later verdict.
2. **Integrity fault** (malformed record, preserved PASS without its replay-bound stamp, absent or
   pre-`appliedAt` verdict on a preserved gate).
3. **Ordinary lifecycle state**: a preserved gate re-judged *after* `appliedAt` and found
   unsatisfied. This is exactly what the verdict-aware resume clamp (adr-2026-07-11) routes to —
   but the fence halts ahead of the clamp. Issue #2983: an operator's recorded over-scope accept in
   `HALT.cleared` was stranded ~9h because the prd_audit lap that harvests it could never dispatch.

## Options Considered

### Option A: Halt on everything (status quo)
- **Pros:** No change.
- **Cons:** Strands recorded operator decisions; manual recovery of interrupted operations.

### Option B: Complete interrupted operations by re-checking every preserved gate
- **Pros:** No record-format change.
- **Cons:** Discards preservation the operation legitimately earned; extra review laps after any crash.

### Option C: Persist preservation candidates on the operation record; complete by re-applying the recorded transition (CHOSEN)
- **Pros:** Completion is the same idempotent `applyRebaseTransition` call with the same operation id
  and the same candidate evidence, so a crash costs nothing it did not already cost; one completion
  code path for the normal and recovery cases.
- **Cons:** Additive record-format change; old records need a fallback.

## Decision

1. **The rebase operation record persists its preservation candidates.** `RebaseOperationRecord`
   gains an additive field carrying, for each preserved gate, the `RebasePreservedCandidate` data
   (`gate`, original judge identity, `originalVerdictDigest`, `relevantInputIdentities`), written in
   the same `applying` descriptor write that names the transition, before any state mutation.
   `validRebaseOperationRecord` accepts records with or without the field; when present, its gate
   set must equal `transition.preserved`.

> **Amended 2026-10-10 by #2943:** Stacked operation records carry `cause: 'feature-repair' | 'base-refresh'`; N=1 records omit it (`adr-2026-10-10-stacked-restack-journaled-replay` decision 10).
2. **Resume completes an `applying` operation instead of halting.** When resume finds
   `status: applying` with a valid full descriptor, it re-invokes `applyRebaseTransition` with the
   recorded id, replay, invalidated, reverified, preserved, and persisted candidates. The existing
   digest check decides per gate: an unchanged original verdict is stamped and preserved. A gate
   whose current verdict no longer matches its persisted digest is removed from the preserved set
   and handed to the existing post-rebase rerun-or-reuse rules (`applyRebaseVerdicts`): it is reused
   when its completion predicate mechanically re-verifies the current tree, otherwise invalidated
   for rerun. No completed operation names a preserved gate it did not stamp. Then resume proceeds
   through the normal clamp.

> **Amended 2026-10-10 by #2943:** The stack preflight recovers the restack journal first; while a journal exists it owns any `applying` record it wrote and classification is deferred until it reaches `applied` (`adr-2026-10-10-stacked-restack-journaled-replay` decision 7).
3. **Fallbacks are fail-closed re-checks, never preservation.** A provisional `preparing-…`
   descriptor (no transition yet) completes by invalidating every gate downstream of `rebase` with
   no preservation. A full `applying` descriptor without persisted candidates (written before this
   ADR) completes by invalidating its recorded `invalidated` ∪ `preserved` gates with no
   preservation. A completion whose `applyRebaseTransition` returns `refused` halts `needs-human`
   exactly as the normal path does.
4. **The resume-time fence blocks only integrity faults.** On resume, a preserved gate whose verdict
   is unsatisfied with `checkedAt > appliedAt` is ordinary lifecycle state and is left to the
   verdict-aware clamp. Malformed records, preserved PASS without its stamp, and absent or
   pre-`appliedAt` verdicts still halt `needs-human`. The fence exposes this as a discriminated
   classification; resume blocks only on the integrity kind.
5. **The finish fence is unchanged.** The `finish` completion predicate keeps the full
   `rebaseOperationPublicationBlocker` behavior and messages: nothing publishes while any preserved
   gate is unsatisfied, unstamped, or the operation is `applying`.
6. **Resume-fence halts name pending operator decisions.** When an integrity halt is written and a
   pending or recorded over-scope decision exists, the halt names the criterion, its recorded state,
   and the next action. The fence module stays free of prd-widening imports; the conductor composes
   the text from the existing widening stores.

## Consequences

### Positive
- Interrupted rebases self-heal on resume with no lost preservation.
- Recorded operator decisions reach their harvester; #2983's strand class is closed.
- One completion path for normal and recovery cases.

### Negative
- `RebaseOperationRecord` grows; records predating this ADR fall back to re-checking preserved gates once.
- Resume now mutates gate/state files before dispatch in the `applying` case (through the existing
  state-store port).

### Follow-up Actions
- [ ] Persist candidates in the `applying` descriptor write; widen `validRebaseOperationRecord`.
- [ ] Resume-entry completion of `applying` operations, including both fallbacks.
- [ ] Discriminated fence classification; resume blocks only integrity faults; finish unchanged.
- [ ] Decision-naming text for resume integrity halts.
