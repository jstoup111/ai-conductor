# Implementation Plan: Scoped invocation cannot expand to the aggregate suite

**Date:** 2026-08-01
**Design:** `.docs/decisions/adr-2026-08-01-engine-owned-scoped-test-invocation.md`,
`.docs/decisions/adr-2026-08-01-scoped-run-verb-release-surface.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-01-scoped-invocation-cannot-expand.md` (APPROVED WITH CONDITIONS, C1–C8)
**Stories:** `.docs/stories/build-review-repeats-aggregate-verification-despit.md`
**Conflict check:** Clean as of 2026-08-01 (0 blocking; 4 degrading items folded into tasks below)
**Intake:** jstoup111/ai-conductor#1173

## Summary

Give the scoped test path an engine-owned invocation surface so a scoped request can never widen
into the aggregate suite. Twenty tasks: a new optional `test_suite` template key with fail-closed
validation, a scoped-run module that assembles argv itself and refuses an empty selection, a
`conduct-ts` verb wiring it into production, regression proof that aggregate semantics are untouched,
repair of this repo's argument-swallowing npm scripts, and the call-site updates that point BUILD and
`build_review` at the interface.

## Technical Approach

**The defect is a translation seam, not a discipline failure.** An agent's intent ("run these
tests") is translated into a shell command by an npm script whose argument semantics the engine does
not control. `src/conductor/package.json:11` ends in `&& echo 'AGGREGATE_TEST_SUITE_PASS'`, and npm
appends `-- <args>` to the end of the *whole script string*, so forwarded selectors land on the
`echo` and vitest runs everything. The fix removes the seam rather than policing it.

**Three moving parts, in dependency order:**

1. **Config (Tasks 1–3).** A new optional key inside the existing `test_suite` block holds a
   *template* carrying an opaque `{selectors}` placeholder. Validation extends the existing
   `test_suite` validator in `src/conductor/src/engine/config.ts` (the block starting at `:1152`) and
   the `TestSuiteConfig` type in `src/conductor/src/types/config.ts:392`. Fail-closed, but only on
   the new key — every pre-existing config must still validate untouched (ADR-1 D3).

2. **Scoped-run module (Tasks 4–13).** A new module under `src/conductor/src/engine/` substitutes the
   caller's selector list into the template, quotes each selector or passes them as argv, and
   executes through an **injected runner** so tests never shell out to the real suite. Two refusal
   paths are load-bearing and are implemented before the happy path is wired: an **empty selection**
   (which would substitute to the bare command — an aggregate run) and an **unconfigured key**. Both
   must spawn no process at all, which is asserted directly rather than inferred from an exit code.

3. **Wiring and call sites (Tasks 14, 19–21).** The verb is registered in the `conduct-ts` dispatch
   in `src/conductor/src/index.ts`, mirroring the `test-suite` verb's detect/dispatch shape at
   `:404-406`. Then the grader prompt, the pipeline and TDD skill contracts, and the HARNESS policy
   are pointed at the interface.

**What is deliberately not touched.** `FullSuiteVerifier`, the content-addressed fingerprint, the
lock, and the evidence sidecar are untouched. A scoped run writes no evidence and does not satisfy
the `test_suite` gate (Tasks 15–16 prove this by regression, because a scoped path that could
satisfy the aggregate gate would be a far worse defect than the one being fixed).

**Naming constraint.** The verb must not be named `test-suite` or read as its alias —
`.docs/plans/2026-07-29-deterministic-test-suite-step.md:95-97` keeps that verb as the aggregate
adapter (conflict F5).

**Sentinel finding that de-risks Task 17.** No production code parses
`AGGREGATE_TEST_SUITE_PASS`; PASS is classified purely by exit code
(`full-suite-verifier.ts:646` → `reason: 'exit_zero'`). The script repair therefore cannot break the
gate provided exit codes are preserved. One acceptance test pins the exact script string
(`full-suite-verification-gate.acceptance.test.ts:241`) and must be updated in the same task.

## Prerequisites

- None external. No migration, no schema change, no consumer action.
- **C1 (binding):** `bin/conduct` MUST NOT be edited by any task. That exact path is the sole trigger
  for the `bin/conduct CLI` breaking surface (`src/conductor/src/engine/self-host/release-gate.ts:161`).
  This feature ships with no migration block and no waiver; editing that file invalidates
  `adr-2026-08-01-scoped-run-verb-release-surface` and requires a real migration block.
- **Test isolation (binding):** every task's tests inject a fake runner. No ordinary test may invoke
  the repository aggregate suite (`.docs/plans/2026-07-29-deterministic-test-suite-step.md:104-105`).
