# Conflict Check: Automatic park outcome writes no park marker

**Date:** 2026-08-06
**Slug:** automatic-park-outcome-writes-no-park-marker-so-an
**Stories checked:** `.docs/stories/automatic-park-outcome-writes-no-park-marker-so-an.md`
(Stories 1–6) against every existing park-producing and park-consuming path in
`src/conductor/src/engine/`, plus the accepted stories already in `.docs/stories/`.
**Result:** PASSED — 0 blocking, 2 degrading (both resolved by narrowing story text), 1 advisory.

## Scope of the scan

All five conflict types were evaluated pairwise across Stories 1–6 and against the existing
park surface. The park surface is the real contention risk for this feature, so it was enumerated
explicitly rather than sampled:

**Producers of `.daemon/parked/<slug>`:** `daemon-park-cli.ts` (operator park/unpark),
`daemon-auto-park.ts` (empty/missing-plan park, carrying the #612 contradiction guard),
`park-marker.ts` (the writers themselves), and — new in this change — the `daemon-runner.ts`
termination boundary.

**Consumers:** `daemon-backlog.ts:846` (dispatch eligibility), `daemon-rekick.ts:132` (re-kick
skip), `park-reconciliation.ts` (sweep, classification, provenance, cleanup authority),
`daemon-dashboard.ts` (rendering).

Story pairs within this feature were checked for internal contradiction first. Stories 1 and 4
are the load-bearing pair — one asserts a marker is written, the other that no marker is written —
and they do not contradict because they are disjoint on the termination site, which the ADR fixes
as an explicit caller-supplied intent rather than something inferred from `status`. Confidence
this partition is unambiguous: 90%, verified against the four call sites. Stories 3 and 2 were
checked for a wording conflict (both constrain the HALT note's first line) and are disjoint on the
marker-write outcome. Story 6 restates Story 1's exclusion under restart and worktree-loss
conditions; that is reinforcement, not overlap.

## Degrading 1: reconciliation classification can report the park as orphaned, not parked

**Stories involved:** Story 5 (happy path) vs. existing `park-reconciliation.ts` behavior
**Files:** `.docs/stories/automatic-park-outcome-writes-no-park-marker-so-an.md` vs.
`src/conductor/src/engine/park-reconciliation.ts:424-479`
**Type:** state-conflict
**Severity:** degrading

**Description.** Story 5's happy path asserts the sweep's summary line reports a `parked` count
including the newly parked slug. The sweep does not classify solely on marker presence. For a slug
that is not merged, it reads `.docs/intake/<slug>.md`, parses `Source-Ref`, and calls
`getIssueState`. When the originating issue is **CLOSED**, classification is `orphan`, and the
counter chain at `:477-479` is exclusive: `orphan` increments `orphaned` and **skips** `parked`.
A setup failure on a feature whose intake issue was already closed would therefore log
`orphaned=1 parked=0` — which is not the assertion Story 5 makes.

This is degrading rather than blocking: the marker still exists, dispatch is still suppressed, and
outcomes 1, 4 and 5 are untouched. Only the reporting assertion in outcome 3 is affected, and the
`orphaned` line is itself an accurate operator signal ("this park needs review").

**Resolution options.**
1. Narrow Story 5's happy path to the open-issue case and add the closed-issue case as an explicit
   negative path asserting `orphaned`, so the story matches real classification behavior.
2. Change the counter chain so `parked` counts every marker regardless of classification.
3. Suppress orphan classification for markers whose body begins `auto-parked:`.

**Recommendation and resolution: Option 1.** Options 2 and 3 change an existing, unrelated
reporting contract to satisfy a story written for a different purpose — scope creep into a
subsystem this feature is not chartered to change, and option 2 would double-count against
`orphaned` in the same line. Story 5 has been amended accordingly.

## Degrading 2: a zero-commit feature branch makes the sweep emit a spurious `deferred`

**Stories involved:** Story 5 (happy path) vs. existing merged-park cleanup path
**Files:** `.docs/stories/automatic-park-outcome-writes-no-park-marker-so-an.md` vs.
`src/conductor/src/engine/park-reconciliation.ts:425-476, :608`
**Type:** resource-contention
**Severity:** degrading

**Description.** A setup failure occurs before any build work, so `feat/daemon-<slug>` points at
the base-branch tip with no commits of its own. `gatherMergeEvidence` asks `isContainedInMain` per
branch, and a branch containing no unique commits is contained in main — so `mergedBranches` is
non-empty and `isMerged(evidence)` is true. Classification becomes `merged`, and with
`autoCleanup` defaulting to true the sweep calls `reconcileMergedPark` for a feature that never
shipped.

**This does not delete the park.** `reconcileMergedPark:608` returns
`{ refusal: 'record-missing', deferred: true }` before touching the marker, worktree, or branch,
because `evidence.shippedRecordOnMain` is false — no `.docs/shipped/<slug>.md` exists on main.
The sweep records `deferred++`. Separately, the `merged` classification falls through the
`orphan`/`unclassified` chain to the `else` at `:479`, so `parked` **is** still incremented and
Story 5's core assertion holds. Confidence in the no-deletion conclusion: 90%, verified by reading
the guard; the residual uncertainty is whether `isContainedInMain` returns true for a zero-commit
branch, which is inferred from git ancestry semantics rather than observed (~85%).

The user-visible cost is a recurring `deferred=1` and its "next:" guidance on every idle sweep for
as long as the feature stays parked — log noise attached to a feature that is correctly parked.

**Resolution options.**
1. Accept the noise; note it in the story so an implementer does not read `deferred` as a defect,
   and leave the cleanup-authority question to the work already specced for it.
2. Make `gatherMergeEvidence` treat a zero-commit branch as not-merged.
3. Have the boundary skip parking when the branch has no commits.

**Recommendation and resolution: Option 1, accepted as a known compromise.** Option 3 would
reintroduce the exact loop this feature exists to close — a setup failure is *precisely* the
zero-commit case. Option 2 changes merge-evidence semantics for every caller, and that surface is
already being reworked by unmerged spec work (see Advisory below); changing it here would collide.
Story 5 now carries a negative path pinning that the marker survives a sweep that classifies the
park as merged-but-record-missing, which is the assertion that actually protects the fix.

## Checked and clean

- **Third automatic park producer (contention with `daemon-auto-park.ts`).** No conflict. The two
  fire at disjoint points: `daemon-auto-park` parks when a plan is empty or missing at seed time;
  this boundary parks when triage resolves to `park` after a setup failure, which happens before
  the plan is ever read. Neither can overwrite the other's reason regardless, because
  `writeAutoPark` opens with `wx` and no-ops on `EEXIST` — the first reason wins and is preserved.
  The #612 contradiction guard is scoped to plan emptiness versus completion evidence and has no
  input to offer at a setup-failure boundary, so routing through it (rather than through
  `park-marker.ts` directly, as the ADR specifies) would add a check that cannot apply.
- **HALT-based and marker-based suppression disagreeing.** No conflict, and the precedence is
  already explicit in the existing code. `daemon.ts:137-139` checks the operator park *ahead* of
  the HALT check and documents that it is "never lifted by a cleared HALT marker — only an explicit
  un-park makes the slug eligible again." `daemon-rekick.ts:132` likewise checks the park first and
  unconditionally, ahead of `isProcessed` and the SHA guard. So an operator who clears
  `.pipeline/HALT` expecting re-dispatch is correctly still blocked, which is the designed
  behavior for a park, not a regression. Story 5's negative path pins that the re-kick sweep leaves
  the HALT intact rather than clearing it and stranding the marker.
- **Concurrent terminations.** No contention. Markers are per-slug filenames under one directory;
  `writeAutoPark` creates the directory with `recursive: true` and opens the file exclusively.
  Story 1 covers the concurrent-different-slugs case.
- **Sequencing.** No circularity. The boundary writes the marker; every consumer reads it on a
  later scan. No consumer writes state the boundary reads.
- **Against existing accepted stories.** No story in `.docs/stories/` asserts that an errored
  daemon feature is re-dispatched, or that `.daemon/parked/` is written only by an operator. The
  nearest neighbours concern HALT handling and re-kick behavior and are untouched by this change.

## Advisory: unmerged dependent work

`conduct-ts overlap-scan` reports ~14 unmerged spec branches touching
`src/conductor/src/engine/daemon-runner.ts`. Two are park-adjacent and were inspected directly:

- `origin/spec/parked-feature-cleanup-can-never-fire-for-squash-m` — spec-only (10 files, all
  `.docs/`), no code. It carries `adr-2026-08-01-multi-proof-park-deletion-authority`, which
  reworks the merge-proof requirement that today's `record-missing` refusal rests on. **If that
  work lands first, re-verify Degrading 2's no-deletion conclusion**: this fix's safety currently
  depends on `reconcileMergedPark` refusing without a shipped record on main. Not a structural
  conflict today — no code overlaps — but it is the one interaction worth re-checking at BUILD.
- `origin/spec/tests-leak-fixture-slugs-into-the-parked-feature-l` — spec-only (5 files, all
  `.docs/`), concerns test fixtures writing into the real parked ledger. No structural conflict;
  if anything it is complementary, since this feature adds a new production writer to that ledger
  and its tests must not leak into it either.

Neither branch contains code, so neither can conflict textually with this feature's diff today.
The remaining twelve overlap on `daemon-runner.ts` generally; the termination boundary is a
localized region of that file, and no inspected branch redefines it.

## Review signal

Degrading conflicts were found and accepted, so
`.pipeline/review-required-conflict_check` is written for this run.
