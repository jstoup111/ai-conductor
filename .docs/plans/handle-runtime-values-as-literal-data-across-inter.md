# Implementation Plan: Runtime values remain literal data

**Date:** 2026-09-06
**Track:** technical
**Tier:** M
**Stories:** .docs/stories/handle-runtime-values-as-literal-data-across-inter.md
**Architecture:** .docs/decisions/architecture-review-2026-09-06-handle-runtime-values-as-literal-data-across-inter.md
**Conflict check:** CLEAN, operator-approved 2026-09-06
**Source:** jstoup111/ai-conductor#1478

## Technical Approach

Nine scoped tasks repair direct interpreter-source construction and enforce the same invariant in repository validation. Existing Python/Node snippets become fixed source with separately quoted argv. Runtime failures are surfaced according to their existing callers: required commit lookup rejects, installer helpers return failure to warning-and-continue callers, and the session summary warns without blocking. Preserve existing formats, settings merge behavior, ID normalization, hook exemptions/chaining and advisory scope checks.

The checker uses a bounded, quote-aware shell lexical scan of direct Python command-source/heredoc and Node eval forms. It records shell expansion spans with physical locations, not language-specific string patterns, and never executes candidate shell text. A source inventory runner examines shipped scripts and actual rendered git/session hook exports; a repository integrity wrapper invokes it. Classification (Tasks 6–7), inventory (8), and live gate wiring (9) have separate behavior owners.

Local patterns: generated PRE_DISPATCH_HOOK demonstrates fixed Node source and argv; bin/migrate demonstrates quoted Python heredocs and argv. Reuse those semantic traits, not their unrelated locking/migration behavior. The installer boundary fixture can follow the existing named-function extraction pattern in test_install_docs_guard_wiring.sh; do not copy its interpolated fixture shell strings. Existing local-Git hook fixtures demonstrate the smallest real boundary for hook lookup. No new runtime, parser package, persistence schema, event channel, or remote service is introduced.

The fixed session-start path is preventive cleanup. The original bin/conduct state/assess examples are obsolete because that launcher was removed; do not restore them. Python removal belongs to #2266. This change does not expand plan-task/Git-trailer grammar, promise arbitrary downstream shell-command path execution, or add atomic-write/locking guarantees.

## Preconditions and verification ownership

The same-stem stories, track, Medium marker, architecture diagram/review and conflict report are accepted. BUILD runs in its own prepared worktree with project dependencies available. Resolve source symbols on that checkout before editing; the authoring-time paths are location hints, not frozen line coordinates. Respect the existing third-party isolation policy. Each behavior-owning task establishes scoped RED/GREEN evidence via ai-conductor scoped-run and commits only after required repository validation. Aggregate proof belongs to test_suite and SHIP.

Every criterion below is diff-local: it describes controlled behavior of changed script/checker boundaries and their fixtures, not an external branch, issue status, or live service. Existing compatibility cases are exercised through the changed boundary, not made dependent on another feature shipping. No task mutates a different feature’s sealed artifact.

## Tasks

### Task 1: Pass commit lookup values separately from JavaScript source

**Story:** 1 — S1.1, S1.2, S1.N1, S1.N3
**Type:** happy-path

**Steps:**
1. Extend the existing bounded local-Git fixtures to execute buildCommitMsgHook output, with a controlled successful scope-check launcher. Seed numeric/string IDs and matching or missing single-line IDs containing single/double quotes, backslashes, and interpreter-looking text. Vary repository paths independently, including spaces. A harmless sentinel path must remain absent. Do not run prepare-commit-msg when testing supplied trailer lookup: that separate hook owns stamping.
2. Run the scoped fixture through ai-conductor scoped-run and establish RED on current source interpolation. Preserve existing sufficient exemption, missing-trailer/status-file, task-N, and advisory-scope tests; add only uncovered assertions.
3. Follow session-hook-assets.ts PRE_DISPATCH_HOOK: fixed single-quoted Node source reads process.argv; pass both status-file path and trailer as separately shell-quoted arguments. Preserve String-based row-ID comparison, lookup guards, exemptions, scope-check invocation, and repository-hook chaining. Use an explicit option terminator where necessary so a value cannot become a Node option. Do not adopt the PRE hook’s locking/state-write behavior.
4. Run the scoped tests to GREEN and commit the transport repair.