- Tests live under `src/conductor/test/`, never beside source.

## Documentation note (not tasks)

Per `/plan`'s documentation boundary, ordinary documentation is not planned as tasks. This repo's
`maintain-documentation` custom step owns these, and they are required in the same PR by `CLAUDE.md`:
`docs/reference/cli.md` (new verb), `docs/reference/configuration.md` (new key, `test_suite` table at
`:527-531`), and `docs/contributing/testing.md:37,40` — the latter states the sentinel "is the
success token the pre-SHIP `test_suite` gate reads", which is **false**; the gate classifies on exit
code. No task records the release note: implementation branches never write `CHANGELOG.md` or
`VERSION`. The bot-owned `automation/release-pr` is their sole writer, and the pipeline's
`release-disposition` step derives the PR's release metadata itself.

## Tasks

### Task 1: Accept the scoped-run template key in `test_suite` config
**Story:** 2
**Type:** happy
**Steps:**
1. Write failing test: a config whose `test_suite` block carries the scoped-run template key with a
   `{selectors}` placeholder loads successfully and exposes the template; a config omitting the key
   loads successfully with the template undefined.
2. Verify test fails (RED).
3. Implement: add the optional field to `TestSuiteConfig` and add the key to the allowed-key set in
   the `test_suite` validator.
4. Verify test passes (GREEN).
5. Commit: "feat(config): accept optional scoped-run template in test_suite"

**Files likely touched:**
- `src/conductor/src/types/config.ts` — add the optional template field to `TestSuiteConfig`
- `src/conductor/src/engine/config.ts` — add the key to the `test_suite` allowed set
- `src/conductor/test/engine/config.test.ts` — key present and key absent both validate

**Wired-into:** `src/conductor/src/engine/config.ts#validateTestSuiteBlock`
**Dependencies:** none

### Task 2: Reject a scoped-run template with no selector placeholder
**Story:** 2
**Type:** negative
**Steps:**
1. Write failing test: a template string without `{selectors}` produces a `validation_error` whose
   message names both the key and the required placeholder.
2. Verify test fails (RED).
3. Implement: placeholder presence check in the `test_suite` validator, fail-closed.
4. Verify test passes (GREEN).
5. Commit: "feat(config): reject scoped-run template missing the selector placeholder"

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — placeholder validation
- `src/conductor/test/engine/config.test.ts` — missing-placeholder rejection

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Reject empty, whitespace-only, and non-string scoped-run templates
**Story:** 2
**Type:** negative
**Steps:**
1. Write failing tests: empty string, whitespace-only string, and non-string values (number, list,
   object) each produce a `validation_error` rather than being coerced; a pre-feature `test_suite`
   block containing only the original five keys still validates unchanged.
2. Verify tests fail (RED).
3. Implement: type and non-empty checks alongside the placeholder check.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): fail closed on malformed scoped-run templates"

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — type/emptiness validation
- `src/conductor/test/engine/config.test.ts` — malformed values plus the backward-compatibility case

**Wired-into:** same as Task 1
**Dependencies:** Task 2

### Task 4: Substitute a selector list into the template and execute via an injected runner
**Story:** 1
**Story:** 3
**Type:** happy
**Steps:**
1. Write failing test: given a configured template and a one-entry selector list, the module invokes
   the injected runner exactly once with the selector present, and returns the runner's exit status.
2. Verify test fails (RED).
3. Implement: new scoped-run module with template substitution and an injectable runner seam.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): add engine-owned scoped test invocation"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — new module: substitution, execution, result shape
- `src/conductor/test/engine/scoped-run.test.ts` — single-selector happy path with a fake runner

**Wired-into:** `src/conductor/src/index.ts#dispatchScopedRunCommand`
**Dependencies:** Task 1

### Task 5: Substitute multiple selectors and honor a mid-template placeholder
**Story:** 1
**Type:** happy
**Steps:**
1. Write failing tests: a three-selector list yields all three at the placeholder position; a
   template whose placeholder sits mid-command preserves the trailing portion of the template.
2. Verify tests fail (RED).
3. Implement: positional substitution independent of placeholder location.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): substitute selectors at the placeholder position"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — substitution positioning
- `src/conductor/test/engine/scoped-run.test.ts` — multi-selector and mid-template cases

**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 6: Runner failure, launch failure, and timeout never escalate to an aggregate run
**Story:** 1
**Type:** negative
**Steps:**
1. Write failing tests: a non-zero runner exit reports a test failure with no retry at broader
   scope; an unlaunchable command reports a launch failure naming the command; an over-timeout run
   is terminated and reported as a timeout. In all three, the aggregate command is never invoked.
