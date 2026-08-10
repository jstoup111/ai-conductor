**Status:** Accepted

# Stories: declared pattern replication for Nth-of-a-kind BUILD work

**Track:** technical — no PRD. Acceptance criteria live here. Each story cites the decision point
it derives from in `adr-2026-08-09-declared-pattern-replication-in-build.md` (D1–D5).

**Terminology.** A *declaration* is the pair of plan-header lines `**Pattern-source:**` and
`**Rename-map:**`. A *replication* is a feature whose plan carries a valid declaration. The
*source* is the existing in-repo pattern being replicated; the *target* is the new instance.

---

## Story 1: A plan declares the pattern it replicates

**Requirement:** ADR D1 (grammar)

As a plan author, I want to declare the source pattern and rename map in the plan header so that
the BUILD phase can replicate it instead of deriving everything from scratch.

### Acceptance Criteria

#### Happy Path
- Given a plan whose header contains `**Pattern-source:** src/conductor/src/engine/wired-into.ts`
  and a well-formed `**Rename-map:**`, when the plan is parsed, then a resolved declaration is
  returned carrying the source path exactly as written, with its case preserved.
- Given a rename map declaring `wired-into` → `pattern-source` and `WiredInto` → `PatternSource`,
  when the plan is parsed, then both pairs are present in the resolved map in declaration order.
- Given a plan header line written as a Markdown link or wrapped in inline code, when the plan is
  parsed, then the path resolves identically to the bare form.

#### Negative Paths
- Given a plan declaring a `**Pattern-source:**` path that does not exist on disk, when the plan is
  parsed, then resolution fails closed with a diagnostic naming the unresolved path, and no
  replication behavior is activated at any step.
- Given a plan declaring a `**Pattern-source:**` path containing `../` that escapes the repository
  root, when the plan is parsed, then resolution is refused with a traversal diagnostic, and the
  file is not read.
- Given a plan whose `**Rename-map:**` line is malformed, when the plan is parsed, then a
  `malformed` result is returned whose message enumerates the accepted forms, and no partial map
  is emitted.
- Given a plan declaring a rename-map pair whose left side is empty, when the plan is parsed, then
  the result is `malformed` and names the offending pair.
- Given a plan with neither header line, when the plan is parsed, then no declaration is returned
  and every downstream step behaves exactly as it does today, with no diagnostic and no warning.
- Given a plan declaring only `**Pattern-source:**` with no `**Rename-map:**`, when the plan is
  parsed, then the result is `malformed` naming the missing line — a half-declaration is never
  treated as an absent one.

### Done When
- [ ] A new engine module exports a resolver that returns a discriminated union with at least
      `resolved`, `absent`, and `malformed` variants, and `absent` is distinguishable from
      `malformed` by type, not by an empty value
- [ ] The resolver preserves path case and does not split the path on `+`
- [ ] `**Type:**` parsing in `autoheal.ts` is unchanged, and no declaration data flows through it
- [ ] Unit tests cover: bare path, inline-code path, Markdown-link path, nonexistent path,
      traversal path, malformed map, empty-left-side pair, both lines absent, source-only
- [ ] A plan with no declaration produces byte-identical downstream behavior to the pre-change baseline

---

## Story 2: Acceptance specs are copied from the source and must fail

**Requirement:** ADR D2

As an operator, I want `acceptance_specs` to copy and rename the source feature's specs rather
than derive them so that the RED evidence is produced without paying to re-author near-identical
specs.

### Acceptance Criteria

#### Happy Path
- Given a plan with a resolved declaration, when `acceptance_specs` runs, then the source feature's
  acceptance specs are copied to target paths derived by applying the rename map, and the copied
  spec bodies have the rename map applied to their contents.
- Given the copied specs are executed at `acceptance_specs` time, when the run completes, then at
  least one spec fails because the target does not yet exist, and the recorded RED evidence
  reports a non-zero failure count with zero errors and zero skips.

#### Negative Paths
- Given a plan with a resolved declaration whose source feature has no acceptance specs, when
  `acceptance_specs` runs, then the step fails closed with a diagnostic naming the source and the
  glob that matched nothing — it does not silently fall back to deriving specs from the stories.
- Given the copied specs are executed and **all of them pass**, when the run completes, then the
  step fails with a diagnostic stating that a copied spec cannot legitimately pass before the
  target exists, and names the passing specs. This is reported as a finding, never accepted as RED.
- Given a copied spec errors rather than fails (for example, an unresolvable import in the copied
  file), when the run completes, then the existing RED-evidence validation rejects it on the
  non-zero error count, and the diagnostic distinguishes an errored copy from a failing one.
- Given a target spec path derived from the rename map already exists on disk, when the copy is
  attempted, then the step fails closed naming the collision rather than overwriting the existing
  spec.