**Done when:**
1. The rendered commit-msg integration accepts matching literal trailer/path variants (spaces, single/double quotes, backslashes, interpreter-looking text), rejects absent literal IDs, and leaves all harmless execution sentinels absent.
2. The same rendered hook accepts numeric and string-equivalent IDs; existing merge/amend/rebase/engine exemptions, missing trailer/status-file pass-through, task-N/unknown-ID rejection, advisory scope-check behavior, and chained-hook behavior retain their observed results.
3. The generated lookup source contains no expansion of status-path or trailer values; they reach Node as separate arguments.

**Files:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-hook-assets.test.ts`

**Dependencies:** none

### Task 2: Distinguish commit lookup processing errors from non-matches

**Story:** 1 — S1.N2
**Type:** negative-path

**Steps:**
1. Add rendered-hook integration cases for malformed JSON, a required read failure, Node unavailable, and Node exiting nonzero. Use controlled PATH/process/file conditions for deterministic failures, not chmod assumptions under root.
2. Establish RED: current suppression reports these as not-found. Capture subprocess status explicitly under set -e; retain yes/no output only for successful processing. Emit a contextual stderr error on interpreter/read/parse failure, and reject with a nonzero hook exit distinct in diagnostic text from a successful lookup returning no.
3. Preserve the existing missing-status-file bypass and ordinary absent-ID diagnostic. Reuse the fixture and transport in Task 1; do not change scope-check error policy.
4. Run scoped RED/GREEN tests and commit the processing-error fix.

**Done when:**
1. Rendered-hook integration rejects malformed JSON, required-read failure, missing Node, and failing Node with a contextual processing-error diagnostic rather than the ordinary ID-not-found message.
2. Processing failures never print a successful match, while an ordinary absent ID retains its normal rejection and a missing status file retains its bypass.

**Files:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-hook-assets.test.ts`

**Dependencies:** 1

### Task 3: Make permission configuration literal and truthful on failure

**Story:** 2 — S2.1, S2.2, S2.N1, S2.N2, S2.N3 (permissions)
**Type:** happy-path

**Steps:**
1. Add a bounded shell integration fixture invoking the real configure_permissions function against temporary settings. Follow test_install_docs_guard_wiring.sh’s function-boundary pattern to avoid the installer main; locate the named function through its heredoc terminator and top-level closing brace, asserting extraction succeeds. Pass fixture paths via positional arguments rather than interpolated bash -c text. Fake logging only; execute the real Python/JSON operation.
2. Cover settings and temporary directory paths with single/double quotes, backslashes, spaces, newlines, and harmless interpreter-looking text; assert intended file contents, no sentinel execution, preservation of unrelated settings, and idempotent permission merge. Establish RED on current unquoted source heredoc.
3. Use a quoted Python heredoc and sys.argv for settings/perms paths, following bin/migrate’s fixed-source pattern. Preserve permission contents and temp-file cleanup. Capture interpreter exit status before cleanup; report failure without success for missing/failing Python, read/parse/write failures. Retain the installation caller’s warning-and-continue policy.
4. Run the named integration via the scoped runner, including malformed-input byte preservation and caller-warning proof; commit the permission fix.

**Done when:**
1. The real configure_permissions integration preserves exact settings/temp paths containing quotes, backslashes, spaces, newlines, and interpreter-looking text; the intended permissions are stored, unrelated settings survive repeated merges without duplicates, and execution sentinels stay absent.
2. Missing/failing Python and read/parse/write failure cases return nonzero with contextual failure output and no success report; malformed input remains byte-identical, temp cleanup still runs, and the existing caller emits its incomplete-configuration warning and continues.

