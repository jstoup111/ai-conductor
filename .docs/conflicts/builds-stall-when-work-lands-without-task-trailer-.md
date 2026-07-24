# Conflict Check: Commit-movement liveness floor (builds-stall-when-work-lands-without-task-trailer-)

**Date:** 2026-07-23
**New stories:** `.docs/stories/builds-stall-when-work-lands-without-task-trailer-.md` (6 stories, Accepted)
**Scope:** all `.docs/stories/*.md` swept by seam (stall breaker / `no_task_progress` semantics,
`countResolvedTasks` consumers, build_review authority, retry/kickback budgets, evidence
stamping); the C4-mandated #280/#569 pair read in full; #859/#773 ADR constraints re-checked.
**Result:** CLEAN — zero blocking conflicts; two degrading-level overlaps reconciled below
(operator-accepted), one historical-record note.

## Pairs examined (verified, not assumed)

1. **vs #569 `build-stall-remediation-skips-no-task-progress.md`** — OVERLAP, RECONCILED
   (confidence ~90%). Its Story 1 Given encodes the old trigger: "a build attempt that resolved
   no more tasks than the prior attempt so the breaker sets `stalled = 'no_task_progress'`".
   The liveness floor narrows that trigger with a conjunct (AND HEAD unmoved this attempt).
   Reconciliation: #569's fixtures drive stalls with **no commits** (the synthesized-prompt
   inputs it asserts — completion reason, `resolvedTasksBefore → After`, `zero_work_product`
   tags — all describe commit-less attempts), so every #569 scenario still fires identically
   under the narrowed trigger; its remediation-dispatch, budget, and fall-through semantics are
   pinned unchanged by new Story 5. The Given's implicit universe shrinks; no assertion in the
   file becomes false. Not a contradiction — a refinement, recorded here per C4 rather than
   silently overridden.

2. **vs #280 `daemon-halts-a-build-that-is-making-forward-progre.md`** — COMPATIBLE (confidence
   ~90%). All of its clauses key on count MOVEMENT (bypass on `after > before`, `lastResolvedCount`
   sidecar stamps, ceiling on progressing builds) — the floor touches only the count-PINNED branch.
   Its zero-net-progress clause (line 42) asserts such an attempt does not bypass the budget —
   still true: an unattributed-progress attempt consumes budget normally. New Story 5 pins the
   ceiling branch byte-for-byte.

3. **vs #859 `trailer-union-build-completion.md`** — COMPATIBLE (confidence ~95%). Its Story 4
   Given is parenthetically explicit: count unmoved "**(no new commits, no row changes)**" — a
   HEAD-pinned fixture that classifies identically under the floor, same reason string, same
   routing. The union fold (its Story 1) and predicate exit (Story 2) are untouched. ADR §2's
   count-comparison freeze holds (conjunct added, comparison unchanged); §4's no-wedge-class bar
   respected (two SHA equality checks, no reachability/diff reasoning).

4. **vs #773 `demote-task-stamping-to-telemetry.md`** — ALIGNED (confidence ~95%). The floor
   completes the demotion: the count loses its last terminal authority; `detectZeroWorkProduct`
   stays a pinned-false stub (new code does not consult it); no stamping machinery revived.

5. **vs `no-diff-task-evidence-stamp.md` (SHIPPED)** — DEGRADING OVERLAP, ACCEPTED (confidence
   ~85%). Its negative paths assert a refused/unstamped verification task leaves the build to
   "stall loudly rather than shipping." Under new Story 3, a build with real commits elsewhere
   now exhausts its budget and routes to `build_review` instead of stall-HALTing; the refusal
   surfaces as a review FAIL → kickback → (if unresolvable) kickback-budget HALT. The protected
   invariant — unverified work never ships silently — is preserved; the loud-failure *mechanism*
   changes from `no_task_progress` HALT to authority FAIL/kickback exhaustion. Note also that
   file's context predates #773 (it gates on `evidenceStamps`, machinery since deleted), so its
   mechanism text was already partially superseded. Accepted as degrading with this note;
   no story text rewritten (shipped record).

6. **vs `emit-intra-step-build-progress-and-stall-as-events.md` (#347)** — HISTORICAL RECORD
   (confidence ~90%). Its Done When "existing stall-breaker tests pass unmodified" bound ITS
   PR, not all future ones; the same clause was already outdated by #859's predicate rework.
   The floor's breaker-test changes are governed by the APPROVED
   `adr-2026-07-23-commit-movement-liveness-floor`. Its `build_stall` emission continues to
   fire on genuine stalls (Story 5).

7. **vs unmerged spec branches touching `conductor.ts`** (overlap-scan advisory:
   `fresh-build-dispatch-halts-immediately-with-attrib`, `global-dispatch-circuit-breaker`, et
   al.) — NO STORY-LEVEL CONFLICT FOUND (confidence ~80%). Their story files in this tree carry
   no `no_task_progress`/resolved-count clauses (grep-verified empty). File-level merge
   contention on the retry loop remains possible; flagged for `/plan` sequencing, not a story
   conflict.

## Conflict types checked

Contradiction, behavioral overlap, state conflict, resource contention, sequencing — all five
swept across the pairs above. No impossible states: the floor only narrows one classification
and adds one routing exit whose target (build_review) is the already-authoritative judge; no
two stories now assert different owners for the same decision.

## Dispositions

- Blocking: **0**
- Degrading, accepted with note: **1** (pair 5 — loud-failure mechanism change)
- Reconciled refinement, recorded per C4: **1** (pair 1 — #569 trigger narrowing)
- Historical-record notes: **1** (pair 6)

Proceed to `/plan`.
