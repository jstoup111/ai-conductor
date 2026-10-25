# Implementation Plan: FINISH reports the real PR-publish failure instead of "pr.prose unchanged"

**Date:** 2026-10-24
**Design:** .docs/decisions/adr-2026-10-24-finish-surfaces-guarded-publish-failures.md (technical track, Tier M — see `.docs/track/finish-pr-body-publish-fails-on-token-scope-and-ha.md`)
**Stories:** .docs/stories/finish-pr-body-publish-fails-on-token-scope-and-ha.md
**Conflict check:** Clean as of 2026-10-24 (`.docs/conflicts/finish-pr-body-publish-fails-on-token-scope-and-ha.md`)

## Summary

Make a failed guarded `pull-request.edit` during FINISH's `author_pr_prose` pass visible on the
event spine and in the FINISH halt reason, instead of being read as "left pr.prose unchanged at
placeholder" (jstoup111/ai-conductor#3376). Six tasks: the event variant and its admission, the
failure-text bounding, the CLI write, the coordinator's new human-required reason, the production
pass-window reader, and the conductor-level integration proof.

## Technical Approach

- **Verified current behavior (local main `791ce29818`).**
  - `dispatchGithubOperationCommand` (`src/conductor/src/engine/github-operations-cli.ts`) builds a canonical `failed` result (`{ kind: 'failed', operation, target, error }`) on three paths: shared-write (`executeSharedGithubOperation`), remote-ref-write (`executeRemoteGit`), and feature-write (`executeGithubOperation`). It prints that result and exits 1. A malformed request file also prints `{ kind: 'failed', error: 'invalid request file: …' }`, but with no operation or target.
  - The CLI's own spine (`startOperatorEventSpine(process.cwd())` in `index.ts`) writes `<cwd>/.pipeline/events.jsonl` directly, and `GithubOperationEventEmitter` admits only `github_operation_refused` and `github_write_credential_fallback`. Nothing records a failed result.
  - `appendCloseoutEvent(projectRoot, event)` (`closeout-events.ts`) appends one `ConductorEvent` line to `<projectRoot>/.pipeline/pipeline-events.jsonl`. `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES` and the `ExternalPipelineEvent` union gate what `CloseoutEventTail` (`closeout-tail.ts`) re-emits; any other kind gets a `pipeline_tail_diagnostic` `unadmitted-type`.
  - In `advanceFinishPublication`'s `author_pr_prose` branch (`finish-publication.ts`), an `authorProse` throw that is a region-restore error maps straight to `human_required`. Any other throw sets `dispatchFailure` and goes to the `authoring_dispatch_failed` retry. A completed pass runs `advancedPublicationTransition`, whose unmoved arm returns `publication_transition_unmoved` with the detail "The author_pr_prose transition left pr.prose unchanged at placeholder."
  - The production `authorProse` (`finish-publication-production.ts`) awaits `dispatchAuthoring(request)` and throws only when `!dispatched.success`. `deps.projectRoot` is in scope there.
  - `HumanRequiredReason` is a closed union and `HUMAN_REQUIRED_REASONS` its exhaustive `{ message, nextAction }` map, rendered by `renderHumanRequiredHaltReason` (adr-2026-08-08-finish-human-required-halt-rendering D3).
