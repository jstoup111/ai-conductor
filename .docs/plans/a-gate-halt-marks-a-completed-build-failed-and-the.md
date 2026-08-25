# Implementation Plan: A gate halt marks a completed build failed, and the residue blocks every later resume (respec)

**Date:** 2026-08-24
**Stories:** .docs/stories/a-gate-halt-marks-a-completed-build-failed-and-the.md
**Conflict check:** Clean as of 2026-08-24 (two degrading overlaps accepted; kickback-cap HALT pinned out of scope)

## Summary

Adds a typed `refused` step status and a `step_refused` spine event, adopts them at the three
dispatch-loop sites that still stamp `failed` for non-failure terminations, and makes the residual
gate-blocked loop exit halt with the unsatisfied prerequisite and its status. 12 tasks.

## Technical Approach

Per adr-2026-08-24-refused-step-status: widen `StepStatus` (`src/conductor/src/types/steps.ts`)
with `refused`, written only through the `ConductStateStore` mutation port. `stepSatisfied`
(`src/conductor/src/engine/state.ts`) is deliberately unchanged (`done | skipped | stale`), so a
refused step is re-admitted by the existing read-only resume clamp after its HALT is cleared. A
single refusal handler in `src/conductor/src/engine/conductor.ts` receives a typed refusal
(discriminated `kind: 'seal' | 'needs-human' | 'validation-verdict'`), records `refused`, emits a
new `step_refused` `ConductorEvent` (declared exhaustively in
`src/conductor/src/engine/event-sinks.ts` — render, persist, audit), and writes the HALT through
the existing `writeHaltMarker` seam with the existing class vocabulary. The three adopter sites
are: the seal retries-exhausted path (search seed `verifyProtectedArtifactSeal`), the two
step-written needs-human halt stamps (seed: `'failed'` saves adjacent to `emitLoopHalt`), and the
validation-group halt commit (seed: `commitStateChanges` with `[step.name]: 'failed'`). Routing is
by typed facet only — never output text (adr-2026-08-19-unretryable). The gate-blocked residual:
when the loop exits because `checkGate` refused a step and no runnable prerequisite exists, write
a `needs-human` HALT naming each unsatisfied prerequisite and its recorded status before the loop
returns, so the generic finally-backstop (whose wording is untouched for every other no-verdict
exit) never fires for this class.

Local pattern (refusal exits): `worktreeMissing` and `pendingLiveBoundaryHalt` in `conductor.ts`
are the exemplars — typed facet, early return before any `failed` save, halt via `writeHaltMarker`
with a closed class. Preserve those traits; allowed variation is the facet's internal shape.

Out of scope (pinned by the conflict report): the kickback-cap exhausted HALT keeps its current
status behavior; build_review verdict-FAIL kickback routing is untouched; live-boundary,
missing-worktree, and finish-gate paths are untouched.

## Prerequisites

None — no migrations, no new dependencies.

## Tasks

### Task 1: Add `refused` to StepStatus and pin `stepSatisfied`
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: a state-store round-trip records `refused` for a step and reads it back; a companion test pins `stepSatisfied` to exactly `done | skipped | stale` (refused, failed, pending, in_progress all unsatisfied).
2. Verify test fails (RED).
3. Implement: add `refused` to the `StepStatus` union; fix every compile-time-exhaustive consumer the compiler surfaces without behavior change beyond a distinct label.
4. Verify test passes (GREEN).
5. Commit: "feat(state): add refused step status; stepSatisfied unchanged".

**Done when:**
- [ ] `StepStatus` in src/conductor/src/types/steps.ts includes `refused` and the engine compiles
- [ ] A test asserts `stepSatisfied` returns false for `refused` and true for exactly `done`, `skipped`, `stale`
- [ ] No call site writes `refused` yet (grep of src shows only type/test references)

