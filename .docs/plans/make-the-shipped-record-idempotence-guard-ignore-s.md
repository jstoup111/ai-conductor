# Implementation Plan: Shipped-record idempotence over non-telemetry substance

**Date:** 2026-09-06
**Stories:** .docs/stories/make-the-shipped-record-idempotence-guard-ignore-s.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing shipment contract — the same resolved identity, the same rendered body, the same degrade-never-block wrapper, the same stdout and stderr discipline, and the same at-most-one-commit outcome.

## Summary

> **Amended 2026-09-11 by operator approval for #1648:** Preserve the APPROVED cost-rollup ADR and use the correct final total, not the legacy snapshot. Task 4 supersedes the executed tasks' telemetry-insensitive skip rule: changed Cost or Time must commit, and only byte-identical rendered records may skip. Historical tasks stay for attribution; current acceptance is the corrected story.

Three bounded tasks deliver #1648. A pure projection strips the two self-updating rollup blocks from a rendered record body; the shipped-record subcommand compares that projection against the record committed at HEAD and, when only the rollups moved, restores the committed bytes and commits nothing. The rollup computation, the KPI reader, the post-finish refresh caller, and the sibling existence-check defect in the finish publication adapter are outside this slice.

## Technical Approach

> **Amended 2026-09-11 by operator approval for #1648:** Preserve the APPROVED cost-rollup ADR and use the correct final total, not the legacy snapshot. Task 4 supersedes the executed tasks' telemetry-insensitive skip rule: changed Cost or Time must commit, and only byte-identical rendered records may skip. Historical tasks stay for attribution; current acceptance is the corrected story.

The corrective approach compares the complete assembled record with the committed bytes. Preserve the existing read-failure fallback, exact-byte restoration for a true no-op, staged check, and write/stage/commit behavior. The existing engine-owned post-finish refresh already calls this writer after finish usage is recorded; restore that path's current-total behavior without introducing another provider dispatch, event channel, or telemetry baseline. No new ADR replaces or weakens the existing equality contract.

Add one exported pure function beside the existing record renderers in `src/conductor/src/engine/shipped-record.ts`. It takes a rendered record body and returns the same body with the `## Cost` and `## Time` sections removed — each section spanning its column-zero heading line through the byte before the next column-zero `## ` heading, or through the end of the body when none follows. Nothing else is touched: the frontmatter fence, the `## Build Review` block, the accepted build-review risk section and its comment markers, and the reduced build-review coverage section all survive the projection byte for byte. Those two sections are exactly the values that a write of the record changes, because both are aggregated from the feature worktree's own event ledger and both grow with the dispatch that is doing the writing; the build-review metrics and the evidence sections are not, so they stay inside the comparison.

In `src/conductor/src/engine/shipped-record-cli.ts`, insert the decision between the completed body assembly and the existing write. Read the committed counterpart with a single `git show HEAD:<record path>` invocation using the existing execa runner, with rejection disabled so a missing path or an unborn branch reports a nonzero exit instead of throwing, and with final-newline stripping disabled so the returned bytes are the committed bytes — the same two settings the shipment evidence reader already uses for this purpose. A nonzero exit means there is no committed counterpart and the existing commit path runs unchanged.

When a committed counterpart exists and its projection equals the freshly rendered body's projection, write the committed bytes back through the existing idempotent record writer, print the existing already-committed line on stdout, and return zero without staging or committing. Restoring the committed bytes rather than leaving the drifted body on disk is load-bearing: the post-finish refresh in `conductor.ts` refuses to enter its transaction unless both the working tree and the index are clean, so a guard that left the drifted record behind would trade a redundant commit for a refusing caller. Otherwise the existing sequence runs untouched — write, stage, check the staged content, commit as `shipped record: <slug>` — so the byte-identical case keeps its current guard as an inner safety net and every observable line, flag, and exit code is unchanged.

Update the one reference sentence in `docs/reference/cli.md` that currently states the command commits only when the staged content changed, so the documented rule matches the delivered rule: identical substance produces no duplicate commit, and a difference confined to the self-updating cost and time rollups counts as identical substance.

