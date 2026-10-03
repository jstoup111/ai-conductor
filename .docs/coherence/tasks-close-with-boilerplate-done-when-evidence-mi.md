# Coherence: Test-tagged Done-when checks are verified at task close

Source-Ref: jstoup111/ai-conductor#2758. Tier M, technical track (no PRD, so no `fr` rows).

Outcome mapping: outcome 1 is delivered by Story 2 and Story 4: a `[test]` check naming a test that is absent at HEAD cannot close, the refusal names the check and the missing path, title or marker, and the only alternative is an explicit unverified close. The operator chose HEAD rather than the feature diff as the existence test during explore, so a check relying on an existing test is not falsely refused; a test absent from the feature diff and absent at HEAD is refused exactly as the outcome asks. Outcome 2 is Story 2 (generic evidence refused at close) and Story 4 (no plan-gap escape). Outcome 3 is the closed close-record source set in Stories 2 and 4. Outcome 4 is Story 3. Outcome 5 is a post-ship measurement; Stories 2, 4, 5, 6 and 7 are the mechanisms that move it: refusal at close, one in-BUILD nudge, known gaps handed to `prd_audit`, and tagged criterion repairs.

Consistency pass: no cross-layer contradiction. Untagged checks keep reported evidence (Story 3) while tagged checks are refused without a verified reference (Story 2); the tag is explicit, so no check is both. The nudge (Story 5) withholds completion only when every task is resolved and explicit unverified records exist, so a fully resolved build without them completes, matching the merged #2014 spec; it draws on the existing retry budget and adds no halt class, matching the operator constraint. Remediation tagging (Story 7) keeps the 2-5 check shape. The `prd_audit` field (Story 6) is additive to the projection from #2521.

## Outcomes

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-4 | covered | A plan task whose Done-when names a test cannot be closed while that test is absent from the feature diff. The refusal names the check and the missing test. |
| outcome | outcome-2 | story-2, story-4 | covered | A Done-when closed with generic evidence that references no test is refused at close time, not discovered at prd_audit. |
| outcome | outcome-3 | story-2, story-4 | covered | Recorded close evidence is machine-checked (distinguishable from agent-reported text in task-status/evidence). |
| outcome | outcome-4 | story-3 | covered | Negative path: a Done-when check that names no test (e.g. a config or docs assertion) still closes on appropriate evidence without a spurious refusal. |
| outcome | outcome-5 | story-2, story-4, story-5, story-6, story-7 | covered | On a feature built after the change, prd_audit "no test covers criterion" FIXABLE rows drop materially relative to today's baseline. |

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-13 | covered | Every happy and negative criterion maps to a cited task Done-when check. |
| story | story-2 | task-2, task-3 | covered | Every happy and negative criterion maps to a cited task Done-when check. |
| story | story-3 | task-4, task-7, task-8, task-11 | covered | Every happy and negative criterion maps to a cited task Done-when check. |
| story | story-4 | task-5, task-6, task-9, task-13 | covered | Every happy and negative criterion maps to a cited task Done-when check. |
| story | story-5 | task-7, task-8, task-9, task-10 | covered | Every happy and negative criterion maps to a cited task Done-when check. |
| story | story-6 | task-11 | covered | Every happy and negative criterion maps to a cited task Done-when check. |
| story | story-7 | task-12 | covered | Every happy and negative criterion maps to a cited task Done-when check. |

## Tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-1 | covered | Parse and land-validate the `[test]` Done-when tag |
| task | task-2 | story-2 | covered | Verify a test reference by text against a HEAD blob |
| task | task-3 | story-2 | covered | Close tagged checks through verified references in `conduct task done` |
| task | task-4 | story-3 | covered | Keep untagged checks and tag-free plans closing as before |
| task | task-5 | story-4 | covered | Close a tagged check as unverified with a per-check reason |
| task | task-6 | story-4 | covered | Apply tagged-check rules on verify-only tasks |
| task | task-7 | story-3, story-5 | covered | Collect unverified checks from task status |
| task | task-8 | story-5, story-3 | covered | Withhold BUILD completion once for unverified checks |
| task | task-9 | story-5, story-4 | covered | Persist the nudge and keep stall accounting unchanged |
| task | task-10 | story-5 | covered | Record still-unverified checks on the event spine |
| task | task-11 | story-6, story-3 | covered | Supply unverified checks to the prd_audit input projection |
| task | task-12 | story-7 | covered | Tag criterion-bound remediation checks |
| task | task-13 | story-1, story-4 | covered | Teach the plan and pipeline skills the tag and close forms |

