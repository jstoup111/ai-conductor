# Implementation Plan: Decision-corpus query and known record shapes (#1480)

**Date:** 2026-11-07
**Design:** `.docs/decisions/adr-2026-11-07-decision-corpus-query-and-known-record-shapes.md` (technical track, no PRD)
**Stories:** `.docs/stories/adr-001-still-decides-no-custom-runtime-against-a-.md` (accepted stories)
**Conflict check:** Clean as of 2026-11-07 (1 degrading overlap resolved in Story 4)

## Summary

Adds one engine module that classifies every record in the decision corpus by kind and disposition,
a read-only `ai-conductor decisions` subcommand that prints the corpus index on demand, and a land
rule that refuses newly added off-shape corpus files. The plan has 8 tasks. The ADR-001 deletion and
the four amendment notes are already in this spec's change set (ADR D1), so no task touches the
corpus.

## Technical Approach

- **One module owns the rules.** `src/conductor/src/engine/decision-corpus.ts` exports:
  - `DECISION_RECORD_SHAPES`, a closed, ordered table: prefixes `adr-` → `decision`,
    `architecture-review-` and `review-` → `review`, `technical-assessment-` → `assessment`; exact
    names `api-response-contract.md` and `styleguide.md` → `reference`
  - `matchesKnownShape(filename)`
  - `classifyKind(filename, content)`
  - `deriveDisposition(content)`
  - `readDecisionCorpus(repoRoot)`

  Kind is the closed union `decision | review | assessment | reference | unclassified`; disposition
  is `approved | superseded | other | undeclared` plus the declared word (ADR D2, D3).
- **Disposition reuses `adrApprovalStatus`.** For a `Status:` line, the module calls
  `adrApprovalStatus` from `src/conductor/src/engine/artifacts.ts`. `approved: true` with a found
  word starting `superseded` maps to `superseded`; `approved: true` otherwise maps to `approved`; a
  found word that is not approved maps to `other`. Only for a record whose `adrApprovalStatus`
  returns `found: null` does the module read a `Verdict:` line, after stripping fenced code with the
  existing `stripFencedCodeBlocks`. A record with neither line is `undeclared`. No second `Status:`
  parser is written.
- **Location comes from the kind table.** `readDecisionCorpus` joins `repoRoot` with
  `MANIFEST_KIND_LOCATIONS.decision.directory` from `src/conductor/src/engine/feature-manifest.ts`.
  It never uses the table's `filePattern`, which matches `adr-*` only, because the corpus includes
  every record shape. It lists regular `.md` files only, returns `{ rows: [], errors: [] }` when the
  directory is absent, and collects per-file read failures into `errors` without aborting (ADR D5).
- **Row fields.** Each row carries:
  - `path` (repo-relative), `kind`, `disposition` and `declared`
  - `date`: the first `**Date:**` value, else a `YYYY-MM-DD` embedded in the filename, else empty
  - `title`: the first `# ` heading, else the filename stem
  - `summary`: the first non-empty line of the `## Decision` section, else the first non-empty
    paragraph line after the title, truncated to 160 characters
- **CLI follows the rate-card pattern.** `src/conductor/src/engine/decisions-cli.ts` exports
  `detectDecisionsCommand(argv)` and `dispatchDecisions(cmd, projectRoot, io)`. It is wired the way
  `detectRateCardCommand` / `dispatchRateCard` are:
  - an injectable `deps` entry and a detector call in the pre-pipeline dispatch chain in
    `src/conductor/src/index.ts`
  - a `{ detector: 'detectDecisionsCommand', commandPath: ['decisions'], helpOwner: 'router' }`
    entry in `PRE_DISPATCH_COMMANDS` (`src/conductor/src/cli-pre-dispatch.ts`)
  - a help-only `program.command('decisions')` registration in `src/conductor/src/cli.ts` declaring
    `--kind`, `--status` and `--json`

  Exit codes: 0 on success; 1 when any record was unreadable (the readable rows still print); 2 for
  an invalid `--kind` or `--status` value, with no rows printed.
