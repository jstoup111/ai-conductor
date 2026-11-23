# Implementation plan for verified rebase recovery

**Stories:** .docs/stories/prevent-avoidable-operator-cleanup-after-verified-.md
**Design:** [approved decision](../decisions/adr-2026-11-19-verified-rebase-admission.md)
**Conflict check:** [resolved](../conflicts/prevent-avoidable-operator-cleanup-after-verified-.md)

## Technical Approach

Bind automatic rebase-recovery resume to one verified replay attempt: the rebase writer persists the attempt's inputs and a generation-bound halt, verification checks the completed revision against those inputs, and the daemon's halted-feature maintenance pass reconciles and conditionally clears that exact halt under one owner.

## Tasks

Use scoped RED/GREEN checks for every task. Use local Git fixtures and controlled daemon dependencies for integration proof.

### Task 1: Classify and persist recoverable replay attempts

**Story:** Story 1
**Type:** infrastructure

**Steps:** At replay start, persist the immutable inputs and execution owner in feature-scoped operation state before Git moves HEAD. Publish the new halt disposition only for a matching attempt with durable inputs. Update every halt-class reader and writer inventory. Exercise the ordinary foreground and daemon-started replay entry points.

**Done when:**

- [test] The rebase writer binds rebase-recovery to a distinct generation, pre-replay tip, merge base, target, feature and child. A partial record, absent seed or legacy needs-human halt grants no automatic recovery.
- [test] Base-advance, episode-end, progress and dispatch retry paths retain rebase-recovery; unknown and needs-human remain retained. Kickback authorization cannot clear it.

**Files likely touched:**

- `src/conductor/src/engine/rebase.ts`
- `src/conductor/src/engine/halt-marker.ts`
- `src/conductor/src/types/halt.ts`
- `src/conductor/src/engine/halt-classification.ts`
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/test/engine/rebase.test.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`

**Dependencies:** none

### Task 2: Verify the completed revision

**Story:** Story 1
**Type:** negative-path

**Steps:** Extract completion verification from the normal replay path behind the Git runner. Use the immutable attempt inputs and the accepted replay content for the completed revision. Clean reconstruction can prove the exact tree; a conflicted replay needs revision-bound validation of the resolved intent. If that evidence is unavailable or Git fails, return the specific blocker. Never infer authorization from subject matches or a clean tree. Expose the reason through the existing halt diagnostics.

**Done when:**

- [test] On ordinary daemon evaluation an active rebase, dirty checkout, missing or contradictory attempt evidence, or unverifiable feature content each leaves the build halted and reports that specific condition; repeated evaluation spends zero build attempts.
- [test] The verifier rejects a clean revision with matching subjects and missing feature content, and accepts a completed revision whose preserved content and attempt identity are proven.

**Files likely touched:**

- `src/conductor/src/engine/rebase.ts`
- `src/conductor/src/engine/rebase-replay.ts`
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/test/engine/rebase-replay.test.ts`
- `src/conductor/test/engine/rebase.test.ts`

**Dependencies:** Task 1

### Task 3: Serialize admission against halt and ownership changes

**Story:** Story 2
**Type:** negative-path

**Steps:** Use one feature-scoped ownership boundary for conditional clear and competing halt/park mutations. Include flat features and stacked execution children. Under that boundary compare the live generation, current HEAD, park, execution owner and blockers. Revalidate scheduler ownership at dispatch. Exercise races using controlled barriers between verification and admission.

**Done when:**

- [test] A park present before verification or placed during it survives admission and yields zero dispatches; after explicit release ordinary scheduling resumes the verified feature without another halt clear.
- [test] For an independent blocker, replacement halt with identical wording, changed revision or changed execution child, admission rejects the earlier verification and preserves current state. Recovering one of two halted features leaves the other halt and dispatch count unchanged.

**Files likely touched:**