2. Verify tests fail (RED).
3. Implement: failure classification and timeout handling in the scoped-run module.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): classify scoped-run failures without broadening scope"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — failure classification, timeout
- `src/conductor/test/engine/scoped-run.test.ts` — three failure cases asserting no aggregate call

**Wired-into:** same as Task 4
**Dependencies:** Task 5

### Task 7: Refuse an empty selector list without spawning a process
**Story:** 3
**Type:** negative
**Steps:**
1. Write failing test: a zero-length selector list is refused, exits non-zero, and the injected
   runner is **never called** — asserted on the fake runner's call count, not merely the exit code.
2. Verify test fails (RED).
3. Implement: empty-selection guard that returns before any substitution or execution.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): refuse an empty scoped selection"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — empty-selection guard
- `src/conductor/test/engine/scoped-run.test.ts` — zero-selector refusal, runner call count zero

**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 8: Treat all-whitespace selectors as empty and name the aggregate route in the refusal
**Story:** 3
**Type:** negative
**Steps:**
1. Write failing tests: a selector list of `["", "  "]` is refused identically to a zero-length list;
   the refusal message states that an empty selection is an aggregate run and directs the caller to
   the shared aggregate verifier (broad-fallback trigger 3, `HARNESS.md:336`).
2. Verify tests fail (RED).
3. Implement: whitespace normalization before the emptiness check, and the refusal message text.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): normalize blank selectors and route refusals to the verifier"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — normalization, refusal message
- `src/conductor/test/engine/scoped-run.test.ts` — blank-selector and message-content cases

**Wired-into:** same as Task 4
**Dependencies:** Task 7

### Task 9: Deliver a selector containing a space as a single argument
**Story:** 4
**Type:** happy
**Steps:**
1. Write failing test: a selector containing a space arrives at the runner as exactly one argument
   (condition C3), and ordinary path characters `- _ . / ~ :` survive unaltered.
2. Verify test fails (RED).
3. Implement: quote each selector or pass the list as argv rather than string-splicing.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): deliver scoped selectors without splicing ambiguity"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — selector quoting/argv construction
- `src/conductor/test/engine/scoped-run.test.ts` — space-bearing selector, ordinary characters

**Wired-into:** same as Task 4
**Dependencies:** Task 5

### Task 10: Pass shell metacharacters literally without executing them
**Story:** 4
**Type:** negative
**Steps:**
1. Write failing tests: a selector of `; echo INJECTED` produces no `INJECTED` marker and spawns no
   extra process; quote-bearing and hyphen-leading selectors survive substitution unaltered.
2. Verify tests fail (RED).
3. Implement: escaping sufficient to make metacharacters inert.
4. Verify tests pass (GREEN).
5. Commit: "fix(engine): make scoped selectors inert to shell interpretation"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — escaping
- `src/conductor/test/engine/scoped-run.test.ts` — injection, quotes, leading hyphen

**Wired-into:** same as Task 4
**Dependencies:** Task 9

### Task 11: Report scoped running unavailable when the key is unconfigured
**Story:** 5
**Type:** negative
**Steps:**
1. Write failing test: with no scoped-run key configured, a scoped run exits non-zero, names the
   configuration key required to enable it, and the injected runner is never called — proving the
   aggregate command is not silently substituted.
2. Verify test fails (RED).
3. Implement: unavailability path that returns before any execution.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): report scoped running unavailable instead of falling back"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — unconfigured-key path
- `src/conductor/test/engine/scoped-run.test.ts` — unavailable message, runner call count zero

**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 12: Handle a missing configuration file and a scoped key without an aggregate block
**Story:** 5
**Type:** happy
**Steps:**
1. Write failing tests: a project with no configuration file yields a described, handled failure
   rather than an unhandled throw; a project whose scoped key is configured but whose `test_suite`
   aggregate keys are absent still runs scoped successfully.
2. Verify tests fail (RED).
3. Implement: config-resolution handling independent of aggregate-key presence.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): resolve scoped-run config independently of aggregate keys"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run.ts` — config resolution
- `src/conductor/test/engine/scoped-run.test.ts` — missing-config and scoped-only-config cases

**Wired-into:** same as Task 4
**Dependencies:** Task 11

### Task 13: Register the scoped-run verb in the `conduct-ts` dispatch
**Story:** 1
**Type:** happy
**Steps:**
1. Write failing test: the dispatch detects the new verb, forwards its selector arguments to the
   scoped-run module, and returns its exit code; the verb name is not `test-suite` nor an alias.