**Files likely touched:**
- src/conductor/src/types/steps.ts — union member
- src/conductor/src/engine/state.ts — satisfaction pin test target
- test/engine/state.test.ts — round-trip + satisfaction pin

**Dependencies:** none

### Task 2: Add `step_refused` to the ConductorEvent union with exhaustive sinks
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: constructing a `step_refused` event (step, kind, reason) persists to the events file via `EventPersister`; update the pinned persisted-type-set test to include `step_refused` in the same diff (accepted resolution in the conflict report).
2. Verify test fails (RED).
3. Implement: add the union member in src/conductor/src/types/events.ts and its sink-registry row (render, persist, audit) in src/conductor/src/engine/event-sinks.ts.
4. Verify test passes (GREEN); confirm removing the registry row breaks compilation (exhaustiveness).
5. Commit: "feat(events): step_refused spine event with exhaustive sinks".

**Done when:**
- [ ] `step_refused` is a `ConductorEvent` member carrying step name, `kind: 'seal' | 'needs-human' | 'validation-verdict'`, and reason
- [ ] The sink registry declares all three sinks for it and the exhaustiveness check fails compilation when the row is removed
- [ ] The pinned persisted-type-set test lists `step_refused` and passes
- [ ] The refusal record rides the spine only — no sidecar file or second ledger is written (a test asserts the pipeline directory gains no new file beyond the events file and HALT markers)

**Files likely touched:**
- src/conductor/src/types/events.ts — union member
- src/conductor/src/engine/event-sinks.ts — registry row
- test/engine/event-sinks.test.ts — persistence + pin update

**Dependencies:** 1

### Task 3: One refusal handler: typed facet → refused status + event + HALT
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: feeding a `StepRunResult` carrying a refused facet (kind `seal`) through the loop's outcome handling records `refused` via the mutation port, emits `step_refused`, writes the HALT through `writeHaltMarker`, and performs no `failed` save.
2. Verify test fails (RED).
3. Implement: add the refused facet to the step result type and a single handler in src/conductor/src/engine/conductor.ts that short-circuits before the retry/failed stamp. Follow the refusal-exit pattern (`worktreeMissing`, `pendingLiveBoundaryHalt` seeds): typed facet, early return, closed HALT class.
4. Verify test passes (GREEN).
5. Commit: "feat(conductor): single refusal handler records refused, never failed".

**Done when:**
- [ ] A refused-facet result records `refused` for the entered step and statuses of all other steps are byte-identical before/after
- [ ] The handler emits exactly one `step_refused` and zero `step_failed` events for the attempt
- [ ] The HALT is written by the existing `writeHaltMarker` seam and `HALT.class` holds a value from the existing closed set

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — handler + facet consumption
- src/conductor/src/engine/step-runners.ts — facet on the result type
- test/engine/step-refusal.test.ts — handler behavior

**Dependencies:** 2

### Task 4: Seal retries-exhausted path adopts the refusal handler
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: with `build` recorded `done` and a seal verdict of `ok: false` for the entering step, retries exhaust and the run halts with the seal reason; `build` still reads `done`; the entered step reads `refused`; HALT class is `protected-artifact`.
2. Verify test fails (RED).
3. Implement: the seal-violation synthetic result (seed `verifyProtectedArtifactSeal`) sets the refused facet with kind `seal` instead of falling into the retries-exhausted `failed` save.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): seal refusal records refused; completed steps keep verdicts".

**Done when:**
- [ ] The Story 1 happy-path test passes: `build: done` preserved, entered step `refused`, no `step_failed` in the events file
- [ ] Seal HALT class and reason wording are byte-identical to current main (existing seal-halt test unchanged)
- [ ] An `ok: true` verdict dispatches the provider with no refused facet set (existing dispatch tests pass)

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — seal site rerouting
- test/engine/step-refusal.test.ts — seal scenarios

**Dependencies:** 3

