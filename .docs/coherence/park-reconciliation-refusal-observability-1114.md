# Coherence: park-reconciliation refusal observability (#1114)

Plan stem: `park-reconciliation-refusal-observability-1114`. Tier M, technical track — the `fr` row
class is omitted (no PRD), and the `outcome` row class is omitted (no staged intake-outcome bullets
in this worktree; the intake issue's four stated acceptance outcomes are traced narratively below).
Story ids `S1`–`S6` are the `## Story <id>:` headings in the stories file; task ids `1`–`18` are the
plan's task tree.

## Intake outcomes, traced narratively

- **O1 — a squash-merged, record-backed feature reconciles and its worktree/branch is cleaned up.**
  Already satisfied by #1185's merged-PR head-identity proof, verified 2026-08-01: the branch cited
  in the issue has a merged PR whose `headRefOid` equals its tip, and the slug is absent from
  `.daemon/parked/`. Held against regression by tasks 1 and 5.
- **O2 — a branch with genuinely unmerged commits is still refused, naming which commits are not
  represented.** Stories S1, S2, S5; tasks 2, 3, 4, 6, 7, 8, 14.
- **O3 — the sweep summary distinguishes refusal causes so an unreachable cleanup arm can never
  again look like a healthy `reconciled=0`.** Stories S3, S4; tasks 9, 10, 11, 12, 13.
- **O4 — the ADR is amended or superseded to record the added proof path.** Story S6; tasks 16, 17,
  18, delivered by `adr-2026-08-01-multi-proof-park-deletion-authority`.

Descoped with operator sign-off: patch-equivalence as a third deletion proof (verified working, but
clears only 3 branches beyond the shipped proof) and the separate merge-to-shipped-record reconciler
gap (those slugs never classify `merged`, so they never reach the refusal path).

## Traceability mapping

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| story | story-S1 | task-2, task-3, task-4, task-7 | covered | Refusal taxonomy introduced (2), probe widened to a diagnosis (3), diagnosis mapped in the deletion gate (4), unit-tested (7) |
| story | story-S2 | task-6, task-8, task-14 | covered | Unmerged-commit collection (6), its unit tests (8), operator-verb rendering (14) |
| story | story-S3 | task-9, task-10, task-12 | covered | Counters added (9), emitted in the summary line (10), sweep-level tests (12) |
| story | story-S4 | task-11, task-13 | covered | Refusals folded into the log de-duplication signature (11) with a negative test that a mix change re-logs (13) |
| story | story-S5 | task-1, task-5, task-15 | covered | Partition pinned before the change (1), re-verified after the gate rewrite (5), acceptance suite re-pinned not loosened (15) |
| story | story-S6 | task-16, task-17, task-18 | covered | ADR amended in place (16), operator docs updated (17), changelog and harness validation (18) |
| task | task-1 | story-S5 | covered | Characterization test pinning the current delete/refuse partition |
| task | task-2 | story-S1 | covered | RefusalReason union introduced, types only |
| task | task-3 | story-S1 | covered | Head-identity probe returns proven/no-pr/ahead/behind/indeterminate |
| task | task-4 | story-S1 | covered | Diagnosis mapped onto refusal reasons in the deletion gate |
| task | task-5 | story-S5 | covered | Re-run of the partition test after the gate rewrite |
| task | task-6 | story-S2 | covered | Collect commits an unmerged-commits refusal would drop |
| task | task-7 | story-S1 | covered | Unit tests for the four unproven refusal reasons |
| task | task-8 | story-S2 | covered | Unit tests for the commit listing, cap, and overflow suffix |
| task | task-9 | story-S3 | covered | refused and refusedByReason added to the sweep counters |
| task | task-10 | story-S3 | covered | Summary line and guidance emit refusals |
| task | task-11 | story-S4 | covered | Refusals incorporated into the de-duplication signature |
| task | task-12 | story-S3 | covered | Sweep-level counting tests |
| task | task-13 | story-S4 | covered | Negative test that a refusal-mix change is never suppressed |
| task | task-14 | story-S2 | covered | Operator verb renders reasons and commit lines |
| task | task-15 | story-S5 | covered | Acceptance suite re-pinned to specific reasons |
| task | task-16 | story-S6 | covered | Inline amendment to the 07-27 ADR sections 1 and 3 |
| task | task-17 | story-S6 | covered | CLI reference and daemon guide updated |
| task | task-18 | story-S6 | covered | Changelog entry and harness integrity validation |

All rows covered; zero gaps. Every task carries exactly one `**Story:**` id, and no story lacks a
task. Verdicts confirmed against the stories and plan files in this worktree.

## Invariants asserted end to end

- No branch becomes newly deletable — ADR section 5, story S5, tasks 1 and 5.
- Fail-closed on any indeterminate git or gh answer — ADR section 3, story S1, tasks 3 and 6.
- A single guarded deletion helper serves both call sites — conflict-check, tasks 4 and 14.
- Existing negative coverage is re-pinned, never loosened to a wildcard — conflict-check C1, tasks 7
  and 15.
- Adding a future deletion proof requires an ADR — ADR section 2, task 16.

## Residual risk accepted

`branch-behind-merged-head` refuses although deleting such a branch would drop nothing. No proof in
the authorised set covers it, so it refuses. Naming it separately makes the case countable, so a
later ADR can decide it on measured evidence rather than assumption.
