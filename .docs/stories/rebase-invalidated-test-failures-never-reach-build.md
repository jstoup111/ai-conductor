# Stories: Rebase-invalidated test failures never reach build_review as repair context

**Status:** Accepted

**Source:** intake jstoup111/ai-conductor#1535
**Track:** technical — no PRD; acceptance criteria live here. The `**Requirement:**` tag on each
story cites the decision clause of `adr-2026-08-13-durable-base-advance-attribution`
(`ADR-D1`…`ADR-D5`) or of `adr-2026-08-13-markdown-default-inversion` (`MD-D1`), a condition of
`architecture-review-2026-08-13-rebase-invalidated-test-failures-never-reach-build`
(`AR-C2`, `AR-C3`), plus the desired outcome from the source issue (`O1`…`O5`) it serves.

**Desired outcomes from the source issue:**

- **O1** — When a base advance invalidates work and the build repairs it, build_review can tell
  that repair apart from unplanned change; the repair is not flagged as out-of-scope or
  tautological on that ground.
- **O2** — A test failure caused by a base advance is attributed to that advance, regardless of
  which gate observes the failure first.
- **O3** — The grader's repair-context block reflects every recorded base-advance repair for the
  feature; when it is empty, that is because no base advance invalidated anything.
- **O4** — A genuinely unplanned deletion is still flagged; a base advance does not become blanket
  permission to remove coverage.
- **O5** — An operator can tell from the run's artifacts whether a given build_review finding was
  graded with or without repair context available.

**Verification note:** the emitter-scoping and directory-agreement claims these stories rest on
were verified before authoring — see `.pipeline/verify-claims-architecture-review-1535.md`.

---

## Story 1: Base-advance records survive into the feature's durable history

**Requirement:** ADR-D1 / O2, O3

As the build_review grader, I want every base advance recorded durably in the feature's own
history, so that attribution is still available on a later lap rather than being erased by the
next gate run.

### Acceptance Criteria

#### Happy Path
- Given a feature build whose base advances and changes files, when the rebase completes, then the
  base-advance record appears as a line in that feature worktree's `.pipeline/events.jsonl`.
- Given a base advance has been recorded, when any gate subsequently re-runs and rewrites its own
  verdict file, then the base-advance record is still present and unchanged.
- Given two base advances occur during one feature build, when the history is read, then both
  records are present in the order they occurred.
- Given a base advance is recorded, when the gate-invalidation decision is also made, then the
  per-gate invalidation record is durable in the same history.
- Given a base advance whose entire delta consists of excluded documentation paths, when the rebase
  completes, then a base-advance record IS still written carrying those paths — the record is
  written whenever the base advanced, not only when gates invalidate.

#### Negative Paths
- Given the event emission fails (the emitter throws), when the rebase completes, then the rebase
  itself still succeeds, no record is written, and no exception propagates to the caller.
- Given no base advance has occurred during a feature build, when the history is read, then no
  base-advance record exists and the reader returns an empty result rather than an error.
- Given a feature worktree whose `.pipeline/events.jsonl` does not yet exist, when a base advance
  is recorded, then the file is created and the record is the first line, rather than the write
  failing.
- Given a `.pipeline/events.jsonl` containing a malformed line, when the base-advance history is
  read, then the malformed line is skipped and the remaining well-formed records are returned.

### Done When
- [ ] A base advance during a feature build produces a durable record in that worktree's
      `.pipeline/events.jsonl`, verified by reading the file after the rebase.
- [ ] A documentation-only base advance produces a record carrying its paths while leaving every
      gate verdict preserved — recording and invalidating proven independent.
- [ ] The same record is still readable after a subsequent gate verdict rewrite.
- [ ] Existing consumers that read `.pipeline/events.jsonl` (cost rollup, timing rollup, dashboard)
      produce identical output before and after this change for a run containing base advances.
- [ ] A forced emission failure leaves the rebase outcome unchanged and raises nothing.

---

