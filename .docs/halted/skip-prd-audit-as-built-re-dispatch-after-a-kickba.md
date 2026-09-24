# Halt record

Status: halted
Slug: skip-prd-audit-as-built-re-dispatch-after-a-kickba
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-skip-prd-audit-as-built-re-dispatch-after-a-kickba
Head SHA: 68324f1733878654871650cddc15331462f84b1d
Halted at: 2026-09-24T01:31:44.565Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given `prd_audit` is `stale` after a kickback to `build`, its code-stamp sidecar exists, no path in its gate surface changed since the stamp, and `.pipeline/prd-audit.md` still reads clean, when the step loop reaches `prd_audit`, then its status is persisted as `done` and no provider session is dispatched for it.
Task ids: 2
Done when checks: For each of the four gates, a `stale` entry whose `checkStepCompletion` resolves `done: true` ends with persisted status `done` and zero `StepRunner` invocations for that step, as asserted per gate in stale-gate-predispatch.test.ts. | A preserved stale gate emits exactly one `verdict_freshness` event (`outcome: 'preserved_surface_miss'`, `fresh: true`) and no `step_started` event for that step, asserted on the recorded emitter output. | A `stale` gate whose predicate resolves `done: false` or rejects is dispatched: the runner is invoked, a `step_started` event is emitted, and no pre-dispatch `verdict_freshness` event precedes it, asserted in the two fall-through cases. | The implementation diff touches no line of `src/conductor/src/types/events.ts` (`git diff --stat main -- src/conductor/src/types/events.ts` is empty).
Missing assertion: The cited checks do not explicitly require that the specified prd_audit sidecar, unchanged gate surface, and clean report cause checkStepCompletion to resolve done.

Criterion: Story 1 happy: Given `architecture_review_as_built` is `stale` with a valid sidecar, an unchanged surface, and a report whose verdict still reads `APPROVED`, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it.
Task ids: 2
Done when checks: For each of the four gates, a `stale` entry whose `checkStepCompletion` resolves `done: true` ends with persisted status `done` and zero `StepRunner` invocations for that step, as asserted per gate in stale-gate-predispatch.test.ts. | A preserved stale gate emits exactly one `verdict_freshness` event (`outcome: 'preserved_surface_miss'`, `fresh: true`) and no `step_started` event for that step, asserted on the recorded emitter output. | A `stale` gate whose predicate resolves `done: false` or rejects is dispatched: the runner is invoked, a `step_started` event is emitted, and no pre-dispatch `verdict_freshness` event precedes it, asserted in the two fall-through cases. | The implementation diff touches no line of `src/conductor/src/types/events.ts` (`git diff --stat main -- src/conductor/src/types/events.ts` is empty).
Missing assertion: The cited checks do not explicitly require that the specified architecture_review_as_built sidecar, unchanged surface, and APPROVED report cause checkStepCompletion to resolve done.

Criterion: Story 1 happy: Given `build_review` is `stale` with a `codeStamp` in its aggregate, an unchanged surface, and a clean aggregate, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it.
Task ids: 2
Done when checks: For each of the four gates, a `stale` entry whose `checkStepCompletion` resolves `done: true` ends with persisted status `done` and zero `StepRunner` invocations for that step, as asserted per gate in stale-gate-predispatch.test.ts. | A preserved stale gate emits exactly one `verdict_freshness` event (`outcome: 'preserved_surface_miss'`, `fresh: true`) and no `step_started` event for that step, asserted on the recorded emitter output. | A `stale` gate whose predicate resolves `done: false` or rejects is dispatched: the runner is invoked, a `step_started` event is emitted, and no pre-dispatch `verdict_freshness` event precedes it, asserted in the two fall-through cases. | The implementation diff touches no line of `src/conductor/src/types/events.ts` (`git diff --stat main -- src/conductor/src/types/events.ts` is empty).
Missing assertion: The cited checks do not explicitly require that the specified build_review aggregate codeStamp, unchanged surface, and clean aggregate cause checkStepCompletion to resolve done.

