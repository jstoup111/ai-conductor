**Status:** Accepted

# Stories: Decision-corpus query and known record shapes (#1480)

Technical track. Governing ADR: `adr-2026-11-07-decision-corpus-query-and-known-record-shapes`
(D1–D7). The corpus changes in D1 (deleting `001-harness-architecture.md` and adding amendment notes
to its four citing records) ride the spec PR, so none of these stories covers them.

## Story 1: Classify every corpus record by kind

**Requirement:** ADR D2, D7

As a reader of a decision corpus, I want each record's kind derived by one rule so that I can tell decision records from review transcripts without opening them.

### Acceptance Criteria

#### Happy Path
- Given corpus files named `adr-2026-01-01-x.md`, `architecture-review-2026-01-01-x.md`, `review-x.md` and `technical-assessment-2026-01-01.md`, when the corpus is classified, then their kinds are `decision`, `review`, `review` and `assessment` respectively, regardless of their content.
- Given corpus files named exactly `api-response-contract.md` and `styleguide.md`, when the corpus is classified, then both are kind `reference`.
- Given a file matching no prefix or exact name whose first status-bearing line is `**Status:** APPROVED`, when the corpus is classified, then its kind is `decision`; given another such file whose line is `**Verdict:** APPROVED`, then its kind is `review`.

#### Negative Paths
- Given a file named `adr-2026-01-01-x.md` whose content carries only a `Verdict:` line, when the corpus is classified, then its kind is still `decision` because the prefix rule wins over content.
- Given a file named `Styleguide.md` or `styleguide-v2.md`, when the corpus is classified, then it is not kind `reference`; it falls through to the content rule.
- Given a file matching no prefix or exact name with neither a `Status:` nor a `Verdict:` line outside fenced code blocks, when the corpus is classified, then its kind is `unclassified` and classification does not fail.
- Given a non-Markdown file or a subdirectory inside the corpus directory, when the corpus is classified, then it is not listed as a record.

### Done When
- [ ] A unit test classifies one fixture per known shape plus the content-fallback and `unclassified` cases, and asserts each kind.
- [ ] Classifying this repository's `.docs/decisions/` yields zero `unclassified` records among the files whose names begin `adr-`, `architecture-review-`, `review-` or `technical-assessment-`.
- [ ] The known shapes are declared in one exported table that both the query and the land rule import.

## Story 2: Report each record's disposition by one rule

**Requirement:** ADR D3

As a reader, I want a record's disposition determined mechanically so that I can tell which records are in force without interpreting mixed status words.

### Acceptance Criteria

#### Happy Path
- Given records whose status lines read `APPROVED`, `Approved (operator, 2026-09-28)` and `SUPERSEDED by adr-2026-01-01-y`, when dispositions are derived, then they are `approved`, `approved` and `superseded`, using the same result `adrApprovalStatus` gives for each.
- Given records whose status lines read `Accepted`, `ACTIVE` and `Proposed`, when dispositions are derived, then each is `other` and the declared word is kept for display.
- Given a review record whose line reads `**Verdict:** APPROVED WITH CONDITIONS`, when dispositions are derived, then its disposition shows the verdict word `APPROVED WITH CONDITIONS`.

#### Negative Paths
- Given a record with no `Status:` or `Verdict:` line, when dispositions are derived, then its disposition is `undeclared` and derivation does not fail.
- Given a record whose only `Status: APPROVED` line sits inside a fenced code block, when dispositions are derived, then the fenced line is ignored and the disposition is `undeclared`.
- Given a record carrying both a `Status:` and a `Verdict:` line, when dispositions are derived, then the `Status:` line decides.

### Done When
- [ ] A unit test asserts each disposition above, and its approved and superseded cases agree with `adrApprovalStatus` on the same inputs.
- [ ] No second status-line parser exists beside `adrApprovalStatus` for `Status:` lines.

## Story 3: Query the corpus on demand with `ai-conductor decisions`

**Requirement:** ADR D4, D5

