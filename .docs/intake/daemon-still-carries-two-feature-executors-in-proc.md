# Intake origin: daemon-still-carries-two-feature-executors-in-proc

Source-Ref: jstoup111/ai-conductor#3333
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3333 digest=db27c9fe8a227eb60fb514602e08425aca8a37d42318bcf99b2055793a7287bd >>>
## Desired outcome

- The daemon runs dispatched features one way only, the per-dispatch engine-pinned child process. There is no config value that selects another execution path.
- A config that still sets `executor_isolation` gets a clear, actionable result (rejection or a deprecation warning naming the key), not silent acceptance.
- Daemon tests that previously forced `in-process` exercise the production child path, or their target is shown to be executor-independent.
- Docs and the configuration reference no longer describe an in-process mode or a rollback lever.
- The ADR's follow-up action is marked done.
<<< END INBOUND >>>
