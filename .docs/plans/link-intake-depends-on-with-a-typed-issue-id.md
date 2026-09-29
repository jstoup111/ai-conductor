# Implementation Plan: Link intake depends-on with a typed issue id

**Date:** 2026-09-28
**Stories:** .docs/stories/link-intake-depends-on-with-a-typed-issue-id.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change keeps the registered dependency-add operation, its guarded ownership checks, and the filing exit-code contract, and only corrects the request field type, the one caller that skipped id resolution, and the filer's report.

## Summary

Four bounded tasks deliver #2714: a typed issue-id field with no issue-number fallback in the registered dependency-add argv, id resolution in the tracker client's dependency add, an `unlinked` list on the filing result, and a final not-linked line per missing link in the filer CLI. Relinking already-filed issues, the bundled-helper move (#742), overlap-suggested dependencies (#1606), and Jira links are outside this slice.

## Technical Approach

- **Typed id, no fallback.** `ghArgsFor` in `src/conductor/src/engine/tracker-client.ts` translates both `issue.dependency.add` and `intake.issue.dependency.add`. Change its field flag from `-f` (string) to `-F` (typed; `gh api` sends an integer for a numeric value) and emit only `issue_id=<dependencyDatabaseId>`. When the payload has no `dependencyDatabaseId`, throw an error naming the missing database id and the dependency reference instead of emitting `issue_number=`; the endpoint rejects that form, so it can never succeed. Because every production caller reaches GitHub through this one translation, the fix covers intake filing (`createIntakeFilingOperations`), the dependency migration and intake label sync (`createDependencyLinks`), and the tracker client at once.
- **Tracker-client id resolution.** `addIssueDependency` in the tracker client is the only caller that submits no id. Make it read the blocking issue first with the existing `runTrackerRead` (`issue.read`, `api repos/<repo>/issues/<n>`, the same read `createIntakeFilingOperations` uses), require a positive safe-integer `id`, and pass it as `dependencyDatabaseId` in the payload that `runTrackerIssueOperation` already forwards. An unresolvable id throws an error naming both issue references before any POST. Pattern to follow: the discovery read inside `createIntakeFilingOperations` (search hint: `dependencyDatabaseId: id`) and `resolveIssueDatabaseId` in `issue-dep-migration.ts`; allowed variation: throw rather than skip, because this method has no per-edge result list.
- **Unlinked list.** `fileIntakeIssue` in `src/conductor/src/engine/engineer/intake/file-issue.ts` already catches each dependency failure in its metadata loop (both refusals and thrown errors) and keeps the created issue. Add `unlinked: Array<{ ref: string; reason: string }>` to `FileIntakeIssueResult`, filled at those two points with the dependency's source reference and the failure text. Existing `warnings`, `metadataFailures`, `linked`, and `ok` behavior is unchanged, so the engine-internal remediation caller in `conductor.ts` is unaffected.
- **Final not-linked lines.** `main` in `src/conductor/src/intake-file-cli.ts` prints, after every other line, one stderr line per `unlinked` entry: `[intake-file] NOT LINKED: <issue url> is not blocked by <owner/repo#N> (<reason>)`. The exit code stays 0 after a successful create, matching the documented contract and avoiding a duplicate re-filing. The CLI keeps its existing warning lines.