- **The land rule runs last among the ADR gates.** `landSpec` (`src/conductor/src/engine/engineer/land-spec.ts`)
  gains a step after the assumption-ledger gate. It collects the paths the change set **adds** under
  the corpus directory: porcelain status `A`, `??` (untracked) or the new path of an `R` rename, from
  `git status --porcelain --untracked-files=all -- <corpus dir>`. Any added basename that fails
  `matchesKnownShape` throws `landGateError('decision-record-shape', …)`. The message names every
  offending path and lists the accepted shapes. `'decision-record-shape'` joins the
  `LandGateIdentifier` union in `src/conductor/src/types/land.ts`. Because the step runs after the
  existing ADR gates, an unapproved ADR still reports `adr-not-approved` first. Modified, deleted
  and untouched records are never inspected (ADR D6, D7).
- **Release gate.** The self-host release gate flags the `bin/conduct CLI` surface only when the
  path `bin/conduct` itself changes (`src/conductor/src/engine/self-host/release-gate.ts`). This plan
  edits only files under `src/conductor/src/`, so the gate flags no breaking surface and needs no
  waiver. The subcommand is additive and needs no consumer migration, so the implementation PR's
  `## Migration` section is `none`.

Pattern context for Tasks 5–8: follow `src/conductor/src/engine/rate-card-cli.ts` and its test
`src/conductor/test/engine/rate-card-cli.test.ts`. Detection is a pure argv parser returning a
tagged union or `null`. Dispatch takes injected IO so tests capture stdout, stderr and the exit code
without spawning. Search hints: `detectRateCardCommand`, `PRE_DISPATCH_COMMANDS`. For land tests,
follow `src/conductor/test/engine/engineer/land-spec-adr-assumption-ledger.test.ts`: a temp git repo
with a merge base, `.docs` authored in a worktree, `landSpec` invoked, and a `LandGateError` and its
`gate` asserted. Search hints: `landGateError`, `LandGateError`.

## Prerequisites

- None. `adrApprovalStatus`, `stripFencedCodeBlocks` and `MANIFEST_KIND_LOCATIONS` exist on main.

## Tasks

