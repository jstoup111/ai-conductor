# Conflict Check: Automatic rebase preserves merges carrying unique content

**Date:** 2026-09-29
**Stories checked:** `.docs/stories/automatic-rebase-preserves-merges-carrying-unique-.md` (Stories 1–9) against every rebase-area story in `.docs/stories/`
**ADR corpus:** `repo_wide`
- **Examined:** all 325 `adr-*.md` files, keyword-swept.
- **Narrowed to the 16 ADRs whose subject overlaps these stories:**
  - adr-2026-06-29-rebase-conflict-resolution-dispatch
  - adr-2026-07-12-rebase-evidence-stamp-translation
  - adr-2026-09-11-selective-post-rebase-verification
  - adr-2026-07-26-event-sink-registry-exhaustiveness
  - adr-2026-08-11-halt-events-ride-the-persisted-spine
  - adr-2026-07-03-post-rebase-force-with-lease
  - adr-2026-09-23-engine-git-guard-on-agent-path
  - adr-2026-07-26-rebase-tail-current-branch-before-publication
  - adr-2026-08-01-rebase-full-replay-intent-validation
  - adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
  - adr-2026-07-04-resolution-worktree-lifecycle
  - adr-2026-07-08-post-rebase-gate-first-mechanical-reverify
  - adr-2026-07-20-post-rebase-delta-aware-invalidation
  - adr-2026-08-13-durable-base-advance-attribution
  - adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence
  - adr-2026-07-10-inline-work-attribution-enforcement
- **Narrowed out** (subject does not overlap): the remaining ADRs, including halt-based-release-gates, operator-park, cross-dispatch kickback livelock bound, origin-refresh-before-engine-rebuild, and gh-cli-version-floor. No ADR was excluded for supersession.

**Result:** 1 blocking conflict and 1 degrading conflict resolved; 2 degrading conflicts accepted. Re-check: clean (zero blocking).

## Conflict: A pre-mutation flatten refusal would be dispatched to the rebase resolver

**Stories involved:** Story 4 (first draft) vs Story FR-1
**Files:** [.docs/stories/automatic-rebase-preserves-merges-carrying-unique-.md] vs [.docs/stories/rebase-resolution-skill.md]
**Type:** state-conflict
**Severity:** blocking

**Description:** The first draft of Story 4 returned `conflict_halt` "without issuing any rebase command". FR-1 dispatches the resolver for every `conflict_halt` returned by `performRebase`, and `resolveRebaseConflictsInner` has no guard for missing rebase state (verified in source). The resolver would therefore run against a clean worktree and would be told to `--continue` a rebase that does not exist.

**Resolution Options:**
1. Return a distinct `flatten_refused` outcome kind that callers HALT on without resolver dispatch.
2. Keep `conflict_halt` with `startFailure` and add a skip rule, which requires amending FR-1 in a companion story PR.

**Resolution (operator):** Option 1. ADR D5 now defines `flatten_refused`, Story 4 was replaced in place, and FR-1 is untouched because it still governs `conflict_halt`.

## Conflict: The open-PR autoresolve path keeps its own linear rebase

**Stories involved:** Story 2 and Story 6 vs the work-preservation guards story
**Files:** [.docs/stories/automatic-rebase-preserves-merges-carrying-unique-.md] vs [.docs/stories/auto-resolve-open-pr-conflicts.md]
**Type:** overlap
**Severity:** degrading

**Description:** `autoresolve.ts` issues its own `git rebase --autostash <baseRef>` and builds its own FR-9 subject list. A merge-bearing PR branch would therefore still fail with add/add conflicts on that path, and two copies of the replay decision would drift.

**Resolution (operator):** Bring autoresolve into scope through one shared primitive (ADR D8), and add Story 9 and a Story 6 criterion. The existing guards story's phrase "every pre-rebase feature commit subject" is narrowed on flattened replays by amendment D2 of adr-2026-06-29-rebase-conflict-resolution-dispatch. That story text is accepted as-is (degrading) rather than edited from this spec, because the amendment governs.

## Conflict: Absorption mapping vs "dropped commits go to residue"

**Stories involved:** Story 7 vs Story 7 and Story 1
**Files:** [.docs/stories/automatic-rebase-preserves-merges-carrying-unique-.md] vs [.docs/stories/rebase-orphans-every-sha-anchored-evidence-citatio.md]
**Type:** overlap
**Severity:** degrading (accepted)

**Description:** The existing story writes a dropped pre-image commit to residue, "**not** silently repointed". The new Story 7 maps merge and side-lineage shas to their absorption point. Amendment D10 of adr-2026-07-12-rebase-evidence-stamp-translation governs, following the same pattern as the #2462 successor rule (D7), which already coexists with that text. The repointing is explicit, engine-recorded, and never silent. Story 7 now asserts that absorbed shas never appear in residue.

## Sequencing notes resolved in stories

- **Untracked-collision heal retry** (`heal-pre-rebase-untracked-file-collisions-and-park.md`): the retry reissues the flattened todo (Story 5).
- **Already-current and mergeable-skip branches** (`phase-9.0-rebase-on-latest.md`, `mergeability-first-finish.md`): these never flatten (Story 1).
- **Seal left unrotated on a halt** (`2026-07-26-rebased-features-stale-protected-artifact-seal-976.md`): `flatten_refused` leaves the seal unrotated (Story 4).

## Examined and compatible

- rebase-reopens-completed-repair-tasks-against-stal
- finish-force-with-lease-after-sanctioned-rebase
- finish-staleness-grep-never-matches-rebase-finish
- name-the-missing-feature-content-when-the-rebase-g
- rebase-full-replay-intent-validation
- rebase-resolution-followup
- manual-rebase-strands-protected-artifact-seal
- daemon-halt-reconciliation
- deterministic-evidence-attribution
- post-rebase-invalidation-re-runs-every-judged-gate
- file-changing-rebase-rewinds-past-test-suite-and-r
- block-bare-force-pushes-inside-compound-commands
- destructive-git-prevention-is-absent-in-self-host

Oscillation check: no pair fails in both directions.
