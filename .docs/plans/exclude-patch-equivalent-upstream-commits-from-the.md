# Implementation Plan: Exclude patch-equivalent upstream commits from the graded build_review diff

**Date:** 2026-09-06
**Stories:** .docs/stories/exclude-patch-equivalent-upstream-commits-from-the.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing grader-input contract — one merge-base-anchored diff, a pathspec exclusion list assembled before it, and fire-and-forget base telemetry that never affects the step outcome.

## Summary

Four bounded tasks deliver #1654. Grader-input assembly asks Git which feature commits are patch-equivalent to the freshly-resolved review base, drops the paths only those commits touched from the graded diff, and records the filtered set on the base telemetry event the conductor already emits. Rebasing, merge-base resolution, rubric judgement, cache identity, and the completion authority are outside this slice.

## Technical Approach

Patch-equivalence is Git's own judgement, taken from `git cherry <baseRef> HEAD`: lines beginning with a minus name feature commits whose patch id matches a commit reachable from the base but not from HEAD. This was verified directly in a scratch repository — a feature commit is marked equivalent even when the upstream copy carries a different subject, and a modified variant of the same change is marked novel. Subject matching is deliberately not used; the existing subject-set check in the rebase guard exists for a different question.

Exclusion is path-scoped and fail-closed. One `git log` pass over the graded range, formatted to one sha per record with file names and renames disabled, builds a map from changed path to the set of commits that touched it. A path becomes an exclude pathspec only when its commit set is non-empty and wholly contained in the patch-equivalent set, so a path a novel commit also touched stays fully graded and the reviewer never loses novel work. Merge commits emit no file names under that format, so a path reachable only through one is never excludable. Any non-zero exit, unparseable output, or empty attribution yields no exclusions at all and grading proceeds exactly as it does today.

The pathspecs are appended to the graded-diff argv beside the two exclusion lists it already carries — the machinery-authored prefixes and the engine-appended plan exclusion. That is deliberately the only application point: the removal context, the changed-test titles, and the test-quality scope are all derived from that single diff string, so filtering it filters every present and future rubric input at one seam, and the content digest that governs cache reuse changes for free because the diff text it hashes changes.

The audit record rides the existing base-freshness telemetry as two additive optional fields — the filtered commits with sha and subject, and the excluded paths — carried on the step result the conductor already emits from. The event-spine skill prescribes exactly this: the bus already carries the concern, and additive optional fields on an existing variant are the backward-compatible extension. No new event variant, no sink classification change, no artifact stamp, and no sidecar. Assembly of the provenance is guarded so an observability failure can never fail or alter the grading, matching the guard already wrapping the base-freshness fields.

Tests follow the repository's test-authoring rules and the patterns already in the grader-input suite: scripted-GitRunner unit cases assert on the recorded argv, and real-local-Git integration cases build the stale-base window with a temporary repository and no remote traffic. No provider is invoked, no conductor run is started, and event emission is proven at the step-result boundary and the renderer rather than through a lifecycle run.

## Preconditions and claim ledger

- Operator approved Small scope, the path-scoped fail-closed exclusion rule, the telemetry-field audit record, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: the graded diff is built at line 561 of the grader-input assembly module as a merge-base-anchored `git diff` whose argv already appends `MACHINERY_AUTHORED_PATHS` (line 153) and the engine-appended plan exclusion (line 554).
- Verified: the removal context, changed-test titles, and test-quality scope are each derived from that same diff string inside the same function, so one exclusion point covers them all.
- Verified: the content-based supersession helper added for #1497 lives at line 922 of the rebase module and is called only from the post-rebase `featureCommitsPreserved` guard; it never runs on the review path, so it does not already cover this defect.
- Verified: the base telemetry variant is declared at line 591 of the engine event union, carried on the step-result field declared at line 1241 of the conductor, populated at line 2620 of the step runner, emitted at line 8554 of the conductor, and rendered at line 2810 of the daemon CLI.
- Verified: the only rubric registered today is the test-quality rubric, so "no rubric attributes the commit" is satisfied by filtering the shared diff rather than by per-rubric work.
- Verified in a scratch repository: `git cherry -v` marks a patch-equivalent commit with a minus and a modified variant with a plus, and per-path commit attribution over the graded range names the single commit that touched the file.
- Event spine: channel yes, concern occurrence, verdict extend the union via additive optional fields on the existing base variant, exception none.
- Scope check: A harness-repo-only, B not applicable (no new skill), C provider-agnostic.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in this worktree, and the Git behaviour was reproduced rather than assumed.

