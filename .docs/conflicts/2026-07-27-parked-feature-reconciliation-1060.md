# Conflict Report: Parked-Feature Reconciliation Sweep (#1060)

**Date:** 2026-07-27
**New stories:** `.docs/stories/parked-feature-reconciliation-1060.md`
**Result:** 4 conflicts found (2 blocking, 2 sequencing/contention) — ALL RESOLVED in this spec diff. Zero blocking conflicts remain.

## Conflict 1: Autonomous unpark vs. operator-park invariant — RESOLVED (blocking, contradiction)

**Stories:** "Fully-merged parked feature is auto-reconciled" vs. operator-park FR-7 (`operator-park-a-human-placed-halt-must-survive-the.md`) + PRD Non-Goals (`2026-07-04-operator-park.md:35`): "a park ends only by operator action"; grep-level Done-When that no daemon path removes `.daemon/parked/` markers.
**Root:** incompatible design/ADR → resolved at architecture level with an operator decision.
**Resolution (operator-directed, this session):** ship the full hybrid now. The operator-park PRD Non-Goals and FR-7 story are amended IN THIS DIFF with exactly one scoped exception: the guarded reconcile helper may remove the marker of an ancestry-proven-merged, record-on-main park under `reconcile_parked_auto_cleanup` (default on) or the operator verb. The grep assertion is re-scoped to "no daemon path outside the park-marker module and the guarded reconcile helper". All other autonomous unpark remains forbidden. Kill-switch `reconcile_parked_auto_cleanup: false` restores the prior invariant in full.

## Conflict 2: Shipped-record authorship vs. ST-916 enforcement — RESOLVED (blocking, state/authority)

**Stories:** merged-park reconciliation "writes the record if missing" vs. `durable-shipped-record-enforcement-and-backfill-916-936.md` ST-916-4/5 (records reach main only via a human-merged record-only repair PR derived from a proven merged implementation PR; zero invented records) and `content-aware-shipped-work-dedup-never-re-dispatch.md` Story 2 (record schema requires a real `pr` URL).
**Resolution:** the sweep/helper NEVER writes shipped records. Record-on-main becomes a deletion precondition; a missing record is delegated to the ST-916 repair-PR seam with the actual merged PR resolved via `gh`; unresolvable merged PR → report, zero writes, no cleanup. One record producer (ST-916), one deleter (this helper).

## Conflict 3: Worktree deletion vs. in-flight runs — RESOLVED (resource contention)

**Stories:** helper worktree removal vs. operator-park FR-7 "a park placed mid-run does not interrupt the running attempt" + `mid-loop-pipeline-wipe-549.md` Story 5 (no cleanup path removes an in-progress run's `.pipeline` root).
**Resolution:** the helper gains an in-flight guard — it refuses to remove a worktree whose `.pipeline/` belongs to an in-progress run, logged, retried next pass.

## Conflict 4: Unpark ordering vs. counter-reset contract — RESOLVED (sequencing)

**Stories:** helper ordering vs. `noevidenceattempts-persists-across-unpark-so-re-di.md` Scenario 1.3 and `auto-park-markers-written-to-the-worktree-s-daemon.md` ("marker removal only after a successful reset"; documented missing-worktree fallback).
**Resolution:** marker removal is the helper's LAST step, via the unpark implementation; the accepted missing-worktree fallback covers the removed-worktree case; a genuine reset failure leaves the marker (never half-unparked) and defers to the next pass.

## Compatible pairs examined (grounded clean verdicts)

halt-reconciliation sweep stories (pattern mirrored, additive); delta-only sweep logging (adopted); event-driven wake for parked/halted (watches `.pipeline/HALT`, disjoint state — helper should dispose any live watcher before worktree removal: noted for plan); park-all-dispatch-paths #651 (reinforcing); park/unpark root-resolution (inherited); auth/sandbox "park" stories (name collision only — credential loop, not markers); intake claim/brain-sweep closed-issue reconciliation (intake ledger only; shared sourceRef parser reused — this feature is its third consumer); content-aware shipped dedup Stories 3-5 (fed correctly by reconciled records); status-hides-completed + GATED dashboard specs (orphan label is intra-PARKED, precedence untouched; golden snapshots may need updates); mid-loop-pipeline-wipe Stories 1-4/6; engineer-worktree-isolation (`spec/` namespace, disjoint); bin-conduct unknown-subcommand guard (dependency — verb registered, in stories); owner-gate/multi-operator (out of scope per operator-park PRD; single-operator daemon — noted for plan).

## Pre-plan notes carried into `/plan`

1. Dispose any live HALT watcher for the slug before worktree removal.
2. Reuse the shared sourceRef parse (TR-5) — do not add a fourth parser.
3. Dashboard golden snapshots asserting PARKED line shape may need updating.
4. Keep `daemon.ts` edits minimal/additive (overlap-scan shows heavy unmerged-spec contention on that file): one optional dep + one call line.