## Story 2: The base-advance record names every path the advance touched

**Requirement:** ADR-D1 / O2

As the attribution join, I want the base-advance record to carry the complete set of paths the
advance changed, so that a failure caused by a file outside the gate-invalidation surface can still
be attributed.

### Acceptance Criteria

#### Happy Path
- Given a base advance that deletes a file which the gate-invalidation classifier does not treat as
  runtime source, when the record is read, then that deleted path is present in the record's
  complete path set.
- Given a base advance that changes both source files and non-source files, when the record is
  read, then the complete path set contains both, and the existing gate-invalidation path set
  continues to contain only what it contains today.
- Given a base advance, when the gate-invalidation decision is computed, then it is computed from
  the same filtered set as before this change, unchanged in behavior.

#### Negative Paths
- Given the rebase delta cannot be computed, when the outcome is classified, then the record
  carries no path set and the existing fail-closed behavior (treat as changed, force the fixed
  invalidation set) is preserved unchanged.
- Given a base advance that changes exactly one path, when the record is read, then the complete
  path set contains exactly that one path and is not empty.
- Given a base advance whose complete path set is large, when the record is written, then every
  path is retained rather than truncated to a display limit.

### Done When
- [ ] A base advance deleting a path excluded by the gate-invalidation classifier still appears in
      the record's complete path set.
- [ ] Gate invalidation decisions are byte-identical to pre-change behavior for the same delta,
      verified by a test over the existing classifier.
- [ ] The uncomputable-delta path retains its current fail-closed outcome.

---

## Story 3: Harness source in markdown is classified as source, not documentation

**Requirement:** MD-D1 / O2

As the harness, I want my own markdown-defined runtime surface treated as source, so that a base
advance touching it is recognized as changing code rather than as changing prose.

### Acceptance Criteria

#### Happy Path
- Given a changed path under `agents/` ending in `.md`, when it is classified, then it is treated
  as code/test.
- Given a changed path `skills/<name>/SKILL.md`, when it is classified, then it is treated as
  code/test.
- Given a changed path under `tech-context/` or `templates/` ending in `.md`, when it is
  classified, then it is treated as code/test.
- Given a root-level `HARNESS.md` or `AGENT_INSTRUCTIONS.md`, when it is classified, then it is
  treated as code/test.
- Given a base advance whose only changed path is `agents/<persona>.md`, when the rebase outcome is
  classified, then it is classified as a file-changing advance rather than as a no-op.

#### Negative Paths
- Given a changed path under `.docs/`, when it is classified, then it is NOT treated as code/test —
  including `.docs/audits/*.json` and `.docs/coherence/.gitkeep`, which are non-markdown and were
  already excluded only by the directory rule.
- Given a changed path under `docs/`, when it is classified, then it is NOT treated as code/test —
  including the non-markdown `docs/_config.yml`.
- Given a changed path `README.md`, `README`, or a `README` at any depth, when it is classified,
  then it is NOT treated as code/test.
- Given a changed path `CHANGELOG.md`, when it is classified, then it is NOT treated as code/test.
- Given a base advance whose only changed paths are under `.docs/` and `docs/`, when the rebase
  outcome is classified, then it remains a no-op and invalidates no gate — every existing gate
  verdict is preserved. (A base-advance *record* is still written for it per Story 1; recording and
  invalidating are separate conditions. Resolution of conflict-check C2, operator-confirmed.)
- Given a test path ending in `.test.ts` or living under `test/`, when it is classified for runtime
  source, then it is still excluded as a test path, unchanged by this story.

### Done When
- [ ] `agents/*.md`, `skills/**/SKILL.md`, `tech-context/**`, `templates/**`, and root harness
      markdown all classify as code/test.
- [ ] `.docs/**`, `docs/**`, `README*` at any depth, and `CHANGELOG.md` all classify as NOT
      code/test, with the three known non-markdown cases explicitly asserted.
- [ ] A markdown-only base advance under `agents/` produces a file-changing outcome; one under
      `.docs/` produces a no-op.
