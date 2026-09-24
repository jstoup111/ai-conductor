# Implementation Plan: Skip judged-gate re-dispatch after a kickback that leaves the code stamp valid

**Date:** 2026-09-21
**Design:** Technical track; Small tier (architecture review skipped); adr-2026-07-22-gate-evidence-code-validity-on-redispatch D2/D4/D6 govern the preserve decision
**Stories:** .docs/stories/skip-prd-audit-as-built-re-dispatch-after-a-kickba.md
**Conflict check:** Skipped for Small tier

## Summary

Consult the existing stamped completion predicate before dispatching a judged gate re-entered as `stale` after a kickback, so a repair that left the gate's surface unchanged re-marks it `done` without a judge session. Four tasks: one registry attribute, one step-loop branch, scope-pinning unit tests, and a real-worktree acceptance test. Source: jstoup111/ai-conductor#2639.

## Technical Approach

- **The preserve decision already exists.** `CUSTOM_COMPLETION_PREDICATES` for `manual_test`, `prd_audit`, `architecture_review_as_built`, and `build_review` (`src/conductor/src/engine/artifacts.ts`) return `done: true` with `verdictFreshness.outcome = 'preserved_surface_miss'` when the code-stamp sidecar exists, `gateVerdictStillValid` returns `preserve`, the report still reads clean, and `gate_code_validity.enabled` is true. `sweptArtifactStillValid` mirrors the same rule so the stale sweep spares the report. Nothing in this plan re-implements or widens that rule.
- **The gap is one consumer.** The step loop's pre-dispatch skip (`conductor.ts`, the `alreadyResolved && !explicitlyTargeted` block) runs the predicate only for `done` steps flagged `treeAttestingCompletion`; a `stale` step falls through to dispatch and the predicate only fires after the paid session. The fix adds a sibling branch keyed on a new registry attribute `preservableOnStale`.
- **Do not reuse `treeAttestingCompletion`.** It has five consumers (resume clamp in `conductor.ts`, post-rebase pre-verify in `rebase.ts`, `daemon-rekick.ts` preVerify) and an adr-2026-07-08 D1 admission bar that judged gates do not meet; setting it would write `satisfied: true` verdicts after a file-changing rebase. The new attribute has exactly one consumer.
- **Fail closed, mirror the `done` branch.** The new branch is gated on `verifyArtifacts`, skipped when the step is `--from`-targeted, and any predicate throw falls through to dispatch. Only `stale` is eligible; `failed` keeps its retry/recovery flow.
- **No new event kind.** A preserved stale gate emits the existing `verdict_freshness` event (`preserved_surface_miss`) and no `step_started`. `src/conductor/src/types/events.ts` is untouched, which also keeps this diff disjoint from the in-flight #2590 spec (`rebase-translate.ts`, `repair-obligations.ts`, `events.ts`).
- **Test pattern.** Step-loop unit tests follow `test/engine/resume-verdict-clamp.test.ts`: mock `steps.js`, spy `checkStepCompletion`, seed state with `writeState`, drive `Conductor` with a recording `StepRunner`. The acceptance test follows `test/acceptance/staleness-decisions-invisible-in-daemon-log.acceptance.test.ts` for building a real repo with a report and sidecar. Per `.agents/skills/write-tests/SKILL.md`, prove RED by restoring the merge-base `conductor.ts`, never with bare `git stash`.
- **Sequencing.** Task 1 (attribute) → Task 2 (loop branch + happy/observability tests) → Tasks 3 and 4 in parallel (scope pins; real-worktree negatives).

## Prerequisites

- None beyond a current `npm ci` in `src/conductor`.

## Tasks

