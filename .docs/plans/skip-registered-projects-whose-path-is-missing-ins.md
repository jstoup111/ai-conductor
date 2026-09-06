# Implementation Plan: Skip registered projects whose path is missing

**Date:** 2026-09-06
**Stories:** .docs/stories/skip-registered-projects-whose-path-is-missing-ins.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the adapter's existing per-repo isolation contract, its existing injected log sink, and its existing directory-liveness convention, and changes no interface.

## Summary

Three bounded tasks deliver #1131 inside the github-issues intake adapter: a liveness test that skips
a registration whose directory is absent before any GitHub command is attempted, a corrected
operator-facing diagnostic that names the registration and its missing path, and a per-adapter record
that keeps one dead registration to a single notice while re-arming when the path returns. Registry
repair, de-registration, and durable registration health are outside this slice.

## Technical Approach

The defect is in the adapter's poll loop: it caches the repo path and calls the tracker's assigned-issue
listing with `repo.path` as the working directory, with no test that the directory still exists. The
production runner passes that path to `execFile` as `cwd`, so a deleted directory fails the spawn
itself and surfaces as `spawn gh ENOENT`, which the loop's catch then reports through the per-repo
poll-failure line. The observation is therefore correct about the symptom and wrong about the cause,
and it recurs every tick because nothing about the attempt changes.

Test the directory before the attempt. Inside the loop, ahead of the path cache and the listing call,
skip a registration whose configured directory does not exist and continue to the next one. The skip
emits its own line through the same injected log sink the failure line already uses, naming the
registration, its configured path, and the missing-path reason, and never borrowing the poll-failure
wording. Because the skip happens before the listing call, no GitHub command is attempted at all —
that, not a retry budget, is what stops the repeated attempts.

Bound the notice with a per-adapter set of already-reported registrations, keyed on the registration's
GitHub target and its configured path together. A registration is added to the set when it is skipped
and reported, so later polls in the same process skip it silently; it is removed whenever its path is
found to exist, so a restored-then-deleted path is reported afresh. The set lives in the adapter
closure alongside the existing `postedMarkers` and `repoPaths` state, which is the module's established
shape for per-instance de-duplication; the one-shot CLI poll paths therefore report once per invocation
and the long-running loop reports once per episode.

The operator-facing surface stays the injected log sink deliberately. The intake notifier's status file
is written only when new ideas are captured, and putting a skipped-registration field into it would be
a second reader path for a signal none of the existing log consumers can see — the parallel-channel
shape the repository's event-spine rule names outright. No new event variant is required either: this
corrects an existing diagnostic rather than adding an occurrence.

The module already imports `existsSync` and already existsSync-checks every candidate working directory
in its report-cwd resolver, so the liveness test copies a local pattern rather than introducing a
dependency; use the same direct check on the configured path, and do not widen it into a git or
repository validity test. The affected tasks repeat that convention in their own steps.

Testing follows this repository's test rules: unit tests inject a recording GitHub runner and a
recording log sink and assert at those seams; the acceptance tests keep the real internal poll flow
with the existing faithful `gh` fake. Note that the existing acceptance fixtures register directories
that were never created on disk, because nothing previously read them — Task 1 creates each registered
fixture path so that suite keeps exercising live registrations instead of silently becoming a suite of
skips. No real network, GitHub, or LLM call is introduced. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the log-sink surface, and both stories on 2026-09-06 (delegated).
- Verified: the poll loop in `src/conductor/src/engine/engineer/intake/github-issues.ts` caches `repo.path` and calls `tracker.listAssignedIssues(ghRepo, repo.path)` with no liveness test, and its catch emits the `poll failed for` line.
- Verified: `makeProductionGh` in `src/conductor/src/engine/tracker-client.ts` passes the given path to `execFile` as `cwd`, which is what makes an absent directory fail as a spawn error.
- Verified: the same adapter module already imports `existsSync` and already existsSync-checks each candidate directory in its report-cwd resolver, and already keeps per-instance de-duplication state in its closure.
- Verified: `createRegistryReader` in `src/conductor/src/engine/registry.ts` returns stored records verbatim and carries no liveness notion, so the adapter is the correct owner of the test.
- Verified: the acceptance fixtures in `src/conductor/test/engine/engineer/intake/github-issues.acceptance.test.ts` build their adapters through a local helper that registers temporary paths without creating them, while the sibling cross-repo isolation acceptance file and the unit poll fixtures do create theirs.
- Scope check: A — harness-repo-only; B — n/a, no new skill; C — provider-agnostic. Event spine: no new channel; an existing diagnostic is corrected.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior claim above was read in the worktree; no load-bearing assumption is pending.

## Tasks

### Task 1: Skip a registration whose directory is absent
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/intake/github-issues.ts, src/conductor/test/engine/engineer/intake/github-issues.test.ts, src/conductor/test/engine/engineer/intake/github-issues.acceptance.test.ts
**Dependencies:** none

**Steps:**
1. Write a failing unit test that builds the adapter over a recording GitHub runner and a recording log sink, with a registry listing one registration whose configured directory was never created, and asserts that the poll returns no envelopes, that the runner recorded no invocation, and that exactly one logged line carries the registration, its configured path, and the missing-path reason while carrying none of the existing poll-failure wording.
2. Verify the test fails (RED).
3. Implement the skip in the poll loop, ahead of the path cache and the listing call, using the module's existing directory-existence convention on the configured path; the module already imports that check and already applies it to every candidate working directory in its report-cwd resolver, so reuse it rather than adding a dependency, and do not widen it into a git or repository validity test.
4. Create each registered fixture path in the acceptance suite's local adapter helper before the adapter is built, so the existing capture, isolation, ledger, and label coverage keeps exercising live registrations.
5. Verify the unit and acceptance tests pass (GREEN), then run the repository's typecheck target that includes test files and commit the focused change.