- **Design (adr-2026-10-24-finish-surfaces-guarded-publish-failures D1–D5).**
  - **Event.** The new variant is `{ type: 'github_operation_failed'; operation: GithubOperationName; target: GithubOperationTarget; error: string; ts: string }`. It is added to `ExternalPipelineEvent` and to `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES`. Every exhaustive registry over `ConductorEvent['type']` gets an entry: `event-sinks.ts` (render and persist, no audit or otel, matching `github_write_credential_fallback`), and the terminal renderer and daemon-log switches where the compiler requires it.
  - **Bounding.** A pure helper `boundGithubOperationFailureText(error, request)` in `github-operations-cli.ts` applies four steps in order: (1) replace every occurrence of each non-empty string value in the request's `payload` with `«payload»`; (2) if the result starts with `Command failed:`, drop everything through the first newline; (3) trim; (4) truncate to 1000 characters. After step 1 the argv line carries no multi-line payload, so step 2 removes the whole command line.
  - **CLI write.** On each of the three failed paths with a decoded request, the CLI calls an injectable `appendExternalEvent` input (default `appendCloseoutEvent`) with `projectRoot = input.cwd`, inside a `try`/`catch` that swallows write errors. The malformed-request-file path writes nothing. The event never goes through `input.events`, so the CLI never writes it to `events.jsonl`.
  - **Coordinator.** Export `PublicationOperationFailedError` (fields `operation`, `error`) and `isPublicationOperationFailedError` from `finish-publication.ts`. Add `publication_operation_failed` to `HumanRequiredReason` and `HUMAN_REQUIRED_REASONS` with message "A FINISH pull-request publish failed, so the authored prose never reached the pull request." and next action "Resolve the failure named below, then retry FINISH." In the author branch, the catch classifies this error before the `dispatchFailure` fallback. After the existing mandatory re-observation:
    - `ambiguous` identity → `ambiguous_pr_identity`;
    - prose that is neither `placeholder` nor `indeterminate` → `advancedPublicationTransition`;
    - otherwise → `{ kind: 'human_required', reason: 'publication_operation_failed', detail: '<operation> failed: <error>' }`.
  - **Production observer (on the spine).** The production `authorProse` never reads `.pipeline/pipeline-events.jsonl`; `CloseoutEventTail` stays its only reader. `ProductionFinishPublicationDeps` gains a subscribable `events` (`on`/`off`, as `ConductorEventEmitter`) and `flushSessionEvents?: () => Promise<void>`. `SessionEventTailOwner` and `startFeatureEventPersistence` gain `flush()`: one `CloseoutEventTail.poll()` that joins any in-flight read and does not stop the tail. The FINISH coordinator call sites (`daemon-cli.ts`, `index.ts`, `executor-child-runtime.ts`) pass the feature scope's emitter and `flush`. Before calling `dispatchAuthoring`, `authorProse` registers an `on('github_operation_failed')` handler that keeps events with `operation === 'pull-request.edit'`, `target.kind === 'pull-request'`, and `target.repository`/`target.number` equal to the `owner/repo` and number parsed from `pullRequestUrl`. After the dispatch it awaits `flushSessionEvents()`, then `off`s the handler in a `finally`. If any event matched and the dispatch succeeded, it throws `PublicationOperationFailedError` built from the last one. With no subscribable `events` or no `flushSessionEvents`, nothing is attributed. The existing `!dispatched.success` throw stays first and unchanged.
- **Pattern context.** The typed-effect-error pattern is the region-restore classification in the `author_pr_prose` branch (search `isRegionRestoreError`): a discriminated error thrown by the effect and classified inside the `coalescePublicationEffect` callback. The allowed variation is that this path re-observes before deciding. The external-event pattern is `appendCloseoutEvent` plus `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES` (search `closeout-events.ts`, `closeout-tail.ts`).
- **Spine.** No new channel (`.agents/skills/event-spine/SKILL.md` §4 A+B). The sibling ledger is the existing single-writer external ledger in the same union, re-emitted by the session tail. The FINISH decision consumes the re-emitted bus events, not the ledger file (operator decision 2026-10-25, resolving build_review decision stop 64898260).

## Prerequisites

- None.

## Tasks