2. Verify test fails (RED).
3. Implement: detect/dispatch pair mirroring the `test-suite` verb's shape at `src/index.ts:404-406`.
   Do **not** edit `bin/conduct` (condition C1).
4. Verify test passes (GREEN).
5. Commit: "feat(cli): register the scoped-run verb"

**Files likely touched:**
- `src/conductor/src/engine/scoped-run-cli.ts` — detect + dispatch entry points
- `src/conductor/src/index.ts` — dispatch registration
- `src/conductor/test/engine/scoped-run-cli.test.ts` — detection, argument forwarding, exit code

**Wired-into:** `src/conductor/src/index.ts#dispatchScopedRunCommand`
**Dependencies:** Task 6

### Task 14: Prove a scoped run writes no aggregate evidence and cannot satisfy the gate
**Story:** 6
**Type:** negative
**Steps:**
1. Write failing tests: after any scoped run, `.pipeline/test-suite-evidence.json` is byte-identical
   to its prior state; a successful scoped run leaves the `test_suite` gate unsatisfied.
2. Verify tests fail (RED).
3. Implement: assert the module has no evidence-write path (no production change expected — this
   task exists to pin the invariant, since a scoped run that could satisfy the aggregate gate would
   be a worse defect than the one being fixed).
4. Verify tests pass (GREEN).
5. Commit: "test(engine): pin scoped runs out of the aggregate evidence path"

**Files likely touched:**
- `src/conductor/test/engine/scoped-run.test.ts` — evidence untouched, gate unsatisfied

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

### Task 15: Regression-prove aggregate verification semantics are unchanged
**Story:** 6
**Type:** happy
**Steps:**
1. Write failing test (or confirm existing coverage): an unchanged tree still yields reuse without
   execution; a changed tree still executes and writes fresh evidence; an aggregate command that
   ignores appended arguments remains valid — no argument-forwarding constraint applies to
   `test_suite.command`.
2. Verify test state (RED where new).
3. Implement: no production change expected; confirm the existing `full-suite-verifier`,
   `full-suite-evidence`, and `full-suite-fingerprint` suites pass unmodified.
4. Verify tests pass (GREEN).
5. Commit: "test(engine): regression-pin aggregate semantics across the scoped-run change"

**Files likely touched:**
- `src/conductor/test/engine/full-suite-verifier.test.ts` — reuse/execute regression assertions

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** Task 14

### Task 16: Repair the argument-swallowing package scripts
**Story:** 7
**Type:** happy
**Steps:**
1. Write failing test: invoking the `test` script with a forwarded test-file argument runs only that
   file; invoking it with no arguments still runs the full suite and still emits the
   `AGGREGATE_TEST_SUITE_PASS` sentinel on success.
2. Verify test fails (RED).
3. Implement: restructure `test` and `test:changed` so forwarded arguments reach vitest rather than
   the trailing `echo`, preserving zero-argument behavior, the sentinel, and exit codes.
4. Verify test passes (GREEN).
5. Commit: "fix(test): forward scoped arguments to the runner instead of the sentinel echo"

**Files likely touched:**
- `src/conductor/package.json` — `test` and `test:changed` script definitions
- `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts` — update the pinned
  script string at `:241` (conflict F3)

**Wired-into:** `src/conductor/src/engine/full-suite-executor.ts#testSuite.command`
**Dependencies:** Task 1

### Task 17: Prove forwarded arguments reach the runner and failures still fail
**Story:** 7
**Type:** negative
**Steps:**
1. Write failing tests: forwarded argument values never appear as echoed output (proving they
   reached the runner, not the `echo`); a forwarded argument selecting a failing test exits non-zero
   and does not emit the sentinel.
2. Verify tests fail (RED).
3. Implement: adjust the script shape if either assertion fails.
4. Verify tests pass (GREEN).
5. Commit: "test: prove forwarded arguments bypass the sentinel echo"

**Files likely touched:**
- `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts` — forwarding and
  failure-propagation assertions

**Wired-into:** same as Task 16
**Dependencies:** Task 16

### Task 18: Point the grader instruction at the interface and correct its stale ownership clause
**Story:** 8
**Type:** happy
**Steps:**
1. Write failing test: the grader prompt names the scoped-run interface rather than a
   package-manager command, and no longer claims the full suite "runs at CI and at finish" — #940
   moved that ownership to the `test_suite` gate (conflict F4).
2. Verify test fails (RED).
3. Implement: edit the instruction paragraph at `build-review-prompt.ts:58-60` only. Do not touch the
   rubric block, the verdict schema, or the diff/plan sections.
