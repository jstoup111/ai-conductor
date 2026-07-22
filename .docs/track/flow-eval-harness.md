# Track: flow-eval-harness

Track: technical

## Rationale

This is internal developer/eval tooling for the harness repo itself: a set of runnable
example scripts and a standing eval that drive each `conduct-ts` execution flow (inline,
interactive, daemon, engineer, intake-loop) end-to-end at S/M/L complexity tiers and report
per-combination pass/fail. There is no end-user product with functional requirements worth a
PRD — the "users" are harness operators/CI. Acceptance criteria for this test-infrastructure
behavior belong in stories, not a PRD. The one operator-facing surface (a new eval runner
command / npm script and committed example prompts) is developer tooling, not product
capability. → **technical track** (skip `/prd`).

## Source

Issue jstoup111/ai-conductor#786.
