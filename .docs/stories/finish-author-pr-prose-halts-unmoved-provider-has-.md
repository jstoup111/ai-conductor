**Status:** Accepted

# Stories: The engine performs FINISH's PR-prose write; the provider only returns prose

Source: jstoup111/ai-conductor#3529. Technical track, governed by
adr-2026-10-31-engine-performs-finish-pr-prose-write. The handoff file is
`.pipeline/finish-pr-prose.json` in the feature worktree, shaped `{"version":1,"title":"…","body":"…"}`.
These stories do not cover a failed engine edit (`publication_operation_failed`) or a published
edit that still leaves placeholder prose (`publication_transition_unmoved`). The amended Stories 2
and 3 of `finish-pr-body-publish-fails-on-token-scope-and-ha` cover those.

## Story 1: Authored prose reaches the PR without the provider writing to GitHub

**Requirement:** adr-2026-10-31-engine-performs-finish-pr-prose-write D1, D2

As an operator, I want FINISH to publish the PR title and body the provider authored without the provider making any GitHub call, so that `author_pr_prose` advances without my intervention.

### Acceptance Criteria

#### Happy Path
- Given a feature PR whose prose is the engine placeholder, when the author pass writes a valid handoff file and makes no GitHub call, then the engine performs exactly one guarded `pull-request.edit` on that PR whose title and body come from the handoff, re-observation shows prose that is no longer placeholder, and the `author_pr_prose` transition advances with no operator action
- Given the current PR body contains `ai-conductor:step` regions, when the handoff body omits one region, changes the bytes of another, and repeats a third, then the published body contains every region exactly once with the bytes it had in the current PR body
- Given a revision pass dispatched with judge guidance after a `revision_required` verdict, when the provider writes a valid handoff, then the engine publishes it in the same way and the next selected transition is `judge_pr_prose`
- Given an otherwise valid handoff whose title has leading and trailing whitespace, when the engine publishes it, then the published title is the trimmed, non-empty title

#### Negative Paths
- Given a handoff file left in `.pipeline/` by an earlier pass, when a new author pass is dispatched and that pass writes no handoff, then the earlier file was removed before the dispatch, its content is never published, and the pass is treated as returning no prose
- Given the author pass writes no handoff file, when the pass completes successfully and re-observation still shows placeholder prose, then the engine performs no `pull-request.edit` and FINISH returns `publication_retry` with reason `prose_not_returned`
- Given a handoff that is not valid JSON, when the pass completes, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail stating the handoff could not be parsed
- Given a handoff whose `version` is not 1, or whose `title` or `body` is missing, not a string, or empty after trimming, when the pass completes, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail naming the offending field
- Given a handoff whose title and body the observer's own prose classification still reads as placeholder, such as the unchanged engine-floored template body, when the engine validates it, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail stating the body is still placeholder
- Given the current PR body contains `Closes owner/repo#N`, when the handoff body lacks that reference, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail naming the missing `Closes owner/repo#N` reference
- Given the current PR body contains no `Closes` reference, when a handoff body without one is otherwise valid, then the edit is performed and the transition advances
- Given the author pass writes no handoff but edits the PR directly, when re-observation shows prose that is no longer placeholder, then the transition advances, because re-observation stays authoritative, and no `prose_not_returned` retry is returned
- Given an authoring dispatch that does not complete successfully, when a valid handoff file exists afterwards, then no edit is performed and FINISH follows the existing `authoring_dispatch_failed` retry
- Given a `github_operation_failed` record for this PR's `pull-request.edit` appended to the sibling ledger during the pass, when the handoff is valid and the engine's own edit executes, then the transition advances and the record does not produce `publication_operation_failed`

### Done When
- [ ] A production `authorProse` test with a fake provider that writes a valid handoff asserts one `executeGithubOperation` `pull-request.edit` call whose payload carries the handoff title and the region-re-spliced body, and that the coordinator advances
- [ ] Decoder and validation tests cover a missing file, unparsable JSON, a wrong version, each missing or empty field, a placeholder-marked body, and a dropped `Closes` reference, each producing its named `prose_invalid` or `prose_not_returned` result with no edit call
- [ ] A test asserts that a pre-existing handoff file is deleted before dispatch
- [ ] A test asserts that a sibling-ledger `github_operation_failed` record during the pass no longer affects the disposition

## Story 2: An authoring failure retries with its cause, then halts naming it

**Requirement:** adr-2026-10-31-engine-performs-finish-pr-prose-write D4

As an operator, I want a provider that returns no prose or bad prose to get a bounded retry told what was wrong, and a halt that names the real cause if it never recovers, so that I am not handed a misleading "unchanged" halt.

### Acceptance Criteria

#### Happy Path
- Given an author pass that returned `prose_invalid` because the `Closes` reference was missing, when FINISH dispatches the next author pass, then that pass's revision guidance contains the failed-check detail
- Given an author pass that returned `prose_not_returned`, when the next pass writes a valid handoff, then the prose is published, the transition advances, and FINISH does not halt
- Given each retry, when it is returned, then a `finish_publication_disposition` event with disposition `retry_finish` is emitted and the retry spends one attempt of the existing FINISH step attempt budget, with no new budget introduced

