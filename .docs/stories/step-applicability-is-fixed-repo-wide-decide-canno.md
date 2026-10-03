**Status:** Accepted

# Stories: Per-feature step applicability (#1789)

Source PRD: .docs/specs/step-applicability-is-fixed-repo-wide-decide-canno.md
Governing ADR: adr-2026-10-03-per-feature-step-applicability

## Story 1: Per-feature applicability is off unless the repository enables it

**Requirement:** FR-1

As a repository maintainer, I want per-feature step applicability to be disabled unless I turn it on, so that my repository's pipeline does not change without my choice.

### Acceptance Criteria

#### Happy Path
- Given a repository config with no per-feature applicability setting, when the resolved config is loaded, then per-feature applicability resolves as disabled.
- Given a repository config that enables per-feature applicability, when the resolved config is loaded, then per-feature applicability resolves as enabled.

#### Negative Paths
- Given a repository config whose per-feature applicability enabled value is a non-boolean such as the string "yes", when the config is validated, then validation fails with an error naming the per-feature applicability setting and the expected boolean type.
- Given a repository config whose per-feature applicability block carries an unknown key, when the config is validated, then validation fails with an error naming the unknown key.
- Given a user-level config that enables per-feature applicability and a project config that does not set it, when the resolved config is loaded for that project, then per-feature applicability resolves as disabled.

### Done When
- [ ] Resolved config exposes per-feature applicability as disabled when the setting is absent and enabled only when explicitly set true.
- [ ] Config validation rejects a non-boolean enabled value and unknown keys in the block with errors naming the offending key.
- [ ] A user-level enable never turns the capability on for a project, and the setting is registered as a consumed config key.

## Story 2: A disabled repository dispatches exactly as before

**Requirement:** FR-2

As an operator of a repository that has not opted in, I want step selection to be unchanged, so that existing features build exactly as they do today.

### Acceptance Criteria

#### Happy Path
- Given per-feature applicability is disabled and a feature has no applicability marker, when the daemon dispatches the feature, then the set of steps run and skipped equals the set produced before this feature for the same tier, track, and config.
- Given per-feature applicability is disabled and a feature's tier is S, when the daemon dispatches the feature, then tier skips are recorded exactly as before with their existing tier skip event.

#### Negative Paths
- Given per-feature applicability is disabled and the base branch carries an applicability marker for the feature declaring manual_test inapplicable, when the daemon dispatches the feature, then manual_test runs and a step_inapplicable_ignored event with cause toggle-off naming manual_test is persisted.
- Given per-feature applicability is disabled and a feature has no applicability marker, when the daemon dispatches the feature, then no step_inapplicable, step_inapplicable_ignored, or step_inapplicable_refused event is emitted.

### Done When
- [ ] With the capability disabled, dispatch for a feature with no marker records the same step statuses and skip events as the pre-change behavior.
- [ ] With the capability disabled, a base marker is ignored, the declared step runs, and a toggle-off ignored event is persisted.

## Story 3: DECIDE can declare a step inapplicable with a reason

**Requirement:** FR-3

As a DECIDE author, I want to declare that a named step does not apply to this feature and say why, so that the operator can review the declaration in the spec PR.

### Acceptance Criteria

#### Happy Path
- Given an applicability marker for the feature with one line declaring acceptance_specs inapplicable with the reason "no new behavior to specify", when the marker is parsed, then exactly one declaration is returned with step acceptance_specs and that reason.
- Given an applicability marker with two declaration lines for manual_test and acceptance_specs plus free prose lines, when the marker is parsed, then two declarations are returned in file order and the prose lines are ignored.

#### Negative Paths
- Given an applicability marker with a declaration line whose reason is empty or whitespace only, when the marker is parsed, then parsing returns an empty-reason error naming that line.
- Given an applicability marker with a declaration line missing the separator between step and reason, when the marker is parsed, then parsing returns a malformed-line error naming that line.