### Task 1: Add the `github_operation_failed` event and admit it through the sibling-ledger tail
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/closeout-tail.test.ts`: write a `github_operation_failed` record (operation `pull-request.edit`, a pull-request target, error, ts) to a temp worktree's `.pipeline/pipeline-events.jsonl`, poll a `CloseoutEventTail` whose emitter has an `EventPersister` on `.pipeline/events.jsonl` attached, and assert the emitter receives that event unchanged, the persister writes it to `.pipeline/events.jsonl`, and no `pipeline_tail_diagnostic` with reason `unadmitted-type` is emitted.
2. Verify it fails (RED): today the tail diagnoses the kind as unadmitted.
3. Implement: add the variant to `ConductorEvent` in `src/conductor/src/types/events.ts`; add it to `ExternalPipelineEvent` and `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES` in `closeout-events.ts`; add `github_operation_failed: { render: true, persist: true, audit: false, otel: false }` to `event-sinks.ts`; add a terminal-renderer and daemon-log line naming operation, target, and error wherever an exhaustive switch requires the new type.
4. Verify it passes (GREEN), and that the typecheck shows no non-exhaustive switch.
5. Commit: "Add github_operation_failed event and admit it through the external ledger tail".

**Done when:**
- [test] A `closeout-tail` test asserts that `CloseoutEventTail` re-emits a `github_operation_failed` sibling-ledger record onto the emitter unchanged and emits no `unadmitted-type` `pipeline_tail_diagnostic` for it.
- [test] The same test asserts that an `EventPersister` attached to that emitter writes the re-emitted `github_operation_failed` event to the worktree's `.pipeline/events.jsonl`.
- `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES` contains `github_operation_failed` and `event-sinks.ts` has a `github_operation_failed` entry with `persist: true`.
- `tsc --noEmit` for `src/conductor` reports no errors after the union change.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new variant
- `src/conductor/src/engine/closeout-events.ts` — admission
- `src/conductor/src/engine/event-sinks.ts` — sink routing
- `src/conductor/src/ui/terminal-renderer.ts` — render line if the switch is exhaustive
- `src/conductor/src/daemon-cli.ts` — daemon-log line if the switch is exhaustive
- `src/conductor/test/engine/closeout-tail.test.ts` — tail admission test

**Dependencies:** none

### Task 2: Bound GitHub failure text before it reaches the spine
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/github-operations-cli-failure-text.test.ts` for `boundGithubOperationFailureText(error, request)`:
   - (a) an error of the form `Command failed: gh pr edit 3372 -R owner/repo --title T --body <multi-line body>\nGraphQL: Your token has not been granted the required scopes…`, with a request whose payload has that title and body, returns text of at most 1000 characters that contains the `GraphQL: Your token has not been granted the required scopes` message and contains neither `Command failed`, `--body`, the body text, nor the title;
   - (b) a 3000-character GitHub error returns exactly 1000 characters;
   - (c) an error with no `Command failed:` prefix is returned trimmed and with payload values replaced.
2. Verify RED (the helper does not exist).
3. Implement the helper in `github-operations-cli.ts` with the four ordered steps from Technical Approach: payload-value replacement with `«payload»`, `Command failed:` first-line drop, trim, and 1000-character truncation.
4. Verify GREEN.
5. Commit: "Bound github-operation failure text for spine events".

**Done when:**
- [test] A unit test asserts that `boundGithubOperationFailureText` strips the `Command failed: gh pr edit … --title … --body …` command line and the multi-line request body while keeping the GitHub missing-scope error text, and that this result is at most 1000 characters long.
- [test] A unit test asserts that `boundGithubOperationFailureText` truncates a 3000-character GitHub error to exactly 1000 characters.
- [test] A unit test asserts that a prefix-less error is returned trimmed with every request payload string value replaced by `«payload»`.

**Files likely touched:**
- `src/conductor/src/engine/github-operations-cli.ts` — bounding helper
- `src/conductor/test/engine/github-operations-cli-failure-text.test.ts` — unit tests

**Dependencies:** none

