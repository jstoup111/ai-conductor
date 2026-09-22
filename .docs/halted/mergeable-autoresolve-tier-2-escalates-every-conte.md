# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-22T03:05:09.898Z
Slug: mergeable-autoresolve-tier-2-escalates-every-conte
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-mergeable-autoresolve-tier-2-escalates-every-conte
Head SHA: e70e345f4fcc84cce549253a609bea91ba363cea
Halted at: 2026-09-22T02:58:15.149Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given a watched pull request whose only remaining conflicts are in test files, when the resolver merges both sides' changes without dropping any commit and the suite command exits zero, then the branch is pushed and no commit is reported as superseded.
Task ids: 7
Done when checks: `resolveConflictingPr` returns `refreshed` and invokes the lease push stub exactly once for a test-only conflict whose resolver verdict declares the replayed commit superseded and whose suite stub exits zero, asserted by integration test (a). | `resolveConflictingPr` returns `refreshed` with an empty excused list when the verdict choice is `merged` and no commit is dropped, asserted by integration test (b). | The log stub receives a `tier2 outcome:` line whose kind is not `conflict_halt` in integration test (a).
Missing assertion: No cited check requires a passing suite and lease-protected push for the merged, no-drop scenario.

Criterion: Story 1 negative: Given a test-only conflict, when the resolver reports it cannot choose between the two intents, then nothing is pushed and the escalation comment names the replay commit, the file and region, both intents, and the missing decision.
Task ids: 8
Done when checks: With the suite stub exiting non-zero, `resolveConflictingPr` escalates at stage `suite-gate` with the exit code in the reason and the push stub is never called, asserted by the suite-failure test. | With an unresolved resolver result, the escalation comment body contains the resolver reason verbatim and the push stub is never called, asserted by the unresolved test. | With the lease push stub rejecting, `resolveConflictingPr` returns `escalated` and the push stub is called exactly once with the lease flag and never with a bare force flag, asserted by the lease test. | With the suite stub reporting not configured, `resolveConflictingPr` escalates with reason `no suite command configured`, the push stub is never called, and the comment stub receives no audit comment, asserted by the not-configured test.
Missing assertion: No cited check requires the escalation comment to name the replay commit, file and region, both intents, and missing decision.

Criterion: Story 1 negative: Given a test-only conflict, when the resolver's verdict is missing a required field or names an unknown choice, then the verdict is rejected, nothing is pushed, and the pull request is escalated with a reason naming the malformed verdict.
Task ids: 3
Done when checks: `validateResolutionVerdict` returns `ok: false` with a reason starting `malformed verdict:` for a missing required field and for a choice outside the closed three-value set, asserted by the validation unit tests. | `validateResolutionVerdict` returns `ok: false` when `superseded` is non-empty and the scope is `mixed`, asserted by the non-test-scope unit test. | `validateResolutionVerdict` returns `ok: false` when a `superseded` sha is absent from `replayedShas`, asserted by the never-replayed unit test.
Missing assertion: The cited checks validate malformed verdicts but do not require no push and pull-request escalation.

Criterion: Story 1 negative: Given a test-only conflict resolved with a passing suite, when the lease-protected push is rejected because the remote branch moved, then the pull request is escalated and no retry force-pushes over the remote.
Task ids: 8
Done when checks: With the suite stub exiting non-zero, `resolveConflictingPr` escalates at stage `suite-gate` with the exit code in the reason and the push stub is never called, asserted by the suite-failure test. | With an unresolved resolver result, the escalation comment body contains the resolver reason verbatim and the push stub is never called, asserted by the unresolved test. | With the lease push stub rejecting, `resolveConflictingPr` returns `escalated` and the push stub is called exactly once with the lease flag and never with a bare force flag, asserted by the lease test. | With the suite stub reporting not configured, `resolveConflictingPr` escalates with reason `no suite command configured`, the push stub is never called, and the comment stub receives no audit comment, asserted by the not-configured test.
Missing assertion: No cited check requires that the lease rejection be caused by a moved remote branch.

Criterion: Story 2 negative: Given a watched pull request whose conflicts include one test file and one non-test file, when tier 2 is dispatched, then the resolver is not told the exception is in force and an intent conflict in either file returns unresolved and escalates.
Task ids: 4
Done when checks: `runTier2` passes `supersessionJudgement: true` into `resolveRebaseConflicts` only for scope `test-only`, and a `mixed` scope yields a resolver context with the field false, asserted by the tier-2 unit test. | The step runner `resolveRebaseConflict` prompt contains the text `Sweep Test-Only Judgement` only when the context field is true, and is byte-identical to the current prompt when false, asserted by the prompt unit test.
Missing assertion: The cited checks require mixed scope to disable supersession judgement and its prompt, but do not require an intent conflict to return unresolved and escalate.

Criterion: Story 2 negative: Given a watched pull request with a non-test conflict, when the resolver returns a verdict declaring a commit superseded anyway, then the engine rejects the verdict, publishes nothing, and escalates.
Task ids: 3
Done when checks: `validateResolutionVerdict` returns `ok: false` with a reason starting `malformed verdict:` for a missing required field and for a choice outside the closed three-value set, asserted by the validation unit tests. | `validateResolutionVerdict` returns `ok: false` when `superseded` is non-empty and the scope is `mixed`, asserted by the non-test-scope unit test. | `validateResolutionVerdict` returns `ok: false` when a `superseded` sha is absent from `replayedShas`, asserted by the never-replayed unit test.
Missing assertion: The cited checks do not assert that the engine publishes nothing and escalates after rejecting the verdict.