### Done When
- [ ] The marker parser returns ordered step-and-reason declarations for well-formed lines and ignores prose.
- [ ] The parser returns typed errors naming the line for an empty reason and for a malformed declaration line.

## Story 4: Only opted-in steps are declarable and the correctness core never is

**Requirement:** FR-4

As an operator, I want only steps that state they may be declared inapplicable to be declarable, so that the gates which prove a change correct can never be declared away.

### Acceptance Criteria

#### Happy Path
- Given the built-in step catalog, when declarability is queried for each step, then exactly acceptance_specs and manual_test report declarable.
- Given a declaration for acceptance_specs in an enabled repository, when the declaration is checked against step metadata, then it is accepted as declarable.

#### Negative Paths
- Given a declaration for test_suite, build_review, finish, prd_audit, architecture_review_as_built, or coverage_binding, when the declaration is checked against step metadata, then it is rejected as not declarable naming the step.
- Given a declaration for a structural step such as build or rebase, or for a DECIDE-phase step such as plan or stories, when the declaration is checked against step metadata, then it is rejected as not declarable naming the step.
- Given a custom step defined in repository config, when a feature declares it inapplicable, then it is rejected as not declarable naming the custom step.

### Done When
- [ ] Step metadata marks exactly acceptance_specs and manual_test declarable and no others.
- [ ] Declarability checks reject test_suite, build_review, finish, prd_audit, architecture_review_as_built, coverage_binding, every structural step, every DECIDE-phase step, and every custom step.

## Story 5: Landing a spec refuses an invalid declaration

**Requirement:** FR-5

As an operator, I want a spec with an invalid declaration to be refused at land with a message naming the offending line, so that a bad declaration never reaches the base branch.

### Acceptance Criteria

#### Happy Path
- Given an enabled repository and an idea worktree whose applicability marker declares manual_test inapplicable with a non-empty reason, when the spec is landed, then land succeeds and the marker is committed with the other DECIDE artifacts.
- Given an enabled repository and an idea worktree with no applicability marker, when the spec is landed, then land behaves exactly as before.

#### Negative Paths
- Given an enabled repository and a marker declaring a step name that is not in the step catalog, when the spec is landed, then land is refused with a typed error naming the unknown step and the line.
- Given an enabled repository and a marker declaring test_suite inapplicable, when the spec is landed, then land is refused with a typed not-declarable error naming test_suite.
- Given an enabled repository and a marker with an empty reason, when the spec is landed, then land is refused with a typed empty-reason error naming the line.
- Given an enabled repository and a marker declaring manual_test twice, when the spec is landed, then land is refused with a typed duplicate-declaration error naming manual_test.
- Given a repository with per-feature applicability disabled and an idea worktree carrying an applicability marker, when the spec is landed, then land is refused with a typed capability-disabled error naming the marker.
- Given an enabled repository and an applicability marker filed under a stem that differs from the feature's plan stem, when the spec is landed, then land is refused with the existing artifact stem mismatch error.

### Done When
- [ ] Land succeeds with a valid marker and commits it, and is unchanged when no marker exists.
- [ ] Land refuses unknown-step, not-declarable, empty-reason, duplicate, capability-disabled, and stem-mismatch markers with typed errors naming the offending line or step.

## Story 6: A merged declaration skips the step for that feature only

**Requirement:** FR-6

As an operator, I want a merged declaration to skip the declared step for that feature and no other, so that one change's shape never alters another's pipeline.

### Acceptance Criteria

#### Happy Path
- Given an enabled repository and a base-branch marker for feature A declaring acceptance_specs inapplicable, when the daemon dispatches feature A, then acceptance_specs is recorded skipped for feature A and does not run.
- Given the same repository and a feature B with no marker dispatched concurrently with feature A, when the daemon dispatches feature B, then acceptance_specs runs for feature B.
- Given an enabled repository and a base-branch marker declaring manual_test inapplicable, when the parallel validation group starts for that feature, then manual_test is absent from the group's dispatched members and no group branch runs it.