- Given a plan with no declaration, when `acceptance_specs` runs, then specs are derived from the
  stories exactly as today.

### Done When
- [ ] Copied specs land at rename-map-derived paths with the map applied to their contents
- [ ] The step's RED evidence reports non-zero failures, zero errors, zero skips
- [ ] An all-passing copied spec set fails the step with a diagnostic naming the passing specs
- [ ] An empty source spec set fails closed rather than falling back to derivation
- [ ] A target-path collision fails closed rather than overwriting
- [ ] Acceptance coverage runs the real internal flow with faithful fakes at every third-party
      boundary; no real external service is called

---

## Story 3: The copy is an explicit, declared plan task

**Requirement:** ADR D3

As an operator, I want the implementation copy to be a single declared task so that the large
mechanical diff is attributable, scoped, and reviewable rather than smeared across the build.

### Acceptance Criteria

#### Happy Path
- Given a plan with a resolved declaration, when the plan is authored, then it carries exactly one
  copy task whose `**Files:**` declaration lists every target path the copy will write.
- Given the copy task runs, when it completes, then every declared target file exists, contains the
  source content with the rename map applied, and no file outside the task's `**Files:**`
  declaration was written.
- Given the copy task runs, when it completes, then it consumed no LLM turns for the copy itself.

#### Negative Paths
- Given the copy task's `**Files:**` declaration omits a path the rename map implies, when the copy
  task runs, then it fails naming the undeclared path rather than writing outside its declaration.
- Given a source file is unreadable at copy time, when the copy task runs, then it fails closed
  naming the file, and no partially-copied target set is left behind.
- Given the copy task is attempted on a plan with no declaration, when it runs, then it fails
  naming the absent declaration — a copy task without a declaration is never valid.

### Done When
- [ ] Exactly one copy task exists per replication plan, with a complete `**Files:**` declaration
- [ ] Every declared target exists post-task with the rename map applied
- [ ] No file outside the declaration is written
- [ ] A partial failure leaves no partially-copied target set

---

## Story 4: The copy-equivalence check blocks on mismatch

**Requirement:** ADR D3, architecture-review Condition 1

As an operator, I want a mismatch between the copy and its source to fail the task so that the
feature's central safety claim is enforced by machinery rather than asserted in prose.

### Acceptance Criteria

#### Happy Path
- Given a completed copy task whose targets equal the source modulo the declared rename map, when
  the equivalence check runs, then it passes and the build proceeds.
- Given the check passes, when the result is recorded, then it names each verified source-target
  pair.

#### Negative Paths
- Given a target file differs from its source by content the rename map does not account for, when
  the equivalence check runs, then **the task fails** — the check does not emit a warning and
  allow the step to succeed. The diagnostic names the file and the first differing region.
- Given a source file has no corresponding target, when the check runs, then the task fails naming
  the missing target.
- Given a target file exists with no corresponding source, when the check runs, then the task fails
  naming the unexpected target.
- Given the rename map would map two distinct source paths onto one target path, when the check
  runs, then the task fails naming the collision.
- Given the equivalence check itself cannot run (a source path became unreadable between copy and
  check), when it is invoked, then it fails closed rather than reporting a pass.

### Done When
- [ ] A mismatch changes the task's success state to failure — verified by a test asserting the
      failing outcome, not merely the presence of a diagnostic string
- [ ] A test explicitly distinguishes this check from the advisory per-task floors, asserting that
      the advisory floors still warn-only while this check blocks
- [ ] Missing target, unexpected target, and rename-map collision each fail with a distinct message
- [ ] An unrunnable check fails closed

---

## Tie-break: whole-task satisfaction only

Stories 5 and 6 partition the task set, and the partition must be total and unambiguous. The rule,
added 2026-08-09 during conflict-check to close a coverage gap between them:

> A task closes via `Evidence: satisfied-by` **only if the copy satisfies every one of its
> acceptance criteria**. If any single criterion is unsatisfied, the whole task is a delta task and
> runs the full cycle. There is no partial closure, and no splitting of a task at build time to
> separate its satisfied criteria from its unsatisfied ones.

Ambiguity resolves toward the full cycle, never away from it. This makes the two stories jointly
exhaustive and mutually exclusive, so no task can be handed back and forth between them.

---

## Story 5: Tasks the copy already satisfies close on existing evidence

**Requirement:** ADR D4

As an operator, I want tasks whose criteria the copy already met to close through the existing
evidence form so that the build does not re-implement behavior the copy delivered.

### Acceptance Criteria

#### Happy Path
- Given the copy task committed as sha `X`, and a subsequent task whose acceptance criteria are
  satisfied by that commit, when the task closes, then it closes via the existing
  `Evidence: satisfied-by X` empty-commit form and the task is derived as complete.
