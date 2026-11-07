# Conflict Check: Daemon preemption at step boundaries (#1929)

**Date:** 2026-11-07
**Stories checked:** `.docs/stories/daemon-cannot-switch-to-higher-priority-queued-wor.md`
(Stories 1–4) against all 672 files in `.docs/stories/`.
**ADR corpus:** repo-wide.
- Examined: `adr-2026-11-07-daemon-step-boundary-preemption`,
  `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`,
  `adr-2026-07-29-operator-park-scheduling-unit-boundary`,
  `adr-2026-10-15-per-dispatch-engine-pinned-executor`,
  `adr-2026-07-03-priority-from-linked-issue-labels`, `adr-2026-07-03-priority-fetch-fail-soft`,
  `adr-2026-07-13-park-all-dispatch-paths`, `adr-2026-08-06-honest-park-termination-boundary`,
  `adr-2026-10-14-dispatch-first-daemon-maintenance`, `adr-2026-08-27-daemon-dispatcher-executor-seam`.
- Narrowed out: every other approved ADR, because none governs daemon slot allocation, backlog
  priority, step-boundary stops, executor IPC, or non-done dispatch outcomes.

Related story files found by subject search (priority band, operator park, park boundary, slot,
non-done marker, in-flight):
- `2026-07-03-daemon-issue-priority-scheduling.md`
- `daemon-reconciliation-delays-first-feature-dispatc.md`
- `worktree-with-no-conduct-state-is-retained-as-pr-o.md`
- `daemon-park-does-not-stop-retries-inside-an-alread.md`
- `park-in-flight-features-at-step-boundaries-after-p.md`
- `enable-single-repo-daemon-concurrency-un-clamp-the.md`

**Result:** 1 blocking and 3 degrading conflicts, all resolved by the operator on 2026-11-07. The
blocking one was rooted in the design and was kicked back to architecture in amendment mode;
`adr-2026-11-07-daemon-step-boundary-preemption` decision 2 was revised in place. The three
degrading ones were fixed by replacing story text in place. The re-check is clean.

## Conflict: Preemption rank reverses the dispatcher's own ordering

**Stories involved:** Story 1 (this feature) vs Story 9 "Keep width-1 feature ordering unchanged"
**Files:** this feature's stories vs `.docs/stories/daemon-reconciliation-delays-first-feature-dispatc.md`
**Type:** oscillating
**Severity:** blocking
**Description:** Backlog order ranks `no-issue` first and `unlabeled` last, but the preemption rank
treats both as medium. With width 1 and a [`low`, `unlabeled`] or [`no-issue`, `critical`] backlog,
the dispatcher picks the first item and the next busy-pool pass preempts it. The claimed sequence
then differs from today's, which Story 9 forbids. Satisfying Story 1's rank rule breaks Story 9, and
keeping Story 9 forbids the rank rule.
**Resolution Options:**
1. Also require the arrival to come before the victim in backlog order.
2. Align backlog order with the preemption rank.
3. Accept the reversals and give Story 9 an exception.
**Recommendation and resolution:** Option 1, chosen by the operator. ADR decision 2 now requires
both conditions, and Story 1 gained two negative paths (an arrival ordered behind the victim).

## Conflict: Freed slot assumed to go to the arrival while repairs take freed slots first

**Stories involved:** Story 3 (this feature) vs Story 5 "Queue CI-fix and autoresolve as pooled
repairs that ship before new features"
**Files:** this feature's stories vs `.docs/stories/daemon-reconciliation-delays-first-feature-dispatc.md`
**Type:** overlap
**Severity:** degrading
**Description:** Story 3 said the freed slot dispatches the higher-ranked arrival. Story 5 gives
queued repairs every freed slot before any feature.
**Resolution:** Story 3 now conditions that criterion on no queued repair, and adds a criterion
that a queued repair takes the slot first.

## Conflict: Every non-done dispatch must leave a marker

**Stories involved:** Story 3 (this feature) vs Story 6 "A failed dispatch always leaves an
operator-clearable marker"
**Files:** this feature's stories vs `.docs/stories/worktree-with-no-conduct-state-is-retained-as-pr-o.md`
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "a dispatch that ends in any state other than `done` must leave a marker an operator can find and clear"
**Story opposing sentence (verbatim):** "Given a feature ends preempted, when its outcome is collected, then no operator park marker, no HALT marker and no HALT watcher is created, and the slug is neither completed nor parked in the pool."
**Description:** Story 6's narrative and the ADR's invariant cover every non-done state, and a
preempted outcome leaves no marker. Story 6's criteria themselves concern only errors.
**Resolution:** The ADR carries an additive amendment note (committed). Story 6's narrative now
excludes a scheduler preemption that resumes by backlog order.

## Conflict: "No park active" assumed to mean the next attempt always dispatches

**Stories involved:** Story 2 (this feature) vs Story 1 and Story 12 of
`daemon-park-does-not-stop-retries-inside-an-alread.md`
**Files:** this feature's stories vs `.docs/stories/daemon-park-does-not-stop-retries-inside-an-alread.md`
**Type:** overlap
**Severity:** degrading
**Description:** Story 1 there says the next attempt dispatches "exactly as today" whenever no park
is active, but a requested yield now also stops the next attempt. Story 12's "declined attempt"
would cover a yield-declined attempt that emits a preemption event, not an operator-park event.
**Resolution:** Story 1's precondition now reads "no park active and no preemption requested".
Story 12's precondition now reads "a park-declined attempt".

## Pairs examined clean

- `2026-07-03-daemon-issue-priority-scheduling.md`: preemption reads the same bands and never
  changes dispatch order; both directions hold.
- `park-in-flight-features-at-step-boundaries-after-p.md` and Story 3 of
  `daemon-park-does-not-stop-retries-inside-an-alread.md`: a running attempt is never interrupted
  by a park or a yield; both directions hold.
- `enable-single-repo-daemon-concurrency-un-clamp-the.md`: preemption leaves width resolution
  unchanged.
