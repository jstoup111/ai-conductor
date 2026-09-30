# Implementation Plan: Surface evidence-path overlap as suggested dependencies at intake filing time

**Date:** 2026-09-28
**Design:** .docs/specs/surface-evidence-path-overlap-as-suggested-depende.md
**Stories:** .docs/stories/surface-evidence-path-overlap-as-suggested-depende.md
**Conflict check:** Clean as of 2026-09-28

## Summary

Before the intake filer creates an issue, it compares the paths the intake cites against open issues and in-flight spec and daemon branches in the target repository, then turns overlaps into suggested dependencies. Interactive filers decide each one. Non-interactive filers are refused until every suggestion is accepted or declined. Failures inside the check degrade to notes. Twenty-one tasks.

## Technical Approach

- **Decision authority:** `.docs/decisions/architecture-review-2026-09-28-surface-evidence-path-overlap-as-suggested-depende.md` (D1–D6 plus the 2026-09-28 amendments). No new ADR. The governing APPROVED ADRs are cited there.
- **Sequencing prerequisite:** lands after #742 (the bundled `skills/intake/scripts/intake-file` helper runs `intake-file-cli.ts` in the caller's directory with no `cd`) and after #2714 (dependency links record correctly). No wrapper change is made here.
- **Modules (new, under `src/conductor/src/engine/engineer/intake/`):**
  - `cited-paths.ts`: path recognition, D1.
  - `overlap-suggestions.ts`: merge, rank and cap, a pure model.
  - `overlap-sources.ts`: open-issue reads through `runTrackerRead` `repository.read`, in-flight branch diffs reusing `enumerateUnmergedBranches`, `changedPathsSinceMergeBase` and `intersectFiles`, shipped-record exclusion, and branch tracing through `parseIntakeSourceRef`.
  - `target-checkout.ts`: D3.
  - `overlap-preflight.ts`: the decision gate, its closed `OverlapDecision` union (`proceed`, `refused`, `invalid-decline`), the output renderer and event emission.
- **Choke point:** `fileIntakeIssue` gains an optional `overlap` dependency and runs the gate after sanitization and before the creation transaction, so a refusal creates nothing. Only `intake-file-cli.ts` supplies it; the engine-internal filers in `conductor.ts` stay unchanged (D6 amendment, pinned by Task 17).
- **DECIDE scan preserved:** `enumerateUnmergedBranches` gains an optional ref-pattern parameter whose default is unchanged (condition C2, pinned by Task 16).
- **Telemetry:** one `intake_overlap_checked` `ConductorEvent` per filing, with its `EVENT_SINKS` row, on the emitter the CLI already persists. No sidecar.
- **Trust boundary:** open-issue bodies never leave `overlap-sources.ts`; only path intersections do.
- **Local test pattern:** filing behavior is tested through `fileIntakeIssue` with the fake creation-operations runner used by `src/conductor/test/file-issue.test.ts` (search hint: fakes that record `issue.create`, `issue.label.add` and `issue.dependency.add`). Allowed variation: an injected `overlap` dependency. The CLI boundary is tested once by spawning the entry point with a stub `gh` on `PATH`, as in `src/conductor/test/acceptance/intake-file-completeness.test.ts`. Git-backed tests build throwaway repositories in temp directories and never touch the harness checkout.
- **Sequencing:** the pure pieces (Tasks 1, 2, 19, 14) come first. Then the sources (3, 4, 5), the gate (6), the gate behaviors (7–13, 15, 20, 21), the pins (16, 17), and the CLI integration (18) last.

## Prerequisites

- #742 and #2714 merged to main before BUILD (recorded blocked_by links on #1606).

## Tasks

### Task 1: Extract cited evidence paths from intake text
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-cited-paths.test.ts` covering line-suffix stripping, title and body sources, `./` and `#Lnn` normalization, URL and prose exclusion under a known-path set, the nonexistent-path case, the no-token case, and the near-identical-name case.
2. Verify RED: the module does not exist.
3. Implement `extractCitedPaths(text, knownPaths?)` in `src/conductor/src/engine/engineer/intake/cited-paths.ts` (design D1): a token counts when it contains `/` or a file extension after stripping surrounding backticks and quotes, a leading `./`, and a trailing `:line`, `:line-line` or `#Lnn` suffix. Tokens starting with a URL scheme are never candidates. When `knownPaths` is supplied, keep only candidates in that set. Return a de-duplicated list in first-seen order. Matching against other sources reuses `intersectFiles` from `src/conductor/src/engine/overlap-scan.ts` (exact equality after normalization), never prefix or basename matching.
4. Verify GREEN.
5. Commit: "feat(intake): extract cited evidence paths from intake text".

**Done when:**
- The `intake-cited-paths` Vitest test asserts `extractCitedPaths` returns `src/engine/foo.ts` for a body citing `src/engine/foo.ts:41` and returns both `bin/tool` and `docs/guide.md` for title `bin/tool` plus body `./docs/guide.md#L10` when no known-path set is supplied.
- The same test asserts that with a known-path set containing only `src/engine/foo.ts`, a body that also holds `and/or` and `https://github.com/o/r/pull/5` yields exactly `["src/engine/foo.ts"]`.
- The same test asserts an empty result for a body whose only path-shaped token `lib/gone.rb` is absent from the supplied known-path set, and an empty result for a body with no path-shaped token.
- The same test asserts `intersectFiles(["helper.ts"], ["helperx.ts"])` returns an empty list, so near-identical names never form a shared path.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/cited-paths.ts`
- `src/conductor/test/engine/intake-cited-paths.test.ts`

**Dependencies:** none

### Task 2: Suggestion model merges routes that name the same issue
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-suggestions.test.ts`.
2. Verify RED.
3. Implement `src/conductor/src/engine/engineer/intake/overlap-suggestions.ts`: types `IssueOverlap` (issue ref plus shared paths), `BranchOverlap` (branch, shared paths, traced linkable issue ref or null) and `buildSuggestions({ issueOverlaps, branchOverlaps, alreadyNamed, cap })`. It merges every route that names the same issue into one linkable suggestion whose shared paths are the de-duplicated union, and moves suggestions whose issue is in `alreadyNamed` to `preAccepted`, and returns branch overlaps without a linkable issue as `advisory`.
4. Verify GREEN.
5. Commit: "feat(intake): build ranked overlap suggestions".

**Done when:**
- The `intake-overlap-suggestions` Vitest test asserts that an issue overlap for #1487 on `a.ts` plus a branch overlap traced to #1487 on `b.ts` produce exactly one shown suggestion for #1487 with shared paths `["a.ts", "b.ts"]`.
- The same test asserts that two routes naming #1487 with the same path `a.ts` produce one suggestion listing `a.ts` exactly once.
- The same test asserts a suggestion whose issue is in `alreadyNamed` appears in `preAccepted` and not in `shown`, and that a branch overlap with no linkable issue appears in `advisory` only.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-suggestions.ts`
- `src/conductor/test/engine/intake-overlap-suggestions.test.ts`

**Dependencies:** none

### Task 3: Open issues in the target repository that cite the same paths become issue overlaps
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-open-issues.test.ts` with a fake tracker-read runner that records argv and returns fixture JSON.
2. Verify RED.
3. Implement `collectOpenIssueOverlaps({ listOpenIssues, citedPaths, knownPaths, limit })` in `src/conductor/src/engine/engineer/intake/overlap-sources.ts`, plus the production lister `makeOpenIssueLister(gh, cwd, repository)`. The lister issues one `runTrackerRead(gh, cwd, 'repository.read', repository, { kind: 'repository' }, ['issue', 'list', '--repo', repository, '--state', 'open', '--limit', String(limit), '--json', 'number,body'])` call. Each body goes through `extractCitedPaths` (Task 1) with the same known-path set and is intersected with the intake's cited paths via `intersectFiles`. Only the intersection leaves this function; raw bodies are never returned, printed or emitted (inbound trust boundary D1). The default limit is 500.
4. Verify GREEN.
5. Commit: "feat(intake): find open issues citing the same evidence paths".

**Done when:**
- The `intake-overlap-open-issues` Vitest test asserts the recorded tracker read is a single `repository.read` whose argv contains `issue list --repo <target> --state open --limit 500`.
- The same test asserts a fixture open issue #1579 citing `src/review/rubric.ts` yields an overlap for #1579 with shared paths `["src/review/rubric.ts"]`, and an issue #1487 citing two of the intake's three paths yields exactly those two shared paths.
- The same test asserts that open issues sharing no cited path yield no overlap and that no returned overlap carries an issue body.
- Because the list call names only the filing repository and requests `--state open`, a closed issue or another repository's issue never reaches the result; the test asserts the fixture runner is queried with exactly that repository and state.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-sources.ts`
- `src/conductor/test/engine/intake-overlap-open-issues.test.ts`