### Task 1: Declare `preservableOnStale` on the four stamped judged gates
**Story:** 2 (happy path)
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/steps.test.ts`: the set of `ALL_STEPS` entries with `preservableOnStale === true` equals `{manual_test, prd_audit, architecture_review_as_built, build_review}` and the set with `treeAttestingCompletion === true` still equals `{build, test_suite}`; mirror the existing per-step declaration assertions in that file (search hint: `treeAttestingCompletion` in the same test).
2. Verify test fails (RED): `preservableOnStale` is not a known field.
3. Implement: add optional `preservableOnStale?: boolean` to `StepDefinition` in `src/conductor/src/types/steps.ts` with a doc comment stating it marks a gate whose completion predicate can preserve a stamped PASS on `stale` re-entry (adr-2026-07-22 D2) and is consumed only by the step loop's pre-dispatch check; set it `true` on the four gates in `src/conductor/src/engine/steps.ts`. Do not touch `treeAttestingCompletion`.
4. Verify test passes (GREEN); run `src/conductor/test/engine/steps-declaration-invariance.test.ts` and update its snapshot/fixture only if it enumerates fields.
5. Commit with message: "feat(steps): declare preservableOnStale on the four stamped judged gates"

**Done when:**
- `ALL_STEPS.filter(s => s.preservableOnStale).map(s => s.name)` equals exactly `['manual_test','prd_audit','architecture_review_as_built','build_review']` (registry order), as asserted by the new steps.test.ts case.
- `ALL_STEPS.filter(s => s.treeAttestingCompletion).map(s => s.name)` still equals exactly `['build','test_suite']`, asserted in the same test.
- `StepDefinition` in `src/conductor/src/types/steps.ts` carries `preservableOnStale?: boolean` and `grep -rn preservableOnStale src/conductor/src` hits only `types/steps.ts` and `engine/steps.ts` at the end of this task.

**Files likely touched:**
- src/conductor/src/types/steps.ts
- src/conductor/src/engine/steps.ts
- src/conductor/test/engine/steps.test.ts

**Dependencies:** none

### Task 2: Run the completion predicate pre-dispatch for a `stale` preservable gate and mark it done
**Story:** 1 (happy path), 3 (happy path)
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/stale-gate-predispatch.test.ts`, modelled on `src/conductor/test/engine/resume-verdict-clamp.test.ts` (it mocks `steps.js`, spies `checkStepCompletion` from `artifacts.js`, seeds `conduct-state.json` with `writeState`, and drives `Conductor` with a recording `StepRunner`; reuse that scaffolding, drop what the clamp-specific cases need). One case per gate in `{manual_test, prd_audit, architecture_review_as_built, build_review}`: seed the gate `stale`, `verifyArtifacts: true`, `checkStepCompletion` resolves `{ done: true, verdictFreshness: { outcome: 'preserved_surface_miss', fresh: true } }`; assert the runner was never invoked for that step, the persisted state reads `done`, and the emitted events for that step are exactly one `verdict_freshness` with `outcome: 'preserved_surface_miss'` and no `step_started`.
2. Add two more cases: predicate resolves `{ done: false }` → runner invoked for the step and a `step_started` event is emitted with no pre-dispatch `verdict_freshness`; predicate rejects → runner invoked (error swallowed).
3. Verify tests fail (RED): the stale gate dispatches in every case today.
4. Implement in `src/conductor/src/engine/conductor.ts` step loop, directly after the existing `alreadyResolved && !explicitlyTargeted` block: when `currentStatus === 'stale' && step.preservableOnStale && this.verifyArtifacts && !explicitlyTargeted`, call `checkStepCompletion(this.projectRoot, step.name, await this.completionCtx(state))` inside try/catch; on `completion.done`, emit `verdict_freshness` for the step when `completion.verdictFreshness` is present, `await this.saveConductorStepStatus(state, step.name, 'done')`, and `continue`; on `done: false` or a throw, fall through to the normal dispatch path unchanged. Add a comment citing adr-2026-07-22 D2 and #2639.
5. Verify tests pass (GREEN).
6. Commit with message: "feat(conductor): preserve a stale judged gate pre-dispatch when its stamped verdict still holds (#2639)"

**Done when:**
- For each of the four gates, a `stale` entry whose `checkStepCompletion` resolves `done: true` ends with persisted status `done` and zero `StepRunner` invocations for that step, as asserted per gate in stale-gate-predispatch.test.ts.
- A preserved stale gate emits exactly one `verdict_freshness` event (`outcome: 'preserved_surface_miss'`, `fresh: true`) and no `step_started` event for that step, asserted on the recorded emitter output.
- A `stale` gate whose predicate resolves `done: false` or rejects is dispatched: the runner is invoked, a `step_started` event is emitted, and no pre-dispatch `verdict_freshness` event precedes it, asserted in the two fall-through cases.
- The implementation diff touches no line of `src/conductor/src/types/events.ts` (`git diff --stat main -- src/conductor/src/types/events.ts` is empty).

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/stale-gate-predispatch.test.ts

**Dependencies:** 1

