# Implementation Plan: Intake issues carry an optional declared semver label (#2027)

**Date:** 2026-11-07
**Design:** none (technical track, Tier S; see `.docs/track/intake-carries-no-semver-signal-release-semver-is-.md`)
**Stories:** .docs/stories/intake-carries-no-semver-signal-release-semver-is-.md
**Conflict check:** not required at Tier S

## Summary

Add an optional, never-defaulted semver tier to intake filing. The bundled `intake-file` helper gets `--semver major|minor|patch` with an interactive prompt that Enter skips. The intake issue form gets an optional Semver dropdown that the existing label-sync stamps. Both paths apply one of the repository's existing `semver:major` / `semver:minor` / `semver:patch` labels. The work is 5 tasks.

## Technical Approach

- **Label vocabulary.** The label is exactly `semver:<tier>` with no space after the colon, which matches the repository's existing labels and `SEMVER_LABEL_PREFIX` in `release-metadata-check-action.ts`. The vocabulary is the closed set `major`, `minor`, `patch`. Nothing reads these labels on issues, and the PR-side check only touches pull requests, so the two never interact.
- **No default, no inference.** Size and priority run given ▸ prompt ▸ infer ▸ default. Semver runs given ▸ prompt only. Anything else, including an empty or invalid prompt answer, is `unset`: no label request is made and the CLI prints `[intake-file] semver=unset`. The source set is closed: `given`, `prompted`, or unset (no source).
- **CLI path.** `FileIntakeIssueOpts` gains `semver?: 'major' | 'minor' | 'patch'`. `FileIntakeIssueResult` gains `semver: 'major' | 'minor' | 'patch' | null` and `semverSource: 'given' | 'prompted' | null`. `fileIntakeIssue` resolves semver beside size and priority. When set, it appends one `issue.label.add` request with payload `semver:<tier>` to the post-create metadata list right after the `size:` entry. That reuses the existing creation-scoped guarded runner, which already authorizes `issue.label.add` on the created issue for any label. A failure therefore lands in `metadataFailures` and becomes the same `label-apply failed:` warning, and the loop still runs every other entry. `intake-file-cli.ts` parses `--semver` the way it parses `--priority` (lower-case, closed set, `invalid --semver "<v>" (major|minor|patch)`); argument errors already exit 1 before any GitHub call. `filing-output.ts` prints the semver line after the priority line.
- **Form path.** `.github/ISSUE_TEMPLATE/intake.yml` gains an optional `semver` dropdown labelled `Semver`, which GitHub renders as a `### Semver` heading. `issue-event-sync.ts` `formFields` also extracts `Semver` with the existing `extractField`. `label-sync.ts` `syncIssueLabels` accepts `semver?: string`, keeps it only on an exact match in `major|minor|patch`, and with no default calls `ensureLabel` and then `intake.issue.label.add` for `semver:<tier>` after the size label. Colors match the repository's existing labels: major `b60205`, minor `fbca04`, patch `0e8a16`. `SyncIssueLabelsResult` gains `semverLabel: string | null`. `isIssueFormSubmission` is unchanged, so a hand-authored body is still skipped entirely. Edits stay additive, as for size and priority.
- **Pattern context.** Follow the size/priority handling in the same functions: the argument switch in `intake-file-cli.ts`, the resolution blocks and metadata array in `file-issue.ts`, and the `ensureLabel` + `executeGithubOperation` pair in `label-sync.ts`. Allowed variation: semver has no `infer*` helper and no default constant. Search hint: `priority` in each file.

## Prerequisites

- None.

## Tasks

### Task 1: Resolve and apply a declared semver tier in fileIntakeIssue
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/file-issue.test.ts`, using the existing creation-scoped runner fixture pattern from the "applies size and priority only after a successful canonical creation" test. (a) Given `semver: 'minor'`, the recorded `issue.label.add` requests on the created issue are `priority: <band>`, `size: <S|M|L>`, `semver:minor` in that order, and the result has `semver: 'minor'`, `semverSource: 'given'`. (b) Interactive with a prompt stub answering `patch` gives a `semver:patch` request and `semverSource: 'prompted'`. (c) Interactive with the prompt answering `''` and with it answering `feature` both still create the issue (`ok: true`, issue URL) with no `semver:` label request and `semver: null`, `semverSource: null`. (d) Non-interactive with no `semver` and the body `this is a breaking fix`: no semver prompt is invoked (the stub records zero semver questions), no `semver:` request, `semver: null`. (e) Given `semver: 'minor'` and a runner that fails only the `semver:minor` label add: the result is `ok: true` with the issue URL, `warnings` contains a `label-apply failed:` entry for it, and the `priority:` and `size:` requests were still issued.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/engineer/intake/file-issue.ts`. Add the `semver` option and the `semver`/`semverSource` result fields. Resolve after priority: given ▸ (interactive with prompt: `What semver tier is this? (major/minor/patch, Enter to skip)`, keeping the trimmed lower-cased answer only if it is in the closed set) ▸ otherwise null, with no inference. Push the `semver:<tier>` `issue.label.add` entry right after the size entry only when the tier is set.
4. Verify the tests pass (GREEN).
5. Commit: "intake: resolve and apply an optional declared semver label".