Criterion: Story 2 negative: Given a feature at finish time whose rebase conflict is confined to test files, when the resolver is dispatched, then the exception is not in force and a semantic intent conflict halts the feature exactly as before this change.
Task ids: 5
Done when checks: The finish-time rebase step hands its resolver a context with `supersessionJudgement` false for a test-only conflict fixture, asserted by the finish-time boundary test capturing the stub resolver argument. | The daemon re-kick resume path hands its resolver a context with `supersessionJudgement` false for a test-only conflict fixture, asserted by the re-kick boundary test capturing the stub resolver argument.
Missing assertion: The cited checks assert only that supersessionJudgement is false; they do not assert that a semantic intent conflict halts exactly as before.

Criterion: Story 3 negative: Given a rebased branch missing a feature commit the verdict did not declare, when the guard runs, then it fails naming the missing subject and the pull request is escalated at the acceptance-guards stage.
Task ids: 6
Done when checks: `runAcceptanceGuards` returns ok with the commit listed in `excused` when its sha is in `declaredSuperseded` and every path it touched satisfies `isTestPath`, asserted by the declared-drop scratch-repository test. | `runAcceptanceGuards` returns a `featureCommitsPreserved` failure naming the subject when the missing commit is not declared, asserted by the undeclared-drop test. | `runAcceptanceGuards` refuses a declaration whose commit touched any non-test path and evaluates every declaration individually, asserted by the mixed-path and all-declared tests. | Called without `declaredSuperseded`, `runAcceptanceGuards` returns the same results as before for the existing guard fixtures, asserted by the unchanged existing guard tests plus the no-declarations test.
Missing assertion: The cited checks assert the guard failure naming the subject, but do not assert pull-request escalation at the acceptance-guards stage.

Criterion: Story 3 negative: Given a verdict declaring a commit id that this rebase never replayed, when the verdict is validated, then it is rejected and nothing is published.
Task ids: 3
Done when checks: `validateResolutionVerdict` returns `ok: false` with a reason starting `malformed verdict:` for a missing required field and for a choice outside the closed three-value set, asserted by the validation unit tests. | `validateResolutionVerdict` returns `ok: false` when `superseded` is non-empty and the scope is `mixed`, asserted by the non-test-scope unit test. | `validateResolutionVerdict` returns `ok: false` when a `superseded` sha is absent from `replayedShas`, asserted by the never-replayed unit test.
Missing assertion: The cited check asserts verdict rejection, but does not assert that nothing is published.

Criterion: Story 4 negative: Given a resolution published under the exception, when posting the audit comment fails, then the push is not reverted, the failure is logged, and the verdict event is still persisted.
Task ids: 11
Done when checks: `postSupersessionAudit` upserts one comment under `SUPERSESSION_AUDIT_MARKER` whose body contains the verdict choice, rationale, each superseded sha, and the literal suite command with its zero exit, asserted by the audit body test. | A second judged publication calls `upsertComment` with the same marker so the comment is edited in place, asserted by the repeat-publication test. | When the comment stub throws, `resolveConflictingPr` still returns `refreshed`, logs the failure, and the verdict event stub has been called, asserted by the comment-failure test. | `postSupersessionAudit` is not called when the published attempt carried no verdict, and is never called before the suite stub has returned, asserted by the call-order assertions in the strict-path and audit tests.
Missing assertion: The cited checks do not explicitly assert that a failed audit-comment post does not revert the already-pushed publication.

Criterion: Story 5 negative: Given a labeled pull request with a recorded conflict cause, when it is still conflicting, then the label stays and eligibility reports the sticky escalation skip.
Task ids: 15
Done when checks: `maybeClearConflictLabel` calls `removeLabel` for `needs-remediation` exactly once when the entry cause is `conflict-resolution`, `state.mergeable` is `MERGEABLE`, and `hasHaltBodyMarker` is false, asserted by the clear test. | On a tick where the cause is set and the label is absent, the sweep clears `escalationCause` and `labelClearAttempts`, and a later conflicting tick is not skipped by the sticky-label gate, asserted by the two-tick eligibility test. | `maybeClearConflictLabel` issues no removal when the state is conflicting, when the entry has no recorded cause, when `hasHaltBodyMarker` is true, or when the merge state is unknown or unreadable, asserted by the four negative sweep tests.
Missing assertion: A cited check must explicitly assert that a still-conflicting pull request is skipped by the sticky-label eligibility gate.

Criterion: Story 5 negative: Given a watch entry written before this change with no cause field, when the sweep reads it, then it is treated as having no recorded cause and the label is left alone.
Task ids: 13
Done when checks: The sweep writes `escalationCause: "conflict-resolution"` on the surviving watch entry when the autoresolve dispatch result kind is `escalated`, asserted by the sweep cause test reading the persisted registry. | A registry line lacking `escalationCause` round-trips through load and save with the field still absent, asserted by the legacy-entry test.
Missing assertion: A cited check must assert that an absent legacy cause is treated as no recorded cause by the sweep and leaves the label untouched.
```
