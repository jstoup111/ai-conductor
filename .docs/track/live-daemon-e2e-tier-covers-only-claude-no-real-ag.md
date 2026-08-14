# Track: Live daemon E2E tier covers only Claude — no real-agent Codex signal

Track: technical

Scope boundary: Balanced — provider-parameterized live legs for Claude and Codex from one
shared run body, per-provider `credentialed` capability resolution so verdicts are independent,
real matrix parameterization in `live-daemon-e2e.yml`, and a structural guard that enumerates
registered `llm_provider` plugins and fails when one has no live leg. Excluded: extracting a
general reusable live-tier harness, per-provider cost-ceiling configuration beyond parity with
the existing token cap, and any change to production dispatch behavior. Operator will add a
`CODEX_API_KEY` repository secret, so the Codex leg is a real fail-closed release gate.

CI/test-infrastructure work with no user-facing product behavior; acceptance criteria live
directly in stories, so no PRD is authored.
