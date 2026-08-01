# Stories: park-reconciliation refusal observability

Feature: park-reconciliation-refusal-observability-1114
Refs: jstoup111/ai-conductor#1114
Track: technical (no PRD; acceptance criteria live here)
Governing ADR: `adr-2026-08-01-multi-proof-park-deletion-authority`
Status: Accepted

---

## Story S1: A refused branch says why, not "not ancestor"

As the operator triaging a parked feature, I want each refusal to name its actual cause, so that I
can tell "nothing says this shipped" apart from "this branch has work on it" without re-deriving the
git state by hand.

### Acceptance Criteria

#### Happy Path
- **Given** a parked slug whose branch is not an ancestor of `origin/main` and for which no MERGED
  PR exists, **when** the guarded helper runs, **then** it refuses with reason `no-merge-proof` and
  deletes nothing.
- **Given** a parked slug whose branch has a MERGED PR and whose tip is strictly ahead of that PR's
  `headRefOid`, **when** the helper runs, **then** it refuses with reason `unmerged-commits`.
- **Given** a parked slug whose branch has a MERGED PR and whose tip is behind that PR's
  `headRefOid`, **when** the helper runs, **then** it refuses with reason `branch-behind-merged-head`.

#### Negative Paths
- **Given** git cannot answer the ancestry probe (exit ≠ 1, e.g. unreadable ref), **when** the helper
  runs, **then** the reason is `ancestry-check-failed` — never one of the three above.
- **Given** `gh` is unavailable or returns unparsable output, **when** the helper runs, **then** it
  refuses with `no-merge-proof` and deletes nothing; an unavailable proof never authorizes anything.
- **Given** a merged PR reports a `headRefOid` that does not resolve in the local object store,
  **when** the helper runs, **then** it refuses with `ancestry-check-failed`, not a guess.

### Done When
- [ ] `RefusalReason` includes `no-merge-proof`, `unmerged-commits`, `branch-behind-merged-head`.
- [ ] The literal `not-ancestor` is gone from the helper's returns.
- [ ] Unit refusal table covers all four reasons with mocked git/gh.

---

## Story S2: An `unmerged-commits` refusal names the commits that would be dropped

As the operator, I want the refusal to list the specific commits `git branch -D` would discard, so
that I can decide in one read whether that work matters.

### Acceptance Criteria

#### Happy Path
- **Given** a branch carrying two commits past its merged PR head, **when** it is refused, **then**
  the outcome carries those two commits as short sha + subject, in `headRefOid..<ref>` order.
- **Given** the operator verb `conduct daemon reconcile-parked <slug>`, **when** the refusal is
  `unmerged-commits`, **then** the printed output includes those commit lines and a non-zero exit.

#### Negative Paths
- **Given** a branch with more than the display cap of unmerged commits, **when** it is refused,
  **then** the first N are listed followed by an explicit `… and M more` — never a silent truncation.
- **Given** the `git log` range itself fails, **when** the helper runs, **then** it refuses with
  `ancestry-check-failed` rather than reporting an empty commit list.
- **Given** any refusal reason other than `unmerged-commits`, **then** no commit list is emitted.

### Done When
- [ ] Outcome type carries an optional structured `unmergedCommits` list.
- [ ] Operator-verb output renders it; test asserts the real `WIP backup`-shaped case.
- [ ] Cap and overflow suffix covered by test.

---

## Story S3: The sweep summary counts refusals

As the operator reading one daemon log line, I want refusals counted, so that a cleanup arm that can
never fire cannot look identical to one with nothing to do.

### Acceptance Criteria

#### Happy Path
- **Given** a sweep in which three merged slugs are refused, **when** the summary is emitted,
  **then** it reports `refused=3` alongside the existing counters.
- **Given** refusals of differing reasons, **when** the summary is emitted, **then** it carries a
  per-reason breakdown identifying each cause and its count.

#### Negative Paths
- **Given** a sweep with zero refusals, **when** the summary is emitted, **then** `refused=0` and no
  breakdown noise is added.
- **Given** a slug refused as `record-missing`, **then** it continues to count as `deferred` and is
  not double-counted as `refused`.

