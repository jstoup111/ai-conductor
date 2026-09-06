# Implementation Plan: Build the ci-fix hint from the PR status check rollup

**Date:** 2026-09-06
**Stories:** .docs/stories/build-ci-fix-hint-from-the-pr-status-check-rollup.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing CI-fix contracts — the same injected gh runner seam, the same outcome log line format, the same error classifier vocabulary, and the same never-throw guarantee the hint builder already offers its single caller.

## Summary

Four bounded tasks deliver #2153: the RETRY hint builder learns to fetch the pull request's status check rollup with a well-formed command and to parse the shape that command returns, it labels and bounds what it emits, it records one distinguishable outcome line for every result including each empty one, and the daemon's ci-fix dispatch hands it the logger those lines belong in. The eligibility gates and the non-terminal classification helper in the same module, the merge-state module's rollup element type, the sweep's dispatch callback signature, and the fix prompt beyond the hint string are all outside this slice.

## Technical Approach

The defect is two independent faults in one function. It invokes the check-list command with a bare `--json` and no field list, which that CLI rejects outright; and its parser walks a nested check-suite shape with per-run conclusion and details-URL fields that neither the check-list command nor the rollup returns. Both faults land in the same catch, which returns an empty string, so every ci-fix dispatch has been carrying a blank hint.

Fetch the evidence from the pull-request view command with the status-check-rollup JSON field named explicitly, rather than repairing the check-list command's field list. The check-list command's documented behavior is to exit non-zero when checks fail — which is the only situation in which this builder ever runs — and the canonical gh runner surfaces a non-zero exit as a thrown error whose captured stdout is discarded, so a corrected field list would still yield an empty hint on exactly the path that matters. The pull-request view command exits zero and returns the full rollup nodes, and it is the same command the merge-state fetcher already issues, so nothing new is asked of the CLI. Threading the rollup already fetched for eligibility through the dispatch callback was rejected: it widens a sweep seam another in-flight change is already editing, for no gain over a second read of a cheap command on a path that runs at most twice per pull request.

Parse the rollup as a flat array of heterogeneous entries. A check-run entry reports name, status, conclusion and detailsUrl; a commit-status entry reports context, state and targetUrl. Declare that union as a local element type inside the CI-fix module and do not widen the merge-state module's own rollup type, which another in-flight change owns. Select a failing entry by uppercasing both conclusion and reported state and testing them against a failed-outcome set local to this function — failure, error, timed out, cancelled, action required, startup failure. Deliberately exclude the pending value that the shared failing-or-pending vocabulary carries: a pending entry is not evidence for a fix session, and the eligibility gate has already refused to dispatch while one exists.

Label each selected entry by its trimmed check-run name, then its trimmed commit-status context, then the same unnamed-entry placeholder text the module already uses for a rollup entry with no identifier; read that text from the module's existing constant rather than restating it, and change neither that constant nor the helper that owns it. Take the entry's link from detailsUrl, then targetUrl. Keep the existing failed-step log excerpt: extract the run identifier from the link with the existing run-path pattern, which was confirmed on 2026-09-06 against a live details URL of the form actions/runs/<run id>/job/<job id>, fetch that run's failed-step log, and keep the existing first-lines bound. A log fetch that throws must leave the entry's name and link in place, as it does today.

Add the total-length bound the function's own contract already promises and does not deliver. Declare one character budget as a module constant, assemble the hint, and when it exceeds the budget truncate to it and append a single truncation marker line. This is the only defense against a very large failed-step log, since the shared gh runner permits a stdout buffer far larger than any usable prompt hint.

Make every result visible through the module's existing outcome log line helper, under one new stage name, using the daemon logger the caller already passes to the eligibility gate. Emit exactly one line per invocation: a built result naming the count of failing entries; an error result carrying the category the module's exported error classifier returns plus the underlying message, for both a thrown fetch and an unparseable payload; and two distinct empty results, one for an absent or empty rollup and one for a rollup with no failing entry. This follows the approved 2026-07-20 CI-fix startup preflight and error classification decision, whose second decision requires precisely that a swallowed resolver failure be replaced by a classified, diagnosable line. The parameter is optional and defaults to the same console fallback the eligibility gate uses, so no existing caller breaks.