**Files:**
- `bin/install`
- `test/test_install_literal_configuration.sh`

**Dependencies:** none

### Task 4: Make hook configuration literal and propagate its failure

**Story:** 2 — S2.1, S2.2, S2.N1, S2.N2, S2.N3 (hooks)
**Type:** happy-path

**Steps:**
1. Extend Task 3’s fixture to invoke the real configure_hooks function with independently varied settings and HARNESS_DIR paths. Parse output JSON to assert the exact hook-directory strings; this is serialization coverage, not a claim that every generated downstream command string is executable for arbitrary path grammars.
2. Establish RED on path interpolation and on the currently missing explicit failure return. Cover custom hook preservation and repeated merges, including the existing docs-guard wiring test as compatibility proof.
3. Pass settings and hook-directory paths to fixed Python source through argv using a quoted heredoc. Retain event/matcher/timeout/merge definitions. Capture status explicitly and return nonzero on missing/failing interpreter, read/parse/write failure, after existing contextual warning/manual hint; leave install() warning-and-continue intact.
4. Run scoped tests for literal paths, negative cases, malformed-input byte preservation and caller-warning propagation; commit. Adjust old fixture extraction only if quoting changes expose its parser assumption, not merely to match new source wording.

**Done when:**
1. The real configure_hooks integration writes exact settings and hook-directory strings for quotes, backslashes, spaces, newlines, and interpreter-looking text; repeated merges preserve unrelated/custom hooks without duplicate managed entries and without sentinel execution.
2. Missing/failing Python and read/parse/write failure cases return nonzero with contextual failure output and no success report; malformed input remains byte-identical and the existing installation caller warns and continues.
3. The existing docs-guard hook entries, matchers, timeouts, and custom-hook preservation remain equivalent in parsed settings.

**Files:**
- `bin/install`
- `test/test_install_literal_configuration.sh`
- `test/test_install_docs_guard_wiring.sh`

**Dependencies:** 3

### Task 5: Keep session summary literal and visibly non-blocking on errors

**Story:** 3 — all happy and negative criteria
**Type:** negative-path

**Steps:**
1. Run the actual session-start script in a temporary project containing only controlled pipeline state; avoid editing the live checkout or operator config. Assert string-valued done/skipped counts and remaining context output. Use state keys/values containing quotes and interpreter-looking text with a harmless sentinel assertion. Keep the current fixed relative state path; do not add an override.
2. Add malformed/unreadable state, missing/failing Python, and absent-file cases. Establish RED on the swallowed diagnostic; existing happy counting is compatibility proof, not the RED claim.
3. Pass PIPELINE_STATE as an argument to fixed Python source, preserving filtering/count logic. On a processing failure write a contextual warning to stderr and continue the summary’s existing non-blocking path. Missing state stays quiet. Retain remaining context output and existing bookkeeping; introduce no additional state mutation.
4. Run scoped RED/GREEN integration and commit the summary repair.

**Done when:**
1. The actual session-start hook reports the expected done/skipped count over string-valued state, treats quoted/interpreter-looking JSON content literally without sentinel execution or additional state mutation, and completes its remaining context output.
2. Absent state quietly omits the summary; malformed/unreadable state or missing/failing Python produces a contextual stderr warning, no fabricated success summary, and continued output with the existing non-blocking summary exit policy.
3. The fixed relative pipeline-state path remains unchanged and travels as an argument, with no new test-only path override.

**Files:**
- `hooks/claude/session-start-context.sh`
- `test/test_session_start_summary.sh`

**Dependencies:** none

### Task 6: Classify shell expansions inside direct interpreter command strings

**Story:** 4 — S4.1, S4.N1 (command-source forms)
**Type:** infrastructure