**Dependencies:** 1, 2

### Task 4: In-flight spec and daemon branches whose diffs change cited paths become branch overlaps
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-branches.test.ts` against a fixture git repository created in a temp directory. It has a base branch, an overlapping `feat/daemon-a`, a `spec/b` pushed to a local bare remote as `origin/spec/b`, a zero-ahead `feat/daemon-c`, a `fix/d` changing a cited path, an unrelated-history branch with no merge base, and a squash-merged `feat/daemon-e` whose `.docs/shipped/e.md` exists on base.
2. Verify RED.
3. Add an optional ref-pattern parameter to `enumerateUnmergedBranches` in `src/conductor/src/engine/overlap-scan.ts`. Its default stays exactly the existing `refs/heads/spec/*` and `refs/remotes/*/spec/*` pair. Implement `collectInFlightOverlaps({ git, baseRef, citedPaths, maxBranches })` in `src/conductor/src/engine/engineer/intake/overlap-sources.ts`. It enumerates with the spec and daemon patterns and drops a branch when `.docs/shipped/<slug>.md` exists at `baseRef` (`git cat-file -e`, D2 amendment). It orders the rest by most recent commit, compares at most `maxBranches` (default 100), reuses `changedPathsSinceMergeBase` and `intersectFiles`, and records a skip note naming any branch with no merge base.
4. Verify GREEN.
5. Commit: "feat(intake): find in-flight spec and daemon branches changing cited paths".

**Done when:**
- The `intake-overlap-branches` Vitest test asserts `collectInFlightOverlaps` reports `feat/daemon-a` with shared path `src/halt/markers.ts`, the local unmerged `spec/b` with its shared path, and the remote-tracking `origin/spec/b2` with its shared path.
- The same test asserts `feat/daemon-c` (zero commits ahead) and `fix/d` are absent from the result.
- The same test asserts the no-merge-base branch is absent from the overlaps and named in a skip note, while `feat/daemon-a` is still reported.
- The same test asserts the squash-merged `feat/daemon-e`, which has commits ahead and `.docs/shipped/e.md` on base, is absent from the overlaps and is not counted against `maxBranches`.

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts`
- `src/conductor/src/engine/engineer/intake/overlap-sources.ts`
- `src/conductor/test/engine/intake-overlap-branches.test.ts`

**Dependencies:** 2

### Task 5: Overlapping branches trace to their originating issue or stay advisory
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-tracing.test.ts` using the Task 4 fixture pattern: branches carrying `.docs/intake/<slug>.md` with a valid same-repo open ref, no marker, an unparseable ref, a closed issue ref, and another repository's ref. Use a fake issue-state reader.
2. Verify RED.
3. Implement `traceBranchIssue({ git, branch, repository, readIssueState })` in `src/conductor/src/engine/engineer/intake/overlap-sources.ts`. The slug is the ref suffix after `spec/` or `feat/daemon-`. It reads `<branch>:.docs/intake/<slug>.md` with `git show`, parses it with the existing `parseIntakeSourceRef` in `src/conductor/src/engine/artifacts.ts`, and narrows to GitHub with `parseSourceRef` (D4 amendment: no third `Source-Ref:` parser). It returns the issue ref only when the repository equals the filing target and `readIssueState` reports `OPEN`; otherwise it returns null. The production state reader uses `runTrackerRead(..., 'issue.read', ...)`. Wire it into `collectInFlightOverlaps` so each overlap carries its traced issue or null.
4. Verify GREEN.
5. Commit: "feat(intake): trace in-flight overlaps to their originating issue".

**Done when:**
- The `intake-overlap-tracing` Vitest test asserts an overlapping `feat/daemon-«slug»` branch whose own `.docs/intake/<slug>.md` carries `Source-Ref: owner/repo#1477` for an open same-repo issue is traced to `owner/repo#1477`, and `buildSuggestions` places #1477 in `shown` as a linkable suggestion carrying that branch's shared paths.
- The same test asserts that a branch with no marker for its own slug, a branch with an unparseable Source-Ref, a branch whose ref names a closed issue, and a branch whose ref names another repository each yield a branch overlap with a null traced issue.
- The same test feeds those null-traced overlaps to `buildSuggestions` and asserts they land in `advisory` with their branch name and shared paths and never in `shown`.
- The same test asserts that `fileIntakeIssue` filings whose only overlaps are a marker-less branch and an unparseable-Source-Ref branch record an `issue.create` operation and a proceed decision with zero prompt calls in both interactive and non-interactive mode, and render stdout containing an `[intake-file] overlap: advisory` line naming each branch and its shared paths.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-sources.ts`
- `src/conductor/test/engine/intake-overlap-tracing.test.ts`

**Dependencies:** 4, 6

### Task 6: Overlap decision gate runs inside fileIntakeIssue and leaves a no-overlap filing unchanged
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-gate.test.ts`. Drive `fileIntakeIssue` with the existing fake creation-operations runner pattern from `src/conductor/test/file-issue.test.ts` (search hint: `createIntakeFilingOperations` fakes recording operations), plus an injected `overlap` dependency returning fixture suggestions.
2. Verify RED.
3. Add an optional `overlap` dependency to `FileIntakeIssueDeps` in `src/conductor/src/engine/engineer/intake/file-issue.ts`. Implement `runOverlapPreflight` in `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`, which returns a closed `OverlapDecision` union: `proceed` (accepted refs, declined refs, advisory overlaps, skip notes, omitted count), `refused` (undecided suggestions) or `invalid-decline` (offending values). `fileIntakeIssue` calls it after sanitization and before `executeGithubIssueCreationTransaction`, appends accepted refs to the dependency list, and attaches the decision to the result as `overlap`. With the dependency omitted, or with zero suggestions, the create, label and dependency operations are identical to today.
4. Create `src/conductor/src/engine/engineer/intake/filing-output.ts` exporting `renderIntakeFileOutput(result)`, which returns `{ stdout, stderr, exitCode }`. Move the existing `[intake-file]` print lines from `src/conductor/src/intake-file-cli.ts` main into it unchanged: filed, size, priority, depends-on or `dependencies: none`, redactions, warnings and bad refs. Add the overlap lines, each prefixed `[intake-file] `:
  - `overlap check: no overlap` when nothing was found;
  - `overlap: linked <ref>`, `overlap: declined <ref>`, and `overlap: advisory <branch> (<paths>)`;
  - `overlap: skipped <part> — <reason>` and `overlap: <n> more suggestion(s) omitted`;
  - on `refused`, each undecided suggestion with its shared paths plus the `--depends-on <ref>` / `--decline-overlap <ref>` re-run options;
  - on `invalid-decline`, `overlap: invalid decline <value> — not a current suggestion`.
  `exitCode` is 1 for `refused` and `invalid-decline`, and 0 otherwise.
5. Verify GREEN.
6. Commit: "feat(intake): decision gate for overlap suggestions before issue creation".

**Done when:**
- The `intake-overlap-gate` Vitest test asserts a no-overlap filing through `fileIntakeIssue` records the same ordered create, label and dependency operations as the same filing with no `overlap` dependency, in both interactive and non-interactive mode, and never calls the prompt for overlap.
- The same test asserts that for a non-interactive no-overlap filing, `renderIntakeFileOutput` returns `exitCode` 0 and a stdout equal to the no-`overlap`-dependency run's stdout plus exactly one line, `[intake-file] overlap check: no overlap`.
- The same test asserts that a no-overlap filing naming no dependency renders stdout containing `[intake-file] dependencies: none`.
- The same test asserts a no-overlap non-interactive filing needs no decline input and returns a proceed decision with no refusal.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/file-issue.ts`
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/src/engine/engineer/intake/filing-output.ts`
- `src/conductor/test/engine/intake-overlap-gate.test.ts`

**Dependencies:** 2

### Task 7: Suggestions already named as dependencies are pre-accepted
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing cases in `src/conductor/test/engine/intake-overlap-preaccepted.test.ts` through `fileIntakeIssue` with the fake runner.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`, pass the filing's dependency refs to `buildSuggestions` as `alreadyNamed`, and treat `preAccepted` suggestions as decided and linked.
4. Verify GREEN.
5. Commit: "feat(intake): treat named dependencies as accepted suggestions".

**Done when:**
- The `intake-overlap-preaccepted` Vitest test asserts a filing naming `owner/repo#1579` while #1579 overlaps records one dependency operation for #1579 and shows no suggestion for it.
- The same test asserts a non-interactive filing whose only overlap is the named #1579 returns a proceed decision and records an `issue.create` operation.
- The same test asserts a non-interactive filing naming #1579 while #1487 also overlaps returns a refused decision whose undecided list is exactly `[#1487]`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-preaccepted.test.ts`

**Dependencies:** 6

### Task 8: Interactive filers accept or decline each linkable suggestion
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-prompt.test.ts` with a scripted prompt function and the fake runner.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`, when `interactive` is true, ask one question per shown linkable suggestion naming the issue and its shared paths, accepting `a`/`accept` and `d`/`decline` (case-insensitive). Any other answer re-asks the same suggestion. A prompt rejection (input closed) returns a refused decision holding every suggestion still undecided. Advisory overlaps are printed and never asked about.
4. Verify GREEN.
5. Commit: "feat(intake): prompt interactive filers to accept or decline overlaps".

**Done when:**
- The `intake-overlap-prompt` Vitest test asserts that scripted answers accepting #1579 and declining #1487 produce one `issue.create` operation, one dependency operation for #1579 and none for #1487, with the result naming #1487 as declined.
- The same test asserts that accepting a single suggestion records a dependency operation with the same payload as naming that ref up front.
- The same test asserts that an answer of `maybe` re-asks the same suggestion, with no create operation recorded until a valid answer follows.
- The same test drives a `node:readline/promises` prompt over an input stream that ends after the first of two answers, and asserts: zero create operations, a refused decision listing the undecided suggestion, and `renderIntakeFileOutput` returning `exitCode` 1 with stdout naming that suggestion.
- The same test asserts that an interactive filing with advisory-only overlaps makes zero prompt calls and that its rendered stdout contains an `[intake-file] overlap: advisory` line naming each advisory branch and its shared paths.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-prompt.test.ts`

**Dependencies:** 6

### Task 9: Non-interactive filings with undecided suggestions are refused before creation
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-refusal.test.ts` through `fileIntakeIssue` with the fake runner.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`, return `refused` when `interactive` is false and any shown linkable suggestion is neither pre-accepted nor declined. Suggestions omitted by the cap are never undecided. `fileIntakeIssue` then returns without running the creation transaction, with `ok: false`, empty `issueUrl`, and `overlap` carrying the undecided suggestions and their shared paths. Engine-internal callers (`src/conductor/src/engine/conductor.ts` deferral and beyond filings) pass no `overlap` dependency and are unchanged (D6 amendment).
4. Verify GREEN.
5. Commit: "feat(intake): refuse undecided overlaps on non-interactive filings".

**Done when:**
- The `intake-overlap-refusal` Vitest test asserts a non-interactive filing with undecided #1579 sharing `src/review/rubric.ts` returns `ok: false`, an empty `issueUrl`, and an `overlap` refused decision naming #1579 with that shared path.
- The same test asserts the refused filing recorded zero `issue.create`, `issue.label.add` and `issue.dependency.add` operations on the fake runner.
- The same test asserts that a non-interactive filing with only advisory overlaps records an `issue.create` operation and renders stdout containing an `[intake-file] overlap: advisory` line for each advisory branch with its shared paths.
- The same test asserts that eight suggestions with all five shown ones declined return a proceed decision and record an `issue.create` operation.
- A test asserts that `fileIntakeIssue` called with no `overlap` dependency, as the `conductor.ts` deferral and beyond filings call it, performs no overlap read even when a fixture open issue shares a cited path, and records the create operation exactly as before.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/src/engine/engineer/intake/file-issue.ts`
- `src/conductor/test/engine/intake-overlap-refusal.test.ts`

**Dependencies:** 6, 19

### Task 10: Non-interactive re-runs complete once every suggestion is decided
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-rerun.test.ts` that simulates a refusal followed by re-runs with decline inputs.
2. Verify RED.
3. Add a `declineOverlap` option to `FileIntakeIssueOpts` in `src/conductor/src/engine/engineer/intake/file-issue.ts` and honor it in `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`. A declined suggestion is decided and never linked. Each run re-reads the sources, so a suggestion that appears between runs is undecided on the re-run.
4. Verify GREEN.
5. Commit: "feat(intake): accept explicit overlap declines on re-run".

**Done when:**
- The `intake-overlap-rerun` Vitest test asserts that a re-run naming #1579 as a dependency and declining #1487 records one `issue.create` and a dependency operation for #1579 only, with #1487 in the declined list.
- The same test asserts that a re-run declining the only suggestion #1487 records one `issue.create` and zero dependency operations.
- The same test asserts that a re-run deciding only #1579 of #1579 and #1487 records zero create operations and returns a refused decision listing only #1487.
- The same test asserts that when the fixture gains #1600 between runs, a re-run deciding #1579 and #1487 records zero create operations and returns a refused decision listing #1600.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/file-issue.ts`
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-rerun.test.ts`

**Dependencies:** 9

### Task 11: Declined suggestions are reported without changing the filed body or link-failure reporting
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-declines-output.test.ts` that files through `fileIntakeIssue` with the fake runner and renders with `renderIntakeFileOutput`.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/intake/overlap-preflight.ts` and `src/conductor/src/engine/engineer/intake/filing-output.ts`, carry declined and accepted refs through to the rendered lines. Keep the created body as the sanitized authored body; declines never touch it. Accepted refs join the same dependency list as up-front refs, so a link failure surfaces through the existing `metadataFailures` and warnings path.
4. Verify GREEN.
5. Commit: "feat(intake): report overlap decisions in filer output".

**Done when:**
- The `intake-overlap-declines-output` Vitest test asserts that a completed filing with #1487 declined and #1579 accepted renders stdout containing `[intake-file] overlap: declined jstoup111/demo#1487` and `[intake-file] overlap: linked jstoup111/demo#1579`.
- The same test asserts that a filing in which every suggestion was declined and no dependency was named renders a declined line per issue plus `[intake-file] dependencies: none`.
- The same test asserts the `issue.create` payload body of a filing that declined #1487 equals the payload body of the same filing run with no `overlap` dependency.
- The same test asserts that when the fake runner fails the dependency operation for accepted #1579, the result carries the same `metadataFailures` entry and warning text as a filing that named #1579 up front and hit the same failure.
- The same test asserts that a filing with eight suggestions and five shown renders stdout containing `[intake-file] overlap: 3 more suggestion(s) omitted`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/src/engine/engineer/intake/filing-output.ts`
- `src/conductor/test/engine/intake-overlap-declines-output.test.ts`

**Dependencies:** 10

### Task 12: Declines that name no current suggestion are rejected before creation
**Story:** 13
**Type:** negative-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-invalid-decline.test.ts`.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`, parse every `declineOverlap` value with `parseSourceRef`. A malformed value, or a well-formed ref that is not a current linkable suggestion (shown or omitted), returns `invalid-decline` naming each offending value. `fileIntakeIssue` then runs no creation transaction.
4. Verify GREEN.
5. Commit: "feat(intake): reject declines of unsuggested issues".

**Done when:**
- The `intake-overlap-invalid-decline` Vitest test asserts that declining #1579 while #1579 is suggested returns a proceed decision listing #1579 as declined.
- The same test asserts that declining #1597 while only #1579 is suggested returns an `invalid-decline` decision naming `#1597` and records zero `issue.create` operations. `renderIntakeFileOutput` returns `exitCode` 1 with stdout naming `#1597` as not a current suggestion.
- The same test asserts that a decline value `not-a-ref` returns an `invalid-decline` decision naming `not-a-ref` and records zero `issue.create` operations. `renderIntakeFileOutput` returns `exitCode` 1 with stdout naming `not-a-ref`.
- The same test asserts that with only an advisory overlap present, declining an unrelated number returns an `invalid-decline` decision naming it, with zero `issue.create` operations recorded.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-invalid-decline.test.ts`

**Dependencies:** 10

### Task 13: Failures and bounds inside the check degrade to skip notes, never to a refusal
**Story:** 14
**Type:** negative-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-degraded.test.ts` composing the real source collectors with failing fakes.
2. Verify RED.
3. Implement `collectOverlaps({ sources })` in `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`, which runs the open-issue and in-flight collectors independently. A thrown or failed open-issue read becomes the skip note `open-issues` with its reason. An unresolvable base ref (`resolveBase` plus `rev-parse --verify`) becomes `in-flight` with its reason. Hitting the 500-issue or 100-branch bound adds a `partial` skip note naming the bound. Skip notes never produce a refusal; refusal comes only from undecided linkable suggestions actually found (condition C3).
4. Verify GREEN.
5. Commit: "feat(intake): degrade overlap-check failures to skip notes".

**Done when:**
- The `intake-overlap-degraded` Vitest test asserts that a throwing open-issue lister with no other overlaps yields a non-interactive filing that records `issue.create`, returns a proceed decision whose skip notes include `open-issues` with the thrown reason, and renders stdout containing `[intake-file] overlap: skipped open-issues` with that reason.
- The same test asserts that a lister returning exactly 500 issues and a fixture with 101 unmerged branches produce `partial` skip notes naming the 500-issue and 100-branch bounds, that only 100 branches were diffed, and that the filing proceeds.
- The same test asserts that a lister returning 501 open issues with no other overlaps produces a `partial` `open-issues` skip note naming the 500-issue bound, that only 500 issues were compared, and that the filing proceeds.
- The same test asserts that a timed-out open-issue read plus an undecided branch suggestion traced to #1477 returns a refused decision listing only #1477 and renders stdout naming the skipped `open-issues` comparison.
- The same test asserts that an unresolvable base ref yields skip note `in-flight` while the open-issue lister is still called once.
- The same test asserts that when every collector fails, a non-interactive filing records the same create, label and dependency operations as a filing with no `overlap` dependency, and renders stdout naming both skipped parts, `open-issues` and `in-flight`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-degraded.test.ts`

**Dependencies:** 3, 5, 9

### Task 14: The in-flight comparison resolves the target repository's own checkout
**Story:** 15
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-target-checkout.test.ts` with temp git repositories whose `origin` URLs are set, and a registry file selected through `AI_CONDUCTOR_REGISTRY`.
2. Verify RED.
3. Implement `resolveTargetCheckout({ cwd, repository, registryReader, originOf })` in `src/conductor/src/engine/engineer/intake/target-checkout.ts` (D3, amended). Step 1: `cwd` when it is a git checkout whose `origin` resolves to `repository`. Step 2: otherwise the single registry record (via `createRegistryReader`, which honors `AI_CONDUCTOR_REGISTRY`) whose `remote` resolves to `repository`. Otherwise it returns `{ kind: 'none', reason }` naming `no-match` or `ambiguous`. Comparison lowercases `owner/repo` parsed from HTTPS or SSH remotes.
4. Verify GREEN.
5. Commit: "feat(intake): resolve the target repository checkout for overlap scans".

**Done when:**
- The `intake-target-checkout` Vitest test asserts `resolveTargetCheckout` returns the invoking directory when its `origin` is `git@github.com:acme/widgets.git` and the target is `acme/widgets`.
- The same test asserts that from an unrelated directory with exactly one registry record whose remote is `https://github.com/acme/widgets` it returns that record's path.
- The same test asserts that with no matching invoking directory and no matching record it returns `none` with reason `no-match`, and with two matching records it returns `none` with reason `ambiguous`.
- The same test asserts that an invoking directory whose `origin` is `acme/other` is not returned for target `acme/widgets`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/target-checkout.ts`
- `src/conductor/test/engine/intake-target-checkout.test.ts`

**Dependencies:** none

### Task 15: Each overlap check emits one event on the existing spine
**Story:** 16
**Type:** infrastructure

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-event.test.ts` subscribing to a `ConductorEventEmitter`.
2. Verify RED.
3. Add the `intake_overlap_checked` variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts` with fields `repository`, `outcome` (`proceeded`, `refused` or `invalid-decline`), `suggested`, `accepted`, `declined`, `undecided`, `advisoryCount` and `skipped` (part plus reason). Declare its `EVENT_SINKS` row in `src/conductor/src/engine/event-sinks.ts` as `{ render: false, persist: true, audit: false, otel: false }`, following the `intake_inbound_sanitized` row. `runOverlapPreflight` emits exactly one event per call through an injected emitter. The check writes nothing else.
4. Verify GREEN.
5. Commit: "feat(intake): emit an overlap-check event per filing".

**Done when:**
- The `intake-overlap-event` Vitest test asserts one accepted and one declined suggestion produce exactly one `intake_overlap_checked` event with outcome `proceeded`, `suggested` holding exactly those 2 refs, `accepted` holding the accepted ref, `declined` holding the declined ref, and an empty `skipped`.
- The same test asserts that a refused filing emits one event with outcome `refused` and `undecided` listing the undecided refs.
- The same test asserts that a skipped open-issue comparison appears in the event's `skipped` with part `open-issues` and its reason.
- The same test asserts that a no-overlap filing emits exactly one event with an empty `suggested` list, and that the check performs no filesystem write (asserted with a spied `node:fs` write surface).
- The same test asserts that the no-overlap filing's overlap check writes no separate log: no log-file append or write stream is opened (spied `node:fs` `appendFile*` and `createWriteStream`), so the single `intake_overlap_checked` event is its only record.
- The existing event-sink exhaustiveness test passes with the new `intake_overlap_checked` row declared.

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-event.test.ts`

**Dependencies:** 6

### Task 16: The DECIDE-time overlap scan keeps its spec-only branch set
**Story:** 17
**Type:** negative-path

**Steps:**
1. Write failing (pinning) Vitest test `src/conductor/test/engine/overlap-scan-branch-set.test.ts` against a fixture repository containing an overlapping unmerged `spec/x` and an overlapping unmerged `feat/daemon-y`.
2. Verify the test pins current behavior. It is expected to pass against the default and fail if the default pattern gains daemon branches.
3. No production change: Task 4 kept the default. If the pin fails, restore the default pattern pair.
4. Commit: "test(overlap-scan): pin the DECIDE-time spec-only branch set".

**Done when:**
- The `overlap-scan-branch-set` Vitest test asserts `runOverlapScan` over the fixture reports a seam overlap for `spec/x` and no seam overlap for `feat/daemon-y`.
- The same test asserts `enumerateUnmergedBranches(git, base)` called without a pattern argument returns `spec/x` and not `feat/daemon-y`.

**Files likely touched:**
- `src/conductor/test/engine/overlap-scan-branch-set.test.ts`

**Dependencies:** 4

### Task 17: Engine-internal filings keep filing without the overlap gate
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-engine-callers.test.ts` that reads the call sites of `fileIntakeIssue` under `src/conductor/src/engine/` with the TypeScript compiler API and inspects each deps object literal.
2. Verify RED only if a call site supplies `overlap`. This task pins the D6 amendment; with the current callers it is expected to pass.
3. No production change unless a caller supplies `overlap`, in which case remove it.
4. Commit: "test(intake): pin engine-internal filings outside the overlap gate".

**Done when:**
- The `intake-overlap-engine-callers` Vitest test parses every `fileIntakeIssue` call in `src/conductor/src/engine/` and asserts none of their deps objects has an `overlap` property, while `src/conductor/src/intake-file-cli.ts` is the only caller that supplies one.
- The same test asserts the parsed call set includes the `conductor.ts` deferral and beyond filing calls (at least two engine call sites found), so an empty scan cannot pass.

**Files likely touched:**
- `src/conductor/test/engine/intake-overlap-engine-callers.test.ts`

**Dependencies:** 18

### Task 18: The intake filer CLI wires the overlap check end to end
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-file-cli-overlap.test.ts`. Spawn `src/conductor/src/intake-file-cli.ts` through `tsx` from a temp git repository whose `origin` is the target repo, with a stub `gh` first on `PATH` that answers `repo view`, `issue list`, `issue view`, `api` and `issue create` from fixtures and logs every argv. Follow the existing spawn pattern in `src/conductor/test/acceptance/intake-file-completeness.test.ts` (search hint: stub `gh` on `PATH`).
2. Verify RED.
3. In `src/conductor/src/intake-file-cli.ts`, parse the repeatable `--decline-overlap owner/repo#N` into `declineOverlap`. Build `overlap` with `buildOverlapSources` (Task 21) from the process working directory; the #742 helper runs the CLI in the caller's directory. Pass it into `fileIntakeIssue` with the existing `readline` prompt and the existing emitter. Replace the inline print block with printing `renderIntakeFileOutput(result)` stdout and stderr verbatim and setting `process.exitCode` to its `exitCode`.
4. Verify GREEN.
5. Commit: "feat(intake-file): surface overlap suggestions at filing time".

**Done when:**
- The `intake-file-cli-overlap` Vitest test spawns the CLI non-interactively with an intake citing a path that stub open issue #1579 cites, and asserts exit code 1, stdout naming #1579 and the shared path plus both `--depends-on` and `--decline-overlap` re-run options, and no `issue create` argv in the stub log.
- The same test re-runs with `--decline-overlap <target>#1579` and asserts exit code 0, one `issue create` argv in the stub log, and stdout containing `overlap: declined`.
- The same test runs a no-overlap intake and asserts exit code 0 and stdout containing `overlap check: no overlap` and `dependencies: none`.
- The same test asserts the in-flight comparison ran against the temp repository (its `feat/daemon-*` fixture branch is reported) and never against the harness checkout's branches.

**Files likely touched:**
- `src/conductor/src/intake-file-cli.ts`
- `src/conductor/test/engine/intake-file-cli-overlap.test.ts`

**Dependencies:** 3, 5, 8, 11, 12, 13, 14, 15, 20, 21

### Task 19: Suggestions are ranked by shared paths and capped at five
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing cases in `src/conductor/test/engine/intake-overlap-ranking.test.ts`.
2. Verify RED.
3. In `src/conductor/src/engine/engineer/intake/overlap-suggestions.ts`, sort `buildSuggestions` output by shared-path count descending, then issue number ascending. Keep the first `cap` (default 5) as `shown` and report the rest as `omittedCount`.
4. Verify GREEN.
5. Commit: "feat(intake): rank and cap overlap suggestions".

**Done when:**
- The `intake-overlap-ranking` Vitest test asserts suggestions sharing 3, 1 and 2 paths are shown in the order 3, 2, 1, and that eight suggestions yield as `shown` exactly the five with the highest shared-path counts, with `omittedCount` 3.
- The same test asserts two suggestions with equal counts are ordered lower issue number first and that two calls over the same input return identical order.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-suggestions.ts`
- `src/conductor/test/engine/intake-overlap-ranking.test.ts`

**Dependencies:** 2

### Task 20: Cited paths are filtered by the target checkout before any comparison
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-known-paths.test.ts` against a fixture git repository in a temp directory, using `collectOverlaps` with a fake open-issue lister.
2. Verify RED.
3. In `collectOverlaps` (`src/conductor/src/engine/engineer/intake/overlap-preflight.ts`), when a target checkout is available, build the known-path set as the base ref tree (`git ls-tree -r --name-only <base>`) plus every compared branch's changed paths. Pass it to `extractCitedPaths` for the intake and for each open-issue body (D1). Without a checkout, pass no set.
4. Verify GREEN.
5. Commit: "feat(intake): filter cited paths by the target checkout".

**Done when:**
- The `intake-overlap-known-paths` Vitest test asserts that for an intake whose only token is `lib/gone.rb`, absent from the fixture base tree and every branch diff, with an open issue also citing `lib/gone.rb`, `collectOverlaps` recognizes an empty cited-path list and returns zero suggestions.
- The same test asserts that with both `helper.ts` and `helperx.ts` present in the fixture base tree, an intake citing `helper.ts` and an open issue citing `helperx.ts` produce no issue overlap and zero suggestions.
- The same test asserts that `fileIntakeIssue` filings with a path-free body, through the real `collectOverlaps`, see an empty cited-path list and zero suggestions, make zero prompt calls in both interactive and non-interactive mode, and record an `issue.create` operation.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-known-paths.test.ts`

**Dependencies:** 13

### Task 21: The in-flight comparison runs only against the resolved target checkout
**Story:** 15
**Type:** negative-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/engine/intake-overlap-sources-factory.test.ts` with temp git repositories whose `origin` URLs are set, each carrying one overlapping `feat/daemon-*` fixture branch, and a registry selected through `AI_CONDUCTOR_REGISTRY`. The test's git runner records every working directory it is asked to use.
2. Verify RED.
3. Implement `buildOverlapSources({ cwd, repository, gh, registryReader, makeGit })` in `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`. It calls `resolveTargetCheckout` (Task 14) and builds the in-flight collector over `makeGit(<resolved path>)` only. When resolution returns `none`, it skips the in-flight collector with skip note `in-flight` and the `no-match` or `ambiguous` reason. The CLI uses this factory (Task 18).
4. Verify GREEN.
5. Commit: "feat(intake): scope in-flight overlap to the target checkout".

**Done when:**
- The `intake-overlap-sources-factory` Vitest test asserts that invoked from a checkout whose `origin` is `acme/widgets`, `collectOverlaps` over `buildOverlapSources` reports that checkout's `feat/daemon-w` fixture branch.
- The same test asserts that from an unrelated directory with exactly one registry record for `acme/widgets`, the reported branch is the registered checkout's `feat/daemon-r` fixture branch.
- The same test asserts that with no matching directory or record, the result's skip notes include `in-flight` with reason `no-match`, no branch is diffed or reported, and the recording git runner received no working directory other than the test's temp directories.
- The same test asserts that with two registry records for `acme/widgets`, the skip notes include `in-flight` with reason `ambiguous` and no branch is diffed or reported.
- The same test asserts that invoked from a checkout whose `origin` is `acme/other` with target `acme/widgets`, none of that checkout's branches (including `feat/daemon-o`) is diffed or reported, and its path never reaches the git runner.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/overlap-preflight.ts`
- `src/conductor/test/engine/intake-overlap-sources-factory.test.ts`

**Dependencies:** 13, 14

## Task Dependency Graph

```text
Task 1 ──┐
Task 2 ──┼─> Task 3 ─────────────────────────────┐
         ├─> Task 4 ─> Task 5 ───────────────────┤
         │            Task 4 ─> Task 16          │
         ├─> Task 19 ─> Task 9                 │
         └─> Task 6 ─┬─> Task 7                  │
                     ├─> Task 8 ─────────────────┤
                     ├─> Task 9 ─> Task 10 ─┬─> Task 11 ─┤
                     │                      └─> Task 12 ─┤
                     ├─> Task 15 ───────────────┤
   Tasks 3, 5, 9 ─> Task 13 ───────────────────┤
   Task 13 ─> Task 20 ──────────────────────────┤
   Tasks 13, 14 ─> Task 21 ─────────────────────┤
Task 14 ─────────────────────────────────────────┴─> Task 18 ─> Task 17
```

## Integration Points

- After Task 6: `fileIntakeIssue` runs the gate. Every later gate behavior is testable through it with the fake runner.
- After Task 18: the real CLI files, refuses and re-runs end to end against a stub `gh` and a temp target checkout.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** an intake body citing `src/engine/foo.ts:41` inline, **When** the overlap check runs, **Then** `src/engine/foo.ts` is among the recognized cited paths with the line suffix removed | 1 | "The `intake-cited-paths` Vitest test asserts `extractCitedPaths` returns `src/engine/foo.ts` for a body citing `src/engine/foo.ts:41` and returns both `bin/tool` and `docs/guide.md` for title `bin/tool` plus body `./docs/guide.md#L10` when no known-path set is supplied." | diff-local |
| Story 1 happy: **Given** no target checkout is available and an intake title citing `bin/tool` and a body citing `./docs/guide.md#L10`, **When** the overlap check runs, **Then** both `bin/tool` and `docs/guide.md` are recognized cited paths | 1 | "The `intake-cited-paths` Vitest test asserts `extractCitedPaths` returns `src/engine/foo.ts` for a body citing `src/engine/foo.ts:41` and returns both `bin/tool` and `docs/guide.md` for title `bin/tool` plus body `./docs/guide.md#L10` when no known-path set is supplied." | diff-local |
| Story 1 happy: **Given** a target checkout in which `src/engine/foo.ts` exists, **When** the body also contains the prose token `and/or` and the URL `https://github.com/o/r/pull/5`, **Then** only `src/engine/foo.ts` is recognized and neither the prose token nor the URL is treated as a cited path | 1 | "The same test asserts that with a known-path set containing only `src/engine/foo.ts`, a body that also holds `and/or` and `https://github.com/o/r/pull/5` yields exactly `["src/engine/foo.ts"]`." | diff-local |
| Story 1 negative: **Given** an intake body whose only path-shaped token is `lib/gone.rb` and the target checkout has no such file at the base ref or in any scanned branch diff, **When** the overlap check runs, **Then** no cited paths are recognized and no suggestion is produced | 20 | "The `intake-overlap-known-paths` Vitest test asserts that for an intake whose only token is `lib/gone.rb`, absent from the fixture base tree and every branch diff, with an open issue also citing `lib/gone.rb`, `collectOverlaps` recognizes an empty cited-path list and returns zero suggestions." | diff-local |
| Story 1 negative: **Given** an intake body that cites `helper.ts` while an open issue cites `helperx.ts`, **When** the overlap check runs, **Then** no suggestion is produced because paths match only on exact equality after normalization | 20 | "The same test asserts that with both `helper.ts` and `helperx.ts` present in the fixture base tree, an intake citing `helper.ts` and an open issue citing `helperx.ts` produce no issue overlap and zero suggestions." | diff-local |
| Story 1 negative: **Given** an intake body that cites no path-shaped token at all, **When** the overlap check runs, **Then** it finds zero cited paths and the filing proceeds with no suggestion and no prompt | 20 | "The same test asserts that `fileIntakeIssue` filings with a path-free body, through the real `collectOverlaps`, see an empty cited-path list and zero suggestions, make zero prompt calls in both interactive and non-interactive mode, and record an `issue.create` operation." | diff-local |
| Story 2 happy: **Given** open issue #1579 citing `src/review/rubric.ts` and a new intake citing `src/review/rubric.ts`, **When** the overlap check runs, **Then** #1579 is suggested with shared path `src/review/rubric.ts` | 3 | "The same test asserts a fixture open issue #1579 citing `src/review/rubric.ts` yields an overlap for #1579 with shared paths `["src/review/rubric.ts"]`, and an issue #1487 citing two of the intake's three paths yields exactly those two shared paths." | diff-local |
| Story 2 happy: **Given** open issue #1487 citing two of the three paths the new intake cites, **When** the overlap check runs, **Then** #1487 is suggested listing exactly those two shared paths | 3 | "The same test asserts a fixture open issue #1579 citing `src/review/rubric.ts` yields an overlap for #1579 with shared paths `["src/review/rubric.ts"]`, and an issue #1487 citing two of the intake's three paths yields exactly those two shared paths." | diff-local |
| Story 2 negative: **Given** a **closed** issue citing the same path as the new intake, **When** the overlap check runs, **Then** the closed issue is not suggested | 3 | "Because the list call names only the filing repository and requests `--state open`, a closed issue or another repository's issue never reaches the result; the test asserts the fixture runner is queried with exactly that repository and state." | diff-local |
| Story 2 negative: **Given** an open issue in a different repository citing the same path, **When** filing targets this repository, **Then** that issue is not suggested | 3 | "Because the list call names only the filing repository and requests `--state open`, a closed issue or another repository's issue never reaches the result; the test asserts the fixture runner is queried with exactly that repository and state." | diff-local |
| Story 2 negative: **Given** open issues whose cited paths share no path with the new intake, **When** the overlap check runs, **Then** none of them is suggested | 3 | "The same test asserts that open issues sharing no cited path yield no overlap and that no returned overlap carries an issue body." | diff-local |
| Story 3 happy: **Given** an unmerged `feat/daemon-«slug»` branch whose diff since its merge base changes `src/halt/markers.ts`, **When** a new intake citing `src/halt/markers.ts` is filed, **Then** that branch is reported as an overlap with shared path `src/halt/markers.ts` | 4 | "The `intake-overlap-branches` Vitest test asserts `collectInFlightOverlaps` reports `feat/daemon-a` with shared path `src/halt/markers.ts`, the local unmerged `spec/b` with its shared path, and the remote-tracking `origin/spec/b2` with its shared path." | diff-local |
| Story 3 happy: **Given** an unmerged `spec/«slug»` branch (local or remote-tracking) whose diff changes a cited path, **When** the overlap check runs, **Then** that branch is reported as an overlap with the shared path | 4 | "The `intake-overlap-branches` Vitest test asserts `collectInFlightOverlaps` reports `feat/daemon-a` with shared path `src/halt/markers.ts`, the local unmerged `spec/b` with its shared path, and the remote-tracking `origin/spec/b2` with its shared path." | diff-local |
| Story 3 negative: **Given** a `feat/daemon-«slug»` branch with zero commits ahead of the base ref, **When** the overlap check runs, **Then** it is not reported even if its tree contains the cited path | 4 | "The same test asserts `feat/daemon-c` (zero commits ahead) and `fix/d` are absent from the result." | diff-local |
| Story 3 negative: **Given** a branch outside the spec and daemon conventions (for example `fix/«name»`) that changes a cited path, **When** the overlap check runs, **Then** it is not reported | 4 | "The same test asserts `feat/daemon-c` (zero commits ahead) and `fix/d` are absent from the result." | diff-local |
| Story 3 negative: **Given** a branch that has no merge base with the base ref, **When** the overlap check runs, **Then** that branch is skipped with a skip note naming it and the remaining branches are still compared | 4 | "The same test asserts the no-merge-base branch is absent from the overlaps and named in a skip note, while `feat/daemon-a` is still reported." | diff-local |
| Story 3 negative: **Given** a squash-merged `feat/daemon-«slug»` branch that still has commits ahead of the base ref and whose shipped record for «slug» exists on the base ref, **When** the overlap check runs, **Then** that branch is not reported and does not count toward the branch bound | 4 | "The same test asserts the squash-merged `feat/daemon-e`, which has commits ahead and `.docs/shipped/e.md` on base, is absent from the overlaps and is not counted against `maxBranches`." | diff-local |
| Story 4 happy: **Given** an overlapping `feat/daemon-«slug»` branch whose own `.docs/intake/«slug».md` on that branch carries `Source-Ref: owner/repo#1477` for an open issue in the target repository, **When** the overlap check runs, **Then** #1477 is offered as a linkable suggestion with the branch's shared paths | 5 | "The `intake-overlap-tracing` Vitest test asserts an overlapping `feat/daemon-«slug»` branch whose own `.docs/intake/<slug>.md` carries `Source-Ref: owner/repo#1477` for an open same-repo issue is traced to `owner/repo#1477`, and `buildSuggestions` places #1477 in `shown` as a linkable suggestion carrying that branch's shared paths." | diff-local |
| Story 4 happy: **Given** an overlapping branch whose tree has no `.docs/intake/«slug».md` for its own slug, **When** the overlap check runs, **Then** the overlap is shown as advisory naming the branch and shared paths and it requires no decision | 5 | "The same test asserts that `fileIntakeIssue` filings whose only overlaps are a marker-less branch and an unparseable-Source-Ref branch record an `issue.create` operation and a proceed decision with zero prompt calls in both interactive and non-interactive mode, and render stdout containing an `[intake-file] overlap: advisory` line naming each branch and its shared paths." | diff-local |
| Story 4 negative: **Given** an overlapping branch whose intake marker has an unparseable Source-Ref line, **When** the overlap check runs, **Then** the overlap is advisory only and the filing is not refused on its account | 5 | "The same test asserts that `fileIntakeIssue` filings whose only overlaps are a marker-less branch and an unparseable-Source-Ref branch record an `issue.create` operation and a proceed decision with zero prompt calls in both interactive and non-interactive mode, and render stdout containing an `[intake-file] overlap: advisory` line naming each branch and its shared paths." | diff-local |
| Story 4 negative: **Given** an overlapping branch whose Source-Ref names a closed issue, **When** the overlap check runs, **Then** the overlap is advisory only and no link is offered | 5 | "The same test asserts that a branch with no marker for its own slug, a branch with an unparseable Source-Ref, a branch whose ref names a closed issue, and a branch whose ref names another repository each yield a branch overlap with a null traced issue." | diff-local |
| Story 4 negative: **Given** an overlapping branch whose Source-Ref names an issue in a different repository than the filing target, **When** the overlap check runs, **Then** the overlap is advisory only and no link is offered | 5 | "The same test asserts that a branch with no marker for its own slug, a branch with an unparseable Source-Ref, a branch whose ref names a closed issue, and a branch whose ref names another repository each yield a branch overlap with a null traced issue." | diff-local |
| Story 5 happy: **Given** issue #1487 is both an open-issue overlap on `a.ts` and the traced issue of an in-flight branch overlapping on `b.ts`, **When** suggestions are shown, **Then** #1487 appears exactly once listing shared paths `a.ts` and `b.ts` | 2 | "The `intake-overlap-suggestions` Vitest test asserts that an issue overlap for #1487 on `a.ts` plus a branch overlap traced to #1487 on `b.ts` produce exactly one shown suggestion for #1487 with shared paths `["a.ts", "b.ts"]`." | diff-local |
| Story 5 negative: **Given** the same issue reached by two routes that share the same path, **When** suggestions are shown, **Then** that path is listed once for that issue and not duplicated | 2 | "The same test asserts that two routes naming #1487 with the same path `a.ts` produce one suggestion listing `a.ts` exactly once." | diff-local |
| Story 6 happy: **Given** three linkable suggestions sharing 3, 1 and 2 paths respectively, **When** they are shown, **Then** they appear in order of 3, 2, 1 shared paths | 19 | "The `intake-overlap-ranking` Vitest test asserts suggestions sharing 3, 1 and 2 paths are shown in the order 3, 2, 1, and that eight suggestions yield as `shown` exactly the five with the highest shared-path counts, with `omittedCount` 3." | diff-local |
| Story 6 happy: **Given** eight linkable suggestions, **When** they are shown, **Then** the top five by shared-path count are shown and the output states that 3 more were omitted | 19, 11 | "The `intake-overlap-ranking` Vitest test asserts suggestions sharing 3, 1 and 2 paths are shown in the order 3, 2, 1, and that eight suggestions yield as `shown` exactly the five with the highest shared-path counts, with `omittedCount` 3." | diff-local |
| Story 6 negative: **Given** eight linkable suggestions where three are omitted by the cap, **When** a non-interactive filer has decided all five shown suggestions, **Then** the issue is created and the omitted three do not cause a refusal | 9 | "The same test asserts that eight suggestions with all five shown ones declined return a proceed decision and record an `issue.create` operation." | diff-local |
| Story 6 negative: **Given** two suggestions with equal shared-path counts, **When** they are shown, **Then** their order is deterministic across repeated runs (lower issue number first) | 19 | "The same test asserts two suggestions with equal counts are ordered lower issue number first and that two calls over the same input return identical order." | diff-local |
| Story 7 happy: **Given** a filing that already names `owner/repo#1579` as a dependency and #1579 overlaps, **When** the overlap check runs, **Then** #1579 is not shown as a suggestion and is linked as a dependency | 7 | "The `intake-overlap-preaccepted` Vitest test asserts a filing naming `owner/repo#1579` while #1579 overlaps records one dependency operation for #1579 and shows no suggestion for it." | diff-local |
| Story 7 negative: **Given** a non-interactive filing whose only overlapping issue is already named as a dependency, **When** the filing runs, **Then** it is not refused and the issue is created | 7 | "The same test asserts a non-interactive filing whose only overlap is the named #1579 returns a proceed decision and records an `issue.create` operation." | diff-local |
| Story 7 negative: **Given** a filing that names #1579 as a dependency while #1487 also overlaps, **When** the filing runs non-interactively, **Then** only #1487 is listed as undecided in the refusal | 7 | "The same test asserts a non-interactive filing naming #1579 while #1487 also overlaps returns a refused decision whose undecided list is exactly `[#1487]`." | diff-local |
| Story 8 happy: **Given** an intake whose cited paths overlap no open issue and no in-flight branch, **When** it is filed interactively, **Then** no overlap prompt appears and the issue, labels and dependency outcome are the same as filing without the check | 6 | "The `intake-overlap-gate` Vitest test asserts a no-overlap filing through `fileIntakeIssue` records the same ordered create, label and dependency operations as the same filing with no `overlap` dependency, in both interactive and non-interactive mode, and never calls the prompt for overlap." | diff-local |
| Story 8 happy: **Given** the same no-overlap intake filed non-interactively, **When** the filing runs, **Then** it exits successfully and the output differs from today's by at most one line confirming the overlap check ran | 6 | "The same test asserts that for a non-interactive no-overlap filing, `renderIntakeFileOutput` returns `exitCode` 0 and a stdout equal to the no-`overlap`-dependency run's stdout plus exactly one line, `[intake-file] overlap check: no overlap`." | diff-local |
| Story 8 negative: **Given** a no-overlap intake filed with no dependencies named, **When** the filing completes, **Then** the output still reports the explicit "dependencies: none" decision | 6 | "The same test asserts that a no-overlap filing naming no dependency renders stdout containing `[intake-file] dependencies: none`." | diff-local |
| Story 8 negative: **Given** a no-overlap intake, **When** the filing runs non-interactively, **Then** no additional input is required and the exit status is 0 | 6, 18 | "The same test asserts a no-overlap non-interactive filing needs no decline input and returns a proceed decision with no refusal." | diff-local |
| Story 9 happy: **Given** an interactive filing with suggestions #1579 and #1487, **When** the operator accepts #1579 and declines #1487, **Then** the issue is created with #1579 linked as a dependency and #1487 reported as declined | 8 | "The `intake-overlap-prompt` Vitest test asserts that scripted answers accepting #1579 and declining #1487 produce one `issue.create` operation, one dependency operation for #1579 and none for #1487, with the result naming #1487 as declined." | diff-local |
| Story 9 happy: **Given** an interactive filing with one suggestion, **When** the operator accepts it, **Then** it is linked exactly as a dependency named up front would be | 8 | "The same test asserts that accepting a single suggestion records a dependency operation with the same payload as naming that ref up front." | diff-local |
| Story 9 negative: **Given** an interactive prompt for a suggestion, **When** the operator enters an answer that is neither accept nor decline, **Then** the same suggestion is asked again and nothing is created until a valid answer is given | 8 | "The same test asserts that an answer of `maybe` re-asks the same suggestion, with no create operation recorded until a valid answer follows." | diff-local |
| Story 9 negative: **Given** an interactive prompt, **When** the input stream closes before every suggestion is answered, **Then** no issue is created and the filer exits non-zero listing the undecided suggestions | 8 | "The same test drives a `node:readline/promises` prompt over an input stream that ends after the first of two answers, and asserts: zero create operations, a refused decision listing the undecided suggestion, and `renderIntakeFileOutput` returning `exitCode` 1 with stdout naming that suggestion." | diff-local |
| Story 9 negative: **Given** only advisory (non-linkable) overlaps, **When** filing interactively, **Then** they are shown but the operator is not prompted for them | 8 | "The same test asserts that an interactive filing with advisory-only overlaps makes zero prompt calls and that its rendered stdout contains an `[intake-file] overlap: advisory` line naming each advisory branch and its shared paths." | diff-local |
| Story 10 happy: **Given** a non-interactive filing with undecided linkable suggestion #1579 sharing `src/review/rubric.ts`, **When** the filing runs, **Then** no issue is created, the exit status is non-zero, and the output lists #1579 with `src/review/rubric.ts` and states how to accept it or decline it on a re-run | 9, 18 | "The `intake-overlap-refusal` Vitest test asserts a non-interactive filing with undecided #1579 sharing `src/review/rubric.ts` returns `ok: false`, an empty `issueUrl`, and an `overlap` refused decision naming #1579 with that shared path." | diff-local |
| Story 10 negative: **Given** a refused non-interactive filing, **When** GitHub is inspected afterwards, **Then** no issue, label or dependency link was created by that run | 9 | "The same test asserts the refused filing recorded zero `issue.create`, `issue.label.add` and `issue.dependency.add` operations on the fake runner." | diff-local |
| Story 10 negative: **Given** a non-interactive filing whose only overlaps are advisory, **When** the filing runs, **Then** it is not refused and the issue is created with the advisory overlaps shown | 9 | "The same test asserts that a non-interactive filing with only advisory overlaps records an `issue.create` operation and renders stdout containing an `[intake-file] overlap: advisory` line for each advisory branch with its shared paths." | diff-local |
| Story 10 negative: **Given** the daemon files an engine-internal follow-up issue citing a path that an open issue also cites, **When** that filing runs, **Then** no overlap check runs, it is never refused, and it creates the issue exactly as before this feature | 9 | "A test asserts that `fileIntakeIssue` called with no `overlap` dependency, as the `conductor.ts` deferral and beyond filings call it, performs no overlap read even when a fixture open issue shares a cited path, and records the create operation exactly as before." | diff-local |
| Story 11 happy: **Given** a prior refusal listing #1579 and #1487, **When** the agent re-runs naming #1579 as a dependency and declining #1487, **Then** the issue is created with #1579 linked and #1487 recorded as declined | 10, 18 | "The `intake-overlap-rerun` Vitest test asserts that a re-run naming #1579 as a dependency and declining #1487 records one `issue.create` and a dependency operation for #1579 only, with #1487 in the declined list." | diff-local |
| Story 11 happy: **Given** a prior refusal listing #1487, **When** the agent re-runs declining #1487, **Then** the issue is created with no dependency link | 10 | "The same test asserts that a re-run declining the only suggestion #1487 records one `issue.create` and zero dependency operations." | diff-local |
| Story 11 negative: **Given** a prior refusal listing #1579 and #1487, **When** the agent re-runs deciding only #1579, **Then** the filing is refused again listing only #1487 as undecided | 10 | "The same test asserts that a re-run deciding only #1579 of #1579 and #1487 records zero create operations and returns a refused decision listing only #1487." | diff-local |
| Story 11 negative: **Given** a re-run on which a new overlapping issue #1600 has appeared since the refusal, **When** the agent re-runs deciding only #1579 and #1487, **Then** the filing is refused listing #1600 as undecided | 10 | "The same test asserts that when the fixture gains #1600 between runs, a re-run deciding #1579 and #1487 records zero create operations and returns a refused decision listing #1600." | diff-local |
| Story 12 happy: **Given** a filing in which #1487 was declined and #1579 accepted, **When** the filing completes, **Then** the output names #1487 as declined and #1579 as linked | 11 | "The `intake-overlap-declines-output` Vitest test asserts that a completed filing with #1487 declined and #1579 accepted renders stdout containing `[intake-file] overlap: declined jstoup111/demo#1487` and `[intake-file] overlap: linked jstoup111/demo#1579`." | diff-local |
| Story 12 happy: **Given** a filing in which every suggestion was declined and no dependency was named, **When** the filing completes, **Then** the output names each declined issue and also reports "dependencies: none" | 11 | "The same test asserts that a filing in which every suggestion was declined and no dependency was named renders a declined line per issue plus `[intake-file] dependencies: none`." | diff-local |
| Story 12 negative: **Given** a filing that declined #1487, **When** the created issue body is inspected, **Then** it equals the body the pre-change filer submits for the same input with no declined-overlap text added | 11 | "The same test asserts the `issue.create` payload body of a filing that declined #1487 equals the payload body of the same filing run with no `overlap` dependency." | diff-local |
| Story 12 negative: **Given** an accepted suggestion whose dependency link then fails to record on GitHub, **When** the filing completes, **Then** the link failure is reported exactly as it is for the same dependency named up front | 11 | "The same test asserts that when the fake runner fails the dependency operation for accepted #1579, the result carries the same `metadataFailures` entry and warning text as a filing that named #1579 up front and hit the same failure." | diff-local |
| Story 13 happy: **Given** suggestion #1579, **When** the filer declines #1579, **Then** the decline is accepted as a valid decision | 12 | "The `intake-overlap-invalid-decline` Vitest test asserts that declining #1579 while #1579 is suggested returns a proceed decision listing #1579 as declined." | diff-local |
| Story 13 negative: **Given** suggestions #1579 only, **When** the filer declines #1597, **Then** nothing is created and the filer exits non-zero naming #1597 as not a current suggestion | 12 | "The same test asserts that declining #1597 while only #1579 is suggested returns an `invalid-decline` decision naming `#1597` and records zero `issue.create` operations. `renderIntakeFileOutput` returns `exitCode` 1 with stdout naming `#1597` as not a current suggestion." | diff-local |
| Story 13 negative: **Given** a decline value that is not an `owner/repo#N` reference, **When** the filing runs, **Then** nothing is created and the filer exits non-zero naming the malformed value | 12 | "The same test asserts that a decline value `not-a-ref` returns an `invalid-decline` decision naming `not-a-ref` and records zero `issue.create` operations. `renderIntakeFileOutput` returns `exitCode` 1 with stdout naming `not-a-ref`." | diff-local |
| Story 13 negative: **Given** an advisory-only overlap on a branch with no traced issue, **When** the filer declines a number unrelated to any suggestion, **Then** nothing is created and the invalid decline is named | 12 | "The same test asserts that with only an advisory overlap present, declining an unrelated number returns an `invalid-decline` decision naming it, with zero `issue.create` operations recorded." | diff-local |
| Story 14 happy: **Given** the open-issue read fails, **When** a non-interactive filing runs with no other overlaps, **Then** the issue is created and the output names the skipped open-issue comparison and why | 13 | "The `intake-overlap-degraded` Vitest test asserts that a throwing open-issue lister with no other overlaps yields a non-interactive filing that records `issue.create`, returns a proceed decision whose skip notes include `open-issues` with the thrown reason, and renders stdout containing `[intake-file] overlap: skipped open-issues` with that reason." | diff-local |
| Story 14 happy: **Given** more than 500 open issues or more than 100 unmerged branches, **When** the overlap check runs, **Then** it compares up to the bound, reports the comparison as partial, and filing proceeds | 13 | "The same test asserts that a lister returning exactly 500 issues and a fixture with 101 unmerged branches produce `partial` skip notes naming the 500-issue and 100-branch bounds, that only 100 branches were diffed, and that the filing proceeds." | diff-local |
| Story 14 negative: **Given** the open-issue read times out while an in-flight branch yields undecided linkable suggestion #1477, **When** a non-interactive filing runs, **Then** it is refused for #1477 only and the output also names the skipped open-issue comparison | 13 | "The same test asserts that a timed-out open-issue read plus an undecided branch suggestion traced to #1477 returns a refused decision listing only #1477 and renders stdout naming the skipped `open-issues` comparison." | diff-local |
| Story 14 negative: **Given** the base ref of the target checkout cannot be resolved, **When** the filing runs, **Then** the in-flight comparison is skipped with a note and the open-issue comparison still runs | 13 | "The same test asserts that an unresolvable base ref yields skip note `in-flight` while the open-issue lister is still called once." | diff-local |
| Story 14 negative: **Given** every part of the check fails, **When** a non-interactive filing runs, **Then** the issue is created exactly as today and each skipped part is named in the output | 13 | "The same test asserts that when every collector fails, a non-interactive filing records the same create, label and dependency operations as a filing with no `overlap` dependency, and renders stdout naming both skipped parts, `open-issues` and `in-flight`." | diff-local |
| Story 15 happy: **Given** the filer is invoked from a checkout whose origin is `acme/widgets` and filing targets `acme/widgets`, **When** the overlap check runs, **Then** the in-flight comparison uses that checkout's branches | 21 | "The `intake-overlap-sources-factory` Vitest test asserts that invoked from a checkout whose `origin` is `acme/widgets`, `collectOverlaps` over `buildOverlapSources` reports that checkout's `feat/daemon-w` fixture branch." | diff-local |
| Story 15 happy: **Given** the filer is invoked from an unrelated directory and exactly one registered project's remote resolves to the target `acme/widgets`, **When** the overlap check runs, **Then** the in-flight comparison uses that registered project's checkout | 21 | "The same test asserts that from an unrelated directory with exactly one registry record for `acme/widgets`, the reported branch is the registered checkout's `feat/daemon-r` fixture branch." | diff-local |
| Story 15 negative: **Given** filing targets `acme/widgets` and neither the invoking directory nor any registered project matches it, **When** the overlap check runs, **Then** the in-flight comparison is skipped with a note and the harness's own branches are never compared | 21, 18 | "The same test asserts that with no matching directory or record, the result's skip notes include `in-flight` with reason `no-match`, no branch is diffed or reported, and the recording git runner received no working directory other than the test's temp directories." | diff-local |
| Story 15 negative: **Given** two registered projects whose remotes both resolve to `acme/widgets`, **When** the invoking directory does not match, **Then** the in-flight comparison is skipped with a note naming the ambiguity | 21 | "The same test asserts that with two registry records for `acme/widgets`, the skip notes include `in-flight` with reason `ambiguous` and no branch is diffed or reported." | diff-local |
| Story 15 negative: **Given** the invoking directory is a checkout of a different repository than the filing target, **When** the overlap check runs, **Then** that checkout's branches are not compared | 21 | "The same test asserts that invoked from a checkout whose `origin` is `acme/other` with target `acme/widgets`, none of that checkout's branches (including `feat/daemon-o`) is diffed or reported, and its path never reaches the git runner." | diff-local |
| Story 16 happy: **Given** a filing with two suggestions, one accepted and one declined, **When** the filing completes, **Then** the filer's existing event record holds one overlap-check entry giving the suggestion count, the accepted issue, the declined issue and no skipped parts | 15 | "The `intake-overlap-event` Vitest test asserts one accepted and one declined suggestion produce exactly one `intake_overlap_checked` event with outcome `proceeded`, `suggested` holding exactly those 2 refs, `accepted` holding the accepted ref, `declined` holding the declined ref, and an empty `skipped`." | diff-local |
| Story 16 happy: **Given** a refused non-interactive filing, **When** it exits, **Then** the event record holds an overlap-check entry marking the outcome as refused with the undecided issues | 15 | "The same test asserts that a refused filing emits one event with outcome `refused` and `undecided` listing the undecided refs." | diff-local |
| Story 16 negative: **Given** a filing in which the open-issue comparison was skipped, **When** the filing completes, **Then** the overlap-check entry names the skipped part and its reason | 15 | "The same test asserts that a skipped open-issue comparison appears in the event's `skipped` with part `open-issues` and its reason." | diff-local |
| Story 16 negative: **Given** a no-overlap filing, **When** it completes, **Then** exactly one overlap-check entry is recorded with zero suggestions and the check itself writes no separate file or log | 15 | "The same test asserts that a no-overlap filing emits exactly one event with an empty `suggested` list, and that the check performs no filesystem write (asserted with a spied `node:fs` write surface)." | diff-local |
| Story 17 happy: **Given** a repository with an unmerged spec branch overlapping candidate files, **When** the DECIDE-time overlap scan runs, **Then** it reports that spec branch exactly as before this feature | 16 | "The `overlap-scan-branch-set` Vitest test asserts `runOverlapScan` over the fixture reports a seam overlap for `spec/x` and no seam overlap for `feat/daemon-y`." | diff-local |
| Story 17 negative: **Given** a repository with an unmerged daemon build branch overlapping candidate files, **When** the DECIDE-time overlap scan runs, **Then** the daemon branch is not reported because the scan's branch set stays exactly today's `spec/*` set | 16 | "The same test asserts `enumerateUnmergedBranches(git, base)` called without a pattern argument returns `spec/x` and not `feat/daemon-y`." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
