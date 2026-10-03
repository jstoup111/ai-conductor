**Status:** Accepted

# Stories: Test-tagged Done-when checks are verified at task close

Track: technical (no PRD). Tier: M.
Architecture: `.docs/decisions/architecture-review-2026-10-02-tasks-close-with-boilerplate-done-when-evidence-mi.md`
Governing decision: `adr-2026-08-22-done-when-evidence-at-task-close` D5-D9.
Source: jstoup111/ai-conductor#2758

## Story 1: The plan marks test-requiring checks and land validates the mark

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D5

As the operator, I want the plan to say which Done-when checks need a test, so that task close knows which checks it must verify without guessing from wording.

### Acceptance Criteria

#### Happy Path
- Given a plan task whose Done-when block has a check beginning with the `[test]` tag and an untagged check, when the spec is landed, then land accepts the plan and the parsed check text still begins with `[test]` exactly as authored.
- Given a coherence row that quotes a fragment of a `[test]`-tagged check without the tag, when the coherence gate runs at land, then the quote is still found in the cited task's Done-when checks.

#### Negative Paths
- Given a plan check that begins with a malformed tag such as `[tests]` or `[Test]`, when the spec is landed, then land refuses it naming the task id and the check, and no waiver file makes it pass.
- Given a plan check that consists of the `[test]` tag with no check text after it, when the spec is landed, then land refuses it naming the task id as a blank check.

### Done When
- [ ] Land output for a malformed or empty tag names the task id and the offending check text.
- [ ] A plan with no tags at all lands with the same result it had before this change.

## Story 2: A tagged check closes only on a verified test reference

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D6

This narrows the existing rule that `conduct task done` records any evidence for every declared check: for a `[test]`-tagged check only, the evidence must be a verifiable test reference or an explicit unverified close.

As the operator, I want a tagged check to close only when the test it relies on really exists and declares what it covers, so that missing tests are caught at task close instead of in a `prd_audit` lap.

### Acceptance Criteria

#### Happy Path
- Given task 3 has a `[test]` check and HEAD has a test file containing the cited title and a `Covers: task:3` marker, when `conduct task done 3` cites that file and title for the check, then the task completes and the check's close record has source `verified`.
- Given task 3's `Story:` line cites Story 2 and the cited test file carries `Covers: S2.1` instead of a task marker, when the check is closed with that reference, then the check's close record has source `verified`.
- Given the cited test file was committed before the feature branch and is unchanged in the feature diff, when the check is closed with a reference to it, then the check's close record has source `verified`.
- Given `conduct task done` is run from a subdirectory of the worktree, when a check cites a test path relative to the repository root, then the path resolves from the repository root and the check verifies.

#### Negative Paths
- Given a tagged check, when it is closed with free-text evidence that names no test file and title, then the close is refused naming the check number and text, and the task stays not completed.
- Given a tagged check, when it is closed citing a test file that does not exist at HEAD, then the close is refused naming the check and the missing path.
- Given a tagged check, when it is closed citing a file at HEAD whose content does not contain the cited title after whitespace normalization, then the close is refused naming the check and the missing title.
- Given a tagged check, when it is closed citing a file at HEAD that contains the title but whose `Covers:` markers name neither the task nor any criterion of the stories the task cites, then the close is refused naming the check and the missing marker.
- Given a test file that exists only in the working tree and is not committed, when a tagged check cites it, then the close is refused because the file is absent at HEAD.
- Given a test file in a language this repository does not use, when a tagged check cites it with a matching title and `Covers:` marker, then the check verifies exactly as a TypeScript test would.

### Done When
- [ ] Every refusal message names the check number, the check text, and which part of the reference failed.
- [ ] Each close record in task status carries one of the sources `verified`, `reported`, `verify-only`, or `unverified`.

## Story 3: Untagged checks and older plans close exactly as before

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D6

As the operator, I want checks that do not need a test to keep closing on ordinary evidence, so that config and documentation checks are never refused spuriously.

### Acceptance Criteria

#### Happy Path
- Given an untagged check such as a configuration assertion, when it is closed with free-text evidence, then the task completes and the check's close record has source `reported`.
- Given a task with one tagged and one untagged check, when the tagged check cites a verifiable test and the untagged check has free-text evidence, then the task completes with sources `verified` and `reported` respectively.

#### Negative Paths
- Given a plan with no `[test]` tags, when every task is closed with the same free-text evidence accepted before this change, then no close is refused.
- Given a task-status file whose close records were written before this change and have no new source values, when BUILD and `prd_audit` read it, then both proceed without error and treat those records as `reported`.

### Done When
- [ ] Untagged-check close behavior is unchanged for plans authored before this change.

## Story 4: A tagged check that cannot be verified closes as unverified, never as a plan-gap

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D7

As the operator, I want an agent that cannot produce a test to record that honestly instead of halting, so that a missing test never becomes an operator halt.