### Task 5: Step-written needs-human halt sites record refused
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a step run that concludes with a needs-human halt leaves the step `refused` (kind `needs-human`), HALT class `needs-human`, wording unchanged; cover both stamp sites (the mid-loop and the post-run save adjacent to `emitLoopHalt`).
2. Verify test fails (RED).
3. Implement: both sites set the refused facet and route through the Task 3 handler instead of saving `failed`.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): needs-human halts record refused, not failed".

**Done when:**
- [ ] Both needs-human stamp sites route through the single refusal handler (no remaining `failed` save adjacent to a needs-human `emitLoopHalt`)
- [ ] HALT text for the covered sites is unchanged from current main (snapshot/wording assertions pass)
- [ ] The kickback-cap exhausted HALT keeps its current status behavior (a test pins it — out-of-scope boundary from the conflict report)

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — both stamp sites
- test/engine/step-refusal.test.ts — needs-human scenarios

**Dependencies:** 3

### Task 6: Validation-group halt records refused for the judging step
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: an as-built plan-gap verdict with the outcome undelivered halts the validation group with the judging step `refused` (kind `validation-verdict`), existing plan-gap classification and wording unchanged, sibling steps' statuses untouched.
2. Verify test fails (RED).
3. Implement: the validation-group halt commit (seed `commitStateChanges` writing `[step.name]: 'failed'`) writes `refused` for the judging step via the handler; the group's non-halting members are untouched.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): validation-group halts record refused for the judge".

**Done when:**
- [ ] The plan-gap halt test passes: judging step `refused`, `HALT.class` unchanged from current main for that verdict, sibling statuses byte-identical
- [ ] All three validation-group halt commit sites write `refused` instead of `failed` for the halting step
- [ ] `step_refused` with kind `validation-verdict` appears in the events file for the scenario

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — validation-group commit sites
- test/engine/step-refusal.test.ts — validation scenarios

**Dependencies:** 3

### Task 7: Regression: build_review verdict-FAIL kickback is unchanged
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write test: a build_review FAIL verdict routes kickback-to-build with kickback-ledger counts and lap accounting identical to current main, and records no `refused` status and no `step_refused` event.
2. If it fails, the Task 6 change leaked into verdict-FAIL routing — constrain the facet to halt paths only.
3. Commit: "test(conductor): verdict-FAIL kickback untouched by refusal lane".

**Done when:**
- [ ] The kickback regression test passes with ledger counts equal to a pre-change baseline run
- [ ] Grep of the kickback routing path shows no refused-facet involvement

**Files likely touched:**
- test/engine/kickback-ledger.test.ts — regression scenario

**Dependencies:** 6

### Task 8: Genuine failures keep failed and block dependents; text can never refuse
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: (a) a provider work failure exhausting retries records `failed`, emits `step_failed`, and a dependent's gate refuses entry; (b) provider output text containing the word "refused" flows the failure path and records `failed` with zero `step_refused` events; (c) a result cannot carry both a refused facet and a work failure — the handler asserts mutual exclusivity.
2. Verify (b) fails only if classification touches text; fix by construction (facet-only classification).
3. Implement any needed assertion; run the existing retry/escalation suite unchanged.
4. Commit: "test(conductor): failure lane untouched; refusal is facet-only".

**Done when:**
- [ ] Tests (a), (b), (c) pass and the pre-existing retry/escalation tests pass without edits
- [ ] The refusal facet is set at exactly the three adopter sites (grep enumerates the producers)

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — exclusivity assertion if needed
- test/engine/step-refusal.test.ts — failure-lane scenarios

**Dependencies:** 4

### Task 9: Refused steps render distinctly in reports and daemon status
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: a state with one `refused` step renders in the report renderer and daemon status rendering with a refused label distinct from failed.
2. Verify test fails (RED).
3. Implement: handle the new member in src/conductor/src/engine/report-renderer.ts and the daemon status render path (compiler-surfaced sites from Task 1).
4. Verify test passes (GREEN).
5. Commit: "feat(render): refused steps display distinctly from failed".