## Tasks

### Task 1: Compute and apply the patch-equivalent exclusion
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/build-review-inputs.ts, src/conductor/test/engine/build-review-inputs.test.ts
**Dependencies:** none

**Steps:**
1. Add scripted-GitRunner unit cases to the grader-input suite: one run where a commit is reported patch-equivalent and owns its files exclusively, and one run where no commit is reported patch-equivalent. Assert on the recorded graded-diff argv. Establish RED.
2. Implement the exclusion helper in the assembly module. Run the patch-equivalence probe against the freshly-resolved base ref and HEAD, collect the shas on minus-marked lines, and return an empty result when there are none.
3. Attribute changed paths with a single commit log pass over the graded range, formatted to one sha per record with file names emitted and renames disabled, and build the path-to-commit-set map from it.
4. Emit an exclude pathspec for each path whose commit set is non-empty and wholly contained in the patch-equivalent set, and append those pathspecs to the graded-diff argv beside the two exclusion lists already there.
5. Return the filtered commits with their shas and subjects, plus the excluded paths, as an advisory field on the assembled inputs that no digest, projection, or verdict reads.
6. Run the focused grader-input tests through scoped-run, run the typecheck target that includes test files, and commit.

**Done when:**
1. A scripted-Git unit case shows the graded-diff argv carrying an exclude pathspec for every path only a patch-equivalent commit touched.
2. A scripted-Git unit case with no patch-equivalent commit shows the graded-diff argv identical to the pre-change exclusion list.
3. The assembled inputs expose the filtered commit shas, subjects, and excluded paths as an advisory field that no digest or projection consumes.

### Task 2: Keep novel work graded and fail closed
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/build-review-inputs.ts, src/conductor/test/engine/build-review-inputs.test.ts
**Dependencies:** 1

**Steps:**
1. Build a real-local-Git integration fixture reproducing the stale-base window: a temporary repository with no remote, a base branch that independently absorbs a change, and a feature branch carrying both a patch-equivalent copy of it and a genuinely novel commit.
2. Add integration cases for a modified variant of an upstream commit, for a path touched by both a patch-equivalent and a novel commit, and for a probe that exits non-zero. Establish RED wherever current behaviour differs.
3. Harden the helper so a non-zero exit, unparseable output, or empty attribution produces no exclusions, and so a path reachable only through a merge commit is never excludable.
4. Assert in each case that the changed-file references, changed-test selectors, changed-test titles, and removal records omit the upstream-equivalent file and retain the novel and variant files.
5. Assert the recorded Git argv for a full assembly run contains only read-only invocations, so no rebase, reset, checkout, or index write is triggered.
6. Run the focused tests through scoped-run and commit.

**Done when:**
1. The integration case for a modified variant leaves every path that commit touched in the graded diff.
2. The integration case for a path shared by an equivalent and a novel commit leaves that path fully graded.
3. The failing-probe case produces a graded diff byte-identical to a run with the mechanism disabled.
4. Every derived input in the stale-base case omits the upstream-equivalent file while retaining the novel file.
5. The recorded Git argv for an assembly run contains no ref, index, or working-tree write.

### Task 3: Carry the filtered set on the base telemetry
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/step-runners.ts, src/conductor/src/engine/conductor.ts, src/conductor/test/engine/step-runners.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the step-runner suite's existing base-freshness case, and add one with a patch-equivalent commit present, asserting the filtered commits and excluded paths ride the same result field the conductor emits the base event from. Establish RED.
2. Add the two optional fields to the base telemetry variant in the engine event union and to the step-result carrier declaration, keeping both optional so existing emitters and readers are unaffected.
3. Populate them inside the existing guarded block that builds the base-freshness record, so a malformed or missing advisory field leaves telemetry undefined rather than throwing.
4. Include the two fields in the conductor's base-event emit call, inside the try block that already swallows telemetry failures.
5. Add a step-runner case proving an advisory field that fails to assemble leaves the verdict and the graded diff unchanged.
6. Run the focused step-runner tests through scoped-run, run the typecheck target that includes test files, and commit.

**Done when:**
1. A step-runner integration case observes the filtered commit shas, subjects, and excluded paths on the base-freshness result field.
2. A step-runner integration case with no patch-equivalent commit leaves both fields absent from that field.
3. An injected provenance failure leaves the build_review verdict and the graded diff identical to the run without it.