### Done When
- [ ] `ParkedSweepResult.counts.refused` and `refusedByReason` exist and are populated.
- [ ] Summary line includes `refused=N` plus breakdown; guidance phrasing extended.
- [ ] A refused merged slug's existing `parked` accounting is asserted unchanged.

---

## Story S4: A change in refusal mix is never suppressed by log de-duplication

As the operator, I want the summary to re-log when the refusal picture changes, so that the
de-duplication that keeps idle ticks quiet cannot hide the very signal this feature adds.

### Acceptance Criteria

#### Happy Path
- **Given** two consecutive sweeps with identical counters *including* refusal counts, **when** the
  second completes, **then** the summary is not re-logged.
- **Given** two consecutive sweeps whose visible counters are equal but whose refusal reasons
  differ, **when** the second completes, **then** the summary **is** re-logged.

#### Negative Paths
- **Given** a slug that stops being parked, **when** the next sweep runs, **then** cache pruning
  behaves exactly as today.

### Done When
- [ ] `sweepSummarySignatures` signature string incorporates refusal counts and reasons.
- [ ] Explicit test proves a refusal-mix-only change re-logs.

---

## Story S5: Deletion strength is provably unchanged

As the maintainer of a destructive path, I want proof that renaming refusals moved no branch across
the delete/refuse line, so that an observability change cannot become a data-loss change.

### Acceptance Criteria

#### Happy Path
- **Given** the full matrix of evidence shapes (ancestor; head-identity match; head ahead; head
  behind; no PR; git failure; no branch; missing record), **when** each is run, **then** the
  *decision* (delete vs refuse) matches the pre-change behavior case for case.
- **Given** an ancestry-proven, record-backed park, **when** reconciled, **then** steps remain
  `worktree-removed`, `branch-deleted`, `unparked` in that order, unpark last.

#### Negative Paths
- **Given** the raced-branch case (branch gains a commit after classification), **when** the operator
  verb runs, **then** it still refuses at the point of deletion, the branch sha is unchanged, the
  marker survives, and output contains no force path.
- **Given** a slug argument carrying a glob, path separator, comma list, empty string, or `../`,
  **then** it is refused before any git command runs.

### Done When
- [ ] Characterization test pins the delete/refuse partition independent of reason strings.
- [ ] Existing raced-branch and single-slug-guard acceptance tests pass, re-pinned to specific new
      reasons rather than loosened.
- [ ] `test/engine/park-marker-invariant.test.ts` single-writer assertions unchanged and passing.

---

## Story S6: The governing ADR and operator docs match the code

As the next engineer deciding whether a new deletion proof is legitimate, I want the ADR to state
the proofs that actually exist, so that I do not read "ancestry is the ONLY authority" and conclude
the shipped head-identity proof is a bug.

### Acceptance Criteria

#### Happy Path
- **Given** `adr-2026-07-27-ancestry-proven-park-reconciliation`, **when** §3 is read, **then** it
  carries an inline amendment note pointing at `adr-2026-08-01-multi-proof-park-deletion-authority`,
  following the established `*Amended YYYY-MM-DD by …*` pattern.
- **Given** `docs/reference/cli.md`'s `daemon reconcile-parked` refusal table, **when** read, **then**
  it lists the new reasons and no longer documents `not-ancestor`.
- **Given** `docs/guides/running-the-daemon.md` §parked-feature-reconciliation, **when** read,
  **then** it describes the refusal taxonomy and the `refused=N` summary field.

#### Negative Paths
- **Given** the ADR amendment, **then** §3's unchanged clauses (single-slug scope, no force flag,
  re-verification at point of deletion, record-as-precondition) are restated, not dropped.
- **Given** harness validation, **then** it passes with no stale cross-references.

### Done When
- [ ] `adr-2026-08-01-…` committed with `Status: APPROVED`.
- [ ] Inline amendment note added to the 07-27 ADR §3 and §1.
- [ ] `docs/reference/cli.md` and `docs/guides/running-the-daemon.md` updated in the same diff.
- [ ] `CHANGELOG.md` `[Unreleased]` entry added (reader-visible refusal/summary change).
- [ ] `test/test_harness_integrity.sh` passes.
