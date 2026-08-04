**Status:** Accepted

# Stories: Implementation-only remediation routing

## Story S1: Return conforming implementation drift to BUILD

As a daemon operator, I want remediation to classify findings by the authority needed to resolve them so that implementation-only cleanup continues autonomously.

### Acceptance Criteria

#### Happy Path

- Given an as-built finding says the approved ADR remains applicable and the implementation, tests, or documentation need concrete cleanup, when remediation classifies the finding, then it emits `build` with non-empty file-scoped tasks.
- Given the issue #1250 report where ADR conformance is substantive and five concrete cleanup tasks require no new decision, when the resulting remediation plan is routed in daemon mode, then BUILD is selected and the operator-only DECIDE guard is not invoked.

#### Negative Paths

- Given the finding originated from an as-built architecture review, when its evidence nevertheless says approved architecture remains authoritative, then origin alone does not select `architecture_review`.
- Given implementation-only drift has no concrete file-scoped task evidence, when remediation cannot establish a safe BUILD action, then it does not invent tasks or silently claim autonomous remediation is possible.

### Done When

- [ ] A regression fixture representing #1250 produces `build`, `category: null`, and at least one pending remediation task.
- [ ] Daemon routing for that fixture returns to BUILD without a DECIDE-rewind halt.

## Story S2: Preserve human gates for genuine decisions

As a daemon operator, I want genuine architectural and product decisions to remain operator-gated so that autonomous remediation never rewrites protected DECIDE artifacts.

### Acceptance Criteria

#### Happy Path

- Given resolving a finding requires changing or clarifying approved architecture, when remediation classifies it, then it selects the existing architecture decision route rather than BUILD.
- Given functionality exceeds the approved plan but remains within established product and architecture scope, when remediation classifies it, then it identifies plan-scope amendment rather than claiming the approved architecture needs review.

#### Negative Paths

- Given a finding requires an unresolved architecture trade-off, when concrete implementation tasks could describe only one possible choice, then remediation does not use those tasks to bypass the human architecture decision.
- Given a genuine DECIDE disposition reaches daemon routing, when the engine evaluates its configured phase, then it still halts before authoring or reopening DECIDE artifacts autonomously.

### Done When

- [ ] Negative-path fixtures distinguish conforming implementation drift from architecture change or clarification.
- [ ] Existing daemon tests prove DECIDE targets still halt and BUILD targets still route.
- [ ] Plan omissions are reported as requiring plan-scope amendment, not architecture review.

## Story S3: Keep disposition and rationale semantically consistent

As an operator diagnosing remediation, I want the disposition and rationale to describe the same required authority so that contradictory artifacts do not send me to the wrong recovery step.

### Acceptance Criteria

#### Happy Path

- Given remediation selects `architecture_review`, when the operator reads its rationale, then the rationale identifies the approved architecture that must change or be clarified.
- Given remediation selects `build`, when the operator reads its rationale and tasks, then they identify concrete implementation, test, or documentation work that preserves approved architecture.

#### Negative Paths

- Given a proposed `architecture_review` disposition whose rationale says no architecture or product decision is required, when the remediation contract is evaluated, then the output is rejected by the judgment rubric and must be reclassified before routing.
- Given a proposed `build` disposition whose rationale identifies unresolved architectural ambiguity, when the remediation contract is evaluated, then the output is rejected rather than routed autonomously.

### Done When

- [ ] The remediation skill and planner-agent contracts state the same closed positive and negative rules.
- [ ] Contract tests fail on both contradiction directions and pass on consistent BUILD and architecture-decision examples.

## Verify-Claims Ledger

### Claims

- [verified] The existing remediation output supports `build`, `acceptance_specs`, `architecture_review`, `plan`, and `halt` without a separate authority field.
- [verified] The engine independently blocks daemon routing to configured DECIDE steps.

### Assumptions

- [load-bearing, approved by operator 2026-08-02] The existing schema remains intact and semantic consistency is enforced through a closed judgment rubric plus regression examples.
- [load-bearing, approved by operator 2026-08-02] A genuine need to change or clarify approved architecture remains operator-gated.

Verdict: CLEAR
