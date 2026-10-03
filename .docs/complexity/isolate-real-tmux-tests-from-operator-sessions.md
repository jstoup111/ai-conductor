# Complexity: isolate-real-tmux-tests-from-operator-sessions

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None (a test-support fixture runner and a run-level tmux environment floor) |
| External integrations | Real `tmux` binary only (already a dependency) |
| Auth / permission surface | None |
| State machines | None; fixture lifecycle (create → use → owned teardown → interrupted-run sweep) |
| Story count | ~5–6 (run-level floor, fixture runner, migration of 4 ambient tests, static check, interrupted-run cleanup, retained coverage) |
| Files touched | ~10: `test/setup.ts`/`test/global-setup.ts`, new shared fixture module, 5 real-tmux test files, `test/tmux-leak-guard.ts`, `test/test_harness_integrity.sh` (or an integrity check script) |
| New runtime code | Test-support code only; no production behavior change |

## Rationale

Not Small: the change spans two vitest tiers (default and e2e), introduces a cross-cutting
run-level isolation floor that every tmux client in the test process tree inherits, adds a new
integrity rule, and rests on a load-bearing tmux socket-resolution assumption that needs a real
probe. Not Large: no production code, schema, CLI, or cross-component contract changes; all work
is confined to test infrastructure and validation.
