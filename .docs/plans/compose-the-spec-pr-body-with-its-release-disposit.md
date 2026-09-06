# Implementation Plan: Compose the spec PR body with its release disposition

**Date:** 2026-09-06
**Stories:** .docs/stories/compose-the-spec-pr-body-with-its-release-disposit.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing spec-PR contract — opt-in read from the target repository's pull request template, author-supplied declarations win, and every write-back stays non-fatal.

## Summary

Three bounded tasks deliver #1869 by composing the spec PR's title and body before `gh pr create` runs, so the `opened` webhook payload the required check reads already declares a disposition. The post-create repair is retained as the degraded-path fallback rather than the primary mechanism.

## Technical Approach

The required check parses the pull-request webhook payload's body, not the live body. The spec PR is created with autofill, whose body never carries a release-metadata section, so the `opened` event is evaluated against a body with no disposition and fails; the repair that follows edits the body and produces the passing runs, but it cannot unwrite the failed one. The fix is to make the create call itself carry a declaring body.

Add two exported functions to the existing spec-PR release-metadata module, beside the opt-in predicate and the default block they reuse. The first is a pure composer that takes the autofill-equivalent body text and returns it unchanged when the real disposition parser already accepts it, and otherwise returns it with the module's existing default block appended using the module's existing empty-body and trailing-whitespace rules. The second is an argument builder: it returns an empty argument list when the target repository does not declare the contract, and otherwise reads the spec branch's tip commit message through the injected Git runner and returns an explicit title argument taken from that message's first line plus a body argument holding the composed body. Any failure to read the commit message returns the empty list, which is the existing autofill behavior.

The opener uses that list. When it is empty the create invocation is exactly today's autofill form. When it is non-empty the invocation carries the explicit title and body instead of the autofill flag, so the composed values are used without depending on the CLI's flag-precedence rules between autofill and explicit title or body. Deriving the title from the tip commit's first line matches what autofill produces for the single-commit spec branches the land step creates, and the branch tip is named explicitly in the Git invocation rather than relying on the checked-out head.

The post-create repair stays wired and unchanged. When composition succeeded it parses the body it finds, sees a valid declaration, and returns without editing, which is the property that removes the second check run and the window. When composition was skipped because the commit-message read failed, the repair is the surviving path that supplies the disposition, so it is live rather than dead. The non-closing issue reference line is still appended afterwards; the parser already terminates the migration section at that trailer, and a unit case pins that the composed body plus that trailer still parses.

Existing tests in this area are the pattern to follow: a fake command runner that records every invocation and keeps an in-memory body, a real temporary directory holding the opt-in template, and assertions made through the real parser rather than through string matching. The fake runner must be extended to seed its in-memory body from the create call's body argument, because the body now originates there. Tests inject the Git runner and the command runner; no test may spawn a real Git, CLI, or network call.

## Preconditions and claim ledger

- Verified: `openSpecPr` in `src/conductor/src/engine/engineer/handoff.ts` creates the PR with the argument list `pr create --head <branch> --fill --label spec` and calls `ensureReleaseMetadata` only afterwards.
- Verified: `openSpecPr` throws when a remote target has no `gitRunner`, and already invokes that runner to push the branch, so the Git seam needed here exists and is injected.
- Verified: `runReleaseMetadataCheckAction` in `src/conductor/src/engine/release-metadata-check-action.ts` parses `context.payload.pull_request.body`, the webhook payload snapshot, so the `opened` event cannot see a later body edit.
- Verified: `release-metadata-inject.ts` exports `declaresReleaseDisposition` and `DEFAULT_SPEC_RELEASE_BLOCK`, decides opt-in from the target repository's `.github/pull_request_template.md`, defers to any body the parser already accepts, and is non-fatal on write-back failure.
- Verified: `parseReleaseDisposition` in `src/conductor/src/engine/release-metadata.ts` ends the migration section at a `Refs owner/repo#N` trailer, so the default block followed by that trailer parses as a no-note disposition.
- Verified: `landSpec` in `src/conductor/src/engine/engineer/land-spec.ts` commits the spec with a single-line subject and no message body, so a body composed from that commit is empty before the default block is appended, matching today's autofilled result.
- Verified: the existing spec file `src/conductor/test/engine/engineer/handoff-release-metadata.test.ts` already builds a recording fake runner, an opt-in temporary template, and a no-op Git runner; it is extended rather than replaced.
- Verified: no page under `docs/` documents the spec-PR disposition injector, and this change adds no flag, configuration key, skill, step, gate, or hook, so no documentation page is made stale by it.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no event, metric, span, log line, or report is added or changed.
- Verify-claims verdict: CLEAR. Every load-bearing claim above was read from the worktree; no pending assumption remains.

## Tasks

### Task 1: Compose the create body from the branch's own commit message
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/release-metadata-inject.ts, src/conductor/test/engine/engineer/spec-pr-create-args.test.ts
**Dependencies:** none

**Steps:**
1. Add a new unit spec file for the composer and the argument builder. Write table-driven cases for an empty autofill body, a body of ordinary prose, a body that already declares a valid no-note disposition, and a body that already declares a valid note disposition with its category, semver, and note fields.
2. Add a case that appends a non-closing issue reference line to the composed default result and asserts the real disposition parser still returns a no-note disposition.
3. Verify the new cases fail, then implement the pure composer in the existing spec-PR release-metadata module: return the input unchanged when the real parser accepts it, otherwise append the module's existing default block using its existing empty-body and trailing-whitespace rules.
4. Implement the argument builder in the same module: return an empty list when the opt-in predicate is false, otherwise read the named branch's tip commit message through an injected Git runner and return an explicit title argument from its first line plus a body argument holding the composed body.
5. Add unit cases proving the builder returns an empty list for an opted-out temporary directory and for an injected Git runner that rejects, then verify the file passes and commit the focused change.