### Task 3: Keep `failed`, `--from`, verify-off, and unflagged stale steps on the dispatch path
**Story:** 2 (happy path, negative path)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stale-gate-predispatch.test.ts` (same scaffolding as Task 2), each with `checkStepCompletion` mocked to resolve `done: true` so any pre-dispatch call would wrongly preserve: (a) `prd_audit` seeded `failed`; (b) `prd_audit` seeded `stale` with `fromStep: 'prd_audit'`; (c) `prd_audit` seeded `stale` with `verifyArtifacts: false`; (d) `acceptance_specs` (no `preservableOnStale`) seeded `stale`. Assert in every case the runner is invoked for the step and the `checkStepCompletion` spy has no call for that step before the runner invocation.
2. Verify tests fail (RED) only if Task 2's guard is looser than specified; otherwise they pass immediately and are retained as regression pins — record which in the commit body.
3. Implement: tighten the Task 2 condition if any case fails; no other production change.
4. Verify tests pass (GREEN).
5. Commit with message: "test(conductor): pin stale-gate preservation scope to flagged, verify-on, untargeted stale gates"

**Done when:**
- A flagged gate seeded `failed` is dispatched with no pre-dispatch `checkStepCompletion` call, asserted by case (a) via the runner record and the spy's call list.
- A flagged gate seeded `stale` and named by `fromStep` is dispatched with no pre-dispatch `checkStepCompletion` call, asserted by case (b).
- A flagged gate seeded `stale` under `verifyArtifacts: false` is dispatched with no pre-dispatch `checkStepCompletion` call, asserted by case (c).
- An unflagged step (`acceptance_specs`) seeded `stale` is dispatched with no pre-dispatch `checkStepCompletion` call, asserted by case (d).

**Files likely touched:**
- src/conductor/test/engine/stale-gate-predispatch.test.ts
- src/conductor/src/engine/conductor.ts

**Dependencies:** 2

### Task 4: Acceptance: kickback without a relevant commit preserves; surface hit, missing stamp, unclean report, or kill-switch off dispatches
**Story:** 1 (happy path, negative path)
**Type:** negative-path

**Steps:**
1. Write a new `src/conductor/test/acceptance/stale-gate-predispatch.acceptance.test.ts` against a real temp git worktree (search hint: `staleness-decisions-invisible-in-daemon-log.acceptance.test.ts` builds a repo, writes `.pipeline/prd-audit.md`, the `PRD_AUDIT_CODE_STAMP` sidecar, and drives the real `checkStepCompletion`; reuse its repo/sidecar helpers). Seed `prd_audit` as `stale` after `navigateBack(state, 'build', …)`, with a clean PASS report and a sidecar whose `codeStamp` is HEAD, then run the conductor step loop with a recording runner through `build` (no commit) to `prd_audit`. Attach a real `EventPersister` writing `.pipeline/events.jsonl` to the conductor's emitter, as that test does, so event assertions read the persisted log.
2. Cases: (1) no commit since the stamp → `state.prd_audit === 'done'`, runner never invoked for `prd_audit`, and `.pipeline/prd-audit.md` bytes equal the pre-loop bytes; (2) a commit touching a file inside `GATE_SURFACE.prd_audit` → runner invoked; (3) sidecar deleted → runner invoked; (4) report rewritten to carry a `FIXABLE` row → runner invoked; (5) config `gate_code_validity: { enabled: false }` → runner invoked. Run cases (1), (3), (4), and (5) for each of the four gates with the real `checkStepCompletion` and real evidence: `prd_audit` (code-stamp sidecar, clean PASS `.pipeline/prd-audit.md`), `architecture_review_as_built` (its sidecar, `APPROVED` report), `build_review` (aggregate carrying a `codeStamp`, clean aggregate), and `manual_test` (clean-pass fail-evidence marker carrying a `codeStamp`). In case (1) also read `.pipeline/events.jsonl` and assert the preserved-gate events; in case (2) assert the dispatched-gate events.
3. Verify tests fail (RED) against the pre-Task-2 loop (case 1 dispatches) — prove by checking out `src/conductor/src/engine/conductor.ts` from the merge-base into a scratch copy or by `git stash`-free temporary revert of the Task 2 hunk; never use bare `git stash`.
4. Implement: none expected; if a case exposes a gap in Task 2's guard, fix it in `conductor.ts` and note it in the commit body.
5. Verify tests pass (GREEN).
6. Commit with message: "test(acceptance): stale judged gates preserve on no-op kickback and dispatch on surface hit, missing stamp, unclean report, or kill-switch off"

**Done when:**
- With no commit since the stamp, the loop ends with `state.prd_audit === 'done'`, no runner invocation for `prd_audit`, and `.pipeline/prd-audit.md` byte-identical to its pre-loop content, asserted by case (1); the same holds for `architecture_review_as_built` with an `APPROVED` report.
- With `prd_audit` seeded `stale`, its code-stamp sidecar present, no commit to any path in its gate surface since the stamp, and a clean PASS `.pipeline/prd-audit.md`, the real `checkStepCompletion` resolves done, so the loop persists `prd_audit` as `done` and invokes no runner for it, asserted by case (1) for `prd_audit`.
- With `architecture_review_as_built` seeded `stale`, its sidecar present, an unchanged gate surface, and a report whose verdict reads `APPROVED`, the real `checkStepCompletion` resolves done, so the loop persists it as `done` and invokes no runner for it, asserted by case (1) for `architecture_review_as_built`.
- With `build_review` seeded `stale`, a `codeStamp` in its aggregate, an unchanged gate surface, and a clean aggregate, the real `checkStepCompletion` resolves done, so the loop persists it as `done` and invokes no runner for it, asserted by case (1) for `build_review`.
- With `manual_test` seeded `stale`, a clean-pass fail-evidence marker carrying a `codeStamp`, and an unchanged gate surface, the real `checkStepCompletion` resolves done, so the loop persists it as `done` and invokes no runner for it, asserted by case (1) for `manual_test`.
- For every one of the four gates preserved in case (1), its preserved report, aggregate, or marker on disk is byte-identical to its pre-loop content after the loop continues past it.
- For every one of the four gates preserved in case (1), the persisted `.pipeline/events.jsonl` carries a `verdict_freshness` event for that step with `outcome: 'preserved_surface_miss'` and `fresh: true`, and no `step_started` event for that step.
- A commit touching a path in `GATE_SURFACE.prd_audit` makes the loop invoke the runner for `prd_audit`, asserted by case (2).
- With the sidecar deleted the loop invokes the runner for `prd_audit`, asserted by case (3).
- With the report rewritten to a non-PASS row the loop invokes the runner for `prd_audit`, asserted by case (4).
- For each of the four stale gates, with its code-stamp evidence missing (the sidecar deleted for `prd_audit` and `architecture_review_as_built`, the `codeStamp` removed from the `build_review` aggregate and from the `manual_test` fail-evidence marker) and an otherwise clean report, the loop dispatches a provider session: it invokes the runner for every one of the four gates, asserted by case (3) per gate.
- For each of the four stale gates, with its stamp evidence present and its gate surface unchanged but its report no longer clean (`prd_audit` carrying a `FIXABLE` row, `architecture_review_as_built` with a non-`APPROVED` verdict, `build_review` with an unclean aggregate, `manual_test` with a marker that is not a clean pass), the loop dispatches a provider session: it invokes the runner for every one of the four gates, asserted by case (4) per gate.
- With `gate_code_validity.enabled: false` the loop invokes the runner for `prd_audit`, asserted by case (5).
- With `gate_code_validity.enabled: false`, each of the four stale judged gates, seeded with the same valid stamp evidence as case (1), is dispatched regardless of stamp state: the loop invokes the runner for every one of `prd_audit`, `architecture_review_as_built`, `build_review`, and `manual_test`, asserted by case (5) per gate.
- For the gate dispatched in case (2), the persisted `.pipeline/events.jsonl` carries a `step_started` event for that step and no pre-dispatch `verdict_freshness` event with `preserved_surface_miss` for it.

**Files likely touched:**
- src/conductor/test/acceptance/stale-gate-predispatch.acceptance.test.ts
- src/conductor/src/engine/conductor.ts

**Dependencies:** 2

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3
                → Task 4
```