Event spine: channel? no — this reuses the module's existing outcome log line and its existing format, adds no watcher, sidecar, ledger, or stamped artifact field, and introduces no new reader path. No union member and no ADR are required.

Follow the module's existing test pattern: the CI-fix engine test file already builds a fake gh runner that answers a check-enumeration command and a run-log command from fixture stdout and asserts properties of the returned hint string, so the corrected fixtures replace that builder's payload shape in place and every new case is a unit case at the same seam with the gh runner as the only injected boundary. Capture outcome lines by passing a collecting logger, exactly as the eligibility suite in the same file already does. Assert the issued argument vector at that injected boundary so the malformed invocation cannot regress; that assertion is this slice's cross-boundary proof, because the hint builder is itself the production entry point the daemon calls and the CLI is the only boundary it crosses. No process is launched, no network is contacted, and no LLM is reached. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, fetching through the pull-request view command, and both stories on 2026-09-06 (delegated).
- Verified: the hint builder in `src/conductor/src/engine/ci-fix.ts` calls the check-list command with a bare `--json` and no field list, walks a nested check-suite and check-run shape keyed on a failure conclusion and a details URL, and returns an empty string from a single catch at the end of the function.
- Verified: the same module exports an error classifier returning one of four categories, and it imports and already uses the shared outcome log line helper for its eligibility refusals.
- Verified: the same module declares an unnamed-entry placeholder constant inside its non-terminal classification helper; this plan reads that text and edits neither the helper nor the non-terminal state set it consults.
- Verified: `src/conductor/src/daemon-cli.ts` is the only caller of the hint builder, it constructs a per-repository gh runner immediately above the call, and it already passes the daemon logger to the eligibility gate a few lines earlier.
- Verified: the merge-state fetcher in `src/conductor/src/engine/pr-labels.ts` requests the rollup through the pull-request view command and passes the parsed entries through unchanged; the shared failing-or-pending vocabulary in that module includes a pending value, which is why this plan uses its own failed-only set.
- Verified: `src/conductor/test/engine/ci-fix.test.ts` contains a hint-builder suite with a fake gh runner keyed on the check-enumeration and run-log commands, three existing cases whose fixtures encode the unreturnable nested shape, and a separate eligibility suite that already captures log lines through an injected collecting logger.
- Verified on 2026-09-06 against a live pull request: the pull-request view command with the status-check-rollup field returns a flat array whose check-run entries carry a type discriminator, name, status, conclusion, started and completed timestamps, workflow name, and a details URL of the form actions/runs/<run id>/job/<job id>, so the existing run-identifier pattern matches it.
- Verified: the canonical gh runner rejects a non-zero exit by throwing, and returns only stdout on success, so a command that exits non-zero when checks fail cannot deliver its payload through this seam.
- Assumption, high confidence: a commit-status rollup entry reports context, state, and target URL and carries no check-run name. This is the shape the GitHub CLI documents for that node type and the shape a sibling observation on the same rollup reports. The design fails safe either way: an entry whose reported state is absent or unrecognized is simply not selected as failing, which is today's behavior for it.
- Scope check: A — harness-repo-only daemon machinery; B — n/a, no new skill; C — provider-agnostic. Event spine: no new channel, an existing outcome log line under a new stage name.
- Verify-claims verdict: CLEAR. No unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Fetch and enumerate failing checks from the status check rollup
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/ci-fix.ts, src/conductor/test/engine/ci-fix.test.ts
**Dependencies:** none

**Steps:**
1. Rewrite the hint suite's fake gh runner so it answers the pull-request view command from a fixture payload built in the flat rollup shape recorded in the claim ledger, records every argument vector it is handed, and answers the failed-step log command as it does today.
2. Add a case asserting the recorded argument vector is the pull-request view command for the given pull request URL with the status-check-rollup JSON field named explicitly, so a bare JSON flag cannot return.
3. Add cases for a single failing check run with a name and a details link, for a rollup mixing passing, still-running, and failing entries, and for a failing entry whose details link identifies a workflow run whose failed-step log the fake returns.
4. Establish RED, then replace the fetch and the parser: issue the pull-request view command, read the flat rollup, select entries whose uppercased conclusion or reported state is in a failed-outcome set local to this function, and emit each selected entry's label, link, and existing bounded log excerpt.
5. Run the narrowest test invocation for the CI-fix engine test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The builder issues exactly one check-enumeration command, and a unit fixture asserts its argument vector is the pull-request view command with the status-check-rollup JSON field named explicitly.
2. A hint built from a fixture rollup carrying one failing check run contains that run's name and its details link.
3. A hint built from a fixture rollup mixing passing, still-running, and failing entries names the failing entries and no passing or still-running entry.
4. A hint built from a fixture whose failing entry links to a workflow run contains lines from that run's failed-step log beneath the entry's name.