### Task 1: Known-shapes table and kind classifier
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/decision-corpus.test.ts`. `classifyKind` returns `decision`, `review`, `review` and `assessment` for `adr-2026-01-01-x.md`, `architecture-review-2026-01-01-x.md`, `review-x.md` and `technical-assessment-2026-01-01.md`, each with content carrying no status line. It returns `reference` for `api-response-contract.md` and `styleguide.md`. For `notes.md` it returns `decision` with content `**Status:** APPROVED` and `review` with content `**Verdict:** APPROVED`.
2. Verify RED.
3. Implement `DECISION_RECORD_SHAPES`, `matchesKnownShape` and `classifyKind` in `src/conductor/src/engine/decision-corpus.ts`. Prefix and exact-name rules are checked first, in table order. Then the content rule: a `Status:` line found by `adrApprovalStatus` means `decision`; otherwise a `Verdict:` line outside fenced code means `review`; otherwise `unclassified`.
4. Verify GREEN and commit.

**Done when:**
- [test] `classifyKind` returns `decision`, `review`, `review`, `assessment` for the four prefixed fixtures with status-free content, as asserted in `decision-corpus.test.ts`.
- [test] `classifyKind` returns `reference` for `api-response-contract.md` and `styleguide.md`, as asserted in `decision-corpus.test.ts`.
- [test] `classifyKind` returns `decision` for an unprefixed file whose content has `**Status:** APPROVED` and `review` for one whose content has `**Verdict:** APPROVED`.
- `DECISION_RECORD_SHAPES` is one exported table in `src/conductor/src/engine/decision-corpus.ts`, and `matchesKnownShape` reads only that table.

**Files likely touched:**
- `src/conductor/src/engine/decision-corpus.ts` — new module: shapes table, `matchesKnownShape`, `classifyKind`
- `src/conductor/test/engine/decision-corpus.test.ts` — new tests

**Dependencies:** none

### Task 2: Kind-classification negative paths
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - `adr-2026-01-01-x.md` whose content has only a `Verdict:` line → `decision`
   - `Styleguide.md` and `styleguide-v2.md` with status-free content → `unclassified`, and `matchesKnownShape` is false for both
   - an unprefixed file whose only `Status:` and `Verdict:` lines sit inside a fenced code block → `unclassified`, with no exception thrown
2. Verify RED.
3. Make exact-name matching case-sensitive and whole-name, make the prefix rule return before content is read, and strip fenced code before the content rule.
4. Verify GREEN and commit.

**Done when:**
- [test] `classifyKind('adr-2026-01-01-x.md', '**Verdict:** APPROVED')` returns `decision`, proving the prefix rule wins over content.
- [test] `classifyKind` returns `unclassified` and `matchesKnownShape` returns false for both `Styleguide.md` and `styleguide-v2.md` with status-free content.
- [test] `classifyKind` returns `unclassified` without throwing for an unprefixed file whose only `Status:` and `Verdict:` lines are inside a fenced code block.

**Files likely touched:**
- `src/conductor/src/engine/decision-corpus.ts` — exact-name and fence handling
- `src/conductor/test/engine/decision-corpus.test.ts` — negative cases

**Dependencies:** Task 1

### Task 3: Disposition derivation through `adrApprovalStatus`
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests for `deriveDisposition`:
   - `APPROVED` → `approved`
   - `Approved (operator, 2026-09-28)` → `approved`
   - `SUPERSEDED by adr-2026-01-01-y` → `superseded`
   - `Accepted`, `ACTIVE`, `Proposed` → `other`, each with `declared` equal to the word
   - `**Verdict:** APPROVED WITH CONDITIONS` → `declared` `APPROVED WITH CONDITIONS`
   - no status line → `undeclared`
   - `Status: APPROVED` only inside a fence → `undeclared`
   - both a `Status: Proposed` and a `Verdict: APPROVED` line → `other` with `declared` `Proposed`

   One test also runs `adrApprovalStatus` on the approved and superseded inputs and asserts `approved: true` for each.
2. Verify RED.
3. Implement `deriveDisposition` as described in Technical Approach, calling `adrApprovalStatus` and `stripFencedCodeBlocks`, with no new status regex.
4. Verify GREEN and commit.

**Done when:**
- [test] `deriveDisposition` maps `APPROVED` and `Approved (operator, 2026-09-28)` to `approved` and `SUPERSEDED by adr-2026-01-01-y` to `superseded`, and the same test asserts `adrApprovalStatus(...).approved` is true for all three inputs.
- [test] `deriveDisposition` maps `Accepted`, `ACTIVE` and `Proposed` to `other` with `declared` equal to that word.
- [test] `deriveDisposition` returns `declared` `APPROVED WITH CONDITIONS` for a record whose only status-bearing line is `**Verdict:** APPROVED WITH CONDITIONS`.
- [test] `deriveDisposition` returns `undeclared` without throwing for a record with no status line and for one whose only `Status: APPROVED` is inside a fenced block, and returns `other`/`Proposed` when both `Status: Proposed` and `Verdict: APPROVED` lines exist.
- `decision-corpus.ts` contains no regular expression matching `status` lines; it calls `adrApprovalStatus` for every `Status:` decision.

**Files likely touched:**
- `src/conductor/src/engine/decision-corpus.ts` — `deriveDisposition`
- `src/conductor/test/engine/decision-corpus.test.ts` — disposition cases

**Dependencies:** Task 1

### Task 4: Corpus enumeration and index rows from the kind table
**Story:** Story 1, Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests for `readDecisionCorpus(repoRoot)` over a temp directory:
   - a corpus with one record of each kind plus `image.png` and a subdirectory `nested/` yields one row per `.md` file, with `path`, `kind`, `disposition`, `declared`, `date`, `title` and `summary`
   - `image.png` and `nested/` produce no row
   - a record with no `# ` heading and no date yields title equal to the filename stem and an empty date
   - a missing corpus directory yields `{ rows: [], errors: [] }`
   - with `MANIFEST_KIND_LOCATIONS.decision.directory` replaced via `vi.spyOn` or module mock with `.docs/adr-alt/`, records are read from that path
   - a file made unreadable (chmod 000; skipped when running as root) appears in `errors` with its path while the other rows are returned
2. Verify RED.
3. Implement `readDecisionCorpus` and the row derivation rules in Technical Approach.
4. Verify GREEN and commit.

**Done when:**
- [test] `readDecisionCorpus` returns exactly one row per regular `.md` file and no row for `image.png` or `nested/`, with every row carrying `path`, `kind`, `disposition`, `declared`, `date`, `title` and `summary`.
- [test] A record with no `# ` heading and no date produces a row whose `title` is the filename stem and whose `date` is the empty string.
- [test] `readDecisionCorpus` returns `{ rows: [], errors: [] }` for a repository with no corpus directory, and reads from `.docs/adr-alt/` when the kind table's decision directory is replaced with that path.
- [test] An unreadable record is listed in `errors` by path while every readable record still produces a row.
- `readDecisionCorpus` builds its directory from `MANIFEST_KIND_LOCATIONS.decision.directory`; `decision-corpus.ts` contains no `.docs/decisions` string literal.

