**Status:** Accepted

# Stories: Done-when `[test]` citations are proven by provenance or judgement

Track: technical (no PRD). Tier: M.
Architecture: `.docs/decisions/architecture-review-2026-10-21-done-when-closes-as-verified-citing-tests-that-don.md`
Governing decisions: `adr-2026-08-22-done-when-evidence-at-task-close` D10-D18; `adr-2026-09-06-reopened-task-resolution` decision 13.
Source: jstoup111/ai-conductor#3200

## Story 1: Task start records the commit the task started from

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D10

As the operator, I want each task to remember the commit it started from, so that task close can tell which tests the task itself wrote without reading `Task:` trailers.

### Acceptance Criteria

#### Happy Path
- Given task 4 is pending and HEAD is commit A, when `conduct task start 4` runs, then task 4's task-status row is `in_progress` and records commit A as its start commit.
- Given task 4 already recorded commit A as its start commit and HEAD has since moved to commit B, when `conduct task start 4` runs again, then the row still records commit A as its start commit.
- Given a Claude Code BUILD session dispatches a subagent whose prompt starts with `Task: 4` while HEAD is commit A, when the session hook marks task 4 `in_progress`, then task 4's row records commit A as its start commit.

#### Negative Paths
- Given `conduct task start 4` runs where `git rev-parse HEAD` fails, when the start completes, then the row is `in_progress` with no start commit recorded and the command still exits 0.
- Given a task-status row written before this change with no start commit field, when that task is closed, then the close reads the missing field as no start commit and does not fail on it.
- Given the session hook cannot read HEAD when it marks task 4 `in_progress`, when the hook completes, then the row is `in_progress` with no start commit recorded and the subagent dispatch is not blocked.
- Given task 4's row records start commit A, when the task-status file is reseeded or task 4 is restaged by a repair reopen, then the row still records commit A.
- Given task 4's row records start commit A and a file-changing rebase maps A to A', when rebase translation rewrites task-status SHAs, then the row records A'; when the rebase map has no entry for A, the row keeps A unchanged.

### Done When
- [ ] The task-status row written by `conduct task start` carries the start commit SHA in an additive field, and every other field of the row is unchanged.
- [ ] Re-starting a task never overwrites a start commit it already recorded, on either start path.

## Story 2: A test the task itself wrote closes a `[test]` check as verified

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D11

As the operator, I want a test written for the task to close its check at once with no extra cost, so that honest closes stay as cheap and fast as today.

### Acceptance Criteria

#### Happy Path
- Given task 4 started at commit A and a commit after A adds a test whose title line contains the cited title to a file carrying `Covers: task:4`, when `conduct task done 4` cites that file and title for its `[test]` check, then the check's close record has source `verified` and no judgement is requested.
- Given the cited title is split across two added lines with different whitespace, when the check is closed, then the whitespace-normalized added lines are matched and the check's close record has source `verified`.
- Given a different task added the cited test in a commit after task 4's start commit, when task 4 closes its check citing that test, then the check's close record has source `verified`.

#### Negative Paths
- Given the cited test passes every existing text check but its title line was committed before task 4's start commit, when task 4 closes the check citing it, then the check is not recorded as `verified`.
- Given the cited test predates the start commit and a later commit only adds an assertion inside its body, leaving its title line unchanged, when the check is closed, then the check is not recorded as `verified`.
- Given a cited title appears on an added line only in a different file than the cited path, when the check is closed, then the check is not recorded as `verified`.
- Given the cited reference fails an existing text check such as a missing title, when the check is closed, then the close is refused exactly as before this change and no close record is written.

### Done When
- [ ] Provenance is decided by `git` and text only, with no language, framework, or AST parsing.
- [ ] Provenance never reads a `Task:` trailer.

## Story 3: Any other citation closes the task pending judgement

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D12, D17

As the operator, I want a citation of a test the task did not write to be held for judgement instead of trusted, so that BUILD cannot close a check as verified by naming an unrelated existing test.

### Acceptance Criteria

#### Happy Path
- Given task 24's `[test]` check cites a test whose title line predates task 24's start commit and passes every existing text check, when `conduct task done 24` runs, then task 24 is `completed` and that check's close record has source `pending-judgement`.
- Given task 24 was closed without ever being started, so it has no start commit, when its `[test]` check cites any existing test that passes the text checks, then the check's close record has source `pending-judgement`.