### Task 4: Render the filtered count and document the exclusion
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/engine/daemon-render.test.ts, docs/explanation/gates.md
**Dependencies:** 3

**Steps:**
1. Add renderer unit cases to the daemon render suite: a base event carrying filtered commits, and one carrying none. Establish RED.
2. Extend the base-event render case in the daemon CLI with a dim clause naming how many commits were filtered, keeping the existing base and freshness summary and its styling unchanged.
3. Leave the line byte-identical to today when no commit was filtered.
4. Add a paragraph to the gates explanation page beside the two existing graded-diff exclusion paragraphs, stating what is excluded, the fail-closed path-scoped rule, and where an operator reads the filtered set.
5. Run the focused renderer tests through scoped-run and commit.

**Done when:**
1. A renderer unit case shows the filtered-commit count on the base line when commits were filtered.
2. A renderer unit case shows the base line unchanged when no commit was filtered.
3. The gates explanation page describes the exclusion, its fail-closed rule, and where the filtered set is visible.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature commit that Git identifies as patch-equivalent to a commit already on the freshly-resolved review base, when build_review assembles grader inputs, then the paths that commit alone changed appear in no hunk of the graded diff. | 1, 2 | "A scripted-Git unit case shows the graded-diff argv carrying an exclude pathspec for every path only a patch-equivalent commit touched." | diff-local |
| Story 1 happy: Given such a commit was filtered, when the inputs derived from the graded diff are built, then its files appear in no changed-file reference, changed-test selector, changed-test title, or removal record. | 2 | "Every derived input in the stale-base case omits the upstream-equivalent file while retaining the novel file." | diff-local |
| Story 1 negative: Given a feature commit is a modified variant of an upstream commit and is therefore not patch-equivalent to it, when build_review assembles grader inputs, then every path that commit changed remains fully graded. | 2 | "The integration case for a modified variant leaves every path that commit touched in the graded diff." | diff-local |
| Story 1 negative: Given a changed path was touched by both a patch-equivalent commit and a genuinely novel commit, when build_review assembles grader inputs, then that path remains fully graded. | 2 | "The integration case for a path shared by an equivalent and a novel commit leaves that path fully graded." | diff-local |
| Story 1 negative: Given the patch-equivalence probe or the per-path attribution command fails or returns nothing, when build_review assembles grader inputs, then no path is excluded and the graded diff is exactly what it would have been without this mechanism. | 1, 2 | "The failing-probe case produces a graded diff byte-identical to a run with the mechanism disabled." | diff-local |
| Story 1 negative: Given the exclusion is computed on a feature worktree, when build_review assembles grader inputs, then no Git invocation that rewrites refs, the index, or the working tree is issued. | 2 | "The recorded Git argv for an assembly run contains no ref, index, or working-tree write." | diff-local |
| Story 2 happy: Given one or more feature commits were filtered, when build_review finishes assembling grader inputs, then the base telemetry it carries names each filtered commit's sha and subject together with every excluded path. | 1, 3 | "A step-runner integration case observes the filtered commit shas, subjects, and excluded paths on the base-freshness result field." | diff-local |
| Story 2 happy: Given that telemetry reaches the daemon feature log, when the base line is rendered, then the operator sees how many commits were filtered alongside the existing base-freshness summary. | 4 | "A renderer unit case shows the filtered-commit count on the base line when commits were filtered." | diff-local |
| Story 2 negative: Given no feature commit is patch-equivalent to the review base, when build_review finishes assembling grader inputs, then the telemetry carries no filtered-commit record and the rendered base line is unchanged. | 3, 4 | "A renderer unit case shows the base line unchanged when no commit was filtered." | diff-local |
| Story 2 negative: Given the filtered-set provenance cannot be assembled, when build_review runs, then the step verdict and the graded diff are unaffected and grading proceeds. | 3 | "An injected provenance failure leaves the build_review verdict and the graded diff identical to the run without it." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the scripted-GitRunner unit cases for pathspec assembly. Task 2 owns the real-local-Git integration cases that reproduce the stale-base window and prove the fail-closed and novel-work guards, including the derived-input assertions. Task 3 owns the step-result telemetry boundary. Task 4 owns the renderer unit cases and the documentation update. No provider, network, GitHub, or real LLM call is introduced; the only external process is local Git, which is the boundary under test. No conductor lifecycle run is added, and no new aggregate or smoke test is required.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 3 -> Task 4