### Task 2: Label every entry and bound the hint's length
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/ci-fix.ts, src/conductor/test/engine/ci-fix.test.ts
**Dependencies:** 1

**Steps:**
1. Add hint-suite cases for a failing entry that reports only a commit-status context, state, and target URL; for a failing entry that reports no identifier at all; for a failing entry whose failed-step log fetch throws; and for a rollup whose entries and log excerpts together exceed the character budget.
2. Establish RED, then choose each entry's label from its trimmed check-run name, then its trimmed commit-status context, then the module's existing unnamed-entry placeholder constant, reading that constant rather than restating its text and changing neither it nor the helper that owns it.
3. Take each entry's link from its details URL, then its target URL, and leave the existing per-entry log-fetch failure path returning the entry's name and link without throwing.
4. Declare the character budget and the truncation marker as module constants, and truncate the assembled hint to the budget with the marker appended when it would exceed it.
5. Run the narrowest test invocation for the CI-fix engine test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A hint built from a fixture rollup whose failing entry carries only a commit-status context contains that context and its target link.
2. A hint built from a fixture rollup whose failing entry carries no identifier at all is non-empty and contains the unnamed-entry placeholder text.
3. A hint built from a fixture whose failed-step log fetch throws returns without throwing and still contains that entry's name and its link.
4. A hint built from an oversized fixture rollup is no longer than the declared character budget and ends with the truncation marker.

### Task 3: Record one distinguishable outcome line for every hint result
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/ci-fix.ts, src/conductor/test/engine/ci-fix.test.ts
**Dependencies:** 1

**Steps:**
1. Add hint-suite cases that pass a collecting logger, following the eligibility suite's existing pattern, for a fetch that throws, a payload that is not valid JSON, a payload carrying no rollup, a rollup whose entries are all passing, and a rollup with one failing entry.
2. Assert one captured line per invocation, that the four empty-hint result texts are pairwise distinct, that the thrown-fetch line carries the classifier category and the underlying message, and that the successful line names the count of failing entries.
3. Establish RED, then add an optional logger parameter defaulting to the same console fallback the eligibility gate uses, and emit exactly one outcome line per invocation through the module's existing outcome log line helper under one new stage name.
4. Keep the never-throw guarantee and the empty-string return for every non-built result, so the caller's behavior is unchanged apart from the log.
5. Run the narrowest test invocation for the CI-fix engine test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. Each of the four empty-hint fixtures captures exactly one outcome line through the injected logger, and the four captured result texts are pairwise distinct.
2. The thrown-fetch fixture's captured line carries the category the module's error classifier returns for that error together with the underlying message text.
3. The non-JSON payload fixture returns an empty hint and captures one outcome line whose result text marks an error rather than an ordinary empty result.
4. The successful fixture captures exactly one outcome line naming the count of failing entries the hint names.

### Task 4: Hand the daemon logger to the hint builder at the ci-fix dispatch site
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/engine/ci-fix.test.ts
**Dependencies:** 3

