# Implementation Plan: Simplify evaluator model routing to a two-way risk switch

**Date:** 2026-09-06
**Stories:** .docs/stories/simplify-evaluator-model-routing-to-a-two-way-risk.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the approved generated-model-table contract, which already declares a model-policy change to be one typed-metadata edit plus one regeneration, and touches no other row, no engine resolution path, and no provider policy constant.

## Summary

Five bounded tasks deliver #193: the evaluator's two-sided content taxonomy becomes one risk-domain criterion in the typed model-table metadata, the generated harness table is regenerated from it, its hand-synced reference mirror is brought into agreement, and the two shipped skills that state evaluator dispatch guidance restate the same criterion. Evaluator fresh-context isolation, dispatch frequency, batch diff scope, domain-reviewer diff-size routing, and every other model-table row are outside this slice.

## Technical Approach

The evaluator entry in `EXTRA_MODEL_TABLE_ROWS` (`src/conductor/src/engine/model-table-metadata.ts:218-224`) is data-only: `buildExtraRows` copies it verbatim and `assertValidInteractiveRows` constrains only `codexModel` and `codexEffort`, so the Claude cell is free-form text. Replace its `claudeModel` string with the two-way switch — a stated default plus one risk-domain criterion naming concurrency, state mutation, security, auth, and money — and replace its `why` with a rationale for the single criterion. Keep `executionPath`, `claudeEffort`, and both Codex inheritance placeholders byte-identical so the row keeps passing the existing interactive-row assertions. Write the `why` without a Claude model alias, so the alias-labelling specs that govern rationale prose stay inapplicable.

The generated region of the harness rules file is rewritten only by `bin/generate-model-table`, which execs the TypeScript generator through the locally pinned `tsx`. Regenerate rather than hand-edit; integrity check 5a runs the same generator in `--check` mode and fails on drift, and the existing generator acceptance spec reads the committed region and asserts its seven-column shape. The reference model table under `docs/reference/` carries a hand-copied duplicate of the same cell in its interactive-rows table; update that one cell in the same commit so the two never disagree. This is a synchronized mirror of a machine-generated cell, not new reader documentation.

For the top tier, name the Claude family's deepest rung rather than inventing a degradation mechanism: `provider-model-policy.ts:148-149` and the harness rules file's provider-native availability note already define the `fable→opus→sonnet` ladder delivered by the closed availability-probe issue, so the guidance cites that ladder and adds nothing.

The shipped guidance seam is `skills/code-review/SKILL.md:60-64`, two bullets under a delegation paragraph that already scopes Claude mechanics on one side and the Codex subagent facility on the other. Replace the two bullets with a default bullet and a risk-domain bullet, keeping each `model="…"` parameter on a physical line that also names Claude Code — the provider skill contract audit greps that exact pairing per line and rejects an unscoped one. Leave the fresh-context sentence, the evaluator input list, and the three-stage review untouched.

`skills/pipeline/SKILL.md:357-363` carries a different axis — evaluator frequency and model by complexity tier and batch position. Its frequency columns are explicitly out of scope, so add one override sentence beneath the table stating that a risk-domain batch raises that batch's evaluator to the top Claude tier regardless of the tier row, and leave every cell in the table as it stands. `agents/evaluator.md` names no model and is not edited; the domain-reviewer diff-size bullets in the TDD skill are a different agent's routing and are a verified no-fit for this criterion.