**Steps:**
1. Create an inert checker module that receives {sourceName,text} and returns located findings. RED fixtures include python/python3 -c and node -e/--eval with unquoted or double-quoted source parameter expansions, command substitutions, and backticks, plus multiline/escaped-newline source. Safe twins use static single-quoted source and separate argv/stdin/environment data, or escaped literal dollars.
2. Implement a quote-aware lexical walk carrying normal/single-quote/double-quote/escape/comment state, source offsets and line numbers. Tokenize complete shell words and command boundaries, including nested command-substitution regions, then identify direct interpreter command-source argument words. Record shell expansion spans rather than scanning decoded JavaScript/Python for dollar signs. Ordinary data arguments after the source word are not source.
3. Support direct python/python3 -c and node -e/--eval, including --eval=source, whitespace-separated arguments, common absolute interpreter paths, and multiline words. Conservative diagnostics for an incomplete quote or unresolvable source word at a recognized call identify that call; do not execute shell specimens or introduce a third-party parser dependency. Arbitrary aliases, eval-driven command dispatch, and general interprocedural dataflow are outside this declared check.
4. Run unit RED/GREEN fixtures proving locations and no specimen execution; commit the command-source classifier. The module remains pure until Task 8 supplies inventory and Task 9 supplies repository invocation.

**Done when:**
1. Classifier unit fixtures reject shell parameter, command-substitution, and backtick expansion inside direct Python -c and Node -e/--eval source, including multiline words, escaped newlines, and --eval=source, with source name and line.
2. Static source with separately passed argv/stdin/environment data, protected literal dollar characters, comments and safe multiline words passes the classifier; malformed recognized source is reported, and no fixture code is executed.

**Files:**
- `src/conductor/scripts/interpreter-source-check.ts`
- `src/conductor/test/scripts/interpreter-source-check.test.ts`

**Dependencies:** none

### Task 7: Recognize expanded interpreter heredoc source

**Story:** 4 — S4.1, S4.N1 (stdin/heredoc forms)
**Type:** infrastructure

**Steps:**
1. Add RED fixture pairs for python/python3 stdin source supplied by << and <<- heredocs. Include quoted and partially quoted delimiters, unquoted delimiters, tab stripping, multiple queued heredocs, shell parameter expansion, command substitution and backticks. Here-doc body quotes do not suppress shell expansion when its delimiter is unquoted.
2. Extend Task 6’s lexical walk with queued delimiter records including quote-removal and expansion eligibility. Associate stdin redirections with the recognized interpreter command; consume body text only after the command line completes, preserving physical locations and <<- tab behavior. Inspect eligible bodies for shell expansions with heredoc escape rules.
3. Accept unexpanded quoted-delimiter source and unquoted bodies that contain no shell expansion. Reject an unterminated recognized interpreter heredoc with its source location; exclude here-doc bodies from normal shell command tokenization so Python/JS text cannot create phantom calls.
4. Run scoped unit RED/GREEN tests for the combined command/heredoc classifier and commit.

**Done when:**
1. Heredoc unit fixtures reject parameter expansion, command substitution and backticks in expanding Python stdin-source heredocs, including multiline bodies, <<- tab stripping, and multiple queued delimiters, with the physical source line.
2. Fully or partially quoted heredoc delimiters and constant non-expanding source pass; an unterminated recognized interpreter heredoc fails visibly, body text creates no phantom shell calls, and no specimen is executed.

**Files:**
- `src/conductor/scripts/interpreter-source-check.ts`
- `src/conductor/test/scripts/interpreter-source-check.test.ts`

**Dependencies:** 6

### Task 8: Scan shipped files and actual generated hook exports

**Story:** 4 — S4.2, S4.N2, S4.N3
**Type:** infrastructure

