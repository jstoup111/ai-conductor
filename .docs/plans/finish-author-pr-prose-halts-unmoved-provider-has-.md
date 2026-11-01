# Implementation Plan: The engine performs FINISH's PR-prose write; the provider only returns prose

**Date:** 2026-10-31
**Design:** .docs/decisions/adr-2026-10-31-engine-performs-finish-pr-prose-write.md (technical track, Tier M; see `.docs/track/finish-author-pr-prose-halts-unmoved-provider-has-.md`)
**Stories:** .docs/stories/finish-author-pr-prose-halts-unmoved-provider-has-.md
**Conflict check:** Clean as of 2026-10-31 (`.docs/conflicts/finish-author-pr-prose-halts-unmoved-provider-has-.md`)

## Summary

Move FINISH's PR title and body write from the provider to the engine (jstoup111/ai-conductor#3529).
The provider writes a versioned handoff file. The engine decodes it, re-splices step regions,
validates it, and publishes through the guarded `pull-request.edit` path it already owns. A missing
or invalid handoff becomes its own bounded retry, carried into the next pass as guidance. The judge
loses its repair write, the skills and prompts state one contract, and a no-subcommand session
refusal names the sanctioned set. Twelve tasks.

## Technical Approach

- **Verified current behavior (local main `a16d437912`).**
  - The production `authorProse` effect (`src/conductor/src/engine/finish-publication-production.ts`) awaits `dispatchAuthoring(request)`, throws when `!dispatched.success`, and otherwise relies only on re-observation. Around the dispatch it flushes the session tail and subscribes to `github_operation_failed` to detect a provider-side publish failure (adr-2026-10-24 D3).
  - The conductor's `dispatchAuthoring` wrapper (`Conductor.runFinishPublication` in `src/conductor/src/engine/conductor.ts`) runs `restoreCapturedRegions` in a `finally` after every author and judgment dispatch. So by the time `authorProse` regains control, captured project-owned regions are already back in the PR body.
  - `mutateRetainedPullRequest` (`finish-publication-production.ts`) wraps one guarded `executeGithubOperation` over the coordinator's `operations` boundary. Today it is used for `pull-request.edit` body-only and `pull-request.ready`. `pull-request.edit` accepts `title` and `body` together (`payloadFrom` in `src/conductor/src/engine/github-operations.ts`).
  - `prProse` in the same file classifies placeholder prose through `isEngineFlooredBody(body, templateBytes)` plus the auto-draft text check, so a floor-marked body with authored prose is not a placeholder (`preserve-project-owned-pr-body-sections-through-fi` criterion 60).
  - `advanceFinishPublication`'s `author_pr_prose` branch (`src/conductor/src/engine/finish-publication.ts`) classifies thrown region-restore and publication-operation errors, and maps everything else to `authoring_dispatch_failed`. A completed pass runs the fixed-point guard (`publication_transition_unmoved`).
  - `retry_finish` routes spend the FINISH step attempt budget in `conductor.ts`. Exhaustion halts with `FINISH publication retry exhausted: <reason>`, without the retry detail.
  - The FINISH author, revision, and judgment prompt blocks are built in `src/conductor/src/engine/step-runners.ts`. The author blocks say "rewrite/Revise the retained PR title and body in place". Both judgment blocks grant "repair only that title/body".
  - `evaluateDaemonSessionCommandPolicy` (`src/conductor/src/execution/daemon-session.ts`) renders a missing subcommand as `blocked subcommand: <none>`.
- **Design (adr-2026-10-31-engine-performs-finish-pr-prose-write D1–D7).**
  - A new module `src/conductor/src/engine/finish-pr-prose-handoff.ts` owns the handoff path, its closed decoder, its stale-file deletion, and pure prose application. The production effect composes these with the existing tracker read and `mutateRetainedPullRequest`.
  - A typed `PrProseAuthoringFailedError` (`not_returned` or `invalid`) crosses from the production effect into the coordinator, which turns it into `publication_retry` `prose_not_returned` or `prose_invalid` after re-observation. Re-observation stays authoritative.
  - The engine's own failed edit reuses `PublicationOperationFailedError` and the existing `publication_operation_failed` arm.
  - Revision guidance for the next pass is held per PR in the production coordinator's closure, like its other per-PR maps.
- **Sequencing.** The decoder (1) and pure application (2) and the coordinator mapping (3) come first. The production effect (4) wires them, and (5)–(7) prove its failure and guidance behavior. Prompt (9, 10), skill (11), conductor halt text (8), and guard (12) work is independent.
- **Cross-boundary ownership.** Task 4 owns the integration proof through `createProductionFinishPublicationCoordinator(...).advance()`, which is the entry point the conductor's FINISH step calls. Task 8 owns the conductor-level halt. Task 12 owns the guard proof through `guardDaemonSessionInvocation`, the CLI entry guard.
- **Amended #3376 Stories 2–3.** These are on main and rewritten by this spec. Tasks 4 and 6 deliver them: the engine's own failed or refused edit maps to `publication_operation_failed`, an executed edit that still reads placeholder keeps `publication_transition_unmoved`, and sibling-ledger records are no longer attributed.
- **Pattern context.** Guarded engine edit: follow `restoreCapturedRegionsFrom` (`conductor.ts`) and `mutateRetainedPullRequest`. Read the current body, compute the next body purely, short-circuit when unchanged, make one guarded `executeGithubOperation` call with a purpose-named actor, and treat any non-`executed` result as a typed failure. Provider payload file: follow `readDocumentationDelivery` (`src/conductor/src/engine/documentation-delivery.ts`), with a fixed `.pipeline/` path, a `version` field, and a decoder that rejects rather than repairs. Stale exclusion here is delete-before-dispatch.

## Prerequisites

- None. No migration, dependency, config key, or CLI flag.

## Tasks