As an operator or agent, I want one read-only command that indexes the corpus so that I can find the record governing a subject without reading every file.

### Acceptance Criteria

#### Happy Path
- Given a repository with a decision corpus, when `ai-conductor decisions` runs at its root, then it prints one row per record with kind, disposition, date, title and a one-line decision summary, then exits 0.
- Given `--kind review`, `--status superseded` or a free-text term, when the command runs, then only rows matching every given filter are printed, and the term matches title or summary without regard to case.
- Given `--json`, when the command runs, then it prints the same rows as a JSON array of objects with `path`, `kind`, `disposition`, `declared`, `date`, `title` and `summary` fields.
- Given this repository after the spec merges, when the command runs, then no row has path `.docs/decisions/001-harness-architecture.md`.
- Given the decision kind's directory in `MANIFEST_KIND_LOCATIONS` is changed to another path in a test, when the command runs, then it reads records from that path.

#### Negative Paths
- Given a repository with no corpus directory (a consumer repository that never authored an ADR), when the command runs, then it prints an empty result (`[]` with `--json`) and exits 0.
- Given `--kind bogus` or `--status bogus`, when the command runs, then it exits non-zero, names the rejected value and lists the accepted values, and prints no rows.
- Given a record file that cannot be read (permission denied), when the command runs, then it prints every readable row, reports the unreadable path on stderr and exits 1.
- Given a record with no title heading or no date, when the command runs, then the row shows the filename stem as the title and an empty date, rather than being dropped.
- Given any invocation, when the command finishes, then `git status --porcelain` in the repository is unchanged.

### Done When
- [ ] `ai-conductor decisions --help` lists the subcommand with its `--kind`, `--status` and `--json` options.
- [ ] A CLI test runs the subcommand against a fixture corpus and asserts its rows, its filters, its empty-corpus result and its rejection of an unknown `--kind` value.
- [ ] The subcommand resolves the corpus directory through `MANIFEST_KIND_LOCATIONS`; no corpus path literal appears in its module.

## Story 4: Land refuses newly added off-shape corpus files

**Requirement:** ADR D6, D7

As the harness, I want land to refuse a spec that adds an unrecognized file to the decision corpus so that the corpus stops drifting from the known shapes, without breaking any existing repository.

### Acceptance Criteria

#### Happy Path
- Given a spec change set that adds `adr-2026-11-07-x.md` and `architecture-review-2026-11-07-x.md` to the corpus, when land runs, then the shape rule passes and the existing ADR gates decide as before.
- Given a consumer spec change set that adds `api-response-contract.md` or `styleguide.md` to the corpus, when land runs, then the shape rule passes.
- Given a spec change set that modifies or deletes an existing off-shape record such as `review-per-task-work-happened-floor.md` or `001-harness-architecture.md`, when land runs, then the shape rule passes.

#### Negative Paths
- Given a spec change set that adds `.docs/decisions/notes.md`, when land runs, then land refuses with a `decision-record-shape` error naming that path and listing the accepted shapes, and nothing is committed.
- Given a spec change set that renames an existing record to an off-shape name such as `old-notes.md`, when land runs, then the new path counts as added and land refuses it.
- Given a spec change set that adds an off-shape file outside the corpus directory, such as `.docs/plans/notes.md`, when land runs, then the shape rule does not apply to it.
- Given a repository whose corpus already holds off-shape records the change set does not touch, when land runs, then the shape rule passes.
- Given a spec change set that adds both an unapproved ADR and `.docs/decisions/notes.md`, when land runs, then land reports the existing ADR approval refusal rather than the shape refusal, so the shape rule never masks an existing gate.

### Done When
- [ ] A land test asserts the refusal for an added `notes.md`, including the error code, the named path and the absence of a new commit.
- [ ] A land test asserts that added `styleguide.md`, a modified legacy record and a deleted legacy record all pass the shape rule.
- [ ] The land rule imports the same known-shapes table as the query (Story 1).
- [ ] A land test asserts that a change set adding both an unapproved ADR and `notes.md` is refused with the existing `adr-not-approved` error.