**Done when:**
- [test] A `file-issue.test.ts` test asserts that `fileIntakeIssue` with `semver: 'minor'` issues `issue.label.add` requests for `priority: <band>`, `size: <S|M|L>`, then `semver:minor` on the created issue and returns `semver: 'minor'`, `semverSource: 'given'`.
- [test] A test asserts that an interactive `fileIntakeIssue` whose prompt answers `patch` issues a `semver:patch` label request and returns `semverSource: 'prompted'`, while prompt answers `''` and `feature` each still create the issue (`ok: true` with the issue URL) but issue no `semver:` label request and return `semver: null`, `semverSource: null`.
- [test] A test asserts that a non-interactive `fileIntakeIssue` with no `semver` and body `this is a breaking fix` asks no semver question, issues no `semver:` label request, and returns `semver: null`.
- [test] A test asserts that when only the `semver:minor` label add fails, `fileIntakeIssue` returns `ok: true` with the issue URL and a `label-apply failed:` warning, and the `priority:` and `size:` label requests were still issued.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/file-issue.ts` — semver option, resolution, result fields, label metadata entry
- `src/conductor/test/file-issue.test.ts` — semver resolution and label-request tests

**Dependencies:** none

### Task 2: Accept --semver on the intake-file CLI and report the resolved tier
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/intake-file-cli.test.ts`, following the existing CLI harness that drives `intake-file-cli.ts` with a mocked `gh` boundary. (a) `--semver minor` files an issue whose recorded label adds include `semver:minor`, `priority: <band>`, `size: <S|M|L>`, and stdout contains `[intake-file] semver=minor (given)`. (b) `--semver MAJOR` records a `semver:major` add and stdout contains `[intake-file] semver=major (given)`. (c) A non-interactive run without `--semver` records no `semver:` label add, and stdout contains exactly one `[intake-file] semver=` line, equal to `[intake-file] semver=unset`. (d) `--semver feature` exits 1, stderr contains `invalid --semver "feature" (major|minor|patch)`, and the mocked `gh` saw no issue-create call. (e) `--semver` as the last argument exits 1, stderr contains `missing value for --semver`, and no issue-create call is made. (f) A run missing `--body` exits 1 and the usage line contains `[--semver major|minor|patch]`. (g) A CLI run whose mocked `gh` fails only the `semver:minor` label add exits 0 and stdout contains the `[intake-file] filed:` issue URL. (h) The interactive path cannot run under the spawned non-TTY harness, so drive the composition `main` writes to stdout in-process: pass the result of an interactive `fileIntakeIssue` (prompt stub answering `patch`, and separately `''` and `feature`) straight into `renderIntakeFileOutput`, and assert its `stdout` contains `[intake-file] semver=patch (prompted)` for `patch` and `[intake-file] semver=unset` for the other two answers.
2. Verify the tests fail (RED).
3. Implement: add a `--semver` case to `parseArgs` in `src/conductor/src/intake-file-cli.ts` that mirrors `--priority`'s lower-casing and closed-set validation, add `[--semver major|minor|patch]` to both usage strings, and in `src/conductor/src/engine/engineer/intake/filing-output.ts` push the semver line right after the priority line.
4. Verify the tests pass (GREEN).
5. Commit: "intake-file: accept --semver and report the resolved tier".