**Steps:**
1. Add a hint-suite case that replaces the process's standard output writer with a recording stub for the duration of one invocation with a collecting logger supplied, asserts nothing was written to it, and restores the original writer in a finally block.
2. Establish RED if the default fallback is reached, then pass the daemon logger to the hint builder at the ci-fix dispatch call site, as that site already does for the eligibility gate a few lines earlier.
3. Change nothing else at that call site: the per-repository gh runner construction, the branch lookup above it, and the dispatcher wiring below it stay as they are.
4. Run the narrowest test invocation for the CI-fix engine test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The ci-fix dispatch call site passes the daemon logger to the hint builder as it already does to the eligibility gate, and the repository typecheck target that covers test files passes.
2. No hint-builder outcome line reaches standard output when a logger is supplied, proven by a unit fixture that fails if the builder writes to the process's standard output.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a pull request whose fetched check rollup carries a completed failing check run with a name and a details link, when the ci-fix hint is built, then the hint contains that check's name and that details link. | 1 | "A hint built from a fixture rollup carrying one failing check run contains that run's name and its details link." | diff-local |
| Story 1 happy: Given a fetched rollup that mixes passing, still-running, and failing entries, when the hint is built, then the hint names the failing entries and names no passing or still-running entry. | 1 | "names the failing entries and no passing or still-running entry" | diff-local |
| Story 1 happy: Given a failing entry whose details link identifies a workflow run, when the hint is built, then the hint contains an excerpt of that run's failed-step log below that entry's name. | 1 | "contains lines from that run's failed-step log beneath the entry's name" | diff-local |
| Story 1 negative: Given a failing entry that reports its outcome as a commit-status state and identifies itself by a context rather than a check-run name, when the hint is built, then the hint names that entry by its context and contains its target link. | 2 | "contains that context and its target link" | diff-local |
| Story 1 negative: Given a failing entry that reports neither a check-run name nor a context, when the hint is built, then the hint labels that entry with the module's existing unnamed-entry placeholder text rather than an empty label. | 2 | "is non-empty and contains the unnamed-entry placeholder text" | diff-local |
| Story 1 negative: Given the failed-step log fetch for a failing entry throws, when the hint is built, then the builder returns without throwing and the hint still contains that entry's name and its link. | 2 | "returns without throwing and still contains that entry's name and its link" | diff-local |
| Story 1 negative: Given the failing entries and their log excerpts together exceed the hint's declared character budget, when the hint is built, then the returned hint is no longer than that budget and ends with the truncation marker. | 2 | "is no longer than the declared character budget and ends with the truncation marker" | diff-local |
| Story 2 happy: Given the rollup fetch succeeds and at least one entry is failing, when the hint is built, then exactly one outcome line records the hint stage and the number of failing entries the hint names. | 3 | "captures exactly one outcome line naming the count of failing entries the hint names" | diff-local |
| Story 2 happy: Given the daemon dispatches ci-fix for a pull request, when the hint is built, then every outcome line the builder emits is written through the logger the daemon supplies rather than the process's standard output. | 4 | "No hint-builder outcome line reaches standard output when a logger is supplied" | diff-local |
| Story 2 negative: Given the rollup fetch throws, when the hint is built, then the returned hint is empty and exactly one outcome line records the hint stage with the category the module's error classifier returns for that error and the underlying message. | 3 | "carries the category the module's error classifier returns for that error together with the underlying message text" | diff-local |
| Story 2 negative: Given the fetch returns text that is not valid JSON, when the hint is built, then the returned hint is empty and exactly one outcome line records the hint stage with an error result. | 3 | "captures one outcome line whose result text marks an error rather than an ordinary empty result" | diff-local |
| Story 2 negative: Given the fetched payload carries no rollup or an empty rollup, when the hint is built, then the returned hint is empty and exactly one outcome line records a result text distinct from every other empty-hint result text. | 3 | "the four captured result texts are pairwise distinct" | diff-local |
| Story 2 negative: Given the fetched rollup carries entries but none of them is failing, when the hint is built, then the returned hint is empty and exactly one outcome line records a result text distinct from every other empty-hint result text. | 3 | "the four captured result texts are pairwise distinct" | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided by a pure transformation of a fixture payload handed to the builder through the injected gh runner inside this diff, so no commit outside this feature can change whether it holds. Task 1 owns the enumeration cases and the argument-vector assertion; Task 2 owns the labelling, degradation, and budget cases at the same seam; Task 3 owns the outcome-line cases with a collecting logger; Task 4 owns the call-site wiring and the proof that no line escapes to standard output. Task 1's argument-vector assertion is this slice's single cross-boundary proof: the hint builder is itself the production entry point the daemon's ci-fix dispatch calls, and the GitHub CLI is the only boundary it crosses, so pinning the exact invocation at the injected runner is what proves the corrected command actually reaches the CLI. No process is launched, no network call is made, and no third-party service is contacted in any task; the injected gh runner returns fixture JSON throughout. No aggregate or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 3 -> Task 4
