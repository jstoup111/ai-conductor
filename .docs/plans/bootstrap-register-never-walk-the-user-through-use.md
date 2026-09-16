# Implementation Plan: Guided setup walks the operator through project and operator configuration

**Date:** 2026-09-14
**Design:** .docs/specs/bootstrap-register-never-walk-the-user-through-use.md
**Stories:** .docs/stories/bootstrap-register-never-walk-the-user-through-use.md
**Conflict check:** Clean as of 2026-09-14
**Source:** jstoup111/ai-conductor#2218

## Summary

Extends the two existing deterministic config writers by one input each and grows the bootstrap skill's Step 1b-i into a guided interview, in 16 tasks. No new module, no new CLI verb, no runtime config-load change.

## Technical Approach

- **Skill asks, engine writes (adr-2026-08-28 D8, new D9).** `skills/bootstrap/SKILL.md` Step 1b-i becomes a per-setting interview; every answer is recorded through one `ai-conductor config init` invocation carrying flags. The skill never edits `.ai-conductor/config.yml` (adr-2026-07-27 decision 3).
- **One new `config init` flag: `--test-suite-command`.** Parsed in `detectRegistryCommand`, validated in `resolveVerificationSelection`, substituted by `renderVerificationBlock` at the existing single template anchor, replacing the hardcoded `npm test` literal. Flagless output stays byte-identical, pinned by a committed fixture. Local pattern to follow: the D8 flags in `src/conductor/src/engine/registry-cli.ts` — typed option carried into `runConfigInit`, closed-vocabulary validation before any write, single-anchor substitution, `already-exists` refusal untouched; allowed variation: the command is free text, so validation is shape-only (non-empty, single line). Rediscover via symbols `detectRegistryCommand`, `ConfigInitOptions`, `resolveVerificationSelection`, `renderVerificationBlock`, `TEST_SUITE_VERIFICATION_TEMPLATE_ANCHOR`.
- **One new `config set` path: `spec_owner` (adr-2026-08-09 decision 6).** `userConfigSetCommand` in `src/conductor/src/cli.ts` accepts exactly this additional top-level path, validated through `validateConfig` on the user source, written by the existing atomic `writeUserConfig`. It never targets a project file, so adr-2026-07-01 D1/D2 hold by construction. Local pattern: the function's own `conductor` branch (validate prospective value, then write); allowed variation: one more accepted path.
- **Identity step in the skill.** Step 1b-ii reads `config read spec_owner`; when empty it asks, defaulting to `gh api user -q .login`, and records via `config set spec_owner`. Unresolved identity is reported with the blocked actions named; auto mode skips the step.
- **Template annotations.** `templates/project-config.yml.template` explains each unasked operator-settable key in place with `Controls:` / `Allowed:` / `Default:` / `Changing it:` comment lines; rendered keys and the anchor do not move.
- **Sequencing.** Engine flag (1-3) → identity tests and fixtures (4-5, 7-8) and template (9-10) fan out; skill tasks (11-16) follow the engine so they name final flag and verb shapes.

## Prerequisites

- Built `conduct-ts` in the worktree (`cd src/conductor && npm run build`) so `ai-conductor config …` resolves during tests that shell out.

## Tasks

### Task 1: Parse `--test-suite-command` into the config-init dispatch
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test in `registry-cli.test.ts`: `detectRegistryCommand(['node','cli','config','init','--test-suite-command','pytest -q'])` returns `{ kind: 'config-init', testSuiteCommand: 'pytest -q', hasVerificationFlags: true }`, and the `--test-suite-command=pytest -q` form parses identically.
2. Verify RED.
3. Implement: add `testSuiteCommand?: string` to the `config-init` dispatch shape and `ConfigInitOptions`; parse both flag forms in the existing flag loop of `detectRegistryCommand` alongside `--test-suite-mode` (pattern: the D8 flags — typed option carried into `runConfigInit`, rediscover via symbols `detectRegistryCommand`, `ConfigInitOptions`, `dispatchRegistry`); thread it through `dispatchRegistry` into `runConfigInit`.
4. Verify GREEN. Commit: "config init: parse --test-suite-command into the registry dispatch"

