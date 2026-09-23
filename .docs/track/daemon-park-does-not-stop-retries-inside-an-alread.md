# Track: Park stops retries inside an already-dispatched step

Track: product

Scope boundary: Advisory park plus reporting. A park declines the next provider dispatch or retry inside a running step. It does not interrupt a provider call that is already running. The park command's output and the emergency-stop runbook say whether work is still running for the slug. Killing an in-flight provider process is out of scope.

This changes operator-visible daemon park semantics and the park command's output. It extends the 2026-07-29 scheduling-unit park boundary down to individual provider dispatches.
