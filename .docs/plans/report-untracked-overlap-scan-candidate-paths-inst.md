# Implementation Plan: Report untracked overlap-scan candidate paths instead of a false clean verdict

**Date:** 2026-09-06
**Stories:** .docs/stories/report-untracked-overlap-scan-candidate-paths-inst.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing advisory contract for this command — always exit 0, degrade rather than throw, and never gain a blocking behavior — and it changes no report field, no option, and no caller's read of the report.

## Summary

Three bounded tasks deliver #875: a candidate-path classification helper over the injected git runner, its wiring into the scan so the clean verdict is only printed when it was earned, and a `--files` capture that stops dropping the paths the operator passed. Rename detection, name-only-diff detection, the intersection rule, branch enumeration, and the blocker sweep are outside this slice.

## Technical Approach

The defect has two independent halves and both are needed for the reported invocation to behave.

The first half is that the scan never asks whether a candidate path exists. `runOverlapScan` resolves the base, enumerates unmerged sibling branches, and intersects each branch's changed-path list with `candidateFiles` purely in memory, so a candidate absent from the checkout contributes nothing and is never mentioned. Add one small exported helper in the same module that classifies the candidate list against the checkout through the already-injected `GitRunner`, using a single `ls-files` invocation that lists both tracked and present-but-untracked paths under the standard exclude rules, with repo-root-relative output. Normalize both sides the way this module already normalizes paths — collapse backslashes to forward slashes and strip a leading `./` — and match on exact path equality. Do not reuse or modify the existing intersection helper: a sibling spec is changing that function in this same file, and this classification needs its own normalization site anyway. The helper returns either the ordered, de-duplicated list of candidates absent from the checkout, or a distinct classification-failed result carrying the git exit status; it never throws.

The second half is the report rule. A candidate absent from the checkout is kept in the scan rather than dropped, because a sibling branch that creates that very file is the single most useful thing this scan can tell a plan author about a planned-new path — dropping it would trade one silent failure for another. What changes is visibility: `runOverlapScan` appends one advisory note per absent candidate, one note when classification failed, and one note when the candidate list is empty. Reuse the existing `skipNotes` channel rather than adding a report field. That channel is already the report's "this is not a plain all-clear" surface, `renderReport` already suppresses the single clean line whenever it is non-empty, and reusing it keeps this change off the report interface that the sibling spec and the coherence validator both touch. No new event, metric, span, or report channel is introduced, so the event-spine procedure returns "no new channel" — this is an existing gate result gaining an existing-shaped note.

The third change is at the command line. `detectOverlapScanCommand` reads exactly one value after `--files` and then ignores every following bare token, which is why the reported space-separated invocation scanned only the nonexistent path and printed the clean line. Make `--files` accumulate: consume its value and every following token that does not begin with a dash, allow the option to repeat, and comma-split each accumulated token as today. Recognized options and their values are still consumed by their own branches, so an option immediately following `--files` cannot be captured as a path. This is strictly additive — tokens that used to be discarded now count — so no option is removed, no accepted spelling stops working, and no migration is owed.

