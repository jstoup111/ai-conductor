**Status:** Accepted

# Stories: BUILD runs one whole-feature simplify pass before its first build_review

Technical track; no PRD. Acceptance criteria derive from the operator-directed outcome (7 of 13 live
daemon builds reached `build_review` with no simplify record) and
`adr-2026-08-03-uncommitted-work-floor-under-build-completion` D9. "The feature record" is
`.pipeline/audit-trail/feature-simplification.md`; for an active stacked child `k`, "the child record"
is `.pipeline/audit-trail/child-<k>-simplification.md`. A record is CLEAN when it contains the line
`## Verdict: CLEAN`. "Resolved" means every plan task in scope is resolved and the worktree has no
uncommitted paths.

## Story 1: BUILD does not hand off to build_review without a CLEAN whole-feature simplify record

As the daemon, I want the build completion check to withhold the handoff to `build_review` until a whole-feature simplify pass has recorded CLEAN, so that duplication and domain-modelling defects are fixed before they each cost a review lap.

### Acceptance Criteria

#### Happy Path
- Given a resolved build with a CLEAN feature record, when the build completion check runs, then it reports done.
- Given a resolved build with no feature record and no `.pipeline/build-review.json`, when the build completion check runs, then it reports not done with a reason that starts `whole-feature simplify pass required:` and names `.pipeline/audit-trail/feature-simplification.md`.
- Given an active stacked child 2 whose scoped tasks are resolved and whose child record is CLEAN, when the build completion check runs, then it reports done; without that child record it reports not done naming `.pipeline/audit-trail/child-2-simplification.md`.
- Given a resolved build whose feature record is CLEAN and whose `.pipeline/build-review.json` exists from an earlier lap, when BUILD completes again after a remediation kickback, then the check reports done without a new simplify pass.

#### Negative Paths
- Given a resolved build whose feature record ends `## Verdict: SIMPLIFY_REQUIRED`, when the build completion check runs, then it reports not done with the `whole-feature simplify pass required:` reason.
- Given a resolved build with no feature record but an existing `.pipeline/build-review.json` written before this rule, when the build completion check runs, then it reports done.
- Given a build with an unresolved plan task and no feature record, when the build completion check runs, then the reason names the unresolved task and does not mention the simplify pass.
- Given a build with uncommitted paths and no feature record, when the build completion check runs, then the reason names the uncommitted paths and does not mention the simplify pass.

### Done When
- [ ] Build completion predicate tests cover the CLEAN, missing, SIMPLIFY_REQUIRED, child, and pre-existing `build-review.json` cases with the stated results.
- [ ] Unresolved-task and uncommitted-path completion results keep their existing reasons when the feature record is absent.
- [ ] The `simplify` skill defines a whole-feature mode that writes the feature or child record and reads its kind definitions from the `build-review-implementation-quality` skill, and the `tdd` skill names the pass as required before BUILD completes.

## Story 2: The retries-exhausted escape cannot bypass the simplify floor

As the operator, I want a build that exhausts its retry budget without a CLEAN simplify record to halt naming the missing pass, so that the escape that routes commit-moving builds forward never skips it.

### Acceptance Criteria

#### Happy Path
- Given a BUILD whose attempts moved HEAD, whose tree is clean, and whose feature record is CLEAN, when its retry budget is exhausted with plan tasks still unresolved, then the run routes forward and dispatches `build_review`.

#### Negative Paths
- Given a BUILD whose attempts moved HEAD, whose tree is clean, whose plan tasks are resolved, and which has no feature record, when its retry budget is exhausted, then `build_review` is not dispatched and `.pipeline/HALT` is written with a reason containing `whole-feature simplify pass required:`.

### Done When
- [ ] A conductor test with commit movement, a clean tree, and no feature record observes no `build_review` dispatch and a HALT naming the simplify pass.
- [ ] A conductor test with commit movement, a clean tree, unresolved tasks, and a CLEAN feature record observes `build_review` dispatched.

## Story 3: A simplify-only follow-up attempt is steered, not stalled

As the builder, I want the retry after a simplify miss to tell me exactly what to produce and not be killed as a no-progress stall, so that a CLEAN pass that changes no code can still complete BUILD.

### Acceptance Criteria

#### Happy Path
- Given a build completion miss whose reason starts `whole-feature simplify pass required:`, when the retry hint is built, then it directs the builder to run the `simplify` workflow in whole-feature mode over `base...HEAD` and record the named file ending `## Verdict: CLEAN`.
- Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason starts `whole-feature simplify pass required:`, then the attempt is not classified as a no-task-progress stall.

#### Negative Paths
- Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason names pending tasks, then the attempt is still classified as a no-task-progress stall.

### Done When
- [ ] `buildRetryHint` returns the whole-feature simplify instruction for the simplify reason.
- [ ] `isNoTaskProgressBuildStall` returns false for the simplify reason and true for a pending-task reason under the same counts.