**Steps:**
1. Create the inventory runner over an explicit repository root and controlled asset loader seam. Enumerate all shell-shebang bin entrypoints, recursively include bin shell libraries and hooks shell files, sort/deduplicate stable relative paths, and ignore test/docs trees. Read files without executing scripts.
2. Load actual git-hook-assets and session-hook-assets module namespaces and inspect each exported string as emitted shell, labeling findings module-path#export plus rendered line. Verify all expected namespaces contain scripts. Treat the known buildCommitMsgHook builder as paired with its COMMIT_MSG_HOOK string; reject an unclassified non-string export rather than silently ignoring a potentially new generated hook. New string exports are scanned automatically. The classifier must receive rendered strings, not TypeScript source spelling.
3. Add narrow runner integration fixtures: new unsafe bin script, new unsafe rendered string export, safe twins, ignored docs/test specimens, required input read failure, empty script or generated inventory, loader failure, and unclassified export. Assert failures through the runner entrypoint with source/location and nonzero status. Use a controlled loader for failure specimens; the normal production loader imports the actual modules.
4. Expose the runnable .mts command using the repository’s installed Node/tsx tooling; no package download or candidate execution. Establish RED before implementation, run scoped GREEN, and commit the inventory runner.

**Done when:**
1. The inventory entrypoint discovers newly added shipped bin/hook scripts and shell libraries plus all rendered string exports from both hook-asset modules; unsafe additions fail with source/location while safe additions pass.
2. Required file-read failure, empty shipped/generated inventory, generated-module load failure, and an unclassified generated export each produce nonzero validation status rather than success over a partial scan.
3. Documentation and test-only unsafe specimens do not enter the production inventory; explicit classifier fixtures still inspect them without execution.

**Files:**
- `src/conductor/scripts/check-interpreter-source.mts`
- `src/conductor/scripts/interpreter-source-check.ts`
- `src/conductor/test/scripts/interpreter-source-inventory.test.ts`

**Dependencies:** 7

### Task 9: Wire interpreter-source validation into repository integrity

**Story:** 4 — S4.1, S4.2, S4.N2; integrity entrypoint
**Type:** infrastructure

**Steps:**
1. Add a small shell entrypoint resolving this checkout and invoking Task 8’s runner via installed Node/tsx from src/conductor. Do not use npx download fallback, a global stale engine, or a primary-checkout source tree. Forward checker exit status and stderr.
2. Wire that entrypoint into test_harness_integrity.sh using its existing named-check/assert convention; capture a failing checker status without set -e discarding its diagnostic. Do not alter ShellCheck’s threshold or the rest of the suite.
3. Prove the new wiring with a bounded integrity-call fixture that runs the actual new invocation block with a controlled checker result and verifies its result reaches the integrity failure accounting; never invoke the full integrity or aggregate suite recursively from a unit test. Separately exercise the shell wrapper against Task 8’s controlled source/asset fixture. Establish RED when the invocation is absent or drops nonzero status.
4. Run scoped RED/GREEN coverage and commit the live validation integration. This task implements a named entrypoint; aggregate validation remains the normal engine gate, not an additional plan task.

**Done when:**
1. The actual repository integrity invocation reaches the new checker wrapper and records its nonzero result as a failed check with the checker diagnostic; a zero result records a pass.
2. The wrapper resolves and scans its own checkout, propagates unsafe-input/read/render failure status, and passes safe shipped-script/generated-asset inputs without downloading tooling.
3. The wiring test is bounded to this invocation and never starts a recursive full integrity, aggregate suite, daemon, or third-party service.

**Files:**
- `test/check_interpreter_source.sh`
- `test/test_harness_integrity.sh`
- `src/conductor/test/scripts/interpreter-source-wiring.test.ts`

**Dependencies:** 1, 2, 3, 4, 5, 8

### Task 10: Record the release waiver for the installer surface

**Story:** 2 — S2.1, S2.2 (installer helpers; no consumer-visible surface change)
**Type:** infrastructure

**Steps:**
1. Write `.docs/release-waivers/handle-runtime-values-as-literal-data-across-inter.md` with a `Waives:` line naming `skill symlink targets` verbatim and a non-empty `Rationale:` stating that the release-gate classifier maps every `bin/install` edit to that surface, while this diff only rewrites the installer's permission and hook helpers to fixed interpreter source with argv and explicit failure status; no skill symlink is added, removed, retargeted, or renamed, and no CLI grammar, hook wiring, or settings schema changes.
2. Confirm the waiver is part of this feature's `base...HEAD` diff; a waiver merged by an earlier feature never satisfies this one.
3. Commit with message: "chore(release): waive the skill-symlink-targets surface for #1478".

