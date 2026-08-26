# Coherence Mapping: a-gate-halt-marks-a-completed-build-failed-and-the (respec 2026-08-24)

Tier M, technical track (no PRD — fr row class omitted). Outcomes from the staged intake
bullets (jstoup111/ai-conductor#1753). ADR row: the one non-deleted ADR in this change set.
Consistency pass (§4d) run over every covered row; no cross-layer contradiction or oscillation
found.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3 | covered | Refusal halts (seal, needs-human, validation-verdict) record refused, never failed; completed steps keep verdicts. |
| outcome | outcome-2 | story-5 | covered | Clearing the halt is enough to resume; no hand-edit of pipeline state. |
| outcome | outcome-3 | story-6 | covered | Residual gate-blocked exit halts naming the prerequisite and its status. |
| outcome | outcome-4 | story-7 | covered | Genuine failure still records failed, emits step_failed, and blocks dependents. |
| story | story-1 | task-3, task-4 | covered | Refusal handler plus seal-site adoption deliver the seal scenarios. |
| story | story-2 | task-3, task-5 | covered | Both needs-human stamp sites route through the shared handler. |
| story | story-3 | task-6, task-7 | covered | Validation-group adoption plus verdict-FAIL kickback regression. |
| story | story-4 | task-2, task-9 | covered | Spine event with exhaustive sinks; distinct rendering. |
| story | story-5 | task-1, task-10 | covered | Status union and satisfaction pin; refuse-clear-resume integration. |
| story | story-6 | task-11, task-12 | covered | Prerequisite-naming HALT; backstop wording preserved elsewhere. |
| story | story-7 | task-8 | covered | Failure lane pinned untouched; facet-only classification. |
| task | task-1 | story-5 | covered | Infrastructure for the resume behavior story-5 asserts. |
| task | task-2 | story-4 | covered | Spine event membership and sink exhaustiveness. |
| task | task-3 | story-1 | covered | Single refusal handler; also serves story-2 and story-3 adopters. |
| task | task-4 | story-1 | covered | Seal site adoption. |
| task | task-5 | story-2 | covered | Needs-human sites adoption. |
| task | task-6 | story-3 | covered | Validation-group adoption. |
| task | task-7 | story-3 | covered | Kickback regression pin. |
| task | task-8 | story-7 | covered | Failure-lane negative paths. |
| task | task-9 | story-4 | covered | Renderer and daemon-status display. |
| task | task-10 | story-5 | covered | Resume integration proof. |
| task | task-11 | story-6 | covered | Gate-blocked residual HALT. |
| task | task-12 | story-6 | covered | Backstop wording preservation. |
| adr | adr-2026-08-24-refused-step-status | story-1, story-4, story-5, story-7 | covered | Decisions 1-5 transcribed: status member, unsatisfied semantics, spine event, three adopter sites, failure lane untouched. |
| criterion | Story 1 happy: Given `build` is `done` in `conduct-state.json` and the seal verdict for the next step's dispatch is `ok: false`, when retries exhaust, then the run halts with the seal reason, `build` remains `done`, and the entered step reads `refused` | task-4 | covered | "`build` still reads `done`; the entered step reads `refused`" | diff-local |
| criterion | Story 1 happy: Given the seal refuses a step, when the refusal is recorded, then the write goes through the `ConductStateStore` mutation port and no `failed` value is written for any step | task-3 | covered | "records `refused` via the mutation port" | diff-local |
| criterion | Story 1 happy: Given the seal refuses on attempt 2 or later, when the halt is written, then the HALT marker carries the `protected-artifact` class and the seal reason through the existing `writeHaltMarker` seam | task-4 | covered | "HALT class is `protected-artifact`" | diff-local |
| criterion | Story 1 negative: Given the seal verdict is `ok: true`, when the step is dispatched, then the provider runs and the result is recorded exactly as before with no refused facet set | task-4 | covered | "An `ok: true` verdict dispatches the provider with no refused facet set" | diff-local |
| criterion | Story 1 negative: Given the dispatched step's own work fails on every retry, when retries are exhausted, then the step is recorded `failed` and a `step_failed` event is emitted | task-8 | covered | "a provider work failure exhausting retries records `failed`, emits `step_failed`" | diff-local |
| criterion | Story 1 negative: Given the seal refuses, when `events.jsonl` is read back, then no `step_failed` event exists for the refused step | task-4 | covered | "no `step_failed` in the events file" | diff-local |
| criterion | Story 2 happy: Given a step's run concludes with a needs-human halt, when the loop records the outcome, then the step reads `refused` in `conduct-state.json` and the HALT keeps its `needs-human` class and existing wording | task-5 | covered | "leaves the step `refused` (kind `needs-human`), HALT class `needs-human`" | diff-local |
| criterion | Story 2 happy: Given a needs-human halt is recorded as refused, when the committed halt record is written, then it is produced by the existing `writeHaltMarker` seam with no new machinery | task-3 | covered | "writes the HALT through `writeHaltMarker`" | diff-local |
| criterion | Story 2 negative: Given a step's provider work errors terminally without writing a needs-human halt, when retries exhaust, then the step is recorded `failed`, not `refused` | task-8 | covered | "records `failed`, emits `step_failed`" | diff-local |
| criterion | Story 2 negative: Given a needs-human refusal fires, when `HALT.class` is read, then its value is from the existing closed class set and no new class value appears | task-3 | covered | "`HALT.class` holds a value from the existing closed set" | diff-local |
| criterion | Story 3 happy: Given the as-built review returns a plan-gap verdict with the outcome undelivered, when the validation group halts, then the judging step reads `refused` and the HALT keeps its existing `plan-gap` classification and wording | task-6 | covered | "halts the validation group with the judging step `refused` (kind `validation-verdict`)" | diff-local |
| criterion | Story 3 happy: Given a validation-group member halts for a human, when the group outcome is committed, then completed sibling steps keep their own verdicts unchanged | task-6 | covered | "sibling steps' statuses untouched" | diff-local |
| criterion | Story 3 negative: Given a build_review verdict is FAIL, when the gate routes kickback-to-build, then the routing, kickback counting, and lap accounting behave exactly as on current main with no refusal recorded | task-7 | covered | "routes kickback-to-build with kickback-ledger counts and lap accounting identical to current main" | diff-local |
| criterion | Story 3 negative: Given a validation step's runner itself crashes, when retries exhaust, then that step is recorded `failed`, not `refused` | task-8 | covered | "a provider work failure exhausting retries records `failed`" | diff-local |
| criterion | Story 4 happy: Given any of the three refusal sites fires, when the halt is written, then a `step_refused` event with the step name, a refusal kind, and the reason is persisted to `.pipeline/events.jsonl` | task-2 | covered | "persists to the events file via `EventPersister`" | diff-local |
| criterion | Story 4 happy: Given a `step_refused` event exists, when the event sink registry is compiled, then the member declares render, persist, and audit sinks exhaustively | task-2 | covered | "sink-registry row (render, persist, audit)" | diff-local |
| criterion | Story 4 happy: Given a step is `refused`, when `conduct daemon status` or the report renderer displays the feature, then the step is shown as refused, not failed | task-9 | covered | "renders in the report renderer and daemon status rendering with a refused label distinct from failed" | diff-local |
| criterion | Story 4 negative: Given a refusal fires, when the spine is inspected, then no sidecar file, ad-hoc log, or second ledger carries the refusal record | task-2 | covered | "rides the spine only — no sidecar file or second ledger is written" | diff-local |
| criterion | Story 4 negative: Given an event sink registry entry for `step_refused` is removed, when the engine compiles, then compilation fails (exhaustiveness holds) | task-2 | covered | "confirm removing the registry row breaks compilation (exhaustiveness)" | diff-local |
| criterion | Story 5 happy: Given a step reads `refused` and its HALT markers are removed, when the conductor re-runs, then the resume entry admits that step and dispatches it with no state hand-edit | task-10 | covered | "assert the refused step is dispatched with no state file edit between runs" | diff-local |
| criterion | Story 5 happy: Given earlier steps are `done` and one step is `refused`, when prerequisites are evaluated, then `refused` does not satisfy the prerequisite predicate and the refused step re-runs | task-1 | covered | "asserts `stepSatisfied` returns false for `refused`" | diff-local |
| criterion | Story 5 negative: Given a step reads `refused`, when resume entry derivation runs, then no status is mutated by the resume path itself | task-10 | covered | "assert resume derivation performed no status mutation" | diff-local |
| criterion | Story 5 negative: Given `--from-step` names a later step, when the operator forces entry there, then the existing `--from-step` exemption behaves exactly as on current main | task-10 | covered | "An assertion covers `--from-step` forcing entry at a later step exactly as on current main" | diff-local |
| criterion | Story 6 happy: Given a step's prerequisite is unsatisfied and no runnable prerequisite exists to dispatch, when the loop exits, then a `needs-human` HALT is written whose reason names each unsatisfied prerequisite and that prerequisite's recorded status | task-11 | covered | "whose reason contains the prerequisite name and its recorded status" | diff-local |
| criterion | Story 6 happy: Given such a halt is written, when the persisted spine is read, then the `loop_halt` event carries the same step and the `gate_blocked` event precedes it | task-11 | covered | "the events file carries `gate_blocked` then `loop_halt` for the same step" | diff-local |
| criterion | Story 6 negative: Given an unsatisfied prerequisite is itself runnable, when the loop evaluates it, then the loop dispatches the prerequisite as on current main and writes no gate-blocked HALT | task-11 | covered | "still dispatches the prerequisite and writes no gate-blocked HALT" | diff-local |
| criterion | Story 6 negative: Given the loop exits for a reason other than a blocked gate, when the backstop HALT is written, then its wording is unchanged from current main | task-12 | covered | "still produces the finally-backstop HALT with its current enriched wording" | diff-local |
| criterion | Story 7 happy: Given a step's provider work fails on every retry with no refusal condition present, when retries exhaust, then the step is recorded `failed`, a `step_failed` event is emitted, and its dependents remain blocked | task-8 | covered | "a provider work failure exhausting retries records `failed`, emits `step_failed`, and a dependent's gate refuses entry" | diff-local |
| criterion | Story 7 happy: Given a step is `failed`, when a dependent's gate is checked, then the gate refuses entry exactly as on current main | task-8 | covered | "a dependent's gate refuses entry" | diff-local |
| criterion | Story 7 negative: Given provider output text contains the word "refused", when the outcome is classified, then classification uses only the typed facet and the step is recorded `failed` | task-8 | covered | "flows the failure path and records `failed` with zero `step_refused` events" | diff-local |
| criterion | Story 7 negative: Given a refusal facet and a work failure cannot both be true for one attempt, when the handler receives a result, then exactly one of `refused` or `failed` is recorded | task-8 | covered | "the handler asserts mutual exclusivity" | diff-local |
