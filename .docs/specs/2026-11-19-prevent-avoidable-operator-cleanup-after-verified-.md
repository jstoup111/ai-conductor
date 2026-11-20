# Resume approved builds after verified rebase completion

**Status:** Approved

**Date:** 2026-11-19

## Problem and scope

Today an operator can finish a rebase and still have to clear the build halt by hand. This feature removes that cleanup for approved builds. Active conflict resolution, unrelated halt causes, issue selection, and waivers are outside scope. [Recovery runbook](../../docs/runbooks/stalled-or-stuck-feature.md#a-completed-rebase-still-appears-halted)

## Functional Requirements

- **FR-1.** During ordinary daemon operation, resume when the sole blocker is a completed rebase, the current revision belongs to that attempt, and the existing rebase acceptance checks pass.
- **FR-2.** Honor an explicit operator park until release. Release makes the feature eligible for FR-1.
- **FR-3.** Keep the build halted and name the reason if the rebase is active, the checkout is dirty, or proof of the attempt, revision, or preserved feature content is missing or contradictory.
- **FR-4.** Preserve independent blockers, including ones raised during recovery. Authorization applies only to the affected feature and child.
- **FR-5.** Before delivery, rerun required downstream checks invalidated by the rebase.
- **FR-6.** After interruption or repeated evaluation, continue once and preserve completed work with valid evidence.

## Acceptance

Exercise the ordinary daemon path with an unchanged upstream revision. A verified recovery reaches the next required step with zero manual cleanup or waivers. Rechecking an unchanged blocker consumes zero build attempts. The same criteria apply across supported providers.

[Architecture decision](../decisions/adr-2026-11-19-verified-rebase-admission.md)
