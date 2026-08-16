# Conflict Check: Preservation-Anchored Completeness Exception (#1580)

**Date:** 2026-08-16
**Stories checked:** `.docs/stories/plan-over-prescription-drives-completeness-finding.md`
(Stories 1–6)
**ADR corpus:** `repo_wide` (from `.ai-conductor/config.yml:93`)
**Result:** PASSED — zero blocking conflicts, zero degrading conflicts accepted

## Corpus selection

279 ADRs on disk; 269 not fully superseded. Narrowing was performed against the **surfaces the
stories actually touch**, not against title keywords — title-keyword narrowing is the technique that
missed three design-killing ADRs on #1613. The discriminating greps were run over ADR *bodies* for:
`removalContext`, `projectionVersion`, `plan-task-parse`, `parsePlanTask`, `build-review-completeness`,
`holistic`, `Verify-only`, and plan task-header grammar.

One pattern was run and **discarded as non-discriminating**: a body grep for `Preserves` matched 70
ADRs on the ordinary English verb ("preserves the original assertion", "preserves ordering") and
carried no signal about this feature's subject. Recorded so a later reader does not mistake its
absence for an omission.

### Examined (22)

`adr-2026-07-21-completeness-as-build-review-rubric` · `adr-2026-08-12-removal-anchored-tautology-exemption` ·
`adr-2026-08-15-verify-only-anchored-tautology-exemption` · `adr-2026-08-13-engine-managed-build-review-rubric-branches` ·
`adr-2026-08-13-stable-build-review-finding-dispositions` · `adr-2026-08-12-cumulative-build-review-convergence-bound` ·
`adr-2026-07-23-build-review-fresh-base-disposition` · `adr-2026-08-14-retire-build-review-wiring-rubric` ·
`adr-2026-07-22-per-task-work-happened-floor` · `adr-2026-08-09-declared-pattern-replication-in-build` ·
`adr-2026-08-02-plan-scope-containment-at-commit-boundary` · `adr-2026-08-09-non-blocking-plan-scope-containment` ·
`adr-2026-07-05-engine-owned-task-status` · `adr-2026-07-21-demote-task-stamping-to-telemetry` ·
`adr-2026-07-21-no-diff-task-evidence-stamp` · `adr-2026-07-17-verify-only-judged-closure` ·
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` · `adr-2026-07-22-coherence-gate-placement-and-validation-split` ·
`adr-2026-08-05-token-first-stories-reference-normalization` · `adr-2026-08-07-worktree-removal-coverage-guard` ·
`adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` · `adr-2026-07-21-engine-owned-acceptance-red-execution`

### Excluded as unambiguously fully superseded (2)

- `adr-2026-07-21-build-end-plan-completeness-gate` → superseded by `adr-2026-07-21-completeness-as-build-review-rubric`
- `adr-2026-08-11-wiring-judged-in-build-review` → superseded by `adr-2026-08-14-retire-build-review-wiring-rubric`

### Narrowed out (245)

Every remaining approved ADR: daemon lifecycle, intake/ledger, provider routing and readiness,
release/versioning, worktree and rebase mechanics, memory, observability, publication/finish, owner
gating, and hosting. None names a build_review rubric contract, a rubric projection field, a plan
task-header form, or a plan-text parser. `adr-2026-07-21-completeness-as-build-review-rubric` retains
a *partial* supersession marker ("APPROVED — PARTIALLY SUPERSEDED by …") and was therefore **kept**
in the examined set, per the `repo_wide` rule that only unambiguous full supersession excludes.

## Story-versus-story scan

All 15 pairs tested in both directions against the six conflict types. The pair most likely to
oscillate is called out explicitly:

**Story 3 (relocation exempts) versus Story 4 (loss still fails).** If Story 3 is fully satisfied,
does Story 4 still hold? Yes. If Story 4 is fully satisfied, does Story 3 still hold? Yes. Two
"yes" answers, so this is not an oscillation. The pair is disjoint on a single discriminator —
whether an equivalent assertion survives post-diff — and that discriminator is condition 3 of the
same predicate, so no implementation can satisfy one by violating the other. This is recorded
because a superficial read ("one story says exempt, the other says fail") looks like a
contradiction and is not.

**Story 1 (authoring form) versus Story 2 (parser).** Sequencing, not circular: Story 1 defines the
grammar, Story 2 consumes it. Story 2's fail-closed criteria are the negative half of Story 1's
"absent or empty value grants nothing", not a competing rule.

**Story 5 (per-clause grain) versus Stories 3 and 4.** Story 5 constrains the *evaluation grain* of
the predicate the other two describe; it adds no obligation either contradicts.

**Story 6 (narrow doctrine) versus Story 3.** Story 6 requires removal evidence to grant nothing
absent a preservation clause; Story 3 requires it to grant an exemption when a clause is present and
all three conditions hold. Complementary halves of one predicate, not a state conflict.

No contradiction, behavioral overlap, state conflict, resource contention, sequencing conflict, or
oscillation found among the stories. Confidence 92%, basis: verified — each pair reasoned through
against the ADR's D1–D5 predicate rather than assumed compatible.

## ADR-versus-story scan

No blocking conflict found. Two interactions were examined closely enough to warrant recording.

### Examined interaction 1 — finding identity collision on a multi-clause task

**ADR filename stem:** adr-2026-08-13-stable-build-review-finding-dispositions
**Story ID:** Story 5
**ADR sentence (verbatim):** "Within one lap, two different findings that canonicalize to the same
identity are a malformed branch result and block as infrastructure failure."
**Story sentence (verbatim):** "Given three preserved behaviors on one task where two relocate
cleanly and one is lost, when Completeness judges the lap, then exactly one finding is returned."

**Not a conflict.** Completeness anchors on the approved plan outcome/task *and* the missing
deliverable, so two lost behaviors on the same task carry the same `planTask` but distinct
`missingOutcome` values and canonicalize apart. The constraint is nevertheless real and load-bearing:
an implementation that anchored only on `planTask` would turn a two-lost-behaviour lap into an
infrastructure failure rather than two findings. Story 5's Done-When already requires distinct
anchors; this record makes the reason explicit.

### Examined interaction 2 — whether the exception bumps the Completeness contract version

**ADR filename stem:** adr-2026-08-13-stable-build-review-finding-dispositions
**Story ID:** Story 6
**ADR sentence (verbatim):** "A contract version changes only when identity semantics change; that
change intentionally prevents an old disposition from silently matching the new meaning."
**Story sentence (verbatim):** "Given the rubric contract after the edit, when the judged-result
schema is exercised, then `concernKind`, the nested `anchor`, and contract version `v1` are unchanged
by this feature."

**Not a conflict — settled against precedent rather than left as an assumption.**

The question is whether adding a rubric exception plus a new evidence field constitutes a change to
"identity semantics" and so forces a contract-version bump (which would invalidate every existing
Completeness disposition by design).

It does not, and the precedent is exact. Commit `4bf3858a5` (PR #1618,
`adr-2026-08-15-verify-only-anchored-tautology-exemption`) added the fourth closed Tautology
exception **and** a new `verifyOnlyContext` projection field, and changed neither `contractVersion`
nor `projectionVersion`; the only edit touching those identifiers added `verifyOnlyContext` to the
projection key-set assertions in `build-review-projections.test.ts`. Confidence 97%, basis: verified
by `git show 4bf3858a5` filtered to `contractVersion|projectionVersion`.

The anchor fields (`rubric`, `planTask`, `missingOutcome`), their grammar, and `concernKind` are all
untouched by this feature, so an existing Completeness disposition continues to match exactly the
finding it was accepted against. Contract version stays `v1`; projection version stays `v2`.

**Implementation consequence carried to the plan.** That same key-set assertion pins the exact key
list of each rubric projection, so `preservationContext` requires updating it. Unlike #1618 — which
added `verifyOnlyContext` to **all four** projections — `preservationContext` is consumed only by
Completeness and must be added to the Completeness projection alone, per the "all and only" rule in
`adr-2026-08-13-engine-managed-build-review-rubric-branches` §2. A maker copying #1618's four-way
pattern would over-broaden the projection.

### Alignments confirmed (no action)

- `adr-2026-08-13-engine-managed-build-review-rubric-branches` §2 states "if a skill is allowed to
  depend on a field, that field participates in its projection digest" — which **requires** Story 2's
  digest-change criterion rather than merely permitting it, and confines `preservationContext` to the
  Completeness projection under the same section's "all and only" rule.
- `adr-2026-08-09-declared-pattern-replication-in-build` is direct precedent for Stories 1–2: it added
  `**Pattern-source:**` / `**Rename-map:**` as plan-header lines with a new parser and a
  `skills/plan/SKILL.md` contract edit. No ADR closes the plan task-header set.
- `adr-2026-07-22-per-task-work-happened-floor` is non-blocking advisory and keys on `Task:` commit
  trailers; it neither reads nor is affected by `preservationContext`.
- `adr-2026-08-12-cumulative-build-review-convergence-bound` is helped, not threatened: fewer spurious
  Completeness findings mean more PASS verdicts, and a PASS resets `cumulative`.

## Resolutions applied

None required. No story was amended and no ADR was superseded.
