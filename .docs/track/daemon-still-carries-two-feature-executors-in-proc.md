# Track: Daemon still carries two feature executors; in-process lever lets them drift (#3333)

Track: technical

Change class: deletion

Scope boundary: Operator-confirmed "lever + test seam" breadth, executed as though the in-process path never existed. Delete the in-process feature-executor adapter (`createInProcessFeatureExecutor` and its deps type in `src/conductor/src/engine/feature-executor.ts`), the `executor_isolation` selection branch and its in-process log line in `src/conductor/src/daemon-cli.ts`, and the `executor_isolation` key from the config type, the known top-level key set, and validation — with no retired-key entry, deprecation warning, targeted error, or migration: a config that still sets the key hits the generic `Unknown top-level key: "executor_isolation"` rejection. Replace the daemon-cli `opts.runFeature` composition-test bypass with an injectable child-executor `fork` seam so daemon composition, integration, and acceptance tests run the production work-order → child executor → broker → terminal-effects path; tests that pinned `executor_isolation: in-process` drop the pin and run that path. Docs and the configuration reference describe only the per-dispatch child executor, with no history of an in-process mode or rollback lever. The ADR `adr-2026-10-15-per-dispatch-engine-pinned-executor.md` follow-up action is marked done. Excluded: tests that fork a real built engine, any change to the child executor's process/IPC behavior, and edits to other features' sealed historical `.docs/` records.

Removing an unreleased internal daemon execution path (absent from v1.6.0 and from every branch and registered-project config) changes no product capability; no PRD is warranted.
