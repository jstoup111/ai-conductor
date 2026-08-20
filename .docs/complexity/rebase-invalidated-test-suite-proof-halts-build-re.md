# Complexity: Rebase-invalidated test_suite proof HALTs build_review

Tier: M

## Signals

| Signal | Count | Mechanical tier |
|---|---|---|
| models | 0 | S |
| integrations | 0 | S |
| auth | 0 | S |
| stateMachines | 2 (the BUILD gate loop's dispatch/skip boundary; the step-runner retry ladder) | M |
| stories | ~6 | M |

The mechanical signal set is product-shaped and under-reads a pure-engine change: three
structurally-zero product signals would outvote the two real ones and return **S**. Overridden to
**M**, consistent with every recent engine-loop feature in this repository
(`one-build-review-pass-clears-the-convergence-cap-s`,
`the-engine-cannot-detect-its-own-spinning-operator`), both assessed M on the same grounds.

Not **L**: no new store, no new provider boundary, no schema migration, and no LLM in any decision
path. Every change is a call to an existing predicate, an existing classifier, or an existing port.

## Rationale

- **Data models:** none added. The one new persisted surface is a CLI verb writing through
  `ConductStateStore`, whose mutation shape `adr-2026-08-01` already defines. No new
  `.pipeline/` file, no new ledger, no new event union member.
- **Integrations:** none. No provider dispatch and no third-party boundary.
- **State machines: two, and they are why this is not S.**
  1. The gate loop's dispatch boundary. Inserting a predicate re-check ahead of the `alreadyResolved`
     short-circuit sits upstream of every tier skip, track skip, bootstrap skip, upstream-skip, and
     the DECIDE re-check, and it is reached on every iteration for every step. Getting its scope
     wrong in either direction is a live failure: too narrow and the strand survives; too broad and a
     step whose predicate is expensive or non-tree-attesting gets re-dispatched on every resume,
     which is the "regressing to top-of-list re-runs" hazard `adr-2026-07-11` names as a known prior
     failure class.
  2. The step-runner retry ladder. `classifyRetryDecision` currently reads a `CompletionResult`
     facet; a step-runner failure carries no such facet, only an output string. Routing on result
     shape rather than reason text — the discipline `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
     D1 established — is the substance of that half.
- **Sequencing risk:** low. `overlap-scan` reports no overlap across
  `conductor.ts`, `rebase.ts`, `daemon-rekick.ts`, `selector.ts`, and `state.ts`, and none of the
  four open PRs touches them. This is genuinely uncontended, unlike most recent engine work.
- **ADR load:** high for a change this size — five approved ADRs constrain it
  (`adr-2026-07-08`, `adr-2026-07-11`, `adr-2026-07-13`, `adr-2026-07-25`, `adr-2026-08-01`) and
  three of them were written specifically about the seams being touched. That is an argument for a
  full review pass, not for a larger tier: the constraints are published and each has an explicit
  extension bar this change meets rather than relaxes.
- **Story count:** ~6 — the loop re-check, the eligible-step scope, the pre-verify extension, the
  retry classification, the named-step halt, and the operator rewind verb.

Non-Small, so `conflict-check`, `architecture-diagram`, `architecture-review`, and `coherence-check`
all apply.