#### Negative Paths
- Given an enabled repository and a base-branch marker for feature A, when the daemon dispatches feature B whose undated stem differs from feature A's stem, then no declaration from feature A's marker is applied to feature B.
- Given an enabled repository and two plans whose undated stems collide with an applicability marker's stem, when the daemon resolves the marker, then the marker is treated as ambiguous, no declaration is applied, and the ambiguity is logged as for tier and track markers.

### Done When
- [ ] A declared step is recorded skipped and not executed for the declaring feature, including inside the parallel validation group.
- [ ] Features without a matching marker, including concurrent ones and ambiguous stems, run the step normally.

## Story 7: Only declarations merged to the base branch take effect

**Requirement:** FR-7

As an operator, I want only declarations that are part of the merged spec on the base branch to take effect, so that an autonomous run cannot declare a gate away on its own.

### Acceptance Criteria

#### Happy Path
- Given an enabled repository and an applicability marker present on the base branch, when the daemon dispatches the feature, then the declarations from the base copy are applied.
- Given an enabled repository and identical marker content on the base branch and in the feature worktree, when the daemon dispatches the feature, then the declarations are applied and no ignored event is emitted.

#### Negative Paths
- Given an enabled repository and an applicability marker present only in the feature worktree and absent from the base branch, when the daemon dispatches the feature, then no declared step is skipped and a step_inapplicable_ignored event with cause branch-only is persisted.
- Given an enabled repository and a worktree marker whose content adds a declaration not present in the base copy, when the daemon dispatches the feature, then only the base copy's declarations are applied and a step_inapplicable_ignored event with cause branch-only is persisted.
- Given an enabled repository and an applicability marker in the working checkout, when an interactive non-daemon run dispatches the feature, then no declared step is skipped and a step_inapplicable_ignored event with cause interactive is persisted.
- Given an enabled repository and a base-branch marker that declares prd_audit inapplicable after a hand-pushed merge that bypassed land, when the daemon dispatches the feature, then nothing in that marker is honored and a step_inapplicable_ignored event with cause invalid naming prd_audit is persisted.
- Given an enabled repository where reading the marker from the base branch fails, when the daemon dispatches the feature, then no declared step is skipped and the failure is logged naming the marker path.

### Done When
- [ ] Dispatch applies only base-branch declarations.
- [ ] A worktree-only or worktree-divergent marker, an interactive run, an invalid base marker, and a failed base read skip nothing declared.
- [ ] Ignored events carry cause branch-only, interactive, or invalid matching the case.

## Story 8: A declaration cannot get a started step past its gate

**Requirement:** FR-8

As an operator, I want a declaration that arrives after a step has started to be refused, so that a failing gate cannot be declared away.

### Acceptance Criteria

#### Happy Path
- Given an enabled repository and a merged declaration for manual_test whose status for the feature is pending, when the daemon dispatches the feature, then manual_test is skipped as inapplicable.
- Given an enabled repository and a merged declaration for a step that has already been skipped as inapplicable, when the feature is re-dispatched, then the step stays skipped and no refused event is emitted.
- Given manual_test skipped as inapplicable for a feature, when the feature is rebased onto a new base or rewound, then manual_test stays skipped as inapplicable and no refused event is emitted.

#### Negative Paths
- Given an enabled repository and manual_test failed for the feature, when a spec amendment declaring manual_test inapplicable is merged and the feature is re-dispatched, then manual_test is not skipped, its failed status stands, and a step_inapplicable_refused event naming manual_test with prior status failed is persisted.
- Given an enabled repository and manual_test in progress or halted for the feature, when a declaration for manual_test is merged and the feature is re-dispatched, then manual_test is not skipped and a step_inapplicable_refused event with that prior status is persisted.
- Given an enabled repository and acceptance_specs already done for the feature, when a declaration for acceptance_specs is merged and the feature is re-dispatched, then acceptance_specs keeps its done status and a step_inapplicable_refused event with prior status done is persisted.

