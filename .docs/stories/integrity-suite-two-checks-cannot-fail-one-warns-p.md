**Status:** Accepted

# Stories: Integrity suite checks fail closed (#1014)

Technical track. Acceptance criteria derive from the confirmed Approach A and the approved
lightweight architecture review
(`.docs/decisions/architecture-review-2026-10-14-integrity-suite-two-checks-cannot-fail-one-warns-p.md`).
Scope boundary: checks 5, 5a, 5b, 5c, and 10 of `test/test_harness_integrity.sh` and five `model: opus`
pins. Check 4 and check 1b are out of scope.

"Fails" below means the check reports FAIL, the suite's failed count increases, and the suite exits
non-zero. "Warns" means a WARN line that leaves the exit code unchanged.

## Story 1: Check 5 fails on a skill missing from the model table

As a harness maintainer, I want a skill with no model-table row to fail the integrity suite unless it
is deliberately exempted with a reason, so that a new skill cannot ship without a model decision.

### Acceptance Criteria

#### Happy Path
- Given a skill directory whose name has its own row in the `ARCHITECTURE.md` model table, when check 5 runs, then that skill passes
- Given the `tdd` skill directory and model-table rows `tdd-red` and `tdd-green` but no `tdd` row, when check 5 runs, then `tdd` passes because its phase rows cover it
- Given a skill with no row that appears on check 5's no-row allowlist with a non-empty reason, when check 5 runs, then that skill passes and the output names it as allowlisted
- Given the repository as delivered by this change, when check 5 runs, then every skill passes and check 5 emits no WARN line

