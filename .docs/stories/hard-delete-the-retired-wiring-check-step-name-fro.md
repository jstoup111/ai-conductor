**Status:** Accepted

# Stories: Hard-delete the retired wiring_check step name

Technical track (no PRD). Source: issue jstoup111/ai-conductor#1896, staged intake outcomes, and
`architecture-review-2026-08-26-hard-delete-the-retired-wiring-check-step-name-fro` (conditions
C1–C5). Removal-shaped: criteria describe surviving observable behavior, not absence of code.

## Story 1: Step surfaces present only real pipeline steps

As an operator, I want every step-facing surface to present only steps that perform work, so that
listings, dashboards, and the model table describe the actual pipeline.

### Acceptance Criteria

#### Happy Path
- Given the engine's step registry, when the ordered step list for a BUILD-phase feature is resolved, then every listed step dispatches work and `test_suite` is the sole deterministic BUILD verification step
- Given the model-selection table generator, when `bin/generate-model-table` runs, then its output matches the committed HARNESS.md generated section and integrity check 5a passes
- Given the daemon dashboard/status rendering of a BUILD-phase feature, when steps are rendered, then only registry steps appear

#### Negative Paths
- Given a CLI invocation naming a step absent from the registry (for example `conduct-ts rewind --to wiring_check`), when it executes, then it fails by name with an error identifying the unknown step, and no state is mutated
- Given the integrity suite, when a step-keyed metadata table retains an entry for a step absent from the registry, then the validation suite fails naming the drifted table

### Done When
- [ ] `conduct-ts` step listing / dashboard snapshot for a BUILD feature shows `test_suite` and no other deterministic BUILD verification step
- [ ] `test/test_harness_integrity.sh` passes, including check 5a on the regenerated HARNESS.md table
- [ ] `rewind --to wiring_check` exits non-zero with an unknown-step error naming `wiring_check`

## Story 2: BUILD verification gates build_review on the deterministic suite alone

As an operator, I want BUILD to run exactly one deterministic verification after `build`, so that
no dispatch slot is spent on a branch that performs no work.

### Acceptance Criteria

#### Happy Path
- Given a BUILD-phase feature whose `build` step completes, when verification runs, then `test_suite` executes and, on a green result, `build_review` becomes dispatchable
- Given a green `test_suite`, when `build_review` dispatches, then its prerequisite set is satisfied by `test_suite` alone

#### Negative Paths
- Given a BUILD-phase feature, when `test_suite` fails deterministically, then `build_review` is not dispatched and no review tokens are spent
- Given a BUILD-phase feature mid-verification, when the engine restarts, then resume re-enters at the correct step without emitting a `parallel_started` event for a BUILD verification group

### Done When
- [ ] Acceptance test: build → test_suite → build_review ordering holds with no group fan-out events emitted for BUILD verification
- [ ] Acceptance test: failing test_suite blocks build_review dispatch

## Story 3: Deterministic suite failure keeps its repair and budget semantics

As an operator, I want a failing `test_suite` to be classified and budgeted exactly as before, so
that livelock bounds and gate-repair recording survive the fan-out lane's removal (review
condition C2, amended adr-2026-07-29 point 4).

### Acceptance Criteria

#### Happy Path
- Given a deterministic `test_suite` failure, when the engine processes it, then a gate-repair record is written for `test_suite` and the per-gate kickback budget is charged exactly once
- Given a `test_suite` failure followed by a fixing change, when verification re-runs and passes, then the feature proceeds and the kickback ledger reflects the reset-on-progress rule

#### Negative Paths
- Given repeated identical `test_suite` failures with no tree change, when the per-gate kickback cap is reached, then the run halts with the existing cap message naming `test_suite`
- Given a `test_suite` infrastructure failure (suite could not run), when the engine processes it, then it is not charged as a semantic kickback and the failure class is preserved in the halt/event output

### Done When
- [ ] Acceptance test: serial-path test_suite failure produces the same gate-repair record and single budget charge the group lane produced
- [ ] Acceptance test: kickback cap halt on unchanged repeated failure still triggers

## Story 4: A repaired build re-verifies the suite

As an operator, I want `test_suite` re-run after any BUILD repair even if it was previously green,
so that a repair cannot ship on stale verification evidence (review condition C1,
adr-2026-08-03-build-repair-member-reuse-validity).

### Acceptance Criteria

#### Happy Path
- Given a feature whose `test_suite` completed green and whose build was then repaired, when verification resumes, then `test_suite` executes again against the repaired tree before `build_review` dispatches

#### Negative Paths
- Given a repaired build whose re-run `test_suite` fails, when the engine processes it, then `build_review` is not dispatched and the failure is classified per Story 3
- Given a repaired build, when the engine attempts to reuse the pre-repair `test_suite` evidence, then reuse is refused because the evidence is anchored to the pre-repair tree

### Done When
- [ ] Acceptance test: build repair → test_suite re-executes (not reused) → build_review only after the re-run is green

## Story 5: Pre-deletion state and history remain loadable

As an operator, I want every artifact written while `wiring_check` existed to keep loading, so that
in-flight features resume and historical ledgers stay readable (review condition C3).

### Acceptance Criteria

#### Happy Path
- Given a `conduct-state.json` recording `wiring_check: done` and `build_verification__wiring_check: done`, when the engine resumes the feature, then resume succeeds and the stale keys are ignored without error
- Given a `.pipeline/kickback-ledger.json` containing a `gates.wiring_check` entry, when the ledger loads, then loading succeeds and other gates' entries are fully honored
- Given an `events.jsonl` containing `parallel_started` branches naming `wiring_check` and execution keys of the form `parallel:wiring_check`, when the event log is read (daemon log rendering, timing rollup), then reading succeeds and the entries render without crashing
- Given a historical `.pipeline/gates/wiring_check.json` verdict file, when verdicts are read, then the orphan verdict is inert and affects no gate decision

#### Negative Paths
- Given a `conduct-state.json` whose recorded `last_step` is `wiring_check`, when the feature resumes, then the resume index is derived from the registry walk and the run continues without an unknown-step throw
- Given a persisted `build_member_evidence_reused` event naming member `wiring_check`, when the daemon log renders it, then rendering degrades to a labeled unknown member rather than crashing

### Done When
- [ ] Test over committed fixtures: state, kickback ledger, events log, and gate-verdict directory each containing `wiring_check` residue all load and resume cleanly
- [ ] No loader, renderer, or rollup in the diff validates historical step names against the narrowed `StepName` union

## Story 6: Leftover consumer configuration fails the ordinary way

As a consumer operator, I want a stale `steps.wiring_check:` block in my config to fail exactly as
any unknown step name does, so that the failure is loud, ordinary, and fixed by deleting the block
(operator-decided: no special dead-key diagnostic).

### Acceptance Criteria

#### Happy Path
- Given a consumer config with no `steps.wiring_check` block, when config loads, then resolution succeeds and no step-keyed default for a nonexistent step is applied

#### Negative Paths
- Given a consumer `.ai-conductor/config.yml` with a `steps.wiring_check:` block, when config loads, then loading fails with the existing custom-step validation error naming `wiring_check`, and the process exits non-zero
- Given a consumer config naming any other undeclared step, when config loads, then the identical failure shape applies — the typo guard is not weakened

### Done When
- [ ] Test: config with `steps.wiring_check: {max_retries: 2}` fails load with the custom-step error naming `wiring_check`
- [ ] PR body carries a `## Migration` bash fence removing `steps.wiring_check` blocks from consumer configs