### Task 1: Decode the prose handoff file
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-pr-prose-handoff.test.ts` for `readPrProseHandoff(pipelineDir)` and `clearPrProseHandoff(pipelineDir)`, using a temporary `.pipeline/` directory per test.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/finish-pr-prose-handoff.ts`. Export `PR_PROSE_HANDOFF_PATH = ".pipeline/finish-pr-prose.json"`, the semantic type `AuthoredPrProse` (`title`, `body`; only the decoder constructs it) and the closed result `{ kind: "returned"; prose }`, `{ kind: "not_returned" }`, or `{ kind: "invalid"; detail }`. The decoder rejects rather than repairs: missing file → `not_returned`; JSON parse failure → `invalid` "handoff could not be parsed"; `version !== 1`, or a `title`/`body` that is missing, not a string, or empty after trim → `invalid` with a detail naming that field. The title is trimmed; the body is kept byte-for-byte. Pattern context: follow `readDocumentationDelivery` in `src/conductor/src/engine/documentation-delivery.ts` (fixed `.pipeline/` path, `version` field, closed decoder). Allowed variation: stale exclusion is delete-before-dispatch (`clearPrProseHandoff`, which ignores ENOENT) rather than a timestamp floor.
4. Verify the tests pass (GREEN).
5. Commit: "Decode the FINISH PR-prose handoff file".

**Done when:**
- [test] `readPrProseHandoff` in `finish-pr-prose-handoff.ts` returns `not_returned` when `.pipeline/finish-pr-prose.json` is missing, and returns `invalid` with a detail stating the handoff could not be parsed for unparsable JSON
- [test] `readPrProseHandoff` returns `invalid` with a detail naming the offending field for `version` 2, a missing `title`, a missing `body`, a non-string `title`, a non-string `body`, a whitespace-only `title`, and a whitespace-only `body`, one fixture each
- [test] `readPrProseHandoff` returns `returned` whose `AuthoredPrProse.title` is the trimmed, non-empty title for an otherwise valid handoff whose title has leading and trailing whitespace
- [test] `clearPrProseHandoff` deletes an existing `.pipeline/finish-pr-prose.json` and resolves without error when the file does not exist

**Files likely touched:**
- src/conductor/src/engine/finish-pr-prose-handoff.ts
- src/conductor/test/engine/finish-pr-prose-handoff.test.ts

**Dependencies:** none

### Task 2: Apply returned prose to the current PR body
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-pr-prose-handoff.test.ts` for `applyAuthoredPrProse({ currentBody, prose, isPlaceholder })`.
2. Verify the tests fail (RED).
3. Add `listRegionKeys(body)` to `src/conductor/src/engine/pr-body-regions.ts`, using the same `<!-- ai-conductor:step <key> -->` marker grammar as `markersFor`. In `src/conductor/src/engine/finish-pr-prose-handoff.ts`, implement `applyAuthoredPrProse`. For every key `listRegionKeys` finds in `currentBody`, call `restoreRegion(next, { key, bytes: extractRegionBytes(currentBody, key) })`. Then return `invalid` "body is still placeholder" when the injected `isPlaceholder(title, body)` is true. Then return `invalid` naming `Closes <ref>` when `currentBody` carries a `Closes owner/repo#N` reference the result lacks. Otherwise return `{ kind: "apply", title, body }`. The result is pure: no I/O.
4. Verify the tests pass (GREEN).
5. Commit: "Re-splice step regions and validate returned PR prose".

**Done when:**
- [test] `applyAuthoredPrProse` given a current body with three `ai-conductor:step` regions and a handoff body that omits one, changes the bytes of another, and repeats a third returns a body containing every region exactly once with its current-body bytes
- [test] `applyAuthoredPrProse` returns `invalid` with a detail stating the body is still placeholder when its injected `isPlaceholder` classifier returns true for the spliced title and body
- [test] `applyAuthoredPrProse` returns `invalid` with a detail naming the missing `Closes owner/repo#N` reference when the current body contains that reference and the handoff body lacks it
- [test] `applyAuthoredPrProse` returns `apply` with the spliced body when neither the current body nor the handoff body carries a `Closes` reference
- `applyAuthoredPrProse` obtains the keys it re-splices only from `listRegionKeys` in `pr-body-regions.ts`

**Files likely touched:**
- src/conductor/src/engine/finish-pr-prose-handoff.ts
- src/conductor/src/engine/pr-body-regions.ts
- src/conductor/test/engine/finish-pr-prose-handoff.test.ts

**Dependencies:** Task 1

### Task 3: Coordinator maps a typed authoring failure to a specific retry
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing coordinator tests in `src/conductor/test/engine/finish-publication.test.ts` with a fake `authorProse` effect that throws the new error.
2. Verify the tests fail (RED).
3. In `src/conductor/src/engine/finish-publication.ts`, export `PrProseAuthoringFailedError` (`cause: "not_returned" | "invalid"`, `detail`) and `isPrProseAuthoringFailedError`. In the `author_pr_prose` branch catch, classify it before the `dispatchFailure` fallback. After the existing mandatory re-observation: `ambiguous` identity → `ambiguous_pr_identity` as today; prose observed as neither `placeholder` nor `indeterminate` → `advancedPublicationTransition` as the publication-failure arm does today; otherwise `publication_retry` with reason `prose_not_returned` or `prose_invalid` and the error detail. The fixed-point guard never runs for this error. Add both reasons to the `author_pr_prose` retry-reason list; do not add them to `NON_RETRYABLE_PUBLICATION_REASONS`.
4. Verify the tests pass (GREEN).
5. Commit: "Report a missing or invalid PR-prose handoff as its own retry".

**Done when:**
- [test] when the `authorProse` effect throws `PrProseAuthoringFailedError` with cause `not_returned` and re-observation still reads placeholder, `advanceFinishPublication` returns `publication_retry` for `author_pr_prose` with reason `prose_not_returned` and never `publication_transition_unmoved`
- [test] when it throws cause `invalid` with a detail and re-observation still reads placeholder, `advanceFinishPublication` returns `publication_retry` with reason `prose_invalid` carrying that detail
- [test] when it throws either cause and re-observation reads prose that is no longer placeholder, `advanceFinishPublication` returns `advanced` for `author_pr_prose` and no `prose_not_returned` or `prose_invalid` retry
- `prose_not_returned` and `prose_invalid` appear in the `author_pr_prose` retry-reason list and are absent from `NON_RETRYABLE_PUBLICATION_REASONS`

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts
- src/conductor/test/engine/finish-publication.test.ts

**Dependencies:** none

