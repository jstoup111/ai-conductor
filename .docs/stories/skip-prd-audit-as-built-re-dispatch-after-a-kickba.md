**Status:** Accepted

Source: jstoup111/ai-conductor#2639. Technical track, Tier S. Scope: the four stamped judged gates (`manual_test`, `prd_audit`, `architecture_review_as_built`, `build_review`) re-entered as `stale` after a kickback to `build`. The rebase path (#2555) and `navigateBack` are out of scope.

## Story 1: A stale judged gate whose stamped verdict still holds is marked done without a judge session

As the daemon operator, I want a kickback that leaves a judged gate's code stamp valid to re-mark that gate `done` without dispatching a fresh judge, so that no-op repairs stop paying for re-audits and stop giving judgement noise a chance to flip a PASS.

### Acceptance Criteria

#### Happy Path
- Given `prd_audit` is `stale` after a kickback to `build`, its code-stamp sidecar exists, no path in its gate surface changed since the stamp, and `.pipeline/prd-audit.md` still reads clean, when the step loop reaches `prd_audit`, then its status is persisted as `done` and no provider session is dispatched for it.
- Given `architecture_review_as_built` is `stale` with a valid sidecar, an unchanged surface, and a report whose verdict still reads `APPROVED`, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it.
- Given `build_review` is `stale` with a `codeStamp` in its aggregate, an unchanged surface, and a clean aggregate, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it.
- Given `manual_test` is `stale` with a clean-pass fail-evidence marker carrying a `codeStamp` and an unchanged surface, when the step loop reaches it, then its status is persisted as `done` and no provider session is dispatched for it.
- Given a stale gate is preserved this way, when the loop continues, then the preserved report on disk is the same bytes it was before the step loop reached the gate (the sweep did not delete it).

#### Negative Paths
- Given `prd_audit` is `stale` and the kickback repair committed a change to a path inside `prd_audit`'s gate surface, when the step loop reaches `prd_audit`, then a provider session is dispatched exactly as before this change.
- Given a stale gate's sidecar is missing, when the step loop reaches the gate, then a provider session is dispatched.
- Given a stale gate's sidecar exists and its surface is unchanged but the report on disk no longer reads clean, when the step loop reaches the gate, then a provider session is dispatched.
- Given `gate_code_validity.enabled: false`, when the step loop reaches any stale judged gate, then a provider session is dispatched regardless of stamp state.
- Given the pre-dispatch completion check throws (unreadable sidecar, git failure), when the step loop reaches the stale gate, then the error is swallowed and a provider session is dispatched (fail closed, matching the existing `done` branch).

### Done When
- [ ] A step-loop unit test per gate (`manual_test`, `prd_audit`, `architecture_review_as_built`, `build_review`) shows a `stale` entry with a preserving completion predicate ends `done` with zero dispatch calls.
- [ ] A step-loop unit test shows a `stale` gate whose completion predicate returns `done: false` dispatches, and one whose predicate throws dispatches.
- [ ] An acceptance test drives a real worktree through kickback→`build` (no commit)→`prd_audit` and asserts `state.prd_audit === 'done'` with no dispatch, then repeats with an in-surface commit and asserts a dispatch.
- [ ] An acceptance test with `gate_code_validity.enabled: false` asserts the stale gate dispatches.

## Story 2: The pre-dispatch preservation is declared per step and scoped to stamped judged gates

As a harness maintainer, I want the set of gates eligible for stale-preservation to be a registry declaration on the step definition, so that the loop change has one consumer and cannot widen `treeAttestingCompletion` or touch steps without a stamped predicate.

### Acceptance Criteria

#### Happy Path
- Given the step registry, when the declarations are inspected, then exactly `manual_test`, `prd_audit`, `architecture_review_as_built`, and `build_review` carry the new stale-preservation attribute, and `treeAttestingCompletion` remains set only on `build` and `test_suite`.
- Given a step without the attribute is `stale` (for example `acceptance_specs`), when the step loop reaches it, then it dispatches exactly as before this change and `checkStepCompletion` is not called pre-dispatch for it.

#### Negative Paths
- Given a flagged gate is `failed` rather than `stale`, when the step loop reaches it, then it dispatches exactly as before this change (the retry/recovery flow is untouched).
- Given a flagged gate is `stale` and `--from <that gate>` is passed, when the step loop reaches it, then it dispatches (explicit targeting wins over preservation).
- Given `verifyArtifacts` is off, when the step loop reaches a flagged stale gate, then it dispatches (preservation is only an authority when artifact verification is on, mirroring the `done` branch).

### Done When
- [ ] A registry test asserts the attribute set equals `{manual_test, prd_audit, architecture_review_as_built, build_review}` and that `treeAttestingCompletion` equals `{build, test_suite}`.
- [ ] Step-loop unit tests cover `failed` status, `--from` targeting, `verifyArtifacts: false`, and an unflagged stale step, each asserting a dispatch and no pre-dispatch completion call.

## Story 3: A stale-preservation skip is observable on the event spine

As the daemon operator, I want a preserved stale gate to leave the same evidence a preserved re-dispatch leaves, so that the daemon log and telemetry show why the gate did not run.

### Acceptance Criteria

#### Happy Path
- Given a stale judged gate is preserved pre-dispatch, when `.pipeline/events.jsonl` is read, then it carries a `verdict_freshness` event for that step with `outcome: 'preserved_surface_miss'` and `fresh: true`, and no `step_started` event for that step in this dispatch.
- Given a stale judged gate is preserved pre-dispatch, when the persisted conductor state is read, then the step reads `done`.

#### Negative Paths
- Given a stale judged gate is not preserved and dispatches, when `.pipeline/events.jsonl` is read, then it carries a `step_started` event for that step and no pre-dispatch `verdict_freshness` event with `preserved_surface_miss` for it.
- Given a stale judged gate is preserved pre-dispatch, when the `ConductorEvent` union is inspected, then no new event type was added for this behavior.

### Done When
- [ ] A step-loop unit test asserts the emitted event sequence for a preserved stale gate is exactly one `verdict_freshness` (`preserved_surface_miss`) and no `step_started`.
- [ ] A step-loop unit test asserts a dispatched stale gate emits `step_started` and no pre-dispatch `verdict_freshness`.
- [ ] `src/conductor/src/types/events.ts` is unchanged in the implementation diff.