- [ ] The runtime-source-versus-test distinction is unchanged.

---

## Story 4: A failure is attributed to a base advance only when it actually overlaps one

**Requirement:** ADR-D2 / O1, O2, O4

As the harness, I want a gate failure joined to a base advance on evidence rather than on timing
alone, so that required repair is recognized without turning a base advance into permission to
delete anything.

### Acceptance Criteria

#### Happy Path
- Given a base advance that deleted a path, and a subsequent gate failure whose diagnostic names
  that path, when attribution runs, then the failure is attributed to that advance and a repair
  record is created.
- Given a base advance recorded on an earlier lap of the feature, and a gate failure on a later
  lap, when attribution runs, then the earlier advance is still considered — the search covers the
  feature's whole recorded history, not only the current lap.
- Given several recorded base advances, when a failure overlaps exactly one of them, then the
  repair record identifies that advance and not the others.

#### Negative Paths
- Given a gate failure whose diagnostic names no path changed by any recorded advance, when
  attribution runs, then NO repair record is created and grading proceeds exactly as it does today.
- Given a gate failure that occurred BEFORE any base advance was recorded, when attribution runs,
  then no repair record is created, because ordering alone must not attribute backwards.
- Given a gate failure whose diagnostic names no path at all, when attribution runs, then no repair
  record is created and no exception is raised.
- Given a recorded base advance and a gate failure that is genuinely unrelated to it, when
  attribution runs, then no repair record is created, so a subsequent unplanned deletion remains
  flaggable.
- Given no base advance has ever been recorded for the feature, when a gate fails, then attribution
  returns no result without reading a missing file as an error.

### Done When
- [ ] A failure naming a path deleted by a recorded advance produces a repair record.
- [ ] A failure naming an unrelated path produces NO repair record.
- [ ] A failure recorded before the advance produces NO repair record.
- [ ] An advance recorded on a prior lap is still matched by a failure on a later lap.
- [ ] The predicate that keyed attribution to a single gate verdict's kickback provenance no longer
      exists in the codebase.

---

## Story 5: Any gate can record repair, and one advance can explain several failures

**Requirement:** ADR-D3 / O2, O3

As an operator, I want every base-advance-caused failure recorded regardless of which gate saw it
and how many there were, so the grader's repair context is complete rather than a single sample.

### Acceptance Criteria

#### Happy Path
- Given one base advance that invalidates two distinct pieces of work, when both failures are
  observed, then TWO repair records exist, one per failure.
- Given a base-advance-caused failure observed by a gate other than the full-suite verification
  gate, when it is recorded, then a repair record is created and identifies the observing gate.
- Given the same failure is observed twice (for example after a re-run), when recording runs both
  times, then exactly one repair record exists for it.

#### Negative Paths
- Given two failures with identical content observed against the same advance, when recording runs,
  then they collapse to one record rather than accumulating duplicates.
- Given two DIFFERENT failures against the same advance, when recording runs, then both are
  retained — the previous behavior of consuming an advance after its first record must not persist.
- Given concurrent recording attempts for the same feature, when both write, then no record is lost
  and the ledger remains valid JSON.
- Given the ledger lock cannot be acquired within its bound, when recording runs, then the failure
  surfaces rather than silently discarding the record.

### Done When
- [ ] One advance invalidating two things yields two repair records.
- [ ] A non-full-suite gate can produce a repair record, and the record names the observing gate.
- [ ] Re-observing an identical failure does not create a second record.
- [ ] Concurrent recording preserves all distinct records and leaves valid JSON.

---

## Story 6: An operator can tell how a finding was graded

**Requirement:** ADR-D4 / O5

As an operator diagnosing a build_review finding, I want the run's artifacts to say whether repair
context was available at grading time, so I do not have to infer it from an empty block.

### Acceptance Criteria

#### Happy Path
- Given grading runs with one or more repair records available, when the run's artifacts are read,
  then they record that grading occurred WITH repair context, including how many records.
