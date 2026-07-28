# Complexity: CI needs a daemon end-to-end smoke step

Tier: S

## Signals

- **models:** 0 — no new domain models; fixture feature reuses existing plan/story/task shapes.
- **integrations:** 0 — no new third-party integration; reuses the existing injected `LLMProvider` fake already wired into acceptance tests, and the existing `ci.yml` GitHub Actions structure.
- **auth:** 0 — no new auth path; the deterministic tier doesn't touch real-agent credentials (that's deferred to intake #1124).
- **stateMachines:** 0 — exercises the existing daemon state machine (claim → build → finish) as a consumer; does not add a new one.
- **stories:** ~3-4 — expected: (1) fixture feature scaffolding, (2) CI job wiring + un-excluding the new test from vitest's smoke exclusion, (3) failure-output/log-excerpt assertion, (4) regression coverage for the already-fixed parser bugs (#578/#615/#620/#548/#636).

All signals land at S. Per this repo's engineer contract: skip `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and `/coherence-check` for Small tier.