**Done when:**
- [test] An `intake-file-cli.test.ts` test runs the CLI with `--semver minor` and asserts the mocked `gh` received a `semver:minor` label add alongside the `priority:` and `size:` adds and stdout contains `[intake-file] semver=minor (given)`; with `--semver MAJOR` it asserts a `semver:major` add.
- [test] A CLI test asserts that a non-interactive run without `--semver` makes no `semver:` label add and prints exactly one `[intake-file] semver=` line, equal to `[intake-file] semver=unset`.
- [test] A CLI test asserts that `--semver feature` exits 1 with `invalid --semver "feature" (major|minor|patch)` and that `--semver` with no value exits 1 with `missing value for --semver`, each with zero issue-create calls on the mocked `gh`, and that the usage text printed when `--body` is missing contains `[--semver major|minor|patch]`.
- [test] A CLI test asserts that when the mocked `gh` fails only the `semver:minor` label add, the CLI exits 0 and stdout contains the `[intake-file] filed:` issue URL.
- [test] A test passes an interactive `fileIntakeIssue` result straight into `renderIntakeFileOutput`, the composition `intake-file-cli.ts` `main` writes to stdout, and asserts stdout contains `[intake-file] semver=patch (prompted)` when the prompt answers `patch` and `[intake-file] semver=unset` when it answers `''` or `feature`.

**Files likely touched:**
- `src/conductor/src/intake-file-cli.ts` — `--semver` parsing and usage text
- `src/conductor/src/engine/engineer/intake/filing-output.ts` — semver output line
- `src/conductor/test/intake-file-cli.test.ts` — CLI and renderer tests

**Dependencies:** Task 1

### Task 3: Stamp the form's Semver field as a semver label in label-sync
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/intake-form-label-sync.test.ts`, extending its form-body helper with an optional Semver section and reusing its mocked `gh`/guarded-operation fixture, through `applyIssueEventSync`. (a) A form body with `### Semver` then `minor` records a `semver:minor` `intake.issue.label.add` alongside the `priority:` and `size:` adds, and the report's `labels.semverLabel` is `semver:minor`. (b) A form body whose Semver section is `_No response_` records no `semver:` add, while the `priority:`/`size:` adds equal what the same body without a Semver section produces. (c) Semver values `Minor` and `breaking` each record no `semver:` add and `semverLabel: null`. (d) A hand-authored body (no `### Priority`/`### Size` headings) that contains `### Semver` then `minor` records no label add and no label removal of any kind. (e) A sync where only the `semver:patch` add fails: the call resolves without throwing, the failure is logged, and the `priority:`/`size:` adds and a declared dependency link were still made. (f) Running the sync twice on the same `minor` body records only `semver:minor` adds and no label removal. (g) Running it on a `minor` body and then on the same body edited to `patch` records `semver:minor` then `semver:patch` adds and no label removal. (h) Through the existing `runActionFixture` process harness for `intake-label-sync-apply.mts`: a form-body event with Semver `minor` exits 0 and its stdout summary names `semver:minor`, and a form-body event with Semver `patch` whose `gh` fails only the `semver:patch` add still exits 0.
2. Verify the tests fail (RED).
3. Implement. `src/conductor/src/engine/engineer/intake/issue-event-sync.ts`: `formFields` also returns `semver: extractField(body, 'Semver')`. `src/conductor/src/engine/engineer/intake/label-sync.ts`: add `semver?: string` to the fields, keep it only on an exact match in `major|minor|patch`, add `semverLabel: string | null` to the result on every return path, and when it is set call `ensureLabel` with the repository color and then `intake.issue.label.add` after the size label inside the existing try. `src/conductor/scripts/intake-label-sync-apply.mts`: append the semver label to the `labels:` summary when it is non-null. Leave `isIssueFormSubmission` unchanged.
4. Verify the tests pass (GREEN).
5. Commit: "intake-label-sync: stamp the form's optional Semver as a semver label".

