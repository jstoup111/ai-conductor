# Track: Daemon E2E smoke step has no real-agent (live-LLM) tier (#1124)

Track: technical

CI/test-infrastructure hardening on top of the deterministic daemon E2E fixture that shipped from
#630 (`src/conductor/test/engine/daemon-e2e-fixture.test.ts`, PR #1155). No user-facing product
surface changes: the deliverable is a dispatch-run, advisory live-agent smoke tier plus its cost bound
and failure diagnostics. Acceptance criteria live in the stories; there is no PRD.
