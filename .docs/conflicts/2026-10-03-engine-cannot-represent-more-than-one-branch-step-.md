# Conflict Check: Stack-aware feature identity and per-child state foundation (#2940)

**Date:** 2026-10-03
**New stories:** `.docs/stories/engine-cannot-represent-more-than-one-branch-step-.md` (10 stories)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASSED. There are zero blocking conflicts. Five degrading conflicts were found, and each was
resolved in the artifacts. Under the operator's standing approval, the recommended option was applied
for each.

## Conflict: Park's shipped-record precondition could mint a feature's ship from a child PR

**Stories involved:** Story 4 "A child branch is attributed to its feature and never acted on as a separate feature" vs "The shipped-record precondition applies only to daemon branches" (reclaim Story 4) and parked-feature reconciliation S2
**Files:** `.docs/stories/engine-cannot-represent-more-than-one-branch-step-.md` vs `.docs/stories/reclaim-merged-feature-worktrees-without-depending.md`, `.docs/stories/parked-feature-reconciliation-1060.md`
**Type:** state-conflict
**Severity:** degrading now; blocking once children exist

**Description:** Story 4 said the precondition "applies as it does for `feat/daemon-x`". Taken
literally, that imports the record-missing arm, which resolves a merged PR by head and requests a
record-only repair (`park-reconciliation.ts:979-1000`). In a stack a child PR merges before the leaf,
so the repair would mint the feature's shipped record from a child PR. That is the false ship
ADR decision 2 forbids.

**Resolution Options:**
1. Evaluate the child refusal before the shipped-record precondition, and let record repair resolve
   PRs only from the leaf head.
2. Also widen the reclaim story's "does not gate other branch kinds" to "non-daemon-owned kinds".
3. Record the ordering in the umbrella ADR.

**Recommendation and resolution:** 1 + 2 + 3, applied.
- Story 4 now states the ordering and adds a no-repair negative path.
- The reclaim story's Done When names daemon-owned kinds.
- ADR decision 2's park bullet records the ordering.

## Conflict: Corrupt kickback ledger, fail-closed vs a stale fail-open story

**Stories involved:** Story 6 "Child state is isolated per child and never written for a feature with no child" vs Story 1 of the gate-kickback-counter feature
**Files:** `.docs/stories/engine-cannot-represent-more-than-one-branch-step-.md` vs `.docs/stories/gate-kickback-counter-resets-every-dispatch-so-no-.md`
**Type:** contradiction
**Severity:** degrading. The old story was already superseded in code by
`adr-2026-08-31-kickback-ledger-read-fails-closed` (`kickback-ledger.ts:711-716`).

**Story opposing sentence (new, verbatim):** "Given a corrupt `children/2/kickback-ledger.json`, when child 2's ledger is read, then the read fails closed with the `kickback ledger is corrupt` reason a corrupt flat ledger produces, naming the child ledger's path, and is never treated as an empty ledger"
**Story opposing sentence (old, verbatim, before correction):** "Then the document is treated as absent, a `console.warn` is emitted, and the run proceeds with a fresh budget rather than crashing the dispatch."

**Resolution Options:**
1. Replace the stale assertion in place with the fail-closed contract.
2. Weaken Story 6. This is rejected, because it would regress `adr-2026-08-31`.

**Recommendation and resolution:** 1, applied in place in the shipped story. A reviewer claimed
Story 6's reason token did not exist in source; it does, at `kickback-ledger.ts:713`.

## Conflict: Tolerant-read clause in the ledger ADR beside the new per-child amendment

**Stories involved:** Story 6 vs ADR: cross-dispatch kickback livelock bound
**Files:** `.docs/stories/engine-cannot-represent-more-than-one-branch-step-.md` vs `.docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md`
**Type:** contradiction
**Severity:** degrading. This is pre-existing corpus drift: `adr-2026-08-31` overrode the clause
without annotating it.
**ADR filename stem:** adr-2026-07-26-cross-dispatch-kickback-livelock-bound
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "**Tolerant read** — missing file → empty ledger; corrupt JSON → `console.warn` + empty; `version !== 1` → treated as absent. Never throws, per `task-evidence.ts:76-111`."
**Story opposing sentence (verbatim):** "Given a corrupt `children/2/kickback-ledger.json`, when child 2's ledger is read, then the read fails closed with the `kickback ledger is corrupt` reason a corrupt flat ledger produces, naming the child ledger's path, and is never treated as an empty ledger"

**Resolution Options:**
1. Extend this spec's D1 amendment note to cite `adr-2026-08-31` D1.
2. Drop the fail-closed criterion. This is rejected.
3. Write a superseding ADR. This is disproportionate.

**Recommendation and resolution:** 1, applied. The note now says a corrupt or version-incompatible
per-child ledger fails closed, and a missing one reads as typed absent.

## Conflict: This spec's amendment notes were invisible to `coverage_binding`