- Given such a task closes, when the build completes, then the completeness rubric still evaluates
  it against the plan as it does any other task.

#### Negative Paths
- Given a task closes with `Evidence: satisfied-by` naming a sha that does not exist, when
  completion is derived, then the task is not treated as complete and the existing derivation
  reports the unresolvable sha.
- Given a task closes with `Evidence: satisfied-by` naming a sha that exists but is not an ancestor
  of HEAD, when completion is derived, then the task is not treated as complete.
- Given a task closes with `Evidence: satisfied-by` naming a sha on a plan with no declaration,
  when completion is derived, then existing behavior is unchanged — this story adds no new
  evidence form and relaxes no existing check.
- Given a task whose acceptance criteria are only **partly** satisfied by the copy, when its
  closure is decided, then the tie-break above applies and it runs the full cycle as a delta task;
  it is never closed as satisfied-by and never split.

### Done When
- [ ] Satisfied-by closure on a replication build uses the existing evidence form with no new
      variant introduced
- [ ] Nonexistent sha and non-ancestor sha both fail to derive completion
- [ ] No existing evidence-derivation check is relaxed, and a test pins that

---

## Story 6: Delta tasks run the full, unmodified TDD cycle

**Requirement:** ADR D4, and `adr-2026-07-21-s-tier-pipeline-knobs` D4's RED-first invariant

As an operator, I want every task that adds behavior the source lacks to write a failing test
first so that the saving comes from not repeating work, never from skipping verification.

### Acceptance Criteria

#### Happy Path
- Given a task that introduces behavior the source pattern does not have, when it is executed on a
  replication build, then it runs the complete cycle — a failing test first, then implementation —
  identically to the same task on a non-replication build.
- Given a replication build completes, when the step skip set is inspected, then it is identical to
  a non-replication build of the same tier.

#### Negative Paths
- Given a task that introduces new behavior attempts to close via `Evidence: satisfied-by`, when
  completion is derived, then the completeness rubric flags the task as not delivered, because the
  cited commit contains no change implementing that behavior.
- Given a replication declaration is present, when any step's skip set is computed, then no entry
  is added to any tier's skip list and no gate is disabled — pinned by a test asserting the skip
  set and the enabled-gate set are unchanged from the pre-change baseline.
- Given a delta task's first test passes immediately, when the cycle runs, then the task does not
  advance to implementation; the passing test is investigated and either the criterion is already
  satisfied by the copy (closing per Story 5) or the test is wrong.

### Done When
- [ ] A delta task on a replication build executes the same cycle as on a non-replication build
- [ ] A test pins that the tier skip set and enabled-gate set are unchanged by the presence of a
      declaration
- [ ] No entry is added to any `skippableForTiers` list anywhere in the diff
- [ ] A new-behavior task cannot be closed by citing the copy commit

---

## Story 7: Duplication review is informed, not silenced

**Requirement:** ADR D5, architecture-review Condition 2

As an operator, I want the batch-boundary duplication review to stop reflex-flagging a declared
replication while still catching genuine accidental duplication so that the review keeps its value.

### Acceptance Criteria

#### Happy Path
- Given a diff containing a declared replication, when the batch-boundary duplication review runs,
  then the declared replication is not reported as an extract-with-parameters finding on the
  grounds of similarity to its source alone.
- Given the review examines a declared replication and judges that extraction is genuinely
  warranted on its merits, when it reports, then it may still propose extraction, and the proposal
  states why it overrides the declaration.

#### Negative Paths
- Given the same diff also contains duplication that is **not** covered by the declaration, when
  the review runs, then that duplication is flagged exactly as it is today.
- Given a diff contains duplication that resembles the declared source but involves files outside
  the declaration's target set, when the review runs, then it is flagged — suppression is scoped to
  the declared target set, never to the whole diff.
- Given a plan with no declaration, when the review runs, then its behavior is unchanged from today.

### Done When
- [ ] Suppression applies only to source-target pairs named by the resolved declaration
- [ ] Undeclared duplication in the same diff is still flagged
- [ ] The review retains the ability to propose extraction on a declared replication, with a stated
      rationale
- [ ] Behavior on a plan with no declaration is unchanged

---

## Cross-cutting acceptance

These apply to every story above and are verified once.

- [ ] All new prose is provider-neutral: any host-specific invocation mechanic is scoped to its
      host on the same line, and no instruction assumes one host's subagent facility, slash-command
      syntax, or settings file
- [ ] Unit tests inject mocked adapters; acceptance and integration coverage runs the real internal
      flow with faithful fakes at every third-party boundary; no default-suite test calls a real
      external service
- [ ] A plan carrying no declaration produces behavior byte-identical to the pre-change baseline at
      every affected step

**Status:** Accepted