**Done when:**
- [ ] Renderer test asserts distinct output strings for `refused` vs `failed`
- [ ] Daemon status render test covers a feature containing a refused step without throwing

**Files likely touched:**
- src/conductor/src/engine/report-renderer.ts — refused rendering
- test/engine/daemon-render.test.ts — status display

**Dependencies:** 1

### Task 10: Resume after a cleared refusal re-admits the refused step
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing integration test: refuse a step (seal scenario), remove the HALT marker files from the pipeline directory, re-run the conductor against the same state, and assert the refused step is dispatched with no state file edit between runs; assert resume derivation performed no status mutation.
2. Verify test fails (RED) if resume mishandles the new member; otherwise it should pass from Tasks 1+4 — in that case keep it as the pinned proof.
3. Implement only what the RED reveals; the clamp stays read-only and backward-only; the `--from-step` exemption is asserted unchanged.
4. Commit: "test(conductor): cleared refusal resumes without hand-edit".

**Done when:**
- [ ] The refuse → clear → resume integration test passes with zero writes to the state file between the two runs other than the engine's own step dispatch
- [ ] An assertion covers `--from-step` forcing entry at a later step exactly as on current main

**Files likely touched:**
- test/engine/resume-verdict-clamp.test.ts — refusal resume scenarios

**Dependencies:** 4

### Task 11: Residual gate-blocked exit writes a prerequisite-naming needs-human HALT
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: a step blocked on a `failed` prerequisite with no runnable predecessor makes the loop write a `needs-human` HALT before returning, whose reason contains the prerequisite name and its recorded status; the events file carries `gate_blocked` then `loop_halt` for the same step.
2. Verify test fails (RED).
3. Implement: at the loop's gate-refusal exit (seed `gate_blocked` emission after `checkGate`), when no runnable prerequisite exists, compose the reason from the gate's unsatisfied names plus each name's status from state, and write the HALT via `writeHaltMarker` with class `needs-human`.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): gate-blocked exits halt naming the prerequisite and status".

**Done when:**
- [ ] The HALT reason for the scenario contains the prerequisite name and its status word, and `HALT.class` reads `needs-human`
- [ ] The runnable-prerequisite common path still dispatches the prerequisite and writes no gate-blocked HALT (existing clamp tests pass)
- [ ] The finally-backstop's generic no-verdict wording no longer appears for gate-blocked exits

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — gate-refusal exit path
- src/conductor/src/engine/gates.ts — expose per-prerequisite names if not already structured
- test/engine/gates.test.ts — blocked-exit scenarios

**Dependencies:** 1

### Task 12: Non-gate-blocked no-verdict exits keep the enriched backstop
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write test: a loop exit with no DONE/HALT for a non-gate reason still produces the finally-backstop HALT with its current enriched wording (breadcrumb, last event), byte-compatible with current main.
2. If it fails, Task 11 over-reached — constrain the new HALT write to the gate-refusal branch.
3. Commit: "test(conductor): backstop wording preserved for non-gate exits".

**Done when:**
- [ ] The existing backstop tests pass unchanged and the new non-gate scenario asserts the enriched wording is intact
- [ ] The gate-blocked branch is the only site writing the new prerequisite-naming HALT (grep shows one producer)

**Files likely touched:**
- test/engine/conductor.test.ts — backstop scenarios

**Dependencies:** 11

## Task Dependency Graph

```
1 ─▶ 2 ─▶ 3 ─▶ 4 ─▶ 8
     │         └▶ 10
     │    ├▶ 5
     │    └▶ 6 ─▶ 7
1 ─▶ 9
1 ─▶ 11 ─▶ 12
```

## Integration Points