**Done when:**
1. The composer returns byte-identical input for every case the real disposition parser already accepts, and appends exactly one release-metadata heading otherwise.
2. Appending a non-closing issue reference line to the composed default result still parses as a no-note disposition.
3. The argument builder returns an empty list for an opted-out directory and for a rejecting Git runner, and never throws.
4. For an opted-in directory the builder returns exactly one title argument taken from the tip commit's first line and one body argument the real parser accepts.

### Task 2: Carry the disposition in the create invocation itself
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/handoff.ts, src/conductor/test/engine/engineer/handoff-release-metadata.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing recording fake runner so its in-memory body is seeded from the create invocation's body argument when one is present, keeping its existing view and edit behavior.
2. Write failing cases at the create boundary for an opted-in temporary repository: the captured create argument list carries a body the real parser accepts as a no-note disposition, and no body-editing invocation is recorded after the create call.
3. Verify the cases fail, then call the argument builder in the opener before the create invocation, passing the branch, the working directory, and the already-required Git runner.
4. Build the create argument list from the result: with an empty list keep today's autofill form exactly, and with a non-empty list carry the composed title and body in place of the autofill flag while keeping the head and label arguments unchanged.
5. Leave the post-create repair call in place and unchanged, then verify the file passes and commit the focused change.

**Done when:**
1. A create-boundary fixture for an opted-in repository captures a create argument list whose body argument the real parser accepts as a no-note disposition.
2. That same fixture records zero body-editing invocations after the create call.
3. The existing idempotency case still shows exactly one release-metadata heading after two consecutive openings.
4. The opener still returns the opened-PR result carrying the scraped URL for the opted-in case.

### Task 3: Keep the opted-out and degraded paths intact
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/engineer/handoff-release-metadata.test.ts
**Dependencies:** 2

**Steps:**
1. Write a failing case for a temporary repository with no declaring pull request template: assert the captured create argument list carries no composed body argument and retains the autofill form, and that no body read or edit invocation is recorded.
2. Write a failing case for an opted-in repository whose injected Git runner rejects when asked for the commit message but succeeds for the branch push: assert the create argument list falls back to the autofill form.
3. Verify the cases fail, then confirm they pass against the implementation from Task 2 without changing production code; if either fails, repair the opener's fallback rather than the assertion.
4. Extend the same degraded case to assert the opened-PR result is still returned and the real parser accepts the body the post-create repair leaves behind.
5. Run the focused spec file and commit.

**Done when:**
1. The opted-out fixture records a create argument list with no composed body argument and zero body read or edit invocations.
2. The rejecting commit-message fixture records a create argument list in the autofill form and still returns an opened-PR result.
3. The real parser accepts the body left behind after the post-create repair in the rejecting commit-message fixture.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the target repository's pull request template declares a release disposition, when the spec PR is opened, then the arguments of the create invocation itself carry a body that the release-metadata parser accepts as a no-note disposition. | 2 | "A create-boundary fixture for an opted-in repository captures a create argument list whose body argument the real parser accepts as a no-note disposition." | diff-local |
| Story 1 happy: Given the create invocation already supplied that body, when the post-create release-metadata step runs, then it issues no body edit and the opened body is left byte-identical. | 2 | "That same fixture records zero body-editing invocations after the create call." | diff-local |
| Story 1 negative: Given the target repository has no pull request template declaring a disposition, when the spec PR is opened, then the create invocation carries neither a composed title nor a composed body and no PR body is read or edited. | 3 | "The opted-out fixture records a create argument list with no composed body argument and zero body read or edit invocations." | diff-local |
| Story 2 happy: Given the spec branch's tip commit message already declares a valid disposition, when the create body is composed, then that declaration is carried through unchanged and no default disposition block is added. | 1 | "The composer returns byte-identical input for every case the real disposition parser already accepts, and appends exactly one release-metadata heading otherwise." | diff-local |
| Story 2 happy: Given a composed create body, when the non-closing issue reference line is appended to it after the PR opens, then the release-metadata parser still accepts the resulting body. | 1 | "Appending a non-closing issue reference line to the composed default result still parses as a no-note disposition." | diff-local |
| Story 2 negative: Given reading the spec branch's tip commit message fails, when the spec PR is opened, then the PR is still opened with the autofilled body, the existing post-create repair supplies the disposition, and the opened PR result is returned rather than discarded. | 3 | "The rejecting commit-message fixture records a create argument list in the autofill form and still returns an opened-PR result." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against injected fixtures. Task 1 owns unit coverage for the pure composer and the argument builder, including the already-declared and rejecting-runner cases. Task 2 owns the integration proof at the production boundary that matters for this defect — the argument list handed to the command runner for the create call — because a unit test of the composer proves the helper works, not that the opener reaches it. Task 3 owns the opted-out and degraded-read negatives at that same boundary. No test spawns a real Git, CLI, or network call; every external boundary is an injected fake, and the real disposition parser is used for every body assertion instead of string matching. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
