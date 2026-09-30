# Track: Capture provider exit code and signal on unclassified subprocess failure

Track: technical

Scope boundary: Minimal (operator-confirmed). Diagnostics only: when a provider subprocess (claude, codex, pi) exits without a classifiable result, capture its raw exit code, terminating signal, and stdout/stderr byte counts via a shared provider-diagnostics helper (extracted from codex `executionProbeFacts`), and surface them in daemon.log, the retry/HALT reason text, and an existing failure event on the event spine. Excluded: changing HALT class or auto-park/auto-retry of grader-dispatch failures (#823's second ask), new classifiers, new telemetry channels, and the unused legacy `graderDispatchFailed` path.

Internal engine diagnostics with no user-facing product requirements; acceptance criteria live in stories.
