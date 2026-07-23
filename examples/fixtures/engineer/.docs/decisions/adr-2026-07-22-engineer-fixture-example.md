# ADR: Engineer fixture example — land gate exercise

**Date:** 2026-07-22
**Status:** APPROVED

## Context

The `engineer.sh` example harness (Story 7,
`.docs/stories/flow-examples.md`) needs a committed, landable `.docs/` set
that the `land` guards accept by inspection: no DRAFT ADR, stories
`Accepted`, and (since this fixture is tier M, not S) an APPROVED ADR
alongside the plan.

## Decision

Ship a minimal fixture at `examples/fixtures/engineer/.docs/` with a
technical track marker, a Tier M complexity marker, this APPROVED ADR, an
Accepted stories doc, and a one-task plan — mirroring the sibling
`examples/fixtures/daemon/` pattern from Task 8.

## Consequences

- The fixture never needs authoring by a real `/explore`/`/prd`/`/stories`/`/plan`
  run — it is hand-authored once and stays static.
- Any future change to the land gate's required fields must update this
  fixture in lockstep or `test/test_examples_engineer.sh` will fail.