### Task 4: The engine publishes the returned prose
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-pr-prose-authoring.test.ts` that drive `createProductionFinishPublicationCoordinator(...).advance()` with a fake `dispatchAuthoring` that writes (or does not write) the handoff in the test worktree, a fake guarded `operations` runner, and a fake tracker read that returns the post-edit body on re-observation.
2. Verify the tests fail (RED).
3. Rewrite the production `authorProse` effect in `src/conductor/src/engine/finish-publication-production.ts`. (1) `clearPrProseHandoff(pipelineDir)` before `dispatchAuthoring`. (2) Keep the existing `!dispatched.success` throw, before any handoff read. (3) `readPrProseHandoff(pipelineDir)`: `not_returned`/`invalid` → throw `PrProseAuthoringFailedError`. (4) Read the retained PR's current title and body with the tracker read the observer already uses. This read happens after the conductor's `dispatchAuthoring` wrapper has run `restoreCapturedRegions`, so captured project-owned region bytes are present (conflict-report constraint 2). (5) Call `applyAuthoredPrProse` with `isPlaceholder` bound to the observer's own placeholder classification: extract the placeholder branch of `prProse` (`isEngineFlooredBody` with the configured template bytes, plus the auto-draft text check) into a named helper that both use. (6) Publish through `mutateRetainedPullRequest`, widened to accept `payload: { title, body }`, with the coordinator's guarded `operations`. Delete the `observeFailure` subscription and both `flushSessionEvents` calls around the dispatch (adr-2026-10-24 D3 as amended). Pattern context: follow `restoreCapturedRegionsFrom` in `src/conductor/src/engine/conductor.ts` and the existing `mutateRetainedPullRequest` callers. Read the current body, compute the next body purely, then make one guarded `executeGithubOperation` call with a purpose-named actor. Allowed variation: the payload adds `title`. Search hints: `mutateRetainedPullRequest`, `restoreCapturedRegionsFrom`.
4. Verify the tests pass (GREEN).
5. Commit: "Publish authored PR prose from the engine".

**Done when:**
- [test] Through `createProductionFinishPublicationCoordinator(...).advance()` with a fake dispatch that writes a valid handoff and makes no GitHub call, the guarded operation runner receives exactly one `pull-request.edit` whose payload title is the trimmed handoff title and whose body is the handoff body re-spliced so that, for a current body with three `ai-conductor:step` regions and a handoff body that omits one, changes the bytes of another, and repeats a third, every region appears exactly once with its current-body bytes, and the result is `advanced` for `author_pr_prose` after re-observation reads non-placeholder prose
- [test] Through `advance()` with a stale handoff present before dispatch and a dispatch that writes none, the file is already deleted when the fake dispatch starts, the runner receives no `pull-request.edit`, and the result is `publication_retry` with reason `prose_not_returned`
- [test] Through `advance()` with a dispatch returning `success: false` after writing a valid handoff, the runner receives no `pull-request.edit` and the result is `publication_retry` with reason `authoring_dispatch_failed`
- [test] Through `advance()` with a `github_operation_failed` record for this PR's `pull-request.edit` appended to the worktree's sibling ledger `.pipeline/pipeline-events.jsonl` by the fake dispatch (and the same event emitted on the feature bus), a valid handoff and an executed edit, the result is `advanced` and not `publication_operation_failed`
- the production `authorProse` effect in `finish-publication-production.ts` no longer calls `flushSessionEvents` or subscribes to `github_operation_failed`

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-pr-prose-authoring.test.ts

**Dependencies:** Tasks 1, 2, 3

### Task 5: Invalid returned prose is rejected through production
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-pr-prose-authoring.test.ts` through `advance()`, reusing Task 4's fixtures.
2. Verify the tests fail (RED).
3. Fix whatever these fixtures expose in the Task 4 wiring (expected: none beyond the observer-classifier binding and the decoder pass-through).
4. Verify the tests pass (GREEN).
5. Commit: "Prove invalid PR-prose handoffs never reach the PR".

**Done when:**
- [test] Through `advance()` with a handoff whose title and body are the unchanged engine-floored template body, the runner receives no `pull-request.edit` and the result is `publication_retry` with reason `prose_invalid` and a detail stating the body is still placeholder, classified by the same placeholder helper `observePublicationSnapshot` uses
- [test] Through `advance()` with each of unparsable JSON, `version` 2, a missing `title`, a missing `body`, a non-string `title`, a non-string `body`, a whitespace-only `title` and a whitespace-only `body`, the result is `publication_retry` with reason `prose_invalid`, a detail stating the parse failure or naming that field, and no `pull-request.edit`
- [test] Through `advance()` with a current body containing `Closes owner/repo#N` and a handoff body lacking it, the result is `publication_retry` with reason `prose_invalid`, a detail naming `Closes owner/repo#N`, and no `pull-request.edit`; with neither body carrying a `Closes` reference the edit is performed and the result is `advanced`

**Files likely touched:**
- src/conductor/test/engine/finish-pr-prose-authoring.test.ts
- src/conductor/src/engine/finish-publication-production.ts

**Dependencies:** Task 4

### Task 6: A failed or refused engine edit halts with the real cause
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-pr-prose-authoring.test.ts` through `advance()`. These also deliver the amended Stories 2–3 of the #3376 spec: the engine's own failed edit, and an executed edit that still reads placeholder.
2. Verify the tests fail (RED).
3. In `src/conductor/src/engine/finish-publication-production.ts`, map a non-ok `mutateRetainedPullRequest` result to `PublicationOperationFailedError("pull-request.edit", message)`, so a failed, refused, or partial edit reaches the existing coordinator arm.
4. Verify the tests pass (GREEN).
5. Commit: "Halt on the engine's own failed PR-prose edit with its error".

**Done when:**
- [test] Through `advance()` with a valid handoff whose guarded `pull-request.edit` returns a failed result carrying a missing `read:org` scope message and re-observation still reading placeholder, the result is `human_required` with reason `publication_operation_failed` and a detail containing `pull-request.edit` and that error text
- [test] Through `advance()` with no guarded operation boundary available, the result is `human_required` `publication_operation_failed` with a detail naming the refusal; with a failed edit but re-observation reading moved prose, the result is `advanced`
- [test] Through `advance()` with a valid handoff whose edit executes but re-observation still reads placeholder, the result is `human_required` `publication_transition_unmoved` with detail "The author_pr_prose transition left pr.prose unchanged at placeholder."

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-pr-prose-authoring.test.ts

**Dependencies:** Task 4

### Task 7: The next author pass carries the failure as guidance
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-pr-prose-authoring.test.ts` with two consecutive `advance()` calls on one production coordinator.
2. Verify the tests fail (RED).
3. In `src/conductor/src/engine/finish-publication-production.ts`, keep a per-PR map of the last authoring failure, set when `authorProse` throws `PrProseAuthoringFailedError` and cleared on a published edit. When the next `authorProse` runs, merge that detail into the request's `revisionGuidance`, after any judge guidance. A `not_returned` failure renders as "No PR-prose handoff was written to .pipeline/finish-pr-prose.json." The map is process-local; after a restart the pass runs without it.
4. Verify the tests pass (GREEN).
5. Commit: "Carry a PR-prose handoff failure into the next author pass".