Follow the module's existing test conventions rather than inventing new ones. The scripted `fakeGit` argv-prefix matcher in the engine unit suite is the pattern for helper and wiring cases; the real-git scratch-repository fixture in the acceptance suite, which builds sibling branches on disk and drives the real git runner with only the blocker resolver faked, is the pattern for the end-to-end report cases; the scratch-repository plus real dispatch pattern in the CLI suite is the pattern for the command-entry-point proof. Search those three files for their existing repository builders and reuse them. Variation in fixture builders and assertion grouping is fine; what must be preserved is the boundary each layer proves. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, annotate-and-keep-scanning over drop-the-missing-path, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/overlap-scan.ts` performs no existence check on `candidateFiles`; `runOverlapScan` calls only `resolveBase`, `rev-parse --verify`, `enumerateUnmergedBranches`, `changedPathsBetween`, and `blockerSweep`.
- Verified: `renderReport` in that module prints its single clean line only when `seamOverlaps`, `blockers`, `indeterminate`, and `skipNotes` are all empty, and prefixes each note with `Advisory:` otherwise — so a note both surfaces the path and withholds the unearned clean verdict.
- Verified: `intersectFiles` in that module normalizes by collapsing backslashes and stripping a leading `./`, then matches on exact equality; a candidate absent from every branch diff simply never matches.
- Verified: `detectOverlapScanCommand` in `src/conductor/src/index.ts` assigns `filesRaw` from the single token after `--files` and its loop ignores any token that matches no option, so trailing bare paths are discarded before the scan runs.
- Verified: `overlapScanCommand` in that file always returns 0 and catches every throw, so an added note cannot change the command's exit status.
- Verified: `advisoryDuplicateClaimWarn` in `src/conductor/src/engine/engineer/coherence-validator.ts` is the only other caller of `runOverlapScan`, and it reads `seamOverlaps` and `blockers` only — added notes cannot change land behavior.
- Verified: `GitRunner` in `src/conductor/src/engine/rebase.ts` is `(args, opts?) => Promise<{exitCode, stdout, stderr}>`, so the classification probe needs no new dependency, no filesystem seam, and no new injection point.
- Verified: the engine unit suite's scripted `fakeGit` returns an empty, zero-exit result for unmatched argv, so existing wiring cases keep passing and only assert fields this change does not remove.
- Scope check: consumer-facing engine behavior; no skill addition; provider-agnostic. Event spine: no new channel, an existing advisory report gains existing-shaped notes.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in this worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Classify candidate paths against the checkout
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/overlap-scan.ts, src/conductor/test/engine/overlap-scan.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit tests for a new exported classification helper using the suite's existing scripted argv-prefix git fake: a fully present candidate list, a fully absent list, a mixed list, an empty candidate list, repeated spellings of one path, and spellings differing only by a leading `./` or by backslash separators.
2. Add a unit case for a non-zero exit from the listing command, asserting the helper returns its distinct classification-failed result carrying the exit status and reports no path as absent.
3. Establish RED, then implement the helper: one `ls-files` invocation listing tracked and present-but-untracked paths under the standard exclude rules with repo-root-relative output, normalized and matched exactly as described in Technical Approach. Return absent candidates in input order, de-duplicated. Never throw.
4. Run the focused unit file through the repository's scoped test runner, confirm the repository's typecheck target that includes test files passes, and commit the focused change.

**Done when:**
1. The helper returns exactly the candidate paths absent from the combined tracked-and-present listing, in input order, with repeats collapsed to one entry.
2. The helper returns its classification-failed result naming the git exit status when the listing command exits non-zero, and reports no path as absent in that case.
3. Unit cases cover present-only, absent-only, mixed, and empty candidate lists plus the leading-dot-slash and backslash spellings, and the helper throws in none of them.

### Task 2: Withhold the clean verdict unless the scan earned it
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/overlap-scan.ts, src/conductor/test/engine/overlap-scan.test.ts, src/conductor/test/acceptance/overlap-scan.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Write scripted-git unit cases against the scan entry point: absent candidates produce one note each, an empty candidate list produces the nothing-was-scanned note, and a failing classification command produces its own note while every sibling-branch overlap found in the same run is still returned.
2. Write real-git acceptance cases on the suite's existing scratch-repository fixture: a mixed present/absent candidate list where a sibling branch changes the present path; an all-present, uncontended list; an all-absent list; and an absent path that a sibling branch creates.
3. Establish RED, then call the Task 1 helper from the scan entry point after the base is resolved and append the notes to the existing advisory-note list. Do not remove absent candidates from the scanned set, do not add a report field, and leave the branch enumeration, intersection, and blocker sweep untouched.
4. Run the focused unit and acceptance files through the repository's scoped test runner, confirm the typecheck target that includes test files passes, and commit the focused change.

**Done when:**
1. The scan appends one advisory note per absent candidate path, one note when classification failed, and one note stating nothing was scanned when the candidate list is empty.
2. A real-git case over a mixed present/absent candidate list renders both the sibling-branch overlap line for the present path and a notice naming the absent path.
3. A real-git case whose candidate paths are all present and uncontended renders exactly the existing single clean line unchanged, and a real-git case whose candidate paths are all absent renders no clean line.
4. A scripted-git case proves a failing classification command still returns every sibling-branch overlap found in that run and never throws.
5. A real-git case proves a candidate path absent from the checkout but created by a sibling branch is still reported as an overlap on that branch.

### Task 3: Capture every path passed to the candidate-file option
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/index.ts, src/conductor/test/engine/overlap-scan-cli.test.ts
**Dependencies:** 2

