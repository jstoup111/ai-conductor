# Complexity: Daemon rate-limit episode coordinator

Tier: L

## Signals
- **State machine:** a new "rate-limit episode" lifecycle (idle → active(until) → re-probe →
  cleared, with escalating re-probe intervals and a cap) — genuine stateful coordination, not a flag.
- **Cross-component integration:** the episode object is written by the per-feature `Conductor`
  rate-limit branch (conductor.ts:1163) and read by the daemon dispatch loop (daemon.ts:568-621);
  two subsystems that today share no rate-limit coupling.
- **Concurrency:** N in-flight features run in-process concurrently; they must share ONE coordinated
  backoff and a single re-probe, and the dispatch gate must interact correctly with `checkPaused`,
  `pickEligible`, and in-flight teardown without races or double-dispatch.
- **Signal correctness:** replace the non-cancellable `setTimeout` wait with an AbortSignal-driven
  wait and add a SIGTERM handler (today only SIGINT exists) so TERM exits promptly mid-wait — a
  correctness/safety surface with adversarial timing.
- **Story count:** ~6–8 stories across coordinator, dispatch gate, interruptible wait, signal
  handling, and classification-at-call-sites.

## Note
M and L are BUILD-identical (only Small skips steps); the load-bearing classification is
"not Small," which is unambiguous here. Recorded as L to reflect true complexity. Full DECIDE
(architecture-diagram, architecture-review, conflict-check) applies.