Tests follow the repository's test-design rules. The projection is a pure exported helper and is proven at unit level in the existing engine-level shipped-record test file, with table-driven bodies assembled from the real renderers rather than hand-typed markdown. The commit decision depends on real Git semantics and is proven in the existing daemon-ship integration file, which already stands up a real temporary repository on a real implementation branch and drives the real subcommand; the only injected boundaries are the ones that file already injects. No provider, no network, no GitHub call, and no conductor run is introduced. Fixtures make the rollup move the way production does, by growing the worktree event ledger between the two writes.

## Preconditions and claim ledger

- Operator approved the Small scope, the comparison approach over freezing the rollup, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `shipped-record-cli.ts` assembles the body, calls the record writer, stages the path, and commits whenever `git diff --cached --quiet` reports a staged change; there is no comparison of content beyond that staged check.
- Verified: `renderShippedRecordWithCost` in `shipped-record.ts` emits a `## Cost` block containing a `dispatches` counter, and `appendTimingSection` emits a `## Time` block containing active milliseconds; both derive from the feature worktree's own event ledger.
- Verified: `cost-rollup.ts` increments its dispatch counter once per dispatch observation, so the counter includes the dispatch performing the write.
- Verified: `appendBuildReviewMetrics` replaces an existing `## Build Review` section in place and both evidence sections are appended as their own column-zero headings, so a section-scoped projection can remove the two rollup blocks without disturbing them.
- Verified: `refreshPostFinishShippedRecord` in `conductor.ts` runs `git diff --quiet` and `git diff --cached --quiet` before its transaction and returns early when HEAD did not move, so restoring the committed bytes leaves that caller working and turns it into a genuine no-op.
- Verified: `shipment-evidence.ts` already reads committed bytes through execa with final-newline stripping disabled, which is the pattern this change reuses.
- Verified: `src/conductor/test/engine/shipped-record.test.ts` and `src/conductor/test/integration/daemon-ship.integration.test.ts` both exist and already cover the renderers and the real-git subcommand respectively, including the current already-committed re-run assertion.
- Verified: `docs/reference/cli.md` documents the current commit rule in the shipped-record section, and no other reference, guide, or runbook page states it.
- Scope check: harness-repo-only, since the shipped-record ledger and its dedup are conventions of this repository's own construction; no new skill; provider-agnostic. Event spine: no new event, metric, span, log line, or report — the two existing stdout lines are unchanged.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree. No approved decision record is amended: the per-feature cost rollup decision fixes the block's contents and its home, not the commit decision.

## Tasks

> **Amended 2026-09-11 by operator approval for #1648:** Preserve the APPROVED cost-rollup ADR and use the correct final total, not the legacy snapshot. Task 4 supersedes the executed tasks' telemetry-insensitive skip rule: changed Cost or Time must commit, and only byte-identical rendered records may skip. Historical tasks stay for attribution; current acceptance is the corrected story.

### Task 1: Project a rendered record onto its non-telemetry substance
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/shipped-record.ts, src/conductor/test/engine/shipped-record.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit cases in the existing engine-level record test file, assembling bodies from the real renderers: frontmatter plus a cost block, the same body with a time block appended, the same body with build-review metrics appended, and the same body with the accepted-risk and reduced-coverage sections appended.
2. Assert RED on a projection that must erase both rollup blocks while preserving the frontmatter, the build-review metrics block, both evidence sections, and their comment markers, including the case where a rollup block is the final section of the body.
3. Implement the exported projection as a pure section-scoped removal keyed on column-zero headings, with no regular-expression backtracking over the whole body and no mutation of its input.
4. Add cases proving two bodies that differ only in their cost or time values project to equal output, and that bodies differing in frontmatter, in build-review metrics, or in evidence project to different output.
5. Run the focused unit file through the repository's scoped-run entry point and commit the focused change.

**Done when:**
1. Unit cases prove the projection removes the cost and time sections whether either is final, interior, or absent, and preserves the frontmatter fence byte for byte.
2. Unit cases prove the projection preserves the build-review metrics block, the accepted-risk section with its comment markers, and the reduced-coverage section unchanged.
3. Unit cases prove bodies differing only in cost or time values project equal, and bodies differing in PR value, spec hash, build-review metrics, or evidence project unequal.

