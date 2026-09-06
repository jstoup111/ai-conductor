# Implementation Plan: Complete assigned-issue capture for background intake

**Date:** 2026-09-06
**Stories:** .docs/stories/page-background-intake-past-github-default-30-issu.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds one argv element and one warning to an existing read-only poll and preserves every current capture rule — ledger dedup, handled-label skip, empty-issue skip, per-repository failure isolation, write-back, and re-eligibility.

## Summary

Three bounded tasks deliver #1133: the canonical tracker seam requests an explicit assigned-issue maximum instead of inheriting the GitHub CLI's 30-result default, an acceptance poll proves capture and re-poll idempotency across a result set larger than that default, and the intake adapter reports one explicit incompleteness warning when a listing comes back at exactly the maximum it asked for. Cursor paging, a configurable limit key, per-repository tuning, and any queue or ledger schema change are outside this slice.

## Technical Approach

The seam owns the maximum. `createGithubTrackerClient`'s `listAssignedIssues` gains an exported module constant for the default maximum and an optional trailing `limit` parameter defaulting to it, and appends `--limit <value>` to the existing argv it already builds. The constant is 1000 — far above the 48 assigned issues the filing repository holds today and above the 30 the CLI applies when the flag is absent — because the GitHub CLI already pages internally up to `--limit`; hand-rolling a cursor pager would fork the seam's single-call contract and every fake that implements it. The parameter is optional and trailing, so the existing `TrackerClient` implementations in the test suite that declare `listAssignedIssues` with fewer parameters keep compiling.

The adapter owns the signal. `createGithubIssuesAdapter` gains an optional `issueListLimit` dependency defaulting to the exported constant, passes it explicitly on every `listAssignedIssues` call, and — when the returned array length is at least that maximum — emits one message through the adapter's existing injected `log` sink naming the repository and the requested maximum before continuing to capture what it read. Saturation is the only signal available from a bounded listing: a full-length result cannot be distinguished from a truncated one, so the poll must say so rather than present it as complete. This is deliberately non-fatal and mirrors the sink's existing use for an isolated repository failure; it adds no file, no format, and no reader path, so it is not a second telemetry channel. Everything downstream of the listing — the handled-label branch, the ledger-known skip, the empty-issue skip, envelope construction, and `ledger.record` — is untouched, which is what keeps a re-poll over a larger set idempotent.

The faithful fake follows the real CLI. The shared intake acceptance fake currently ignores paging entirely and returns whatever the fixture holds. It is corrected to read `--limit` from the argv it is handed and slice to it, defaulting to 30 when the flag is absent, exactly as the real CLI documents. That is what makes the 45-issue acceptance case fail before the seam change and pass after it, and it keeps every existing acceptance fixture — all well under 30 issues — behaving as before.

Test patterns are already established in this repository and are reused rather than invented: the tracker-client suite asserts an exact argv array against a recording fake runner; the intake acceptance suite drives the real adapter and real ledger against the injected fake `gh` runner over a temporary directory; the intake unit suite constructs the adapter directly with an injected runner and ledger. Third-party access stays behind the injected runner in every case — no test spawns `gh`, and no test reaches the network. An implementer may vary fixture builders and assertion grouping, but must keep the observation at these boundaries.

## Preconditions and claim ledger