**Done when:**
1. The waiver file exists in the feature diff with `Waives: skill symlink targets` and a non-empty rationale that names the installer helpers as the only `bin/install` change.
2. The self-host release gate's breaking-surface check accepts the waiver for this diff and demands no migration block.

**Files:**
- `.docs/release-waivers/handle-runtime-values-as-literal-data-across-inter.md`

**Dependencies:** 4

## Task Dependency Graph

```text
1 -> 2 -----------------+
3 -> 4 -----------------+
     4 -> 10
5 ----------------------+--> 9
6 -> 7 -> 8 ------------+
```

Dependencies reflect shared files and the gate becoming usable only after its known violations are repaired. Tasks 1, 3, 5 and 6 are independent roots; shared bin/install and shared checker modules serialize their respective edits. Task 10 records the release waiver after the last bin/install edit so the waiver rides this feature's own diff. No task is a terminal catch-all validation exercise.

## Integration ownership

| Boundary behavior | Owning task |
|---|---|
| Rendered commit-hook literal lookup and compatibility | 1 |
| Rendered commit-hook processing-error classification | 2 |
| Permissions helper to settings files and caller failure warning | 3 |
| Hooks helper to settings files and caller failure warning | 4 |
| Actual session-start summary to state and stderr | 5 |
| Shipped/rendered inventory to checker result | 8 |
| Repository integrity invocation to checker pass/failure | 9 |