### Task 2: Decide the commit on substance and keep the committed bytes
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/shipped-record-cli.ts, src/conductor/test/integration/daemon-ship.integration.test.ts, docs/reference/cli.md
**Dependencies:** 1

**Steps:**
1. Extend the existing real-git integration file with a fixture that seeds a worktree event ledger, runs the subcommand once, grows the ledger so the next render reports more dispatches and more active milliseconds, and runs it again. Assert RED on an unchanged commit count and a clean status after the second run.
2. Add a companion fixture that runs the second write with a different PR value and asserts a second commit whose committed body carries the newer rollup values.
3. Read the committed counterpart in the subcommand with one git show of the record path at HEAD, with rejection disabled and final-newline stripping disabled, placed after the body is fully assembled and before the existing record write.
4. When a counterpart exists and both projections are equal, write the committed bytes back through the existing record writer, print the existing already-committed line on stdout, and return zero without staging or committing; otherwise leave the existing write, stage, staged-check, and commit sequence untouched.
5. Update the shipped-record section of the CLI reference so its stated rule is substance-based and names the two rollup blocks the comparison ignores.
6. Run the focused integration file through the repository's scoped-run entry point and commit the focused change.

**Done when:**
1. The integration fixture with a growing event ledger produces exactly one shipped-record commit across two writes and prints the already-committed line on stdout on the second write.
2. Status output for the fixture worktree is empty after the skipped write, and the record file byte-matches the committed record.
3. The changed-PR fixture produces a second shipped-record commit whose committed body contains the newer dispatch count.
4. The existing stdout and stderr stream assertions, the byte-identical re-run assertion, and the degraded-rollup assertions in that file continue to pass unmodified.
5. The CLI reference sentence describes the substance comparison and names the cost and time blocks as ignored.

### Task 3: Prove the absent, unreadable, and evidence-bearing counterparts still commit
**Story:** Story 1 (negative path)
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/integration/daemon-ship.integration.test.ts
**Dependencies:** 2

**Steps:**
1. Add a fixture whose HEAD commit carries the plan and stories but no record at the resolved record path, and assert exactly one shipped-record commit after a single write.
2. Add a fixture on a repository whose branch has no commit at all, so the committed counterpart cannot be read, and assert one shipped-record commit and a zero exit.
3. Add a fixture that commits a record, then injects a disposition store returning one accepted build-review risk record for the feature, and assert a second shipped-record commit whose committed body contains the accepted-risk section.
4. Assert in every case that the command emitted no failure line on stderr and that the working tree is clean afterwards.
5. Run the focused integration file through the repository's scoped-run entry point and commit the focused change.

**Done when:**
1. The absent-counterpart fixture produces exactly one shipped-record commit whose body contains a cost block and a time block.
2. The unborn-branch fixture produces exactly one shipped-record commit and the command returns zero with no failure line on stderr.
3. The injected accepted-risk fixture produces a second shipped-record commit whose committed body contains the accepted build-review risk section.

### Task 4: Commit current totals and restore final-cost agreement
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/shipped-record-cli.ts, src/conductor/test/integration/daemon-ship.integration.test.ts, src/conductor/test/acceptance/feature-usage-total-at-finish.acceptance.test.ts, README.md, docs/reference/cli.md
**Dependencies:** 2, 3