Tests follow the repository's test-design rules: these are pure assertions over an imported typed constant and over committed text files, so they belong at unit level with no conductor fixture, no provider dispatch, and no third-party call. `src/conductor/test/model-table-metadata.test.ts:222-236` is the local pattern — it reads a named row out of `EXTRA_MODEL_TABLE_ROWS`, asserts its fields with `toMatchObject`, and cross-checks a committed skill file through a small reader helper. Reuse those traits: name the row, assert the whole shape rather than a substring, and read committed files with `readFileSync` relative to the test file's own directory. Allowed variation is the assertion grouping and whether a new file or the existing one hosts a case. A new focused file, `src/conductor/test/evaluator-model-routing.test.ts`, holds the table-to-guidance agreement cases so that the metadata file's specs stay about metadata.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the two-way switch with the top Claude tier on risk domains, and both stories on 2026-09-06 (delegated).
- Verified: the evaluator row is at `src/conductor/src/engine/model-table-metadata.ts:218-224`; its `claudeModel` is the multi-category string and its `why` is `Right-sized by batch content.`
- Verified: `buildExtraRows` copies each field verbatim and `assertValidInteractiveRows` (`src/conductor/src/tools/generate-model-table.ts:340-362`) rejects a Claude alias only in the two Codex fields, so the Claude cell accepts the new text.
- Verified: the generated region markers sit at `HARNESS.md:236` and `HARNESS.md:291`, and the evaluator row renders at `HARNESS.md:269`.
- Verified: `docs/reference/models.md:223` duplicates the same cell inside the interactive-rows table.
- Verified: `skills/code-review/SKILL.md:24-29` already carries the paired Claude/Codex delegation paragraph, and `:60-64` carries the two content-category bullets.
- Verified: `test/test_provider_skill_contracts.sh:377-380` greps `model="(sonnet|opus|haiku|fable)"` per line and fails any matching line that does not also name Claude.
- Verified: `skills/pipeline/SKILL.md:357-363` is the tier and batch-position table; its columns are Intermediate batches, Final batch, Intermediate model, Final model.
- Verified: `agents/evaluator.md` contains no model, tier, or alias reference, so the issue's third named sync point needs no edit.
- Verified: `src/conductor/src/engine/provider-model-policy.ts:148-149` defines `modelFallbackLadder` as `['fable','opus','sonnet']`, and the harness rules file documents that ladder; the availability-probe issue it came from is closed.
- Verified: `src/conductor/test/model-table-metadata.test.ts` already imports `EXTRA_MODEL_TABLE_ROWS`, asserts a named row with `toMatchObject`, and reads committed skill files through a helper resolved from the test file's directory.
- Scope check: A — consumer-facing (no repo-only signal fires; every repository that installs the harness dispatches this evaluator); B — n/a (no new skill); C — scoped-with-both-seams (Claude parameters stay Claude-labelled per line, the Codex delegation paragraph and the row's Codex inheritance placeholders are untouched). Event spine: no event, metric, span, log line, or report is added or changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree. No pending product or scope assumption remains.

## Tasks

### Task 1: Replace the evaluator row with the two-way risk switch
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/model-table-metadata.ts, src/conductor/test/model-table-metadata.test.ts, HARNESS.md, docs/reference/models.md
**Dependencies:** none

**Steps:**
1. Follow the local row-assertion pattern already in the metadata specification file: look the row up by name in `EXTRA_MODEL_TABLE_ROWS` and assert its full shape with `toMatchObject`, rather than matching a substring. Add a failing case asserting the evaluator row's `claudeModel` names one default model, names the top Claude tier for risk domains, and names concurrency, state mutation, security, auth, and money; assert `executionPath` is `supported-host interactive`, `claudeEffort` is empty, and both Codex fields still match the session-inheritance placeholder.
2. Verify the case fails (RED) against the current multi-category string.
3. Rewrite `claudeModel` in the evaluator entry as the two-way switch and rewrite `why` as a one-sentence rationale for the single criterion, using no Claude model alias in the rationale text. Change no other field and no other row.
4. Run `bin/generate-model-table` to rewrite only the marked region of the harness rules file, then run `bin/generate-model-table --check` and confirm it exits zero.
5. Copy the regenerated Claude cell verbatim into the evaluator line of the interactive-rows table under `docs/reference/`, leaving its Codex column unchanged.
6. Run the focused metadata specification and the repository typecheck target that includes test files, then commit the change.

**Done when:**
1. The evaluator row's `claudeModel` names exactly one default model and one risk-domain criterion listing concurrency, state mutation, security, auth, and money.
2. The evaluator row's `executionPath`, `claudeEffort`, and both Codex inheritance fields are byte-identical to their pre-change values.
3. `bin/generate-model-table --check` exits zero against the committed generated region.
4. The evaluator cell in the reference interactive-rows table is character-for-character the cell in the committed generated region.

### Task 2: Reject retired categories and hand-edited table drift
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/model-table-metadata.test.ts, src/conductor/test/acceptance/generate-model-table.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Add a failing case asserting the evaluator row's `claudeModel` and `why` contain none of the enumerated retired selection categories: value objects, pure functions, config, infra, view templates, financial calculations, and complex domain interactions. Report the offending category in the failure message rather than a bare boolean.
2. Verify the case fails when a retired category is temporarily reintroduced into the row, then confirm it passes against the Task 1 text.
3. In the generator acceptance specification, add a case that renders the table from a copy of the metadata with the evaluator row mutated, writes it into a temporary copy of the marked region, and asserts the generator's check mode reports that row as drifted and exits non-zero. Use the existing temporary-file and marked-region fixtures in that file; do not shell out to the installed binary and do not touch the committed harness rules file.
4. Run both specification files focused, then commit.

**Done when:**
1. The metadata specification fails, naming the category, when any of the seven enumerated retired categories appears in the evaluator row's `claudeModel` or `why`.
2. The generator acceptance specification proves a hand-mutated evaluator row in the marked region makes check mode exit non-zero and name that row.
3. Both specifications run without writing to the committed harness rules file and without invoking any external process or service.

### Task 3: Restate the code-review evaluator dispatch as the two-way switch
**Story:** Story 2
**Type:** happy-path
**Files:** skills/code-review/SKILL.md, src/conductor/test/evaluator-model-routing.test.ts
**Dependencies:** 1

**Steps:**
1. Create the new focused specification file, reading committed files with `readFileSync` against a directory resolved from the test file's own location — the same traits the metadata specification uses for its skill reader helper; the assertion grouping may differ. Add a failing case that reads the code-review skill file, extracts its evaluator model-selection block, and asserts it offers exactly two choices — a default and a risk-domain top tier — naming the same five risk domains as the metadata row, and that the block names no retired selection category.
2. Verify the case fails (RED) against the current two content-category bullets.
3. Replace those two bullets with the default bullet and the risk-domain bullet. Keep every `model="…"` parameter on a physical line that also contains `Claude Code`. Have the risk-domain bullet name the top Claude tier and point at the already-documented Claude availability ladder for the unavailable case, adding no new degradation rule.
4. Leave the surrounding delegation paragraph, the fresh-context sentence, the evaluator input list, and the three-stage review untouched.
5. Run the new specification focused and run the provider skill contract audit, then commit.

**Done when:**
1. The code-review evaluator model-selection block offers exactly two choices and names concurrency, state mutation, security, auth, and money.
2. No retired selection category remains anywhere in the code-review skill file's evaluator model-selection block.
3. Every line of that skill file carrying a `model="…"` parameter also names Claude Code on the same physical line.

### Task 4: Add the pipeline risk-domain override without changing frequency
**Story:** Story 2
**Type:** happy-path
**Files:** skills/pipeline/SKILL.md, src/conductor/test/evaluator-model-routing.test.ts
**Dependencies:** 3

**Steps:**
1. Add a failing case that reads the pipeline skill file, parses its evaluator scaling table, and asserts both that the table's four frequency cells are exactly Skipped, Always, every-8-tasks, and every-4-tasks as they stand today, and that an override statement beneath the table names the same five risk domains and raises that batch's evaluator to the top Claude tier.
2. Verify the case fails (RED) against the current table, which carries no override.
3. Add the single override sentence immediately beneath the table. Change no cell of the table, no rationale paragraph, and no part of the batch-boundary hard gate, the closeout-obligation requirement, or the diff-scope rule.
4. Run the new specification focused and run the provider skill contract audit, then commit.

**Done when:**
1. The pipeline evaluator scaling table's frequency cells are unchanged from their pre-change values.
2. An override statement beneath that table names concurrency, state mutation, security, auth, and money and raises that batch's evaluator to the top Claude tier.
3. The batch-boundary hard gate, closeout-obligation requirement, and evaluator diff-scope rule in that skill file are unchanged.

### Task 5: Pin provider scoping and the deliberately unchanged surface
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/evaluator-model-routing.test.ts
**Dependencies:** 4

**Steps:**
1. Add a failing case that takes the code-review skill text, injects a dispatch line carrying a `model="fable"` parameter with no mention of Claude on that line, and asserts the per-line scoping rule the provider contract audit applies rejects it. Assert the unmodified committed text passes the same rule.
2. Add a failing case asserting the evaluator fresh-context isolation sentence is present in both the code-review and pipeline skill files, and that the pipeline scaling table still declares an intermediate and a final model column.
3. Verify both cases fail against deliberately mutated in-memory copies and pass against the committed text. Keep every mutation in memory; write nothing back to the skill files.
4. Run the new specification focused, run the provider skill contract audit, and run the harness integrity suite; confirm each exits zero. Commit.

**Done when:**
1. An injected unscoped Claude model parameter is rejected by the specification, and the committed code-review text passes the same per-line rule.
2. The specification fails if the evaluator fresh-context isolation sentence is removed from either skill file.
3. The provider skill contract audit and the harness integrity suite both exit zero on the committed tree.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the typed model-table metadata, when the evaluator row is read, then its Claude cell states one default model plus one risk-domain criterion naming concurrency, state mutation, security, auth, and money, and names no other selection category. | 1, 2 | "The evaluator row's `claudeModel` names exactly one default model and one risk-domain criterion listing concurrency, state mutation, security, auth, and money." | diff-local |
| Story 1 happy: Given the evaluator row states the two-way switch, when the model-selection table is regenerated from that metadata, then the committed generated region in the harness rules file carries the same cell with no hand edit. | 1 | "`bin/generate-model-table --check` exits zero against the committed generated region." | diff-local |
| Story 1 negative: Given the evaluator row still names any retired selection category such as value objects, pure functions, config, infra, view templates, or complex domain interactions, when the metadata specification runs, then it fails and names the retired category. | 2 | "The metadata specification fails, naming the category, when any of the seven enumerated retired categories appears in the evaluator row's `claudeModel` or `why`." | diff-local |
| Story 1 negative: Given the generated model-selection region is edited by hand instead of regenerated from the metadata, when the generator drift check runs, then it exits non-zero and reports the differing row. | 2 | "The generator acceptance specification proves a hand-mutated evaluator row in the marked region makes check mode exit non-zero and name that row." | diff-local |
| Story 2 happy: Given the code-review dispatch guidance, when its evaluator model selection is read, then it offers exactly two choices, a default and a risk-domain top tier, using the same five risk domains as the metadata row. | 3 | "The code-review evaluator model-selection block offers exactly two choices and names concurrency, state mutation, security, auth, and money." | diff-local |
| Story 2 happy: Given the pipeline batch-boundary guidance, when its evaluator scaling table is read, then a stated risk-domain override raises that batch's evaluator to the top tier while the table's intermediate and final frequency columns are unchanged. | 4 | "An override statement beneath that table names concurrency, state mutation, security, auth, and money and raises that batch's evaluator to the top Claude tier." | diff-local |
| Story 2 negative: Given a dispatch line names a Claude model parameter without naming Claude on that same line, when the provider skill contract audit runs, then it rejects the file as unscoped Claude model selection. | 5 | "An injected unscoped Claude model parameter is rejected by the specification, and the committed code-review text passes the same per-line rule." | diff-local |
| Story 2 negative: Given the dispatch guidance drops or reworks the fresh-context isolation statement or a frequency column of the pipeline scaling table, when the guidance specification runs, then it fails. | 4, 5 | "The specification fails if the evaluator fresh-context isolation sentence is removed from either skill file." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by files this diff changes, plus the generator and audit already committed. Task 1 owns the integration proof at the real production entry point — `bin/generate-model-table` executed end to end against the committed marked region, which is the only path that rewrites it and the same one integrity check 5a runs; a unit assertion on the typed row alone would prove the constant changed but not that the shipped table did. Task 2 owns both negative cases for the metadata and the generated region, using the generator acceptance file's existing temporary marked-region fixtures. Tasks 3 and 4 own the shipped-guidance cases in the new focused specification file, one skill each. Task 5 owns the provider-scoping rejection and the unchanged-surface regressions in that same file, using in-memory mutated copies. All cases are unit level over an imported constant and committed text; none constructs a conductor, dispatches a provider, or reaches any external service, so no fake beyond in-memory string fixtures is required. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3 -> Task 4 -> Task 5