Tests follow `.agents/skills/write-tests/SKILL.md`: unit and integration tests inject a recording `GhRunner`; the one CLI test runs the real entry point with a stub GitHub CLI first on `PATH`; nothing reaches real GitHub.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, and all three stories on 2026-09-28 (delegated).
- Verified: `ghArgsFor` in `tracker-client.ts` emits `'-f'` then `issue_id=${databaseId}` or `issue_number=${dependency.number}` for both dependency-add operations.
- Verified: `issue-dep-migration.ts` `resolveIssueDatabaseId` documents that the endpoint requires `issue_id` and rejects issue-number forms; `createDependencyLinks` always passes `dependencyDatabaseId`, and `label-sync.ts` links through `createDependencyLinks`.
- Verified: `createIntakeFilingOperations` in `file-issue.ts` reads `repos/<repo>/issues/<n>` and passes `dependencyDatabaseId` before the guarded run.
- Verified: the tracker client's `addIssueDependency` passes only `{ dependency: { repository, resource } }` to `runTrackerIssueOperation`; its only callers are tests (`test/engine/github-ownership/7-migrate-issue-operations-through-guarded-requests.test.ts`).
> **Amended 2026-09-29 by #2714:** Operator decision: `addIssueDependency` stays a test-only tracker-port primitive with no production caller. Intake filing (`createIntakeFilingOperations`) and the dependency migration (`createDependencyLinks`) keep their own guarded dependency-add paths, which Task 1 fixes; rerouting either through this method would change their operation and access semantics. The as-built reachability finding for `createGithubTrackerClient.addIssueDependency` is accepted and waived by the operator; it is not remediation work.
- Verified: `github-operations.ts` normalizes a dependency payload's optional positive safe-integer `dependencyDatabaseId`.
- Verified: `fileIntakeIssue` catches dependency failures as `depends-on link failed for "<ref>": <error>` metadata failures and warnings, with `ok` true once the issue is created; `intake-file-cli.ts` prints warnings then bad refs to stderr and sets a non-zero exit only on a thrown error.
- Verified: existing tests `test/acceptance/intake-file-completeness.test.ts`, `test/engine/engineer/issue-dep-migration.test.ts`, `test/engine/tracker-client.test.ts`, and `test/file-issue.test.ts` exist; no test pins the `-F` flag today.
- Overlap: #742 (merged spec) moves the `bin/intake-file` wrapper into the intake skill and only edits comments in `intake-file-cli.ts`; the filing logic this plan changes stays in TypeScript. #1606 (spec PR #2796) also plans to change `intake-file-cli.ts` and filing output; it is blocked by this issue, so this lands first.
- Scope check: consumer-facing engine and CLI-output behavior; no skill addition; provider-agnostic. Event-spine: no new event, metric, or channel; the not-linked line is CLI stdout/stderr output of an existing result.
- Verify-claims verdict: CLEAR. The `-F` typed-field fix was verified by hand on 2026-09-24 per the issue; no pending assumption changes the approach.

## Tasks

### Task 1: Send the dependency id as a typed field and refuse a missing id
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/tracker-client.ts, src/conductor/test/engine/tracker-client.test.ts, src/conductor/test/acceptance/intake-file-completeness.test.ts, src/conductor/test/engine/engineer/issue-dep-migration.test.ts
**Dependencies:** none

**Steps:**
1. Extend the intake-file-completeness numeric-id test so the recorded blocked-by POST contains the adjacent pair `-F`, `issue_id=1000300` and no `-f` flag and no `issue_number=` argument; the filing result still lists the dependency as linked.
2. Extend the issue-dep-migration created-link test the same way for its `issue_id=1000217` POST.
3. In `tracker-client.test.ts`, submit an `intake.issue.dependency.add` request with no `dependencyDatabaseId` through `executeGithubOperation` and `createGuardedGithubOperationRunner` (intake authorization that allows the request) over a recording transport. Assert the operation does not execute, the transport records no call, and the error text names the missing database id.
4. Verify RED, then change `ghArgsFor` as described in Technical Approach. Verify GREEN and commit.

**Done when:**
1. The intake filing integration test observes a blocked-by POST carrying the adjacent `-F` and `issue_id=1000300` pair with no `-f` flag or `issue_number=` argument, and the filing result lists the dependency as linked.
2. The dependency migration test observes its blocked-by POST carrying the adjacent `-F` and `issue_id=1000217` pair with no `-f` flag.
3. A dependency-add request with no database id is not executed, the recording transport receives no blocked-by call or any `issue_number=` argument, and the error names the missing database id.

### Task 2: Resolve the blocking issue id in the tracker client's dependency add
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/tracker-client.ts, src/conductor/test/engine/tracker-client.test.ts, src/conductor/test/engine/github-ownership/7-migrate-issue-operations-through-guarded-requests.test.ts
**Dependencies:** 1