**Files likely touched:**
- `src/conductor/src/engine/decision-corpus.ts` — `readDecisionCorpus`, row derivation
- `src/conductor/test/engine/decision-corpus.test.ts` — enumeration cases

**Dependencies:** Tasks 2, 3

### Task 5: `ai-conductor decisions` subcommand
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Follow the rate-card pattern (see Technical Approach): a pure argv detector, dispatch with injected IO, and tests that capture stdout, stderr and the exit code without spawning. Write failing tests in `src/conductor/test/engine/decisions-cli.test.ts`:
   - `detectDecisionsCommand` parses `decisions`, `--kind <k>`, `--status <s>`, `--json` and one free-text term
   - dispatch over a fixture corpus prints one text row per record (kind, disposition, date, title, summary) and exits 0
   - `--kind review`, `--status superseded` and a mixed-case term each filter correctly, and their combination keeps only rows matching all three; the term matches title or summary case-insensitively
   - `--json` prints a JSON array whose objects have exactly `path`, `kind`, `disposition`, `declared`, `date`, `title` and `summary`
   - a repository without a corpus prints `[]` with `--json` and exits 0
   - `git status --porcelain` output in the fixture repo is identical before and after dispatch

   Add a case to `src/conductor/test/cli/pre-dispatch-registry.test.ts`, or extend its existing catalog assertion, so `decisions` is present with `helpOwner: 'router'`. Add a help test asserting that `ai-conductor decisions --help` output lists `--kind`, `--status` and `--json`.
2. Verify RED.
3. Implement `src/conductor/src/engine/decisions-cli.ts`. Wire `detectDecisionsCommand` / `dispatchDecisions` into the `index.ts` pre-pipeline chain next to `detectRateCardCommand`, add the `PRE_DISPATCH_COMMANDS` entry, and register the help-only `program.command('decisions')` with the three options in `cli.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `dispatchDecisions` over a fixture corpus writes one stdout row per record containing kind, disposition, date, title and summary, and returns exit code 0.
- [test] `--kind review`, `--status superseded` and a mixed-case free-text term each restrict the printed rows to matching records, the term matching title or summary without regard to case, and all three together print only rows matching every filter.
- [test] `--json` prints a JSON array whose objects carry exactly the keys `path`, `kind`, `disposition`, `declared`, `date`, `title`, `summary`; with no corpus directory it prints `[]` and returns 0.
- [test] `git status --porcelain` in the fixture repository is byte-identical before and after `dispatchDecisions` runs.
- [test] The CLI entry point routes `decisions` through `detectDecisionsCommand` (asserted via the `index.ts` injectable `deps` dispatch), `PRE_DISPATCH_COMMANDS` contains `decisions` with `helpOwner: 'router'`, and `decisions --help` lists `--kind`, `--status` and `--json`.

**Files likely touched:**
- `src/conductor/src/engine/decisions-cli.ts` — new detector and dispatcher
- `src/conductor/src/index.ts` — dispatch-chain wiring
- `src/conductor/src/cli-pre-dispatch.ts` — catalog entry
- `src/conductor/src/cli.ts` — help registration
- `src/conductor/test/engine/decisions-cli.test.ts` — new tests
- `src/conductor/test/cli/pre-dispatch-registry.test.ts` — catalog assertion

**Dependencies:** Task 4

### Task 6: Subcommand error paths
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `decisions-cli.test.ts`:
   - `--kind bogus` writes to stderr a message naming `bogus` and listing `decision, review, assessment, reference, unclassified`, prints no stdout rows, and returns 2
   - `--status bogus` names `bogus` and lists `approved, superseded, other, undeclared`, prints no rows, and returns 2
   - a corpus with one unreadable record prints every readable row, writes the unreadable path to stderr, and returns 1
2. Verify RED.
3. Implement value validation before reading the corpus, and map a non-empty `errors` list to stderr plus exit 1.
4. Verify GREEN and commit.

**Done when:**
- [test] `dispatchDecisions` with `--kind bogus` writes a stderr message containing `bogus` and every accepted kind, writes nothing to stdout, and returns 2.
- [test] `dispatchDecisions` with `--status bogus` writes a stderr message containing `bogus` and every accepted disposition, writes nothing to stdout, and returns 2.
- [test] With one unreadable record, `dispatchDecisions` prints a row for every readable record, writes the unreadable path to stderr, and returns 1.

**Files likely touched:**
- `src/conductor/src/engine/decisions-cli.ts` — validation and error mapping
- `src/conductor/test/engine/decisions-cli.test.ts` — error cases

**Dependencies:** Task 5

### Task 7: Repository corpus contract
**Story:** Story 1, Story 3
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/decision-corpus-repo.test.ts`. It calls `readDecisionCorpus` on the repository root, resolved from the test file location, and asserts:
   - no row has a path whose basename is `001-harness-architecture.md`
   - no row whose filename begins `adr-`, `architecture-review-`, `review-` or `technical-assessment-` has kind `unclassified`
   - `errors` is empty

   The test goes RED only if the corpus or classifier regresses. Before Task 4 lands it fails on the missing export.