- Given grading runs with no repair records and no base advance recorded for the feature, when the
  artifacts are read, then they record that no repair context was warranted.
- Given grading runs with no repair records but at least one base advance recorded, when the
  artifacts are read, then they record that repair context was absent because no failure joined to
  an advance — distinguishable from the previous case.

#### Negative Paths
- Given the provenance record cannot be written, when grading runs, then grading still completes
  and produces its verdict rather than failing.
- Given a feature whose base never advanced, when the artifacts are read, then the "no advance"
  case is reported and is NOT reported as a failed join.
- Given provenance is recorded, when the graded diff is computed, then the provenance artifact does
  not appear in that diff, so it cannot itself be graded as unplanned work.

### Done When
- [ ] The three cases — context available, none warranted, none because no join — are separately
      distinguishable from run artifacts alone.
- [ ] The count of available repair records is recorded when context is present.
- [ ] A provenance write failure does not fail grading.
- [ ] Provenance output is excluded from the graded diff.

---

## Story 7: Repair records are evidence the grader weighs, not an exemption

**Requirement:** ADR-D5, AR-C2 / O1, O4

As the harness, I want repair records presented to the grader as evidence rather than as an
automatic pass, so that a base advance never becomes blanket permission to remove coverage.

### Acceptance Criteria

#### Happy Path
- Given one or more repair records exist, when the grader's inputs are assembled, then each record
  is rendered in the repair-context block with its identifier and diagnostic.
- Given repair records are present, when the grader's instructions are assembled, then they still
  frame the block as evidence to judge against, not as an instruction to pass.
- Given the diff contains a change that does NOT correspond to any recorded repair, when grading
  runs, then that change is still judged on its own merits.

#### Negative Paths
- Given no repair records exist, when the block is rendered, then it renders its explicit
  empty-state rather than being omitted or rendering as an error.
- Given repair records exist and other engine-computed evidence blocks are also present, when the
  inputs are assembled, then each block renders independently and no assertion depends on how many
  evidence blocks exist in total.
- Given a repair record exists for one deleted path, when the diff also deletes a second, unrelated
  path, then the unrelated deletion remains gradeable and is not covered by the record.

### Done When
- [ ] Each repair record renders in the grader's repair-context block with identifier and
      diagnostic.
- [ ] The empty state renders explicitly when there are no records.
- [ ] No test or assertion depends on the total number of evidence blocks, so the in-flight
      `removalContext` work can land in either order.
- [ ] A deletion not covered by a repair record is still gradeable.

---

## Story 8: A ledger written by the previous engine reads forward-compatibly

**Requirement:** AR-C3 / O3

As a feature already in flight when this change lands, I want an older repair ledger to read as
empty rather than as corrupt, so that upgrading mid-build neither crashes nor invents repair
context.

### Acceptance Criteria

#### Happy Path
- Given a repair ledger written by the previous engine (carrying the old advance-consumption
  field), when it is read by the new code, then it yields zero repair records and no error.
- Given such a ledger, when a new repair is recorded against it, then the write succeeds and the
  resulting ledger is valid in the new shape.
- Given no ledger file exists at all, when it is read, then it yields zero repair records and no
  error.

#### Negative Paths
- Given a ledger whose content is not valid JSON, when it is read, then it yields zero repair
  records rather than throwing, and grading proceeds as if no context existed.
- Given a ledger containing a record missing a required field, when it is read, then that record is
  skipped and the remaining well-formed records are returned.
- Given an old-shape ledger, when it is read, then NO repair record is fabricated from the old
  advance-consumption field — an upgrade must not manufacture context that was never recorded.

### Done When
- [ ] An old-shape ledger reads as zero records, with no error and no fabricated record.
- [ ] An unparseable ledger reads as zero records without throwing.
- [ ] A record missing a required field is skipped while its well-formed siblings survive.
- [ ] Recording against an old-shape ledger produces a valid new-shape ledger.