**Steps:**
1. Correct the existing real-git integration expectations: ledger growth between writes must yield a second commit carrying the current Cost and Time; a third write with unchanged inputs must preserve HEAD and leave both index and working tree clean. Preserve absent/unreadable counterpart and substantive evidence-change coverage.
2. Establish scoped RED for the current-cost mismatch, then change the early guard in `shipped-record-cli.ts` to compare the complete assembled body with the exact committed bytes. A Cost/Time-only difference must take the existing write/stage/commit path. Remove only the now-unused import of the projection in this caller; the previously delivered helper and its tests need not be deleted in this repair.
3. Correct the existing finish acceptance tests that currently preserve input 10 despite finish input 40. Through the real internal finish path, prove the committed Cost equals the emitted `feature_usage_total` from the same ledger including finish usage. Update the related assertions to exercise the existing bounded refresh, verified commit, and push-failure recovery behavior rather than expecting the refresh never to happen. This task owns the final-cost boundary integration proof.
4. Keep all third-party boundaries fake and all Git repositories fixture-owned. Do not launch a provider or contact GitHub. Preserve the existing refresh transaction and recovery behavior; no additional finish dispatch is permitted just to write the record.
5. Update README and the shipped-record CLI reference to state that changed totals commit and unchanged complete records do not; remove the reader-facing promise to ignore Cost/Time differences. Run the affected integration and acceptance selectors through `ai-conductor scoped-run` and commit the repair.

**Done when:**
1. A grown ledger produces a committed record with current Cost and Time, while an unchanged third write adds no commit and leaves the fixture clean.
2. The successful finish fixture commits the same total emitted from the ledger, including finish usage; it cannot retain the pre-finish snapshot.
3. The existing refresh remains bounded and its push-failure recovery is exercised with fake external boundaries, without a second finish dispatch.
4. Absent/unreadable counterpart, PR/spec-hash, accepted-risk, and stream-discipline behavior remains covered; README and CLI documentation match the corrected commit rule.

## Coverage Check

> **Amended 2026-09-11 by operator approval for #1648:** Preserve the APPROVED cost-rollup ADR and use the correct final total, not the legacy snapshot. Task 4 supersedes the executed tasks' telemetry-insensitive skip rule: changed Cost or Time must commit, and only byte-identical rendered records may skip. Historical tasks stay for attribution; current acceptance is the corrected story.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an identical complete rendered record, writing it again creates no commit; after a ledger change, current totals are committed and an unchanged third write adds no commit. | 4 | "A grown ledger produces a committed record with current Cost and Time, while an unchanged third write adds no commit and leaves the fixture clean." | diff-local |
| Story 1 happy: After finish adds usage, the successful refresh commits the same total emitted from the ledger, including finish usage. | 4 | "The successful finish fixture commits the same total emitted from the ledger, including finish usage; it cannot retain the pre-finish snapshot." | diff-local |
| Story 1 happy: Given that skip occurs, when the write returns, then the record file and the git index byte-match the committed record so no tracked or staged change is left behind. | 2 | "Status output for the fixture worktree is empty after the skipped write, and the record file byte-matches the committed record." | diff-local |
| Story 1 negative: Given the commit at HEAD carries no record at the resolved record path, when the shipped-record write runs, then it commits the record exactly once rather than treating the absent record as a match. | 3 | "The absent-counterpart fixture produces exactly one shipped-record commit whose body contains a cost block and a time block." | diff-local |
| Story 1 negative: Given the branch has no commit at all so the committed record cannot be read, when the shipped-record write runs, then it commits the record exactly once and still exits zero. | 3 | "The unborn-branch fixture produces exactly one shipped-record commit and the command returns zero with no failure line on stderr." | diff-local |
| Story 2 happy: Given a shipped record is already committed and the freshly rendered body differs in its frontmatter PR value or spec hash, when the shipped-record write runs, then it commits the freshly rendered body including its current Cost and Time blocks. | 1, 2 | "The changed-PR fixture produces a second shipped-record commit whose committed body contains the newer dispatch count." | diff-local |
| Story 2 negative: Given a shipped record is already committed and the freshly rendered body differs only in its accepted build-review risk evidence, when the shipped-record write runs, then it commits rather than discarding that evidence as telemetry. | 1, 3 | "The injected accepted-risk fixture produces a second shipped-record commit whose committed body contains the accepted build-review risk section." | diff-local |

## Test dispositions and integration ownership

> **Amended 2026-09-11 by operator approval for #1648:** Preserve the APPROVED cost-rollup ADR and use the correct final total, not the legacy snapshot. Task 4 supersedes the executed tasks' telemetry-insensitive skip rule: changed Cost or Time must commit, and only byte-identical rendered records may skip. Historical tasks stay for attribution; current acceptance is the corrected story.

