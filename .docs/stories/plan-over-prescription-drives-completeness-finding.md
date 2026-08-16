**Status:** Accepted

# Stories: Preservation-Anchored Completeness Exception (#1580)

Technical track — acceptance criteria derive from
`adr-2026-08-16-preservation-anchored-completeness-exemption.md` (D1–D5) and the five conditions in
`architecture-review-2026-08-16-plan-over-prescription-drives-completeness-finding.md`. Scope is
outcomes 1 and 2 of jstoup111/ai-conductor#1580; outcomes 3 and 4 are excluded by operator decision
and have no stories here.

## Story 1: A plan states a preserved behavior at behavior level

**Requirement:** ADR D1 (outcome-2)

As a plan author, I want to declare that an existing behavior's coverage must not regress, without
naming the test cases that happen to carry it today, so that a later reorganization of those cases
does not read as a gap.

### Acceptance Criteria

#### Happy Path
- Given `skills/plan/SKILL.md`, when an author reads the task-block format, then it documents a
  `**Preserves:** <behavior>` line as an optional task header alongside `**Verify-only:**` and
  `**Dependencies:**`.
- Given the authoring guidance, when an author reads the boundary rule, then it states that the
  value names a behavior or contract and never a test case, file, or `it(...)` title, and shows the
  incident's clause (`confirm the file's existing ungated self-check cases pass unchanged`) as the
  rejected form.
- Given a task with no `**Preserves:**` line, when the plan is authored, then the task declares no
  preserved behavior and the rubric's ordinary holistic judgement applies unchanged.

#### Negative Paths
- Given authoring guidance that permitted a case-name value, when an author wrote
  `**Preserves:** the TokenMeter wrapper test case`, then the guidance must explicitly reject it —
  the documented form is the behavior, not its current carrier.
- Given a task carrying `**Preserves:**` with an empty value, when the plan is authored, then the
  guidance states the line is treated as absent rather than as a wildcard grant.
- Given `skills/plan/SKILL.md` after the edit, when `test/test_harness_integrity.sh` runs, then
  section numbering, frontmatter, and cross-skill reference checks all pass.

### Done When
- [ ] `skills/plan/SKILL.md` documents the `**Preserves:**` task header form with its behavior-level
      boundary and the rejected case-name form
- [ ] The guidance states that an absent or empty value grants nothing
- [ ] `test/test_harness_integrity.sh` passes with the edited skill

## Story 2: The engine derives preservation evidence deterministically from the plan

**Requirement:** ADR D2, condition 5 (outcome-2)

As the build_review input assembler, I want each task's preserved-behavior clause parsed into
engine-recorded evidence so that the rubric's exemption decision is anchored to a fact the engine
computed rather than to prose the grader interpreted.

### Acceptance Criteria

#### Happy Path
- Given a plan whose Task 9 block carries `**Preserves:** the ungated TokenMeter wrapper
  transparency`, when build_review inputs are assembled, then `preservationContext` contains exactly
  one entry pairing task id `9` with that behavior string.
- Given a task declaring two `**Preserves:**` lines, when inputs are assembled, then both behaviors
  appear as separate entries for that task — clause count is not collapsed to one per task.
- Given any assembled inputs, when the source snapshot is built, then `preservationContext` is part
  of the frozen snapshot and its digest, receiving the same treatment as `removalContext`.
- Given the Completeness rubric projection, when it is built, then it carries `preservationContext`
  and `projectionVersion` remains `'v2'` (additive, as `verifyOnlyContext` was added).

#### Negative Paths
- Given a plan with no `**Preserves:**` line anywhere, when inputs are assembled, then
  `preservationContext` is empty — no behavior is ever inferred from prose.
- Given a task whose `**Preserves:**` value is empty or whitespace-only, when inputs are assembled,
  then that task is absent from `preservationContext` (fail-closed: no entry, therefore no grant).
- Given a plan body matching no task headers at all, when inputs are assembled, then
  `preservationContext` is empty and assembly does not throw.
- Given two assemblies differing only in the presence of a `**Preserves:**` line, when their
  projection digests are compared, then they differ — a preservation clause is part of cache
  identity and cannot silently reuse a verdict judged without it.

### Done When
- [ ] `parsePlanTaskPreserves` in `src/conductor/src/engine/plan-task-parse.ts` returns per-task
      preserved-behavior clauses, shaped after `parsePlanTaskVerifyOnly`
- [ ] `BuildReviewSourceSnapshot` exposes `preservationContext`; it is inside the frozen snapshot and
      its digest
- [ ] The Completeness v2 projection carries `preservationContext`; `projectionVersion` is unchanged
- [ ] Unit tests cover: multi-clause task, absent clause, empty value, headerless plan, digest change

## Story 3: Relocated coverage with equivalent assertions produces no finding

**Requirement:** ADR D3 (outcome-1, outcome-2), condition 3

As a maker reorganizing tests, I want coverage I moved and kept intact to pass Completeness so that a
refactor whose entire subject is reorganization does not generate a finding per relocated case.

### Acceptance Criteria

#### Happy Path
- Given a plan task declaring `**Preserves:** X`, and a diff that deletes the file asserting X while
  adding an equivalent assertion of X in a new file, when Completeness judges the lap, then it
  returns no finding for X.
- Given that same diff, when the judgement runs, then it consults `preservationContext` for the
  clause and `removalContext` for the carrier's deletion — both engine-derived, neither inferred
  from the maker's narrative.
- Given the incident diff shape from #1580 (one smoke file split into per-provider legs with every
  assertion retained), when Completeness judges it, then it returns zero findings for the preserved
  behaviors, against the five it produced before this change.

#### Negative Paths
- Given a plan task declaring `**Preserves:** X` and a diff that moves X's carrier but weakens the
  assertion so X is no longer distinguished, when Completeness judges the lap, then it returns a
  finding — relocation is not a defence when the surviving assertion no longer asserts X.
- Given a diff that deletes a carrier for which **no** `**Preserves:**` clause exists, when
  Completeness judges the lap, then removal evidence grants nothing and the removal is judged by the
  rubric's ordinary holistic reading.
- Given a `**Preserves:**` clause naming a behavior that had no coverage at merge base, when
  Completeness judges the lap, then condition 2 is unsatisfied (no carrier was removed) and the
  clause grants no exemption.

### Done When
- [ ] `skills/build-review-completeness/SKILL.md` states the three-condition per-clause predicate
- [ ] An acceptance test drives the relocation-with-equivalence case end to end and asserts zero
      findings for the preserved behavior
- [ ] An acceptance test asserts the weakened-assertion relocation still produces a finding
- [ ] The contract lands in the rubric SKILL.md; `build-review-prompt.ts` is not the exception
      surface (it is off the live dispatch path)

## Story 4: Genuinely lost coverage still fails Completeness

**Requirement:** ADR D3 condition 3, review condition 1 (outcome-1 negative path)

As the operator relying on Completeness as the sole completeness authority, I want a preserved
behavior whose assertions vanished to still FAIL, so that the new exemption cannot silently disable
the gate.

This is the High-impact risk in the register. No downstream gate nets a false negative here:
`test-suite` passes green on a suite with a deleted test, `/manual-test` exercises behavior that is
intact, `/prd-audit` checks FRs rather than retained coverage, and the as-built
`/architecture-review` §12 sweep hunts unreachable primitives. All validate current behavior, which a
lost assertion leaves working.

### Acceptance Criteria

#### Happy Path
- Given a plan task declaring `**Preserves:** X`, and a diff that deletes X's carrier with no
  equivalent assertion of X anywhere in the post-diff tree, when Completeness judges the lap, then it
  returns a finding naming the preserved behavior as the missing outcome.
- Given that finding, when it is emitted, then it carries the `anchor` object with `rubric`,
  `planTask`, and `missingOutcome` string values as the result contract requires.
- Given the equivalence search, when it runs, then it covers the whole post-diff tree rather than the
  carrier's original directory — a behavior re-asserted nowhere is a finding even if the deletion
  looks local.

#### Negative Paths
- Given a diff that deletes X's carrier and adds a same-named test that asserts nothing about X, when
  Completeness judges the lap, then it still returns a finding — a surviving *name* is not a
  surviving assertion.
- Given a diff that deletes X's carrier and adds an assertion of a *different* behavior Y in its
  place, when Completeness judges the lap, then it returns a finding for X.
- Given a preserved behavior whose carrier was deleted and whose replacement is only a commented-out
  or skipped test, when Completeness judges the lap, then it returns a finding.

### Done When
- [ ] An acceptance test drives the deleted-with-no-equivalent case and asserts a Completeness
      finding is produced
- [ ] An acceptance test asserts the surviving-name-without-assertion case still produces a finding
- [ ] The emitted finding's `anchor` object matches the result contract (`rubric`, `planTask`,
      `missingOutcome`, plain strings, not flattened)
- [ ] This coverage is an acceptance test of the judged path, not a unit test of the parser

## Story 5: The predicate is evaluated per clause, never per diff

**Requirement:** ADR D3, review condition 2 (outcome-1)

As the operator triaging a review lap, I want each preserved behavior judged independently so that
one behavior's legitimate relocation cannot exempt another behavior's genuine loss.

### Acceptance Criteria

#### Happy Path
- Given a diff that relocates behavior X's coverage with equivalence retained **and** deletes
  behavior Y's coverage with no equivalent, both declared via `**Preserves:**` on the same task, when
  Completeness judges the lap, then it returns exactly one finding, for Y.
- Given that same lap, when the finding is read, then it names Y and does not name X.
- Given three preserved behaviors on one task where two relocate cleanly and one is lost, when
  Completeness judges the lap, then exactly one finding is returned.

#### Negative Paths
- Given the mixed diff above, when Completeness judges it, then it does **not** exempt Y on the
  strength of X's qualifying relocation — a per-diff reading of the predicate is the defect.
- Given the mixed diff above, when Completeness judges it, then it does **not** collapse X and Y into
  a single task-level verdict — clause independence survives into the emitted findings.
- Given a task with two preserved behaviors where an operator dispositions the finding for Y, when a
  later lap loses X as well, then X produces its own finding — the disposition for Y does not cover
  it.

### Done When
- [ ] `skills/build-review-completeness/SKILL.md` states the predicate is evaluated per preserved
      behavior clause, never per diff
- [ ] An acceptance test drives the mixed relocate-one/lose-one diff and asserts exactly one finding,
      for the lost behavior
- [ ] The two behaviors carry distinct finding anchors so their dispositions cannot alias

## Story 6: The doctrine change is narrow and holistic judgement is untouched

**Requirement:** ADR D4, D5, review condition 4 (outcome-1)

As a future reader of the rubric contract, I want the removal-evidence doctrine narrowed by exactly
one sentence and the holistic-judgement prohibition left intact, so that this exception is not read
as a licence for per-task commit reasoning.

### Acceptance Criteria

#### Happy Path
- Given `skills/build-review-completeness/SKILL.md`, when the removal-evidence line is read, then it
  states that `removalContext` anchors exactly the preservation-maintenance exception and remains
  never an exemption for any other Completeness concern.
- Given the same contract, when the holistic-judgement section is read, then the prohibition on
  chasing per-task SHAs, per-task commit reachability, and trailer corroboration is present and
  unweakened.
- Given the same contract, when the predicate is read, then its inputs are named as plan text, diff
  content, and engine-derived removal evidence only.

#### Negative Paths
- Given a diff with removal evidence and no preservation clause, when Completeness judges the lap,
  then removal evidence grants no exemption — the narrowed doctrine holds for every other concern.
- Given a preserved behavior whose carrier was removed, when the judgement runs, then it reaches its
  verdict without reading `.pipeline/task-status.json`, a commit SHA, a `Task:` trailer, or the maker
  transcript.
- Given the rubric contract after the edit, when the judged-result schema is exercised, then
  `concernKind`, the nested `anchor`, and contract version `v1` are unchanged by this feature.

### Done When
- [ ] The `removalContext` doctrine sentence is narrowed in place, not deleted
- [ ] The per-task SHA/reachability/corroboration prohibition is verifiably still present
- [ ] An acceptance test asserts a removal with no preservation clause is judged normally
- [ ] The judged-result contract (`v1`, `concernKind`, nested `anchor`) is unchanged