**Done when:**
- [test] A test asserts that `applyIssueEventSync` on a form body with Semver `minor` issues an `intake.issue.label.add` for `semver:minor` alongside the `priority:` and `size:` adds and reports `labels.semverLabel` as `semver:minor`, and a `runActionFixture` process test asserts the `intake-label-sync-apply.mts` entry point exits 0 with a stdout summary naming `semver:minor` for that event.
- [test] A test asserts that a Semver of `_No response_`, `Minor`, or `breaking` issues no `semver:` label add and reports `semverLabel: null`, and that the blank case's `priority:`/`size:` adds equal those of the same body with no Semver section.
- [test] A test asserts that a hand-authored body with no `### Priority`/`### Size` headings but a `### Semver` `minor` section causes `applyIssueEventSync` to issue no label add and no label removal at all.
- [test] A test asserts that when only the `semver:patch` add fails, `applyIssueEventSync` resolves without throwing, logs the failure, and still issues the `priority:`/`size:` adds and the declared dependency link, and a `runActionFixture` process test asserts the entry point still exits 0 when its `gh` fails only the `semver:patch` add.
- [test] A test asserts that re-running the sync on an unchanged `minor` body issues only `semver:minor` adds, that re-running it after an edit to `patch` issues a `semver:patch` add, and that neither re-run requests any label removal.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/issue-event-sync.ts` — extract the Semver form field
- `src/conductor/src/engine/engineer/intake/label-sync.ts` — semver field, label, result
- `src/conductor/scripts/intake-label-sync-apply.mts` — summary line names the semver label
- `src/conductor/test/acceptance/intake-form-label-sync.test.ts` — form semver tests

**Dependencies:** none

### Task 4: Offer an optional Semver dropdown on the intake issue form
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test in a new file `src/conductor/test/acceptance/intake-form-semver-field.test.ts` that parses `.github/ISSUE_TEMPLATE/intake.yml` as YAML and finds a `dropdown` body element with `id: semver`, `attributes.label: Semver`, `attributes.options` exactly `['major', 'minor', 'patch']`, and `validations.required: false`. It also asserts the `priority` and `size` dropdowns are still `required: true`.
2. Verify the test fails (RED).
3. Implement: add the `semver` dropdown to `.github/ISSUE_TEMPLATE/intake.yml` after the Size dropdown, with description `Optional: is the desired change breaking (major), additive (minor), or a fix (patch)?`.
4. Verify the test passes (GREEN).
5. Commit: "intake form: add an optional Semver dropdown".

**Done when:**
- [test] A test parses `.github/ISSUE_TEMPLATE/intake.yml` and asserts a `dropdown` element with `id: semver`, label `Semver`, options exactly `major`, `minor`, `patch`, and `validations.required: false`, so the form can be submitted with it blank.
- [test] The same test asserts the `priority` and `size` dropdowns keep `validations.required: true`.

**Files likely touched:**
- `.github/ISSUE_TEMPLATE/intake.yml` — optional Semver dropdown
- `src/conductor/test/acceptance/intake-form-semver-field.test.ts` — form shape test

**Dependencies:** none

### Task 5: Teach the intake skill the --semver flag
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. In `skills/intake/SKILL.md`'s flag reference list, after the `--priority` bullet, add a `--semver major|minor|patch` bullet. It says the flag is optional; when omitted it prompts on a TTY (Enter skips) and is never inferred or defaulted; the result is reported as `semver=<tier> (<source>)` or `semver=unset`; and the filer passes it only when they know whether the desired outcome is breaking, additive, or a fix. Add `--semver minor` to the example invocation under `--priority high`, and mention `semver=` in the §9 filing checklist line beside `size=`.
2. Commit: "intake skill: document the optional --semver flag".

**Done when:**
- `skills/intake/SKILL.md` contains a `--semver major|minor|patch` bullet stating that it is optional, never inferred or defaulted, and reported as `semver=<tier> (<source>)` or `semver=unset`.
- The example `intake-file` invocation in `skills/intake/SKILL.md` includes `--semver minor`.

**Files likely touched:**
- `skills/intake/SKILL.md` — `--semver` flag reference and example

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 5
Task 3
Task 4
```

## Integration Points

