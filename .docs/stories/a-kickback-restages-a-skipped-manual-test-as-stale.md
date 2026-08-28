**Status:** Accepted

# Stories: a-kickback-restages-a-skipped-manual-test-as-stale (#1987)

Technical track — acceptance criteria derive from intake #1987's desired outcomes and the
approved architecture review (2026-08-27). Outcome tags reference
`.pipeline/intake-outcomes.md` bullets 1–4.

## Story 1: A kickback never restages a skipped step

**Requirement:** outcome-1, outcome-2

As an operator running a feature that legitimately skips `manual_test`, I want every kickback to
leave skipped steps skipped so that the feature reaches FINISH without my intervention.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `manual_test` status is `skipped`, when a `build_review` kickback restages the SHIP tail, then `manual_test` remains `skipped` in conduct-state and only steps that actually ran are marked `stale`
- Given a feature whose `manual_test` status is `skipped` and a validation-group member fails, when the consolidated kickback restages the group, then `manual_test` and every other skipped member remain `skipped`
- Given a feature whose `manual_test` status is `skipped` that has taken a kickback, when the run reaches the FINISH preflight, then ship evidence reports present and publication proceeds without `ship_evidence_invalid`
- Given a `manual_test` that ran and FAILED, when its FAIL kickback routes back to build, then `manual_test` is restaged `stale` exactly as before

#### Negative Paths
- Given a feature whose `manual_test` status is `skipped`, when two successive kickbacks occur before FINISH, then `manual_test` is still `skipped` after both and the FINISH preflight passes
- Given a kickback whose stale set names both a `done` step and a `skipped` step, when the restage commits, then the `done` step becomes `stale` while the `skipped` step is untouched — the filter is per-field, not all-or-nothing
- Given a kickback whose stale set is emptied entirely by the skip filter, when the restage runs, then no state write occurs and the kickback's routing target, retry hints, and kickback-ledger budget are unchanged
- Given a step whose status is `failed`, when a kickback restages it, then it becomes `stale` — the filter preserves only `skipped`, never blocking legitimate restage of ran steps

### Done When
- [ ] All four kickback restage sites in `src/conductor/src/engine/conductor.ts` (manual_test FAIL kickback, validation-group kickback, validation-gaps kickback, build_review kickback) build their stale set through one shared skip-preserving helper
- [ ] An engine test drives a skipped-`manual_test` feature through a `build_review` kickback and asserts `manual_test: 'skipped'` survives in `.pipeline/conduct-state.json` and FINISH preflight reports ship evidence present
- [ ] An engine test asserts a failed `manual_test` is still restaged `stale` by its kickback (no behavior change for ran steps)

## Story 2: The state store refuses a skipped-to-stale write and reports it

**Requirement:** outcome-1, outcome-3

As an operator, I want any code path that tries to overwrite a skipped step with stale to be
refused and reported at the moment of the write, so that state and gate verdicts can never
silently disagree about a skip.

### Acceptance Criteria

#### Happy Path
- Given a state mutation batch containing `manual_test: skipped → stale`, when the mutation port applies the batch, then that field's write is refused, every other field in the batch applies normally, and the persisted state keeps `manual_test: 'skipped'`
- Given a refused skipped-to-stale write, when the refusal occurs, then a conductor event naming the field, expected value, requested value, and mutation intent is emitted on the existing event spine and lands in `.pipeline/events.jsonl`
- Given a refused skipped-to-stale write during a live run, when the refusal is reported, then the run continues (no throw out of the conductor loop, no halt) with the skipped status preserved

#### Negative Paths
- Given a mutation batch writing `done → stale` or `failed → stale`, when the port applies it, then the write succeeds — the domain rule matches only a `skipped` expected value
- Given a mutation batch writing `skipped → done` (a step legitimately re-decided and run), when the port applies it, then the write succeeds — only the `stale` requested value is refused
- Given a restage-shaped call site that bypasses the shared helper, when it attempts `skipped → stale`, then the port refusal still protects the state — the invariant does not depend on callers using the helper
- Given the new refusal event member, when the sink registry compiles, then render, persist, and audit sinks each declare a handler — a missing declaration is a compile error, not a silent drop

### Done When
- [ ] A registered domain rule on the conduct-state mutation port (beside the existing terminal `feature_status` rule) refuses `skipped → stale` per adr-2026-08-01 conflict rules 3 and 4, with no generic status ordering introduced
- [ ] A new `ConductorEvent` member carries field, expected, requested, and intent; it is declared in the compile-time-exhaustive sink registry and appears in `.pipeline/events.jsonl` in a test that forces a refusal
- [ ] A test proves a refusal is non-fatal: the batch's other fields persist, the run continues, and the skipped status is intact on disk

## Story 3: --diagnose reports a skipped step as skipped

**Requirement:** outcome-4

As an operator diagnosing a worktree, I want `conduct-ts inline --diagnose` to report
legitimately skipped steps as skipped rather than as missing evidence, so that the diagnosis
points at real gaps only.

### Acceptance Criteria

#### Happy Path
- Given a complete-marked worktree whose state records `manual_test` and `finish` as `skipped`, when `--diagnose` runs, then neither step appears as an evidence gap and the command reports the state as consistent
- Given a complete-marked worktree with one `skipped` step and one genuinely missing artifact for a `done` step, when `--diagnose` runs, then only the `done` step is reported as a gap

#### Negative Paths
- Given a complete-marked worktree whose `test_suite` is `done` but its evidence artifact is missing, when `--diagnose` runs, then the gap is still reported and the exit code is still non-zero — skip-awareness loosens nothing for ran steps
- Given a worktree whose step status is absent (pending) with no evidence, when `--diagnose` runs, then the step is still reported as a gap — only an explicit `skipped` status short-circuits the artifact check

### Done When
- [ ] `verifyCompleteState` treats a step whose conduct-state status is `skipped` as satisfied for reporting, before running its artifact-presence predicate
- [ ] A test covers the mixed case: skipped steps excluded from the gap report while a genuine missing-evidence gap on a ran step still fails closed with the existing reason text
