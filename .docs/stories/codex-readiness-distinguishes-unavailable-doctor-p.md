**Status:** Accepted

# Stories: Codex Readiness Probe Failure Separation (#1039)

**Source:** Approved #1039 PRD amendment FR-1 through FR-15

## Traceability

| Requirements | Story |
|---|---|
| FR-1 through FR-5 | Story 1: Distinguish probe failure from credential verdicts |
| FR-6 and FR-7 | Story 2: Retain useful diagnostics without retaining secrets |
| FR-8 through FR-11 | Story 3: Bound recovery when its readiness probe fails |
| FR-12 | Story 4: Control the readiness timeout |
| FR-13 through FR-15 | Story 5: Preserve readiness behavior across every dispatch and event consumer |

## Story 1: Distinguish probe failure from credential verdicts

**Requirement:** FR-1, FR-2, FR-3, FR-4, FR-5

As a harness operator, I want readiness to distinguish an unavailable doctor answer from an affirmative credential verdict so valid Codex work is not blocked by diagnostic failure.

### Acceptance Criteria

#### Happy Path

- **AC-1.1:** Given supported doctor evidence that the selected credential source is ready, when readiness is evaluated, then the result is `ready` and the Codex invocation proceeds.
- **AC-1.2:** Given doctor execution failure, timeout, invalid JSON, unsupported schema, unrecognized envelope, conflicting selected-source evidence, or ambiguous credential evidence, when readiness is evaluated, then the result is `probe-failed` with exactly one closed failure kind and the Codex invocation proceeds.
- **AC-1.3:** Given supported doctor evidence that the selected source is missing or unusable, when readiness is evaluated, then the result remains an affirmative non-ready credential verdict and substantive model work does not begin.

#### Negative Paths

- **AC-1.1N:** Given a supported ready credential subcheck alongside degraded unrelated doctor health, when readiness is evaluated, then unrelated health does not change the credential result to `probe-failed` or block dispatch.
- **AC-1.2N:** Given a `probe-failed` result, when the invocation caller handles it, then it does not set `authFailure`, enter authentication parking, advance provider/model fallback, or consume retry/escalation budget.
- **AC-1.3N:** Given explicit missing or rejected credential evidence, when the caller handles it, then it cannot be relabeled as a degraded probe or permitted to start substantive model work.

### Done When

- [ ] Every doctor execution and parser failure class produces an explicit `probe-failed` result distinct from `missing` and `unusable`.
- [ ] Ordinary unattended Codex dispatch demonstrably starts after `probe-failed` and remains blocked after affirmative credential failure.
- [ ] Readiness handling is exhaustive so an unknown state cannot silently default to authorization or credential failure.

## Story 2: Retain useful diagnostics without retaining secrets

**Requirement:** FR-6, FR-7

As a harness operator diagnosing a failure, I want durable structured probe evidence so I can identify execution, timeout, and parsing/schema failures without rerunning the incident or exposing credentials.

### Acceptance Criteria

#### Happy Path

- **AC-2.1:** Given a doctor subprocess execution error or timeout during daemon work, when the degraded diagnostic is persisted, then it identifies the closed failure kind and available allowlisted process facts, including the configured timeout for a timeout.
- **AC-2.2:** Given invalid or structurally unsupported doctor output, when the degraded diagnostic is persisted, then it identifies the closed parser-rejection reason and safe envelope-shape facts that were available.
- **AC-2.3:** Given a normal non-daemon caller without a persisted diagnostic sink, when probe failure occurs, then the typed readiness result still retains the closed failure kind without requiring durable logging infrastructure.

#### Negative Paths

- **AC-2.1N:** Given stdout, stderr, an exception message, path, or environment content containing a credential fragment, when an execution/timeout diagnostic is produced, then no raw text, credential value or fragment, credential path, arbitrary message, or hash appears in the result, feature log, event, or HALT.
- **AC-2.2N:** Given valid JSON containing unknown fields or sensitive summaries, when shape metadata is retained, then only explicitly allowlisted primitive fields and byte counts appear; raw payloads and summaries are absent.
- **AC-2.3N:** Given no diagnostic sink, when dispatch continues, then the absence of persistence does not turn probe failure into an auth failure or crash the invocation path.

### Done When

- [ ] Daemon diagnostics alone distinguish exec error, timeout, invalid JSON, unsupported schema, and unrecognized/ambiguous envelope outcomes.
- [ ] Adversarial fixtures prove secret-bearing raw output and arbitrary exception content never cross provider, log, event, or HALT boundaries.
- [ ] Structured metadata is closed and bounded rather than a free-form message or payload field.

## Story 3: Bound recovery when its readiness probe fails

**Requirement:** FR-8, FR-9, FR-10, FR-11

As a daemon operator, I want an inconclusive recovery probe to authorize one real Codex trial so recovery can be settled by actual execution without creating another hour-long false credential park or an unbounded loop.

### Acceptance Criteria

#### Happy Path