### Task 3: The `github-operation` CLI records every failed result to the sibling ledger
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/github-operations-cli-failed-event.test.ts` that drive `dispatchGithubOperationCommand` against a temp worktree `cwd`, with a stub `runner`/`gh` and the real default appender:
   - (a) a `pull-request.edit` request with a multi-line body whose runner fails with `Command failed: gh pr edit … --body <that body>\n<missing-scope error>` → exactly one `github_operation_failed` line in `<cwd>/.pipeline/pipeline-events.jsonl` with operation `pull-request.edit`, the request's pull-request target, an `error` of at most 1000 characters containing the missing-scope message and none of `Command failed`, `gh pr edit`, `-R`, `--title`, `--body`, or the request title and body text, and a `ts`; stdout is the unchanged `failed` result and the exit code is 1;
   - (b) a failing `pull-request.comment.create` whose error is 3000 characters → one line that `JSON.parse`s, with that operation and target and an `error` of exactly 1000 characters;
   - (c) a refused request (an unauthorized target) and a malformed request file → no `pipeline-events.jsonl` record;
   - (d) an executed request → no record;
   - (e) in case (a), a spy `events` emitter receives no `github_operation_failed`, and `<cwd>/.pipeline/events.jsonl` contains no `github_operation_failed` line;
   - (f) an injected `appendExternalEvent` that throws → stdout still prints the `failed` result, the exit code is 1, and the promise does not reject.
2. Verify RED.
3. Implement: add `appendExternalEvent?: (projectRoot: string, event: ExternalPipelineEvent) => void` to `GithubOperationCliInput`, defaulting to `appendCloseoutEvent`. Add one `recordFailedOperation(request, result, input)` that, when `result.kind === 'failed'`, builds the event using `boundGithubOperationFailureText` (Task 2) and `new Date().toISOString()`, and appends it inside `try`/`catch` that swallows errors. Call it on the shared-write, remote-ref-write, and feature-write failed paths, before `write(...)`. Do not call it on the request-file parse failure or on decode refusals. Do not route it through `input.events`.
4. Verify GREEN.
5. Commit: "Record failed github-operation results on the external event ledger".

**Done when:**
- [test] A CLI test asserts that `dispatchGithubOperationCommand` appends exactly one `github_operation_failed` line with operation `pull-request.edit`, the pull-request target, an `error` of at most 1000 characters that keeps the missing-scope error and contains none of `Command failed`, `gh pr edit`, `-R`, `--title`, `--body`, or the request title and body, and a ts to `.pipeline/pipeline-events.jsonl`, while stdout prints the unchanged `failed` result and the exit code is 1.
- [test] A CLI test asserts that a failing `pull-request.comment.create` with a 3000-character error appends one `JSON.parse`-able `github_operation_failed` line carrying that operation and target with an `error` of exactly 1000 characters.
- [test] A CLI test asserts that refused, malformed-request-file, and executed results append no `github_operation_failed` record.
- [test] A CLI test asserts that for a failed result the `events` emitter receives no `github_operation_failed` and `.pipeline/events.jsonl` contains none.
- [test] A CLI test asserts that a throwing `appendExternalEvent` leaves stdout's `failed` result and exit code 1 unchanged without rejecting.

**Files likely touched:**
- `src/conductor/src/engine/github-operations-cli.ts` — failed-result recording
- `src/conductor/test/engine/github-operations-cli-failed-event.test.ts` — CLI tests

**Dependencies:** Tasks 1, 2

### Task 4: The coordinator halts `publication_operation_failed` after re-observation
**Story:** Story 2, Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication.test.ts` (new `describe('author_pr_prose publish failure')`), driving `advanceFinishPublication` with a placeholder snapshot and an `authorProse` effect that throws `new PublicationOperationFailedError('pull-request.edit', 'GraphQL: Your token has not been granted the required scopes … read:org …')`:
   - (a) re-observation still placeholder → `{ kind: 'human_required', reason: 'publication_operation_failed' }` whose `detail` contains `pull-request.edit failed:` and the `read:org` error text;
   - (b) `routeFinishPublicationDisposition` / `renderHumanRequiredHaltReason` for that disposition renders the `publication_operation_failed` message, its next action, and the error text, and the rendered reason does not contain `left pr.prose unchanged at placeholder`;
   - (c) re-observation with authored (non-placeholder) prose → `{ kind: 'advanced', transition: 'author_pr_prose' }`, both for the typed failure and for an effect that resolves normally;
   - (d) an effect that resolves normally with placeholder prose re-observed still yields `publication_transition_unmoved` with the detail `The author_pr_prose transition left pr.prose unchanged at placeholder.`;
   - (e) an effect that throws a plain `Error` still yields `publication_retry` with reason `authoring_dispatch_failed`.
2. Verify RED.
3. Implement in `finish-publication.ts`: export `PublicationOperationFailedError` and `isPublicationOperationFailedError`; add `publication_operation_failed` to `HumanRequiredReason` and `HUMAN_REQUIRED_REASONS` with the message and next action from Technical Approach. In the author branch's catch, record the typed failure, after the `isRegionRestoreError` check and instead of setting `dispatchFailure`. After the mandatory `input.observe()`, apply the three-way classification from Technical Approach. Follow the region-restore pattern: discriminated error, classified inside the `coalescePublicationEffect` callback. Unlike region restore, re-observe first.
4. Verify GREEN.
5. Commit: "Halt FINISH with the underlying publish failure instead of unchanged prose".