Criterion: Story 1 happy: Given `manual_test` is `stale` with a clean-pass fail-evidence marker carrying a `codeStamp` and an unchanged surface, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it.
Task ids: 2
Done when checks: For each of the four gates, a `stale` entry whose `checkStepCompletion` resolves `done: true` ends with persisted status `done` and zero `StepRunner` invocations for that step, as asserted per gate in stale-gate-predispatch.test.ts. | A preserved stale gate emits exactly one `verdict_freshness` event (`outcome: 'preserved_surface_miss'`, `fresh: true`) and no `step_started` event for that step, asserted on the recorded emitter output. | A `stale` gate whose predicate resolves `done: false` or rejects is dispatched: the runner is invoked, a `step_started` event is emitted, and no pre-dispatch `verdict_freshness` event precedes it, asserted in the two fall-through cases. | The implementation diff touches no line of `src/conductor/src/types/events.ts` (`git diff --stat main -- src/conductor/src/types/events.ts` is empty).
Missing assertion: The cited checks do not explicitly require that the specified manual_test fail-evidence marker, codeStamp, and unchanged surface cause checkStepCompletion to resolve done.

Criterion: Story 1 happy: Given a stale gate is preserved this way, when the loop continues, then the preserved report on disk is the same bytes it was before the step loop reached the gate (the sweep did not delete it).
Task ids: 4
Done when checks: With no commit since the stamp, the loop ends with `state.prd_audit === 'done'`, no runner invocation for `prd_audit`, and `.pipeline/prd-audit.md` byte-identical to its pre-loop content, asserted by case (1); the same holds for `architecture_review_as_built` with an `APPROVED` report. | A commit touching a path in `GATE_SURFACE.prd_audit` makes the loop invoke the runner for `prd_audit`, asserted by case (2). | With the sidecar deleted the loop invokes the runner for `prd_audit`, asserted by case (3). | With the report rewritten to a non-PASS row the loop invokes the runner for `prd_audit`, asserted by case (4). | With `gate_code_validity.enabled: false` the loop invokes the runner for `prd_audit`, asserted by case (5).
Missing assertion: The cited checks assert byte-identical preservation only for prd_audit and architecture_review_as_built, not for every stale gate preserved this way.

Criterion: Story 1 negative: Given `gate_code_validity.enabled: false`, when the step loop reaches any stale judged gate, then a provider session is dispatched regardless of stamp state.
Task ids: 4
Done when checks: With no commit since the stamp, the loop ends with `state.prd_audit === 'done'`, no runner invocation for `prd_audit`, and `.pipeline/prd-audit.md` byte-identical to its pre-loop content, asserted by case (1); the same holds for `architecture_review_as_built` with an `APPROVED` report. | A commit touching a path in `GATE_SURFACE.prd_audit` makes the loop invoke the runner for `prd_audit`, asserted by case (2). | With the sidecar deleted the loop invokes the runner for `prd_audit`, asserted by case (3). | With the report rewritten to a non-PASS row the loop invokes the runner for `prd_audit`, asserted by case (4). | With `gate_code_validity.enabled: false` the loop invokes the runner for `prd_audit`, asserted by case (5).
Missing assertion: The cited check asserts dispatch only for `prd_audit` with validity disabled, not any stale judged gate.

Criterion: Story 3 negative: Given a stale judged gate is not preserved and dispatches, when `.pipeline/events.jsonl` is read, then it carries a `step_started` event for that step and no pre-dispatch `verdict_freshness` event with `preserved_surface_miss` for it.
Task ids: 2
Done when checks: For each of the four gates, a `stale` entry whose `checkStepCompletion` resolves `done: true` ends with persisted status `done` and zero `StepRunner` invocations for that step, as asserted per gate in stale-gate-predispatch.test.ts. | A preserved stale gate emits exactly one `verdict_freshness` event (`outcome: 'preserved_surface_miss'`, `fresh: true`) and no `step_started` event for that step, asserted on the recorded emitter output. | A `stale` gate whose predicate resolves `done: false` or rejects is dispatched: the runner is invoked, a `step_started` event is emitted, and no pre-dispatch `verdict_freshness` event precedes it, asserted in the two fall-through cases. | The implementation diff touches no line of `src/conductor/src/types/events.ts` (`git diff --stat main -- src/conductor/src/types/events.ts` is empty).
Missing assertion: The checks require emission/no pre-dispatch event, but do not explicitly require those events to be persisted in `.pipeline/events.jsonl`.
```