**Done when:**
- `detectRegistryCommand` returns `testSuiteCommand` for both `--test-suite-command <v>` and `--test-suite-command=<v>`, as asserted by the two new dispatch tests.
- `dispatchRegistry` forwards `testSuiteCommand` into `runConfigInit`'s options, as asserted by a spy test on the dispatch path reached from the real argv shape.

**Files likely touched:**
- `src/conductor/src/engine/registry-cli.ts`
- `src/conductor/test/engine/registry-cli.test.ts`

**Dependencies:** none

### Task 2: Reject an empty, multi-line, or unknown config-init flag before any write
**Story:** 1
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: `config init --test-suite-command ''` and `--test-suite-command $'a\nb'` exit 1 with stderr naming `--test-suite-command` and the rule (non-empty, single line) and create no `.ai-conductor/config.yml`; `config init --frobnicate x` exits 1 with stderr `unsupported flag --frobnicate` and writes nothing.
2. Verify RED.
3. Implement: extend `resolveVerificationSelection` to validate `testSuiteCommand` (trim non-empty, no `\n`/`\r`) and return the naming message; make the flag loop in `detectRegistryCommand` collect any other `--` token as `unknownFlags` and have `runConfigInit` refuse on a non-empty list, before `isGitRepo`/`writeProjectConfig`.
4. Verify GREEN. Commit: "config init: refuse empty, multi-line, and unknown flags before writing"

**Done when:**
- `runConfigInit` exits 1 naming `--test-suite-command` and writes no config file for the empty and multi-line fixtures, as asserted by the two refusal tests.
- `runConfigInit` exits 1 with `unsupported flag --<name>` and writes no file for an unrecognized `--` flag, as asserted by the unknown-flag test.

**Files likely touched:**
- `src/conductor/src/engine/registry-cli.ts`
- `src/conductor/test/engine/registry-cli.test.ts`

**Dependencies:** 1

### Task 3: Substitute the operator's test command into the rendered test_suite block
**Story:** 3
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `config init --test-suite-mode aggregate --test-suite-drift-budget strict --test-suite-command 'pytest -q'` writes `command: pytest -q` under `test_suite:` and the rendered file contains no `npm test`; a value with shell metacharacters (`make test && echo done`) is written as one YAML scalar and read back unchanged by `loadConfig`; no child process is spawned during init (spy on `execa` shows only the `git rev-parse` call).
2. Verify RED.
3. Implement: give `renderVerificationBlock` the selection's `command` (default `npm test` when the flag is absent) and emit it via a YAML-safe scalar (quote when it contains `:`/`#`/leading symbols) at the same `CONFIG_INIT_TEST_SUITE_VERIFICATION` anchor; keep substitution single-anchor, never post-editing the written file.
4. Verify GREEN. Commit: "config init: record the operator's aggregate test command"

**Done when:**
- The rendered `test_suite.command` equals the `--test-suite-command` value and `loadConfig` reads it back unchanged, as asserted by the round-trip test.
- A metacharacter-bearing command is stored as a single YAML scalar and `runConfigInit` spawns no process other than `git rev-parse`, as asserted by the literal-storage and no-execution tests.
- With the flag absent the rendered block still contains `command: npm test`, as asserted by the absent-flag test.

**Files likely touched:**
- `src/conductor/src/engine/registry-cli.ts`
- `src/conductor/test/engine/registry-cli.test.ts`

**Dependencies:** 1

### Task 4: Prove flagless and auto-mode config-init output is byte-identical to the pre-change fixture
**Story:** 2
**Story:** 8
**Type:** negative-path

