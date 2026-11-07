**Status:** Accepted

# Stories: Intake issues carry an optional declared semver label (#2027)

Technical track (no PRD). Scope boundary, from `.docs/track/intake-carries-no-semver-signal-release-semver-is-.md`: display-only. A filer may declare a semver tier at filing time, and the issue then shows one of the repository's existing `semver:major` / `semver:minor` / `semver:patch` labels. An undeclared tier is never inferred or defaulted. Nothing downstream reads the label.

## Story 1: Declare a semver tier when filing through intake-file

**Requirement:** Technical intent — #2027 desired outcome 1 and 3 (tier set at filing time like size/priority; filing without a tier still works and reports its source)

As an intake filer, I want to declare the change's semver tier when I file with the bundled `intake-file` helper so that the issue shows the release tier I already know at observation time.

### Acceptance Criteria

#### Happy Path
- Given a filing with `--semver minor` and a successful issue create, when `intake-file` runs, then the created issue carries the label `semver:minor`, keeps its `priority:` and `size:` labels, and stdout includes the line `[intake-file] semver=minor (given)`.
- Given a filing with `--semver MAJOR`, when `intake-file` runs, then the value is accepted case-insensitively and the issue carries `semver:major`.
- Given a filing without `--semver` on an interactive TTY, when the filer answers the semver prompt with `patch`, then the issue carries `semver:patch` and stdout includes `[intake-file] semver=patch (prompted)`.
- Given a filing without `--semver` in a non-interactive run, when `intake-file` runs, then the issue is created with no `semver:` label, no semver prompt is shown, and stdout includes `[intake-file] semver=unset`.
- Given a filing without `--semver` whose body contains words such as "breaking" or "fix", when `intake-file` runs non-interactively, then no tier is inferred from the body and the issue carries no `semver:` label.

#### Negative Paths
- Given `--semver feature`, when `intake-file` runs, then it exits 1 with an `invalid --semver "feature"` error that lists the allowed values major, minor, and patch, and no issue is created.
- Given `--semver` as the last argument with no value, when `intake-file` runs, then it exits 1 with `missing value for --semver` and no issue is created.
- Given an interactive filing without `--semver`, when the filer presses Enter or answers with a value outside major/minor/patch at the semver prompt, then the issue is created with no `semver:` label and stdout includes `[intake-file] semver=unset`.
- Given `--semver minor` and a successful issue create, when applying the `semver:minor` label fails, then the filing still exits 0 with the issue URL, the failure is reported as a label-apply warning, and the `priority:` and `size:` labels are still attempted.

### Done When
- [ ] `intake-file --semver minor` (with `--title`/`--body`) creates an issue whose labels include `semver:minor`, `priority: <band>`, and `size: <S|M|L>`.
- [ ] Every `intake-file` run that creates an issue prints exactly one `[intake-file] semver=` line whose value is `major`, `minor`, `patch`, or `unset`, with source `(given)` or `(prompted)` when a tier is set.
- [ ] An invalid or valueless `--semver` exits 1 before any issue-create request is made.
- [ ] A non-interactive filing without `--semver` makes no `semver:` label request.
- [ ] The usage line printed for missing `--title`/`--body` lists `[--semver major|minor|patch]`.

## Story 2: Declare a semver tier through the intake issue form

**Requirement:** Technical intent — #2027 desired outcome 1 and 3 (web/mobile filings can set the tier; leaving it blank still files)

As a filer using the GitHub web or mobile intake form, I want an optional Semver dropdown so that my declared tier appears as a label on the issue just as size and priority do.

### Acceptance Criteria

#### Happy Path
- Given the intake issue form, when a filer opens it, then it offers an optional Semver dropdown with exactly the options `major`, `minor`, and `patch`, and the form can be submitted with it left blank.
- Given a form submission whose Semver field is `minor`, when the intake label-sync runs on the opened issue, then the issue carries `semver:minor` alongside its `priority:` and `size:` labels.
- Given a form submission whose Semver field is left blank (`_No response_`), when the label-sync runs, then the issue receives no `semver:` label, and its `priority:` and `size:` labels are applied or defaulted exactly as before.
- Given a form-submitted issue that already carries `semver:minor`, when it is edited without changing the Semver field, then the label-sync re-run leaves exactly one `semver:` label on the issue.

#### Negative Paths
- Given a form-shaped body whose `### Semver` section holds a value other than exactly `major`, `minor`, or `patch` (for example `Minor` or `breaking`), when the label-sync runs, then no `semver:` label is applied and no tier is defaulted.
- Given an issue filed by `intake-file` (a hand-authored body with no `### Priority` or `### Size` headings) that contains a `### Semver` heading in its prose, when the label-sync runs, then it applies no `semver:` label and leaves the filer's labels untouched.
- Given a form submission with Semver `patch`, when applying the `semver:patch` label fails, then the label-sync logs the failure, still exits 0, and still applies the `priority:` and `size:` labels and dependency links.
- Given a form-submitted issue labelled `semver:minor`, when the filer edits the Semver field to `patch`, then the re-run adds `semver:patch` and does not remove `semver:minor`; this is the same additive edit behavior the `priority:` and `size:` labels already have.

### Done When
- [ ] `.github/ISSUE_TEMPLATE/intake.yml` declares a Semver dropdown with options `major`, `minor`, `patch` and `required: false`.
- [ ] Running the label-sync on a form body with `### Semver` followed by `minor` issues one `semver:minor` label add on that issue.
- [ ] Running the label-sync on a form body with a blank or invalid Semver issues no `semver:` label add.
- [ ] Running the label-sync on a non-form body issues no `semver:` label add.
- [ ] The label-sync's report of applied labels names the semver label when one was applied.
