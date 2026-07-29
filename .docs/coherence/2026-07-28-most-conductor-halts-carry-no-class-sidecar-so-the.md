# Coherence: Total HALT classification with legacy compatibility

**Date:** 2026-07-28
**Plan:** `.docs/plans/2026-07-28-most-conductor-halts-carry-no-class-sidecar-so-the.md`
**Track:** technical
**Tier:** M

The technical track has no PRD, so the `fr` row class is correctly omitted. Intake outcomes, stories,
and tasks are all required and mapped below.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | Story 1 requires every production HALT path to persist exactly one reviewed writable class and mechanically rejects omission/bypass. |
| outcome | outcome-2 | story-1, story-3 | covered | Story 1 classifies judgment-required paths `needs-human`; Story 3 retains both `needs-human` and malformed current state without retry side effects. |
| outcome | outcome-3 | story-3 | covered | Story 3 preserves the canonical bounded clear-and-re-kick path for explicitly `mechanical` HALTs. |
| outcome | outcome-4 | story-1, story-2, story-3, story-4 | covered | The stories jointly require accurate writes, explicit legacy state, disposition diagnostics, and body/sidecar consistency. |
| story | story-1 | task-1, task-8, task-9, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17 | covered | Task 1 establishes the required contract; Tasks 8–16 migrate every inventoried funnel; Task 17 rejects future bypasses. |
| story | story-2 | task-2, task-3, task-4, task-5 | covered | Tasks 2–5 model legacy, implement success/failure migration behavior, and wire it under daemon ownership before work. |
| story | story-3 | task-2, task-6, task-7 | covered | Task 2 adds all read dispositions; Tasks 6–7 implement and pin exact retry/retain behavior and guard precedence. |
| story | story-4 | task-1, task-7 | covered | Task 1 owns safe replacement ordering; Task 7 pins clear idempotency and absence of retry side effects. |
| task | task-1 | story-1, story-4 | covered | Required writer and safe marker lifecycle directly support both cited stories. |
| task | task-2 | story-2, story-3 | covered | The four-way read type supports legacy preservation and sweep policy. |
| task | task-3 | story-2 | covered | Implements first-run legacy stamping and the marker-last watermark. |
| task | task-4 | story-2 | covered | Implements interrupted/unwritable migration negative paths. |
| task | task-5 | story-2 | covered | Wires the compatibility boundary after lock acquisition and before normal daemon work. |
| task | task-6 | story-3 | covered | Implements the four-way re-kick disposition matrix. |
| task | task-7 | story-3, story-4 | covered | Proves retained state has no retry effects and clear cleanup remains safe/idempotent. |
| task | task-8 | story-1 | covered | Migrates both operator OAuth preflight writers to the required contract. |
| task | task-9 | story-1 | covered | Migrates grouped/serial auth timeout and build-token preflight writers. |
| task | task-10 | story-1 | covered | Migrates permission-denial and daemon terminal-error writers. |
| task | task-11 | story-1 | covered | Migrates validation-group terminal funnels and preserves specific existing markers. |
| task | task-12 | story-1 | covered | Migrates build ceiling and auto-park writers. |
| task | task-13 | story-1 | covered | Migrates degraded stall-remediation writers and their shared helper. |
| task | task-14 | story-1 | covered | Migrates no-progress gate-escalation writers. |
| task | task-15 | story-1 | covered | Migrates generic terminal safeguards without overwriting specific classifications. |
| task | task-16 | story-1 | covered | Corrects omitted/contradictory classes and verifies deliberate mechanical classifications. |
| task | task-17 | story-1 | covered | Adds deterministic integrity enforcement against direct production HALT writes. |

No coherence gaps or waivers remain.