> **Amended 2026-09-29 by #2714:** This task hardens a test-only primitive by operator decision; wiring a production caller is out of scope, and the as-built reachability finding against `addIssueDependency` is waived (see the amended verified claim in Technical Approach).

**Steps:**
1. In `tracker-client.test.ts`, drive `createGithubTrackerClient(...).addIssueDependency` over a recording runner that answers `api repos/acme/foreign/issues/99` with `{"id": 4242}`. Assert the read of the blocking issue happens, then exactly one blocked-by POST on the owned issue with `-F` and `issue_id=4242`.
2. Add a case where that read answers JSON without a numeric `id`, and one where the runner throws for it. Assert the call rejects with an error containing both `acme/owned#17` and `acme/foreign#99`, and the runner records no blocked-by POST.
3. Update the 7-migrate fixture's fake runner to answer the two blocking-issue reads it now receives with numeric ids, keeping its ownership assertions unchanged.
4. Verify RED, then implement the resolution described in Technical Approach, following the discovery read in `createIntakeFilingOperations`. Verify GREEN and commit.

**Done when:**
1. The tracker-client test observes `addIssueDependency` reading `repos/acme/foreign/issues/99` and then posting exactly one blocked-by request carrying `-F` and `issue_id=4242`.
2. For a read returning no numeric id and for a read that throws, `addIssueDependency` rejects with an error naming both `acme/owned#17` and `acme/foreign#99`, and the recording runner holds no blocked-by call.
3. The 7-migrate guarded-request test still executes the owned dependency add and refuses the foreign one with its unchanged ownership assertions.

### Task 3: Record each unlinked dependency on the filing result
**Story:** Story 3
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/intake/file-issue.ts, src/conductor/test/file-issue.test.ts
**Dependencies:** none

**Steps:**
1. In `file-issue.test.ts`, file with `--depends-on` references `acme/app#42` and `acme/app#43` over the fake runner. Make the blocked-by POST for 43's id throw an HTTP 422 message. Assert `unlinked` holds exactly one entry with ref `acme/app#43` and a reason containing the 422 text, `linked` holds `acme/app#42`, and `ok` is true with the created issue URL.
2. Add a case where the id read for `acme/app#43` throws. Assert `unlinked` names `acme/app#43` with that read failure, `acme/app#42` stays linked, and a filing whose links all succeed returns an empty `unlinked`.
3. Verify RED, then add and fill the field as described in Technical Approach. Verify GREEN and commit.

**Done when:**
1. `fileIntakeIssue` returns `unlinked` with exactly one entry naming `acme/app#43` and the 422 rejection text, lists `acme/app#42` as linked, and keeps `ok` true with the created issue URL.
2. When the id read for `acme/app#43` throws, `unlinked` names `acme/app#43` with the read failure while `acme/app#42` stays in `linked`.
3. A filing whose every dependency links returns an empty `unlinked` list.

### Task 4: Print a final not-linked line per missing link in the filer CLI
**Story:** Story 3
**Type:** negative-path
**Files:** src/conductor/src/intake-file-cli.ts, src/conductor/test/intake-file-cli.test.ts (new)
**Dependencies:** 1, 3

**Steps:**
1. Write the new integration test. Run the real entry point with the engine's `tsx` from a temporary working directory, with a temporary `HOME` so no operator or bot configuration is read, `--repo acme/app`, and a stub `gh` script first on `PATH`. The stub records its arguments and answers identity, issue create, label, and issue-read calls. It rejects a blocked-by POST with an HTTP 422 message on stderr and exit 1 when told the reference must fail, or when the id is not sent through `-F`. Per this repository's test-process-isolation rule, first assert that the stub recorded the issue create call.
2. Run three filings. First: all links recorded. Second: the POST for `acme/app#43` rejected. Third: the id read for `acme/app#43` failing, with `acme/app#42` recorded.
3. Verify RED, then print the final lines described in Technical Approach. Leave the exit code unchanged. Verify GREEN and commit.

