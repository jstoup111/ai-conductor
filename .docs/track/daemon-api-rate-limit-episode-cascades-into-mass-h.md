# Track: Daemon rate-limit episode — global backoff + signal-responsive wait

Track: technical

Daemon/engine reliability fix (no user-facing product behavior). A rate-limit episode must be a
daemon-level pause, not a per-feature failure: an in-process episode coordinator gates new dispatch,
in-flight features share one coordinated escalating backoff, and the wait is SIGTERM-responsive.
Acceptance criteria live directly in the stories. Source: jstoup111/ai-conductor#270.
