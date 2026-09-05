# Implementation Plan: Migration authoring gate recognizes every runnable fence

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2152
**Stories:** .docs/stories/migration-authoring-gate-recognizes-every-runnable.md
**Conflict check:** No blocking conflicts identified; Small composer route skips a separate conflict-check artifact.

## Summary

Two tasks give the migration runner and authoring checker one fence recognizer and prove that every runnable unsafe block is inspected. Retain the runner's current execution language and the checker's extra attribution restrictions.

## Technical Approach

Extract the existing Python fence scanner into `bin/lib/migration_fences.py`, importable without executing a script. The scanner owns Markdown fence context, marker/width, normalized opening info, closing recognition, Migration-section membership, original line numbers, and completion. It reports top-level migration candidates with source spans, script text, whether they are in a Migration section, and whether they closed. Runtime extraction selects only closed candidates inside Migration sections; authoring additionally retains its existing unattributed/unterminated candidate rejection. Version interval selection and ordering remain in `bin/migrate`; do not put those runtime-only filters in the shared lexical recognizer.

Opening semantics come from the existing runner: no added indentation support, exactly three opening backticks for runnable `bash migration`, Python `strip()` around the info string, and no executable interpretation of longer opening fences or tildes. Track every surrounding fence so candidate-looking text in an example is inert. Closing markers must match the opener and be at least its width with only whitespace afterward. A new heading ends Migration membership only outside fences, using the runner's current heading rules. Do not introduce a second regex interpretation for the checker.

Keep Bash's existing command-clause checks and diagnostics. Have a small Python entry path in the shared helper emit source-associated candidate records to a checked temporary file for Bash consumption. Use NUL-delimited fields for original line number, record kind, and literal source text so shell metacharacters, tabs, quoting, and whitespace are not evaluated or lost. The checker must check the producer exit status before processing records, reject incomplete/unknown records, and preserve release-header context and original line numbers. Avoid a process substitution whose producer failure looks like an empty successful scan. The interchange is ephemeral local parser output, not a telemetry channel or durable ledger.

Follow the existing `assert_fixture` pattern in `test/test_migration_block_authoring.sh`: invoke the real checker on a temporary Markdown file and assert exit status plus line/clause text. Follow `test/test_bin_migrate_parse.sh` to call the real extraction helper without running installation or scripts. Scratch harness fixture setup in `test/test_bin_migrate_approval.sh` and `test/test_bin_migrate_multi_version_jump.sh` must carry the new library file. Reuse these bounded fixtures rather than invoking real installs, GitHub, package registries, or consumer operations.

## Prerequisites

None. Python is already used by the migration runner, Bash by the authoring checker, and both test seams exist. No changed dependency, CLI option, configuration, hook, release artifact, or migration semantics. GitHub lists no blocked-by dependencies for #2152.

## Tasks

### Task 1: Share the existing migration fence recognizer without changing extraction

**Story:** 1, H3
**Type:** refactor
**Files:** bin/lib/migration_fences.py; bin/migrate; test/test_bin_migrate_parse.sh; test/test_bin_migrate_approval.sh; test/test_bin_migrate_multi_version_jump.sh
**Dependencies:** none

**Steps:**

1. Add focused recognizer fixtures beside the existing parser-order fixture. Assert candidate source spans, section membership, closed status, and exact script text for canonical/trailing whitespace/CRLF info strings, wider closers, outer backtick/tilde examples, repeated Migration headings, and unterminated candidates. The missing shared module/API provides scoped RED; do not alter consumer execution policy to manufacture a failure.
2. Extract the Python state machine into the named importable helper. Keep lexical recognition shared, exposing candidate metadata so the authoring caller can apply its stricter policy. Preserve the original text and physical line numbering. No candidate source is executed or interpolated into a shell command.
3. Replace only `bin/migrate`'s nested fence scan with that shared scanner. Keep version parsing, version interval filtering, sorted release ordering, within-release ordering, comments, and existing output marker formatting. Resolve the helper from the harness installation, not the consumer working directory.
4. Update the two scratch-harness-copy fixtures to include the helper, then run the parser, approval, and multi-version fixture scripts. Follow the existing isolated harness setup and fake boundary behavior; no real installation or network access.
5. Commit the shared recognizer and behavior-preserving runtime integration after required verification.

