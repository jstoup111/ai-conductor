**Status:** Accepted

# Stories: Fail closed when build_review cannot resolve which plan (#2179)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the plan-selection outcome the build_review step reads, and the step's own branch on it. Recording of the active plan, retry routing, and rubric policy remain outside this slice.

## Story 1: Refuse a review whose plan cannot be identified

As a harness operator, I want a review step that cannot tell which plan it is grading to stop and say so, so that an ungraded feature never carries a durable passing verdict.

### Acceptance Criteria

#### Happy Path

- Given no engine-recorded active plan, several plan files on disk, and a feature description matching none of their stems, when the build_review step runs, then the step fails with a needs-human refusal whose reason names the unresolved feature description and every candidate plan stem.
- Given that same unresolvable state, when the build_review step runs, then no build-review verdict artifact is written and no grader provider is invoked.

#### Negative Paths

- Given that same unresolvable state but a plan path supplied explicitly by the caller, when the build_review step runs, then it grades that plan and the ambiguity refusal is never raised.

### Done When

- [ ] A build_review runner case with several unmatched candidate plans observes a needs-human refusal naming the feature description and every candidate stem.
- [ ] That same case observes no build-review verdict artifact on disk and no provider invocation.
- [ ] A caller-supplied plan path in the same unresolvable corpus reaches ordinary review instead of the refusal.

## Story 2: Keep passing a review that genuinely has nothing to grade

As a harness operator, I want a feature with no plan work at all to keep passing exactly as it does today, so that fixing the ambiguity case does not wedge production-only changes.

### Acceptance Criteria

#### Happy Path

- Given no plan files exist on disk and the test-quality rubric is opted in, when the build_review step runs, then it publishes the existing empty-scope PASS verdict with its current reason.
- Given exactly one plan file on disk, or several plan files of which one stem matches the feature description, when the build_review step runs, then that plan is graded and no empty-scope PASS is published.

#### Negative Paths

- Given no plan files exist and no rubric is enabled, when the build_review step runs, then it publishes the existing no-rubrics PASS reason rather than any refusal.

### Done When

- [ ] The pre-existing empty-scope runner case still succeeds and its verdict artifact still records the empty-scope reason.
- [ ] Single-plan and stem-matched multi-plan runner cases both reach ordinary review with no PASS shortcut.
- [ ] A no-plans, no-rubrics runner case publishes the no-rubrics PASS reason and raises no refusal.

## Story 3: Report why feature-plan selection failed

As an engine maintainer, I want one selection seam that distinguishes an empty plan corpus from an unresolvable one, so that a caller can fail closed without every other caller changing.

### Acceptance Criteria

#### Happy Path

- Given an engine-recorded active plan, a single plan file, or a stem-matched plan among several, when the plan selection helper runs, then it reports a resolved outcome carrying the same absolute path the existing path-returning resolver returns today.
- Given several plan files and no recorded plan and no stem match, when the plan selection helper runs, then it reports an unresolvable outcome listing every candidate path.

#### Negative Paths

- Given no plan files exist at all, when the plan selection helper runs, then it reports an empty outcome distinct from the unresolvable outcome, while the existing path-returning resolver still returns nothing for both.

### Done When

- [ ] Unit cases cover recorded, single, stem-matched, unresolvable and empty inputs and assert the reported outcome kind for each.
- [ ] Every pre-existing case in the feature-plan resolution suite passes unchanged, including both cases that expect no path.

## Negative-category review

Invalid and ambiguous input is the subject of the change itself and is covered by Story 1 and Story 3. Partial failure and fail-open regression is covered by Story 1's assertion that no verdict artifact is written on the refusal path. Precedence conflict between an explicit caller override and the resolver ladder is covered by Story 1's negative path. Backward-compatibility risk to the other callers of the shared resolver is covered by Story 3's negative path. Auth, timeout, network, concurrency, resource exhaustion, deletion cascade and datastore categories are inapplicable: the change reads a local directory listing and a local state file already read on this path, adds no external call, no queue, no upload and no write beyond the existing verdict publisher, and both branches are decided before any provider dispatch.