## Integration Points

- After Task 2: a daemon kickback to `build` that commits nothing leaves `prd_audit` / `architecture_review_as_built` / `build_review` / `manual_test` `done` with no judge session; observable in `.pipeline/events.jsonl` as `verdict_freshness` without `step_started`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `prd_audit` is `stale` after a kickback to `build`, its code-stamp sidecar exists, no path in its gate surface changed since the stamp, and `.pipeline/prd-audit.md` still reads clean, when the step loop reaches `prd_audit`, then its status is persisted as `done` and no provider session is dispatched for it. | 2, 4 | "the real `checkStepCompletion` resolves done, so the loop persists `prd_audit` as `done` and invokes no runner for it" | diff-local |
| Story 1 happy: Given `architecture_review_as_built` is `stale` with a valid sidecar, an unchanged surface, and a report whose verdict still reads `APPROVED`, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it. | 2, 4 | "asserted by case (1) for `architecture_review_as_built`" | diff-local |
| Story 1 happy: Given `build_review` is `stale` with a `codeStamp` in its aggregate, an unchanged surface, and a clean aggregate, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it. | 2, 4 | "asserted by case (1) for `build_review`" | diff-local |
| Story 1 happy: Given `manual_test` is `stale` with a clean-pass fail-evidence marker carrying a `codeStamp` and an unchanged surface, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it. | 2, 4 | "asserted by case (1) for `manual_test`" | diff-local |
| Story 1 happy: Given a stale gate is preserved this way, when the loop continues, then the preserved report on disk is the same bytes it was before the step loop reached the gate (the sweep did not delete it). | 4 | "its preserved report, aggregate, or marker on disk is byte-identical to its pre-loop content" | diff-local |
| Story 1 negative: Given `prd_audit` is `stale` and the kickback repair committed a change to a path inside `prd_audit`'s gate surface, when the step loop reaches `prd_audit`, then a provider session is dispatched exactly as before this change. | 4 | "A commit touching a path in `GATE_SURFACE.prd_audit` makes the loop invoke the runner for `prd_audit`" | diff-local |
| Story 1 negative: Given a stale gate's sidecar is missing, when the step loop reaches the gate, then a provider session is dispatched. | 4 | "it invokes the runner for every one of the four gates, asserted by case (3) per gate" | diff-local |
| Story 1 negative: Given a stale gate's sidecar exists and its surface is unchanged but the report on disk no longer reads clean, when the step loop reaches the gate, then a provider session is dispatched. | 4 | "it invokes the runner for every one of the four gates, asserted by case (4) per gate" | diff-local |
| Story 1 negative: Given `gate_code_validity.enabled: false`, when the step loop reaches any stale judged gate, then a provider session is dispatched regardless of stamp state. | 4 | "is dispatched regardless of stamp state: the loop invokes the runner for every one of" | diff-local |
| Story 1 negative: Given the pre-dispatch completion check throws (unreadable sidecar, git failure), when the step loop reaches the stale gate, then the error is swallowed and a provider session is dispatched (fail closed, matching the existing `done` branch). | 2 | "whose predicate resolves `done: false` or rejects is dispatched" | diff-local |
| Story 2 happy: Given the step registry, when the declarations are inspected, then exactly `manual_test`, `prd_audit`, `architecture_review_as_built`, and `build_review` carry the new stale-preservation attribute, and `treeAttestingCompletion` remains set only on `build` and `test_suite`. | 1 | "equals exactly `['manual_test','prd_audit','architecture_review_as_built','build_review']`" | diff-local |
| Story 2 happy: Given a step without the attribute is `stale` (for example `acceptance_specs`), when the step loop reaches it, then it dispatches exactly as before this change and `checkStepCompletion` is not called pre-dispatch for it. | 3 | "An unflagged step (`acceptance_specs`) seeded `stale` is dispatched with no pre-dispatch `checkStepCompletion` call" | diff-local |
| Story 2 negative: Given a flagged gate is `failed` rather than `stale`, when the step loop reaches it, then it dispatches exactly as before this change (the retry/recovery flow is untouched). | 3 | "A flagged gate seeded `failed` is dispatched with no pre-dispatch `checkStepCompletion` call" | diff-local |
| Story 2 negative: Given a flagged gate is `stale` and `--from <that gate>` is passed, when the step loop reaches it, then it dispatches (explicit targeting wins over preservation). | 3 | "named by `fromStep` is dispatched with no pre-dispatch `checkStepCompletion` call" | diff-local |
| Story 2 negative: Given `verifyArtifacts` is off, when the step loop reaches a flagged stale gate, then it dispatches (preservation is only an authority when artifact verification is on, mirroring the `done` branch). | 3 | "under `verifyArtifacts: false` is dispatched with no pre-dispatch `checkStepCompletion` call" | diff-local |
| Story 3 happy: Given a stale judged gate is preserved pre-dispatch, when `.pipeline/events.jsonl` is read, then it carries a `verdict_freshness` event for that step with `outcome: 'preserved_surface_miss'` and `fresh: true`, and no `step_started` event for that step in this dispatch. | 2, 4 | "the persisted `.pipeline/events.jsonl` carries a `verdict_freshness` event for that step" | diff-local |
| Story 3 happy: Given a stale judged gate is preserved pre-dispatch, when the persisted conductor state is read, then the step reads `done`. | 2 | "ends with persisted status `done`" | diff-local |
| Story 3 negative: Given a stale judged gate is not preserved and dispatches, when `.pipeline/events.jsonl` is read, then it carries a `step_started` event for that step and no pre-dispatch `verdict_freshness` event with `preserved_surface_miss` for it. | 2, 4 | "the persisted `.pipeline/events.jsonl` carries a `step_started` event for that step" | diff-local |
| Story 3 negative: Given a stale judged gate is preserved pre-dispatch, when the `ConductorEvent` union is inspected, then no new event type was added for this behavior. | 2 | "touches no line of `src/conductor/src/types/events.ts`" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks naming a mechanism
- [x] Dependencies are explicit and acyclic
