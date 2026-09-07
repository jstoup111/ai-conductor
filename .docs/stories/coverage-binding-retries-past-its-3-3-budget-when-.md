**Status:** Accepted

# A terminal step refusal routes instead of spending the retry budget (#2371)

Track: technical (no PRD — acceptance criteria live here)
Tier: S

## Context

`coverage_binding`'s `does-not-assert` verdict returns a typed refusal
(`src/conductor/src/engine/step-runners.ts:2566`):

```ts
return { success: false, refusal: { kind: 'needs-human', reason: `coverage_binding refused: …` } };
```

That result carries **no `output`**. The conductor's step-runner failure branch synthesizes a
reason whenever `result.output` is blank (`conductor.ts:9490`), so every lap renders as
`Step 'coverage_binding' produced no output — the step runner exited without a result (the
grader/subprocess likely failed to start or died before writing a verdict)`. The refusal itself is
only honored at `conductor.ts:10557`, which sits **after** `while (attempt < stepMaxRetries)`
(`conductor.ts:8688`). A judgement that has already concluded a human is required therefore spends
the whole retry budget before halting, and every wasted lap reports a dead subprocess.

Observed 2026-09-06 ~21:02-21:04Z on features `clamp-resume-entry-to-a-runnable-step-and-halt-whe`
and `handle-runtime-values-a…` after `coverage_binding.judge.enabled` defaulted true (#2116); the
default was reverted in #2370.

**What the evidence does not support.** Issue #2371 also diagnosed a codex judge returning no
output. `.worktrees/handle-runtime-values-as-literal-data-across-inter/.pipeline/events.jsonl` at
2026-09-06T21:04Z records codex/`gpt-5.6-terra` returning three parseable payloads
(`coverage_binding_judged verdict:"asserts"` ×3) at attempt ids `…:coverage_binding:1`, `:2`, `:3`.
The provider attempt counter increments per **claim**, not per retry, so the reported "attempt 9"
is three claims across three laps — not nine failed judge calls. The judge and the outer-lap
attempt-id reset are out of scope; see `.docs/track/`.

**What changes, precisely.** `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` D2
already places `classifyRetryDecision` at this exact branch, before the budget is consulted, with
`retry_routing.enabled` as its kill switch (D4) and the `retry_decision` event as its telemetry
(D5, which names the `signal` vocabulary as the extension point). This work adds one signal,
`terminal-refusal`, keyed on the existing `StepRunResult.refusal.kind` — a result kind, never
reason text, per `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1. It edits no
existing signal, no existing facet, and not the `isVerdictStep` allowlist. The refusal result also
begins carrying its reason as `output`.

**What deliberately does not change.** A `seal` refusal stays retryable.
`adr-2026-08-24-refused-step-status` D4 names "the seal retries-exhausted path" as a deliberate
stamp site, and `conductor.ts:8846` writes its HALT only at `attempt >= 2`. Routing `seal` would
silently retire that behavior.

**Reachable kinds at this seam.** `StepRunResult.refusal.kind` is populated by exactly two
producers today: `step-runners.ts:2566` (`needs-human`) and `conductor.ts:8846` (`seal`).
`validation-verdict` is stamped only by `recordGroupRefusal` (`conductor.ts:2189`) and never
travels on a `StepRunResult`, so it is specified at the classifier for exhaustiveness but is not
reachable end-to-end through this branch.

---

## Story 1 — A terminal refusal routes on its first attempt instead of consuming the retry budget

**Requirement:** #2371 defect 1 (retry budget is not bounding)

As the conductor's step retry loop, when a step returns a `needs-human` refusal, I want the
decision routed through the existing retry classifier before the budget is consulted, so a
judgement that has already concluded a human is required halts immediately instead of re-running
two more laps that cannot change it.

### Acceptance Criteria

#### Happy Path
- Given `retry_routing.enabled` is true and a step's runner returns `{ success: false, refusal: { kind: 'needs-human', reason } }` on attempt 1, when the step-runner failure branch runs, then `classifyRetryDecision` returns `{ decision: 'route', signal: 'terminal-refusal' }` and the retry loop exits without a second dispatch.
- Given the same conditions, when the loop exits, then a `retry_decision` event is emitted carrying `step`, `attempt: 1`, `decision: 'route'` and `signal: 'terminal-refusal'`, so the spine records why the budget was not spent.
- Given the same conditions, when the loop exits, then the pre-existing refusal halt at `conductor.ts:10557` still owns the outcome: the HALT marker carries the refusal's own `reason` verbatim with class `needs-human`, and the step is stamped `refused` (not `failed`) per `adr-2026-08-24` D1.
- Given the run is interactive rather than daemon-dispatched (`this.daemon` is false), when a `needs-human` refusal is returned, then it routes identically — the new signal is not gated on daemon mode.
- Given a `coverage_binding` step whose judge returns `does-not-assert` for at least one claim, when the step runs under a default configuration, then exactly one `coverage_binding` step dispatch occurs for that lap and no `step_retry` event is emitted for it.

#### Negative Paths
- Given a step's runner returns `{ success: false, output: 'provider exited 1' }` with **no** `refusal` field, when the step-runner failure branch runs, then no `terminal-refusal` route is taken and the step retries under its ordinary budget, so genuine work failures keep their retries.
- Given a step's runner returns `{ success: true }`, when the step completes, then `classifyRetryDecision` is not consulted for `terminal-refusal` and no `retry_decision` event carrying that signal is emitted.
- Given a `needs-human` refusal on a step configured `max_retries: 1`, when the branch runs, then the outcome is identical to the multi-retry case — one dispatch, a routed decision, and the refusal halt — so the fix does not depend on a budget greater than one.

### Done When
- [ ] A unit test asserts `classifyRetryDecision({ …, terminalRefusal: 'needs-human' })` returns `{ decision: 'route', signal: 'terminal-refusal' }`.
- [ ] A unit test asserts `classifyRetryDecision` with no refusal input returns a non-`terminal-refusal` decision for the same inputs.
- [ ] A conductor test drives a stub runner returning a `needs-human` refusal and asserts the runner is invoked exactly **once** despite `max_retries: 3`.
- [ ] The same test asserts the emitted event stream contains a `retry_decision` with `signal: 'terminal-refusal'` and contains **no** `step_retry` for that step.
- [ ] A conductor test asserts the resulting HALT marker text equals the refusal's `reason` and its class is `needs-human`.
- [ ] A conductor test asserts `conduct-state.json` records the step as `refused`, and that a `step_refused` event with `kind: 'needs-human'` is emitted.
- [ ] A conductor test with `daemon: false` asserts the same single-dispatch routing behavior.

---

## Story 2 — A `seal` refusal keeps its retries

**Requirement:** `adr-2026-08-24-refused-step-status` D4 (regression guard)

As the protected-artifact seal, when I refuse a dispatch, I want my existing retry behavior
preserved, so the deliberate "retries-exhausted" seal path and its `attempt >= 2` HALT escalation
are not silently retired by a change aimed at a different refusal kind.

### Acceptance Criteria

#### Happy Path
- Given `retry_routing.enabled` is true and the protected-artifact seal produces `{ success: false, output: dispatchIssue, refusal: { kind: 'seal', reason: dispatchIssue } }` on attempt 1, when the step-runner failure branch runs, then `classifyRetryDecision` returns a `rerun` decision and the step retries under its ordinary budget.
- Given a `seal` refusal that persists, when attempt 2 is reached, then the pre-existing `attempt >= 2` escalation still writes the HALT marker with the protected-artifact halt class, unchanged.
- Given a `seal` refusal that clears before the budget is exhausted, when the next attempt succeeds, then the step completes normally and no refusal halt is written.

#### Negative Paths
- Given a `seal` refusal on every attempt, when the budget is exhausted, then the terminal outcome is the pre-existing protected-artifact halt — never a `needs-human` halt and never a `terminal-refusal`-signalled `retry_decision`.

### Done When
- [ ] A unit test asserts `classifyRetryDecision({ …, terminalRefusal: 'seal' })` does **not** return `signal: 'terminal-refusal'`.
- [ ] A conductor test drives a persistent `seal` refusal with `max_retries: 3` and asserts the runner is invoked **three** times.
- [ ] The same test asserts the resulting HALT carries the protected-artifact halt class, not `needs-human`.
- [ ] A conductor test asserts a `seal` refusal that clears on attempt 2 completes the step `done` with no HALT marker written.

---

## Story 3 — A refusal reports its own reason, never "produced no output"

**Requirement:** #2371 defect 2 as re-diagnosed (the "no output" text was the refusal, not a dead judge)

As an operator reading `.daemon/daemon.log`, when a step refuses, I want the recorded reason to be
the refusal's own text, so I am not told a subprocess died when a judge returned a verdict — the
misreading that produced this issue's original diagnosis.

### Acceptance Criteria

#### Happy Path
- Given `coverage_binding` refuses with `does-not-assert`, when the result is constructed, then it carries a non-empty `output` equal to its refusal `reason`, so `runnerOutput` at `conductor.ts:9490` is defined and the synthesized "produced no output" text is never reached for a refusal.
- Given any refusal-carrying result reaches the step-runner failure branch, when `lastError` is assigned, then it holds the refusal reason text and contains neither `produced no output` nor `the grader/subprocess likely failed to start`.
- Given `retry_routing.enabled` is false and a `needs-human` refusal therefore retries, when each `step_retry` event is emitted, then its `reason` carries the refusal text rather than the no-output diagnostic.

#### Negative Paths
- Given a non-refusal step result whose `output` is genuinely absent or whitespace-only, when the branch runs, then the existing `produced no output` diagnostic is still synthesized verbatim, so #814's masking fix is preserved.
- Given a `coverage_binding` result carrying a `CoverageBindingPayloadError` infrastructure failure, when `lastError` is assigned, then it still renders `coverage-binding judge infrastructure failure: <reason>`, so the typed payload diagnostic is not displaced by the refusal text.

### Done When
- [ ] A unit test asserts `runCoverageBinding`'s `does-not-assert` result has a non-empty `output` string equal to its `refusal.reason`.
- [ ] A conductor test asserts that for a refusal-carrying result, the recorded `lastError` matches the refusal reason and does **not** match `/produced no output/`.
- [ ] A conductor test asserts a result with `output: '   '` and no `refusal` still produces a `lastError` matching `/produced no output/`.
- [ ] A conductor test asserts a `CoverageBindingPayloadError` result still produces a `lastError` matching `/coverage-binding judge infrastructure failure/`.

---

## Story 4 — The existing kill switch reverts the new routing exactly

**Requirement:** `adr-2026-08-19` D4 (no new config key; the kill switch is an exact revert)

As an operator, when I set `retry_routing.enabled: false`, I want the new terminal-refusal routing
bypassed along with the classifier's other signals, so one existing switch restores the previous
behavior without a code change or a release.

### Acceptance Criteria

#### Happy Path
- Given `retry_routing.enabled: false` and a step returning a `needs-human` refusal, when the branch runs, then the classifier is not consulted for the new signal and the step retries under its ordinary budget, matching pre-change behavior.
- Given `retry_routing` is absent from the config entirely, when the branch runs, then the new routing is active, because `RETRY_ROUTING_DEFAULTS.enabled` is `true` (`config.ts:2132`).
- Given `retry_routing.enabled: false`, when the retry budget is exhausted on a `needs-human` refusal, then the terminal outcome is still the refusal halt at `conductor.ts:10557` with the refusal's reason and class — only the timing changes, never the verdict.

#### Negative Paths
- Given `retry_routing.enabled: false`, when a `needs-human` refusal retries, then no `retry_decision` event carrying `signal: 'terminal-refusal'` is emitted for any attempt.

### Done When
- [ ] A conductor test with `retry_routing: { enabled: false }` drives a persistent `needs-human` refusal with `max_retries: 3` and asserts the runner is invoked **three** times.
- [ ] The same test asserts the terminal HALT still carries the refusal reason with class `needs-human`.
- [ ] The same test asserts no emitted `retry_decision` event carries `signal: 'terminal-refusal'`.
- [ ] A conductor test with `retry_routing` omitted asserts the single-dispatch routing behavior of Story 1.
