# PRD: Boundary-aware operator parking

**Date:** 2026-07-29
**Status:** Approved
**Track:** Product
**Complexity:** M

## Problem / Background

Operator parking currently prevents future daemon attempts but does not stop an attempt already in progress. One attempt can span many lifecycle steps, so a park placed during an early step may still allow later steps—and their autonomous cost and state changes—to run before the daemon returns control to the operator.

The operator needs a narrower, safe stopping contract: do not interrupt work already executing, but settle that work completely and honor the park before any subsequent serial step or parallel group begins. The resulting step statuses must remain the source of truth so parking never disguises success, failure, or rework as a different outcome.

This PRD amends the existing Operator Park product contract's mid-run behavior. All other operator-park requirements remain in force.

## Goals & Non-Goals

**Goals**

- Bound the effect of an in-flight park to the end of the currently executing serial step or parallel group.
- Persist every active member's natural terminal status before stopping progression.
- Prevent all later lifecycle work and autonomous cost while the park remains active.
- Resume from the persisted lifecycle state without park-induced rework.
- Apply one behavior to current and future parallel groups.

**Non-Goals**

- Interrupting, cancelling, or terminating work in the middle of a step or parallel group.
- Allowing parking to choose, force, or rewrite a step's status.
- Changing interactive conduct runs, their checkpoints, or their navigation behavior.
- Changing how operators place or remove parks, how parked state is stored, or how parked features appear in the dashboard.
- Changing machine-failure, retry, kickback, or remediation semantics.

## Users / Personas

- **Operator:** needs a phone-drivable way to say “finish what is already running, then stop” and trust that no later work starts.
- **Daemon:** must settle active work, preserve its real outcome, and stop at a deterministic lifecycle boundary without misclassifying the feature as failed.

## Functional Requirements

- **FR-1 — Active serial step drains:** When a park becomes active while a daemon-managed serial step is running, that step is allowed to reach its normal terminal outcome; parking does not interrupt it mid-step.
- **FR-2 — Active parallel group joins:** When a park becomes active while a daemon-managed parallel group is running, every already-started group member is allowed to reach its normal terminal outcome and the group is allowed to finish joining; parking does not interrupt an individual member or partially settle the group.
- **FR-3 — Natural statuses persist:** Before the park stops progression, the terminal status of the active serial step or every active parallel-group member is durably recorded exactly as produced by normal lifecycle rules. Parking never forces a status and never leaves settled work marked in progress.
- **FR-4 — Next unit is blocked:** Once the active serial step or parallel group has settled, no subsequent lifecycle step or group begins while the park remains active.
- **FR-5 — Intentional park remains distinct:** Stopping at the boundary is reported as an intentional operator park, not as a new step failure, machine halt, or indeterminate error. A genuine failure produced by the active work retains its genuine status and diagnostics.
- **FR-6 — Resume preserves outcomes:** After unpark, the daemon resumes from the persisted lifecycle state. Work completed before the boundary is not repeated solely because of the park; failed, stale, skipped, and remediation outcomes continue through their existing lifecycle rules.
- **FR-7 — Boundary races fail safely:** A park observed after one unit settles but before the next begins blocks the next unit. If the daemon cannot determine whether the feature is still parked at that boundary, it does not begin later work.
- **FR-8 — All parallel groups share the contract:** The behavior applies to every daemon-managed parallel group, including groups added after this feature, without requiring park-specific exceptions per group.
- **FR-9 — Interactive runs are unchanged:** Interactive conduct runs do not gain boundary-parking behavior and continue to use their existing checkpoint and recovery controls.
- **FR-10 — Boundary is visible:** Daemon reporting identifies that progression stopped for an operator park and names the last settled serial step or parallel group so the operator can verify where execution paused.

## Non-Functional Requirements

- **No post-boundary cost:** After an active unit settles and while the park remains active, the feature starts no further model invocation, test run, publication action, or other lifecycle work.
- **State integrity:** A process restart after the boundary stop yields the same persisted step statuses and resume point as the original run.
- **Low overhead:** Runs with no active park add only bounded local work at lifecycle boundaries, not continuous polling or per-token monitoring.

## Acceptance Criteria / Success Metrics

- Parking during a serial step lets that step finish, records its normal status, and proves that the next step never starts.
- Parking during a parallel group lets every started member finish, records every member's normal status, completes the group join, and proves that the next lifecycle unit never starts.
- A successful step remains successful, a genuine failure remains failed with its diagnostics, and neither outcome is rewritten merely because a park was active.
- Unparking resumes from the persisted lifecycle state without rerunning successful work solely because of the park.
- A park arriving in the gap after status persistence but before the next unit begins still blocks that next unit.
- An indeterminate park-state check starts no later work.
- Interactive conduct behavior remains unchanged.
- Existing and newly introduced parallel groups satisfy the same boundary contract.

## Scope

### In Scope

- Daemon-managed serial-step and parallel-group park boundaries.
- Ordering between natural outcome persistence and stopping progression.
- Intentional parked outcome reporting and resume behavior.
- Product-contract amendments and operator documentation for the changed behavior.

### Out of Scope

- Mid-unit cancellation or process interruption.
- New park or unpark actions, options, permissions, or scheduling.
- Interactive-run parking.
- Changes to the membership, concurrency, or failure semantics of any parallel group.
- Automatic or conditional unpark behavior.

## Key Decisions & Rationale

- **The safe park boundary is the completed scheduling unit.** A serial step is one unit; a parallel group is one unit whose already-started members settle together. This preserves coherent statuses without allowing the rest of the feature to run.
- **Natural lifecycle status outranks park presentation.** Parking controls whether later work may start; it does not reinterpret work that already ran.
- **Parallel-group behavior is generic.** The operator should not need to know which groups exist today, and future groups should not reopen this safety gap.
- **Interactive execution is excluded.** Interactive runs already provide direct checkpoints and recovery choices; this feature addresses unattended daemon progression.

## Dependencies

- The approved Operator Park product contract, which this feature amends only for parks placed during an active daemon attempt.
- Existing lifecycle status persistence and resume behavior.
- Existing serial-step and parallel-group execution semantics.

## Open Questions

- How should the daemon represent an intentional boundary stop so it remains distinct from machine failure while preserving the active unit's real outcome?
- Where should the shared boundary decision live so serial steps and every parallel group obey one rule, including future groups?
- What ordering proof should guarantee that all applicable statuses are durable before the boundary stop is reported?
