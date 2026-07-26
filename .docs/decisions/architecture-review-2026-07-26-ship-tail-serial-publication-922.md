# Architecture Review: SHIP-tail serial publication (#922)

**Date:** 2026-07-26
**Track:** Technical
**Complexity:** Medium
**Verdict:** SUPERSEDED by the current-HEAD fence amendment in
`architecture-review-2026-07-26-rebase-tail-amendment-922`

## Feasibility

Verified: the registry already controls prerequisite gating, and `done` and `skipped` prerequisite
states satisfy the gate. Replacing the rebase prerequisite with `retro` implements the selected
ordering without a new runtime component, external dependency, schema change, or configuration
surface.

## Alignment

The change preserves the validation group's concurrent behavior while serializing only the
externally consequential tail. The original conclusion that no separate freshness mechanism was
needed was disproved during pre-acceptance-spec review: an already-done rebase and explicit finish
target can reach the common finish branch without re-evaluating the registry edge. The amendment
adds an engine-owned current-HEAD fence at that boundary.

## Wiring Surface

| Production surface | Design-time caller |
|---|---|
| Revised `rebase.prerequisites` | The conductor loop's existing registry-derived gate selection and `checkGate` prerequisite evaluation |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| A skipped `retro` fails to satisfy rebase | Technical | Low | Medium | Gate test asserts skipped prerequisite acceptance |
| A changed rebase reaches finish with stale validation | Integration | Low | High | Integration test asserts changed rebase returns through validation before finish |

## ADRs Created

- `adr-2026-07-26-serial-ship-tail-publication` — APPROVED by operator 2026-07-26.

## Conditions

- Test both all-green ordering and changed-rebase revalidation before finish.
