# Complexity: sweep-stale-vitest-run-temp-roots-at-global-setup-

Tier: S

Rationale: two files in `src/conductor/test/` (a new pure sweep decision helper plus an owner
marker writer/heartbeat in `tmpdir-leak-guard.ts`, and the setup/teardown wiring in
`global-setup.ts`), one unit-test file, and a short amendment to
`adr-2026-08-09-worktree-local-provider-scratch.md` recording the namespace-independent
liveness predicate. No engine, CLI, config-schema, or consumer-facing surface changes.