- After Task 4: a seal refusal on a real worktree preserves completed statuses end-to-end.
- After Task 10: the full refuse → clear → resume cycle works with no operator state edits.
- After Task 11: a prerequisite-blocked run is operator-diagnosable from the HALT alone.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-fr41-1: src/conductor/src/engine/conductor.ts:1579-1596 — resolve `step_refused` delivery against the enclosing execution: keep `step:<step>` as its terminal key when that execution is open, and when it is not, deliver the event as a non-terminal (skip the `return Promise.resolve()` at :1596) whenever the group's `parallel:<entry>` execution is still open, so validation-group refusals from :5921/:6039/:6394 reach EventPersister; drop only when neither key is open, preserving the daemon-SIGTERM orphan guard the :1594-1596 comment documents (plan task 3's 'exactly one step_refused per attempt' assertion and the existing shutdown-orphan behavior both survive unchanged)
**Gate:** prd-audit
**Rationale:** Implementation drift, not an architecture change: src/conductor/src/engine/conductor.ts:1596 drops any terminal whose execution key is not open, and the validation-group lane only ever opens `parallel:<entry>` (src/conductor/src/engine/conductor.ts:5436), never `step:<entry>`, so the `step_refused` emitted by recordStepRefusal at src/conductor/src/engine/conductor.ts:1695 from all three validation-group sites (:5921, :6039, :6394) is discarded before EventPersister — the same defect as as-built blocking violation 1, owned by plan task 6 whose Done-when reads "`step_refused` with kind `validation-verdict` appears in the events file for the scenario"; as-built blocking violation 3 (diagram drift at .docs/architecture/a-gate-halt-marks-a-completed-build-failed-and-the.md:33-36 and :50-53) is resolved by this same fix because the diagram depicts the approved flow the code fails to implement, so no sealed-artifact amendment is required. Class sweep: the drop guard at :1596 is the single site (`emitExecutionEvent` is the only terminal-key gate in the engine); the sibling `state[step.name] === 'failed'` predicate at :5323 belongs to the core parallel-group lane, which writes `done`/`failed` and never refuses, so it is found-and-excluded.
**Criterion:** S4.1
**Parent task:** 6
**Done when:**
- S4.1 is satisfied by this task.

### Task rem-prd-audit-rem-fr41-2: src/conductor/test/engine/step-refusal.test.ts (new; the file plan tasks 3-6 name) — add the validation-group scenario proving `{"type":"step_refused","kind":"validation-verdict"}` is persisted to .pipeline/events.jsonl for a width-2+ group halt, covering all three sites (no-verdict :5921, as-built :6039, auto-mode :6394); this is the UNEXERCISED signature named in .pipeline/architecture-review-as-built.md Drift Notes
**Gate:** prd-audit
**Rationale:** Implementation drift, not an architecture change: src/conductor/src/engine/conductor.ts:1596 drops any terminal whose execution key is not open, and the validation-group lane only ever opens `parallel:<entry>` (src/conductor/src/engine/conductor.ts:5436), never `step:<entry>`, so the `step_refused` emitted by recordStepRefusal at src/conductor/src/engine/conductor.ts:1695 from all three validation-group sites (:5921, :6039, :6394) is discarded before EventPersister — the same defect as as-built blocking violation 1, owned by plan task 6 whose Done-when reads "`step_refused` with kind `validation-verdict` appears in the events file for the scenario"; as-built blocking violation 3 (diagram drift at .docs/architecture/a-gate-halt-marks-a-completed-build-failed-and-the.md:33-36 and :50-53) is resolved by this same fix because the diagram depicts the approved flow the code fails to implement, so no sealed-artifact amendment is required. Class sweep: the drop guard at :1596 is the single site (`emitExecutionEvent` is the only terminal-key gate in the engine); the sibling `state[step.name] === 'failed'` predicate at :5323 belongs to the core parallel-group lane, which writes `done`/`failed` and never refuses, so it is found-and-excluded.
**Criterion:** S4.1
**Parent task:** 6
**Done when:**
- S4.1 is satisfied by this task.
