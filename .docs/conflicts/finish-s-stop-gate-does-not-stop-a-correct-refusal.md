# Conflict Check: FINISH refusal reaches the operator with its reason

**Date:** 2026-08-08
**Feature:** finish-s-stop-gate-does-not-stop-a-correct-refusal (tier M, technical track)
**Stories checked:** `.docs/stories/finish-s-stop-gate-does-not-stop-a-correct-refusal.md`
(Stories 1-5) against the full `.docs/stories/` corpus and the APPROVED ADRs in `.docs/decisions/`
**Result:** PASSED — zero blocking conflicts; one degrading conflict accepted
**Re-checked:** 2026-08-08 against merged `5bbc109e8` (#1372). No new conflict; one row's cited
degradation was restated against the post-#1372 decoder. See the ADR's Amendment section.

## Scope of the Scan

All five conflict types were evaluated: contradiction, behavioral overlap, state conflict, resource
contention, and sequencing. The scan covered the whole `.docs/stories/` corpus, with focused
attention on the FINISH-area neighbours named at invocation:

- `a-successful-finish-publication-transition-consume.md`
- `finish-step-completion-becomes-engine-machinery-re.md`
- `finish-step-fails-try-1-on-every-daemon-ship-skill.md`
- `daemon-false-ship-guard.md`
- `finish-should-rewrite-stale-needs-remediation-titl.md`
- `finish-force-with-lease-after-sanctioned-rebase.md`
- `finish-staleness-grep-never-matches-rebase-finish.md`

Three targeted sweeps were run rather than relying on a reading impression:

1. **Symbol co-occurrence across all stories and plans.** Only two artifacts besides this feature's
   own mention `human_required`, `routeFinishPublicationDisposition`, `isExactDisposition`, or
   `PrProseJudgment`: `a-successful-finish-publication-transition-consume` (stories + plan) and
   `unattended-finish-spends-minutes-before-determinis` (plan). Both are merged specs whose
   implementation is present in current source — `publication_progress` is in the disposition union
   and `resolveInteractivePublicationIntent` exists — so neither is pending work this feature could
   race.
2. **Unmerged spec branches, own-diff only.** Each `origin/spec/*` branch was diffed against
   `origin/main` and only its *own* added `.docs/plans` and `.docs/stories` were searched (a naive
   search matches every branch, since each inherits the full merged `.docs/` history). **Zero**
   unmerged spec branches author an artifact touching `human_required`, `isExactDisposition`,
   `routeFinishPublicationDisposition`, or the PR-prose judgment. Confidence ~90%, basis verified:
   the sweep is exact for artifacts, but a branch could in principle plan such a change in prose
   that names none of the four symbols.
3. **Halt-text assertions.** No existing story anywhere in `.docs/stories/` asserts that a halt
   marker contains a bare reason token (`judgment_refused`, `ambiguous_pr_identity`,
   `invalid_shipped_record`). Story 3's requirement that the halt read as prose therefore
   contradicts no accepted acceptance criterion. Confidence ~95%, basis verified by grep.

## Pairs Reasoned Through (no conflict found)

A clean pass is only honest for pairs actually examined. These are the ones whose interaction was
non-obvious:

| Pair | Interaction | Verdict |
|---|---|---|
| Story 3 vs `a-successful-finish-publication-transition-consume` ("Given a `human_required` disposition, when it is routed, then it still halts and is not consumed as progress") | Both require `human_required` to halt. Story 3 changes only the halt's *text*, never its routing, and its negative path explicitly requires the other four route arms to stay byte-identical. | Reinforcing, not conflicting |
| Story 1 vs the same spec's widening of `isExactDisposition` for `publication_progress` | Both touch the guard, but on disjoint arms: that work enrolled a new disposition *kind*; Story 1 widens the existing `human_required` arm's key set. The exact-key discipline is preserved by both. | No contradiction |
| Story 3 vs `finish-step-completion-becomes-engine-machinery-re` (completion is engine-owned, not prompt-owned) | Story 3 moves rendering *into* the engine router and forbids a `conductor.ts` diff, which strengthens the engine-ownership assertion rather than eroding it. | Aligned |
| Story 5 vs `finish-step-fails-try-1-on-every-daemon-ship-skill` (finish must not fail try 1 spuriously) | Story 5 adds a provider capability and removes no fail-closed behavior; its negative paths pin the existing degradations (`provider_unavailable` → `publication_retry`, unstructured prose → `malformed_response` → `publication_retry`) in place. Re-checked 2026-08-08 against merged `5bbc109e8` (#1372): unstructured prose no longer halts at all, so the story is even further from causing a spurious try-1 failure than when this row was written. | No regression |
| Story 4 vs `daemon-false-ship-guard` (a ship must be a verified `pr` outcome) | Story 4 touches only the refusal arms' `detail` payload. Its final negative path explicitly forbids reclassifying `timed_out` / `provider_unavailable`, so no disposition changes ship-eligibility. | No state conflict |
| Stories 1-5 internally | Sequencing runs 1 → 2 → 3 (type, then map, then render) with 4 and 5 independent of each other. No circular dependency: Story 1's guard change does not require the map, and Story 5's documentation does not require Story 4's `detail` plumbing to exist first. | No sequencing conflict |

## Degrading Conflict (accepted)

### Conflict: File-level contention on `finish-publication.ts`

**Stories involved:** all five, versus roughly 29 unmerged `origin/spec/*` branches
**Files:** `src/conductor/src/engine/finish-publication.ts`
**Type:** resource-contention
**Severity:** degrading

**Description:** The advisory `conduct-ts overlap-scan` recorded in the architecture review reports
~29 unmerged spec branches declaring this file. Sweep 2 above establishes that **none** of them
contends for the same *semantics* — no pending spec plans to change the disposition union, the
guard, the router, or the judgment decoder. The contention is therefore textual: concurrent edits to
one large module that git must reconcile, not two features asserting incompatible behavior.

Left unaddressed this costs rebase time and raises the chance of a mis-resolved conflict in a hot
file; it cannot produce a wrong behavior that the type system and tests would not catch.

**Resolution Options:**
1. Accept the contention; keep the diff additive and tight so conflicts resolve cleanly.
2. Extract the reason map and rendering into a new sibling module (e.g. `finish-halt-reasons.ts`)
   so the bulk of the diff lands outside the contended file.
3. Sequence this feature behind the other finish-touching specs.

**Recommendation:** Option 1, with Option 2 available to the plan as a tactic rather than a
requirement. Option 3 trades a real fix for a scheduling delay against branches that do not
semantically conflict. Option 2 is genuinely attractive — it would shrink the contended diff — but
mandating it here would pre-empt `/plan`'s file layout decision on evidence that does not require it;
the ADR's chosen seam is the router arm, and the map can live beside it or next door without
changing any acceptance criterion.

**Accepted:** the plan should prefer additive edits and MAY split the map into a sibling module at
its discretion. No story changes.

## Blocking Conflicts

None.

## Resolutions Applied

None required. No story was amended, no ADR was superseded, and no kickback to `prd` or
`architecture` was warranted — no blocking conflict was rooted upstream because no blocking conflict
was found.

## Re-Check

Not required: the first pass found zero blocking conflicts and no story text changed, so a re-run
would evaluate an identical corpus.
