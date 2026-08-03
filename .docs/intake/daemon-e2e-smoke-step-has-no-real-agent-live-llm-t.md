# Intake origin: daemon-e2e-smoke-step-has-no-real-agent-live-llm-t

Source-Ref: jstoup111/ai-conductor#1124
Owner: jstoup111

## Desired outcome

- A scheduled (e.g. nightly) CI job drives a fixture feature end-to-end through the real daemon pipeline (claim through finish) using a real claude and/or codex subprocess, not the injected fake.
- The job's token/runtime cost is bounded and predictable (a hard cap), and it uses setup-token auth (see `src/conductor/test/engine/build-token-auth.smoke.test.ts` for the existing auth pattern).
- A failure prints the daemon log excerpt and pipeline state so the failing seam is identifiable from CI output alone.
- This job is advisory/scheduled only and never blocks per-PR merges — it is separate from the required per-PR deterministic gate.