**Done when:**
1. With every link recorded, the real filer CLI exits 0, prints the `depends-on:` line naming each linked reference, and prints no `NOT LINKED` line.
2. With the POST for `acme/app#43` rejected, the CLI exits 0 and its last output line is the `NOT LINKED` line naming the filed issue URL, `acme/app#43`, and the 422 rejection text.
3. With the id read for `acme/app#43` failing, the final `NOT LINKED` line names `acme/app#43` and the read failure, while the `depends-on:` line still names `acme/app#42` as linked.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an intake filed with one `--depends-on owner/repo#N` whose issue id resolves, when the filing records the link, then the blocked-by request sends that id as a typed integer field and the filing reports the dependency as linked. | 1 | "The intake filing integration test observes a blocked-by POST carrying the adjacent `-F` and `issue_id=1000300` pair with no `-f` flag or `issue_number=` argument, and the filing result lists the dependency as linked." | diff-local |
| Story 1 happy: Given the dependency migration records a blocked-by edge whose issue id resolves, when it posts the link, then the request sends that id as the same typed integer field. | 1 | "The dependency migration test observes its blocked-by POST carrying the adjacent `-F` and `issue_id=1000217` pair with no `-f` flag." | diff-local |
| Story 1 negative: Given a registered dependency-add request that carries no resolved issue id, when it is translated for GitHub, then it is refused before any blocked-by request is sent and no issue-number field is ever sent. | 1 | "A dependency-add request with no database id is not executed, the recording transport receives no blocked-by call or any `issue_number=` argument, and the error names the missing database id." | diff-local |
| Story 2 happy: Given the tracker client is asked to add a blocking issue whose id resolves, when it adds the dependency, then it reads that issue's id and posts the link with the typed id. | 2 | "The tracker-client test observes `addIssueDependency` reading `repos/acme/foreign/issues/99` and then posting exactly one blocked-by request carrying `-F` and `issue_id=4242`." | diff-local |
| Story 2 negative: Given the blocking issue's id cannot be resolved, when the tracker client adds the dependency, then it rejects with an error naming both issues and sends no blocked-by request. | 2 | "For a read returning no numeric id and for a read that throws, `addIssueDependency` rejects with an error naming both `acme/owned#17` and `acme/foreign#99`, and the recording runner holds no blocked-by call." | diff-local |
| Story 3 happy: Given a filing whose issue is created and whose every `--depends-on` link is recorded, when the filer finishes, then it prints the linked references and prints no not-linked line. | 3, 4 | "With every link recorded, the real filer CLI exits 0, prints the `depends-on:` line naming each linked reference, and prints no `NOT LINKED` line." | diff-local |
| Story 3 negative: Given a filing whose issue is created but one `--depends-on` link is rejected by GitHub, when the filer finishes, then its final output line names the filed issue URL, the unlinked `owner/repo#N`, and the rejection reason, and the filer still exits 0. | 3, 4 | "With the POST for `acme/app#43` rejected, the CLI exits 0 and its last output line is the `NOT LINKED` line naming the filed issue URL, `acme/app#43`, and the 422 rejection text." | diff-local |
| Story 3 negative: Given a filing whose `--depends-on` issue id cannot be read, when the filer finishes, then a final not-linked line names that reference and the read failure while every recorded link is still reported as linked. | 3, 4 | "With the id read for `acme/app#43` failing, the final `NOT LINKED` line names `acme/app#43` and the read failure, while the `depends-on:` line still names `acme/app#42` as linked." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the argv contract for every registered dependency-add caller: intake filing and dependency migration integration tests, plus a guarded-runner unit test for the missing-id refusal. Task 2 owns the tracker-client method at its public client boundary. Task 3 owns the filing-result unit contract. Task 4 owns the only changed production entry point, the filer CLI, through a real-process integration test with a stub GitHub CLI. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 4
Task 3 -> Task 4

Small tier: architecture, conflict, and coherence artifacts are skipped. No ADR is created or amended.
