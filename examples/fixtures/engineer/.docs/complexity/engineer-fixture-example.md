# Complexity Assessment: Engineer fixture example

**Date:** 2026-07-22
**Tier:** M
**Plan:** .docs/plans/engineer-fixture-example.md

## Signals

| Signal | Value | Reading |
|---|---|---|
| Models/tables | 0 | Small |
| External integrations | 0 (stubbed `conduct-ts`) | Small |
| Auth/authz | None | Small |
| State machines | worktree -> land -> handoff sequence | Medium |
| Estimated stories | 1 (happy + negative path) | Small/Medium |

## Decision

**Medium (M).** Chosen deliberately (rather than Small) so this fixture exercises
the land gate's non-Small path, which requires an APPROVED ADR alongside the
Accepted stories and plan.
