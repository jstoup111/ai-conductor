# Conflict Check: Provenance-based protected-artifact seal rotation (#1229)

**Date:** 2026-08-09
**Stories checked:** `.docs/stories/manual-rebase-strands-protected-artifact-seal.md` (Stories 1-8)
**Checked against:** `.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md` (#1281,
merged spec, unbuilt), `adr-2026-07-26-protected-artifact-seal-rebaseline`,
`adr-2026-08-09-operator-only-scoped-artifact-reseal`,
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`, and the #976 / #1047
base-inheritance tolerance on the inspection path.

**Result:** 1 degrading conflict, resolved. 0 blocking conflicts.

## Conflict 1: Both features assert the existing violation test suite is invariant, but this one must re-scope a decision-table case

**Stories involved:** #1229 Story 2 ("A protected artifact this feature changed still refuses
rotation and halts") vs #1281 Story 8 ("Prove the tamper-detection boundary is unweakened")
**Files:** `.docs/stories/manual-rebase-strands-protected-artifact-seal.md` vs
`.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md`
**Type:** contradiction (sequencing-sensitive)
**Severity:** degrading

**Description.**

#1281 Story 8's Done When requires: "The existing verification test suite for protected-artifact
violations passes unchanged, with no assertion relaxed or removed, verified by diff review."
#1229 Story 2's Done When, as originally written, made the same claim: "Every pre-existing
protected-artifact violation test passes with no assertion relaxed, removed, or re-scoped."

That claim is false for #1229, verified directly against the current test file (98% confidence,
read at this HEAD). `src/conductor/test/engine/protected-artifact-seal.test.ts:232` supplies
`baseTipArtifacts: new Map([[path, baseBytes]])` against a workspace and HEAD that agree, and
line 244 pins the expected verdict `{ permitted: false, condition: 'head-differs-from-base', path }`.
That input supplies no authorship, so under the corrected predicate its verdict is no longer
determined by the blob contents alone — the case must gain an explicit authorship input, and its
expected verdict depends on which value is supplied. The assertion cannot survive unchanged.

This is not a design conflict. It is the intended, approved behavior change of
`adr-2026-08-09-seal-rotation-authorship-predicate` colliding with an over-broad invariance claim
that #1229 Story 2 should never have made. Both features genuinely intend the same thing — that
real violations keep halting — and neither's design opposes the other's.

Directionality was checked both ways, per the oscillation heuristic. Satisfying #1281 fully does
**not** permanently prevent satisfying #1229, and satisfying #1229 does not re-break #1281 once
#1281 has landed: each feature's diff-review assertion is evaluated against its own diff, at its
own build time. The contradiction exists only if the two are read as claims about a single shared
tree at a single moment. This is therefore an ordinary sequencing-sensitive contradiction, not an
oscillation.

**Resolution options.**

1. Narrow #1229 Story 2's Done When to state precisely which existing assertions are invariant and
   which single decision-table case gains an authorship input, and record the ordering decision.
   Least disruptive; changes no design and no #1281 artifact.
2. Amend #1281 Story 8's Done When to exempt assertions superseded by a later approved ADR.
   Rejected: #1281 is a merged spec whose stories are accepted, and its claim is correct *for its
   own diff*. Weakening a tamper-boundary invariance claim to accommodate a feature that has not
   been built is the wrong direction.
3. Fold both features into one spec so the invariance claim is evaluated once. Rejected: they are
   independently valuable, independently sized, and #1281 is already specced and merged.

**Recommendation: Option 1** — the defect is in #1229's story phrasing, not in either design.

**Applied.** #1229 Story 2's Done When has been amended in place with an additive amendment note
(the original assertion is preserved). No #1281 artifact was modified. No ADR was superseded.

## Ordering decision (architecture-review Condition 5)

**#1281 lands first; #1229 rebases onto it.** Recorded here as the explicit decision the
architecture review required.

Rationale:

- The two are **complementary, not overlapping in purpose**. `conduct reseal` is an interactive,
  operator-only recovery command, hard-gated to a terminal with no bypass (#1281 Story 5). It cannot
  satisfy #1229's outcomes (1) and (5), which require recovery with *no* operator intervention.
  #1229 removes the class of halts that never needed a human; #1281 gives the remaining, genuine
  halts an audited human resolution. Neither substitutes for the other.
- **No function-level overlap.** #1281 Tasks 2-7 restructure `rotateProtectedArtifactSeal` into a
  shared writer plus a parameterised seal-computation head, and add a scoped head gated on
  `inspectSeal`'s classification. #1229 changes `evaluateProtectedArtifactSealRotation`,
  `rotationRefusalVerdict`/`rotationRefusalPreservesInspection`, and `emitRotationRefusal`. Disjoint
  functions in a shared file — a textual merge surface, not a semantic one.
- **The ordering resolves Conflict 1 cleanly.** #1281's invariance claim is then evaluated against a
  tree that predates the predicate correction, so it holds literally.
- **#1281's Task 6 reinforces #1229's design** rather than contending with it: it delegates drift
  classification to `inspectSeal` rather than re-deriving it, which is the same "one definition of
  provenance" principle `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` applies from
  the rotation side.

If #1229 is built first instead, the only consequence is that #1281's Task 1 characterization test
and Task 20 diff review must be authored against the corrected predicate. That is a larger cost than
rebasing #1229, which is why the recommended order is as stated.

## Pairs checked clean

**#1229 Stories 1-8 against each other.** No pair contradicts. Stories 1 and 2 partition the same
decision by authorship value and are complementary by construction — Story 1's happy path is
precisely Story 2's excluded case. Story 3 (indeterminate) is the third, disjoint branch of the same
partition; satisfying it fully leaves both others intact, and neither of them asserts anything about
indeterminate inputs. Story 5's non-escalation is scoped to refusal *classes* that Story 2's
feature-authored class is explicitly excluded from, checked in both directions: fully satisfying
Story 5 leaves Story 2's halt intact, and fully satisfying Story 2 leaves Story 5's environmental
non-escalation intact. Stories 4, 6, and 7 touch structure, telemetry, and an audit path list
respectively, and assert nothing about the rotation verdict itself.

**#1229 against `adr-2026-07-26-protected-artifact-seal-rebaseline` (APPROVED).** Decision item 2 is
amended additively, with the note recorded in that ADR beside the original assertion and the
corrected predicate carried by `adr-2026-08-09-seal-rotation-authorship-predicate`. Items 1, 3, and 4
are untouched and are not contradicted by any story here. No supersede is required, because three of
that ADR's four decisions remain correct.

**#1229 against the #976 / #1047 inspection-path tolerance.** No story here changes `inspectSeal`, its
new-path tolerance, its self-amendment reporting, or `branchUntouchedInheritance`'s behavior. Story 4
requires the authorship probe be *derived from* that same predicate rather than duplicated, which
strengthens rather than contradicts it. Story 8's negative variants assert the inspection path's
existing halts still fire.

**#1229 telemetry against `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` (APPROVED).**
No resource contention. #1281 adds two new `ConductorEvent` variants for reseal; #1229 adds fields to
two existing rotation variants. Different variants, same spine, both consistent with the event-spine
principle. Neither claims exclusive ownership of the sink table.

**#1229 Story 7 against #1281 Story 1.** Story 7 changes the *directory list* `translateAfterRebase`
diffs to build the `rebaselines[]` audit entry. #1281 Story 1 pins the shared writer's persistence
behavior, including that a rotation's recorded `paths` round-trip faithfully. Story 7 changes what is
*supplied* as `paths`; Story 1 constrains how a supplied `paths` is *persisted*. Checked in both
directions: satisfying either leaves the other intact.

## Advisory note (not a conflict)

`conduct-ts overlap-scan` reported roughly 29 spec branches overlapping
`src/conductor/src/engine/protected-artifact-seal.ts`. Spec branches carry only `.docs/` commits, so
these are stale-branch merge-base artifacts rather than concurrent edits to that file. Recorded so a
later reader does not mistake the volume for risk. #1281 is the one genuine overlap and is resolved
above.
