# Coherence: Integrity suite checks fail closed (#1014)

**Plan:** .docs/plans/integrity-suite-two-checks-cannot-fail-one-warns-p.md
**Stories:** .docs/stories/integrity-suite-two-checks-cannot-fail-one-warns-p.md
**Track:** technical, so there are no FR rows. **Tier:** M.
**Source-Ref:** jstoup111/ai-conductor#1014

The staged intake outcomes (`.pipeline/intake-outcomes.md`) carry an empty `## Desired outcome`
section, so there are no outcome rows. The issue's desired outcomes are carried by the
operator-confirmed scope boundary in `.docs/track/integrity-suite-two-checks-cannot-fail-one-warns-p.md`
and covered by stories 1-5.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| story | story-1 | task-1, task-2 | covered | Check 5 fails on a skill missing from the model table |
| story | story-2 | task-3, task-4 | covered | Check 5b enforces model pins in both directions |
| story | story-3 | task-6, task-7 | covered | Check 5c never modifies the tracked docs-guard hook |
| story | story-4 | task-5 | covered | Missing prerequisites fail instead of skipping |
| story | story-5 | task-8, task-9 | covered | Check 10 audits skills for task-status writers |
| task | task-1 | story-1 | covered | Serves story 1. |
| task | task-2 | story-1 | covered | Serves story 1. |
| task | task-3 | story-2 | covered | Serves story 2. |
| task | task-4 | story-2 | covered | Serves story 2. |
| task | task-5 | story-4 | covered | Serves story 4. |
| task | task-6 | story-3 | covered | Serves story 3. |
| task | task-7 | story-3 | covered | Serves story 3. |
| task | task-8 | story-5 | covered | Serves story 5. |
| task | task-9 | story-5 | covered | Serves story 5. |
| adr | adr-2026-07-03-generated-model-table-single-source | story-1, story-2, story-4 | covered | Amended by #1014: D4's warn-and-skip degradation is superseded. Stories 2 and 4 implement the amendment; story 1 is the fail-closed check 5 it names. Decision-by-decision mapping (D1-D3 existing, D4 task-1/2/3/5, D5 no-change) is in the plan's Architecture Obligation Coverage; judged under §4f. |

## Criteria

| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Story 1 happy: Given a skill directory whose name has its own row in the `ARCHITECTURE.md` model table, when check 5 runs, then that skill passes | 1 | covered | "exits 0 for an exact-row skill" | diff-local |
| criterion | Story 1 happy: Given the `tdd` skill directory and model-table rows `tdd-red` and `tdd-green` but no `tdd` row, when check 5 runs, then `tdd` passes because its phase rows cover it | 1 | covered | "for `tdd` covered only by `tdd-red`/`tdd-green` rows" | diff-local |
| criterion | Story 1 happy: Given a skill with no row that appears on check 5's no-row allowlist with a non-empty reason, when check 5 runs, then that skill passes and the output names it as allowlisted | 1 | covered | "for an allowlisted row-less skill whose output names it as allowlisted" | diff-local |
| criterion | Story 1 happy: Given the repository as delivered by this change, when check 5 runs, then every skill passes and check 5 emits no WARN line | 1 | covered | "runs the checker against the real tree and asserts exit 0 and no `WARN` line" | diff-local |
| criterion | Story 1 negative: Given a skill directory with no model-table row, no phase rows, and no allowlist entry, when check 5 runs, then check 5 fails with a message naming that skill | 2 | covered | "exits non-zero naming the skill for a row-less skill with no alias and no allowlist entry" | diff-local |
| criterion | Story 1 negative: Given an allowlist entry whose reason is empty, when check 5 runs, then check 5 fails naming the entry instead of treating it as exempt | 2 | covered | "a non-zero exit naming the entry for an allowlist entry with an empty reason" | diff-local |
| criterion | Story 1 negative: Given an allowlist entry naming a skill that has no `skills/<name>/` directory, when check 5 runs, then check 5 fails reporting the stale entry | 2 | covered | "a non-zero exit reporting the stale entry for an allowlist entry whose `skills/<name>/` directory is absent" | diff-local |
| criterion | Story 1 negative: Given a model-table row `tdd-review` (a `tdd-` prefix that is not one of the skill's phase rows) but no `tdd-red` or `tdd-green` row, when check 5 runs, then `tdd` is not satisfied by prefix alone and fails unless allowlisted | 2 | covered | "a non-zero exit naming `tdd` when the fixture table has a `tdd-review` row but no `tdd-red` or `tdd-green` row" | diff-local |
| criterion | Story 2 happy: Given a non-exempt `--pins` entry expecting `opus` and a SKILL.md pinning `model: opus`, when check 5b runs, then that skill passes | 3 | covered | "asserts exit 0 for a matching `opus` pin" | diff-local |
| criterion | Story 2 happy: Given a `--pins` entry marked exempt and a SKILL.md with no pin, when check 5b runs, then that skill passes as exempt | 3 | covered | "an exempt entry with no pin" | diff-local |
| criterion | Story 2 happy: Given a skill with no `--pins` entry and no `model:` pin, when check 5b runs, then that skill passes without comparison | 3 | covered | "a skill with neither an entry nor a pin" | diff-local |
| criterion | Story 2 happy: Given the repository as delivered by this change, when check 5b runs, then `architecture-review`, `explore`, `prd`, `rebase`, and `remediate` each pin `model: opus` and pass | 3, 4 | covered | "with output naming `architecture-review`, `explore`, `prd`, `rebase`, and `remediate` as passing" | diff-local |
| criterion | Story 2 negative: Given a non-exempt `--pins` entry expecting `opus` and a SKILL.md with no `model:` line, when check 5b runs, then check 5b fails naming the skill and the expected model | 3 | covered | "exits non-zero with a message naming the skill and the expected model `opus`" | diff-local |
| criterion | Story 2 negative: Given a non-exempt `--pins` entry naming a skill that has no `skills/<name>/SKILL.md`, when check 5b runs, then check 5b fails naming the unresolvable skill rather than skipping it | 3 | covered | "a non-zero exit naming the skill for a non-exempt entry with no `skills/<name>/SKILL.md`" | diff-local |
| criterion | Story 2 negative: Given a SKILL.md pinning `model: sonnet` where `--pins` expects `opus`, when check 5b runs, then check 5b still fails as a disagreement (existing direction unchanged) | 3 | covered | "non-zero exits for a `sonnet`-vs-`opus` disagreement" | diff-local |
| criterion | Story 2 negative: Given a SKILL.md pin with no `--pins` entry, when check 5b runs, then check 5b still fails as unmapped (existing direction unchanged) | 3 | covered | "an unmapped pin" | diff-local |
| criterion | Story 3 happy: Given a clean checkout, when the full integrity suite runs to completion, then `hooks/claude/docs-guard.sh` is byte-identical to its pre-run content and `git status` shows it unmodified | 6 | covered | "Running the full `bash test/test_harness_integrity.sh` to completion from a clean checkout leaves `sha256sum hooks/claude/docs-guard.sh` byte-identical to its pre-run value and `git status --porcelain hooks/claude/docs-guard.sh` empty" | diff-local |
| criterion | Story 3 happy: Given the drift fixture, when check 5c runs it, then the generator's `--check` reports drift (exit 1) against a corrupted temporary copy and check 5c passes the fixture assertion | 6 | covered | "exits 0 because the generator's `--check` exits 1 against the corrupted temporary copy passed through `GENERATE_DOCS_GUARD_HOOK_OUT`" | diff-local |
| criterion | Story 3 happy: Given the committed hook matches the generator source, when check 5c runs, then the no-drift assertion passes against the tracked path | 6 | covered | "Section 5c still asserts `bin/generate-docs-guard-hook --check` passes against the tracked hook (no-drift assertion)" | diff-local |
| criterion | Story 3 negative: Given check 5c is interrupted (SIGINT or SIGKILL) while its fixture is running, when the working tree is inspected afterward, then `hooks/claude/docs-guard.sh` is unmodified, because the fixture never wrote to it | 7, 6 | covered | "is unchanged after the checker is killed with SIGKILL, and again with SIGINT" | diff-local |
| criterion | Story 3 negative: Given the generator ignores the target-path override and checks the tracked hook instead, when the fixture runs, then the fixture assertion fails (the clean tracked hook yields exit 0, not 1) rather than passing silently | 7 | covered | "exits non-zero when the stub generator ignores `GENERATE_DOCS_GUARD_HOOK_OUT` and exits 0 against the clean tracked hook" | diff-local |
| criterion | Story 3 negative: Given the temporary copy cannot be created, when check 5c runs, then the fixture assertion fails with a message naming the failure rather than falling back to writing the tracked hook | 7 | covered | "exits non-zero with a message naming the temporary-copy failure when `TMPDIR` points at a nonexistent directory, and that the tracked hook's hash is unchanged" | diff-local |
| criterion | Story 4 happy: Given `src/conductor/node_modules` exists and `jq` is on `PATH`, when the suite runs, then checks 5a, 5b, and 5c execute their comparisons and emit no WARN-skip line | 5 | covered | "asserts both modes exit 0 when `node_modules` exists and `jq` is on `PATH`" | diff-local |
| criterion | Story 4 negative: Given `src/conductor/node_modules` is absent, when the suite runs, then checks 5a, 5b, and 5c fail with a message naming the missing directory and the `npm ci` remedy in `src/conductor`, and the suite exits non-zero | 5 | covered | "prints both `src/conductor/node_modules` and `npm ci` when `HARNESS_INTEGRITY_CONDUCTOR_DIR` has no `node_modules`" | diff-local |
| criterion | Story 4 negative: Given `node_modules` is present but `jq` is not on `PATH`, when the suite runs, then check 5b fails with a message naming `jq` as missing, and checks 5a and 5c still execute | 5 | covered | "exits non-zero and prints `jq` when `PATH` lacks `jq`, while `node` with `node_modules` present still exits 0 (so 5a and 5c still execute)" | diff-local |
| criterion | Story 4 negative: Given `node_modules` is absent, when the suite runs, then later checks after 5c still run and the summary counts every failure (the run does not abort) | 5 | covered | "with no `exit` or `return` in that branch, so later sections still run and the failed count includes it" | diff-local |
| criterion | Story 5 happy: Given a SKILL.md line that only describes engine or hook behavior (for example, a hook "flips that row to `in_progress` in `.pipeline/task-status.json`"), when check 10 runs, then the line is not flagged | 9 | covered | "the descriptive hook line (`flips that row to `in_progress``)" | diff-local |
| criterion | Story 5 happy: Given a SKILL.md line that only reads the file (for example, "read `.pipeline/task-status.json` and confirm the row reads `completed`"), when check 10 runs, then the line is not flagged | 9 | covered | "the read-only `confirm the row reads `completed`` line" | diff-local |
| criterion | Story 5 happy: Given a SKILL.md line instructing an advisory scheduling write (for example, "Reset the task to `pending` in `.pipeline/task-status.json`"), when check 10 runs, then the line is not flagged | 9 | covered | "asserts exit 0 for a fixture containing only the `pending`-reset line (`Reset the task to `pending``)" | diff-local |
| criterion | Story 5 happy: Given a SKILL.md line on check 10's prose allowlist with a non-empty reason, when check 10 runs, then the line is not flagged | 9 | covered | "asserts exit 0 when a flagged line is covered by a `PROSE_WRITE_ALLOWLIST` entry with a non-empty reason" | diff-local |
| criterion | Story 5 happy: Given the repository as delivered by this change, when check 10 runs, then it passes | 8, 9 | covered | "runs the checker with the prose scan enabled against the real tree and asserts exit 0" | diff-local |
| criterion | Story 5 negative: Given a script under `skills/` that writes `.pipeline/task-status.json` (for example, `echo '{}' > .pipeline/task-status.json` in a `.sh` file), when check 10 runs, then check 10 fails naming the file and line | 8 | covered | "exits non-zero and prints `skills/x/run.sh` with its line number" | diff-local |
| criterion | Story 5 negative: Given a SKILL.md line instructing an agent to write an engine-only status (for example, "Mark the task `completed` in `.pipeline/task-status.json`"), when check 10 runs, then check 10 fails naming the file and line | 9 | covered | "exits non-zero naming the fixture file and line for a SKILL.md line instructing a `completed` write" | diff-local |
| criterion | Story 5 negative: Given a SKILL.md line instructing a `skipped` write (for example, "Set the row to `skipped` in `.pipeline/task-status.json`"), when check 10 runs, then check 10 fails naming the file and line | 9 | covered | "and for one instructing a `skipped` write to `.pipeline/task-status.json`" | diff-local |
| criterion | Story 5 negative: Given a prose allowlist entry with an empty reason, when check 10 runs, then check 10 fails naming the entry | 9 | covered | "a non-zero exit naming the entry when that entry's reason is empty" | diff-local |
| criterion | Story 5 negative: Given a write to `.pipeline/task-status.json` under `hooks/` or `bin/`, when check 10 runs, then check 10 still fails (existing coverage unchanged) | 8 | covered | "asserts non-zero exits for the same write placed under `hooks/` and under `bin/`" | diff-local |

## Judgement Record

All judges were fresh subagents with no authoring context.

- **Coverage (plan §7a).** Round 1 passed 33 of 34 criteria. The refused criterion was Story 3's full-suite hook check; Task 6 gained a full-suite hash and `git status` check, and a fresh judge passed it. After the Story 5 revision below, a fresh judge passed all 10 revised Story 5 criteria. All 36 criterion rows are identical to the passed plan Coverage Check rows.
- **Contradiction (plan §7b).** No conflicts. Three wording defects were fixed in Tasks 1, 2, and 9.
- **Coherence sweep round 1 (§4d, §4f, §4g).**
  - Grounded conflict: Story 5 and the original Task 10 would have removed the agent's advisory `pending` reset in `skills/tdd/SKILL.md`. That reset is sanctioned by `adr-2026-07-05-engine-owned-task-status` D4: "the agent retains only advisory *scheduling* writes (`pending`/`in_progress` …); `completed`/`skipped` are engine-only".
  - The operator chose to narrow the prose scan to engine-only statuses. Task 10 was dropped, and Story 5, the track marker, the architecture review, the diagram, and the conflict report were revised in place.
  - Also fixed: the Task 8 and Task 9 header-comment wording; Task 7's RED (the stub seam moved out of Task 6); D4's row now cites tasks 1 and 2; and the check 5 row-name extraction rule is now defined.
- **Coherence sweep round 2.**
  - No hard conflicts. §4f: D1-D3 `existing` verified against `model-table-metadata.ts`, `bin/generate-model-table`, and `ARCHITECTURE.md:55`; D4 satisfied as amended; D5 evidence wording corrected. The engine-owned task-status ADR is honored.
  - Applied: alias entries now require a reason (Task 2 tests it), and Task 9 states its verb pattern verbatim. A grep over the real tree confirms the pattern matches none of the `completed`-mentioning lines (`conduct:91`, `pipeline:79`, `pipeline:138`).
  - Suite-level exit for checker failures (Stories 1 and 4) rests on the existing `assert` contract. A failed `assert` increments the suite's failed count and makes it exit non-zero, which check 29's fixture already enforces; each task requires the checker's captured status to be reported through `assert`.
  - Story 3's full-suite hash check is a command check, not a `[test]`, because a fixture spec cannot run the suite that runs it.
  - Story-level "fails against pre-change code" items are enforced by `build_review`'s counterfactual testQuality preflight, not by plan checks.