4. Verify test passes (GREEN).
5. Commit: "fix(build-review): name the scoped-run interface in the grader instruction"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — instruction paragraph
- `src/conductor/test/engine/build-review-prompt.test.ts` — interface named, stale clause gone

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.runBuildReview`
**Dependencies:** Task 13

### Task 19: Prove grader input isolation survives and the fallback triggers are intact
**Story:** 8
**Type:** negative
**Steps:**
1. Write failing tests: `assembleBuildReviewInputs` still takes only the git runner and plan path,
   and the prompt still contains no scoped-test summary, command output, or maker narrative; all
   four broad-fallback triggers remain present and unmodified after the skill/HARNESS edits.
2. Verify tests fail (RED).
3. Implement: update `skills/pipeline/SKILL.md`, `skills/tdd/SKILL.md`, and the `HARNESS.md`
   intermediate test execution policy to invoke the interface, leaving the four triggers verbatim
   and leaving selection derivation with the agent (conflict F1 — trigger 3 is not removed).
4. Verify tests pass (GREEN).
5. Commit: "docs(contract): route scoped verification through the interface"

**Files likely touched:**
- `skills/pipeline/SKILL.md` — scoped VERIFY invocation
- `skills/tdd/SKILL.md` — scoped RED/GREEN invocation
- `HARNESS.md` — intermediate test execution policy
- `src/conductor/test/engine/build-review-isolation.test.ts` — isolation assertions

**Wired-into:** same as Task 18
**Dependencies:** Task 18

## Task Dependency Graph

```
Task 1 (config key)
 ├─ Task 2 (missing placeholder) ─ Task 3 (malformed values)
 ├─ Task 16 (repair scripts) ─ Task 17 (forwarding proof)
 └─ Task 4 (module core)
     ├─ Task 5 (multi/mid placeholder)
     │   ├─ Task 6 (failure classification) ─ Task 13 (CLI wiring)
     │   │                                     ├─ Task 14 (no evidence) ─ Task 15 (aggregate regression)
     │   │                                     └─ Task 18 (grader) ─ Task 19 (isolation + contracts)
     │   └─ Task 9 (quoting) ─ Task 10 (metacharacters)
     ├─ Task 7 (empty refusal) ─ Task 8 (blank + message)
     └─ Task 11 (unavailable) ─ Task 12 (missing config)
```

Acyclic. Tasks 2/3, 7/8, 9/10, 11/12, and 16/17 are independent branches once their parent lands.

## Integration Points

- **After Task 13** — the verb is reachable end to end: a real `conduct-ts` invocation runs a scoped
  selection, and both refusal paths are live.
- **After Task 15** — the aggregate boundary is proven intact; the scoped path demonstrably cannot
  satisfy or corrupt the `test_suite` gate.
- **After Task 17** — this repo's own invocation forms are safe, so the trap that caused the incident
  is gone regardless of which form a human or agent reaches for.
- **After Task 19** — machinery and contracts agree; no call site describes hand-assembly.

## Coverage Mapping

| Story | Happy covered by | Negative covered by |
|---|---|---|
| 1 — scoped run executes only the selection | Tasks 4, 5, 13 | Task 6 |
| 2 — template ignoring selection rejected | Task 1 | Tasks 2, 3 |
| 3 — empty selection refused | Task 4 | Tasks 7, 8 |
| 4 — selectors reach the runner intact | Task 9 | Task 10 |
| 5 — unconfigured key explicit | Task 12 | Task 11 |
| 6 — aggregate semantics unchanged | Task 15 | Task 14 |
| 7 — no invocation form expands | Task 16 | Task 17 |
| 8 — call sites use the interface | Task 18 | Task 19 |

All eight stories are cited; both path types are covered for every story.

## Condition Tracking

| Condition | Where satisfied |
|---|---|
| C1 — never edit `bin/conduct` | Prerequisites + Task 13 step 3 |
| C2 — call-site updates in scope | Tasks 18, 19 |
| C3 — selector with a space | Task 9 |
| C4 — unconfigured negative path | Task 11 |
| C5 — no #1176/#1205 overlap | Conflict report; no task touches reuse, latency, size, or calibration |
| C6 — release note, no VERSION bump | `release-disposition` step; no task writes `CHANGELOG.md` or `VERSION` |
| C7 — documentation | `maintain-documentation` step (see Documentation note) |
| C8 — empty-selection refusal | Tasks 7, 8 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Wired-into:**` line
- [ ] No terminal catch-all validation task
- [ ] `bin/conduct` absent from every task's file set