**Done when:**

- Focused parser tests prove the named shared scanner returns the expected source spans, original script text, section membership, and completeness for the enumerated lexical cases.
- `test/test_bin_migrate_parse.sh` retains its existing exact multi-release output and identity assertions and passes; the approval and multi-version fixtures also pass with the helper packaged in their scratch harnesses.
- Runtime version selection, approval policy, and script execution paths are unchanged in the diff; only recognition delegation and required fixture packaging change.

### Task 2: Apply the existing authoring clauses to every runnable candidate

**Story:** 1, H1–H2 and N1–N4
**Type:** happy-path
**Files:** bin/lib/migration_fences.py; test/check_migration_block_authoring.sh; test/test_migration_block_authoring.sh
**Dependencies:** 1

**Steps:**

1. Extend `assert_fixture` coverage using the real runtime extraction helper as an independent caller of the shared recognizer. Build a table of canonical, trailing space, trailing tab, spacing before `bash migration`, CRLF, longer/whitespace closing fences, and consecutive blocks with `##` or `### Migration`. For each runnable case, assert extraction contains the sentinel unsafe command and the checker fails at its original source line; clean counterparts must pass. First reproduce the current checker bypass (RED).
2. Replace the checker's literal fence toggling with the shared candidate stream. Preserve existing `strip_quoted_strings`, prohibited-command clauses, release attribution, original diagnostics, archive exemption, and comments/echo treatment. Use the NUL record protocol described above without evaluating source text. The scanner tracks section/fence context; authoring may reject extra malformed or unattributed candidates but must never omit a runtime-executable candidate.
3. Add nested backtick and tilde examples containing migration-looking snippets followed by a genuine unsafe block. Assert the runtime extracts only the genuine script, and the checker rejects that script at the correct line. Include nonrunnable opening widths/indentation so no formatting change broadens execution. Keep existing unattributable/unterminated rejection and archive-exemption fixtures.
4. Add bounded failure fixtures for an unavailable recognizer and invalid/truncated record output using a scratch checker/helper location. Assert explicit nonzero diagnostic and no PASS. The helper invocation's exit status must be checked before consuming its temporary output; await and clean up all local fixtures.
5. Run the authoring fixtures and existing migration parser fixtures through their repository verification paths; verify Bash syntax and ShellCheck for modified scripts. Commit the safety fix and its regression coverage only after the full required integrity suite passes.

**Done when:**

- Every enumerated runnable-format fixture containing a forbidden command fails the real authoring checker with original line and clause, while each clean counterpart passes; each case proves runtime extraction of that same script without executing it.
- Nested examples and nonrunnable opener forms remain non-executable, and later genuine unsafe blocks are still checked after wider or whitespace-bearing closers.
- Existing attribution/unterminated-candidate rejections and the archive exemption remain covered, and unavailable/invalid recognizer output produces an explicit nonzero failure with no PASS.
- The changed checker imports its recognition from the shared scanner, retains the existing command-clause behavior, and passes syntax, ShellCheck, scoped fixture tests, and full integrity validation.

## Coverage and claims

Task 1 owns the runtime extraction integration and H3. Task 2 owns checker integration and H1–H2/N1–N4. Test layers are local parser/checker integrations; the fixture inclusion check compares actual caller outputs instead of grepping implementation text. No additional terminal catch-all task is needed.

Verified: the runner already relies on Python; `migration_fences` has a finite fence/section state machine; existing Bash fixtures call the extraction helper without executing migrations; the attribution-rejection fixture covers an orphan candidate outside a Migration heading. No new API or implementation behavior is assumed beyond the explicitly defined shared scanner. Verify-claims: CLEAR.