- `src/conductor/src/engine/halt-marker.ts`
- `src/conductor/src/engine/daemon-park-cli.ts`
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`

**Dependencies:** Task 2

### Task 4: Resume once through the ordinary daemon

**Story:** Story 3, Story 1
**Type:** happy-path

**Steps:** Wire the verifier into halted-feature maintenance at daemon startup and ordinary iterations. Apply the existing rebase transition before clearing exactly the matching halt. Persist consumption so a restart before or after clearing can finish admission once. Use the canonical event spine for the clear and the existing scheduler for dispatch. Update the completed-rebase runbook and README in this behavior change.

**Done when:**

- [test] With upstream unchanged, ordinary daemon evaluation of a verified completed rebase for the halted attempt starts the next required step without operator cleanup or waiver.
- [test] The rebase transition reruns the invalidated check on the recovered revision and retains the result of the still-valid completed check; a failed required rerun blocks delivery at the delivery gate.
- [test] On restart during transition recording or after clear before dispatch, evaluating the same attempt twice produces one effective continuation, executes the next required step once and preserves previously completed work with valid evidence.
- [test] The confirmed clear produces one halt_cleared event for the recovered attempt. The scheduler admits work only if current park, owner and revision still agree.

**Files likely touched:**

- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/src/engine/rebase-transition.ts`
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/src/types/events.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`
- `src/conductor/test/engine/rebase-transition.test.ts`
- `README.md`
- `docs/runbooks/stalled-or-stuck-feature.md`

**Dependencies:** Task 3

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a completed rebase for the halted attempt whose checks pass, when the daemon evaluates the feature with upstream unchanged, then the next required step starts without operator cleanup or a waiver. | 4 | "With upstream unchanged, ordinary daemon evaluation of a verified completed rebase for the halted attempt starts the next required step without operator cleanup or waiver." | diff-local |
| Story 1 negative: Given an active rebase, a dirty checkout, missing or contradictory attempt evidence, or a revision whose feature content cannot be verified, when the daemon evaluates the feature, then the build stays halted and reports the specific condition. | 2 | "On ordinary daemon evaluation an active rebase, dirty checkout, missing or contradictory attempt evidence, or unverifiable feature content each leaves the build halted and reports that specific condition; repeated evaluation spends zero build attempts." | diff-local |
| Story 2 happy: Given a verified feature parked by its operator, when the operator releases it, then ordinary scheduling can resume it without a separate halt clear. | 3 | "A park present before verification or placed during it survives admission and yields zero dispatches; after explicit release ordinary scheduling resumes the verified feature without another halt clear." | diff-local |
| Story 2 negative: Given a park already in effect or applied during verification, when recovery reaches admission, then the park survives and the feature receives zero dispatches. | 3 | "A park present before verification or placed during it survives admission and yields zero dispatches; after explicit release ordinary scheduling resumes the verified feature without another halt clear." | diff-local |
| Story 2 negative: Given another blocker, a replacement halt with identical wording, a changed revision, or a different execution child, when the daemon attempts to use the earlier verification, then it declines that continuation and preserves current state. | 3 | "For an independent blocker, replacement halt with identical wording, changed revision or changed execution child, admission rejects the earlier verification and preserves current state. Recovering one of two halted features leaves the other halt and dispatch count unchanged." | diff-local |
| Story 3 happy: Given a verified revision with one invalidated check and one still-valid check, when recovery completes, then the invalidated check runs against that revision and the completed check retains its result. | 4 | "The rebase transition reruns the invalidated check on the recovered revision and retains the result of the still-valid completed check; a failed required rerun blocks delivery at the delivery gate." | diff-local |
| Story 3 negative: Given the daemon stops while recording the transition or after clearing the halt but before dispatch, when it restarts and evaluates the same attempt twice, then only one continuation takes effect. | 4 | "On restart during transition recording or after clear before dispatch, evaluating the same attempt twice produces one effective continuation, executes the next required step once and preserves previously completed work with valid evidence." | diff-local |
| Story 3 negative: Given a required rerun fails, when the feature reaches its delivery gate, then delivery stays blocked by the failed check. | 4 | "The rebase transition reruns the invalidated check on the recovered revision and retains the result of the still-valid completed check; a failed required rerun blocks delivery at the delivery gate." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-2026-11-19-verified-rebase-admission#D1 | task | task-1 | The rebase writer binds rebase-recovery to a distinct generation, pre-replay tip, merge base, target, feature and child. A partial record, absent seed or legacy needs-human halt grants no automatic recovery. |
| adr-2026-11-19-verified-rebase-admission#D2 | task | task-2 | The verifier rejects a clean revision with matching subjects and missing feature content, and accepts a completed revision whose preserved content and attempt identity are proven. |
| adr-2026-11-19-verified-rebase-admission#D3 | task | task-4 | On restart during transition recording or after clear before dispatch, evaluating the same attempt twice produces one effective continuation, executes the next required step once and preserves previously completed work with valid evidence. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D1 | task | task-1 | The rebase writer binds rebase-recovery to a distinct generation, pre-replay tip, merge base, target, feature and child. A partial record, absent seed or legacy needs-human halt grants no automatic recovery. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D2 | task | task-1 | Base-advance, episode-end, progress and dispatch retry paths retain rebase-recovery; unknown and needs-human remain retained. Kickback authorization cannot clear it. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D5 | task | task-1 | Base-advance, episode-end, progress and dispatch retry paths retain rebase-recovery; unknown and needs-human remain retained. Kickback authorization cannot clear it. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D6 | task | task-1 | The rebase writer binds rebase-recovery to a distinct generation, pre-replay tip, merge base, target, feature and child. A partial record, absent seed or legacy needs-human halt grants no automatic recovery. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D3 | no-change | none | No migration of pre-boundary halts. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D4 | no-change | none | Canonical marker and class publication continues to fail closed on partial writes. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D7 | no-change | none | Backlog and generic retry scheduling retain their existing contracts. |