**Done when:**
- [test] A coordinator test asserts that `advanceFinishPublication`, given an effect throwing `PublicationOperationFailedError` with placeholder prose re-observed, returns `human_required` reason `publication_operation_failed` with `pull-request.edit failed:` and the `read:org` error in `detail`.
- [test] A rendering test asserts that the halt reason for that disposition contains the message `A FINISH pull-request publish failed, so the authored prose never reached the pull request.`, the next action `Resolve the failure named below, then retry FINISH.`, and the error text, and does not contain `left pr.prose unchanged at placeholder`.
- [test] A coordinator test asserts that the same typed failure with authored prose re-observed returns `advanced` for `author_pr_prose` and no `human_required`, and that a normally-resolving effect with authored prose re-observed also returns `advanced` and no `human_required`.
- [test] Coordinator tests assert that a normally-resolving effect with placeholder re-observed returns `publication_transition_unmoved` with detail `The author_pr_prose transition left pr.prose unchanged at placeholder.`, and that a plain `Error` still returns the `authoring_dispatch_failed` retry.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication.ts` — typed error, reason, author-branch classification
- `src/conductor/test/engine/finish-publication.test.ts` — coordinator tests

**Dependencies:** none

### Task 5: Production `authorProse` attributes only this pass's same-PR edit failures
**Story:** Story 2, Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-production.test.ts` (new `describe('authorProse pass-window publish failures')`). Each uses a real `ConductorEventEmitter` as `events` and a `flushSessionEvents` stub that emits queued `github_operation_failed` events onto it; the `dispatchAuthoring` stub queues events during the call and returns `{ success: true }`, with the PR at `https://github.com/owner/repo/pull/7`:
   - (a) one matching event (operation `pull-request.edit`, target `owner/repo#7`) delivered by the post-dispatch flush → `authorProse` rejects with `PublicationOperationFailedError` carrying that operation and error;
   - (b) a matching event emitted before the call and none during it → resolves;
   - (c) during-call events for `owner/repo#8`, for `other/repo#7`, and for operation `pull-request.comment.create` → resolves;
   - (d) two matching events during the call → rejects with the second event's error;
   - (e) no `flushSessionEvents` dependency, and a flush that rejects → resolves;
   - (f) a stub returning `{ success: false }` after queuing a matching event → rejects with the existing `PR prose authoring dispatch did not complete successfully` error, not `PublicationOperationFailedError`;
   - (g) during-call events only of other kinds (e.g. `build_review_outer_verdict`) → resolves;
   - (h) after `authorProse` settles, resolved or rejected, a matching event emitted on `events` is not attributed to any later pass (the handler was removed).
2. Add `flush()` to `SessionEventTailOwner` and `startFeatureEventPersistence` in `event-persister.ts`, with a test in `event-persister` tests that a record appended to `.pipeline/pipeline-events.jsonl` is emitted by `flush()` and the tail keeps polling afterwards.
3. Verify RED.
4. Implement the production observer in `finish-publication-production.ts` exactly as Technical Approach describes, and pass the feature emitter and `flush` from the FINISH coordinator call sites. Delete `readPassPublishFailure` and the byte-offset `stat`. Keep the `!dispatched.success` throw first. Throw `PublicationOperationFailedError` (Task 4) for the last match.
5. Verify GREEN.
6. Commit: "Attribute this pass's PR edit failures in FINISH authoring from the event bus".

**Done when:**
- [test] A production test asserts that `authorProse` rejects with `PublicationOperationFailedError` carrying operation and error when a same-PR `pull-request.edit` failure is delivered on the bus by the post-dispatch flush of a successful dispatch.
- [test] A production test asserts that `authorProse` resolves for a matching event emitted before the dispatch, for during-call events naming another PR number, another repository, or `pull-request.comment.create`, and for during-call events only of other kinds.
- [test] A production test asserts that with two matching during-call events the rejection carries the last event's error.
- [test] A production test asserts that `authorProse` resolves without throwing when the flush dependency is missing or rejects, and that its handler is removed once it settles.
- [test] A production test asserts that an unsuccessful dispatch rejects with `PR prose authoring dispatch did not complete successfully` and not `PublicationOperationFailedError`, even with a matching event.
- [test] An event-persister test asserts `flush()` emits a newly appended sibling-ledger record without stopping the tail.
- `finish-publication-production.ts` contains no read of `pipeline-events.jsonl`.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — bus observer and `authorProse` wiring
- `src/conductor/src/engine/event-persister.ts` — tail `flush()`
- `src/conductor/src/daemon-cli.ts`, `src/conductor/src/index.ts`, `src/conductor/src/engine/executor-child-runtime.ts` — pass emitter and flush
- `src/conductor/test/engine/finish-publication-production.test.ts` — production tests
- `src/conductor/test/engine/event-persister.test.ts` — flush test

**Dependencies:** Tasks 1, 4

