**Status:** Accepted

# Stories: Rebase-invalidated test_suite proof HALTs build_review

**Feature:** ai-conductor#1729 — technical track, Tier M
**Authoritative design:**
`.docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md` (APPROVED),
`.docs/decisions/adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md` (APPROVED),
`.docs/decisions/adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md` (APPROVED)
**Binding conditions:**
`.docs/decisions/architecture-review-2026-08-19-rebase-invalidated-test-suite-proof-halts-build-re.md`
(APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates are deliberately **not** stories — they accompany functional work and belong
outside the acceptance criteria. `docs/reference/cli.md` and the stalled-or-stuck-feature runbook are
plan tasks.

**What this feature is not.** It changes neither which gates a rebase invalidates
(`adr-2026-07-20`, consumed unchanged) nor how the aggregate suite is fingerprinted, executed, or
recorded (`adr-2026-07-25`, untouched). It adds no new retry budget, no new bound, and no LLM to any
decision path. An implementation that recomputes the preserve/invalidate partition at the pre-verify
site is out of scope and must fail review, per review condition 5.

**The defect is a placement, and the tests must be able to see that.** The verdict-aware resume clamp
already selects `test_suite` correctly; the loop's state-only short-circuit at `conductor.ts:4351`
then discards that selection. A check that is correct in isolation but sits after the short-circuit is
inert, and passes every component-level test. Review condition 1 is why Stories 1 and 2 are written
against the observed on-disk fixtures rather than against the new function.

---

## Story 1: A rebase-invalidated suite proof re-runs the suite, not build_review

**Requirement:** outcome-1

As a feature whose aggregate suite proof was invalidated by a file-changing rebase, I want the suite
re-run before `build_review` is dispatched, so that the run continues without an operator hand-editing
`.pipeline/` state.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree carrying the observed strand fixture — `gates/test_suite.json` reading
  `satisfied: false` with `kickback.from: 'rebase'`, and `conduct-state.json` reading
  `test_suite: done`, `build_review: failed`, `last_step: build_review` — when the conductor resumes,
  then `test_suite` is dispatched and `build_review` is not dispatched on that iteration.
- Given that same fixture, when `test_suite` completes with a passing aggregate proof, then
  `build_review` is dispatched next and its input assembly finds a CURRENT proof.
- Given a re-kick whose pre-loop rebase invalidated the suite proof, when the conductor resumes,
  then no operator action is required for the run to reach `build_review` — the run advances on its
  own.

#### Negative Path
- Given a feature whose `test_suite` status is `done` and whose proof inspection returns CURRENT,
  when the conductor resumes, then `test_suite` is not re-dispatched and the loop fast-forwards —
  the "regressing to top-of-list re-runs" failure class `adr-2026-07-11` names must not return.
- Given a step whose completion predicate throws when evaluated, when the loop reaches it, then the
  step is dispatched rather than skipped, and the throw does not propagate out of the loop.
- Given a step whose status is `skipped` by complexity tier, work track, or bootstrap mode, when the
  loop reaches it, then it stays skipped and no predicate is evaluated for it.

---

## Story 2: build_review is never dispatched while its prerequisite gate is unsatisfied

**Requirement:** outcome-2

As the engine, I want `build_review` dispatched only when `test_suite` is genuinely satisfied against
the current tree, so that a disagreement between the gate ledger and the step ledger cannot put a
judged gate in front of an unmet prerequisite — from either direction of disagreement.

### Acceptance Criteria

#### Happy Path
- Given the second observed variant — `gates/test_suite.json` reading `satisfied: true` while the
  content-addressed proof inspection returns STALE — when the conductor resumes, then `test_suite` is
  dispatched and `build_review` is not, because the dispatch boundary consults the predicate rather
  than the cached verdict.
- Given a feature where both ledgers agree that `test_suite` is satisfied and the proof inspection
  agrees, when the conductor resumes, then `build_review` is dispatched as it is today.

#### Negative Path
- Given the same two fixtures, when the conductor resumes, then `conduct-state.json` and the gate
  verdict files are byte-unchanged by the boundary check itself — the re-check reads and never writes
  (ADR-1 D3), which is what keeps `adr-2026-07-11`'s rejected reconcile-from-verdicts option closed.
- Given `checkGate`'s prerequisite evaluation, when a step is checked, then it remains state-only and
  its result is unchanged by this feature (`adr-2026-07-11` D4).
- Given `gateSatisfied` and the resume clamp, when they evaluate a step, then they remain pure and
  verdict-authoritative and no filesystem read is introduced into the selector.

---

## Story 3: A current proof after a rebase still goes straight to build_review

**Requirement:** outcome-6

As a feature rebased onto a base that did not disturb its suite inputs, I want to proceed directly to
`build_review`, so that keeping the run correct does not cost a gratuitous full-suite re-run on every
rebase.

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase whose result leaves the suite's content fingerprint identical, when
  the post-rebase verdicts are applied, then `test_suite`'s verdict is re-verified as satisfied rather
  than invalidated, and a `rebase_gate_reverified` record names it with dispatch skipped.
- Given that same run, when the loop resumes, then `test_suite` is not dispatched and `build_review`
  runs on the next iteration.
- Given a file-changing rebase that does change the suite's fingerprint, when the post-rebase verdicts
  are applied, then `test_suite` is invalidated exactly as it is today.

#### Negative Path
- Given `build_review` and `manual_test` after any file-changing rebase, when the post-rebase verdicts
  are applied, then both are invalidated unconditionally — the pre-verify set is `{build,
  test_suite}` and no other gate joins it (ADR-1 D1).
- Given `wiring_check`, whose predicate is unconditionally satisfied, when the eligible set is
  computed, then it is absent from it.
- Given the pre-verify runs, when it selects which gates to pre-verify, then it consumes
  `classifyGateInvalidation`'s existing partition and does not recompute it — review condition 5.
- Given a pre-verify that throws, when the outcome is applied, then the gate is invalidated, matching
  `adr-2026-07-08`'s "never skip on doubt".

---

## Story 4: An unresolvable stale proof stops with a message naming the step that must re-run

**Requirement:** outcome-3

As an operator reading `.daemon/daemon.log` after a run stopped, I want the terminal message to name
the step that must re-run and the input that did not change, so that I learn the cause without opening
`.pipeline/`.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` dispatch whose input assembly raises the typed suite-proof error, when the
  loop terminates the run, then the halt reason names `test_suite` as the step that must re-run and
  names the unchanged input.
- Given that halt, when it is classified, then it is written `needs-human`, so the daemon's re-kick
  sweep does not clear and re-dispatch it.

#### Negative Path
- Given the halt reason is composed, when it is written, then it does not read "retries exhausted"
  for this failure class — `adr-2026-07-13` D5's rule that a routed dead end names the unchanged
  input.
- Given a `build_review` failure that is not an unretryable input-assembly failure, when the run
  terminates, then today's halt text and classification are unchanged.

---

## Story 5: A retry budget is not spent on a failure whose inputs cannot change

**Requirement:** outcome-4

As the engine, I want a step failure whose inputs cannot change between attempts to route on its first
occurrence, so that provider spend and wall-clock are not consumed by identical re-dispatches.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` dispatch that fails with the typed suite-proof error on attempt 1, when the
  retry decision is made, then the decision is `route` and no further attempt is dispatched.
- Given that decision, when it is recorded, then a `retry_decision` event carries the routing signal
  and the step, so the existing rerun-vs-route measurement covers this class.

#### Negative Path
- Given a step failure carrying no unretryable facet, when the retry decision is made, then the
  existing budget behavior is unchanged and the step retries to `stepMaxRetries` as today.
- Given `retry_routing.enabled: false`, when a step fails with the typed error, then the classifier is
  bypassed and the step retries exactly as it does today — the exact-revert contract of
  `adr-2026-07-13` D6.
- Given the `build` step, when it fails, then it is never passed to the classifier and its progress
  accounting is untouched.
- Given the routing decision, when it is derived, then it is derived from the result's typed facet and
  not from any match against the failure message — `adr-2026-08-18` D1.

---

## Story 6: An operator returns a feature to a named earlier step through a supported command

**Requirement:** outcome-5

As an operator recovering a feature the loop could not resolve, I want a command that returns it to a
named earlier step, so that recovery does not require hand-editing `.pipeline/conduct-state.json` and
gate files outside the mutation port's lease.

### Acceptance Criteria

#### Happy Path
- Given a halted feature whose `last_step` is `build_review`, when the operator rewinds it to
  `test_suite`, then `test_suite` and every non-skipped step after it are demoted to `stale`, the
  gate verdicts for those steps are cleared, and the halt marker and its class sidecar are removed.
- Given that rewound feature, when the daemon next dispatches it, then `test_suite` runs and the run
  proceeds without any further operator action.
- Given the rewind completes, when its occurrence is recorded, then a spine event names the operator,
  the target step, and the demoted set.

#### Negative Path
- Given a rewind target at or after the feature's current position, when the command runs, then it is
  refused and nothing is mutated — the verb only goes backward.
- Given a target that names no step in the resolved registry, when the command runs, then it fails by
  name, listing the valid step names, rather than silently resolving to a not-found index.
- Given a config-declared custom step, when it is named as the target, then it is accepted — the
  registry is resolved, not the static built-in list.
- Given a state mutation the port refuses because the expected value no longer matches, when the
  rewind runs, then the rewind aborts reporting the field, expected value, and current value, and does
  not fall back to a direct file write.
- Given a failure partway through the rewind, when the command exits, then the feature is left halted
  with its state unchanged rather than partially demoted — review condition 2.
- Given a step already `skipped` by tier, track, or bootstrap mode, when it falls inside the demoted
  range, then it keeps its `skipped` status.
- Given the conductor, the daemon, and every step runner, when they execute, then none of them invokes
  the rewind verb — it is operator-invoked only (ADR-3 D6).

---

## Notes for the plan

**Placement is the fix (review condition 1).** Stories 1 and 2 are written against the two observed
on-disk fixtures for this reason. A plan task that adds the re-check anywhere after the
`alreadyResolved` short-circuit satisfies every component test and delivers nothing.

**Two variants, two mechanisms, both needed.** ADR-1 D6's pre-verify keeps the verdict honest at the
invalidation site and preserves the no-re-run fast path; ADR-1 D2's boundary check keeps the dispatch
honest regardless of how either ledger drifted. Story 1's fixture has a kickback verdict; Story 2's
first fixture has none. Either mechanism alone fails one of them.

**Do not re-derive the invalidated set.** The pre-verify consumes `classifyGateInvalidation`'s output.
`adr-2026-07-20-post-rebase-delta-aware-invalidation` owns that partition and a second implementation
at the pre-verify site is the failure review condition 5 names.

**No new event type.** `adr-2026-07-26-event-sink-registry-exhaustiveness` makes `EVENT_SINKS` total
over the union, so a new member forces a sink declaration. Story 5's telemetry extends the existing
`retry_decision` member's signal vocabulary; Story 6's rewind occurrence is a spine member decided in
ADR-3 D5 and must be weighed against that exhaustiveness rule at plan time.

**Cost is unmeasured (review condition 3).** Stories 1-3 assume the re-check is cheap enough to run
per iteration. `adr-2026-07-25` D5's fingerprint-stability claim has never been measured at this
frequency on this repository's tracked-input set. The plan owes a measurement task before it asserts
negligible cost; a bad number does not change ADR-1 D2's placement but does add memoization within a
loop pass, which the review has not evaluated.

**The release surface must be classified early (review condition 4).** The `rewind` verb is additive,
but the release gate's classifier is path-based. Decide up front whether a waiver under
`adr-2026-07-06-migration-gate-waiver` is owed and, if so, land it in the same diff naming every
touched canonical surface — partial coverage halts.
