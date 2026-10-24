**Status:** Accepted

# Stories: FINISH reports the real PR-publish failure instead of "pr.prose unchanged"

Source: jstoup111/ai-conductor#3376. Technical track; governed by
adr-2026-10-24-finish-surfaces-guarded-publish-failures. The `gh pr edit` transport and
credential-fallback classification are out of scope.

## Story 1: A failed guarded GitHub operation is recorded on the event spine

**Requirement:** adr-2026-10-24-finish-surfaces-guarded-publish-failures D1, D2

As an operator diagnosing a halted feature, I want every failed guarded GitHub operation to appear on the event spine with its failure text, so that I never have to read a provider session log to find it.

### Acceptance Criteria

#### Happy Path
- Given a worktree and a valid `pull-request.edit` request file, when `ai-conductor github-operation --request-file` runs and the GitHub command fails with a missing-scope error, then exactly one `github_operation_failed` record is appended to that worktree's `.pipeline/pipeline-events.jsonl` with `operation` `pull-request.edit`, the request's pull-request target, and an `error` that contains the missing-scope message, and the CLI still prints its `failed` result and exits 1
- Given a failed operation other than a PR edit, such as `pull-request.comment.create`, when the CLI reports `failed`, then a `github_operation_failed` record is appended with that operation and target
- Given a feature whose session event tail is running, when a `github_operation_failed` record is appended to the sibling ledger, then the same event is emitted on the live bus and persisted to the worktree's `.pipeline/events.jsonl` by the engine

#### Negative Paths
- Given a failure whose text begins with `Command failed: gh pr edit 3372 -R owner/repo --title … --body …` followed by the GitHub error, when the event is recorded, then its `error` excludes the command line and request body, keeps the GitHub error text, and is at most 1000 characters long
- Given a failure whose GitHub error text alone exceeds 1000 characters, when the event is recorded, then `error` is truncated to 1000 characters and the record is still a single well-formed JSON line
- Given a request the CLI refuses, for example an unauthorized target or a malformed request file, when the CLI exits 1, then no `github_operation_failed` record is written
- Given an operation that executes successfully, when the CLI exits 0, then no `github_operation_failed` record is written
- Given a failed operation, when the CLI records the event, then it does not append the `github_operation_failed` record to `.pipeline/events.jsonl` itself; only the engine writes that file
- Given a sibling ledger that cannot be written, for example because `.pipeline` is not writable, when an operation fails, then the CLI still prints its `failed` result and exits 1, with no crash and no different exit code
- Given a sibling ledger containing a `github_operation_failed` record, when the session tail polls it, then it does not emit an `unadmitted-type` `pipeline_tail_diagnostic` for that record

### Done When
- [ ] A CLI test with a failing GitHub runner asserts one `github_operation_failed` line in `.pipeline/pipeline-events.jsonl` with operation, target, and the bounded error, plus the unchanged stdout result and exit code 1
- [ ] A test asserts that the argv prefix and request body are absent from `error` and that `error` is at most 1000 characters
- [ ] Tests assert no record is written for refused and executed results
- [ ] A tail test asserts the admitted record is re-emitted on the bus without an `unadmitted-type` diagnostic

## Story 2: FINISH halts with the underlying publish failure, not "unchanged"

**Requirement:** adr-2026-10-24-finish-surfaces-guarded-publish-failures D3, D4

As an operator, I want a FINISH halt caused by a failed PR publish to name that failure, so that the halt reason points at the real fix.

### Acceptance Criteria

#### Happy Path
- Given a feature PR whose prose is the engine placeholder, when the authoring pass completes successfully and a `github_operation_failed` record for `pull-request.edit` on that same PR was appended to the sibling ledger during the pass, and re-observation still shows placeholder prose, then FINISH resolves `human_required` with reason `publication_operation_failed`
- Given that halt, when it is rendered and persisted, then the halt message names a failed PR publish, the next action tells the operator to resolve the named failure and retry FINISH, the detail contains the recorded error text (for example the missing `read:org` scope message), and the `finish_publication_disposition` and `loop_halt` events carry that reason and detail
- Given that halt, when its reason text is inspected, then it does not contain "left pr.prose unchanged at placeholder"

#### Negative Paths
- Given a failure recorded during the pass, when re-observation shows the PR prose is no longer the placeholder, then the `author_pr_prose` transition advances normally and FINISH does not halt
- Given a `github_operation_failed` record for this PR appended before the pass started, and none during it, when the pass completes leaving placeholder prose, then the earlier failure is not attributed and FINISH resolves `publication_transition_unmoved` as today
- Given a failure recorded during the pass for a different pull-request number, a different repository, or a different operation such as `pull-request.comment.create`, when the pass completes leaving placeholder prose, then that record is not attributed and FINISH resolves `publication_transition_unmoved`
- Given two failures for this PR recorded during the pass, when FINISH halts, then the detail carries the error of the last recorded failure
- Given a sibling ledger that is missing or unreadable after the pass, when the pass completes leaving placeholder prose, then FINISH treats it as no recorded failure and resolves `publication_transition_unmoved`, with no crash
- Given a sibling ledger with a malformed line appended during the pass alongside a valid matching failure record, when FINISH reads the pass window, then the malformed line is skipped and the valid failure still produces `publication_operation_failed`
- Given an authoring dispatch that itself does not complete successfully, when a matching failure was also recorded, then FINISH follows the existing transient retry path (`authoring_dispatch_failed`) and does not resolve `publication_operation_failed`

### Done When
- [ ] A coordinator test reproduces #3376 (placeholder before and after, a matching recorded failure, a successful dispatch) and asserts `human_required` / `publication_operation_failed` with the error text in its detail
- [ ] `HUMAN_REQUIRED_REASONS` contains `publication_operation_failed` with a message and next action, and the rendered halt reason contains the error text
- [ ] Production `authorProse` tests assert attribution only for same-PR `pull-request.edit` failures appended after the pre-dispatch offset, with last-failure selection, and that a missing ledger and malformed lines are tolerated
- [ ] A test asserts that a recorded failure with moved prose advances the transition

## Story 3: A genuinely unchanged authoring pass keeps the existing halt

**Requirement:** adr-2026-10-24-finish-surfaces-guarded-publish-failures D5

As an operator, I want an authoring pass that simply failed to write prose, with no publish failure, to keep halting with the existing "unchanged" reason, so that the guard still catches a provider that did nothing.

### Acceptance Criteria

#### Happy Path
- Given a feature PR whose prose is the engine placeholder, when the authoring pass completes successfully, no `github_operation_failed` record was appended during the pass, and re-observation still shows placeholder prose, then FINISH resolves `human_required` / `publication_transition_unmoved` with the detail "The author_pr_prose transition left pr.prose unchanged at placeholder."

#### Negative Paths
- Given the same pass, when the sibling ledger received only records of other admitted kinds during the pass, then FINISH still resolves `publication_transition_unmoved`, not `publication_operation_failed`
- Given a pass that completes with no recorded failure and leaves authored prose, when re-observed, then the transition advances and no halt is produced

### Done When
- [ ] An existing or new coordinator test asserts the unchanged halt text for a completed pass with no recorded failure
- [ ] A test asserts that records of other admitted kinds in the pass window do not trigger `publication_operation_failed`