**Done when:**
- [test] Through two `advance()` calls on one production coordinator where the first pass returns a handoff lacking the current `Closes owner/repo#N` reference, the second `dispatchAuthoring` request carries `revisionGuidance` containing that missing-reference detail
- [test] After a first pass that writes no handoff, the second `dispatchAuthoring` request carries `revisionGuidance` stating that no handoff file was written and naming `.pipeline/finish-pr-prose.json`; when that second pass writes a valid handoff the prose is published through one `pull-request.edit` and the result is `advanced`
- [test] Through `advance()` for a revision pass (observed `pr.prose = revision_required` with a persisted judge detail) whose dispatch writes a valid handoff, the runner receives one `pull-request.edit` with the handoff prose and the next selected transition after re-observation is `judge_pr_prose`

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-pr-prose-authoring.test.ts

**Dependencies:** Tasks 5, 6

### Task 8: Retry exhaustion names the authoring cause and its detail
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-finish-publication.test.ts` with a fake `finishPublication` whose `advance` returns `publication_retry` on every attempt.
2. Verify the tests fail (RED).
3. In `src/conductor/src/engine/conductor.ts`, the `retry_finish` exhaustion branch appends ` Detail: <route.detail>` to `FINISH publication retry exhausted: <reason>` when a detail is present. No-detail text is unchanged, and the attempt budget and non-retryable handling are untouched.
4. Verify the tests pass (GREEN).
5. Commit: "Carry the retry detail into the FINISH retry-exhausted halt".

**Done when:**
- [test] A conductor run whose FINISH publication returns `publication_retry` reason `prose_not_returned` with a detail on every attempt emits one `finish_publication_disposition` `retry_finish` per attempt, dispatches FINISH exactly `stepMaxRetries` times, then halts needs-human with a reason containing `FINISH publication retry exhausted: prose_not_returned` and that detail, and not containing "left pr.prose unchanged at placeholder"
- [test] The same run returning reason `prose_invalid` with a different detail on the last attempt halts with a reason naming `prose_invalid` and the last attempt's detail
- [test] A run whose exhausted retry carries no detail halts with exactly `FINISH publication retry exhausted: <reason>`, unchanged from today

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-finish-publication.test.ts

**Dependencies:** Task 3

### Task 9: Author and revision prompts name the handoff
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing prompt tests in `src/conductor/test/engine/step-runners.test.ts` for the `finishProsePass: "author"` block, with and without `revisionGuidance`.
2. Verify the tests fail (RED).
3. In `src/conductor/src/engine/step-runners.ts`, rewrite both author blocks. Each tells the provider to write only `.pipeline/finish-pr-prose.json` as `{"version":1,"title":"…","body":"…"}`, to make no PR edit and no GitHub call, and that the engine validates and publishes it. Keep the `/pr` contract, section-shape, `ai-conductor:step`, and do-not-commit guidance. The revision block keeps "The prior objection is:" followed by the guidance. Remove "Revise the retained PR title and body in place" and "rewrite the retained PR title and body in place".
4. Verify the tests pass (GREEN).
5. Commit: "Tell the FINISH author pass to return prose through the handoff".

**Done when:**
- [test] The FINISH author prompt built by `DefaultStepRunner` names `.pipeline/finish-pr-prose.json` and the exact `{"version":1,"title":…,"body":…}` shape, tells the provider to write only that file, and contains none of "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`
- [test] The revision prompt built with `revisionGuidance` contains the guidance text and the same handoff path and shape instruction, and contains none of "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** none

### Task 10: The prose judge returns only a verdict
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing prompt tests in `src/conductor/test/engine/step-runners.test.ts` for the unattended and interactive FINISH judgment blocks, and coordinator tests in `src/conductor/test/engine/finish-publication.test.ts` (reuse an existing assertion where one already proves the routing).
2. Verify the tests fail (RED).
3. In `src/conductor/src/engine/step-runners.ts`, remove "You may repair only that title/body, at most once" and "you may repair only that retained PR title/body once" from both judgment blocks. Instruct the provider to inspect the title and body and return exactly one verdict JSON object, keeping the closed verdict set and the placeholder rule.
4. Verify the tests pass (GREEN).
5. Commit: "Remove the PR repair permission from the FINISH prose judge".

**Done when:**
- [test] The unattended and interactive FINISH judgment prompts each list the closed verdict set, instruct returning exactly one verdict JSON object, and contain none of "may repair", "repair only", "may edit", "edit the PR", "edit only", "may rewrite", "rewrite", "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`
- [test] A coordinator test with a persisted `revision_required` verdict carrying a detail selects `author_pr_prose` and passes that detail as the authoring request's `revisionGuidance`; one with an `accepted` verdict dispatches no author pass and no `pull-request.edit`
- [test] A coordinator test whose judgment dispatch changes the PR body revision re-observes `pr.prose` as `stale` and selects `judge_pr_prose` for the new revision instead of accepting it

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts
- src/conductor/test/engine/finish-publication.test.ts

**Dependencies:** Task 9

### Task 11: Both skills state one PR-prose contract
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing assertions in `test/test_harness_integrity.sh` next to the existing `skills/finish/SKILL.md` checks.
2. Verify they fail (RED).
3. In `skills/finish/SKILL.md` (PR Prose Authoring), replace "rewrite the retained PR's title and body in place" with: write `.pipeline/finish-pr-prose.json` (`version`, `title`, `body`); the engine validates it and performs the PR title and body write. In `skills/pr/SKILL.md` §6, state that during FINISH the provider writes that handoff file and the engine performs the write.
4. Verify they pass (GREEN).
5. Commit: "State one FINISH PR-prose write contract in finish and pr skills".

