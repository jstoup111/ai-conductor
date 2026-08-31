**Status:** Accepted

# Stories: when: gating authority aligned with disable: (#1777)

Technical track — acceptance criteria derive from the confirmed approach: config-load
rejection of `when:` on steps `disable:` could not disable, plus a rendered `when_skip`
event. Operator-confirmed extension: the same enforcement predicate applies to BOTH keys on
custom steps too. Scope boundary: no runtime guard, no broader gating-policy rework.

## Story 1: Config load rejects when: on non-disableable steps

As an operator, I want a config that puts `when:` on a gating or structural step that
disallows `disable:` to fail at config load, so that a gating step can never be silently
skipped by a deterministically-false expression.

### Acceptance Criteria

#### Happy Path
- Given a project config with `steps.build_review.when: "complexity_tier == 'S'"`, when the config is validated, then validation fails with an error naming the step, the `when` key, and its `gating` enforcement level
- Given a project config with `steps.rebase.when: "false_expr"`, when the config is validated, then validation fails with an error naming the step, the `when` key, and its `structural` enforcement level

#### Negative Paths
- Given a project config with `steps.build_review.when` set to an expression that would evaluate true at runtime, when the config is validated, then validation still fails — rejection depends only on the step's enforcement level, never on expression evaluation

### Done When
- [ ] `validate` in `src/conductor/src/engine/config.ts` returns an error for `when:` on any structural step and on any gating step whose definition lacks `configDisableAllowed: true`, using the same step-definition predicate as the existing `disable:` check
- [ ] A unit test asserting the rejection for a gating step (`build_review`) and a structural step (`rebase`) fails against pre-change code and passes after

## Story 2: Legitimately conditional steps keep working when: behavior

As an operator, I want `when:` to keep working on every step `disable:` could also disable,
so that existing conditional configurations do not break.

### Acceptance Criteria

#### Happy Path
- Given a project config with `steps.manual_test.when: "<expr>"` (gating, `configDisableAllowed: true`), when the config is validated, then validation succeeds
- Given a project config with `steps.explore.when: "<expr>"` (advisory), when the config is validated, then validation succeeds
- Given a custom step declared with `enforcement: advisory` and a `when:` expression, when the config is validated, then validation succeeds

#### Negative Paths
- Given a custom step declared with `enforcement: gating` (no `configDisableAllowed` opt-in exists for custom steps) and a `when:` expression, when the config is validated, then validation fails with the same error shape as Story 1

### Done When
- [ ] Unit tests covering `manual_test`, `prd_audit`, an advisory built-in, and an advisory custom step with `when:` all pass config validation unchanged
- [ ] A unit test asserting rejection of `when:` on a gating custom step fails against pre-change code and passes after

## Story 3: A when: skip is visible in the run log

As an operator, I want every `when:`-driven skip rendered in the conductor log, so that a
conditionally skipped step is observable instead of silent.

### Acceptance Criteria

#### Happy Path
- Given a step permitted to carry `when:` whose expression evaluates false, when the conductor evaluates it, then a `when_skip` event is rendered to the log naming the step and the expression, and the step is recorded skipped as today

#### Negative Paths
- Given a step whose `when:` expression evaluates true, when the conductor evaluates it, then no `when_skip` event is emitted and the step runs normally

### Done When
- [ ] `when_skip` in `src/conductor/src/engine/event-sinks.ts` carries `render: true` and keeps `persist: true`
- [ ] A test asserting the rendered sink policy for `when_skip` fails against pre-change code and passes after

## Story 4: disable: enforcement extends to custom steps

As an operator, I want `disable: true` on a custom gating or structural step rejected at
config load, so that custom steps carry the same skip authority rules as built-ins.

### Acceptance Criteria

#### Happy Path
- Given a custom step declared with `enforcement: gating` and `disable: true`, when the config is validated, then validation fails with the same `Cannot disable` error shape used for built-ins
- Given a custom step declared with `enforcement: structural` and `disable: true`, when the config is validated, then validation fails naming the step and its enforcement level

#### Negative Paths
- Given a custom step declared with `enforcement: advisory` (or no enforcement, which defaults to advisory) and `disable: true`, when the config is validated, then validation succeeds and the step is skipped at runtime as today

### Done When
- [ ] Config validation applies the enforcement predicate to `disable:` on custom steps (no `configDisableAllowed` opt-in exists for custom steps, so gating and structural custom steps can never be disabled)
- [ ] Unit tests asserting rejection for gating and structural custom steps fail against pre-change code and pass after; the advisory custom-step test passes unchanged