### Task 6: Conductor FINISH halts with the real publish failure end to end
**Story:** Story 2, Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-finish-publication.test.ts`, following that file's existing conductor FINISH harness (search for the `publication_transition_unmoved` cases):
   - (a) the FINISH authoring dispatch stub appends a malformed line and then two `github_operation_failed` records for the feature PR's `pull-request.edit` (the second carrying the missing-scope error) to the worktree's `.pipeline/pipeline-events.jsonl` and leaves the PR body as the placeholder → the persisted `.pipeline/HALT` reason contains the `publication_operation_failed` message and the second record's missing-scope error text and not `left pr.prose unchanged at placeholder`, and the emitted `finish_publication_disposition` (disposition `human_required`) and `loop_halt` events carry reason/detail naming the failure;
   - (b) the same stub without the failure record → the halt reason contains `The author_pr_prose transition left pr.prose unchanged at placeholder.`
2. Verify RED.
3. Implement: no new production surface is expected. If the conductor wiring drops the disposition detail between `advanceFinishPublication` and the halt, carry it through the existing `routeFinishPublicationDisposition` → `writeHaltMarker` path.
4. Verify GREEN.
5. Commit: "Prove FINISH halts with the recorded publish failure through the conductor".

**Done when:**
- [test] A conductor FINISH test asserts that a dispatch which records a malformed line and then two same-PR `pull-request.edit` failures and leaves placeholder prose writes a HALT whose reason is `publication_operation_failed` with the second failure's missing-scope error in its detail, and not `left pr.prose unchanged at placeholder`.
- [test] The same test asserts that the emitted `finish_publication_disposition` (disposition `human_required`) and `loop_halt` events carry the `publication_operation_failed` reason with the error text.
- [test] A conductor FINISH test asserts that a dispatch which records no failure and leaves placeholder prose writes a HALT whose reason contains `The author_pr_prose transition left pr.prose unchanged at placeholder.`

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — integration tests
- `src/conductor/src/engine/conductor.ts` — only if the disposition detail is dropped on the halt path

**Dependencies:** Tasks 4, 5

## Task Dependency Graph

```
Task 1 ──┬──▶ Task 3
Task 2 ──┘
Task 1 ──┬──▶ Task 5 ──▶ Task 6
Task 4 ──┴──────────────▶ Task 6
```

## Integration Points

- After Task 3: a real `github-operation` failure lands in the worktree sibling ledger and, through Task 1's admission, on the live bus.
- After Task 6: the full FINISH path from a provider-recorded failure to the HALT reason and spine events is proven through the conductor.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a worktree and a valid `pull-request.edit` request file, when `ai-conductor github-operation --request-file` runs and the GitHub command fails with a missing-scope error, then exactly one `github_operation_failed` record is appended to that worktree's `.pipeline/pipeline-events.jsonl` with `operation` `pull-request.edit`, the request's pull-request target, and an `error` that contains the missing-scope message, and the CLI still prints its `failed` result and exits 1 | 3 | "appends exactly one `github_operation_failed` line with operation `pull-request.edit`, the pull-request target, an `error` of at most 1000 characters that keeps the missing-scope error and contains none of `Command failed`, `gh pr edit`, `-R`, `--title`, `--body`, or the request title and body, and a ts to `.pipeline/pipeline-events.jsonl`, while stdout prints the unchanged `failed` result and the exit code is 1" | diff-local |
| Story 1 happy: Given a failed operation other than a PR edit, such as `pull-request.comment.create`, when the CLI reports `failed`, then a `github_operation_failed` record is appended with that operation and target | 3 | "a failing `pull-request.comment.create` with a 3000-character error appends one `JSON.parse`-able `github_operation_failed` line carrying that operation and target" | diff-local |
| Story 1 happy: Given a feature whose session event tail is running, when a `github_operation_failed` record is appended to the sibling ledger, then the same event is emitted on the live bus and persisted to the worktree's `.pipeline/events.jsonl` by the engine | 1 | "an `EventPersister` attached to that emitter writes the re-emitted `github_operation_failed` event to the worktree's `.pipeline/events.jsonl`" | diff-local |
| Story 1 negative: Given a failure whose text begins with `Command failed: gh pr edit 3372 -R owner/repo --title … --body …` followed by the GitHub error, when the event is recorded, then its `error` excludes the command line and request body, keeps the GitHub error text, and is at most 1000 characters long | 3, 2 | "an `error` of at most 1000 characters that keeps the missing-scope error and contains none of `Command failed`, `gh pr edit`, `-R`, `--title`, `--body`, or the request title and body" | diff-local |
| Story 1 negative: Given a failure whose GitHub error text alone exceeds 1000 characters, when the event is recorded, then `error` is truncated to 1000 characters and the record is still a single well-formed JSON line | 3, 2 | "appends one `JSON.parse`-able `github_operation_failed` line carrying that operation and target with an `error` of exactly 1000 characters" | diff-local |
| Story 1 negative: Given a request the CLI refuses, for example an unauthorized target or a malformed request file, when the CLI exits 1, then no `github_operation_failed` record is written | 3 | "refused, malformed-request-file, and executed results append no `github_operation_failed` record" | diff-local |
| Story 1 negative: Given an operation that executes successfully, when the CLI exits 0, then no `github_operation_failed` record is written | 3 | "refused, malformed-request-file, and executed results append no `github_operation_failed` record" | diff-local |
| Story 1 negative: Given a failed operation, when the CLI records the event, then it does not append the `github_operation_failed` record to `.pipeline/events.jsonl` itself; only the engine writes that file | 3 | "for a failed result the `events` emitter receives no `github_operation_failed` and `.pipeline/events.jsonl` contains none" | diff-local |
| Story 1 negative: Given a sibling ledger that cannot be written, for example because `.pipeline` is not writable, when an operation fails, then the CLI still prints its `failed` result and exits 1, with no crash and no different exit code | 3 | "a throwing `appendExternalEvent` leaves stdout's `failed` result and exit code 1 unchanged without rejecting" | diff-local |
| Story 1 negative: Given a sibling ledger containing a `github_operation_failed` record, when the session tail polls it, then it does not emit an `unadmitted-type` `pipeline_tail_diagnostic` for that record | 1 | "emits no `unadmitted-type` `pipeline_tail_diagnostic` for it" | diff-local |
| Story 2 happy: Given a feature PR whose prose is the engine placeholder, when the authoring pass completes successfully and a `github_operation_failed` record for `pull-request.edit` on that same PR was appended to the sibling ledger during the pass, and re-observation still shows placeholder prose, then FINISH resolves `human_required` with reason `publication_operation_failed` | 5, 4, 6 | "rejects with `PublicationOperationFailedError` carrying operation and error when a same-PR `pull-request.edit` failure is appended during a successful dispatch" | diff-local |
| Story 2 happy: Given that halt, when it is rendered and persisted, then the halt message names a failed PR publish, the next action tells the operator to resolve the named failure and retry FINISH, the detail contains the recorded error text (for example the missing `read:org` scope message), and the `finish_publication_disposition` and `loop_halt` events carry that reason and detail | 4, 6 | "contains the message `A FINISH pull-request publish failed, so the authored prose never reached the pull request.`, the next action `Resolve the failure named below, then retry FINISH.`, and the error text" | diff-local |
| Story 2 happy: Given that halt, when its reason text is inspected, then it does not contain "left pr.prose unchanged at placeholder" | 4, 6 | "does not contain `left pr.prose unchanged at placeholder`" | diff-local |
| Story 2 negative: Given a failure recorded during the pass, when re-observation shows the PR prose is no longer the placeholder, then the `author_pr_prose` transition advances normally and FINISH does not halt | 4 | "the same typed failure with authored prose re-observed returns `advanced` for `author_pr_prose` and no `human_required`" | diff-local |
| Story 2 negative: Given a `github_operation_failed` record for this PR appended before the pass started, and none during it, when the pass completes leaving placeholder prose, then the earlier failure is not attributed and FINISH resolves `publication_transition_unmoved` as today | 5, 4 | "`authorProse` resolves for a matching event emitted before the dispatch" | diff-local |
| Story 2 negative: Given a failure recorded during the pass for a different pull-request number, a different repository, or a different operation such as `pull-request.comment.create`, when the pass completes leaving placeholder prose, then that record is not attributed and FINISH resolves `publication_transition_unmoved` | 5, 4 | "for during-call records naming another PR number, another repository, or `pull-request.comment.create`" | diff-local |
| Story 2 negative: Given two failures for this PR recorded during the pass, when FINISH halts, then the detail carries the error of the last recorded failure | 6, 5 | "writes a HALT whose reason is `publication_operation_failed` with the second failure's missing-scope error in its detail" | diff-local |
| Story 2 negative: Given a sibling ledger that is missing or unreadable after the pass, when the pass completes leaving placeholder prose, then FINISH treats it as no recorded failure and resolves `publication_transition_unmoved`, with no crash | 5, 4 | "`authorProse` resolves without throwing when the ledger is missing or unreadable" | diff-local |
| Story 2 negative: Given a sibling ledger with a malformed line appended during the pass alongside a valid matching failure record, when FINISH reads the pass window, then the malformed line is skipped and the valid failure still produces `publication_operation_failed` | 6, 5 | "a dispatch which records a malformed line and then two same-PR `pull-request.edit` failures and leaves placeholder prose writes a HALT whose reason is `publication_operation_failed`" | diff-local |
| Story 2 negative: Given an authoring dispatch that itself does not complete successfully, when a matching failure was also recorded, then FINISH follows the existing transient retry path (`authoring_dispatch_failed`) and does not resolve `publication_operation_failed` | 5, 4 | "an unsuccessful dispatch rejects with `PR prose authoring dispatch did not complete successfully` and not `PublicationOperationFailedError`, even with a matching record" | diff-local |
| Story 3 happy: Given a feature PR whose prose is the engine placeholder, when the authoring pass completes successfully, no `github_operation_failed` record was appended during the pass, and re-observation still shows placeholder prose, then FINISH resolves `human_required` / `publication_transition_unmoved` with the detail "The author_pr_prose transition left pr.prose unchanged at placeholder." | 4, 6 | "a normally-resolving effect with placeholder re-observed returns `publication_transition_unmoved` with detail `The author_pr_prose transition left pr.prose unchanged at placeholder.`" | diff-local |
| Story 3 negative: Given the same pass, when the sibling ledger received only records of other admitted kinds during the pass, then FINISH still resolves `publication_transition_unmoved`, not `publication_operation_failed` | 5, 4 | "and for during-call records only of other admitted kinds" | diff-local |
| Story 3 negative: Given a pass that completes with no recorded failure and leaves authored prose, when re-observed, then the transition advances and no halt is produced | 4 | "a normally-resolving effect with authored prose re-observed also returns `advanced` and no `human_required`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D1 | task | task-1, task-2, task-3 | strips the `Command failed: gh pr edit … --title … --body …` command line and the multi-line request body while keeping the GitHub missing-scope error text |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D2 | task | task-1, task-3 | for a failed result the `events` emitter receives no `github_operation_failed` and `.pipeline/events.jsonl` contains none |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D3 | task | task-5 | rejects with `PublicationOperationFailedError` carrying operation and error when a same-PR `pull-request.edit` failure is appended during a successful dispatch |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D4 | task | task-4, task-6 | returns `human_required` reason `publication_operation_failed` with `pull-request.edit failed:` and the `read:org` error in `detail` |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D5 | task | task-4, task-6 | writes a HALT whose reason contains `The author_pr_prose transition left pr.prose unchanged at placeholder.` |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D1 | no-change | none | Closeout-obligation telemetry is already retired on main (no `pipeline_closeout*` kinds in `src/conductor/src/types/events.ts`); this feature adds no closeout kind back |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D2 | no-change | none | The sibling ledger, its single pipeline-side writer, `CloseoutEventTail`, and `readMergedFeatureEvents` keep their role; this feature only writes one more admitted kind through `appendCloseoutEvent` |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D3 | task | task-1 | emits no `unadmitted-type` `pipeline_tail_diagnostic` for it |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D4 | no-change | none | The build-tail rollup is untouched; `github_operation_failed` records do not form or affect build windows |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D5 | no-change | none | The `closeout-event` CLI removal and its migration block already shipped; this feature changes no `bin/conduct` CLI surface |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-operator-5-r1: Replace the direct pipeline-events.jsonl reader in production authorProse with the bus observer Task 5 now specifies
**Gate:** operator
**Rationale:** Operator decision 2026-10-25 resolving build_review decision stop 64898260 (eventSpine vs. Task 5). The committed `readPassPublishFailure` parses `.pipeline/pipeline-events.jsonl` from a byte offset to decide FINISH's outcome, a second reader of the sibling ledger that `.agents/skills/event-spine/SKILL.md` §7 grades as a channel. ADR adr-2026-10-24-finish-surfaces-guarded-publish-failures decision 3 and Task 5 are amended so the decision is taken from `github_operation_failed` events re-emitted on the feature bus after a session-tail flush. This task migrates the already-committed Task 5 code to that design.
**Parent task:** 5
**Done when:**
- [test] Every Task 5 Done-when check passes against the bus observer.
- `finish-publication-production.ts` contains no read of `pipeline-events.jsonl` and no `readPassPublishFailure`.
- [test] The conductor FINISH end-to-end tests (Task 6) still pass.