**Steps:**
1. Add a committed fixture `src/conductor/test/fixtures/config-init-defaults.yml` captured from the pre-change `config init --test-suite-mode aggregate --test-suite-drift-budget strict` output and from the flagless byte copy.
2. Write tests asserting `runConfigInit` output equals the fixture byte-for-byte for (a) no flags and (b) the auto-mode invocation the bootstrap skill documents.
3. Verify GREEN (behavior is preserved; this task proves it). Commit: "config init: pin flagless and auto-mode output to the pre-change fixture"

**Done when:**
- `runConfigInit` with no flags produces a file byte-equal to `config-init-defaults.yml`, as asserted by the flagless identity test.
- `runConfigInit` with the auto-mode flags produces a file byte-equal to the fixture, as asserted by the auto-mode identity test.

**Files likely touched:**
- `src/conductor/test/engine/registry-cli.test.ts`
- `src/conductor/test/fixtures/config-init-defaults.yml`

**Verify-only:** yes

**Dependencies:** 3

### Task 5: Prove refuse-to-clobber preserves existing and hand-edited project config under the new flag
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write tests: with an existing `.ai-conductor/config.yml` (one fixture as originally rendered, one hand-edited with `command: make check`), `config init --test-suite-command 'pytest'` exits 0, prints `Project config already exists`, and leaves the file byte-identical.
2. Verify GREEN (existing `already-exists` path). Commit: "config init: prove existing and hand-edited configs survive a flagged re-run"

**Done when:**
- `writeProjectConfig` returns `already-exists` and the pre-existing file is byte-identical after a flagged re-run, as asserted by both preservation tests.
- The hand-edited `command: make check` value survives the re-run unchanged, as asserted by the hand-edited fixture test.

**Files likely touched:**
- `src/conductor/test/engine/registry-cli.test.ts`

**Verify-only:** yes

**Dependencies:** 3

### Task 6: Declare `--test-suite-command` on the commander `config init` command
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `createProgram()` help output for `config init` lists `--test-suite-command <command>` with a description naming it as the aggregate test command.
2. Verify RED.
3. Implement: add the `.option('--test-suite-command <command>', ...)` declaration next to the existing `config init` command in `cli.ts` (dispatch itself stays in `registry-cli.ts`, matching the existing `--test-suite-mode` declaration shape).
4. Verify GREEN. Commit: "cli: list --test-suite-command in config init help"

**Done when:**
- `createProgram().commands` for `config init` includes the `--test-suite-command` option with its description, as asserted by the help-listing test.
- The existing `--test-suite-mode` and `--test-suite-drift-budget` options on `config init` are still listed unchanged, as asserted by the same help-listing test.

**Files likely touched:**
- `src/conductor/src/cli.ts`
- `src/conductor/test/cli-config-user.test.ts`

**Dependencies:** none