- Operator-delegate approved the Small scope, the technical track, the single-explicit-maximum approach, and both stories on 2026-09-06.
- Verified: `src/conductor/src/engine/tracker-client.ts` builds the assigned-issue argv as `issue list --assignee @me --state open --json number,title,body,labels -R <repo>` with no `--limit` element, so the CLI's documented 30-result default applies.
- Verified: `src/conductor/src/engine/engineer/intake/github-issues.ts` is the only production caller of `listAssignedIssues`; its `poll()` wraps the call in a try/catch that logs and continues on failure, then applies the handled-label, ledger-known, and empty-issue skips per issue.
- Verified: the adapter already accepts an optional injected `log` sink defaulting to a no-op, and `buildIntake` in `src/conductor/src/engine/engineer-cli.ts` wires it to the CLI's stderr printer.
- Verified: `src/conductor/test/tracker-client.test.ts` asserts the assigned-issue argv as an exact array against a recording fake runner, so the argv change has one authoritative test site.
- Verified: `src/conductor/test/engine/engineer/intake/_acceptance-helpers.ts` returns every fixture issue for an `issue list` argv and never inspects `--limit`; its largest existing fixture holds two issues per repository.
- Verified: the structural seam guard in the intake test suite only asserts that the adapter imports the tracker client and hand-rolls no assignee-scoped argv; it pins no argv contents and is unaffected.
- Verified: three test-suite implementations of `TrackerClient` declare `listAssignedIssues` with no parameters, so a new optional trailing parameter on the interface does not break them.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no channel, existing injected sink only.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; the one estimate is the chosen maximum, and it is bounded by the CLI's own paging rather than by an assumption about repository size.

## Tasks

### Task 1: Request an explicit assigned-issue maximum at the tracker seam
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/tracker-client.ts, src/conductor/test/tracker-client.test.ts
**Dependencies:** none

**Steps:**
1. Update the existing assigned-issue argv test so its expected array includes the `--limit` flag followed by the string form of the new exported default-maximum constant, and add a case passing an explicit maximum that asserts the substituted value appears instead.
2. Run the two focused tests and confirm RED for both.
3. Export a default-maximum constant set to 1000 from the tracker-client module, document why it exists in one comment naming the CLI's 30-result default, and give `listAssignedIssues` an optional trailing `limit` parameter defaulting to that constant.
4. Append `--limit` and the stringified limit to the argv the method already builds, leaving every other element and the JSON field list unchanged.
5. Confirm GREEN for the focused tests, then run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. The argv test asserts an exact array containing `--limit` followed by the string form of the exported default-maximum constant, and it passes.
2. The exported default-maximum constant is greater than 30, the maximum the GitHub CLI applies when the flag is absent.
3. A call passing an explicit maximum substitutes that value into the argv, and a call omitting it uses the exported default.
4. The typecheck target that includes test files passes with the new optional trailing parameter in place.

### Task 2: Prove a poll captures a result set larger than the CLI default and stays idempotent
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/engine/engineer/intake/_acceptance-helpers.ts, src/conductor/test/engine/engineer/intake/github-issues.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Teach the shared intake fake runner to read `--limit` from the `issue list` argv it is handed and return at most that many fixture issues, defaulting to 30 when the flag is absent so the fake mirrors the real CLI's documented behavior.
2. Add an acceptance case that registers one repository holding 45 open assigned issues, polls the real adapter through the fake runner and the real ledger, and asserts 45 pending envelopes with 45 distinct source references.
3. Extend that case with an immediately repeated poll asserting zero envelopes on the second call, proving ledger dedup holds across a set larger than the old window.
4. Re-run the whole intake acceptance file to confirm the existing per-repository isolation, empty-issue, handled-label, write-back, and re-eligibility cases are unaffected by the fake's new paging behavior.
5. Commit the focused change.

**Done when:**
1. A single poll over a 45-issue fixture repository returns 45 pending envelopes carrying 45 distinct source references.
2. An immediately repeated poll over that same fixture returns zero envelopes and adds no duplicate ledger entry.
3. Reverting only the seam's `--limit` argv makes the 45-issue case fail at 30 envelopes, confirming the fake is what encodes the real default.
4. Every pre-existing case in the intake acceptance file still passes, including the case that isolates a failing repository while another succeeds.

### Task 3: Report an assigned-issue listing whose completeness cannot be proven
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/intake/github-issues.ts, src/conductor/test/engine/engineer/intake/github-issues.test.ts
**Dependencies:** 1