2. Verify GREEN against the spec-merged corpus and commit.

**Done when:**
- [test] `readDecisionCorpus` over this repository's root returns no row whose path basename is `001-harness-architecture.md`.
- [test] `readDecisionCorpus` over this repository's root returns zero `unclassified` rows among files whose names begin `adr-`, `architecture-review-`, `review-` or `technical-assessment-`, and an empty `errors` list.

**Files likely touched:**
- `src/conductor/test/engine/decision-corpus-repo.test.ts` — new repository contract test

**Dependencies:** Task 4

### Task 8: Land refuses newly added off-shape corpus files
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Follow the land test pattern (see Technical Approach): a temp git repo with a merge base, `.docs` authored in a worktree, and `landSpec` invoked. Write failing tests in `src/conductor/test/engine/engineer/land-spec-decision-record-shape.test.ts`:
   - a change set adding approved, citable, ledgered `adr-2026-11-07-x.md` and `architecture-review-2026-11-07-x.md` lands
   - adding `styleguide.md`, and separately `api-response-contract.md`, lands
   - a base containing the synthetic legacy records `review-legacy-fixture.md` and `000-legacy-fixture.md`, with the change set modifying the first and deleting the second, lands
   - a base with untouched off-shape records lands
   - adding a corpus file named `notes.md` throws `LandGateError` with `gate` `decision-record-shape`, a message naming the corpus-relative `notes.md` path and listing every accepted shape, and leaves `git rev-parse HEAD` unchanged
   - renaming an existing record to the corpus name `old-notes.md` throws the same gate naming `old-notes.md`
   - adding `notes.md` under the fixture's plans directory with an otherwise valid change set raises no `decision-record-shape` error
   - adding both an unapproved ADR and `notes.md` throws `gate` `adr-not-approved`
2. Verify RED.
3. Add `'decision-record-shape'` to `LandGateIdentifier` in `src/conductor/src/types/land.ts`. Then add the added-path collection (porcelain `A`, `??`, rename target) under the corpus directory resolved from `MANIFEST_KIND_LOCATIONS.decision.directory`, and the `matchesKnownShape` refusal, in `landSpec` after the assumption-ledger gate.
4. Verify GREEN and commit.

**Done when:**
- [test] `landSpec` lands change sets that add canonical `adr-`/`architecture-review-` records, `styleguide.md` or `api-response-contract.md`, or that only modify or delete existing off-shape records, and raises no `decision-record-shape` error when the base already holds untouched off-shape records.
- [test] `landSpec` with an added corpus file `notes.md` throws `LandGateError` with `gate === 'decision-record-shape'`, its message contains the corpus-relative path ending `notes.md` and every accepted shape, and `git rev-parse HEAD` is unchanged afterward.
- [test] `landSpec` with an existing record renamed to the corpus name `old-notes.md` throws `gate === 'decision-record-shape'` naming `old-notes.md`, and an added `notes.md` under the plans directory raises no `decision-record-shape` error.
- [test] `landSpec` with an added unapproved ADR and an added corpus file `notes.md` throws `gate === 'adr-not-approved'`, proving the shape rule runs after the existing ADR gates.
- The shape refusal in `landSpec` calls `matchesKnownShape` imported from `src/conductor/src/engine/decision-corpus.ts`, and `'decision-record-shape'` is a member of `LandGateIdentifier`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/land-spec.ts` — added-path collection and shape refusal
- `src/conductor/src/types/land.ts` — new gate identifier
- `src/conductor/test/engine/engineer/land-spec-decision-record-shape.test.ts` — new tests

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ─┐
        ├─ Task 3 ─┴─ Task 4 ─┬─ Task 5 ── Task 6
        │                     └─ Task 7
        └─ Task 8
```

