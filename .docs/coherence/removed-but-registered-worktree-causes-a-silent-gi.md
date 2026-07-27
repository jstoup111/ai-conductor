# Coherence Check: removed-but-registered worktree 128 loop (#1022)

**Date:** 2026-07-27
**Tier:** M
**Track:** Technical
**Plan stem:** `removed-but-registered-worktree-causes-a-silent-gi`
**Result:** COVERED — zero gaps

Technical track, so there is no PRD and no `fr` rows. No `outcome` rows are required either:
this idea's staged `.pipeline/intake-outcomes.md` carries a `Source-Ref` but zero outcome
bullets, so the outcome layer is not engaged. The mapping below therefore traces
stories → tasks, with every plan task accounted for.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-S1 | task-1, task-2, task-4 | covered | Task 1 builds the porcelain record parser, Task 2 makes `isRegisteredWorktree` consume it so a prunable registration reports not-usable, Task 4 pins the preserved suffix-match and fail-soft contracts (S1 1d, 1e). |
| story | story-S2 | task-3, task-5, task-6 | covered | Task 3 exposes prunability to `ensureWorktree`, Task 5 implements prune-then-add and asserts the prune precedes the add (S2 2c), Task 6 pins no-prune-when-healthy and lazy base resolution (S2 2d, 2e). |
| story | story-S3 | task-7, task-8, task-9, task-10 | covered | Task 7 adds the injected auto-park seam, Task 8 writes the durable park with cause and remedy, Task 9 covers both negatives (post-worktree HALT unchanged; write never masks the original error), Task 10 proves the dispatch gate and provenance against real state. |
| story | story-S4 | task-10 | covered | The engineer shares `ensureWorktree`, so Task 10 verifies rather than implements. The plan states the expectation of no engineer-specific production change explicitly, so a surprise surfaces as a failing spec rather than silently passing. |
| story | story-S5 | task-11 | covered | Task 11 updates the worktree recovery runbook, the daemon guide's auto-park reasons, and the CHANGELOG `[Unreleased]` entry, leaving VERSION untouched per pre-v1 policy. |
| task | task-1 | story-S1 | covered | `parseWorktreeRecords` — record-wise porcelain parsing, pinned by the canonical prunable fixture and a two-record isolation case (S1 1a, 1c). |
| task | task-2 | story-S1 | covered | `isRegisteredWorktree` rejects a prunable registration while a healthy one still reuses (S1 1a, 1b). |
| task | task-3 | story-S1, story-S2 | covered | `findWorktreeRecord` exposes registration prunability to `ensureWorktree`, sharing the path matcher so the two cannot diverge. |
| task | task-4 | story-S1 | covered | Regression pins for realpath-suffix matching and the fail-soft catch after the line-wise to record-wise rewrite (S1 1d, 1e). |
| task | task-5 | story-S2 | covered | `ensureWorktree` prunes then attaches or creates, asserting the recorded argv order (S2 2a, 2b, 2c). |
| task | task-6 | story-S2 | covered | No prune is issued on any of the three healthy routes, and `resolveBase` stays unfired on reuse, attach, and prune-then-attach (S2 2d, 2e). |
| task | task-7 | story-S3 | covered | `DaemonRunnerDeps` gains injected `projectRoot` and `writeAutoPark` seams, wired in `daemon-cli.ts` beside the existing park/halt wiring (S3 3a). |
| task | task-8 | story-S3 | covered | The pre-worktree throw path writes the durable auto-park carrying the git error and the `git worktree prune` remedy (S3 3a, 3b). |
| task | task-9 | story-S3 | covered | Negatives: a post-worktree throw still writes HALT and keeps the worktree with no auto-park, and a failing park write never masks the original error (S3 3e, 3f). |
| task | task-10 | story-S3, story-S4 | covered | Real-git acceptance coverage for the removed-but-registered state, the dispatch gate on a fresh process, park provenance and unpark, plus all three engineer cases (S3 3c, 3d; S4 4a, 4b, 4c). |
| task | task-11 | story-S5 | covered | Runbook, daemon guide, and changelog updates; VERSION deliberately unchanged (S5 5a, 5b, 5c). |

## Divergences from the intake, recorded deliberately

The intake embedded a fix direction. Two of its four desired-outcome bullets were re-sited
during DECIDE after verification, and neither is a silent substitution:

1. **The durable-record surface changed** from `.pipeline/HALT` to a `.daemon/parked/<slug>`
   auto-park. The proposed surface is structurally unavailable on this failure, and more
   decisively, a HALT would not gate dispatch for a worktree-less feature even if it were
   writable — `isHalted` resolves a worktree-relative path, while `isParked` is checked first
   and unconditionally. See ADR Decision 2.
2. **Filtering prunable was found insufficient on its own.** Omitting the prune relocates the
   128 from the create path to the attach path — verified by reproduction. The prune arm is
   therefore not an alternative to the filter but a required companion, which is why S1 and S2
   ship together and Task 5 depends on Task 3.

Both divergences are recorded in the track doc's hypothesis table, the ADR, and here, so the
daemon builds the verified design rather than the filer's sketch.
