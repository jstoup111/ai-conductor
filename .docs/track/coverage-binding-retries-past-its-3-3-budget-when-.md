# Track: coverage_binding retries past its 3/3 budget when the judge returns no output

Track: technical

Scope boundary: route a **terminal** step refusal through the existing `classifyRetryDecision`
seam at the step-runner failure branch, before the retry budget is consulted. A new signal
`terminal-refusal` is keyed on the existing `StepRunResult.refusal.kind`; `needs-human` and
`validation-verdict` route (halt now), `seal` reruns (retryable by design,
`adr-2026-08-24` D4). The refusal-carrying result also gains a non-empty `output` so retry and
halt telemetry name the refusal instead of "produced no output". The new signal is NOT gated on
`this.daemon` — the same waste occurs in interactive `conduct` runs.

Excluded by operator decision:
- Extending the `unretryableInputs` facet or widening the `isVerdictStep` allowlist. That the
  allowlist under-implements `adr-2026-08-19` D2/D6 is a real, separate defect; it is filed on its
  own rather than carried by a critical bug fix.
- The `seal` refusal's deliberate retryability (`adr-2026-08-24` D4; `conductor.ts:8846` writes its
  HALT only at `attempt >= 2`).
- The outer-lap attempt-id reset described in issue #2371. Unreproduced: the provider attempt
  counter increments per **claim**, not per retry.
- The coverage-binding judge prompt and provider behavior. Contradicted by observed codex verdicts.
- The `coverage_binding.judge.enabled` default re-flip (`adr-2026-08-31` D7), filed separately.

Engine control-flow fix with no user-facing capability: acceptance criteria belong in stories,
so no PRD is authored.