- **AC-3.1:** Given authentication recovery is active and a recovery probe returns `ready`, when the coordinator handles it, then the failed dispatch resumes under the existing recovery contract.
- **AC-3.2:** Given authentication recovery is active and the recovery probe returns `probe-failed`, when the coordinator handles it, then it records the structured degradation and authorizes exactly one real invocation trial for that recovery episode.
- **AC-3.3:** Given the authorized trial succeeds or produces a non-authentication failure, when its result is handled, then ordinary success or failure handling resumes without another auth park.

#### Negative Paths

- **AC-3.1N:** Given recovery probes continue to affirm `missing` or `unusable`, when the park deadline is reached, then the existing credential-specific timeout behavior remains in force and no trial is authorized from conclusive non-ready evidence.
- **AC-3.2N:** Given the one authorized trial affirmatively reports authentication failure, when its result is handled, then the episode ends with a probe-specific diagnostic naming the inconclusive probe and failed trial; it does not enter another probe-bypass cycle.
- **AC-3.3N:** Given serial, concurrent-group, or auxiliary-verifier recovery, when a probe fails, then each call shape enforces the same one-trial maximum and preserves completed sibling work, retry budget, escalation state, and provider/source selection.

### Done When

- [ ] The recovery result contract has explicit `recovered`, `trial-required`, and `halt` dispositions.
- [ ] Deterministic coverage proves one and only one trial can occur per recovery episode in serial, grouped, and auxiliary paths.
- [ ] A failed trial yields a probe-specific terminal reason before the auth-park deadline and cannot recurse.

## Story 4: Control the readiness timeout

**Requirement:** FR-12

As a harness operator, I want the Codex readiness timeout to be validated per-project behavior so slow environments do not silently inherit an unreviewable fixed value.

### Acceptance Criteria

#### Happy Path

- **AC-4.1:** Given `codex_doctor_timeout_seconds` is omitted, when configuration is resolved, then the Codex doctor runner receives the documented default of 10 seconds.
- **AC-4.2:** Given a finite positive `codex_doctor_timeout_seconds`, when the next readiness check runs, then it uses that exact number of seconds while other timeout behavior remains unchanged.

#### Negative Paths

- **AC-4.1N:** Given zero, a negative number, a non-number, `NaN`, or infinity, when configuration is validated, then loading fails with a key-specific validation error and does not silently use 10 seconds.
- **AC-4.2N:** Given a valid custom timeout, when another provider or timeout-bearing operation runs, then the value changes only the Codex readiness check and does not alter invocation, auth-park, heartbeat, or other provider timeouts.

### Done When

- [ ] Default and custom values are observed at the real readiness-check boundary, not only accepted by configuration validation.
- [ ] Every invalid-value class fails closed with a diagnostic naming `codex_doctor_timeout_seconds`.

## Story 5: Preserve readiness behavior across every dispatch and event consumer

**Requirement:** FR-13, FR-14, FR-15

As a harness maintainer, I want every readiness and recovery consumer to handle probe failure consistently so one auxiliary or grouped path cannot retain the old false-auth behavior.

### Acceptance Criteria

#### Happy Path

- **AC-5.1:** Given initial, unattended interactive-streaming, model-ladder, serial, grouped, resumed-equivalent, or auxiliary Codex execution, when its doctor probe fails, then the same non-blocking degraded-dispatch rule applies at the shared provider boundary.
- **AC-5.2:** Given a recovery probe failure, when progress is emitted, persisted, and rendered, then the event retains provider, selected source, probe-failure degradation/kind, elapsed time, and next disposition using closed fields.
- **AC-5.3:** Given actual invocation authentication failure after a degraded preflight, when result adapters propagate it, then auth-failure recovery keeps precedence and the selected provider/source context remains intact.

#### Negative Paths

- **AC-5.1N:** Given any adapter converts provider results into step, group, verdict, or auxiliary outcomes, when it receives `probe-failed`, then it cannot drop the distinction, synthesize `authFailure`, or bypass the real invocation.
- **AC-5.2N:** Given exhaustive event consumers and audit-completeness fixtures, when probe-failure progress is added, then no consumer silently ignores the widened variant or widens unrelated audit persistence semantics.
- **AC-5.3N:** Given a degraded probe followed by provider-unavailable, rate-limit, permission, model-unavailable, session, or ordinary failure from the real invocation, when classification runs, then that actual failure retains its existing precedence and is not overwritten by readiness degradation.

### Done When

- [ ] A propagation matrix covers provider, runtime, serial, group, auxiliary, event persistence, renderer, and terminal/HALT consumers.
- [ ] Existing non-auth recovery and provider/model selection suites remain unchanged in outcome.
- [ ] Aggregate verification passes with third-party boundaries faked; no default test invokes the real Codex CLI or service.

## Verify-Claims Verdict

**CLEAR:** Every behavior above is derived from the operator-approved PRD amendment and matching ADR. Every FR is covered, and no unconfirmed load-bearing assumption is encoded in these stories.
