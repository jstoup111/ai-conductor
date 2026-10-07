**Status:** Accepted

# Stories: Maintenance-change lane for refactors, deletions, and dependency upgrades (#1790)

Technical track, tier S. Source: jstoup111/ai-conductor#1790. Approved approach: a documented
maintenance-change recipe on existing machinery (the technical track, per-feature applicability
from #1789, Verify-only and removal-shaped plan tasks). No new gate behavior; the change class is
carried in each applicability declaration's reason, attributed by the marker's merge commit.

## Story 1: This repository honors per-feature applicability declarations

**Requirement:** #1790 outcome — a maintenance change can be taken through the harness here with
inapplicable gates declared rather than argued down.

As the operator of this repository's daemon, I want per-feature applicability enabled so that a
merged maintenance spec's declarations are honored instead of ignored.

### Acceptance Criteria

#### Happy Path
- Given this repository's committed project config, when the engine loads it, then `feature_applicability.enabled` resolves to `true`.
- Given a merged spec with no `.docs/applicability/<stem>.md` marker, when the daemon runs it, then the same steps run and skip as before the toggle was enabled (no `step_inapplicable` event is emitted for it).

#### Negative Paths
- Given a spec whose applicability marker declares `test_suite` (or `build_review`, or `finish`) inapplicable, when `land-spec` validates it, then landing is refused with an `applicability-invalid` error naming `not-declarable`, and the step still runs and blocks for that feature.

### Done When
- [ ] `.ai-conductor/config.yml` sets `feature_applicability: { enabled: true }` and the project config loads without error.
- [ ] The resolved config for this repository reports `feature_applicability.enabled === true`.

## Story 2: DECIDE records a maintenance change's class and inapplicable steps

**Requirement:** #1790 outcomes — classification is recorded and attributable; gates whose premises
do not hold for the class are declared, not argued; feature work is unaffected.

As the DECIDE author of a refactor, deletion, or dependency upgrade, I want the shipped DECIDE
skills to tell me when and how to record the change as maintenance so that the class and the
inapplicable steps are committed with the spec and reviewed in its PR.

### Acceptance Criteria

#### Happy Path
- Given an operator-confirmed change whose only acceptance criterion is that existing behavior is unchanged (refactor, dependency upgrade) or that a named capability is gone and everything else still passes (deletion), and the target project enables `feature_applicability`, when DECIDE confirms the track, then it records the `technical` track and writes `.docs/applicability/<stem>.md` declaring `acceptance_specs` inapplicable with a reason that names the change class (for example `Inapplicable: acceptance_specs — dependency upgrade: the existing suite is the specification`).
- Given that maintenance spec is landed, when `land-spec` validates it, then the marker passes validation and is committed in the spec PR alongside the track marker.

#### Negative Paths
- Given a change that introduces or changes observable behavior, including a dependency upgrade that also adds a feature, when DECIDE classifies it, then it is not recorded as maintenance and no applicability marker is written; the normal flow applies.
- Given the operator has not confirmed the maintenance classification, when DECIDE reaches the track decision, then an interactive run waits for confirmation, an autonomous run HALTs, and no applicability marker is written in either case.
- Given the target project does not enable `feature_applicability`, when DECIDE handles a maintenance change, then it writes no applicability marker (which `land-spec` would refuse) and directs the change through `acceptance_specs`' existing disposition-only outcome, citing the existing tests that cover each criterion.

### Done When
- [ ] The shipped DECIDE skill that confirms the track documents the maintenance classification, its three classes, the confirmation requirement, and the marker it writes, including the reason-names-the-class rule and the toggle-off fallback.
- [ ] The shipped DECIDE skill text no longer limits that skill to writing only the track marker when a maintenance classification is confirmed.

## Story 3: Maintenance plans and builds carry the right evidence without a fabricated RED

**Requirement:** #1790 outcomes — durable evidence equal to a feature's; gates that do hold (the
suite, integrity checks, release metadata) still run and block.

As the planner and builder of a maintenance change, I want the shipped plan and TDD skills to name
the task shape and evidence for each class so that no task invents a failing test and no gate that
applies is skipped.

### Acceptance Criteria

#### Happy Path
- Given a dependency-upgrade or refactor maintenance spec, when its plan is authored, then each task that changes no observable behavior is marked `**Verify-only:** yes` and its Done-when names the existing suite (or the scoped existing tests) passing as the evidence.
- Given a deletion maintenance spec, when its plan is authored, then removal tasks follow `code-removal` (deletion diff plus passing scoped survivor tests) and are not marked Verify-only.
- Given a maintenance task under build, when TDD ordering is applied, then the skill directs the builder to the existing no-legitimate-RED or removal-boundary path rather than requiring a new failing test.

#### Negative Paths
- Given a maintenance plan task that adds or changes behavior (for example adapting code to a changed dependency API in a way callers can observe), when the plan is authored, then that task is not marked Verify-only and follows normal test-first ordering.
- Given a maintenance spec, when it reaches SHIP, then `test_suite`, the integrity checks, and the release-disposition contract run exactly as for a feature and a failure still blocks; the recipe declares none of them inapplicable.

### Done When
- [ ] The shipped plan skill documents the per-class task shape and evidence for maintenance changes, including the rule against Verify-only on behavior-changing tasks.
- [ ] The shipped TDD skill routes maintenance tasks to its existing no-legitimate-RED and removal-boundary sections.

## Story 4: Agent-facing text no longer steers toward retired rubrics or a nonexistent skip

**Requirement:** #1790 premise correction — the `scope`, `completeness`, and `tautology` rubrics are
retired (adr-2026-08-22-one-owner-per-review-question), and the technical track does not skip
`prd_audit`.

As an agent reading the shipped skills or engine source, I want them to describe the gates that
actually run so that I do not shape maintenance work around reviews that no longer exist.

### Acceptance Criteria

#### Happy Path
- Given the shipped `plan`, `pipeline`, and `tdd` skills, when they describe what reads Verify-only evidence, satisfied-by tasks, or tests that pass before a change, then they name the current owner (`prd_audit` for plan completion, the `testQuality` rubric for test signal) instead of the retired completeness or tautology rubrics.
- Given the engine source and project config comments describing track skips, when they describe the technical track, then they state that it skips only `prd`.

#### Negative Paths
- Given a search of the shipped skills and engine comments for instructions that rely on the `scope`, `completeness`, or `tautology` rubric, when it runs, then the only matches are statements that those rubrics are retired.

### Done When
- [ ] `skills/plan/SKILL.md`, `skills/pipeline/SKILL.md`, and `skills/tdd/SKILL.md` contain no instruction that depends on a retired rubric.
- [ ] The comments at `.ai-conductor/config.yml` (track-skip pipeline description), `src/conductor/src/engine/daemon.ts` (`track` field doc), and `src/conductor/src/engine/conductor.ts` (SHIP-loop track resolution) no longer claim the technical track skips `prd_audit`.