**Parties:** the six `#2940` amendment notes vs `adr-2026-08-31-coverage-binding-judge-step` D18
**Type:** behavioral overlap
**Severity:** degrading
**ADR opposing sentence (verbatim):** "Each `> **Amended YYYY-MM-DD by #N:**` block in the DECIDE set, excluding the plan's own amendments, becomes an amendment claim carrying the artifact path, the amendment text, and every plan task id with its `Done when` checks."

**Description:** The claim extractor matches
`/^> \*\*Amended \d{4}-\d{2}-\d{2} by #\d+:\*\*/` (`coverage-binding-inputs.ts:51`). A parenthetical
before the colon, and the indentation of the two plan-slice notes, defeated it, so the safety net
that checks the plan carries each amendment would not fire.

**Resolution Options:**
1. Reformat the headers to `> **Amended 2026-10-03 by #2940:** (…)` and de-indent them.
2. File an intake for a tolerant parser. 135 of 320 corpus headers already miss the regex.
3. Both.

**Recommendation and resolution:** 3. Option 1 is applied, and all seven headers now match. Option 2
is reported to the operator as a follow-up intake.

## Conflict: `stacked_prs.max_slices` vs the #2723 stories (deferred)

**Parties:** `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 5 vs `.docs/stories/plans-cannot-declare-ordered-slices-of-one-feature.md` Story 1 and Story 6
**Type:** contradiction (ADR-vs-story)
**Severity:** degrading for this ticket. No story here implements the key, and the land bound of 5 is
no greater than the ceiling of 9.
**ADR filename stem:** adr-2026-10-03-stacked-child-plans-identity-and-state
**Story ID:** Story 1; Story 6
**ADR opposing sentence (verbatim):** "The maximum number of slices for stacked delivery is an operator config key, `stacked_prs.max_slices`:"
**Story opposing sentence (verbatim):** "Given a project config whose `stacked_prs` block carries an unknown key `max_slices`, when the project config loads, then loading fails with a validation error naming `max_slices` as an unknown key in `stacked_prs`"

**Resolution:** deferred to #2941. Its DECIDE must replace these #2723 assertions in place, and amend
`adr-2026-09-29-plan-slice-manifest` D8 and the config-key consumer registry, before its plan.
Recorded in the umbrella ADR's follow-ups.

## Gap closed during the check

Intake overlap had no criterion excluding child rows of a shipped feature. Story 4 now carries one.

## Assumptions carried to the plan

- Park's new child refusal reason is emitted through `worktree_reclaim_failed`, per
  `adr-2026-08-01` item 11. This is now in Story 4.
- Rewind's cross-file rollback uses compensating port mutations, as `rollbackRewindState` does today.
  The port has no cross-file atomic batch.
- Golden test files carry no `Covers:` marker, so the test-quality review treats them as regression
  pins, not sensitivity claims.
- The halt-PR leaf probe passes the leaf branch to the existing shipped-record-on-branch check.
- **Release surface:** the `--child` flags live under `src/conductor/src/engine/`, and the release
  gate classifies `bin/conduct CLI` only for the path `bin/conduct`. Following
  `adr-2026-08-01-scoped-run-verb-release-surface`, the implementation needs no migration block and no
  waiver, and must not touch `bin/conduct`, `bin/install`, `hooks/` or `settings*.json`. Its release
  metadata is `note` / `Added` / `minor`.

## Pairs reasoned clean

Both directions were reasoned for each pair, and evidence is in the two review passes:
- Story 7 vs step applicability, auto-resume guard, rewind rollback, rebase-invalidated proof, and
  in-flight prd-audit and as-built verdict families.
- Story 9 vs the kickback inspect renderer and raise authorization.
- Story 8 vs task close, current-task and the #2964 redispatch stories.
- Story 5 vs GitHub ownership enforcement.
- Story 4 vs the overlap stories, the halt-PR and finish stories, and in-flight ref-moving git.
- Stories 1 and 10 vs Pi cost and shipped-record timing.
- Story 6 vs the conduct-state lost-update stories.
- The new stories vs the 11 in-flight daemon features.

**ADR corpus:**
- 336 ADR files examined.
- 9 unambiguously fully superseded ADRs excluded. The partial supersession
  `adr-2026-07-04-operator-park-marker` was retained.
- 50 narrowed in: the six this spec amends, the umbrella ADR, and the branch-identity, park,
  finish/halt-PR, pipeline-state, task-CLI, event-spine, release and authoring ADRs.
- 277 narrowed out for no subject overlap.

## Concurrent-change risks (for the plan)

The in-flight daemon features `plans-that-contradict…`, `step-applicability…`, `new-review-concern…`,
`engine-prompts…` and `pi-runs…` add or extend `ConductorEvent` members. `prd-audit-receives…` and
`as-built-review…` edit rewind verdict clearing.

Golden fixtures must be recorded at the final rebase base, with scenarios free of those paths.