## Integration Points

- After Task 5: `ai-conductor decisions` runs end to end from the CLI entry point.
- After Task 8: `ai-conductor compose land` enforces the shape rule on real spec worktrees.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D1 | no-change | none | The deletion of founding record 001 and the four amendment notes are in this spec's own change set; builds cannot edit the protected `.docs/decisions` directory, and Task 7 only reads the result. |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D2 | task | task-1, task-2 | `DECISION_RECORD_SHAPES` is one exported table in `src/conductor/src/engine/decision-corpus.ts`, and `matchesKnownShape` reads only that table. |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D3 | task | task-3 | it calls `adrApprovalStatus` for every `Status:` decision. |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D4 | task | task-5, task-6 | `--json` prints a JSON array whose objects carry exactly the keys `path`, `kind`, `disposition`, `declared`, `date`, `title`, `summary`; with no corpus directory it prints `[]` and returns 0. |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D5 | task | task-4 | `readDecisionCorpus` builds its directory from `MANIFEST_KIND_LOCATIONS.decision.directory`; `decision-corpus.ts` contains no `.docs/decisions` string literal. |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D6 | task | task-8 | proving the shape rule runs after the existing ADR gates. |
| adr-2026-11-07-decision-corpus-query-and-known-record-shapes#D7 | no-change | none | No task names an existing corpus record as a write target; legacy records are classified in place by the content rule (Task 2) and listed by the query (Task 4). |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D1 | existing | none | `skills/intake/scripts/intake-file` exists as a bundled helper under `skills/<name>/scripts/`. |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D2 | existing | none | `skills/intake/scripts/intake-file` only resolves the harness root and `exec`s `src/conductor/src/intake-file-cli.ts` through tsx. |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D3 | existing | none | `skills/intake/SKILL.md` invokes the helper as `<this skill's directory>/scripts/intake-file`. |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D4 | existing | none | `skills/intake/scripts/intake-file` checks candidates with its `is_harness_root` function before exec. |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D5 | existing | none | `skills/intake/scripts/intake-file` execs tsx with absolute harness paths and contains no `cd` into the harness. |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D6 | existing | none | `test/lint_shell.sh` `collect_scripts` enumerates `skills/*/scripts/`. |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D7 | existing | none | `skills/intake/scripts/intake-file` is the migrated helper the decision names. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-R1: Restore filename-only matchesKnownShape and land shape refusal; rename stem-named decision fixtures to architecture-review-*; add Status/Verdict-bearing notes.md refusal tests
**Gate:** prd-audit
**Rationale:** Clear implementation drift from approved architecture (ADR D6: land acceptance uses only D2's prefix and exact-name rules; Task 1 done-when: matchesKnownShape reads only DECISION_RECORD_SHAPES). Commit b8597724eb widened matchesKnownShape (decision-corpus.ts:35) to classifyKind's content fallback, and land-spec.ts:728-733 now reads added-file content and passes it in. As a result, notes.md containing a Status: or Verdict: line lands. No architectural decision is needed, so this is BUILD work admitted by Tasks 1 and 8. Repair: restore matchesKnownShape(filename) to a filename-only shapeKind check, and drop the content read in landSpec. Keep classifyKind's content fallback for the query (D2/D7 legacy findability). The fixtures that b8597724eb rewrote were stem-named decision files (`<stem>.md` / `<slug>.md` / `stacked-delivery.md` / `dep-bump.md`) in land-spec.test.ts, land-spec-applicability.test.ts and land-spec-stacked-delivery.test.ts. Rename them to `architecture-review-<stem>.md`, which pickIdeaFile (land-spec.ts:498) still accepts as the tier-M review file and which matches production naming (skills/architecture-review/SKILL.md). Replace the decision-corpus.test.ts case 'recognizes status- and verdict-bearing legacy records as known shapes' with one asserting that matchesKnownShape rejects off-shape names even with Status/Verdict content, and that classifyKind still classifies them. Add a land-spec-decision-record-shape.test.ts case: an added notes.md containing '**Status:** Proposed' (and one with '**Verdict:** APPROVED') throws gate 'decision-record-shape' with HEAD unchanged. Preserved coverage: Task 8's existing refusal and grandfathering tests, and the classifyKind legacy-content tests from Task 2.
**Criterion:** S4.4
**Parent task:** 8
**Done when:**
- [test] S4.4 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.
