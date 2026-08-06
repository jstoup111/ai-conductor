# Conflict Check: Blocked merged specs are visible, never skipped (#1330)

**Date:** 2026-08-05
**Stories:** `.docs/stories/annotated-stories-line-makes-a-merged-spec-silentl.md`
**Scope compared against:** accepted stories on the default branch that touch
`plan-stories-reference.ts`, `daemon-backlog.ts`, `daemon-dashboard.ts`,
`daemon-observe-cli.ts`, and `engineer/land-spec.ts`, plus the open spec PRs
(#1286, #1262, #1239, #890) and the open implementation PRs (#1324, #1319, #1190, #1168).

**Verdict:** Clean — no blocking conflicts. Four degrading items, each resolved below.

## Blocking conflicts

None.

## Degrading 1: Dashboard group set and precedence chain

**Stories:** new Story 4 ("dashboard renders a BLOCKED group") vs. the accepted stories for
`surface-owner-gated-specs-dashboard-status` (GATED group, "each spec in exactly one
bucket"), `dependency-ordered-intake-and-dispatch` (WAITING group), `daemon-lifecycle-controls`
(PARKED absolute precedence), and `parked-feature-reconciliation` (RETAINED WORKTREES).
**Type:** resource contention on `renderDashboard` plus bucket precedence.
**Severity:** degrading.

Each of those stories describes the group set of its own era, and each has additively
extended the chain since. Story 4 extends it once more. The full chain is therefore pinned
explicitly in `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` and asserted by the
one-bucket invariant test, rather than left to whichever story merged last.

**Resolution:** accepted; precedence pinned in the ADR and the plan, one-bucket invariant
extended to cover BLOCKED.

## Degrading 2: `discoverBacklog` return shape and gauntlet ordering

**Stories:** new Stories 2 and 3 vs. `surface-owner-gated-specs-dashboard-status` (added
`gated`), `dependency-ordered-intake-and-dispatch` (added `waiting`),
`committed-shipped-record-dispatch-dedup` (added the shipped-record checks whose halves this
change separates), and `daemon-decide-phase-coherence-ownership` (added the coherence check
being classified).
**Type:** resource contention on one function that four shipped features have each extended.
**Severity:** degrading.

The additive `blocked` member follows the same pattern as `gated` and `waiting`, so the
shape change is conventional. The *reordering* is the genuinely new risk, and it is the one
thing the shipped-record dedup story could be read as owning: it placed content-hash dedup
after content vetting deliberately, because the hash needs stories content.
`adr-2026-08-05-blocked-classification-after-dedup` preserves that placement and moves only
the stem-match and processed checks earlier, both of which are pure `continue` branches.

**Resolution:** accepted; the two dedup halves stay split with an in-code comment recording
why, and Story 3's negative path asserts the eligible set is unchanged.

## Degrading 3: Stories-reference resolution ownership

**Stories:** new Story 1 and Story 6 vs. the accepted stories behind
`fix(engineer): unify plan stories reference resolution` (#1222, merged 2026-07-31), which
established `resolvePlanStoriesPath` as the single authority shared by land and discovery and
added the Windows-absolute refusals.
**Type:** contradiction risk — that work's intent was to make land and discovery agree, and a
relaxation could be read as reopening it.
**Severity:** degrading; on inspection, none.

This change keeps the single-authority property exactly: normalization is added inside the
shared resolver, so land and discovery relax together (Story 6 happy path asserts this). All
refusals that work added — Windows drive-absolute, UNC, traversal, non-`.md` — are preserved
verbatim by Story 1's negative paths.

**Resolution:** none needed; Story 1 and Story 6 are additive to #1222's contract and
explicitly re-assert its negative paths.

## Degrading 4: Overlapping DECIDE-time plan validation

**Stories:** new Story 6 (land names the accepted reference forms, `/plan` documents them) vs.
open PR #1190 (`Wired-into:` anchor validation at DECIDE time).
**Type:** resource contention on `land-spec.ts` assertions and the `/plan` skill document.
**Severity:** degrading.

Both add a DECIDE-time assertion and a `/plan` documentation paragraph, on different subjects
(`Wired-into:` anchors vs. the `**Stories:**` reference). No assertion contradicts the other;
whichever merges second reconciles the surrounding test file and skill section.

**Resolution:** accepted; last-to-merge reconciles. No design change.

## Checked and non-conflicting

- **#1286** (autonomous runs fail closed on an ambiguous DECIDE entry) operates on the
  conductor's step-navigation seams and HALT payload contract, not on backlog discovery or
  the dashboard. Its "fail closed" posture is consistent with, and unaffected by, blocked
  classification, which never dispatches anything.
- **#1324, #1319** are remediation branches on release-gate and e2e-agent surfaces; no shared
  files.
- **#1168** (Cursor provider) touches provider selection only.
- **#1262, #1239, #890** are unbuilt spec PRs on pipeline scope review, build review, and
  trailer scanning; none touches the five files above.
- The four existing `merged spec cannot build — …` log lines are preserved verbatim (PRD
  FR-9), so no runbook or operator grep that depends on their wording is disturbed.
