# Conflict Check: Boundary-aware operator parking

**Date:** 2026-07-29
**New stories:** `.docs/stories/park-in-flight-features-at-step-boundaries-after-p.md`
**Scanned against:** the complete story/spec/conflict inventory, with focused semantic review of
operator-park, daemon lifecycle, resume, reporting, interactive checkpoint, concurrent-group,
SHIP validation, and the live sibling deterministic BUILD verification contracts
**Result:** PASSED after resolution — zero blocking and zero newly accepted degrading conflicts

## Conflict: Whole-attempt parking versus scheduling-unit parking — RESOLVED

**Stories involved:** “Park verb edge semantics — idempotent re-park, mid-run park” versus the new
serial-drain, parallel-join, and block-next-unit stories
**Files:** `.docs/stories/operator-park-a-human-placed-halt-must-survive-the.md` versus
`.docs/stories/park-in-flight-features-at-step-boundaries-after-p.md`
**Root artifact:** `.docs/specs/2026-07-04-operator-park.md` FR-7 versus
`.docs/specs/2026-07-29-boundary-aware-operator-parking.md` FR-1..FR-4
**Type:** contradiction and sequencing
**Severity:** blocking
**Confidence:** 100% — both artifacts explicitly named incompatible stopping boundaries

### Description

The old contract allowed an entire already-running feature attempt to continue and applied the
park only after that attempt ended. The new operator-approved contract drains only the active
serial step or whole active parallel group, persists its ordinary outcome, and blocks the next
pending scheduling unit. Both boundaries cannot govern the same mid-run park.

### Resolution Options Presented

1. Amend the old FR-7 bullet and story criterion to the new scheduling-unit boundary while
   preserving every other operator-park behavior. **Recommended and selected.**
2. Restrict the new boundary to named steps/groups, leaving attempt-level behavior elsewhere.
3. Add separate attempt-level and scheduling-unit park modes.

### Operator Resolution

The operator selected Option 1 on 2026-07-29. The old PRD and story now state that the active
scheduling unit is not interrupted, its natural status is persisted, and later work is blocked.
The approved replacement ADR supersedes only the incompatible mid-attempt decision in the old ADR.

## Verified-compatible interactions

- **Concurrent-group joins (99%):** Existing SHIP validation stories require all started siblings
  to settle before a single-writer join. Boundary parking waits outside that join and therefore
  preserves its cancellation, failure, skip, retry, and status semantics.
- **Sibling deterministic BUILD group (95%):** Its approved live ADR routes the new BUILD fan-out
  through the same conductor scheduler and concurrent-group core. It inherits the boundary rule;
  the shared `conductor.ts` edit is rebase/merge coordination, not a behavioral conflict.
- **Interactive checkpoints (99%):** Both the existing validation-group contract and new parking
  contract exclude interactive mode, so neither moves nor bypasses an interactive checkpoint.
- **Resume and event-driven wake (98%):** Persisted lifecycle state remains resume authority. A
  typed intentional parked result does not add a HALT watcher or create a second wake route.
- **Daemon pause/stop/SIGTERM (98%):** Global daemon lifecycle controls and lock-draining behavior
  use different commands and state; feature-scoped operator parking neither terminates a process
  nor changes the global drain contract.
- **Auth/readiness parks (97%):** Provider-auth recovery uses its existing bounded internal park
  lifecycle. The new behavior is scoped to the explicit repo-root operator-park marker and does
  not change provider retry or auth recovery.
- **Reporting (98%):** The provider-neutral boundary event adds a distinct lifecycle observation;
  it does not claim DONE, write HALT, or replace existing step/group events.

## Five-type re-check

- **Contradiction:** none after the old FR-7 and story amendment.
- **Behavioral overlap:** compatible; all operator-park paths retain the same marker and the new
  rule changes only in-attempt scheduling progression.
- **State conflict:** none; natural lifecycle status remains authoritative and no second durable
  park state is introduced.
- **Resource contention:** none; one bounded read uses the existing repo-root marker authority.
- **Sequencing conflict:** none; active unit persistence/join precedes the next-unit park decision.

## Gate

Conflict check passed. Zero blocking conflicts remain. The implementation plan must retain the
existing operator-park terminology coordination note and rebase onto the sibling deterministic
BUILD-group work if it lands first.