**Steps:**
1. Write two unit cases against the adapter constructed with an injected runner, an injected log sink, a real ledger in a temporary directory, and an injected maximum of 3: one whose fixture returns exactly 3 issues, one whose fixture returns 2.
2. Assert the saturated case records exactly one message containing the repository slug and the requested maximum, and that it still returns three pending envelopes; assert the unsaturated case records no such message and returns two envelopes.
3. Confirm RED for both cases.
4. Add an optional `issueListLimit` dependency to the adapter defaulting to the tracker module's exported default maximum, pass it explicitly on the `listAssignedIssues` call, and after a successful call emit one message through the existing injected sink when the returned array length is at least the requested maximum, then continue the existing per-issue capture loop untouched.
5. Confirm GREEN, re-run the intake unit and acceptance files together, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A poll whose listing returns exactly the requested maximum emits exactly one sink message naming the repository and that maximum.
2. A poll whose listing returns fewer than the requested maximum emits no such message.
3. The saturated poll returns one pending envelope per issue it read and does not throw.
4. The intake unit and acceptance files pass together, and the typecheck target that includes test files passes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a registered repository whose issue listing would return only its first 30 results without an explicit maximum, when background intake polls it, then the poll requests an explicit maximum larger than 30 and captures every open assigned issue the repository holds. | 1 | "The exported default-maximum constant is greater than 30, the maximum the GitHub CLI applies when the flag is absent." | diff-local |
| Story 1 happy: Given a registered repository holding 45 open assigned issues, when background intake polls it, then it produces 45 pending envelopes, one per issue, each carrying that issue's source reference. | 2 | "A single poll over a 45-issue fixture repository returns 45 pending envelopes carrying 45 distinct source references." | diff-local |
| Story 1 negative: Given a registered repository holding more than 30 open assigned issues that a first poll already captured, when a second consecutive poll runs, then it produces no envelopes and records no duplicate entry for any issue. | 2 | "An immediately repeated poll over that same fixture returns zero envelopes and adds no duplicate ledger entry." | diff-local |
| Story 1 negative: Given the issue listing for one registered repository fails while another succeeds, when the poll runs, then the failing repository is isolated with a logged failure and the succeeding repository still produces its envelopes. | 2 | "Every pre-existing case in the intake acceptance file still passes, including the case that isolates a failing repository while another succeeds." | diff-local |
| Story 2 happy: Given a registered repository whose issue listing returns fewer issues than the maximum the poll requested, when the poll completes, then it reports no incompleteness signal and captures every returned issue. | 3 | "A poll whose listing returns fewer than the requested maximum emits no such message." | diff-local |
| Story 2 negative: Given a registered repository whose issue listing returns exactly the maximum the poll requested, when the poll completes, then intake reports one explicit incompleteness signal naming that repository and the requested maximum, and still returns one envelope for each issue it did read. | 3 | "A poll whose listing returns exactly the requested maximum emits exactly one sink message naming the repository and that maximum." | diff-local |

## Test dispositions and integration ownership

All six criteria are diff-local: each is decided entirely by fixtures and code inside this change set. Task 1 owns the seam contract at unit level, asserting the exact argv against a recording fake runner — the lowest layer that can prove the maximum is requested at all. Task 2 owns the cross-boundary integration proof for Story 1: it drives the real adapter, the real ledger, and the real capture loop through the injected fake `gh` runner, which is the poll's only third-party boundary, and it is the single task that observes end-to-end capture through the adapter's public `poll()` entry point. Task 3 owns Story 2 at unit level with an injected maximum, because saturation is a property of the adapter's own branch and needs no larger path to observe; its injected maximum of 3 keeps the fixture cheap instead of materializing a thousand issues. No test spawns a real CLI or reaches the network, no new aggregate or smoke test is added, and no terminal validation task exists — the configured suite and the existing gates cover the completed feature.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
