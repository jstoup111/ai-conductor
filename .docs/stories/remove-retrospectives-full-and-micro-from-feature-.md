**Status:** Accepted

# Stories: Remove retrospectives (full and micro) from feature delivery

Source: jstoup111/ai-conductor#1905. Track: technical (no PRD). Governing design:
`adr-2026-08-26-remove-retrospectives-one-shot` (APPROVED). Removal-shaped per `/code-removal`:
criteria assert surviving observable behavior, never that removed code is absent.

## Story 1: SHIP tail runs serially from as-built review to finish

**Requirement:** outcome-3, outcome-5

As an operator, I want the SHIP tail to reach rebase and finish directly after the as-built
review so that features ship without a retrospective prerequisite or synthetic skip.

### Acceptance Criteria

#### Happy Path
- Given a non-S feature whose `architecture_review_as_built` step is `done` with a satisfied verdict, when the engine evaluates the SHIP tail, then `rebase` is runnable and, once `rebase` is `done`, `finish` becomes runnable.
- Given a completed daemon run, when its executed step sequence is inspected, then the SHIP tail is exactly `architecture_review_as_built`, `rebase`, `finish` in that order.

#### Negative Paths
- Given a feature whose `architecture_review_as_built` step is not satisfied, when the engine evaluates `rebase`, then `rebase` stays gate-blocked (the #922 serial-publication fence still holds).
- Given a validation-group member fails its join, when the SHIP tail is evaluated, then `rebase` does not dispatch and the existing gate_blocked behavior is unchanged.

### Done When
- [ ] `rebase`'s registry prerequisites name `architecture_review_as_built` and the step registry contains no retro entry
- [ ] An engine test pins the SHIP tail ordering `architecture_review_as_built → rebase → finish`, including the skipped-prerequisite acceptance the #922 review required
- [ ] Full conductor suite green

## Story 2: Daemon completion emits the engineer signal without a provider call

**Requirement:** outcome-1

As an operator, I want daemon feature completion to record its structured engineer-store signal
without any retrospective provider dispatch so that completions cost no narrative LLM call.

### Acceptance Criteria

#### Happy Path
- Given a daemon feature completes `done` in any tier, when the engineer signal is emitted, then a valid store record is appended with `narrativeRef` absent and the injected provider adapter records zero invocations.
- Given a daemon feature halts, when the engineer signal is emitted, then the halt narrative file is written and referenced by `narrativeRef` with zero provider invocations (survivor: `renderHaltNarrative`).

#### Negative Paths
- Given the engineer store is unwritable, when signal emission runs, then the failure is reported best-effort without failing the completed run (existing behavior preserved).
- Given a malformed existing signal line, when the store is read, then the reader skips it resiliently (existing 9.1 convention preserved).

### Done When
- [ ] `emitEngineerSignal`/`produceNarrative` tests assert zero provider invocations for `done` outcomes and unchanged halt-narrative output for `halted` outcomes
- [ ] Store schema tests still pass with `narrativeRef` absent on non-halted records
- [ ] Full conductor suite green

## Story 3: BUILD batch boundaries close without a micro-retro obligation

**Requirement:** outcome-2

As an operator, I want batch boundaries to satisfy the closeout gate with the surviving
obligations only so that no micro-retro work, artifact, or event is required or accepted.

### Acceptance Criteria

#### Happy Path
- Given a BUILD batch completes with all surviving closeout obligations recorded, when the batch-boundary gate evaluates, then the batch passes without any micro-retro event present.
- Given a build-tail rollup renders, when its obligations are listed, then only surviving obligations appear and durations aggregate correctly.

#### Negative Paths
- Given `conduct-ts closeout-event micro-retro <start> <end>` is invoked, when the obligation is validated, then the command exits non-zero naming the unknown obligation (surviving allowlist validation).
- Given a surviving obligation's event is missing, when the batch gate evaluates, then the batch still fails closed on that obligation (adr-2026-08-08 enforcement preserved).

### Done When
- [ ] `CLOSEOUT_OBLIGATIONS` and the `pipeline_closeout.obligation` union changed in lockstep (`satisfies` compiles) with micro-retro gone
- [ ] Pipeline skill batch-boundary checklist carries no micro-retro instruction and the gate roster test matches the surviving set
- [ ] Full conductor suite green

## Story 4: Delivery completes retro-free in every tier, mode, and provider, failing by name on stale retro references

**Requirement:** outcome-1

As an operator, I want every run mode to complete without retrospective machinery and to fail
loudly, not silently, when stale retro references survive in state or config.

### Acceptance Criteria

#### Happy Path
- Given an S, M, or L feature in daemon or manual mode under any supported provider, when delivery runs to completion verification, then it completes with no step dispatch for a retrospective and no new file under `.docs/retros/`.
- Given the interactive one-shot step list and SHIP-gating re-verification list, when they are exercised, then they operate over the surviving steps only.

#### Negative Paths
- Given a consumer `settings.json` carrying a `steps.retro.*` key, when config resolves, then resolution fails by name identifying the unknown step (accepted breaking behavior per the ADR waiver).
- Given a live worktree whose `conduct-state.json` records a retro step status, when the engine loads that state, then it fails by name rather than silently stalling (no permanently-pending gate).

### Done When
- [ ] Config resolution and state-load tests pin the fail-by-name behavior for unknown step references
- [ ] `bin/conduct` legacy runner passes its suite with the surviving step arrays
- [ ] Full conductor suite green

## Story 5: Harness surfaces describe only surviving behavior

**Requirement:** outcome-4

As a harness consumer, I want installed skills, configuration, templates, and documentation to
describe only the surviving delivery flow so that nothing offers, requires, or promises
retrospective behavior.

### Acceptance Criteria

#### Happy Path
- Given the harness repo after the change, when `test/test_harness_integrity.sh` runs, then all checks pass, including cross-skill reference check 4 and model-table drift check 5a against the regenerated HARNESS.md.
- Given the docs reference pages for steps, skills, models, artifacts, and CLI, when they are read, then they describe the surviving step graph, skill catalog, and obligation roster consistently.

#### Negative Paths
- Given a literal-name completeness sweep for retro symbols and paths across source, skills, docs, templates, and tests (accounting for the ugrep binary-skip caveat), when hits are reviewed, then every remaining hit is a historical record or an explicitly justified survivor listed in the plan's sweep task.
- Given `test/test_provider_skill_contracts.sh` runs, when the skill audit iterates, then it passes over the surviving skill set.

### Done When
- [ ] `skills/retro/` removed; pipeline, simplify, conduct, manual-test, architecture-review, tdd, bootstrap, intake skills reference only surviving flow
- [ ] HARNESS.md regenerated via `bin/generate-model-table`; templates and docs pages updated in the same PR
- [ ] `test/test_harness_integrity.sh` fully green

## Story 6: Open retro-dependent work is reconciled

**Requirement:** outcome-6

As an operator, I want open issues that assume retrospectives remain to be closed or re-scoped
so that no backlog item can reinvest in the removed behavior.

### Acceptance Criteria

#### Happy Path
- Given issue #717, when the removal lands, then #717 is closed with a comment citing #1905 and the removal ADR as the obsoleting decision.
- Given issue #939, when the removal lands, then #939 carries a re-scoping comment reducing it to its surviving general clause (post-BUILD story lifecycle disposition) or is closed if the operator judges the clause moot.

#### Negative Paths
- Given the residual accepted story file `.docs/stories/retro-followups-per-step-provider-routing-927.md`, when open work is reconciled, then its disposition (implemented, obsolete, or re-homed) is recorded in the #939 comment rather than left implicit.

### Done When
- [ ] #717 closed with obsoleting rationale; #939 commented and re-scoped or closed
- [ ] No open issue in the tracker still requires retrospective machinery

# Task Dependency Note

Ordering constraints for the plan: Story 1 and Story 4's union deletion are one atomic change;
Story 3's lockstep pair is one atomic change; Story 5's skill deletion, reference edits, and
model-table regeneration are one atomic change with respect to integrity checks 4/5a.
