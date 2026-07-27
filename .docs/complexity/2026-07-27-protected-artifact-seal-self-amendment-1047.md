# Complexity: protected-artifact-seal-self-amendment-1047

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — one added optional field on an existing verdict type |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| New persisted state | **None** — no new file, no new ledger, no new schema |
| Story count | 3 (report-on-tolerate, engine surfacing, grader rubric rule) |
| Files touched | 3 source + 2 test files |
| New runtime code | ~40 lines, no new module |

## Rationale

The decision this intake asks for (see
`.docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`) selects
the option that reuses machinery that already exists rather than building new machinery. The
self-amendment is **already** present in `build_review`'s diff — `assembleBuildReviewInputs`
computes `git diff merge-base(base, HEAD)..HEAD`, and the amended `.docs/` artifact is a
committed file in that range. Nothing needs to be captured, stored, or transported. What is
missing is only that (a) the seal tolerates it silently, and (b) the grader is never told that
DECIDE artifacts are approval-bearing.

So the change is three narrow edits at three existing seams, no new module and no new persisted
state. → **Small.** `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and
`/coherence-check` are skipped for this tier. A single ADR is still authored because "a
decision, recorded" is the intake's explicit desired outcome.