- After Task 2: `intake-file --semver <tier>` files an issue carrying the label, end to end through the CLI entry point.
- After Task 3: the `intake-label-sync` workflow's apply entry point stamps a form-declared tier.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a filing with `--semver minor` and a successful issue create, when `intake-file` runs, then the created issue carries the label `semver:minor`, keeps its `priority:` and `size:` labels, and stdout includes the line `[intake-file] semver=minor (given)`. | 2 | "runs the CLI with `--semver minor` and asserts the mocked `gh` received a `semver:minor` label add alongside the `priority:` and `size:` adds and stdout contains `[intake-file] semver=minor (given)`" | diff-local |
| Story 1 happy: Given a filing with `--semver MAJOR`, when `intake-file` runs, then the value is accepted case-insensitively and the issue carries `semver:major`. | 2 | "with `--semver MAJOR` it asserts a `semver:major` add" | diff-local |
| Story 1 happy: Given a filing without `--semver` on an interactive TTY, when the filer answers the semver prompt with `patch`, then the issue carries `semver:patch` and stdout includes `[intake-file] semver=patch (prompted)`. | 1, 2 | "asserts stdout contains `[intake-file] semver=patch (prompted)` when the prompt answers `patch`" | diff-local |
| Story 1 happy: Given a filing without `--semver` in a non-interactive run, when `intake-file` runs, then the issue is created with no `semver:` label, no semver prompt is shown, and stdout includes `[intake-file] semver=unset`. | 1, 2 | "a non-interactive run without `--semver` makes no `semver:` label add and prints exactly one `[intake-file] semver=` line, equal to `[intake-file] semver=unset`" | diff-local |
| Story 1 happy: Given a filing without `--semver` whose body contains words such as "breaking" or "fix", when `intake-file` runs non-interactively, then no tier is inferred from the body and the issue carries no `semver:` label. | 1 | "with no `semver` and body `this is a breaking fix` asks no semver question, issues no `semver:` label request, and returns `semver: null`" | diff-local |
| Story 1 negative: Given `--semver feature`, when `intake-file` runs, then it exits 1 with an `invalid --semver "feature"` error that lists the allowed values major, minor, and patch, and no issue is created. | 2 | "each with zero issue-create calls on the mocked `gh`" | diff-local |
| Story 1 negative: Given `--semver` as the last argument with no value, when `intake-file` runs, then it exits 1 with `missing value for --semver` and no issue is created. | 2 | "`--semver` with no value exits 1 with `missing value for --semver`, each with zero issue-create calls on the mocked `gh`" | diff-local |
| Story 1 negative: Given an interactive filing without `--semver`, when the filer presses Enter or answers with a value outside major/minor/patch at the semver prompt, then the issue is created with no `semver:` label and stdout includes `[intake-file] semver=unset`. | 1, 2 | "each still create the issue (`ok: true` with the issue URL) but issue no `semver:` label request" | diff-local |
| Story 1 negative: Given `--semver minor` and a successful issue create, when applying the `semver:minor` label fails, then the filing still exits 0 with the issue URL, the failure is reported as a label-apply warning, and the `priority:` and `size:` labels are still attempted. | 1, 2 | "the CLI exits 0 and stdout contains the `[intake-file] filed:` issue URL" | diff-local |
| Story 2 happy: Given the intake issue form, when a filer opens it, then it offers an optional Semver dropdown with exactly the options `major`, `minor`, and `patch`, and the form can be submitted with it left blank. | 4 | "options exactly `major`, `minor`, `patch`, and `validations.required: false`, so the form can be submitted with it blank" | diff-local |
| Story 2 happy: Given a form submission whose Semver field is `minor`, when the intake label-sync runs on the opened issue, then the issue carries `semver:minor` alongside its `priority:` and `size:` labels. | 3 | "issues an `intake.issue.label.add` for `semver:minor` alongside the `priority:` and `size:` adds" | diff-local |
| Story 2 happy: Given a form submission whose Semver field is left blank (`_No response_`), when the label-sync runs, then the issue receives no `semver:` label, and its `priority:` and `size:` labels are applied or defaulted exactly as before. | 3 | "the blank case's `priority:`/`size:` adds equal those of the same body with no Semver section" | diff-local |
| Story 2 happy: Given a form-submitted issue that already carries `semver:minor`, when it is edited without changing the Semver field, then the label-sync re-run leaves exactly one `semver:` label on the issue. | 3 | "re-running the sync on an unchanged `minor` body issues only `semver:minor` adds" | diff-local |
| Story 2 negative: Given a form-shaped body whose `### Semver` section holds a value other than exactly `major`, `minor`, or `patch` (for example `Minor` or `breaking`), when the label-sync runs, then no `semver:` label is applied and no tier is defaulted. | 3 | "a Semver of `_No response_`, `Minor`, or `breaking` issues no `semver:` label add and reports `semverLabel: null`" | diff-local |
| Story 2 negative: Given an issue filed by `intake-file` (a hand-authored body with no `### Priority` or `### Size` headings) that contains a `### Semver` heading in its prose, when the label-sync runs, then it applies no `semver:` label and leaves the filer's labels untouched. | 3 | "causes `applyIssueEventSync` to issue no label add and no label removal at all" | diff-local |
| Story 2 negative: Given a form submission with Semver `patch`, when applying the `semver:patch` label fails, then the label-sync logs the failure, still exits 0, and still applies the `priority:` and `size:` labels and dependency links. | 3 | "logs the failure, and still issues the `priority:`/`size:` adds and the declared dependency link, and a `runActionFixture` process test asserts the entry point still exits 0 when its `gh` fails only the `semver:patch` add" | diff-local |
| Story 2 negative: Given a form-submitted issue labelled `semver:minor`, when the filer edits the Semver field to `patch`, then the re-run adds `semver:patch` and does not remove `semver:minor`; this is the same additive edit behavior the `priority:` and `size:` labels already have. | 3 | "re-running it after an edit to `patch` issues a `semver:patch` add, and that neither re-run requests any label removal" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
