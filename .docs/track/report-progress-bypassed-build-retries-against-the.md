# Track: Report progress-bypassed build retries against their own allowance

Track: technical

Scope boundary: Small fix for #1513, approved by the operator on 2026-09-06 (delegated). Correct the retry event the build step emits when an attempt is refunded for making forward progress, so the fixed-retry counter it carries stays within its own stated maximum, and add the progress allowance the retry actually consumed as separate optional fields that the daemon log line, both terminal renderers, and the OpenTelemetry retry span report. Ordinary fixed retries, every non-build step, the retry budgets themselves, the progress-attempt ceiling policy, and the halt/park classification of an exhausted budget are all outside this slice. Control flow is already correct and is not touched.

This is an internal telemetry and operator-reporting correction; acceptance criteria live in technical stories rather than a PRD.

The operator approved carrying the progress allowance as two additive optional fields on the existing retry event over overloading the existing attempt/maxAttempts pair, on 2026-09-06 (delegated). Overloading would leave a single pair meaning two different budgets depending on a flag, which is the ambiguity the defect already demonstrates; separate fields let a consumer that knows nothing about progress bypass keep reading the fixed pair correctly.

Scope check: A — consumer-facing (no repo-only signal fires; this is engine retry reporting that any repository running the harness sees in its terminal renderers, and it depends on no self-host, daemon-only, release-gate, or `.docs/` convention); B — n/a (no new skill); C — provider-agnostic (no provider, model, or CLI surface is referenced). No catalog registration is required, and no behavioral rule file changes.

Event spine: Channel? no — nothing new observes, polls, or writes a sidecar. Concern: occurrence, already carried by the existing `step_retry` member of the `ConductorEvent` union. Verdict: extend the union with additive optional fields on that existing variant, which every current consumer reads by name and tolerates when absent. Exception: none needed.

Verified foundation: the build step's completion-miss retry decision emits `step_retry` with `attempt + 1` and `stepMaxRetries` and only afterwards decrements `attempt` when the progress bypass fired, so the emitted pair describes a fixed slot the refunded attempt never consumes. The progress bypass is governed by a separate counter checked against `build_progress_halt.attempt_ceiling`, whose value is currently read inside a nested block and never reaches the emit. `format-retry-line.ts` already exists as the shared retry-line formatting module and is imported by the daemon CLI renderer and both terminal renderers, so a single counter helper reaches all three call sites. The OpenTelemetry span manager copies `attempt` and `maxAttempts` straight onto the retry span event.