Task 4 owns the corrective integration and finish acceptance proof. Existing unit projection tests remain historical helper coverage, not authority for the command's skip decision.

All six criteria are diff-local against controlled fixtures. Task 1 owns the pure projection unit cases, which pin which blocks are ignored and which are compared. Task 2 owns the real-git integration for the skip decision, the clean-tree consequence, and the substantive-change path, and it carries the reference-documentation update in the same diff. Task 3 owns the three negative counterpart cases in the same real-git file. The existing shipped-record integration coverage supplies the unchanged stream discipline, degraded-rollup, guide, and write-failure permutations and is not duplicated. No smoke test, no provider call, no network call, and no full conductor run is added, and no terminal validation task is required.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No new decision record and no amendment is required, because the approved per-feature cost-rollup decision fixes the block's contents and its home rather than the commit decision, and the shipment contract for identity, hashing, and evidence is unchanged.

> **Amended 2026-09-11 by operator approval for #1648:** Preserve the APPROVED cost-rollup ADR and use the correct final total, not the legacy snapshot. Task 4 supersedes the executed tasks' telemetry-insensitive skip rule: changed Cost or Time must commit, and only byte-identical rendered records may skip. Historical tasks stay for attribution; current acceptance is the corrected story.

Task 2 -> Task 4
Task 3 -> Task 4

## Verify-Claims Ledger — operator amendment — 2026-09-11

- [verified] The approved cost-rollup ADR's 2026-08-30 amendment requires the finish line and committed Cost to agree.
- [verified] `conductor.ts` emits finish completion before computing `feature_usage_total`, and its terminal refresh invokes `dispatchShippedRecord` directly.
- [verified] The current writer compares projections excluding Cost/Time and restores the older committed bytes; the current finish acceptance test explicitly retains input 10 after finish usage.
- [verified] The existing refresh checks clean state, verifies its new commit, and handles push failure without dispatching another provider.
- Confirmed input: operator approved preserving the correct final total on 2026-09-11. No pending assumptions. Verify-claims verdict: CLEAR.

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/shipped-record.ts:282-315 — delete the dead projectShippedRecordSubstance export and its doc comment; in src/conductor/test/engine/shipped-record.test.ts delete its import (line 13), the whole describe('projectShippedRecordSubstance') block (lines 332-485, including its block-local fields/rollup/metrics/acceptedRisk/appendEvidence helpers), and the now-orphaned appendBuildReviewMetrics import (line 11; used nowhere else in that file); the shipped-record skip/commit decision stays covered by Task 4's daemon-ship integration and finish acceptance tests; re-grep the repo (excluding dist and node_modules) to confirm zero remaining references, then run the shipped-record unit file through ai-conductor scoped-run and commit
**Gate:** as-built
**Rationale:** src/conductor/src/engine/shipped-record.ts:287 exports projectShippedRecordSubstance with no production caller (exact-symbol sweep: only its definition and src/conductor/test/engine/shipped-record.test.ts:13,332,441,482); Task 4 superseded Task 1's skip rule and its Step 2 already removed the only caller's import, so this is ordinary dead-helper cleanup that preserves the approved architecture (the review states no ADR change is needed and that re-wiring the projection would violate the sealed Cost/Time-must-commit outcome). Not existing-task: no active-plan Done when admits the deletion (Task 4 Step 2 explicitly deferred it, Task 1's Done when asserts the helper). Coverage preserved: the command's skip/commit decision is owned by Task 4 Done when 1/4 (daemon-ship integration and feature-usage-total-at-finish acceptance), which the plan amendment names as the authority over the historical projection unit cases, so deleting those unit cases drops no live coverage. Sibling sweep: no other production or docs reference to the symbol exists (README.md and docs/reference/cli.md no longer mention substance comparison); removing the describe block orphans only the test file's appendBuildReviewMetrics import (its other imports stay used outside the block). The production appendBuildReviewMetrics function remains live and is untouched.
**Governing clause:** Task 1
**Parent task:** 1
**Done when:**
- Task 1 is satisfied by this task.
