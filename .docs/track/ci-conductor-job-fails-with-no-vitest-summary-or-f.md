# Track: CI conductor job names the test files that were running when it fails

Track: technical

Scope boundary: Balanced (pre-authorized composer run; recorded as the default reading of intake jstoup111/ai-conductor#2631). The sharded `conductor` CI job's Vitest run names each test file as it starts and finishes, names failing tests as soon as their file finishes, reports a file that stops making progress within a bounded time, and leaves an attributable trace (in-flight files plus how the Vitest process ended) when the run aborts before Vitest prints its summary. Excluded: changing the reporter used by local `npm test` and the harness `test_suite` gate; the `conductor-e2e` job; root-causing the #2555 abort itself; worker memory tuning; and the daemon CI-fix log excerpt (`enrichCiFixHint` keeps the head of `gh run view --log-failed`).

Rationale: CI test-infrastructure diagnostics with no user-facing product capability, so acceptance criteria live directly in stories (no PRD). Not a maintenance change: it adds observable CI log behavior.

Event spine: not applicable. This is Vitest reporter output on the CI step's stdout, written by the test runner process, which hosts no `ConductorEventEmitter` and has no conductor consumer; no conductor occurrence, ledger, or sidecar is introduced (`.agents/skills/event-spine/SKILL.md` step 1/2).
