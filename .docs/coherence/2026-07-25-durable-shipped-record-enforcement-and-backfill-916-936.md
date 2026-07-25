# Coherence: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Date:** 2026-07-25
**Plan stem:** `2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936`
**Track / tier:** Technical / M
**Stories:** `.docs/stories/durable-shipped-record-enforcement-and-backfill-916-936.md`
**Plan:** `.docs/plans/2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md`

The outcome row class is omitted because this chat-origin feature has no staged or committed intake
outcomes. The FR row class is omitted because the approved track is technical and has no PRD.
Per operator direction on 2026-07-25, the backfill rows remain behaviorally mapped but add no
dedicated automated audit/backfill tests; their evidence is the real report, record diff, strict
record verification, and idempotent second run.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-ST-916-1 | task-1, task-11, task-12, task-13, task-14, task-15 | covered | The strict-verdict happy path and all five numbered refusal paths have real task blocks. |
| story | story-ST-936-2 | task-5, task-6, task-16, task-17, task-18, task-19, task-20 | covered | Ordinary, merged, and non-shipping convergence plus all five failure paths have real task blocks. |
| story | story-ST-916-3 | task-2, task-3, task-4, task-21, task-22, task-23, task-24, task-25 | covered | Association, Action, protection, and all five required-check failure paths have real task blocks. |
| story | story-ST-916-4 | task-7, task-8, task-26, task-27, task-28, task-29, task-30 | covered | Repair creation/convergence and all five repair failure paths have real task blocks. |
| story | story-ST-916-5 | task-9, task-31, task-32, task-33, task-34, task-35, task-40 | covered | Audit/backfill success, all five audit failure paths, and the real repository backfill have task blocks. |
| story | story-ST-936-6 | task-10, task-36, task-37, task-38, task-39, task-40 | covered | Discovery compatibility, all four durability/dedup failures, and fresh-checkout backfill proof have task blocks. |
| task | task-1 | story-ST-916-1 | covered | `**Story:** ST-916-1 AC1, AC2` cites the declared story. |
| task | task-2 | story-ST-916-3 | covered | `**Story:** ST-916-3 AC1, AC2` cites the declared story. |
| task | task-3 | story-ST-916-3 | covered | `**Story:** ST-916-3 AC1, AC2, AC3` cites the declared story. |
| task | task-4 | story-ST-916-3 | covered | `**Story:** ST-916-3 AC3, AC4` cites the declared story. |
| task | task-5 | story-ST-936-2 | covered | `**Story:** ST-936-2 AC1` cites the declared story. |
| task | task-6 | story-ST-936-2 | covered | `**Story:** ST-936-2 AC2, AC3` cites the declared story. |
| task | task-7 | story-ST-916-4 | covered | `**Story:** ST-916-4 AC1, AC2` cites the declared story. |
| task | task-8 | story-ST-916-4 | covered | `**Story:** ST-916-4 AC3, AC4, AC5` cites the declared story. |
| task | task-9 | story-ST-916-5 | covered | `**Story:** ST-916-5 AC1, AC2, AC3, AC4` cites the declared story. |
| task | task-10 | story-ST-936-6 | covered | `**Story:** ST-936-6 AC1, AC2, AC3` cites the declared story. |
| task | task-11 | story-ST-916-1 | covered | `**Story:** ST-916-1 NP1` cites the declared story. |
| task | task-12 | story-ST-916-1 | covered | `**Story:** ST-916-1 NP2` cites the declared story. |
| task | task-13 | story-ST-916-1 | covered | `**Story:** ST-916-1 NP3` cites the declared story. |
| task | task-14 | story-ST-916-1 | covered | `**Story:** ST-916-1 NP4` cites the declared story. |
| task | task-15 | story-ST-916-1 | covered | `**Story:** ST-916-1 NP5` cites the declared story. |
| task | task-16 | story-ST-936-2 | covered | `**Story:** ST-936-2 NP1` cites the declared story. |
| task | task-17 | story-ST-936-2 | covered | `**Story:** ST-936-2 NP2` cites the declared story. |
| task | task-18 | story-ST-936-2 | covered | `**Story:** ST-936-2 NP3` cites the declared story. |
| task | task-19 | story-ST-936-2 | covered | `**Story:** ST-936-2 NP4` cites the declared story. |
| task | task-20 | story-ST-936-2 | covered | `**Story:** ST-936-2 NP5` cites the declared story. |
| task | task-21 | story-ST-916-3 | covered | `**Story:** ST-916-3 NP1` cites the declared story. |
| task | task-22 | story-ST-916-3 | covered | `**Story:** ST-916-3 NP2` cites the declared story. |
| task | task-23 | story-ST-916-3 | covered | `**Story:** ST-916-3 NP3` cites the declared story. |
| task | task-24 | story-ST-916-3 | covered | `**Story:** ST-916-3 NP4` cites the declared story. |
| task | task-25 | story-ST-916-3 | covered | `**Story:** ST-916-3 NP5` cites the declared story. |
| task | task-26 | story-ST-916-4 | covered | `**Story:** ST-916-4 NP1` cites the declared story. |
| task | task-27 | story-ST-916-4 | covered | `**Story:** ST-916-4 NP2` cites the declared story. |
| task | task-28 | story-ST-916-4 | covered | `**Story:** ST-916-4 NP3` cites the declared story. |
| task | task-29 | story-ST-916-4 | covered | `**Story:** ST-916-4 NP4` cites the declared story. |
| task | task-30 | story-ST-916-4 | covered | `**Story:** ST-916-4 NP5` cites the declared story. |
| task | task-31 | story-ST-916-5 | covered | `**Story:** ST-916-5 NP1` cites the declared story. |
| task | task-32 | story-ST-916-5 | covered | `**Story:** ST-916-5 NP2` cites the declared story. |
| task | task-33 | story-ST-916-5 | covered | `**Story:** ST-916-5 NP3` cites the declared story. |
| task | task-34 | story-ST-916-5 | covered | `**Story:** ST-916-5 NP4` cites the declared story. |
| task | task-35 | story-ST-916-5 | covered | `**Story:** ST-916-5 NP5` cites the declared story. |
| task | task-36 | story-ST-936-6 | covered | `**Story:** ST-936-6 NP1` cites the declared story. |
| task | task-37 | story-ST-936-6 | covered | `**Story:** ST-936-6 NP2` cites the declared story. |
| task | task-38 | story-ST-936-6 | covered | `**Story:** ST-936-6 NP3` cites the declared story. |
| task | task-39 | story-ST-936-6 | covered | `**Story:** ST-936-6 NP4` cites the declared story. |
| task | task-40 | story-ST-916-5, story-ST-936-6 | covered | The delivery task explicitly cites ST-916-5 AC1–AC4 and ST-936-6 AC1. |

## Verify-Claims Verdict

**CLEAR.** Every cited story id exists in the accepted stories artifact; every cited task id exists
in the committed plan; and every task's `**Story:**` line resolves to at least one declared story.
There are no semantic gaps, fabricated ids, phantom coverage claims, or unconfirmed load-bearing
assumptions.