### Done When
- [ ] Only steps whose status is pending at dispatch are skipped by a declaration.
- [ ] Declarations for in-progress, failed, refused, done, or stale steps leave the prior status unchanged and persist a refused event naming the prior status.
- [ ] A step already honored as inapplicable stays skipped across re-dispatch, rebase, and rewind without a refused event.

## Story 9: An inapplicable step is recorded distinctly

**Requirement:** FR-9

As an operator, I want a step skipped by a declaration to show as inapplicable, so that I can tell it apart from a tier skip, a track skip, a config disable, a failure, and a step that never ran.

### Acceptance Criteria

#### Happy Path
- Given an enabled repository and a merged declaration honored for manual_test, when dispatch skips it, then a step_inapplicable event naming manual_test and its reason is persisted and exported to telemetry.
- Given a feature with one inapplicable step, one tier-skipped step, and one config-disabled step, when the operator views the feature's dashboard step lines, then the inapplicable step renders with its own icon and its reason and the other two render as plain skipped.
- Given a feature with an inapplicable step, when the operator views daemon status, then the feature lists the inapplicable step with its reason.

#### Negative Paths
- Given a feature whose step was tier-skipped or config-disabled, when the operator views the dashboard or daemon status, then that step is not shown as inapplicable and no step_inapplicable event exists for it.
- Given a feature whose declared step was refused as late, when the operator views the dashboard, then the step shows its prior status, not inapplicable.

### Done When
- [ ] An honored declaration persists a step_inapplicable event and exports it to telemetry.
- [ ] The dashboard and daemon status show inapplicable steps with their reason, distinct from tier, track, config, failed, and never-run steps.

## Story 10: The record shows who decided

**Requirement:** FR-10

As an operator, I want the inapplicable record to carry the reason and the identity behind the merge that brought the declaration onto the base branch, so that I can audit who declared a gate away.

### Acceptance Criteria

#### Happy Path
- Given an applicability marker introduced on the base branch by a squash-merge commit authored by "Op Erator <operator@example.com>", when the daemon resolves the declaration, then the inapplicable record's decider author is that identity, its committer is the commit's committer identity, and its commit is that commit's sha.
- Given a marker introduced by one base commit and later amended by a second base commit, when the daemon resolves the declaration, then the decider and commit are taken from the latest first-parent base commit that touched the marker.

#### Negative Paths
- Given a base branch where the commit that touched the marker cannot be resolved, when the daemon resolves the declaration, then the decider is recorded as unknown, the declaration is still honored, and the record carries the sha when one is available.
- Given a marker touched only by a non-first-parent commit inside a merged branch, when the daemon resolves the declaration, then the decider comes from the first-parent merge commit on the base branch, not the inner branch commit.

### Done When
- [ ] The step_inapplicable event and the feature's state record carry reason, decider author, decider committer, and commit sha.
- [ ] The decider identity is never used to resolve the daemon owner or authorize any action.
- [ ] An unresolvable decider records unknown without blocking the skip.

## Story 11: Downstream gates treat an inapplicable step as satisfied

**Requirement:** FR-11

As an operator, I want downstream steps to proceed past an inapplicable step without failing or halting over its missing output, so that declaring a step inapplicable does not cause a different gate to fail.

### Acceptance Criteria

#### Happy Path
- Given manual_test declared inapplicable and skipped, when prd_audit's prerequisites are evaluated, then manual_test counts as satisfied and prd_audit is dispatched.
- Given manual_test declared inapplicable and skipped, when finish evaluates ship evidence, then finish proceeds and prd_audit and the as-built review still run before it.

#### Negative Paths
- Given acceptance_specs declared inapplicable and skipped, when build and build_review prerequisites are evaluated, then both are dispatched and neither halts for a missing prerequisite.
- Given acceptance_specs declared inapplicable and skipped, when coverage_binding runs, then its obligation and slice layers still run and it does not halt for missing acceptance specs.

### Done When
- [ ] Prerequisite and ship-evidence checks treat an inapplicable step as satisfied.
- [ ] No downstream step fails or halts because a declared step was skipped.
