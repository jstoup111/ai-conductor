# Complexity: child-executed features lose closing OTel telemetry at shutdown (#3645)

Tier: S

Rationale: one logical defect fix in two production files on the shape #3333 lands.
`src/conductor/src/engine/executor-broker.ts` splits `abortAll` (reject pending coordination calls,
release held locks and windows) from per-attachment detach (stop forwarding events, stop the
visualizer). `src/conductor/src/daemon-cli.ts` ends a child dispatch's trace by awaiting the
visualizer stop, then flushing daemon metrics, then leaving the active visualizer set. About 30
production lines with two focused tests; a prototype at local ref `ref/child-otel-shutdown-hotfix`
(`4a3e7d1057`) measured 39 changed lines including comments. No new module, dependency, schema, CLI
flag, hook, or ADR. It restores in-process parity that #3333's accepted Story 5 already intends.
Per tier rules: no PRD (technical track), no architecture-diagram, architecture-review,
conflict-check, coherence-check, or plan-review. Blocked by #3333: the hook it edits is the shape
#3333 Task 25 introduces. Operator chose S spec over hotfix 2026-11-07.