**Done when:**
- [test] `test/test_harness_integrity.sh` asserts that `skills/finish/SKILL.md` instructs the provider to write `.pipeline/finish-pr-prose.json` (the phrase "write `.pipeline/finish-pr-prose.json`") and states that the engine performs the PR title and body write
- [test] `test/test_harness_integrity.sh` asserts that `skills/pr/SKILL.md` states that during FINISH the provider writes `.pipeline/finish-pr-prose.json` (the phrase "write `.pipeline/finish-pr-prose.json`") and that the engine performs the PR title and body write
- [test] `test/test_harness_integrity.sh` asserts that neither `skills/finish/SKILL.md` nor `skills/pr/SKILL.md` contains the phrase "in place" anywhere, case-insensitively, so neither can instruct an in-place title or body rewrite

**Files likely touched:**
- skills/finish/SKILL.md
- skills/pr/SKILL.md
- test/test_harness_integrity.sh

**Dependencies:** none

### Task 12: A missing-subcommand refusal names the sanctioned set
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/daemon-session-enforcement.test.ts` through `guardDaemonSessionInvocation` with the daemon-session marker set in the supplied env.
2. Verify the tests fail (RED).
3. In `src/conductor/src/execution/daemon-session.ts`, when the bounded subcommand is `none`, return the refusal "ai-conductor was invoked without a subcommand from inside a daemon-managed session. Sanctioned subcommands: <SESSION_SANCTIONED_SUBCOMMANDS joined>." The refusal keeps `subcommand: "none"` and reflects no argv. Other refusals are unchanged. Also correct the `github-operation` comment so it no longer names the author_pr_prose pass as a caller.
4. Verify the tests pass (GREEN).
5. Commit: "Explain a no-subcommand refusal in daemon sessions".

**Done when:**
- [test] `guardDaemonSessionInvocation` with the daemon-session marker refuses `ai-conductor --help` and bare `ai-conductor` with `subcommand` `none` and a message stating no subcommand was given and listing every member of `SESSION_SANCTIONED_SUBCOMMANDS`, including `github-operation`
- [test] those no-subcommand messages contain neither `blocked subcommand: <none>` nor an unknown flag token passed alongside `--help`, such as `--zz-unknown-token`
- [test] with the marker set, `ai-conductor daemon status` is refused with the message containing `blocked subcommand: daemon` exactly as before, and `ai-conductor github-operation --request-file <file>` returns `allowed: true`
- the `github-operation` comment in `SESSION_SANCTIONED_SUBCOMMANDS` no longer names the author_pr_prose pass as its caller

**Files likely touched:**
- src/conductor/src/execution/daemon-session.ts
- src/conductor/test/execution/daemon-session-enforcement.test.ts

**Dependencies:** none

## Task Dependency Graph

```
1 ──► 2 ──┐
          ├──► 4 ──► 5 ──┐