#### Negative Paths
- Given a skill directory with no model-table row, no phase rows, and no allowlist entry, when check 5 runs, then check 5 fails with a message naming that skill
- Given an allowlist entry whose reason is empty, when check 5 runs, then check 5 fails naming the entry instead of treating it as exempt
- Given an allowlist entry naming a skill that has no `skills/<name>/` directory, when check 5 runs, then check 5 fails reporting the stale entry
- Given a model-table row `tdd-review` (a `tdd-` prefix that is not one of the skill's phase rows) but no `tdd-red` or `tdd-green` row, when check 5 runs, then `tdd` is not satisfied by prefix alone and fails unless allowlisted

### Done When
- [ ] Check 5 uses `assert` (counted) rather than `warn_check` for a missing row
- [ ] Check 5 has a named no-row allowlist in which every entry carries a reason comment, and `engineer` is listed with a reason that names its pending removal
- [ ] `coverage-binding` either has a model-table row or an allowlist entry with a reason
- [ ] A fixture run against a skills directory containing an unlisted, row-less skill shows check 5 failing and the suite exiting non-zero; the same fixture against pre-change code exits zero

## Story 2: Check 5b enforces model pins in both directions

As a harness maintainer, I want a skill the engine expects on a specific model to fail when its
SKILL.md carries no pin, so that the documented "and vice versa" contract is actually enforced.

### Acceptance Criteria

#### Happy Path
- Given a non-exempt `--pins` entry expecting `opus` and a SKILL.md pinning `model: opus`, when check 5b runs, then that skill passes
- Given a `--pins` entry marked exempt and a SKILL.md with no pin, when check 5b runs, then that skill passes as exempt
- Given a skill with no `--pins` entry and no `model:` pin, when check 5b runs, then that skill passes without comparison
- Given the repository as delivered by this change, when check 5b runs, then `architecture-review`, `explore`, `prd`, `rebase`, and `remediate` each pin `model: opus` and pass

#### Negative Paths
- Given a non-exempt `--pins` entry expecting `opus` and a SKILL.md with no `model:` line, when check 5b runs, then check 5b fails naming the skill and the expected model
- Given a non-exempt `--pins` entry naming a skill that has no `skills/<name>/SKILL.md`, when check 5b runs, then check 5b fails naming the unresolvable skill rather than skipping it
- Given a SKILL.md pinning `model: sonnet` where `--pins` expects `opus`, when check 5b runs, then check 5b still fails as a disagreement (existing direction unchanged)
- Given a SKILL.md pin with no `--pins` entry, when check 5b runs, then check 5b still fails as unmapped (existing direction unchanged)

### Done When
- [ ] A fixture run using `HARNESS_INTEGRITY_TEST_PINS_JSON` and `HARNESS_INTEGRITY_TEST_SKILLS_DIR` with an expected-but-unpinned skill shows check 5b failing; the same fixture against pre-change code passes
- [ ] The frontmatter of the five named SKILL.md files declares `model: opus`

## Story 3: Check 5c never modifies the tracked docs-guard hook

As an operator running the suite, I want the docs-guard drift fixture to work on a copy, so that an
interrupted run can never leave a corrupted hook in my working tree.

### Acceptance Criteria

#### Happy Path
- Given a clean checkout, when the full integrity suite runs to completion, then `hooks/claude/docs-guard.sh` is byte-identical to its pre-run content and `git status` shows it unmodified
- Given the drift fixture, when check 5c runs it, then the generator's `--check` reports drift (exit 1) against a corrupted temporary copy and check 5c passes the fixture assertion
- Given the committed hook matches the generator source, when check 5c runs, then the no-drift assertion passes against the tracked path

#### Negative Paths
- Given check 5c is interrupted (SIGINT or SIGKILL) while its fixture is running, when the working tree is inspected afterward, then `hooks/claude/docs-guard.sh` is unmodified, because the fixture never wrote to it
- Given the generator ignores the target-path override and checks the tracked hook instead, when the fixture runs, then the fixture assertion fails (the clean tracked hook yields exit 0, not 1) rather than passing silently
- Given the temporary copy cannot be created, when check 5c runs, then the fixture assertion fails with a message naming the failure rather than falling back to writing the tracked hook

### Done When
- [ ] Check 5c contains no write, append, or copy whose destination is `hooks/claude/docs-guard.sh`
- [ ] The fixture passes its temporary path to `bin/generate-docs-guard-hook --check` through `GENERATE_DOCS_GUARD_HOOK_OUT`
- [ ] A test that hashes `hooks/claude/docs-guard.sh` before and after a suite run observes no change

## Story 4: Missing prerequisites fail instead of skipping

As a harness maintainer, I want checks 5a, 5b, and 5c to fail when their prerequisites are missing,
so that a green run always means those drift gates executed.

### Acceptance Criteria

#### Happy Path
- Given `src/conductor/node_modules` exists and `jq` is on `PATH`, when the suite runs, then checks 5a, 5b, and 5c execute their comparisons and emit no WARN-skip line

#### Negative Paths
- Given `src/conductor/node_modules` is absent, when the suite runs, then checks 5a, 5b, and 5c fail with a message naming the missing directory and the `npm ci` remedy in `src/conductor`, and the suite exits non-zero
- Given `node_modules` is present but `jq` is not on `PATH`, when the suite runs, then check 5b fails with a message naming `jq` as missing, and checks 5a and 5c still execute
- Given `node_modules` is absent, when the suite runs, then later checks after 5c still run and the summary counts every failure (the run does not abort)

### Done When
- [ ] No `warn_check` call remains for an absent `src/conductor/node_modules` or absent `jq` in checks 5a, 5b, or 5c
- [ ] A fixture run with the prerequisite unavailable shows each affected check failing and the suite exiting non-zero; the same fixture against pre-change code exits zero

## Story 5: Check 10 audits skills for task-status writers

As a harness maintainer, I want check 10 to cover `skills/` as it claims, including SKILL.md prose
that tells an agent to write an engine-only task status (`completed` or `skipped`) into
`.pipeline/task-status.json`, so that only the engine records completion. Advisory `pending` and
`in_progress` scheduling writes stay with the agent, per `adr-2026-07-05-engine-owned-task-status`.

### Acceptance Criteria

#### Happy Path
- Given a SKILL.md line that only describes engine or hook behavior (for example, a hook "flips that row to `in_progress` in `.pipeline/task-status.json`"), when check 10 runs, then the line is not flagged
- Given a SKILL.md line that only reads the file (for example, "read `.pipeline/task-status.json` and confirm the row reads `completed`"), when check 10 runs, then the line is not flagged
- Given a SKILL.md line instructing an advisory scheduling write (for example, "Reset the task to `pending` in `.pipeline/task-status.json`"), when check 10 runs, then the line is not flagged
- Given a SKILL.md line on check 10's prose allowlist with a non-empty reason, when check 10 runs, then the line is not flagged
- Given the repository as delivered by this change, when check 10 runs, then it passes

#### Negative Paths
- Given a script under `skills/` that writes `.pipeline/task-status.json` (for example, `echo '{}' > .pipeline/task-status.json` in a `.sh` file), when check 10 runs, then check 10 fails naming the file and line
- Given a SKILL.md line instructing an agent to write an engine-only status (for example, "Mark the task `completed` in `.pipeline/task-status.json`"), when check 10 runs, then check 10 fails naming the file and line
- Given a SKILL.md line instructing a `skipped` write (for example, "Set the row to `skipped` in `.pipeline/task-status.json`"), when check 10 runs, then check 10 fails naming the file and line
- Given a prose allowlist entry with an empty reason, when check 10 runs, then check 10 fails naming the entry
- Given a write to `.pipeline/task-status.json` under `hooks/` or `bin/`, when check 10 runs, then check 10 still fails (existing coverage unchanged)

### Done When
- [ ] Check 10 scans `skills/` in addition to `hooks/` and `bin/`, and its comment names the roots, file kinds, and the SKILL.md prose rule it applies
- [ ] Fixture runs with a `completed` write-instruction SKILL.md line and with a writing skill script each show check 10 failing; the same fixtures against pre-change code pass
- [ ] Fixture runs with the descriptive, read-only, and `pending`-reset example lines above show check 10 passing
