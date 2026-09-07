# Complexity: Operator-configurable confidence floor for acting on build_review findings

Tier: M

Rationale: Six coordinated production surfaces, none individually large, forming one contract change
that must land atomically.

> **Amended 2026-09-06 by #2383:** The operator moved confidence from the adjudicator's case record
> to the rubric finding after architecture-review established that the adjudicator placement could
> not stop the per-lap remediate re-dispatch. The surface list below replaces the earlier one; the
> tier is unchanged at M.

- `src/conductor/src/engine/build-review-domain.ts` — `BuildReviewFinding` gains an optional
  integer `confidence` 0-100, validated in the finding parser; out of range is a malformed result
  like any other invalid field. It is deliberately absent from
  `build-review-finding-identity.ts`, so it never enters the identity hash.
- `src/conductor/src/engine/config.ts` and `resolved-config.ts` — per-rubric
  `build_review.rubrics.<id>.min_confidence` (integer 0-100, default 0) joins the existing rubric
  policy key set and validator, following the bounded-integer shape `build_review.maxParallel` uses.
- `src/conductor/src/engine/build-review-aggregate.ts` (`deriveEffectiveBuildReviewVerdict`) — a
  third `suppressed` bucket beside `accepted` and `unresolved`; the verdict formula is unchanged.
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — suppressed findings are
  excluded from adjudication sources, and a settled-recurrence predicate skips the judge when every
  live source binds by exact id to a finalized deferred, rejected, or merged case.
- `src/conductor/src/types/events.ts` — `build_review_outer_verdict` gains an additive optional
  suppression list; the coordinator's existing adjudication events carry the skipped dispatch.
- `skills/build-review-test-quality/SKILL.md` — the v3 result contract states the field.

Not Small: the change alters a machine-consumed grader contract and two routing decisions, and the
fail-safe-absent and exact-id-only constraints are design decisions that needed an architecture pass.
Not Large: no new subsystem or seam; both changes extend settled components in place.

Test blast radius: the finding parser and effective-reducer tests gain cases; the coordinator tests
gain the fast-path table. Because `confidence` is optional, the 26 test files that build findings
need no fixture migration.

Tier-required artifacts: architecture-diagram, lightweight architecture-review, conflict-check,
coherence-check.