## ADRs

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-08-22-done-when-evidence-at-task-close | story-1, story-2, story-3, story-4, story-5, story-6, story-7 | covered | Decisions 1-9 are dispositioned in the plan obligation table: D1, D5-D9 map to Tasks 1, 3, 5, 6, 8-12; D3 is existing (the untagged plan-gap path); D4 is no-change (no trailer floor). |

## Criteria

| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given a plan task whose Done-when block has a check beginning with the `[test]` tag and an untagged check, when the spec is landed, then land accepts the plan and the parsed check text still begins with `[test]` exactly as authored. | task-1 | covered | "returns a `[test]` check byte-for-byte as authored" | diff-local |
| criterion | Story 1 happy: Given a coherence row that quotes a fragment of a `[test]`-tagged check without the tag, when the coherence gate runs at land, then the quote is still found in the cited task's Done-when checks. | task-1 | covered | "finds a quote of an untagged fragment of a `[test]` check" | diff-local |
| criterion | Story 1 negative: Given a plan check that begins with a malformed tag such as `[tests]` or `[Test]`, when the spec is landed, then land refuses it naming the task id and the check, and no waiver file makes it pass. | task-1 | covered | "naming the task id and the check text for `[tests]` and `[Test]` checks" | diff-local |
| criterion | Story 1 negative: Given a plan check that consists of the `[test]` tag with no check text after it, when the spec is landed, then land refuses it naming the task id as a blank check. | task-1 | covered | "A check that is only `[test]` is reported as a `blank` violation" | diff-local |
| criterion | Story 2 happy: Given task 3 has a `[test]` check and HEAD has a test file containing the cited title and a `Covers: task:3` marker, when `conduct task done 3` cites that file and title for the check, then the task completes and the check's close record has source `verified`. | task-3 | covered | "writes the check close record with source `verified`" | diff-local |
| criterion | Story 2 happy: Given task 3's `Story:` line cites Story 2 and the cited test file carries `Covers: S2.1` instead of a task marker, when the check is closed with that reference, then the check's close record has source `verified`. | task-3, task-2 | covered | "citing a `Covers: S2.1` test for a task whose Story line cites Story 2" | diff-local |
| criterion | Story 2 happy: Given the cited test file was committed before the feature branch and is unchanged in the feature diff, when the check is closed with a reference to it, then the check's close record has source `verified`. | task-3 | covered | "a test committed before the feature branch and absent from the feature diff" | diff-local |
| criterion | Story 2 happy: Given `conduct task done` is run from a subdirectory of the worktree, when a check cites a test path relative to the repository root, then the path resolves from the repository root and the check verifies. | task-3 | covered | "resolves a repository-root-relative test path" | diff-local |
| criterion | Story 2 negative: Given a tagged check, when it is closed with free-text evidence that names no test file and title, then the close is refused naming the check number and text, and the task stays not completed. | task-3, task-2 | covered | "with free-text evidence, or citing a path present only uncommitted" | diff-local |
| criterion | Story 2 negative: Given a tagged check, when it is closed citing a test file that does not exist at HEAD, then the close is refused naming the check and the missing path. | task-3, task-2 | covered | "name the missing path, the missing title, or the missing `Covers:` marker" | diff-local |
| criterion | Story 2 negative: Given a tagged check, when it is closed citing a file at HEAD whose content does not contain the cited title after whitespace normalization, then the close is refused naming the check and the missing title. | task-3, task-2 | covered | "name the missing path, the missing title, or the missing `Covers:` marker" | diff-local |
| criterion | Story 2 negative: Given a tagged check, when it is closed citing a file at HEAD that contains the title but whose `Covers:` markers name neither the task nor any criterion of the stories the task cites, then the close is refused naming the check and the missing marker. | task-3, task-2 | covered | "name the missing path, the missing title, or the missing `Covers:` marker" | diff-local |
| criterion | Story 2 negative: Given a test file that exists only in the working tree and is not committed, when a tagged check cites it, then the close is refused because the file is absent at HEAD. | task-3 | covered | "names that path as absent at HEAD in the uncommitted case" | diff-local |
| criterion | Story 2 negative: Given a test file in a language this repository does not use, when a tagged check cites it with a matching title and `Covers:` marker, then the check verifies exactly as a TypeScript test would. | task-2 | covered | "a language this repository does not use, and a TypeScript test file with the same title and marker both return `verified`" | diff-local |
| criterion | Story 3 happy: Given an untagged check such as a configuration assertion, when it is closed with free-text evidence, then the task completes and the check's close record has source `reported`. | task-4 | covered | "closing an untagged check with free-text evidence completes the task and records source `reported`" | diff-local |
| criterion | Story 3 happy: Given a task with one tagged and one untagged check, when the tagged check cites a verifiable test and the untagged check has free-text evidence, then the task completes with sources `verified` and `reported` respectively. | task-4 | covered | "closes with sources `verified` and `reported` respectively" | diff-local |
| criterion | Story 3 negative: Given a plan with no `[test]` tags, when every task is closed with the same free-text evidence accepted before this change, then no close is refused. | task-4 | covered | "refuses no close" | diff-local |
| criterion | Story 3 negative: Given a task-status file whose close records were written before this change and have no new source values, when BUILD and `prd_audit` read it, then both proceed without error and treat those records as `reported`. | task-7, task-8, task-11 | covered | "Close records written before this change, with source `reported` or no source field, contribute nothing and raise no error" | diff-local |
| criterion | Story 4 happy: Given a tagged check 2 on task 5, when `conduct task done 5` closes check 2 as unverified with a reason and the other checks with valid evidence, then task 5 completes and check 2's close record has source `unverified` and that reason. | task-5 | covered | "records check 2 with source `unverified` and that reason" | diff-local |
| criterion | Story 4 happy: Given a verify-only task with a tagged check, when the check is closed as unverified with a reason, then the task completes and the record has source `unverified`. | task-6 | covered | "for its tagged check completes the task and records that check with source `unverified`" | diff-local |
| criterion | Story 4 negative: Given a tagged check, when it is closed as unverified with an empty reason, then the close is refused naming the check. | task-5 | covered | "exits non-zero naming check 2" | diff-local |
| criterion | Story 4 negative: Given a tagged check whose test reference was refused, when the refusal is printed, then it directs the agent to write or cite the test or close the check as unverified and never directs it to `--plan-gap`. | task-5 | covered | "contains no `--plan-gap` text" | diff-local |
| criterion | Story 4 negative: Given a verify-only task with a tagged check, when `conduct task done` closes the task with no evidence for that check, then the close is refused naming the check, while its untagged checks still close by the prove-closed path. | task-6 | covered | "with no evidence for its tagged check exits non-zero naming the check" | diff-local |
| criterion | Story 4 negative: Given every task completed but some checks unverified, when BUILD evaluates task progress, then the run is not counted as making no task progress. | task-9 | covered | "is not classified as no task progress" | diff-local |
| criterion | Story 5 happy: Given every plan task is resolved and two checks are unverified, when the BUILD session ends and no nudge has been spent in this lap, then BUILD is not completed and the retry hint names both checks by task id and check text. | task-8 | covered | "returns not-done with a nudge reason naming each unverified check task id and check text" | diff-local |
| criterion | Story 5 happy: Given the nudge was spent in this lap and one check is still unverified, when the next BUILD session ends with every task resolved, then BUILD completes and one event is recorded naming the still-unverified check. | task-10, task-8 | covered | "emits exactly one `build_done_when_unverified` event naming that check task id and check text" | diff-local |
| criterion | Story 5 happy: Given every plan task is resolved and no check is unverified, when the BUILD session ends, then BUILD completes with no nudge and no unverified-checks event. | task-10, task-8 | covered | "emits no `build_done_when_unverified` event and records no nudge" | diff-local |
| criterion | Story 5 negative: Given the nudge turn produces no new commit, when the progress-aware halt accounting runs, then the no-evidence attempt count is unchanged by the nudge. | task-9 | covered | "leaves `noEvidenceAttempts` unchanged" | diff-local |
| criterion | Story 5 negative: Given the nudge was spent and the daemon process restarts before the next BUILD session, when BUILD resumes in the same lap, then no second nudge is given. | task-9 | covered | "completes the resolved build with no second nudge" | diff-local |
| criterion | Story 5 negative: Given the per-step retry budget is already exhausted when unverified checks remain, when the BUILD session ends, then no nudge is given and the step follows its existing exhaustion behavior with no new halt class. | task-9 | covered | "no nudge is recorded and the step takes its existing exhaustion route" | diff-local |
| criterion | Story 5 negative: Given the nudge turn writes a test but leaves it uncommitted, when the BUILD session ends, then the existing uncommitted-work floor withholds completion exactly as it does for any other turn. | task-9 | covered | "the uncommitted-work floor withholds completion with its existing reason" | diff-local |
| criterion | Story 5 negative: Given some plan tasks are still pending, when the BUILD session ends, then the pending tasks are reported as before and the nudge does not replace or hide that reason. | task-8 | covered | "returns the existing pending-task reason listing every pending task, with no nudge text" | diff-local |
| criterion | Story 5 negative: Given a task with a `[test]` check that was resolved by a no-diff skipped stamp or a verify-only stamp and so has no task-close record for that check, when the BUILD session ends with every task resolved, then that check is not counted as unverified and BUILD completes with no nudge. | task-8, task-7 | covered | "including the stamp-resolved and legacy task-status fixtures, the predicate returns done with no nudge reason" | diff-local |
| criterion | Story 6 happy: Given BUILD completed with an unverified check on task 4, when `prd_audit` assembles its engine-owned input, then the input includes task 4, the check text, and the recorded reason. | task-11 | covered | "carries an `unverifiedDoneWhen` list containing task 4, its check text and its reason" | diff-local |
| criterion | Story 6 negative: Given no check was closed unverified, when `prd_audit` assembles its input, then the unverified-checks field is present and empty. | task-11 | covered | "`unverifiedDoneWhen` is present and empty" | diff-local |
| criterion | Story 6 negative: Given a task-status file written before this change, when `prd_audit` assembles its input, then assembly succeeds and the unverified-checks field is empty. | task-11 | covered | "with a task-status fixture written before this change, the projection builds without error" | diff-local |
| criterion | Story 7 happy: Given a `prd_audit` FIXABLE finding bound to criterion S3.6, when the remediation task is appended to the plan, then its criterion check begins with the `[test]` tag. | task-12 | covered | "returns a criterion check beginning with `[test]`" | diff-local |
| criterion | Story 7 negative: Given an as-built REMEDIABLE finding, when its remediation task is appended, then none of its checks carry the `[test]` tag. | task-12 | covered | "renders a block with no `[test]` check" | diff-local |
| criterion | Story 7 negative: Given an appended criterion-bound remediation task, when the amended plan is validated by the Done-when shape rule, then it has between two and five non-blank checks and passes. | task-12 | covered | "passes `validatePlanDoneWhen` with two to five non-blank checks" | diff-local |
| criterion | Story 7 negative: Given an appended criterion-bound remediation task whose test cannot be produced, when BUILD closes its tagged check as unverified with a reason, then the task completes without a halt. | task-12 | covered | "completes the task and writes no `.pipeline/HALT` file" | diff-local |