**Steps:**
1. Write argv-parsing unit cases in the existing CLI suite: `--files` followed by several bare tokens, a repeated `--files` mixing comma-separated and space-separated values, and `--files` immediately followed by another recognized option and its value.
2. Establish RED, then make the option accumulate — consume its value and every following token that does not begin with a dash, allow the option to repeat, comma-split each accumulated token as today, and leave every other option branch untouched so a following option is still consumed by its own branch.
3. Add one dispatch case on the suite's existing scratch-repository fixture that drives the real command entry point with a space-separated candidate list mixing a present path a sibling branch changes with a path absent from the checkout, asserting both the overlap line and the absent-path notice appear and the returned exit code is 0.
4. Run the focused CLI file through the repository's scoped test runner, confirm the typecheck target that includes test files passes, and commit the focused change.

**Done when:**
1. Parsing `--files` followed by several bare tokens yields every token as a candidate path, and a repeated `--files` yields the union of every occurrence's values in the order given.
2. Parsing `--files` immediately followed by another recognized option and its value yields an empty candidate list and leaves that option's own parsed value correct.
3. A real dispatch over a space-separated mixed candidate list prints the present path's sibling-branch overlap line and the absent path's notice and returns exit code 0.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a candidate list holding one path present in the checkout that an unmerged sibling branch also changes and one path absent from the checkout, when the scan runs, then the report names the sibling branch with the present path and separately names the absent path as not present in the checkout. | 2 | "A real-git case over a mixed present/absent candidate list renders both the sibling-branch overlap line for the present path and a notice naming the absent path." | diff-local |
| Story 1 happy: Given every candidate path is present in the checkout and no sibling overlap, blocker, or degradation applies, when the scan runs, then the report is the existing single clean line and names no candidate path. | 2 | "A real-git case whose candidate paths are all present and uncontended renders exactly the existing single clean line unchanged, and a real-git case whose candidate paths are all absent renders no clean line." | diff-local |
| Story 1 happy: Given a candidate path is absent from the checkout but an unmerged sibling branch creates it, when the scan runs, then the report still names that branch and that path as an overlap alongside the not-present notice. | 2 | "A real-git case proves a candidate path absent from the checkout but created by a sibling branch is still reported as an overlap on that branch." | diff-local |
| Story 1 negative: Given every candidate path is absent from the checkout, when the scan runs, then the report names each absent path and does not contain the clean "no overlap detected" line. | 1, 2 | "A real-git case whose candidate paths are all present and uncontended renders exactly the existing single clean line unchanged, and a real-git case whose candidate paths are all absent renders no clean line." | diff-local |
| Story 1 negative: Given no candidate paths were supplied at all, when the scan runs, then the report states that nothing was scanned for overlap and does not contain the clean "no overlap detected" line. | 2 | "The scan appends one advisory note per absent candidate path, one note when classification failed, and one note stating nothing was scanned when the candidate list is empty." | diff-local |
| Story 1 negative: Given the git invocation that classifies candidate paths fails, when the scan runs, then the report carries an advisory note naming that failure, still lists every sibling-branch overlap it found, and the command exits 0. | 1, 2 | "A scripted-git case proves a failing classification command still returns every sibling-branch overlap found in that run and never throws." | diff-local |
| Story 2 happy: Given `--files` is followed by several space-separated paths, when the command line is parsed, then every one of those paths is a candidate path. | 3 | "Parsing `--files` followed by several bare tokens yields every token as a candidate path, and a repeated `--files` yields the union of every occurrence's values in the order given." | diff-local |
| Story 2 happy: Given `--files` appears more than once, and some occurrences carry comma-separated values, when the command line is parsed, then every value from every occurrence is a candidate path, in the order given. | 3 | "Parsing `--files` followed by several bare tokens yields every token as a candidate path, and a repeated `--files` yields the union of every occurrence's values in the order given." | diff-local |
| Story 2 negative: Given `--files` is followed immediately by another recognized option and its value, when the command line is parsed, then neither the option nor its value becomes a candidate path and that option keeps its own parsed value. | 3 | "Parsing `--files` immediately followed by another recognized option and its value yields an empty candidate list and leaves that option's own parsed value correct." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures; nothing here depends on a commit outside this feature's diff. Task 1 owns unit-level classification against a scripted git runner. Task 2 owns the scan-level wiring: scripted-git units for the note assembly and degradation, real-git acceptance cases for the rendered report, reusing the acceptance suite's existing scratch-repository fixture with only the blocker resolver faked. Task 3 owns the changed production boundary — the command entry point — and proves the delivered behavior through a real dispatch with a real git runner over a scratch repository, which is the only place the argv capture and the report rule are observable together. No test in this plan reaches a real LLM, a real GitHub API, or any other third-party service; the blocker resolver stays faked and no invocation supplies a source ref. No new aggregate or smoke test is required, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