#### Negative Paths
- Given task 24's start commit is no longer an ancestor of HEAD after a rebase, when its `[test]` check cites a test added after that start commit, then the check's close record has source `pending-judgement`, not `verified`.
- Given task 24 has one untagged check and one `[test]` check citing a pre-existing test, when the task closes, then the untagged check is recorded `reported` exactly as before and only the tagged check is `pending-judgement`.
- Given a close record whose source is none of `verified`, `reported`, `verify-only`, `unverified`, `pending-judgement`, `judged`, or `operator-accepted`, when any engine reader of close records reads it, then the reader rejects it by name instead of treating it as one of the known sources.

### Done When
- [ ] `conduct task done` runs no model and emits no event for a pending close.
- [ ] The BUILD pipeline skill tells the agent that a pending close is judged when the BUILD session ends, and how to answer a refused citation, without naming any operator-only command outside an operator-only region.

## Story 4: Pending citations are judged when the BUILD session ends

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D13, D14

As the operator, I want each held citation judged on whether the cited test asserts the check before BUILD hands off to review, so that a wrong citation is caught inside BUILD rather than laps later.

### Acceptance Criteria

#### Happy Path
- Given a BUILD session ends with two pending citations on tasks 7 and 9, when the conductor evaluates BUILD completion, then exactly one judgement dispatch is made covering both citations before the completion predicate runs.
- Given the judgement returns asserts with a reason for task 7's check, when the verdict is applied, then the check's close record has source `judged` and carries that reason.
- Given a BUILD session ends with no pending citations, when the conductor evaluates BUILD completion, then no judgement is dispatched.
- Given the judgement input for a citation, when it is built, then it contains the check text, the task text, the cited path and title, and the cited file's content at HEAD bounded to a fixed size around the title.

#### Negative Paths
- Given the first judgement dispatch returns output that does not match the schema, when the conductor handles it, then it retries the dispatch once and no citation is recorded as refused.
- Given the judgement output omits a verdict for one of the pending citations, when the output is validated, then the whole output is treated as a failed dispatch and no verdict from it is applied.
- Given the judgement returns a verdict for a task and check that was not in the pending set, when the verdict is applied, then that verdict is ignored and no close record changes for it.

### Done When
- [ ] The judgement is dispatched with the provider's native output schema and its result is validated by the engine before any close record changes.
- [ ] The judgement is read-only and runs in the conductor, never inside `conduct task done`.

## Story 5: A refused citation reopens the task, bounded, and never halts

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D14; adr-2026-09-06-reopened-task-resolution decision 13

As the operator, I want a citation the judge refuses to send the task back to BUILD at once with the reason, so that BUILD writes a real test while the context is fresh.

### Acceptance Criteria

#### Happy Path
- Given the judgement returns does-not-assert with a reason for task 24's check and a BUILD attempt remains, when the verdict is applied, then task 24 is reopened, BUILD completion is withheld, and the BUILD retry hint names task 24, the check, the cited reference, and the reason.
- Given task 24 was reopened by a refused citation and BUILD then re-closes the check citing a test it added after the reopen, when the next BUILD session ends, then the check's close record has source `verified` and task 24 counts as resolved.
- Given task 24 was reopened by a refused citation and BUILD re-closes the check citing another pre-existing test, when the next BUILD session ends, then the new citation is judged again.
- Given checks 2 and 3 of task 24 are both refused in the same judgement pass, when the refusals are applied, then exactly one citation reopen is live for task 24 and it lists both checks.

#### Negative Paths
- Given task 24 was reopened by a refused citation and has `Task: 24` commits from before the reopen, when BUILD completion resolves tasks, then task 24 is not counted as resolved by those commits.
- Given the same check of task 24 is refused a second time, when the verdict is applied, then the check is recorded `unverified` with the judge's reason, task 24 is not reopened again, and BUILD continues.
- Given a refusal arrives when BUILD has no attempt left in its retry budget, when the verdict is applied, then the check is recorded `unverified` with the judge's reason instead of reopening the task, and the BUILD step does not fail because of the refusal.
- Given task 24 was reopened by a refused citation and the next BUILD session ends without re-closing the refused check, with or without a new `Task: 24` commit, when that session end is evaluated, then the refused check is recorded `unverified` with the judge's reason, task 24's citation reopen is resolved, and task 24 is not reopened again for it.
- Given a refused citation withheld BUILD completion, when the no-progress breaker and the daemon stall check evaluate that attempt and the next one, then the withheld attempt does not increment `noEvidenceAttempts` and neither check reports a stall or halts the feature because of the reopen.
- Given the engine process restarts after a refusal reopened task 24 but before BUILD re-entered, when the run resumes, then task 24 is still reopened, the refusal count is unchanged, and the refusal is not admitted twice.
- Given a refusal on task 24's check and the plan text of that check is later changed, when the changed check is refused, then it is counted as a first refusal of the new check text.
- Given task 24's citation reopen lists a check whose text no longer appears in the current plan task, when the engine next evaluates that reopen, then the stale check's refusal is dropped and the reopen resolves once no listed check is still open.