**Done when:**
1. A poll whose only registration has an absent directory returns no envelopes and records zero GitHub runner invocations.
2. That poll logs exactly one line for the registration, containing its name, its configured path, and the missing-path reason, and not containing the existing poll-failure wording.
3. Every pre-existing test in the github-issues acceptance file passes with each registered fixture path created on disk before its poll.

### Task 2: Keep healthy registrations polling and keep a listing failure distinct
**Story:** Story 1 (negative path)
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/engineer/intake/github-issues.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing acceptance case over the existing faithful GitHub fake with a registry holding one created directory whose repo has one assigned issue and one registration whose directory was never created, asserting that the poll returns exactly the live registration's envelope and that the logged skip names only the absent registration.
2. Write a second failing acceptance case in which a registration with a created directory has its issue listing throw, asserting that the existing per-repo poll-failure line is emitted for it and that no missing-path line is emitted for it, so a genuine listing failure is never relabelled.
3. Verify both cases fail before Task 1's production change is present and pass after it (RED then GREEN); add no production change in this task.
4. Run the focused acceptance file and the repository's typecheck target that includes test files, then commit.

**Done when:**
1. The mixed-registry acceptance case returns exactly one envelope, and it is the live registration's assigned issue.
2. In that case the logged skip line names the absent registration only, and names no live registration.
3. The failing-listing acceptance case emits the existing poll-failure line for that registration and emits no missing-path line.

### Task 3: Report a dead registration once per episode and re-arm on restore
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/intake/github-issues.ts, src/conductor/test/engine/engineer/intake/github-issues.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing unit test that polls the same adapter twice with one registration whose directory is absent and asserts zero GitHub runner invocations across both polls and exactly one logged notice in total.
2. Extend that test so a third poll, after the directory has been created and the fake lists one assigned issue for it, captures that issue and records the listing invocation, and a fourth poll, after the directory is removed again, logs a second notice.
3. Verify the test fails (RED).
4. Implement a per-adapter set of already-reported registrations in the adapter closure beside the existing per-instance de-duplication state, keyed on the registration's GitHub target together with its configured path; add the key when a skip is reported, and remove it whenever the configured path is found to exist, so the re-arm needs no clock or counter.
5. Verify the test passes (GREEN), run the repository's typecheck target that includes test files, and commit.

**Done when:**
1. Two consecutive polls of the same absent registration record zero GitHub runner invocations and log exactly one notice in total.
2. A poll taken after that registration's directory is created lists its issues and returns its assigned issue as an envelope.
3. A poll taken after the same directory is removed again logs a second notice for that registration.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a registered project whose directory does not exist, when the intake poll runs, then no GitHub command is attempted for that registration and the poll continues to the remaining registrations. | 1 | "A poll whose only registration has an absent directory returns no envelopes and records zero GitHub runner invocations." | diff-local |
| Story 1 happy: Given that skipped registration, when the poll reports it, then the operator-facing line names the registration, names its configured path, and states that the path is missing, and does not report a `gh` command failure. | 1 | "That poll logs exactly one line for the registration, containing its name, its configured path, and the missing-path reason, and not containing the existing poll-failure wording." | diff-local |
| Story 1 negative: Given a registered project whose directory exists but whose issue listing fails, when the intake poll runs, then the existing per-repo poll-failure diagnostic is emitted unchanged for it and no missing-path notice is emitted. | 2 | "The failing-listing acceptance case emits the existing poll-failure line for that registration and emits no missing-path line." | diff-local |
| Story 2 happy: Given a registry holding one live registration with an assigned issue and one registration whose directory is missing, when the intake poll runs, then the live registration's issue is captured and only the missing registration is skipped. | 2 | "The mixed-registry acceptance case returns exactly one envelope, and it is the live registration's assigned issue." | diff-local |
| Story 2 negative: Given a registration whose missing path was already reported in this process, when later polls run, then no further GitHub command is attempted for it and no further notice is emitted for it while the path stays missing. | 3 | "Two consecutive polls of the same absent registration record zero GitHub runner invocations and log exactly one notice in total." | diff-local |
| Story 2 negative: Given a registration whose missing path is restored, when the next poll runs, then it is polled normally, and a later disappearance of the same path is reported again. | 3 | "A poll taken after the same directory is removed again logs a second notice for that registration." | diff-local |

## Test dispositions and integration ownership

All six criteria are diff-local: each is decided entirely by the adapter's poll loop and the fixtures
in this diff, and no commit outside the feature can change whether they hold. Task 1 owns the unit
proof of the skip and its diagnostic at the injected runner and log seams, and owns the fixture repair
that keeps the existing acceptance coverage on live registrations. Task 2 owns the integration proof
through the adapter's real poll flow over the existing faithful GitHub fake, which is the entry point
the intake loop and the compose poll command both reach this behavior through; it covers both the
mixed-registry outcome and the preserved listing-failure diagnostic. Task 3 owns the unit proof of the
once-per-episode notice and its re-arm. No real GitHub, network, or LLM call is introduced, no new
aggregate test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
