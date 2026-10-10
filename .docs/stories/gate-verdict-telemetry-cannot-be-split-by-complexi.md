**Status:** Accepted

# Stories: Gate verdict telemetry split by complexity tier

Source: jstoup111/ai-conductor#2790. Track: technical (no PRD). Tier: S. Governing decision:
adr-014-otel-observability-exporter D14, as amended by #2790 (D11 and D14 additive-field precedent).

Gate pass and rejection counts are exported as `conductor.gate.verdicts` (pass/fail per gating step)
and `conductor.gate.kickbacks` (a gate sending work back, keyed `from`/`to`). Neither can be split by
the feature's complexity tier today. These stories carry the run's tier on the two gate events and
export it as a label. They leave every tier-agnostic total unchanged, and they lock the existing
guarantee that an infrastructure failure is never counted as a gate rejection.

## Story 1: Gate verdicts and gate-originated kickbacks carry the run's tier

**Requirement:** #2790 desired outcomes 1 and 3

As a telemetry consumer, I want each gate verdict and each gate kickback on the event spine to state
the run's complexity tier so that gate outcomes can be grouped by S/M/L without joining other events.

### Acceptance Criteria

#### Happy Path
- Given a run whose state holds `complexity_tier: 'M'`, when a gating step completes and the conductor records its objective verdict on the post-dispatch tail, then the emitted `gate_verdict` carries `tier: 'M'` alongside its existing `step`, `satisfied`, and `reason`
- Given a run whose state holds `complexity_tier: 'S'`, when a gate kicks work back to `build` (for example `prd_audit` → `build`), then the emitted `kickback` carries `tier: 'S'` alongside its existing `from`, `to`, and `count`

#### Negative Paths
- Given a run whose state has no `complexity_tier`, when a gate verdict is recorded or a gate kicks work back, then neither the `gate_verdict` nor the `kickback` carries a `tier` key — not `L`, not `M`, not an empty string
- Given a run whose state holds `complexity_tier: 'M'`, when a rebase invalidates a gate and a `kickback` with `from: 'rebase'` is emitted, then that `kickback` carries no `tier` key
- Given a `gate_verdict` or `kickback` that already carries a `tier`, when the conductor emits it, then the event keeps that `tier` value and is not overwritten by the run's tier

### Done When
- [ ] `gate_verdict` and `kickback` in the `ConductorEvent` union declare an optional `tier` field typed `ComplexityTier`
- [ ] Conductor tests assert `tier: 'M'` on a post-dispatch-tail `gate_verdict` in a run seeded `M` and `tier: 'S'` on a gate-originated `kickback` in a run seeded `S`
- [ ] A conductor test with no `complexity_tier` asserts key absence on both events, and a `from: 'rebase'` kickback asserts key absence in a tiered run

## Story 2: Gate counters export the tier label without changing tier-agnostic totals

**Requirement:** #2790 desired outcomes 1 and 3

As an operator deciding whether a gate is worth running at a given tier, I want
`conductor.gate.verdicts` and `conductor.gate.kickbacks` to carry the tier label so that per-tier pass
and reject counts come straight from exported telemetry, while my existing tier-agnostic queries keep
their totals.

### Acceptance Criteria

#### Happy Path
- Given a `gate_verdict` for `build_review` with `satisfied: true` and `tier: 'S'`, when the metrics listener projects it, then `conductor.gate.verdicts` records one point with attributes `step="build_review"`, `outcome="pass"`, and `tier="S"` plus the existing identity attributes
- Given a `kickback` from `test_suite` to `build` with `tier: 'M'`, when the metrics listener projects it, then `conductor.gate.kickbacks` records one point with attributes `from="test_suite"`, `to="build"`, and `tier="M"`
- Given a conductor run whose state holds `complexity_tier: 'M'` with the metrics listener subscribed to the conductor's event emitter, when the run records a gate verdict and a gate kicks work back, then the exported `conductor.gate.verdicts` and `conductor.gate.kickbacks` points both carry `tier="M"`

#### Negative Paths
- Given a `gate_verdict` or `kickback` with no `tier` key, when the metrics listener projects it, then the recorded point carries no `tier` attribute and keeps exactly the attributes it carried before this change
- Given three `gate_verdict` events for the same step and outcome carrying `tier: 'S'`, `tier: 'M'`, and no tier, when the exported points for that step and outcome are summed across `tier`, then the sum is 3, which equals the count recorded for the same three events without the label

### Done When
- [ ] `MetricsRecorder.onGateVerdict` and `MetricsRecorder.onKickback` accept an optional tier and add the `tier` attribute only when it is defined
- [ ] The `gate_verdict` and `kickback` handlers in `MetricsListener.METRICS_HANDLERS` pass the event's `tier` through
- [ ] A production-order test drives a real conductor run with `complexity_tier: 'M'` into an in-memory metric exporter and observes `tier="M"` on both gate counters

## Story 3: Infrastructure failures never count as gate rejections

**Requirement:** #2790 desired outcome 2

As an operator reading gate rejection rates, I want a failure caused by infrastructure to stay out of
the gate counters so that every counted gate fail or gate kickback is a substantive rejection of the
work.

### Acceptance Criteria

#### Happy Path
- Given a `build_review` dispatch whose grader cannot be dispatched (the step runner returns no result and flags a grader-dispatch failure) on every attempt, when the conductor exhausts its retries, then the run emits `step_retry` and `step_failed` for `build_review` and emits no `gate_verdict` for `build_review` with `satisfied: false` and no `kickback` from `build_review`
- Given a settled `build_review` lap whose only non-pass result is an uncovered rubric infrastructure failure, when the conductor routes it through the mechanical-fault lane, then the kickback ledger's `mechanicalFaults` for `build_review` increments and no `gate_verdict` for `build_review` with `satisfied: false` and no `kickback` from `build_review` is emitted

#### Negative Paths
- Given a `test_suite` run whose full-suite verification fails for an infrastructure reason (any reason other than `nonzero_exit`) within its infrastructure-retry allowance, when the conductor retries it, then it emits a `step_retry` for `test_suite` and emits no `kickback` from `test_suite` and no `gate_verdict` for `test_suite` with `satisfied: false`

### Done When
- [ ] The existing grader-dispatch-failure conductor test additionally asserts zero `gate_verdict{step: 'build_review', satisfied: false}` and zero `kickback{from: 'build_review'}` events
- [ ] The existing uncovered-infrastructure mechanical-lane adjudication test additionally asserts zero unsatisfied `build_review` `gate_verdict` events alongside its existing empty-kickback assertion
- [ ] A test-suite infrastructure-retry test asserts a `step_retry` for `test_suite` and zero `kickback{from: 'test_suite'}` and zero unsatisfied `test_suite` `gate_verdict` events