#### Negative Paths
- Given every author pass within the FINISH attempt budget writes no handoff, when the budget is exhausted, then FINISH halts needs-human with a reason that names `prose_not_returned` and carries the retry detail, and the halt text does not contain "left pr.prose unchanged at placeholder"
- Given every author pass within the FINISH attempt budget writes a handoff that fails validation, when the budget is exhausted, then the halt names `prose_invalid` and carries the last failed-check detail
- Given a `prose_not_returned` retry, when the next pass's revision guidance is built, then it states that no handoff file was written and names the handoff path

### Done When
- [ ] A conductor-level test drives repeated `prose_not_returned` results to attempt-budget exhaustion and asserts the halt reason names `prose_not_returned` and excludes the unchanged-prose text
- [ ] A test asserts that the `prose_invalid` detail is passed as revision guidance to the next author dispatch
- [ ] The closed publication reason union and its rendering include `prose_not_returned` and `prose_invalid`

## Story 3: The prose judge never writes to the PR

**Requirement:** adr-2026-10-31-engine-performs-finish-pr-prose-write D3

As an operator, I want the prose judge to return only a verdict, so that every change to PR prose goes through the engine's validated write.

### Acceptance Criteria

#### Happy Path
- Given an unattended FINISH judgment dispatch, when its prompt is built, then the prompt instructs the provider to return only the verdict JSON and contains no permission to repair, edit, or rewrite the PR title or body
- Given an interactive FINISH judgment dispatch, when its prompt is built, then it likewise contains no permission to repair the PR title or body
- Given a judge verdict of `revision_required` with a detail, when FINISH re-observes, then the next selected transition is `author_pr_prose` carrying that detail as revision guidance

#### Negative Paths
- Given a judge pass that edits the PR body despite the prompt, when FINISH re-observes, then the changed revision is judged again through `judge_pr_prose` and is never accepted without a verdict on that revision
- Given a judge verdict of `accepted`, when FINISH continues, then no author pass and no engine prose edit is dispatched

### Done When
- [ ] Prompt tests assert that the unattended and interactive judge blocks contain no repair permission and still list the closed verdict set
- [ ] An existing or new coordinator test asserts `revision_required` routes to `author_pr_prose` with guidance

## Story 4: One contract tells the provider who writes PR prose

**Requirement:** adr-2026-10-31-engine-performs-finish-pr-prose-write D6

As a provider running FINISH, I want every instruction I receive to say the same thing about the PR title and body write, so that I never have to discover or build a GitHub request.

### Acceptance Criteria

#### Happy Path
- Given an author pass, when its prompt is built, then it names the handoff path `.pipeline/finish-pr-prose.json` and its exact `version`, `title`, and `body` shape, tells the provider to write only that file, and contains no instruction to edit, rewrite, or update the PR in place
- Given a revision pass, when its prompt is built, then it carries the judge's objection and the same handoff instruction, and contains no instruction to edit the PR in place
- Given `skills/finish/SKILL.md`, when its PR prose authoring section is read, then it instructs writing the handoff file and states that the engine performs the PR title and body write
- Given `skills/pr/SKILL.md`, when its feature-branch publication section is read, then it states that during FINISH the provider writes the handoff file and the engine performs the write, consistent with `skills/finish/SKILL.md`

#### Negative Paths
- Given the author, revision, and judge prompt blocks, when they are inspected, then none mentions `ai-conductor github-operation`, `--request-file`, or a `pull-request.edit` request shape
- Given `skills/finish/SKILL.md` and `skills/pr/SKILL.md`, when they are inspected, then neither instructs a provider to rewrite the retained PR's title or body in place during FINISH

### Done When
- [ ] Prompt tests assert the handoff path and schema appear in the author and revision blocks and that the forbidden phrases are absent
- [ ] An integrity or content test asserts both skills name the handoff file and that neither contains an in-place rewrite instruction for FINISH

## Story 5: A missing-subcommand refusal does not read as a blocked command

**Requirement:** adr-2026-10-31-engine-performs-finish-pr-prose-write D7

As an agent in a daemon session, I want a refused `ai-conductor` call with no subcommand to say so and list what I may run, so that I do not conclude a sanctioned subcommand is blocked.

### Acceptance Criteria

#### Happy Path
- Given a daemon session, when it runs bare `ai-conductor --help`, then the command is refused and the refusal states that no subcommand was given and lists every sanctioned subcommand, including `github-operation`
- Given a daemon session, when it runs `ai-conductor` with no arguments, then the refusal has the same no-subcommand wording and sanctioned list

#### Negative Paths
- Given a daemon session, when it runs a known blocked subcommand such as `ai-conductor daemon status`, then the refusal still names that blocked subcommand and is unchanged from today
- Given a daemon session, when it runs a sanctioned subcommand such as `ai-conductor github-operation --request-file <file>`, then it is admitted as today
- Given the no-subcommand refusal, when its text is inspected, then it does not contain `blocked subcommand: <none>` and does not echo any unknown argv text

### Done When
- [ ] `evaluateDaemonSessionCommandPolicy` tests assert the no-subcommand refusal wording and sanctioned list for bare and `--help` invocations
- [ ] Existing blocked and sanctioned subcommand tests pass unchanged