### Acceptance Criteria

#### Happy Path
- Given a tagged check 2 on task 5, when `conduct task done 5` closes check 2 as unverified with a reason and the other checks with valid evidence, then task 5 completes and check 2's close record has source `unverified` and that reason.
- Given a verify-only task with a tagged check, when the check is closed as unverified with a reason, then the task completes and the record has source `unverified`.

#### Negative Paths
- Given a tagged check, when it is closed as unverified with an empty reason, then the close is refused naming the check.
- Given a tagged check whose test reference was refused, when the refusal is printed, then it directs the agent to write or cite the test or close the check as unverified and never directs it to `--plan-gap`.
- Given a verify-only task with a tagged check, when `conduct task done` closes the task with no evidence for that check, then the close is refused naming the check, while its untagged checks still close by the prove-closed path.
- Given every task completed but some checks unverified, when BUILD evaluates task progress, then the run is not counted as making no task progress.

### Done When
- [ ] The `task done` usage text documents the unverified close form with a per-check reason.
- [ ] No new halt class appears in halt classification.

## Story 5: Unverified checks get one nudge, then BUILD completes and records them

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D8

Only checks carrying an explicit `unverified` task-close record count as unverified. A build whose tasks are all resolved and which has no such record completes exactly as before.

As the operator, I want BUILD to get one chance to fix unverified checks before moving on, so that most gaps are fixed while the code is fresh and none of them stalls the feature.

### Acceptance Criteria

#### Happy Path
- Given every plan task is resolved and two checks are unverified, when the BUILD session ends and no nudge has been spent in this lap, then BUILD is not completed and the retry hint names both checks by task id and check text.
- Given the nudge was spent in this lap and one check is still unverified, when the next BUILD session ends with every task resolved, then BUILD completes and one event is recorded naming the still-unverified check.
- Given every plan task is resolved and no check is unverified, when the BUILD session ends, then BUILD completes with no nudge and no unverified-checks event.

#### Negative Paths
- Given the nudge turn produces no new commit, when the progress-aware halt accounting runs, then the no-evidence attempt count is unchanged by the nudge.
- Given the nudge was spent and the daemon process restarts before the next BUILD session, when BUILD resumes in the same lap, then no second nudge is given.
- Given the per-step retry budget is already exhausted when unverified checks remain, when the BUILD session ends, then no nudge is given and the step follows its existing exhaustion behavior with no new halt class.
- Given the nudge turn writes a test but leaves it uncommitted, when the BUILD session ends, then the existing uncommitted-work floor withholds completion exactly as it does for any other turn.
- Given some plan tasks are still pending, when the BUILD session ends, then the pending tasks are reported as before and the nudge does not replace or hide that reason.
- Given a task with a `[test]` check that was resolved by a no-diff skipped stamp or a verify-only stamp and so has no task-close record for that check, when the BUILD session ends with every task resolved, then that check is not counted as unverified and BUILD completes with no nudge.

### Done When
- [ ] The unverified-checks event is part of the event union and has an event-sink registry row.
- [ ] The nudge-spent state is held in engine state, not in a new sidecar file.

## Story 6: prd_audit receives the unverified checks as input

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D8

As the operator, I want `prd_audit` to be told which checks were closed unverified, so that it grades known gaps directly instead of spending a lap rediscovering them.

### Acceptance Criteria

#### Happy Path
- Given BUILD completed with an unverified check on task 4, when `prd_audit` assembles its engine-owned input, then the input includes task 4, the check text, and the recorded reason.

#### Negative Paths
- Given no check was closed unverified, when `prd_audit` assembles its input, then the unverified-checks field is present and empty.
- Given a task-status file written before this change, when `prd_audit` assembles its input, then assembly succeeds and the unverified-checks field is empty.

### Done When
- [ ] The unverified-checks field is part of the versioned `prd_audit` input and of its input identity.

## Story 7: Remediation tasks appended for a criterion carry the test tag

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D9

As the operator, I want repairs for an unmet story criterion to require a real covering test, so that remediation laps cannot close on boilerplate either.

### Acceptance Criteria

#### Happy Path
- Given a `prd_audit` FIXABLE finding bound to criterion S3.6, when the remediation task is appended to the plan, then its criterion check begins with the `[test]` tag.

#### Negative Paths
- Given an as-built REMEDIABLE finding, when its remediation task is appended, then none of its checks carry the `[test]` tag.
- Given an appended criterion-bound remediation task, when the amended plan is validated by the Done-when shape rule, then it has between two and five non-blank checks and passes.
- Given an appended criterion-bound remediation task whose test cannot be produced, when BUILD closes its tagged check as unverified with a reason, then the task completes without a halt.

### Done When
- [ ] Appended criterion-bound remediation tasks parse with a tagged criterion check through the same plan parser as authored tasks.
