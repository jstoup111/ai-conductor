# Conflict Check: Inline Build-Work Attribution Enforcement (#505)

**Date:** 2026-07-10
**New stories:** .docs/stories/inline-build-work-commits-unattributed-session-hoo.md (8 stories)
**Scanned against:** all .docs/stories/ files on current main, active specs, open spec PRs
**Result:** PASSED — zero blocking conflicts; one degrading overlap resolved by conditioning

## Conflict: Untrailered non-empty commits — "passes" vs "rejected"

**Stories involved:** #452 "prepare-commit-msg abstain scenarios" vs new "commit-msg rejects
unattributed content commits during a build (Surface A)"
**Files:** .docs/stories/deterministic-evidence-attribution.md (lines 118–120, Done When
"untrailered non-empty commit passes") vs .docs/stories/inline-build-work-commits-unattributed-session-hoo.md
**Type:** behavioral overlap
**Severity:** degrading (resolved)

**Description:** The #452 stories assert an untrailered non-empty commit lands ("commit not
blocked", "untrailered non-empty commit passes"). Surface A rejects exactly that commit. Both
cannot be unconditionally true. They ARE compatible once conditioned on the enforcement
predicate: #452's text describes behavior with enforcement inactive (the default —
`attribution_enforcement_cutover` unset/future, or outside an active build step); Surface A
applies only when the predicate holds. The new stories already encode both states; the old
file did not.

**Resolution applied (option 1, least disruptive):** scope note added to
deterministic-evidence-attribution.md under the abstain scenarios, stating that abstain
governs the stamping hook (unchanged, never blocks) while landing is now conditional on the
enforcement predicate, citing adr-2026-07-10-inline-work-attribution-enforcement. #452's
shipped tests remain green (they run with enforcement inactive). No ADR superseded — the new
ADR explicitly narrows and documents this interaction.

## Verified clean pairs (reasoned, not assumed)

- **#489/#494 session-hook stories** — Story 6 constrains the POST hook to "validated stamp
  removal only"; the new dispatch-count sentinel is added to the PRE hook, which carries no
  side-effect exclusivity claim (checked lines 98–101, 193, 211). Additive; no conflict.
  (confidence: verified, grep + read)
- **#481 evidence-derivation stories** — no closed-enum claim about `noEvidenceAttempts`
  reasons; zero-work kickback's reuse is additive and completion authority is untouched.
  (verified)
- **#459/#476 stall remediation** — disjoint trigger predicates: remediation routes sessions
  that WROTE a halt marker; the zero-work net fires only when NO halt marker exists. The new
  stories carry an explicit no-double-processing scenario. (verified)
- **Sequencing/state** — the marker lifecycle story runs entirely inside existing build-step
  entry/exit seams; no story assumes it runs before/after another feature's machinery.
- **Resource contention with unmerged work** — open spec PRs (#500 parallel-validation, #495
  issue-close-on-observation, #335, #323, #267, #151) touch none of git-hook-assets.ts /
  session-hook-assets.ts / worktree-prepare.ts. #485 (trailer normalization) and #499
  (finish-step machinery) are claimed/named but unspecced — no branch to contend with; the
  ADR documents coexistence with #485's future scope. (verified via gh pr list)

## Accepted compromises

The Surface A / #452 conditioning above is the only degrading item; it is fully resolved by
the scope note plus the cutover default (off), so no functional compromise remains at merge
time. Operators opting into enforcement change the documented behavior deliberately.