### Task 7: Accept `spec_owner` in `config set` with validation and atomic user-config write
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `cli-config-user.test.ts`: `userConfigSetCommand({ path: 'spec_owner', value: 'jstoup111' })` writes `spec_owner: jstoup111` to the user config path, preserves unrelated top-level keys, and `config read spec_owner` returns it; an empty or whitespace value exits 1 with a message naming `spec_owner` and writes nothing; `config set other.key x` still exits 1 with `Unsupported user config path`.
2. Verify RED.
3. Implement: in `userConfigSetCommand`, accept the single path `spec_owner` (no dots) beside the `conductor.*` branch; validate the prospective `{ spec_owner }` through `validateConfig` on the user/merged source plus a non-empty trim check; write via the existing `writeUserConfig` temp-and-rename (pattern: the `conductor` branch's validate-then-write shape in the same function; allowed variation: one additional top-level path, nothing else).
4. Verify GREEN. Commit: "config set: accept the spec_owner path (adr-2026-08-09 decision 6)"

**Done when:**
- `userConfigSetCommand` writes `spec_owner` to the user config via `writeUserConfig` and `config read spec_owner` returns the value, as asserted by the round-trip test.
- An empty or whitespace `spec_owner` value is refused with exit 1 naming the key and no file write, as asserted by the empty-value test.
- Every path other than `spec_owner` and `conductor.<key>` still exits 1 with `Unsupported user config path`, as asserted by the unchanged-rejection test.

**Files likely touched:**
- `src/conductor/src/cli.ts`
- `src/conductor/test/cli-config-user.test.ts`

**Dependencies:** none

### Task 8: Prove identity never reaches project scope and the committed-identity guard is unchanged
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write tests: after `config set spec_owner jstoup111`, a project `.ai-conductor/config.yml` in a temp repo is byte-identical to before; `validateConfig` on a project source carrying `spec_owner` still returns the existing `spec_owner must not be set in a project config` error.
2. Verify GREEN (existing guard; `config set` never opens a project path). Commit: "config set: prove spec_owner stays machine-scoped and the project guard holds"

**Done when:**
- `userConfigSetCommand` opens only `userConfigPath()`; the project config file is byte-identical after the write, as asserted by the project-untouched test.
- `validateConfig` on a project source with `spec_owner` returns the existing anti-leak error, as asserted by the guard-unchanged test.

**Files likely touched:**
- `src/conductor/test/cli-config-user.test.ts`

**Verify-only:** yes

**Dependencies:** 7

### Task 9: Annotate every unasked operator-settable key in the project config template
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test in `config-template.test.ts`: for each key in a fixed list of unasked operator-settable keys (`test_suite.working_directory`, `test_suite.timeout_seconds`, `test_suite.inputs`, `test_suite.environment`, `test_suite.scoped_command`, `build_review.rubrics.testQuality.enabled`, `otel.worker_name`, `steps.<name>.model`, `steps.<name>.effort`, `harness_version`), the template contains a comment block naming the key and carrying the four markers `Controls:`, `Allowed:`, `Default:`, `Changing it:`.
2. Verify RED.
3. Implement: rewrite the template comments so each listed key has that four-line explanation, keeping every rendered (non-comment) key and the `# CONFIG_INIT_TEST_SUITE_VERIFICATION` anchor exactly as they are.
4. Verify GREEN, and re-run Task 4's byte-identity tests (they must still pass, which pins that rendered keys did not move). Commit: "template: explain every unasked project config key in place"

**Done when:**
- Every key in the test's unasked-key list has a template comment block with `Controls:`, `Allowed:`, `Default:`, and `Changing it:`, as asserted by the annotation-coverage test.
- The template still contains the `# CONFIG_INIT_TEST_SUITE_VERIFICATION` anchor and Task 4's byte-identity tests still pass, as asserted by re-running them.

**Files likely touched:**
- `templates/project-config.yml.template`
- `src/conductor/test/engine/config-template.test.ts`

**Dependencies:** 4

### Task 10: Prove the template explains no key the harness rejects
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: extract every `key:` token named in template comments and assert `validateConfig` accepts a project config built from those keys with their documented defaults (no `unknown key` error).
2. Verify RED if any explained key is unknown; otherwise the test passes on first run and is kept as the drift guard.
3. Implement: fix any comment naming a key `validateConfig` rejects.
4. Verify GREEN. Commit: "template: explained keys are all validator-accepted"

**Done when:**
- A project config assembled from every key named in template comments passes `validateConfig` with no unknown-key error, as asserted by the explained-keys-are-known test.
- The rendered (non-comment) keys of the template are unchanged by this task, as asserted by re-running Task 4's byte-identity tests.

**Files likely touched:**
- `templates/project-config.yml.template`
- `src/conductor/test/engine/config-template.test.ts`

**Dependencies:** 9

### Task 11: Expand bootstrap Step 1b-i into a per-setting interview with four-element guidance
**Story:** 1
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test in a new `bootstrap-skill-config-questions.test.ts` that reads `skills/bootstrap/SKILL.md` from the harness root: the Step 1b-i section contains one numbered question per key in the decidable-key list (`test_suite.verification.mode`, `test_suite.verification.drift_budget`, `test_suite.command`), each question paragraph contains the four markers `Controls:`, `Allowed:`, `Default:`, `Changing it:`, and each names the `ai-conductor config init` flag that records it.
2. Verify RED.
3. Implement: rewrite Step 1b-i so it asks every decidable setting one at a time with the four elements; state that a closed-set answer outside the allowed values is re-asked with the values restated and nothing recorded, that a free-text empty or multi-line answer is re-asked, and that the answers are recorded only through the single `ai-conductor config init` invocation with the corresponding flags (never by editing the file).
4. Verify GREEN. Commit: "bootstrap: interview every decidable project setting with real guidance"

**Done when:**
- Step 1b-i of `skills/bootstrap/SKILL.md` has a numbered question for each decidable key carrying `Controls:`, `Allowed:`, `Default:`, and `Changing it:`, as asserted by the question-coverage test.
- Each question names the `config init` flag that records its answer and the section states the closed-set and free-text re-ask rules, as asserted by the recording-and-re-ask test.

**Files likely touched:**
- `skills/bootstrap/SKILL.md`
- `src/conductor/test/bootstrap-skill-config-questions.test.ts`

**Dependencies:** 3

### Task 12: Ask for the real test command with an inferred default
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: the Step 1b-i test-command question instructs the agent to offer an inferred default derived from project tooling files (`package.json` scripts.test, `pyproject.toml`/`pytest.ini`, `Gemfile`/`Rakefile`, `go.mod`, `Cargo.toml`), and states that with no inference and an empty answer the question is re-asked rather than recording `npm test`.
2. Verify RED.
3. Implement: add that question text and the inference table to Step 1b-i.
4. Verify GREEN. Commit: "bootstrap: ask for the project's test command, infer the default from tooling"

**Done when:**
- The test-command question in `skills/bootstrap/SKILL.md` names the tooling-file inference table and the empty-and-uninferred re-ask rule, as asserted by the test-command-question test.
- The test-command question records its answer only through the `--test-suite-command` flag on the single `config init` invocation, as asserted by the recording-flag test.

**Files likely touched:**
- `skills/bootstrap/SKILL.md`
- `src/conductor/test/bootstrap-skill-config-questions.test.ts`

**Dependencies:** 11

### Task 13: Add the operator-identity step to bootstrap
**Story:** 4
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: `skills/bootstrap/SKILL.md` contains a Step 1b-ii `Operator identity` section that (a) reads the current value with `ai-conductor config read spec_owner`, (b) when empty asks for the identity offering `gh api user -q .login` as the default, (c) records it with `ai-conductor config set spec_owner <login>`, (d) when already set reports the value and does not ask, and (e) re-asks an empty submission with the decline option restated.
2. Verify RED.
3. Implement: write Step 1b-ii with those five statements, in interactive mode only.
4. Verify GREEN. Commit: "bootstrap: establish operator identity through config set"

**Done when:**
- Step 1b-ii reads `spec_owner` via `config read`, records it via `config set spec_owner`, and never instructs a file edit, as asserted by the identity-step test.
- Step 1b-ii reports an already-set identity without asking and re-asks an empty submission with the decline option restated, as asserted by the established-and-empty test.

**Files likely touched:**
- `skills/bootstrap/SKILL.md`
- `src/conductor/test/bootstrap-skill-config-questions.test.ts`

**Dependencies:** 7

### Task 14: Report unresolved identity plainly with the blocked actions named
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: Step 1b-ii states that when identity stays unresolved (no value, no `gh` login, operator declined) bootstrap prints `Operator identity unresolved` naming `engineer land`, spec handoff, and daemon builds as the actions that will refuse, records no placeholder, and the bootstrap summary marks setup as incomplete rather than successful.
2. Verify RED.
3. Implement: add that outcome to Step 1b-ii and to the bootstrap completion summary in the same skill.
4. Verify GREEN. Commit: "bootstrap: say plainly when identity is unresolved and what stays blocked"

**Done when:**
- Step 1b-ii's unresolved branch names the three blocked actions and forbids a placeholder value, as asserted by the unresolved-report test.
- The bootstrap completion summary reports setup incomplete when identity is unresolved, as asserted by the summary test.

**Files likely touched:**
- `skills/bootstrap/SKILL.md`
- `src/conductor/test/bootstrap-skill-config-questions.test.ts`

**Dependencies:** 13

### Task 15: Report already-established settings on a re-run instead of re-asking
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: Step 1b-i states that when `.ai-conductor/config.yml` already exists bootstrap reads each decidable key with `ai-conductor config read <key>`, prints `already set: <key> = <value>` for each, asks none of them, and still runs `config init` (which refuses to clobber).
2. Verify RED.
3. Implement: add the re-run branch to Step 1b-i.
4. Verify GREEN. Commit: "bootstrap: report established settings on re-run, never re-ask"

**Done when:**
- Step 1b-i's re-run branch reads existing keys via `config read`, prints `already set:` lines, and asks no question for them, as asserted by the re-run-branch test.
- The re-run branch still invokes `config init` and relies on its `already-exists` refusal rather than skipping the writer, as asserted by the re-run-writer test.

**Files likely touched:**
- `skills/bootstrap/SKILL.md`
- `src/conductor/test/bootstrap-skill-config-questions.test.ts`

**Dependencies:** 11

### Task 16: Keep the auto-mode branch question-free and identity-free
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test: the auto-mode paragraph of Step 1b-i invokes `ai-conductor config init --test-suite-mode aggregate --test-suite-drift-budget strict` with no `--test-suite-command`, contains no question, and Step 1b-ii states it is skipped entirely in auto mode with no `config set` call.
2. Verify RED.
3. Implement: write the auto-mode statements in both steps.
4. Verify GREEN. Commit: "bootstrap: auto mode asks nothing and records no identity"

**Done when:**
- The auto-mode branch of Step 1b-i is the unchanged flagless-defaults invocation with no question text, as asserted by the auto-mode test, and Task 4 pins its output byte-identical.
- Step 1b-ii declares itself skipped in auto mode with no `config set` call, as asserted by the auto-mode identity test.

**Files likely touched:**
- `skills/bootstrap/SKILL.md`
- `src/conductor/test/bootstrap-skill-config-questions.test.ts`

**Dependencies:** 13

## Task Dependency Graph

```
1 ─┬─▶ 2
   └─▶ 3 ─┬─▶ 4 ─▶ 9 ─▶ 10
          ├─▶ 5
          └─▶ 11 ─┬─▶ 12
                  └─▶ 15
6 (independent)
7 ─┬─▶ 8
   └─▶ 13 ─┬─▶ 14
           └─▶ 16
```

## Integration Points

- After Task 3: `ai-conductor config init --test-suite-command 'pytest -q'` produces a project config whose `test_suite.command` the pre-ship gate would invoke; Task 1 owns this CLI-boundary proof through the real argv dispatch.
- After Task 7: `ai-conductor config set spec_owner <login>` followed by `ai-conductor config read spec_owner` round-trips through the user config; Task 7 owns this CLI-boundary proof.
- After Task 16: the bootstrap skill's interactive and auto-mode branches reference only shipped flags and verbs.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D1 | existing | none | The closed drift category vocabulary is validated at load in `config.ts` (`TEST_SUITE_DRIFT_BUDGET_PRESETS`, `UNBUDGETABLE_TEST_SUITE_DRIFT_CATEGORIES`); this feature adds no category. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D2 | existing | none | `test_suite.verification` is rendered by `renderVerificationBlock` and accepted by `validateConfig`; unchanged here. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D3 | no-change | none | Budgetable/unbudgetable partitioning is engine-fixed and no interview question touches it. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D4 | no-change | none | `FullSuiteVerifier.resolveInspection` judgement is outside this feature's surface. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D5 | no-change | none | Verification mode semantics are unchanged; the interview only records the existing mode answer. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D6 | no-change | none | Evidence schema is untouched. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D7 | no-change | none | No event is added or changed (event-spine exception C; configuration is state). |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D8 | existing | none | `--test-suite-mode` and `--test-suite-drift-budget` are parsed in `detectRegistryCommand` and substituted by `renderVerificationBlock`; the skill records them through the CLI. |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D9 | task | task-1, task-3 | The rendered `test_suite.command` equals the `--test-suite-command` value and `loadConfig` reads it back unchanged |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config#D1 | existing | none | `conductor_cfg_get` in `bin/install` delegates to `ai-conductor config read conductor.<key>`. |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config#D2 | existing | none | `userConfigSetCommand` and `detectUserConfigSetCommand` in `cli.ts` implement `config set <dotted.path> <value>`. |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config#D3 | existing | none | `userConfigSetCommand` validates the prospective `conductor` block via `validateConfig` before `writeUserConfig`. |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config#D4 | no-change | none | Loud-failure behavior of `bin/update` on a missing `conduct-ts` is outside this feature. |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config#D5 | no-change | none | Legacy JSON seed is untouched. |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config#D6 | task | task-7 | `userConfigSetCommand` writes `spec_owner` to the user config via `writeUserConfig` and `config read spec_owner` returns the value |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an operator is present and the project has no configuration yet, when onboarding reaches configuration, then every project-scoped setting the operator is expected to decide is asked, one question at a time, and no such setting is silently defaulted without being asked. | 11 | "a numbered question for each decidable key" | diff-local |
| Story 1 happy: Given a question is asked, when it is presented, then it states what the setting controls, which values are permitted, which value applies if the operator answers nothing, and what a non-default value changes. | 11 | "carrying `Controls:`, `Allowed:`, `Default:`, and `Changing it:`" | diff-local |
| Story 1 negative: Given a question with a closed set of permitted values, when the operator answers with a value outside that set, then the answer is rejected with the permitted values restated, the same question is asked again, and nothing is recorded for it. | 11, 2 | "states the closed-set and free-text re-ask rules" | diff-local |
| Story 1 negative: Given a question whose answer is free text, when the operator answers with an empty or multi-line value, then the answer is rejected, the question is re-asked, and nothing is recorded for it. | 2, 11 | "exits 1 naming `--test-suite-command` and writes no config file for the empty and multi-line fixtures" | diff-local |
| Story 2 happy: Given the operator answers a question with a permitted non-default value, when onboarding records configuration, then the project configuration carries that value and the harness reads it back as the effective value on its next run. | 3 | "`loadConfig` reads it back unchanged" | diff-local |
| Story 2 happy: Given the operator accepts the offered value at every question, when onboarding records configuration, then the resulting project configuration is byte-identical to what onboarding produced before this change. | 4 | "byte-equal to `config-init-defaults.yml`" | diff-local |
| Story 2 negative: Given a value that would fail configuration validation, when recording is attempted with it, then recording refuses before any file is written, names the rejected value, and the project has no partially written configuration. | 2 | "writes no config file for the empty and multi-line fixtures" | diff-local |
| Story 2 negative: Given recording is invoked with a value for a setting it does not accept, when it runs, then it refuses with a message naming the unsupported setting and writes nothing. | 2 | "exits 1 with `unsupported flag --<name>` and writes no file" | diff-local |
| Story 3 happy: Given an operator is present, when onboarding asks for the project's test command, then the operator's answer is recorded verbatim as the aggregate test command and is the value the pre-ship gate invokes. | 3, 1 | "The rendered `test_suite.command` equals the `--test-suite-command` value" | diff-local |
| Story 3 happy: Given the project's tooling makes a candidate command evident, when the question is asked, then that candidate is offered as the default answer rather than a fixed single-ecosystem literal. | 12 | "names the tooling-file inference table" | diff-local |
| Story 3 negative: Given no candidate can be inferred and the operator answers nothing, when the question resolves, then onboarding re-asks rather than recording a command the project cannot run. | 12 | "the empty-and-uninferred re-ask rule" | diff-local |
| Story 3 negative: Given the operator answers with a command containing shell metacharacters, when it is recorded, then it is stored as a single literal value and is not executed, expanded, or split at recording time. | 3 | "stored as a single YAML scalar and `runConfigInit` spawns no process other than `git rev-parse`" | diff-local |
| Story 4 happy: Given no operator identity is established on this machine, when onboarding runs with an operator present, then it asks for the identity, offering the authenticated hosting-service login as the default when one is available, and records the answer as a machine-scoped setting without the operator editing any file. | 13, 7 | "records it via `config set spec_owner`, and never instructs a file edit" | diff-local |
| Story 4 happy: Given operator identity is already established on this machine, when onboarding runs, then it reports the established identity and does not ask again. | 13 | "reports an already-set identity without asking" | diff-local |
| Story 4 negative: Given the operator submits an empty value to the identity question rather than explicitly declining it, when the answer is processed, then it is rejected, the question is re-asked with the decline option restated, and no identity is recorded. | 7, 13 | "An empty or whitespace `spec_owner` value is refused with exit 1 naming the key and no file write" | diff-local |
| Story 4 negative: Given onboarding records operator identity, when the project's committed configuration is inspected afterwards, then it contains no operator identity, and a committed configuration that does carry one is still rejected at load exactly as before. | 8 | "`validateConfig` on a project source with `spec_owner` returns the existing anti-leak error" | diff-local |
| Story 5 happy: Given no identity is established, no authenticated login is available, and the operator declines to supply one, when onboarding finishes configuration, then it states that operator identity is unresolved and names the actions that will refuse until it is established. | 14 | "names the three blocked actions and forbids a placeholder value" | diff-local |
| Story 5 negative: Given identity is unresolved at the end of onboarding, when onboarding completes, then it does not report a fully successful setup and does not invent or record a placeholder identity. | 14 | "reports setup incomplete when identity is unresolved" | diff-local |
| Story 6 happy: Given a project whose configuration already exists, when onboarding runs again, then every previously set value is preserved byte-for-byte and the operator is told which settings are already established rather than being asked to decide them again. | 15 | "prints `already set:` lines, and asks no question for them" | diff-local |
| Story 6 happy: Given operator identity is already established, when onboarding runs again, then it is reported and preserved. | 13 | "reports an already-set identity without asking" | diff-local |
| Story 6 negative: Given a project whose configuration already exists, when the recording step is invoked again with different answers, then it refuses to overwrite, reports that the configuration already exists, and the file is unchanged. | 5 | "the pre-existing file is byte-identical after a flagged re-run" | diff-local |
| Story 6 negative: Given a project configuration that has been hand-edited since it was recorded, when onboarding runs again, then the hand-edited values are preserved and reported, not replaced with defaults. | 5 | "The hand-edited `command: make check` value survives the re-run unchanged" | diff-local |
| Story 7 happy: Given onboarding has recorded a project configuration, when the operator opens it, then every setting the walkthrough did not ask about is accompanied by an explanation stating what it controls, its permitted values, its default, and the consequence of changing it. | 9 | "has a template comment block with `Controls:`, `Allowed:`, `Default:`, and `Changing it:`" | diff-local |
| Story 7 negative: Given the recorded configuration, when its explanations are compared with the keys the harness accepts, then no explained key is unknown to the harness and no decidable-but-unasked key lacks an explanation. | 10 | "passes `validateConfig` with no unknown-key error" | diff-local |
| Story 8 happy: Given onboarding runs with no operator present, when it reaches configuration, then it asks no question, records today's defaults, and completes. | 16 | "the unchanged flagless-defaults invocation with no question text" | diff-local |
| Story 8 negative: Given onboarding runs with no operator present and no identity is established, when it reaches the identity step, then it neither asks nor records an identity, and the existing fail-closed behavior on later identity-dependent actions is unchanged. | 16 | "declares itself skipped in auto mode with no `config set` call" | diff-local |
| Story 8 negative: Given onboarding runs with no operator present, when its output is compared with the pre-change unattended output, then the recorded project configuration is byte-identical. | 4 | "`runConfigInit` with the auto-mode flags produces a file byte-equal to the fixture" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