### Done When
- [ ] The reopen is admitted through the existing repair-obligation path with source authority `done-when-citation`, one live obligation per task, and charges no review lap or gate allowance.
- [ ] The BUILD retry hint for a refusal names no operator-only command.
- [ ] Demoted checks appear in `prd_audit`'s input as unverified close records carrying the judge's reason.

## Story 6: A judgement that cannot run never blocks BUILD

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D15

As the operator, I want a judge outage to fall back to the existing unverified path, so that a provider problem never stops a feature.

### Acceptance Criteria

#### Happy Path
- Given pending citations exist and no candidate provider declares native output schema support, when BUILD completion is evaluated, then every pending check is recorded `unverified` with a reason beginning `citation judgement unavailable:` and BUILD proceeds.

#### Negative Paths
- Given the judgement dispatch fails twice with a provider error, when BUILD completion is evaluated, then every pending check is recorded `unverified` with a reason beginning `citation judgement unavailable:` naming the failure, and no task is reopened.
- Given the first dispatch fails and the retry succeeds, when the verdicts are applied, then no check is demoted because of the first failure.
- Given every pending check was demoted because the judgement was unavailable, when BUILD completion runs, then the existing one-nudge unverified handling applies to those checks unchanged.

### Done When
- [ ] No outcome of the citation judgement writes a HALT or fails the BUILD step.

## Story 7: The operator overturns a wrong refusal

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D16

As the operator, I want a single command that accepts a citation the judge wrongly refused, so that a wrong refusal is unblocked and the override is recorded.

### Acceptance Criteria

#### Happy Path
- Given task 24's check 3 was refused by the judgement as task 24's only refused check and task 24 is reopened, when the operator runs `ai-conductor done-when accept --feature <slug> --task 24 --check 3 --reason "covers the moved-state crash path"`, then check 3's close record has source `operator-accepted` with that reason, task 24's citation reopen is resolved, and the command exits 0.
- Given task 24's check 3 was demoted to `unverified` after two refusals, when the operator accepts it with a reason, then check 3's close record has source `operator-accepted` and it no longer appears among unverified close records.
- Given task 24's citation reopen lists checks 2 and 3, when the operator accepts check 3 only, then check 3 is `operator-accepted`, task 24 stays reopened for check 2, and the reopen resolves only once check 2 is settled.

#### Negative Paths
- Given the command runs inside a daemon-managed session, when `ai-conductor done-when accept` is invoked, then the daemon-session guard refuses it, exits 1, and no close record changes.
- Given task 24's check 3 has no recorded refusal, when the operator runs the accept command for it, then the command exits 1 naming that the check has no refused citation and nothing changes.
- Given the reason is empty or whitespace, when the accept command runs, then it exits 1 naming the missing reason and nothing changes.
- Given an unknown feature slug, task id, or check number, when the accept command runs, then it exits 1 naming the unknown value and nothing changes.
- Given an extra or missing flag, when the accept command runs, then it is not recognized as an accept command and nothing changes.

### Done When
- [ ] The accept command is not a session-sanctioned subcommand, and a refusal inside a dispatched session reports `done-when` as its bounded subcommand.
- [ ] The override survives as the close record plus an event on the existing event spine.

## Story 8: Citation judgement and acceptance are observable

**Requirement:** adr-2026-08-22-done-when-evidence-at-task-close D18

As the operator, I want every judgement pass and every acceptance recorded on the event spine, so that I can see why a check closed the way it did.

### Acceptance Criteria

#### Happy Path
- Given a judgement pass judged task 7's check as asserts and refused task 24's check, when the pass completes, then one event is persisted to `events.jsonl` listing each citation's task, check, and verdict.
- Given the operator accepts task 24's check 3, when the command completes, then one event is persisted naming the task, the check, and the reason.

#### Negative Paths
- Given a judgement pass demoted every pending check because the judgement was unavailable, when the pass completes, then the persisted event lists each demoted check with the unavailability cause instead of a verdict.
- Given no pending citations at the end of a BUILD session, when BUILD completion is evaluated, then no citation-judgement event is emitted.

### Done When
- [ ] Both events are members of the `ConductorEvent` union with `EVENT_SINKS` rows.