3 ────────┘      └──► 6 ─┴──► 7
3 ──► 8
9 ──► 10
11 (independent)
12 (independent)
```

## Integration Points

- After Task 4: a full production `advance()` publishes provider-returned prose through the engine's guarded edit.
- After Task 7: repeated authoring failures carry their cause into the next pass.
- After Task 8: a FINISH run that never recovers halts naming `prose_not_returned` or `prose_invalid` with its detail.

## Coverage Check

Notation: `<file>` in a quoted check is a placeholder argument, not a repository path.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature PR whose prose is the engine placeholder, when the author pass writes a valid handoff file and makes no GitHub call, then the engine performs exactly one guarded `pull-request.edit` on that PR whose title and body come from the handoff, re-observation shows prose that is no longer placeholder, and the `author_pr_prose` transition advances with no operator action | 4 | "[test] Through `createProductionFinishPublicationCoordinator(...).advance()` with a fake dispatch that writes a valid handoff and makes no GitHub call, the guarded operation runner receives exactly one `pull-request.edit` whose payload title is the trimmed handoff title and whose body is the handoff body re-spliced so that, for a current body with three `ai-conductor:step` regions and a handoff body that omits one, changes the bytes of another, and repeats a third, every region appears exactly once with its current-body bytes, and the result is `advanced` for `author_pr_prose` after re-observation reads non-placeholder prose" | diff-local |
| Story 1 happy: Given the current PR body contains `ai-conductor:step` regions, when the handoff body omits one region, changes the bytes of another, and repeats a third, then the published body contains every region exactly once with the bytes it had in the current PR body | 2, 4 | "[test] Through `createProductionFinishPublicationCoordinator(...).advance()` with a fake dispatch that writes a valid handoff and makes no GitHub call, the guarded operation runner receives exactly one `pull-request.edit` whose payload title is the trimmed handoff title and whose body is the handoff body re-spliced so that, for a current body with three `ai-conductor:step` regions and a handoff body that omits one, changes the bytes of another, and repeats a third, every region appears exactly once with its current-body bytes, and the result is `advanced` for `author_pr_prose` after re-observation reads non-placeholder prose" | diff-local |
| Story 1 happy: Given a revision pass dispatched with judge guidance after a `revision_required` verdict, when the provider writes a valid handoff, then the engine publishes it in the same way and the next selected transition is `judge_pr_prose` | 7 | "[test] Through `advance()` for a revision pass (observed `pr.prose = revision_required` with a persisted judge detail) whose dispatch writes a valid handoff, the runner receives one `pull-request.edit` with the handoff prose and the next selected transition after re-observation is `judge_pr_prose`" | diff-local |
| Story 1 happy: Given an otherwise valid handoff whose title has leading and trailing whitespace, when the engine publishes it, then the published title is the trimmed, non-empty title | 1, 4 | "[test] Through `createProductionFinishPublicationCoordinator(...).advance()` with a fake dispatch that writes a valid handoff and makes no GitHub call, the guarded operation runner receives exactly one `pull-request.edit` whose payload title is the trimmed handoff title and whose body is the handoff body re-spliced so that, for a current body with three `ai-conductor:step` regions and a handoff body that omits one, changes the bytes of another, and repeats a third, every region appears exactly once with its current-body bytes, and the result is `advanced` for `author_pr_prose` after re-observation reads non-placeholder prose" | diff-local |
| Story 1 negative: Given a handoff file left in `.pipeline/` by an earlier pass, when a new author pass is dispatched and that pass writes no handoff, then the earlier file was removed before the dispatch, its content is never published, and the pass is treated as returning no prose | 1, 4 | "[test] Through `advance()` with a stale handoff present before dispatch and a dispatch that writes none, the file is already deleted when the fake dispatch starts, the runner receives no `pull-request.edit`, and the result is `publication_retry` with reason `prose_not_returned`" | diff-local |
| Story 1 negative: Given the author pass writes no handoff file, when the pass completes successfully and re-observation still shows placeholder prose, then the engine performs no `pull-request.edit` and FINISH returns `publication_retry` with reason `prose_not_returned` | 3, 4 | "[test] Through `advance()` with a stale handoff present before dispatch and a dispatch that writes none, the file is already deleted when the fake dispatch starts, the runner receives no `pull-request.edit`, and the result is `publication_retry` with reason `prose_not_returned`" | diff-local |
| Story 1 negative: Given a handoff that is not valid JSON, when the pass completes, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail stating the handoff could not be parsed | 1, 3, 5 | "[test] Through `advance()` with each of unparsable JSON, `version` 2, a missing `title`, a missing `body`, a non-string `title`, a non-string `body`, a whitespace-only `title` and a whitespace-only `body`, the result is `publication_retry` with reason `prose_invalid`, a detail stating the parse failure or naming that field, and no `pull-request.edit`" | diff-local |
| Story 1 negative: Given a handoff whose `version` is not 1, or whose `title` or `body` is missing, not a string, or empty after trimming, when the pass completes, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail naming the offending field | 1, 3, 5 | "[test] Through `advance()` with each of unparsable JSON, `version` 2, a missing `title`, a missing `body`, a non-string `title`, a non-string `body`, a whitespace-only `title` and a whitespace-only `body`, the result is `publication_retry` with reason `prose_invalid`, a detail stating the parse failure or naming that field, and no `pull-request.edit`" | diff-local |
| Story 1 negative: Given a handoff whose title and body the observer's own prose classification still reads as placeholder, such as the unchanged engine-floored template body, when the engine validates it, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail stating the body is still placeholder | 2, 5 | "[test] Through `advance()` with a handoff whose title and body are the unchanged engine-floored template body, the runner receives no `pull-request.edit` and the result is `publication_retry` with reason `prose_invalid` and a detail stating the body is still placeholder, classified by the same placeholder helper `observePublicationSnapshot` uses" | diff-local |
| Story 1 negative: Given the current PR body contains `Closes owner/repo#N`, when the handoff body lacks that reference, then no edit is performed and FINISH returns `publication_retry` with reason `prose_invalid` and a detail naming the missing `Closes owner/repo#N` reference | 2, 5 | "[test] Through `advance()` with a current body containing `Closes owner/repo#N` and a handoff body lacking it, the result is `publication_retry` with reason `prose_invalid`, a detail naming `Closes owner/repo#N`, and no `pull-request.edit`; with neither body carrying a `Closes` reference the edit is performed and the result is `advanced`" | diff-local |
| Story 1 negative: Given the current PR body contains no `Closes` reference, when a handoff body without one is otherwise valid, then the edit is performed and the transition advances | 2, 5 | "[test] Through `advance()` with a current body containing `Closes owner/repo#N` and a handoff body lacking it, the result is `publication_retry` with reason `prose_invalid`, a detail naming `Closes owner/repo#N`, and no `pull-request.edit`; with neither body carrying a `Closes` reference the edit is performed and the result is `advanced`" | diff-local |
| Story 1 negative: Given the author pass writes no handoff but edits the PR directly, when re-observation shows prose that is no longer placeholder, then the transition advances, because re-observation stays authoritative, and no `prose_not_returned` retry is returned | 3 | "[test] when it throws either cause and re-observation reads prose that is no longer placeholder, `advanceFinishPublication` returns `advanced` for `author_pr_prose` and no `prose_not_returned` or `prose_invalid` retry" | diff-local |
| Story 1 negative: Given an authoring dispatch that does not complete successfully, when a valid handoff file exists afterwards, then no edit is performed and FINISH follows the existing `authoring_dispatch_failed` retry | 4 | "[test] Through `advance()` with a dispatch returning `success: false` after writing a valid handoff, the runner receives no `pull-request.edit` and the result is `publication_retry` with reason `authoring_dispatch_failed`" | diff-local |
| Story 1 negative: Given a `github_operation_failed` record for this PR's `pull-request.edit` appended to the sibling ledger during the pass, when the handoff is valid and the engine's own edit executes, then the transition advances and the record does not produce `publication_operation_failed` | 4 | "[test] Through `advance()` with a `github_operation_failed` record for this PR's `pull-request.edit` appended to the worktree's sibling ledger `.pipeline/pipeline-events.jsonl` by the fake dispatch (and the same event emitted on the feature bus), a valid handoff and an executed edit, the result is `advanced` and not `publication_operation_failed`" | diff-local |
| Story 2 happy: Given an author pass that returned `prose_invalid` because the `Closes` reference was missing, when FINISH dispatches the next author pass, then that pass's revision guidance contains the failed-check detail | 7 | "[test] Through two `advance()` calls on one production coordinator where the first pass returns a handoff lacking the current `Closes owner/repo#N` reference, the second `dispatchAuthoring` request carries `revisionGuidance` containing that missing-reference detail" | diff-local |
| Story 2 happy: Given an author pass that returned `prose_not_returned`, when the next pass writes a valid handoff, then the prose is published, the transition advances, and FINISH does not halt | 7 | "[test] After a first pass that writes no handoff, the second `dispatchAuthoring` request carries `revisionGuidance` stating that no handoff file was written and naming `.pipeline/finish-pr-prose.json`; when that second pass writes a valid handoff the prose is published through one `pull-request.edit` and the result is `advanced`" | diff-local |
| Story 2 happy: Given each retry, when it is returned, then a `finish_publication_disposition` event with disposition `retry_finish` is emitted and the retry spends one attempt of the existing FINISH step attempt budget, with no new budget introduced | 8 | "[test] A conductor run whose FINISH publication returns `publication_retry` reason `prose_not_returned` with a detail on every attempt emits one `finish_publication_disposition` `retry_finish` per attempt, dispatches FINISH exactly `stepMaxRetries` times, then halts needs-human with a reason containing `FINISH publication retry exhausted: prose_not_returned` and that detail, and not containing "left pr.prose unchanged at placeholder"" | diff-local |
| Story 2 negative: Given every author pass within the FINISH attempt budget writes no handoff, when the budget is exhausted, then FINISH halts needs-human with a reason that names `prose_not_returned` and carries the retry detail, and the halt text does not contain "left pr.prose unchanged at placeholder" | 8 | "[test] A conductor run whose FINISH publication returns `publication_retry` reason `prose_not_returned` with a detail on every attempt emits one `finish_publication_disposition` `retry_finish` per attempt, dispatches FINISH exactly `stepMaxRetries` times, then halts needs-human with a reason containing `FINISH publication retry exhausted: prose_not_returned` and that detail, and not containing "left pr.prose unchanged at placeholder"" | diff-local |
| Story 2 negative: Given every author pass within the FINISH attempt budget writes a handoff that fails validation, when the budget is exhausted, then the halt names `prose_invalid` and carries the last failed-check detail | 8 | "[test] The same run returning reason `prose_invalid` with a different detail on the last attempt halts with a reason naming `prose_invalid` and the last attempt's detail" | diff-local |
| Story 2 negative: Given a `prose_not_returned` retry, when the next pass's revision guidance is built, then it states that no handoff file was written and names the handoff path | 7 | "[test] After a first pass that writes no handoff, the second `dispatchAuthoring` request carries `revisionGuidance` stating that no handoff file was written and naming `.pipeline/finish-pr-prose.json`; when that second pass writes a valid handoff the prose is published through one `pull-request.edit` and the result is `advanced`" | diff-local |
| Story 3 happy: Given an unattended FINISH judgment dispatch, when its prompt is built, then the prompt instructs the provider to return only the verdict JSON and contains no permission to repair, edit, or rewrite the PR title or body | 10 | "[test] The unattended and interactive FINISH judgment prompts each list the closed verdict set, instruct returning exactly one verdict JSON object, and contain none of "may repair", "repair only", "may edit", "edit the PR", "edit only", "may rewrite", "rewrite", "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`" | diff-local |
| Story 3 happy: Given an interactive FINISH judgment dispatch, when its prompt is built, then it likewise contains no permission to repair the PR title or body | 10 | "[test] The unattended and interactive FINISH judgment prompts each list the closed verdict set, instruct returning exactly one verdict JSON object, and contain none of "may repair", "repair only", "may edit", "edit the PR", "edit only", "may rewrite", "rewrite", "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`" | diff-local |
| Story 3 happy: Given a judge verdict of `revision_required` with a detail, when FINISH re-observes, then the next selected transition is `author_pr_prose` carrying that detail as revision guidance | 10 | "[test] A coordinator test with a persisted `revision_required` verdict carrying a detail selects `author_pr_prose` and passes that detail as the authoring request's `revisionGuidance`; one with an `accepted` verdict dispatches no author pass and no `pull-request.edit`" | diff-local |
| Story 3 negative: Given a judge pass that edits the PR body despite the prompt, when FINISH re-observes, then the changed revision is judged again through `judge_pr_prose` and is never accepted without a verdict on that revision | 10 | "[test] A coordinator test whose judgment dispatch changes the PR body revision re-observes `pr.prose` as `stale` and selects `judge_pr_prose` for the new revision instead of accepting it" | diff-local |
| Story 3 negative: Given a judge verdict of `accepted`, when FINISH continues, then no author pass and no engine prose edit is dispatched | 10 | "[test] A coordinator test with a persisted `revision_required` verdict carrying a detail selects `author_pr_prose` and passes that detail as the authoring request's `revisionGuidance`; one with an `accepted` verdict dispatches no author pass and no `pull-request.edit`" | diff-local |
| Story 4 happy: Given an author pass, when its prompt is built, then it names the handoff path `.pipeline/finish-pr-prose.json` and its exact `version`, `title`, and `body` shape, tells the provider to write only that file, and contains no instruction to edit, rewrite, or update the PR in place | 9 | "[test] The FINISH author prompt built by `DefaultStepRunner` names `.pipeline/finish-pr-prose.json` and the exact `{"version":1,"title":…,"body":…}` shape, tells the provider to write only that file, and contains none of "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`" | diff-local |
| Story 4 happy: Given a revision pass, when its prompt is built, then it carries the judge's objection and the same handoff instruction, and contains no instruction to edit the PR in place | 9 | "[test] The revision prompt built with `revisionGuidance` contains the guidance text and the same handoff path and shape instruction, and contains none of "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`" | diff-local |
| Story 4 happy: Given `skills/finish/SKILL.md`, when its PR prose authoring section is read, then it instructs writing the handoff file and states that the engine performs the PR title and body write | 11 | "[test] `test/test_harness_integrity.sh` asserts that `skills/finish/SKILL.md` instructs the provider to write `.pipeline/finish-pr-prose.json` (the phrase "write `.pipeline/finish-pr-prose.json`") and states that the engine performs the PR title and body write" | diff-local |
| Story 4 happy: Given `skills/pr/SKILL.md`, when its feature-branch publication section is read, then it states that during FINISH the provider writes the handoff file and the engine performs the write, consistent with `skills/finish/SKILL.md` | 11 | "[test] `test/test_harness_integrity.sh` asserts that `skills/pr/SKILL.md` states that during FINISH the provider writes `.pipeline/finish-pr-prose.json` (the phrase "write `.pipeline/finish-pr-prose.json`") and that the engine performs the PR title and body write" | diff-local |
| Story 4 negative: Given the author, revision, and judge prompt blocks, when they are inspected, then none mentions `ai-conductor github-operation`, `--request-file`, or a `pull-request.edit` request shape | 9, 10 | "[test] The FINISH author prompt built by `DefaultStepRunner` names `.pipeline/finish-pr-prose.json` and the exact `{"version":1,"title":…,"body":…}` shape, tells the provider to write only that file, and contains none of "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit`" | diff-local |
| Story 4 negative: Given `skills/finish/SKILL.md` and `skills/pr/SKILL.md`, when they are inspected, then neither instructs a provider to rewrite the retained PR's title or body in place during FINISH | 11 | "[test] `test/test_harness_integrity.sh` asserts that neither `skills/finish/SKILL.md` nor `skills/pr/SKILL.md` contains the phrase "in place" anywhere, case-insensitively, so neither can instruct an in-place title or body rewrite" | diff-local |
| Story 5 happy: Given a daemon session, when it runs bare `ai-conductor --help`, then the command is refused and the refusal states that no subcommand was given and lists every sanctioned subcommand, including `github-operation` | 12 | "[test] `guardDaemonSessionInvocation` with the daemon-session marker refuses `ai-conductor --help` and bare `ai-conductor` with `subcommand` `none` and a message stating no subcommand was given and listing every member of `SESSION_SANCTIONED_SUBCOMMANDS`, including `github-operation`" | diff-local |
| Story 5 happy: Given a daemon session, when it runs `ai-conductor` with no arguments, then the refusal has the same no-subcommand wording and sanctioned list | 12 | "[test] `guardDaemonSessionInvocation` with the daemon-session marker refuses `ai-conductor --help` and bare `ai-conductor` with `subcommand` `none` and a message stating no subcommand was given and listing every member of `SESSION_SANCTIONED_SUBCOMMANDS`, including `github-operation`" | diff-local |
| Story 5 negative: Given a daemon session, when it runs a known blocked subcommand such as `ai-conductor daemon status`, then the refusal still names that blocked subcommand and is unchanged from today | 12 | "[test] with the marker set, `ai-conductor daemon status` is refused with the message containing `blocked subcommand: daemon` exactly as before, and `ai-conductor github-operation --request-file <file>` returns `allowed: true`" | diff-local |
| Story 5 negative: Given a daemon session, when it runs a sanctioned subcommand such as `ai-conductor github-operation --request-file <file>`, then it is admitted as today | 12 | "[test] with the marker set, `ai-conductor daemon status` is refused with the message containing `blocked subcommand: daemon` exactly as before, and `ai-conductor github-operation --request-file <file>` returns `allowed: true`" | diff-local |
| Story 5 negative: Given the no-subcommand refusal, when its text is inspected, then it does not contain `blocked subcommand: <none>` and does not echo any unknown argv text | 12 | "[test] those no-subcommand messages contain neither `blocked subcommand: <none>` nor an unknown flag token passed alongside `--help`, such as `--zz-unknown-token`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D1 | task | task-1, task-4 | [test] Through `advance()` with a stale handoff present before dispatch and a dispatch that writes none, the file is already deleted when the fake dispatch starts, the runner receives no `pull-request.edit`, and the result is `publication_retry` with reason `prose_not_returned` |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D2 | task | task-2, task-4 | [test] Through `createProductionFinishPublicationCoordinator(...).advance()` with a fake dispatch that writes a valid handoff and makes no GitHub call, the guarded operation runner receives exactly one `pull-request.edit` whose payload title is the trimmed handoff title and whose body is the handoff body re-spliced so that, for a current body with three `ai-conductor:step` regions and a handoff body that omits one, changes the bytes of another, and repeats a third, every region appears exactly once with its current-body bytes, and the result is `advanced` for `author_pr_prose` after re-observation reads non-placeholder prose |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D3 | task | task-10 | [test] The unattended and interactive FINISH judgment prompts each list the closed verdict set, instruct returning exactly one verdict JSON object, and contain none of "may repair", "repair only", "may edit", "edit the PR", "edit only", "may rewrite", "rewrite", "in place", `ai-conductor github-operation`, `--request-file`, or `pull-request.edit` |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D4 | task | task-3, task-8 | [test] A conductor run whose FINISH publication returns `publication_retry` reason `prose_not_returned` with a detail on every attempt emits one `finish_publication_disposition` `retry_finish` per attempt, dispatches FINISH exactly `stepMaxRetries` times, then halts needs-human with a reason containing `FINISH publication retry exhausted: prose_not_returned` and that detail, and not containing "left pr.prose unchanged at placeholder" |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D5 | task | task-4 | the production `authorProse` effect in `finish-publication-production.ts` no longer calls `flushSessionEvents` or subscribes to `github_operation_failed` |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D6 | task | task-9, task-11, task-12 | [test] `test/test_harness_integrity.sh` asserts that `skills/pr/SKILL.md` states that during FINISH the provider writes `.pipeline/finish-pr-prose.json` (the phrase "write `.pipeline/finish-pr-prose.json`") and that the engine performs the PR title and body write |
| adr-2026-10-31-engine-performs-finish-pr-prose-write#D7 | task | task-12 | [test] `guardDaemonSessionInvocation` with the daemon-session marker refuses `ai-conductor --help` and bare `ai-conductor` with `subcommand` `none` and a message stating no subcommand was given and listing every member of `SESSION_SANCTIONED_SUBCOMMANDS`, including `github-operation` |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D1 | existing | none | `dispatchGithubOperationCommand` in `src/conductor/src/engine/github-operations-cli.ts` already appends `github_operation_failed` for every failed decoded operation; this feature does not change it |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D2 | existing | none | `github_operation_failed` is already in `ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES` and re-emitted by `CloseoutEventTail`; this feature does not change the sibling ledger or the tail |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D3 | task | task-4 | the production `authorProse` effect in `finish-publication-production.ts` no longer calls `flushSessionEvents` or subscribes to `github_operation_failed` |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D4 | task | task-6 | [test] Through `advance()` with a valid handoff whose guarded `pull-request.edit` returns a failed result carrying a missing `read:org` scope message and re-observation still reading placeholder, the result is `human_required` with reason `publication_operation_failed` and a detail containing `pull-request.edit` and that error text |
| adr-2026-10-24-finish-surfaces-guarded-publish-failures#D5 | task | task-3, task-6 | [test] when the `authorProse` effect throws `PrProseAuthoringFailedError` with cause `not_returned` and re-observation still reads placeholder, `advanceFinishPublication` returns `publication_retry` for `author_pr_prose` with reason `prose_not_returned` and never `publication_transition_unmoved` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