Tasks 6–7 are pure classification units consumed by Task 8; they do not each require separate production entrypoint tests.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: S1.1: Given a local repository whose path contains spaces, single/double quotes, backslashes, or interpreter-looking text, and a status file containing a matching supplied single-line Task trailer value, when the generated commit-msg hook validates it, then lookup succeeds, without a syntax failure or unintended sentinel side effect. Exercise the trailer variants separately from repository-path variants; preserve Git's existing trailer parsing rather than defining multiline trailer values. | 1 | "The rendered commit-msg integration accepts matching literal trailer/path variants (spaces, single/double quotes, backslashes, interpreter-looking text), rejects absent literal IDs, and leaves all harmless execution sentinels absent." | diff-local |
| Story 1 happy: S1.2: Given a numeric ID or its string equivalent in a valid task-status file, when the matching trailer is validated, then the same match succeeds. Given an existing exemption or a missing trailer/status file, when the hook runs, then its existing pass-through behavior remains intact. | 1 | "The same rendered hook accepts numeric and string-equivalent IDs; existing merge/amend/rebase/engine exemptions, missing trailer/status-file pass-through, task-N/unknown-ID rejection, advisory scope-check behavior, and chained-hook behavior retain their observed results." | diff-local |
| Story 1 negative: S1.N1 (S1.1): Given an absent task ID containing quotes, backslashes, or interpreter-looking text, when the hook validates it, then it rejects as an ordinary non-match and no sentinel side effect occurs. The ID must not become a different existing ID through source interpretation. | 1 | "The rendered commit-msg integration accepts matching literal trailer/path variants (spaces, single/double quotes, backslashes, interpreter-looking text), rejects absent literal IDs, and leaves all harmless execution sentinels absent." | diff-local |
| Story 1 negative: S1.N2 (S1.1): Given a present status file that is malformed or unreadable, or an unavailable/failing Node interpreter, when lookup is required, then the hook rejects with a contextual processing-error diagnostic distinguishable from an ordinary non-match; it never prints a successful match or hides the error behind a not-found fallback. | 2 | "Rendered-hook integration rejects malformed JSON, required-read failure, missing Node, and failing Node with a contextual processing-error diagnostic rather than the ordinary ID-not-found message." | diff-local |
| Story 1 negative: S1.N3 (S1.2): Given a task-N trailer or a genuinely absent numeric/string ID, when validation is required, then existing rejection behavior remains. Missing evidence trailers do not become a new rejection condition, and advisory scope-check results do not become blockers. | 1 | "The same rendered hook accepts numeric and string-equivalent IDs; existing merge/amend/rebase/engine exemptions, missing trailer/status-file pass-through, task-N/unknown-ID rejection, advisory scope-check behavior, and chained-hook behavior retain their observed results." | diff-local |
| Story 2 happy: S2.1: Given settings, temporary-file, and harness-directory paths containing quotes, backslashes, spaces, newlines, or interpreter-looking text supported by the filesystem, when either configuration helper runs, then it reads/writes the exact intended paths and preserves literal hook-directory strings in settings. No unintended sentinel side effect occurs. This criterion covers configuration serialization, not new support for every downstream shell command-path grammar. | 3, 4 | "The real configure_hooks integration writes exact settings and hook-directory strings for quotes, backslashes, spaces, newlines, and interpreter-looking text; repeated merges preserve unrelated/custom hooks without duplicate managed entries and without sentinel execution." | diff-local |
| Story 2 happy: S2.2: Given pre-existing unrelated settings and custom hook/permission entries, when the helpers configure settings and repeat the same operation, then unrelated values remain unchanged and managed entries are not duplicated. | 3, 4 | "The real configure_hooks integration writes exact settings and hook-directory strings for quotes, backslashes, spaces, newlines, and interpreter-looking text; repeated merges preserve unrelated/custom hooks without duplicate managed entries and without sentinel execution." | diff-local |
| Story 2 negative: S2.N1 (S2.1): Given an unavailable/failing Python interpreter, unreadable input, malformed settings JSON, or unwritable target, when either helper runs, then that helper returns nonzero and reports which configuration operation failed, with no success message. The existing installation caller continues with its incomplete-configuration warning policy. | 3, 4 | "Missing/failing Python and read/parse/write failure cases return nonzero with contextual failure output and no success report; malformed input remains byte-identical and the existing installation caller warns and continues." | diff-local |
| Story 2 negative: S2.N2 (S2.2): Given malformed settings that cannot be parsed, when configuration fails, then the original settings bytes remain unchanged rather than being replaced with a new default document. For write failures, no atomic rollback guarantee beyond current behavior is introduced; the failure must be surfaced. | 3, 4 | "Missing/failing Python and read/parse/write failure cases return nonzero with contextual failure output and no success report; malformed input remains byte-identical and the existing installation caller warns and continues." | diff-local |
| Story 2 negative: S2.N3 (S2.1/S2.2): Given a valid path containing text that resembles Python or shell operations, when either helper runs, then only its intended configuration effects occur and existing unrelated settings survive. | 3, 4 | "The real configure_hooks integration writes exact settings and hook-directory strings for quotes, backslashes, spaces, newlines, and interpreter-looking text; repeated merges preserve unrelated/custom hooks without duplicate managed entries and without sentinel execution." | diff-local |
| Story 3 happy: S3.1: Given valid existing pipeline state with string-valued steps plus unrelated non-string fields, when the actual session-start hook runs, then it reports the same done/skipped count over string-valued steps and continues the remaining context output. | 5 | "The actual session-start hook reports the expected done/skipped count over string-valued state, treats quoted/interpreter-looking JSON content literally without sentinel execution or additional state mutation, and completes its remaining context output." | diff-local |
| Story 3 happy: S3.2: Given no pipeline state file, when the hook runs, then it omits the pipeline summary quietly and continues normal context output. | 5 | "Absent state quietly omits the summary; malformed/unreadable state or missing/failing Python produces a contextual stderr warning, no fabricated success summary, and continued output with the existing non-blocking summary exit policy." | diff-local |
| Story 3 negative: S3.N1 (S3.1): Given malformed/unreadable state or an unavailable/failing Python interpreter while state is present, when the hook runs, then it emits a contextual stderr warning, emits no fabricated successful summary, continues its remaining output, and exits according to its existing non-blocking summary policy. | 5 | "Absent state quietly omits the summary; malformed/unreadable state or missing/failing Python produces a contextual stderr warning, no fabricated success summary, and continued output with the existing non-blocking summary exit policy." | diff-local |
| Story 3 negative: S3.N2 (S3.1/S3.2): Given interpreter-looking or quoted text in state keys/values, when the hook reads the JSON, then it only contributes according to the existing string-value/count rules and causes no unintended execution or additional state mutation. An absent file is not misreported as a parsing error. | 5 | "The actual session-start hook reports the expected done/skipped count over string-valued state, treats quoted/interpreter-looking JSON content literally without sentinel execution or additional state mutation, and completes its remaining context output." | diff-local |
| Story 4 happy: S4.1: Given shipped scripts and rendered hook assets using fixed Python or Node source with separately supplied data, when the repository interpreter-source validation entrypoint runs, then it succeeds. Quoted heredocs, literal dollar characters protected from shell expansion, multiline constant source, and argv/stdin/environment data transport are accepted. | 6, 7, 9 | "Static source with separately passed argv/stdin/environment data, protected literal dollar characters, comments and safe multiline words passes the classifier; malformed recognized source is reported, and no fixture code is executed." | diff-local |
| Story 4 happy: S4.2: Given a new shipped shell script or new rendered hook asset in the declared inventory, when validation runs, then that input is included automatically or an unclassified generated export makes the inventory check fail visibly; it cannot be silently omitted. Scope includes bin entrypoints and shell libraries, hooks, and rendered git/session hook assets; test fixtures and documentation examples are not production inputs. | 8, 9 | "The inventory entrypoint discovers newly added shipped bin/hook scripts and shell libraries plus all rendered string exports from both hook-asset modules; unsafe additions fail with source/location while safe additions pass." | diff-local |
| Story 4 negative: S4.N1 (S4.1): Given a direct Python -c/heredoc or Node -e/--eval source containing shell parameter expansion, command substitution, or backticks, including multiline variants, when validation runs, then it exits nonzero and identifies the source asset and location. Unsafe fixture text is inspected without being executed. | 6, 7 | "Classifier unit fixtures reject shell parameter, command-substitution, and backtick expansion inside direct Python -c and Node -e/--eval source, including multiline words, escaped newlines, and --eval=source, with source name and line." | diff-local |
| Story 4 negative: S4.N2 (S4.2): Given a newly added unsafe shipped script or unsafe rendered hook, when validation runs through its real entrypoint, then it rejects that addition. An empty inventory, required input read failure, render failure, or unclassified generated hook export is a validation failure, not success over partial inputs. | 8, 9 | "Required file-read failure, empty shipped/generated inventory, generated-module load failure, and an unclassified generated export each produce nonzero validation status rather than success over a partial scan." | diff-local |
| Story 4 negative: S4.N3 (S4.1/S4.2): Given an unsafe specimen only in a documentation example or test fixture, when the production inventory scan runs, then that out-of-scope specimen does not fail the production scan; it still remains available as explicit checker test input. | 8 | "Documentation and test-only unsafe specimens do not enter the production inventory; explicit classifier fixtures still inspect them without execution." | diff-local |

For rows spanning both installer helpers or both source forms, the cited tasks jointly provide coverage; the exact quote is one cited task’s obligation, and the sibling task carries the complementary named cases. There are no new ADR files with citable decisions in this change set, so an Architecture Obligation Coverage table is not required.

## Verify-Claims Ledger

Verified: current source locations and callable boundaries were read during exploration/review; the exact generated task lookup reproduced the apostrophe failure. Accepted stories and the clean conflict report are the input authority. The current interpreter-source check is new behavior; no claim is made that ShellCheck already catches this class. Node/tsx and Python are existing project tooling, not newly introduced dependencies. Scoped fixture transport must be literal too. The plan’s parser scope is explicit; it does not promise analysis of arbitrary dynamic shell programs.

All 19 extracted criteria have named task counterparts and exact completion-check quotes. Criterion locality is grounded in controlled local inputs and changed boundary behavior. No unconfirmed load-bearing assumptions remain. Verdict: CLEAR.
